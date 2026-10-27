// lib/queue-cleanup.ts
// Backlog cleanup for BullMQ queues. Three passes per run, in this order:
//
//   1. clean()     — remove terminal jobs older than QUEUE_JOB_EXPIRE_MS
//   2. log trim    — LTRIM the `:logs` of jobs still INSIDE the age window
//   3. report      — per-queue counts, orphan queues, stalled `waiting` alert
//
// Why this exists at all, given lib/config.ts already sets removeOnComplete /
// removeOnFail / keepLogs: those are JOB options, frozen into each job at `add`
// time. They apply to new jobs only. On top of that, BullMQ trims a queue only
// when a job finishes ON THAT QUEUE — a worker-group queue that is no longer in
// use never trims itself. So this is a PERMANENT component, not a one-off
// migration script.
//
// Plan: QUEUE_JOB_EXPIRY_PLAN.md §6 + 03-AMENDMENTS-QUEUE-PLAN.md (A4, B1, B4,
// B5, B7) + the retro-trim pass.
//
// SAFETY RULES (do not relax):
//   - Only queue.clean() / queue.obliterate(). Never FLUSHALL, never DEL bull:*.
//     Deleting individual keys leaves orphan members in the state sorted sets, which
//     makes getJobCounts lie and can crash a worker loading a job that is gone.
//   - Never touch waiting / active jobs. Those may be real work that has not run.
//   - Small batches with a pause between them. queue.clean() is a Lua script and
//     runs atomically, so a large batch blocks Redis' single thread — and every
//     request through the gateway blocks with it.
//   - Log MEASUREMENTS, never the job-id arrays clean() returns. One batch of 300
//     ids is ~11KB of text, which the log sanitizer would cut at 500 chars, leaving
//     unusable debris.

import type IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { db } from '@/lib/db';
import { workerGroups } from '@/lib/db/schema';
import {
  KEEP_JOB_LOGS,
  QUEUE_CLEANUP_BATCH_DELAY_MS,
  QUEUE_CLEANUP_BATCH_SIZE,
  QUEUE_JOB_EXPIRE_MS,
  QUEUE_LOG_TRIM_ENABLED,
  QUEUE_LOG_TRIM_MAX_JOBS,
} from '@/lib/config';
import { Logger } from '@/lib/logger';
import { PIPELINE_QUEUE_NAME, WORKFLOW_STEPS_QUEUE_NAME } from '@/lib/queue/pipeline-queue';
import { createRedisConnection } from '@/lib/queue/redis';
import { isValidWorkerGroupName } from '@/lib/queue/worker-group-validation';

/** Terminal states this module is allowed to remove. Never waiting/active/delayed. */
const CLEANABLE_TYPES = ['completed', 'failed'] as const;
type CleanableType = (typeof CLEANABLE_TYPES)[number];

const LOCK_KEY = 'dugate:queue-cleanup:lock';
/** Long enough to cover a full run; renewed at every queue boundary regardless. */
const LOCK_TTL_MS = 15 * 60 * 1000;
/** Stops a runaway loop if clean() keeps reporting full batches. 300 x 2000 = 600k. */
const MAX_BATCHES_PER_TYPE = 2000;
/** BullMQ's default key prefix. Queue keys look like `<prefix>:<queueName>:meta`. */
const BULL_PREFIX = 'bull';

export interface QueueCleanupStat {
  queue: string;
  /** Present in Redis but not derivable from the DB — a leftover of a deleted group. */
  orphan: boolean;
  before: Record<'completed' | 'failed' | 'waiting' | 'active' | 'delayed', number>;
  removed: Record<CleanableType, number>;
  /** Jobs whose `:logs` list was LTRIM-ed to KEEP_JOB_LOGS. */
  logsTrimmed: number;
  /** True when the trim pass stopped at QUEUE_LOG_TRIM_MAX_JOBS with work left. */
  logTrimCapped: boolean;
  /** clean() still reported full batches when MAX_BATCHES_PER_TYPE was reached. */
  cleanIncomplete: boolean;
}

export interface QueueCleanupResult {
  ranAt: string;
  durationMs: number;
  /** Set when another instance held the lock; no passes ran. */
  skipped?: 'lock-held';
  queues: QueueCleanupStat[];
  /** Queue names found only via SCAN. Ops decides whether to obliterate them. */
  orphanQueues: string[];
  totals: {
    queuesScanned: number;
    removedCompleted: number;
    removedFailed: number
    logsTrimmed: number;
  };
}

export interface CleanExpiredJobsOptions {
  logger?: Logger;
  /** Overrides QUEUE_JOB_EXPIRE_MS. Used by the controlled first pass and by tests. */
  graceMs?: number;
  batchSize?: number;
  batchDelayMs?: number;
  /** Skip the retro-trim pass regardless of QUEUE_LOG_TRIM_ENABLED. */
  trimLogs?: boolean;
  /** Skip the Redis lock (single-shot manual run). */
  skipLock?: boolean;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// ─── Queue name enumeration ───────────────────────────────────────────────────

/**
 * True for names this system owns: `pipeline`, `workflow-steps`, and their
 * `.<group>` variants. The Redis instance may be shared, so SCAN results are
 * filtered through this before anything is deleted.
 */
export function isOwnedQueueName(name: string): boolean {
  for (const base of [PIPELINE_QUEUE_NAME, WORKFLOW_STEPS_QUEUE_NAME]) {
    if (name === base) return true;
    if (name.startsWith(`${base}.`)) {
      return isValidWorkerGroupName(name.slice(base.length + 1));
    }
  }
  return false;
}

/** `bull:pipeline.foo:meta` → `pipeline.foo`. Returns null for anything else. */
export function queueNameFromMetaKey(key: string): string | null {
  const prefix = `${BULL_PREFIX}:`;
  const suffix = ':meta';
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return null;
  const name = key.slice(prefix.length, key.length - suffix.length);
  return name.length > 0 ? name : null;
}

/**
 * SCAN (never KEYS — KEYS blocks) for `bull:*:meta`, one key per existing queue.
 *
 * This is the half that finds ORPHAN queues. `evictGroupFromCache` used to only
 * close the cached Queue object when a worker group was deleted, so
 * `bull:pipeline.<deleted-group>:*` stayed in Redis while disappearing from the DB —
 * invisible to any cleanup that enumerates from the DB alone.
 */
export async function scanQueueNames(client: IORedis): Promise<string[]> {
  const found = new Set<string>();
  let cursor = '0';
  let guard = 0;
  do {
    const [next, keys] = await client.scan(
      cursor, 'MATCH', `${BULL_PREFIX}:*:meta`, 'COUNT', 500,
    );
    cursor = next;
    for (const key of keys) {
      const name = queueNameFromMetaKey(key);
      if (name) found.add(name);
    }
    guard += 1;
  } while (cursor !== '0' && guard < 100_000);
  return [...found];
}

export interface EnumeratedQueues {
  /** Union of both sources, filtered to owned names. */
  all: string[];
  /** Owned names found via SCAN but not derivable from the DB. */
  orphans: string[];
  /** False when the DB lookup failed — orphans cannot be trusted and stays empty. */
  dbAvailable: boolean;
}

/**
 * Queue list = (DB WorkerGroup) UNION (SCAN 'bull:*:meta').
 *
 * The DB half covers configured queues that may have no keys in Redis yet; the
 * SCAN half covers queues whose group row is gone. Neither alone is complete.
 */
export async function enumerateQueues(
  client: IORedis,
  logger: Logger,
): Promise<EnumeratedQueues> {
  const fromDb = new Set<string>([PIPELINE_QUEUE_NAME, WORKFLOW_STEPS_QUEUE_NAME]);
  let dbAvailable = true;
  try {
    const groups = await db.select({ name: workerGroups.name }).from(workerGroups);
    for (const group of groups) {
      fromDb.add(`${PIPELINE_QUEUE_NAME}.${group.name}`);
      fromDb.add(`${WORKFLOW_STEPS_QUEUE_NAME}.${group.name}`);
    }
  } catch (err) {
    // Redis-only mode: still clean what SCAN found, but do not accuse anything of
    // being an orphan — without the DB every queue would look orphaned.
    dbAvailable = false;
    logger.error('[queue-cleanup] WorkerGroup lookup failed — orphan detection disabled for this run', undefined, err);
  }

  let scanned: string[] = [];
  try {
    scanned = await scanQueueNames(client);
  } catch (err) {
    logger.error('[queue-cleanup] SCAN for bull:*:meta failed — falling back to DB-derived queues only', undefined, err);
  }

  const ownedScanned = scanned.filter(isOwnedQueueName);
  const skipped = scanned.length - ownedScanned.length;
  if (skipped > 0) {
    // Foreign queues on a shared Redis. Counted, never touched.
    logger.info(`[queue-cleanup] Ignored ${skipped} non-DUGate queue(s) found by SCAN`);
  }

  const all = new Set<string>([...fromDb, ...ownedScanned]);
  const orphans = dbAvailable ? ownedScanned.filter((name) => !fromDb.has(name)) : [];

  return { all: [...all].sort(), orphans, dbAvailable };
}

// ─── Redis lock ───────────────────────────────────────────────────────────────

/**
 * `SET key token NX PX ttl`. The in-process `scheduled` guard only stops one
 * process from double-scheduling; with several worker replicas each would run its
 * own scan. clean() is idempotent so this protects resources, not correctness.
 */
export async function acquireCleanupLock(
  client: IORedis,
  token: string,
  ttlMs = LOCK_TTL_MS,
): Promise<boolean> {
  const res = await client.set(LOCK_KEY, token, 'PX', ttlMs, 'NX');
  return res === 'OK';
}

/** Compare-and-delete: never release a lock that a later holder now owns. */
export async function releaseCleanupLock(client: IORedis, token: string): Promise<void> {
  await client.eval(
    `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
    1, LOCK_KEY, token,
  );
}

/** Push the TTL out mid-run so a long pass cannot let a second instance in. */
async function renewCleanupLock(client: IORedis, token: string, ttlMs = LOCK_TTL_MS): Promise<void> {
  await client.eval(
    `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`,
    1, LOCK_KEY, token, String(ttlMs),
  ).catch(() => {});
}

// ─── Pass 1: remove expired terminal jobs ─────────────────────────────────────

async function cleanQueueType(
  queue: Queue,
  type: CleanableType,
  graceMs: number,
  batchSize: number,
  batchDelayMs: number,
): Promise<{ removed: number; incomplete: boolean }> {
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_TYPE; batch += 1) {
    // Returns the ids it deleted. We only ever use the LENGTH — see the header note.
    const ids = await queue.clean(graceMs, batchSize, type);
    removed += ids.length;
    if (ids.length < batchSize) return { removed, incomplete: false };
    await sleep(batchDelayMs);
  }
  return { removed, incomplete: true };
}

// ─── Pass 2: retro-trim logs of jobs still inside the age window ──────────────

/**
 * LTRIM `bull:<queue>:<jobId>:logs` down to the last KEEP_JOB_LOGS rows, without
 * removing the job.
 *
 * Runs AFTER pass 1 so it never spends round-trips on jobs that are about to be
 * deleted, and it additionally skips anything already past `graceMs` (pass 1 may
 * have hit its batch ceiling and left some behind).
 *
 * Batches are issued with Promise.all: ioredis pipelines commands queued in the
 * same tick, so a batch of 300 LTRIMs costs roughly one round-trip instead of 300.
 */
async function trimQueueLogs(
  queue: Queue,
  graceMs: number,
  batchSize: number,
  batchDelayMs: number,
  maxJobs: number,
): Promise<{ trimmed: number; capped: boolean }> {
  // 0 would make clearLogs() delete the list outright; keep at least one row.
  const keepLogs = Math.max(1, KEEP_JOB_LOGS);
  const now = Date.now();
  let trimmed = 0;
  let inspected = 0;

  for (const type of CLEANABLE_TYPES) {
    let start = 0;
    for (;;) {
      if (maxJobs > 0 && inspected >= maxJobs) return { trimmed, capped: true };

      const room = maxJobs > 0 ? Math.min(batchSize, maxJobs - inspected) : batchSize;
      const jobs = await queue.getJobs([type], start, start + room - 1);
      if (jobs.length === 0) break;
      inspected += jobs.length;

      const results = await Promise.all(jobs.map(async (job) => {
        if (!job) return false;
        // Pass 1 owns anything past the grace window.
        if (job.finishedOn && now - job.finishedOn > graceMs) return false;
        try {
          await job.clearLogs(keepLogs);
          return true;
        } catch {
          // A job removed by a concurrent trim/retention between getJobs and here.
          // Not an error worth a log line per job.
          return false;
        }
      }));
      trimmed += results.filter(Boolean).length;

      if (jobs.length < room) break;
      start += jobs.length;
      await sleep(batchDelayMs);
    }
  }

  return { trimmed, capped: false };
}

// ─── B7: alert on a `waiting` backlog that never drains ───────────────────────
// Not a capacity problem. A queue with waiting jobs and no consumer means customer
// requests are silently never processed — a functional bug. These jobs must NOT be
// deleted automatically, so the only safe action is to make the situation loud.
const previousWaiting = new Map<string, number>();

/** Exposed for tests — the map is module state that would leak across cases. */
export function resetWaitingTracker(): void {
  previousWaiting.clear();
}

function checkWaitingBacklog(queueName: string, waiting: number, logger: Logger): void {
  const previous = previousWaiting.get(queueName);
  previousWaiting.set(queueName, waiting);
  if (waiting > 0 && previous !== undefined && waiting >= previous) {
    logger.error(
      `[queue-cleanup] Queue "${queueName}" has ${waiting} waiting job(s) and did not drain since the last run `
      + `(was ${previous}) — likely no worker consuming this queue. Jobs are NOT removed; investigate the consumer.`,
      { queue: queueName, waiting, previousWaiting: previous },
    );
  }
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/**
 * One cleanup run across every enumerated queue.
 *
 * Never throws: every queue is isolated so one unreachable queue cannot abort the
 * run, and the whole body is wrapped. Callers must still attach `.catch()` — an
 * unhandled rejection inside a setInterval callback can terminate the worker
 * process and with it every job.
 */
export async function cleanExpiredJobs(
  options: CleanExpiredJobsOptions = {},
): Promise<QueueCleanupResult> {
  const logger = options.logger ?? new Logger({ service: 'queue-cleanup' });
  const graceMs = options.graceMs ?? QUEUE_JOB_EXPIRE_MS;
  const batchSize = Math.max(1, options.batchSize ?? QUEUE_CLEANUP_BATCH_SIZE);
  const batchDelayMs = Math.max(0, options.batchDelayMs ?? QUEUE_CLEANUP_BATCH_DELAY_MS);
  const trimLogs = options.trimLogs ?? QUEUE_LOG_TRIM_ENABLED;

  const startedAt = Date.now();
  const result: QueueCleanupResult = {
    ranAt: new Date(startedAt).toISOString(),
    durationMs: 0,
    queues: [],
    orphanQueues: [],
    totals: { queuesScanned: 0, removedCompleted: 0, removedFailed: 0, logsTrimmed: 0 },
  };

  // One shared connection for the whole run. BullMQ treats a provided IORedis
  // instance as `shared`, so queue.close() will NOT quit it — which is what lets
  // every Queue below reuse this single connection. It is quit explicitly at the end.
  const connection = createRedisConnection();
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let holdsLock = false;

  try {
    if (!options.skipLock) {
      holdsLock = await acquireCleanupLock(connection, token);
      if (!holdsLock) {
        logger.info('[queue-cleanup] Skipped — another instance holds the cleanup lock');
        result.skipped = 'lock-held';
        result.durationMs = Date.now() - startedAt;
        return result;
      }
    }

    const { all, orphans, dbAvailable } = await enumerateQueues(connection, logger);
    result.orphanQueues = orphans;
    result.totals.queuesScanned = all.length;

    logger.info(
      `[queue-cleanup] Start — ${all.length} queue(s), graceMs=${graceMs}, batch=${batchSize}, `
      + `delayMs=${batchDelayMs}, trimLogs=${trimLogs}, dbAvailable=${dbAvailable}`,
    );
    if (orphans.length > 0) {
      // Found in Redis, absent from the DB. Cleaned like any other queue, but the
      // keys themselves only go away via obliterate — an Ops decision.
      logger.warn(
        `[queue-cleanup] ${orphans.length} orphan queue(s) present in Redis but not in WorkerGroup: `
        + `${orphans.join(', ')} — consider obliterating them once confirmed unused`,
      );
    }

    for (const queueName of all) {
      await renewCleanupLock(connection, token);

      const stat: QueueCleanupStat = {
        queue: queueName,
        orphan: orphans.includes(queueName),
        before: { completed: 0, failed: 0, waiting: 0, active: 0, delayed: 0 },
        removed: { completed: 0, failed: 0 },
        logsTrimmed: 0,
        logTrimCapped: false,
        cleanIncomplete: false,
      };

      const queue = new Queue(queueName, { connection });
      try {
        // Cheap O(1) counts. There is no dry-run mode on clean() (B5), so the
        // before-counts plus the removed-counts are how a run is verified.
        const counts = await queue.getJobCounts('completed', 'failed', 'waiting', 'active', 'delayed');
        stat.before = {
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
        };

        for (const type of CLEANABLE_TYPES) {
          const { removed, incomplete } = await cleanQueueType(
            queue, type, graceMs, batchSize, batchDelayMs,
          );
          stat.removed[type] = removed;
          if (incomplete) stat.cleanIncomplete = true;
        }

        if (trimLogs) {
          const trim = await trimQueueLogs(
            queue, graceMs, batchSize, batchDelayMs, QUEUE_LOG_TRIM_MAX_JOBS,
          );
          stat.logsTrimmed = trim.trimmed;
          stat.logTrimCapped = trim.capped;
        }

        checkWaitingBacklog(queueName, stat.before.waiting, logger);

        // Measurements only — never the id arrays clean() returned.
        logger.info(
          `[queue-cleanup] "${queueName}"${stat.orphan ? ' (orphan)' : ''}: `
          + `removed completed=${stat.removed.completed} failed=${stat.removed.failed}, `
          + `logsTrimmed=${stat.logsTrimmed}, `
          + `before completed=${stat.before.completed} failed=${stat.before.failed} `
          + `waiting=${stat.before.waiting} active=${stat.before.active} delayed=${stat.before.delayed}`,
          {
            queue: queueName,
            removedCompleted: stat.removed.completed,
            removedFailed: stat.removed.failed,
            logsTrimmed: stat.logsTrimmed,
          },
        );
        if (stat.cleanIncomplete) {
          logger.warn(
            `[queue-cleanup] "${queueName}" still had full batches after ${MAX_BATCHES_PER_TYPE} rounds — `
            + `remaining backlog will be picked up on the next run`,
          );
        }
        if (stat.logTrimCapped) {
          logger.info(
            `[queue-cleanup] "${queueName}" log trim stopped at QUEUE_LOG_TRIM_MAX_JOBS=${QUEUE_LOG_TRIM_MAX_JOBS} — continues next run`,
          );
        }
      } catch (err) {
        // Isolated per queue: an unreachable or malformed queue must not abort the run.
        logger.error(`[queue-cleanup] Failed while cleaning queue "${queueName}"`, { queue: queueName }, err);
      } finally {
        await queue.close().catch(() => {});
      }

      result.queues.push(stat);
      result.totals.removedCompleted += stat.removed.completed;
      result.totals.removedFailed += stat.removed.failed;
      result.totals.logsTrimmed += stat.logsTrimmed;
    }

    result.durationMs = Date.now() - startedAt;
    logger.info(
      `[queue-cleanup] Done in ${result.durationMs}ms — queues=${result.totals.queuesScanned}, `
      + `removedCompleted=${result.totals.removedCompleted}, removedFailed=${result.totals.removedFailed}, `
      + `logsTrimmed=${result.totals.logsTrimmed}, orphans=${result.orphanQueues.length}`,
    );
    return result;
  } catch (err) {
    result.durationMs = Date.now() - startedAt;
    logger.error('[queue-cleanup] Run aborted', undefined, err);
    return result;
  } finally {
    if (holdsLock) await releaseCleanupLock(connection, token).catch(() => {});
    // BullMQ will not have quit this for us (shared connection), so do it here.
    await connection.quit().catch(() => { connection.disconnect(); });
  }
}
