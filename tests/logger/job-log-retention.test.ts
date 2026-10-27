// tests/logger/job-log-retention.test.ts
// A3 verification only — keepLogs itself was implemented in Task 1 (commit 1ea4c18).
//
// The two caps are independent and BOTH are needed:
//   KEEP_JOB_LOGS       → how MANY rows `bull:<queue>:<jobId>:logs` keeps
//   LOG_JOBLOG_HARD_CAP → how LONG each row may be   (this task)
// Neither one alone bounds `rows x bytes`.
//
// The end-to-end assertion (`LLEN bull:<q>:<jobId>:logs === 100` after a job emits
// 300 lines) needs a live Redis and belongs to the manual/metric checklist in
// 02-AMENDMENTS-LOGGER-PLAN.md §7. What is unit-testable is that the option is
// actually plumbed into job options — and NOT into Worker options, where BullMQ 5.x
// would silently ignore it (WorkerOptions has no keepLogs field).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { KEEP_JOB_LOGS, getQueueRetentionOptions } from '@/lib/config';

describe('keepLogs (A3) is still wired where BullMQ actually reads it', () => {
  it('is part of the shared job retention options', () => {
    expect(getQueueRetentionOptions()).toMatchObject({
      keepLogs: KEEP_JOB_LOGS,
      removeOnComplete: expect.objectContaining({ age: expect.any(Number), count: expect.any(Number) }),
      removeOnFail: expect.objectContaining({ age: expect.any(Number), count: expect.any(Number) }),
    });
  });

  it('defaults to 100 rows per job', () => {
    expect(KEEP_JOB_LOGS).toBe(100);
  });

  it('is NOT set on Worker options in worker.ts', () => {
    // `keepLogs` is a JOB option. Putting it back on the Worker would be a silent
    // no-op (and a tsc error), so guard the placement, not just the value.
    const source = readFileSync(path.join(process.cwd(), 'worker.ts'), 'utf8');
    expect(source).not.toMatch(/keepLogs\s*:/);
  });

  it('is applied at every queue creation site', () => {
    for (const file of ['lib/queue/pipeline-queue.ts', 'lib/queue/worker-group-router.ts']) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).toContain('getQueueRetentionOptions()');
    }
  });
});
