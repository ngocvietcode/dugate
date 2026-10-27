// tests/queue/queue-cleanup.test.ts
// Task 3 — backlog cleanup core.
// Plan: QUEUE_JOB_EXPIRY_PLAN.md §6 / T5.3 + 03-AMENDMENTS-QUEUE-PLAN.md §14 tests.

type CleanType = 'completed' | 'failed';

interface FakeJob {
  id: string;
  finishedOn?: number;
  clearLogs: jest.Mock;
}

interface QueueFixture {
  counts?: Partial<Record<'completed' | 'failed' | 'waiting' | 'active' | 'delayed', number>>;
  /** Successive return values of clean() per type. */
  cleanBatches?: Partial<Record<CleanType, string[][]>>;
  jobs?: Partial<Record<CleanType, FakeJob[]>>;
  countsError?: string;
}

const fixtures = new Map<string, QueueFixture>();
const cleanCalls: Array<{ queue: string; grace: number; limit: number; type: string }> = [];
const getJobsCalls: Array<{ queue: string; types: string[]; start: number; end: number }> = [];
/** Interleaved record of both passes, used to assert clean() runs before the trim. */
const callOrder: string[] = [];
const closedQueues: string[] = [];
const constructedQueues: string[] = [];

function makeFakeQueue(name: string) {
  const fixture = fixtures.get(name) ?? {};
  const cursors: Record<string, number> = { completed: 0, failed: 0 };

  return {
    name,
    async getJobCounts(...types: string[]) {
      if (fixture.countsError) throw new Error(fixture.countsError);
      const out: Record<string, number> = {};
      for (const type of types) out[type] = fixture.counts?.[type as keyof typeof fixture.counts] ?? 0;
      return out;
    },
    async clean(grace: number, limit: number, type: string) {
      cleanCalls.push({ queue: name, grace, limit, type });
      callOrder.push(`clean:${name}:${type}`);
      const batches = fixture.cleanBatches?.[type as CleanType] ?? [];
      const index = cursors[type] ?? 0;
      cursors[type] = index + 1;
      return batches[index] ?? [];
    },
    async getJobs(types: string[], start: number, end: number) {
      getJobsCalls.push({ queue: name, types, start, end });
      callOrder.push(`trim:${name}:${types[0]}`);
      const pool = fixture.jobs?.[types[0] as CleanType] ?? [];
      return pool.slice(start, end + 1);
    },
    async close() {
      closedQueues.push(name);
    },
    async obliterate() {},
  };
}

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => {
    constructedQueues.push(name);
    return makeFakeQueue(name);
  }),
  QueueEvents: jest.fn(),
}));

// ─── Redis client ─────────────────────────────────────────────────────────────

const scanPages: Array<[string, string[]]> = [];
const redisCalls = { set: 0, eval: 0, quit: 0 };
let scanError: string | null = null;
let lockAcquired = true;

const fakeClient = {
  async scan(_cursor: string, ..._rest: unknown[]) {
    if (scanError) throw new Error(scanError);
    return scanPages.shift() ?? ['0', []];
  },
  async set(..._args: unknown[]) {
    redisCalls.set += 1;
    return lockAcquired ? 'OK' : null;
  },
  async eval(..._args: unknown[]) {
    redisCalls.eval += 1;
    return 1;
  },
  async quit() {
    redisCalls.quit += 1;
    return 'OK';
  },
  disconnect() {},
};

jest.mock('@/lib/queue/redis', () => ({
  createRedisConnection: () => fakeClient,
}));

// ─── Postgres ─────────────────────────────────────────────────────────────────

let dbGroups: Array<{ name: string }> = [];
let dbError: string | null = null;

jest.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: async () => {
        if (dbError) throw new Error(dbError);
        return dbGroups;
      },
    }),
  },
}));
jest.mock('@/lib/db/schema', () => ({ workerGroups: { name: 'name' } }));

import type { Logger } from '@/lib/logger';
import { KEEP_JOB_LOGS } from '@/lib/config';
import {
  cleanExpiredJobs,
  enumerateQueues,
  isOwnedQueueName,
  queueNameFromMetaKey,
  resetWaitingTracker,
  scanQueueNames,
} from '@/lib/queue-cleanup';

const logLines: string[] = [];
const fakeLogger = {
  info: jest.fn((msg: string) => { logLines.push(`INFO ${msg}`); }),
  warn: jest.fn((msg: string) => { logLines.push(`WARN ${msg}`); }),
  error: jest.fn((msg: string) => { logLines.push(`ERROR ${msg}`); }),
  child: jest.fn(),
  raw: jest.fn(),
} as unknown as Logger;

const BASE_OPTS = { logger: fakeLogger, batchDelayMs: 0, skipLock: false };

beforeEach(() => {
  fixtures.clear();
  cleanCalls.length = 0;
  getJobsCalls.length = 0;
  callOrder.length = 0;
  closedQueues.length = 0;
  constructedQueues.length = 0;
  scanPages.length = 0;
  logLines.length = 0;
  redisCalls.set = 0;
  redisCalls.eval = 0;
  redisCalls.quit = 0;
  scanError = null;
  dbError = null;
  lockAcquired = true;
  dbGroups = [];
  resetWaitingTracker();
  jest.clearAllMocks();
});

// ─── Queue name helpers ───────────────────────────────────────────────────────

describe('queue name recognition', () => {
  it('accepts the queues this system owns', () => {
    for (const name of ['pipeline', 'workflow-steps', 'pipeline.ocr-group', 'workflow-steps.grp-1']) {
      expect(isOwnedQueueName(name)).toBe(true);
    }
  });

  it('rejects foreign queues — the Redis instance may be shared', () => {
    for (const name of ['mail', 'pipeline.', 'pipeline.-bad', 'pipeline.BAD', 'pipeline.a--b', 'other.pipeline']) {
      expect(isOwnedQueueName(name)).toBe(false);
    }
  });

  it('extracts the queue name from a bull meta key', () => {
    expect(queueNameFromMetaKey('bull:pipeline:meta')).toBe('pipeline');
    expect(queueNameFromMetaKey('bull:pipeline.grp:meta')).toBe('pipeline.grp');
    expect(queueNameFromMetaKey('bull:pipeline:123:logs')).toBeNull();
    expect(queueNameFromMetaKey('other:pipeline:meta')).toBeNull();
  });
});

describe('scanQueueNames', () => {
  it('follows the SCAN cursor to the end and de-duplicates', async () => {
    scanPages.push(['17', ['bull:pipeline:meta', 'bull:pipeline:meta']]);
    scanPages.push(['0', ['bull:workflow-steps:meta']]);

    const names = await scanQueueNames(fakeClient as never);
    expect(names.sort()).toEqual(['pipeline', 'workflow-steps']);
  });
});

// ─── B1: enumerate = DB ∪ SCAN ────────────────────────────────────────────────

describe('B1 — queue enumeration is the union of DB and SCAN', () => {
  it('finds an orphan queue whose worker group was deleted from the DB', async () => {
    dbGroups = [{ name: 'alive' }];
    scanPages.push(['0', [
      'bull:pipeline:meta',
      'bull:pipeline.alive:meta',
      'bull:pipeline.deleted-group:meta',
      'bull:workflow-steps.deleted-group:meta',
    ]]);

    const { all, orphans, dbAvailable } = await enumerateQueues(fakeClient as never, fakeLogger);

    expect(dbAvailable).toBe(true);
    // DB-derived queues appear even without Redis keys, SCAN-only ones are added.
    expect(all).toEqual([
      'pipeline', 'pipeline.alive', 'pipeline.deleted-group',
      'workflow-steps', 'workflow-steps.alive', 'workflow-steps.deleted-group',
    ]);
    expect(orphans.sort()).toEqual(['pipeline.deleted-group', 'workflow-steps.deleted-group']);
  });

  it('ignores queues that are not ours', async () => {
    scanPages.push(['0', ['bull:mail:meta', 'bull:pipeline:meta']]);
    const { all } = await enumerateQueues(fakeClient as never, fakeLogger);
    expect(all).not.toContain('mail');
  });

  it('reports NO orphans when the DB is unreachable, instead of accusing every queue', async () => {
    dbError = 'ECONNREFUSED';
    scanPages.push(['0', ['bull:pipeline.some-group:meta']]);

    const { all, orphans, dbAvailable } = await enumerateQueues(fakeClient as never, fakeLogger);

    expect(dbAvailable).toBe(false);
    expect(orphans).toEqual([]);
    // Still cleanable — a DB outage must not stop Redis hygiene.
    expect(all).toContain('pipeline.some-group');
  });

  it('falls back to DB-derived queues when SCAN fails', async () => {
    dbGroups = [{ name: 'grp' }];
    scanError = 'LOADING';
    const { all } = await enumerateQueues(fakeClient as never, fakeLogger);
    expect(all).toContain('pipeline.grp');
  });
});

// ─── Pass 1: clean() ──────────────────────────────────────────────────────────

describe('clean pass', () => {
  it('only ever cleans terminal states — never waiting, active or delayed', async () => {
    fixtures.set('pipeline', { counts: { waiting: 12, active: 3, delayed: 4, completed: 9 } });
    await cleanExpiredJobs(BASE_OPTS);

    const types = [...new Set(cleanCalls.map((c) => c.type))];
    expect(types.sort()).toEqual(['completed', 'failed']);
    expect(types).not.toContain('waiting');
    expect(types).not.toContain('active');
    expect(types).not.toContain('delayed');
  });

  it('keeps calling clean() while batches come back full, then stops on a short batch', async () => {
    fixtures.set('pipeline', {
      cleanBatches: {
        completed: [
          Array.from({ length: 3 }, (_, i) => `c${i}`),
          Array.from({ length: 3 }, (_, i) => `c${i + 3}`),
          ['c6'],
        ],
      },
    });

    const result = await cleanExpiredJobs({ ...BASE_OPTS, batchSize: 3, trimLogs: false });
    const pipelineStat = result.queues.find((q) => q.queue === 'pipeline');

    expect(pipelineStat?.removed.completed).toBe(7);
    expect(pipelineStat?.cleanIncomplete).toBe(false);
    expect(cleanCalls.filter((c) => c.queue === 'pipeline' && c.type === 'completed')).toHaveLength(3);
  });

  it('passes QUEUE_JOB_EXPIRE_MS through as the clean() grace argument', async () => {
    await cleanExpiredJobs({ ...BASE_OPTS, graceMs: 86_400_000, trimLogs: false });
    for (const call of cleanCalls) expect(call.grace).toBe(86_400_000);
  });

  it('uses the configured batch size as the clean() limit', async () => {
    await cleanExpiredJobs({ ...BASE_OPTS, batchSize: 300, trimLogs: false });
    for (const call of cleanCalls) expect(call.limit).toBe(300);
  });

  it('isolates a failing queue so the rest of the run still completes', async () => {
    dbGroups = [{ name: 'broken' }];
    fixtures.set('pipeline.broken', { countsError: 'Redis timeout' });
    fixtures.set('pipeline', { cleanBatches: { completed: [['a']] } });

    const result = await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });

    expect(result.totals.removedCompleted).toBe(1);
    expect(logLines.some((l) => l.startsWith('ERROR') && l.includes('pipeline.broken'))).toBe(true);
    expect(closedQueues).toContain('pipeline.broken');
  });

  it('closes every queue it opened', async () => {
    dbGroups = [{ name: 'g' }];
    await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });
    expect(closedQueues.sort()).toEqual(constructedQueues.sort());
  });
});

// ─── Pass 2: retro-trim job logs ──────────────────────────────────────────────

describe('retro-trim pass', () => {
  const now = Date.now();

  function jobsFor(count: number, finishedOn: number): FakeJob[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `j${i}`,
      finishedOn,
      clearLogs: jest.fn().mockResolvedValue(undefined),
    }));
  }

  it('trims logs of jobs still inside the age window, keeping KEEP_JOB_LOGS rows', async () => {
    const jobs = jobsFor(3, now - 1000);
    fixtures.set('pipeline', { jobs: { completed: jobs } });

    const result = await cleanExpiredJobs({ ...BASE_OPTS, graceMs: 60_000 });

    for (const job of jobs) {
      expect(job.clearLogs).toHaveBeenCalledWith(KEEP_JOB_LOGS);
    }
    expect(result.totals.logsTrimmed).toBe(3);
  });

  it('never passes 0 to clearLogs — that would delete the list instead of trimming it', async () => {
    const jobs = jobsFor(1, now);
    fixtures.set('pipeline', { jobs: { completed: jobs } });
    await cleanExpiredJobs({ ...BASE_OPTS, graceMs: 60_000 });

    const arg = jobs[0].clearLogs.mock.calls[0][0];
    expect(arg).toBeGreaterThan(0);
  });

  it('skips jobs already past the grace window — the clean pass owns those', async () => {
    const stale = jobsFor(2, now - 10 * 60_000);
    fixtures.set('pipeline', { jobs: { completed: stale } });

    const result = await cleanExpiredJobs({ ...BASE_OPTS, graceMs: 60_000 });

    for (const job of stale) expect(job.clearLogs).not.toHaveBeenCalled();
    expect(result.totals.logsTrimmed).toBe(0);
  });

  it('stops at QUEUE_LOG_TRIM_MAX_JOBS and flags the run as capped', async () => {
    // The default cap is 2000; feed more than that in one queue.
    const jobs = jobsFor(2100, now);
    fixtures.set('pipeline', { jobs: { completed: jobs } });

    const result = await cleanExpiredJobs({ ...BASE_OPTS, graceMs: 60_000, batchSize: 500 });
    const stat = result.queues.find((q) => q.queue === 'pipeline');

    expect(stat?.logTrimCapped).toBe(true);
    expect(stat?.logsTrimmed).toBeLessThanOrEqual(2000);
  });

  it('does nothing when the trim pass is switched off', async () => {
    const jobs = jobsFor(2, now);
    fixtures.set('pipeline', { jobs: { completed: jobs } });

    await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });

    expect(getJobsCalls).toHaveLength(0);
    for (const job of jobs) expect(job.clearLogs).not.toHaveBeenCalled();
  });

  it('runs AFTER the clean pass for the same queue, so it never trims a job about to be deleted', async () => {
    dbGroups = [{ name: 'g' }];
    fixtures.set('pipeline', {
      cleanBatches: { completed: [['x']] },
      jobs: { completed: [{ id: 'j', finishedOn: now, clearLogs: jest.fn().mockResolvedValue(undefined) }] },
    });

    await cleanExpiredJobs({ ...BASE_OPTS, graceMs: 60_000 });

    const pipelineOrder = callOrder.filter((entry) => entry.split(':')[1] === 'pipeline');
    const lastClean = pipelineOrder.lastIndexOf('clean:pipeline:failed');
    const firstTrim = pipelineOrder.findIndex((entry) => entry.startsWith('trim:'));

    expect(lastClean).toBeGreaterThanOrEqual(0);
    expect(firstTrim).toBeGreaterThan(lastClean);
    // And the whole of one queue finishes before the next queue starts.
    const firstOtherQueue = callOrder.findIndex((entry) => entry.split(':')[1] === 'pipeline.g');
    const lastPipeline = callOrder.map((e) => e.split(':')[1]).lastIndexOf('pipeline');
    expect(firstOtherQueue).toBeGreaterThan(lastPipeline);
  });

  it('survives a job whose clearLogs rejects (removed concurrently)', async () => {
    const jobs: FakeJob[] = [
      { id: 'ok', finishedOn: now, clearLogs: jest.fn().mockResolvedValue(undefined) },
      { id: 'gone', finishedOn: now, clearLogs: jest.fn().mockRejectedValue(new Error('missing key')) },
    ];
    fixtures.set('pipeline', { jobs: { completed: jobs } });

    const result = await cleanExpiredJobs({ ...BASE_OPTS, graceMs: 60_000 });
    expect(result.totals.logsTrimmed).toBe(1);
  });
});

// ─── Redis lock ───────────────────────────────────────────────────────────────

describe('Redis lock', () => {
  it('skips the whole run when another instance holds the lock', async () => {
    lockAcquired = false;
    fixtures.set('pipeline', { cleanBatches: { completed: [['a']] } });

    const result = await cleanExpiredJobs(BASE_OPTS);

    expect(result.skipped).toBe('lock-held');
    expect(cleanCalls).toHaveLength(0);
    expect(constructedQueues).toHaveLength(0);
    expect(logLines.some((l) => l.includes('lock'))).toBe(true);
  });

  it('releases the lock after a successful run', async () => {
    await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });
    // renew (per queue) + release, all via EVAL compare-and-swap
    expect(redisCalls.set).toBe(1);
    expect(redisCalls.eval).toBeGreaterThanOrEqual(1);
  });

  it('can run without the lock for a controlled one-shot pass', async () => {
    const result = await cleanExpiredJobs({ ...BASE_OPTS, skipLock: true, trimLogs: false });
    expect(redisCalls.set).toBe(0);
    expect(result.skipped).toBeUndefined();
  });

  it('quits the shared connection even when the run is skipped', async () => {
    lockAcquired = false;
    await cleanExpiredJobs(BASE_OPTS);
    expect(redisCalls.quit).toBe(1);
  });
});

// ─── Logging discipline ───────────────────────────────────────────────────────

describe('logging', () => {
  it('logs counts, never the job-id arrays clean() returns', async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `job-id-${i}`);
    fixtures.set('pipeline', { cleanBatches: { completed: [ids, []] } });

    await cleanExpiredJobs({ ...BASE_OPTS, batchSize: 300, trimLogs: false });

    const joined = logLines.join('\n');
    expect(joined).toContain('removed completed=300');
    expect(joined).not.toContain('job-id-0');
    expect(joined).not.toContain('job-id-299');
  });

  it('warns about orphan queues by name so Ops can act', async () => {
    dbGroups = [];
    scanPages.push(['0', ['bull:pipeline.ghost:meta']]);

    const result = await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });

    expect(result.orphanQueues).toEqual(['pipeline.ghost']);
    expect(logLines.some((l) => l.startsWith('WARN') && l.includes('pipeline.ghost'))).toBe(true);
  });
});

// ─── B7: waiting backlog alert ────────────────────────────────────────────────

describe('B7 — stalled waiting backlog', () => {
  it('stays quiet on the first run (no previous value to compare against)', async () => {
    fixtures.set('pipeline', { counts: { waiting: 50 } });
    await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });
    expect(logLines.some((l) => l.startsWith('ERROR') && l.includes('waiting'))).toBe(false);
  });

  it('raises an ERROR when waiting did not drain between two runs', async () => {
    fixtures.set('pipeline', { counts: { waiting: 50 } });
    await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });
    logLines.length = 0;
    await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });

    expect(logLines.some((l) => l.startsWith('ERROR') && l.includes('no worker consuming'))).toBe(true);
  });

  it('stays quiet while the backlog is draining', async () => {
    fixtures.set('pipeline', { counts: { waiting: 50 } });
    await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });
    fixtures.set('pipeline', { counts: { waiting: 20 } });
    logLines.length = 0;
    await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });

    expect(logLines.some((l) => l.startsWith('ERROR') && l.includes('waiting'))).toBe(false);
  });

  it('never deletes waiting jobs, however long they sit there', async () => {
    fixtures.set('pipeline', { counts: { waiting: 9999 } });
    await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });
    await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });

    expect(cleanCalls.every((c) => c.type === 'completed' || c.type === 'failed')).toBe(true);
  });
});

// ─── Never throws ─────────────────────────────────────────────────────────────

describe('cleanExpiredJobs never throws', () => {
  it('returns a result instead of rejecting when the lock call itself fails', async () => {
    const original = fakeClient.set;
    (fakeClient as { set: unknown }).set = async () => { throw new Error('redis down'); };
    try {
      await expect(cleanExpiredJobs(BASE_OPTS)).resolves.toMatchObject({ queues: [] });
    } finally {
      (fakeClient as { set: unknown }).set = original;
    }
  });

  it('is idempotent — a second run over an empty backlog is a no-op', async () => {
    const first = await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });
    const second = await cleanExpiredJobs({ ...BASE_OPTS, trimLogs: false });
    expect(second.totals.removedCompleted).toBe(first.totals.removedCompleted);
    expect(second.totals.removedFailed).toBe(0);
  });
});
