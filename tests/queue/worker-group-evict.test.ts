// tests/queue/worker-group-evict.test.ts
// Task 3 / B2 — obliterate a deleted worker group's queues, but only when provably safe.
// Plan: 03-AMENDMENTS-QUEUE-PLAN.md §7 (B2).
//
// This closes the ORPHAN QUEUE source. Before this, deleting a worker group removed the
// DB row and closed the cached Queue object, leaving `bull:pipeline.<group>:*` in Redis
// with nothing left to point at it — invisible to any cleanup that enumerates from the DB.

interface QueueBehaviour {
  counts?: Partial<Record<'waiting' | 'active' | 'delayed', number>>;
  countsError?: string;
  obliterateError?: string;
}

const behaviours = new Map<string, QueueBehaviour>();
const obliterateCalls: Array<{ queue: string; opts: unknown }> = [];
const closedQueues: string[] = [];

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => {
    const behaviour = behaviours.get(name) ?? {};
    return {
      name,
      async getJobCounts(...types: string[]) {
        if (behaviour.countsError) throw new Error(behaviour.countsError);
        const out: Record<string, number> = {};
        for (const type of types) out[type] = behaviour.counts?.[type as 'waiting'] ?? 0;
        return out;
      },
      async obliterate(opts: unknown) {
        if (behaviour.obliterateError) throw new Error(behaviour.obliterateError);
        obliterateCalls.push({ queue: name, opts });
      },
      async close() { closedQueues.push(name); },
      async add() {},
    };
  }),
  QueueEvents: jest.fn().mockImplementation((name: string) => ({
    name,
    async close() { closedQueues.push(`events:${name}`); },
  })),
}));

const quitCalls: string[] = [];
let quitShouldFail = false;
const disconnectCalls: string[] = [];

jest.mock('@/lib/queue/redis', () => ({
  createRedisConnection: () => {
    const id = `conn-${quitCalls.length + disconnectCalls.length}`;
    return {
      async quit() {
        if (quitShouldFail) throw new Error('already closed');
        quitCalls.push(id);
        return 'OK';
      },
      disconnect() { disconnectCalls.push(id); },
    };
  },
}));

jest.mock('@/lib/db', () => ({ db: {} }));
jest.mock('@/lib/db/schema', () => ({ apiKeys: {}, workerGroups: {} }));

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn(), raw: jest.fn() };
jest.mock('@/lib/logger', () => ({ Logger: jest.fn(() => logger) }));

import { evictGroupFromCache, getOrCreateQueue } from '@/lib/queue/worker-group-router';

beforeEach(() => {
  behaviours.clear();
  obliterateCalls.length = 0;
  closedQueues.length = 0;
  quitCalls.length = 0;
  disconnectCalls.length = 0;
  quitShouldFail = false;
  jest.clearAllMocks();
});

describe('B2 — obliterate on worker group deletion', () => {
  it('obliterates both queues when nothing is pending', async () => {
    await evictGroupFromCache('gone-group');

    expect(obliterateCalls.map((c) => c.queue).sort())
      .toEqual(['pipeline.gone-group', 'workflow-steps.gone-group']);
  });

  it('NEVER uses force: true — that would pull keys out from under an active worker', async () => {
    await evictGroupFromCache('gone-group');

    expect(obliterateCalls).not.toHaveLength(0);
    for (const call of obliterateCalls) {
      expect(call.opts).toEqual({ force: false });
    }
  });

  it('leaves the queue untouched when jobs are still waiting', async () => {
    behaviours.set('pipeline.busy', { counts: { waiting: 7 } });

    await evictGroupFromCache('busy');

    // Unprocessed jobs may be real customer work that has not run yet.
    expect(obliterateCalls.map((c) => c.queue)).not.toContain('pipeline.busy');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('NOT obliterated'),
      expect.objectContaining({ queue: 'pipeline.busy', waiting: 7 }),
    );
  });

  it('leaves the queue untouched for active or delayed jobs too', async () => {
    behaviours.set('pipeline.a', { counts: { active: 1 } });
    behaviours.set('workflow-steps.a', { counts: { delayed: 3 } });

    await evictGroupFromCache('a');

    expect(obliterateCalls).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('still obliterates the sibling queue when only one has pending work', async () => {
    behaviours.set('pipeline.mixed', { counts: { waiting: 2 } });

    await evictGroupFromCache('mixed');

    expect(obliterateCalls.map((c) => c.queue)).toEqual(['workflow-steps.mixed']);
  });

  it('does not reject when obliterate fails — a DB row was already deleted', async () => {
    behaviours.set('pipeline.x', { obliterateError: 'Queue is not paused' });

    await expect(evictGroupFromCache('x')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not obliterate'),
      expect.objectContaining({ queue: 'pipeline.x' }),
      expect.any(Error),
    );
  });

  it('does not reject when Redis is unreachable', async () => {
    behaviours.set('pipeline.y', { countsError: 'ECONNREFUSED' });
    behaviours.set('workflow-steps.y', { countsError: 'ECONNREFUSED' });

    await expect(evictGroupFromCache('y')).resolves.toBeUndefined();
    expect(obliterateCalls).toHaveLength(0);
  });

  it('closes every queue it opened, pending jobs or not', async () => {
    behaviours.set('pipeline.z', { counts: { waiting: 1 } });

    await evictGroupFromCache('z');

    expect(closedQueues).toContain('pipeline.z');
    expect(closedQueues).toContain('workflow-steps.z');
  });

  it('frees the Redis connection — queue.close() alone cannot, the connection is shared', async () => {
    // BullMQ marks a caller-provided IORedis instance as `shared`, and
    // RedisConnection.close() skips quit() for shared connections. So eviction has to
    // quit the socket itself or the process leaks one per deleted group.
    await evictGroupFromCache('leaky');
    expect(quitCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to disconnect() when quit() fails', async () => {
    quitShouldFail = true;
    await evictGroupFromCache('stubborn');
    expect(disconnectCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('evicts and obliterates a queue that was cached by the router', async () => {
    const cached = getOrCreateQueue('pipeline.cached');
    expect(cached).toBeDefined();

    await evictGroupFromCache('cached');

    expect(obliterateCalls.map((c) => c.queue)).toContain('pipeline.cached');
    // A later route resolution must build a fresh instance, not reuse the obliterated one.
    expect(getOrCreateQueue('pipeline.cached')).not.toBe(cached);
  });
});
