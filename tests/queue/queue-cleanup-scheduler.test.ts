// tests/queue/queue-cleanup-scheduler.test.ts
// Task 3 — scheduler gate, registration point, and the unhandled-rejection trap.
// Plan: QUEUE_JOB_EXPIRY_PLAN.md T5.4 + 03-AMENDMENTS-QUEUE-PLAN.md §5 (A4).

import { readFileSync } from 'node:fs';
import path from 'node:path';

const cleanExpiredJobs = jest.fn();

jest.mock('@/lib/queue-cleanup', () => ({
  cleanExpiredJobs: (...args: unknown[]) => cleanExpiredJobs(...args),
}));

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn(), raw: jest.fn() };

type SchedulerModule = typeof import('@/lib/queue-cleanup-scheduler');

/** Re-import with a fresh module registry so both the env gate and `scheduled` reset. */
function loadScheduler(enabled: string | undefined): SchedulerModule {
  let mod!: SchedulerModule;
  jest.isolateModules(() => {
    if (enabled === undefined) delete process.env.QUEUE_CLEANUP_SCHEDULE_ENABLED;
    else process.env.QUEUE_CLEANUP_SCHEDULE_ENABLED = enabled;
    mod = require('@/lib/queue-cleanup-scheduler') as SchedulerModule;
  });
  return mod;
}

const savedEnv = process.env.QUEUE_CLEANUP_SCHEDULE_ENABLED;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  cleanExpiredJobs.mockResolvedValue({ queues: [], totals: {} });
});

afterEach(() => {
  jest.useRealTimers();
  if (savedEnv === undefined) delete process.env.QUEUE_CLEANUP_SCHEDULE_ENABLED;
  else process.env.QUEUE_CLEANUP_SCHEDULE_ENABLED = savedEnv;
});

describe('scheduler gate', () => {
  it('does not arm anything when QUEUE_CLEANUP_SCHEDULE_ENABLED=false', () => {
    const { ensureQueueCleanupScheduled } = loadScheduler('false');
    ensureQueueCleanupScheduled(logger as never);

    jest.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(cleanExpiredJobs).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Scheduler disabled'));
  });

  // Fail-safe default. This scan DELETES jobs and deletion has no undo, so it is
  // opt-in: an unset env must NOT arm an uncontrolled destructive scan 30s after a
  // worker restart. Ops enables it explicitly after the first controlled pass
  // (03-AMENDMENTS-QUEUE-PLAN §8 / B3). Guard this — flipping it back is a
  // production hazard, not a preference.
  it('does NOT arm when the env is unset (default off, fail-safe)', () => {
    const { ensureQueueCleanupScheduled } = loadScheduler(undefined);
    ensureQueueCleanupScheduled(logger as never);

    jest.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(cleanExpiredJobs).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Scheduler disabled'));
  });

  it('does NOT arm for a non-"true" value', () => {
    const { ensureQueueCleanupScheduled } = loadScheduler('1');
    ensureQueueCleanupScheduled(logger as never);

    jest.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(cleanExpiredJobs).not.toHaveBeenCalled();
  });

  it('runs once on startup, then once per 24h', () => {
    const { ensureQueueCleanupScheduled } = loadScheduler('true');
    ensureQueueCleanupScheduled(logger as never);

    jest.advanceTimersByTime(30_000);
    expect(cleanExpiredJobs).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(cleanExpiredJobs).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(cleanExpiredJobs).toHaveBeenCalledTimes(3);
  });

  it('does not double-schedule when called twice in one process', () => {
    const { ensureQueueCleanupScheduled } = loadScheduler('true');
    ensureQueueCleanupScheduled(logger as never);
    ensureQueueCleanupScheduled(logger as never);

    jest.advanceTimersByTime(30_000);
    expect(cleanExpiredJobs).toHaveBeenCalledTimes(1);
  });

  it('stops firing after stopQueueCleanupScheduled()', () => {
    const { ensureQueueCleanupScheduled, stopQueueCleanupScheduled } = loadScheduler('true');
    ensureQueueCleanupScheduled(logger as never);
    stopQueueCleanupScheduled();

    jest.advanceTimersByTime(72 * 60 * 60 * 1000);
    expect(cleanExpiredJobs).not.toHaveBeenCalled();
  });

  it('passes the caller-supplied logger through to each run', () => {
    const { ensureQueueCleanupScheduled } = loadScheduler('true');
    ensureQueueCleanupScheduled(logger as never);

    jest.advanceTimersByTime(30_000);
    expect(cleanExpiredJobs).toHaveBeenCalledWith({ logger });
  });
});

// ─── THE TRAP ─────────────────────────────────────────────────────────────────
// An async callback inside setInterval whose promise is not caught becomes an
// unhandled rejection. On current Node that terminates the process — the worker dies
// and every job stops with it. The .catch() has to be attached at the call site, on
// every tick, not only on the first one.
describe('a failing cleanup run must never kill the worker', () => {
  it('catches the rejection and logs it instead of leaving it unhandled', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      cleanExpiredJobs.mockRejectedValue(new Error('Redis unreachable'));
      const { ensureQueueCleanupScheduled } = loadScheduler('true');
      ensureQueueCleanupScheduled(logger as never);

      jest.advanceTimersByTime(30_000);
      // Let the rejection settle through the .catch() handler.
      await Promise.resolve();
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('initial run failed'),
        { trigger: 'initial' },
        expect.any(Error),
      );
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('keeps the interval alive after a failed run — the next tick still fires', async () => {
    cleanExpiredJobs.mockRejectedValue(new Error('transient'));
    const { ensureQueueCleanupScheduled } = loadScheduler('true');
    ensureQueueCleanupScheduled(logger as never);

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    await Promise.resolve();
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    await Promise.resolve();

    expect(cleanExpiredJobs).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(3);
  });
});

// ─── A4: registration point ───────────────────────────────────────────────────
// Static source assertions. layout.tsx calls its schedulers from INSIDE the
// RootLayout function body (deliberately, to avoid a DB connection during
// `next build`), which means they only start once a page is server-rendered.
// DUGate is an API gateway, so that may never happen.
describe('A4 — registered in worker.ts, not in app/layout.tsx', () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

  it('worker.ts arms the scheduler at module scope', () => {
    const source = read('worker.ts');
    expect(source).toContain('ensureQueueCleanupScheduled(');
    // Module scope = the call is not indented inside a function body.
    expect(source).toMatch(/^ensureQueueCleanupScheduled\(/m);
  });

  it('worker.ts cancels the timers on graceful shutdown', () => {
    expect(read('worker.ts')).toContain('stopQueueCleanupScheduled()');
  });

  it('app/layout.tsx does NOT register the queue cleanup scheduler', () => {
    expect(read('app/layout.tsx')).not.toContain('QueueCleanup');
  });

  it('the scheduler logger carries no BullMQ job — nothing of its own reaches Redis :logs', () => {
    const source = read('worker.ts');
    // The worker's system logger has no job attached; the child inherits that.
    expect(source).toMatch(/ensureQueueCleanupScheduled\(log\.child\(\{ service: 'queue-cleanup' \}\)\)/);
    expect(source).not.toMatch(/ensureQueueCleanupScheduled\([^)]*job/);
  });
});
