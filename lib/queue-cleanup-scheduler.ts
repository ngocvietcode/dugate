// lib/queue-cleanup-scheduler.ts
// Daily trigger for lib/queue-cleanup.ts.
//
// REGISTERED IN worker.ts AT MODULE SCOPE — deliberately NOT in app/layout.tsx.
//
// `app/layout.tsx:43` calls ensureCleanupScheduled() from inside the RootLayout
// function body, and that is intentional (the comment there explains it avoids a DB
// connection during `next build`). The consequence is that those schedulers only
// start once some page is server-rendered. DUGate is an API gateway: traffic goes to
// /api/*, which never passes through RootLayout. After a container restart, if nobody
// opens the UI, the scheduler never runs at all.
//
// worker.ts has neither problem: it is a long-lived process, `next build` never
// imports it, and job retention is about jobs FINISHING — which happens in the
// worker, not in the app. See 03-AMENDMENTS-QUEUE-PLAN.md §5 (A4).

import { QUEUE_CLEANUP_SCHEDULE_ENABLED } from '@/lib/config';
import { Logger } from '@/lib/logger';
import { cleanExpiredJobs } from '@/lib/queue-cleanup';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Let the worker finish booting and attach to its queues before the first scan. */
const FIRST_RUN_DELAY_MS = 30_000;

let scheduled = false;
let firstRunTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

/**
 * Schedule the daily backlog scan. Idempotent per process.
 *
 * @param logger Pass the worker's system logger (e.g. `log.child({ service: 'queue-cleanup' })`).
 *   It must NOT carry a BullMQ job — this scheduler belongs to no job, so nothing it
 *   logs may be written into a job's Redis `:logs` list.
 */
export function ensureQueueCleanupScheduled(logger?: Logger): void {
  if (scheduled) return;

  const log = logger ?? new Logger({ service: 'queue-cleanup' });

  if (!QUEUE_CLEANUP_SCHEDULE_ENABLED) {
    log.info('[queue-cleanup] Scheduler disabled (QUEUE_CLEANUP_SCHEDULE_ENABLED=false) — no automatic backlog scan');
    return;
  }

  scheduled = true;

  // THE TRAP: cleanExpiredJobs() is async. Returning or ignoring its promise inside a
  // timer callback means a rejection becomes an unhandled rejection, which on modern
  // Node terminates the process — killing the worker and every job with it. The
  // .catch() must be attached here, at the call site, on every tick.
  const run = (trigger: string) => {
    cleanExpiredJobs({ logger: log })
      .catch((err) => log.error(`[queue-cleanup] ${trigger} run failed`, { trigger }, err));
  };

  log.info(
    `[queue-cleanup] Scheduler armed — first run in ${FIRST_RUN_DELAY_MS / 1000}s, then every ${DAY_MS / 3_600_000}h`,
  );

  firstRunTimer = setTimeout(() => run('initial'), FIRST_RUN_DELAY_MS);
  intervalTimer = setInterval(() => run('scheduled'), DAY_MS);
}

/** Cancel pending timers. Called on worker shutdown; a run already in flight is left alone (it is idempotent). */
export function stopQueueCleanupScheduled(): void {
  if (firstRunTimer) clearTimeout(firstRunTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  firstRunTimer = null;
  intervalTimer = null;
  scheduled = false;
}
