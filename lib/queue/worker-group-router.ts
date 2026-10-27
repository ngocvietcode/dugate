// lib/queue/worker-group-router.ts
// Job Router: resolves the target BullMQ queue based on a profile's workerGroup assignment.
// Lazily creates and caches Queue instances per worker group.

import type IORedis from 'ioredis';
import { Queue, QueueEvents } from 'bullmq';
import { db } from '@/lib/db';
import { apiKeys, workerGroups } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createRedisConnection } from './redis';
import { PIPELINE_QUEUE_NAME, WORKFLOW_STEPS_QUEUE_NAME } from './pipeline-queue';
import { MAX_QUEUE_DEPTH, getQueueRetentionOptions } from '@/lib/config';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'worker-group-router' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouteResult {
  queue: Queue;
  queueName: string;
  stepsQueue: Queue;
  stepsQueueName: string;
}

// ─── Default job options (shared across all queues) ───────────────────────────

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  ...getQueueRetentionOptions(),
};

// ─── Queue cache ──────────────────────────────────────────────────────────────

const queueCache = new Map<string, Queue>();
const queueEventsCache = new Map<string, QueueEvents>();

/**
 * The IORedis instance handed to each cached Queue/QueueEvents.
 *
 * Needed because BullMQ marks a connection it did not create as `shared`
 * (queue-base.ts: `shared: isRedisInstance(opts.connection)`), and
 * RedisConnection.close() skips `quit()` for shared connections. So `queue.close()`
 * alone does NOT free the socket — evictGroupFromCache has to quit it explicitly.
 */
const connectionCache = new Map<string, IORedis>();

/**
 * Get or create a BullMQ Queue instance for the given queue name.
 * Instances are cached for reuse across submissions.
 */
export function getOrCreateQueue(queueName: string): Queue {
  let queue = queueCache.get(queueName);
  if (!queue) {
    const connection = createRedisConnection();
    queue = new Queue(queueName, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queueCache.set(queueName, queue);
    connectionCache.set(`queue:${queueName}`, connection);
  }
  return queue;
}

/**
 * Get or create a BullMQ QueueEvents instance for the given queue name.
 * QueueEvents listens to events for a specific queue — must match the queue
 * where the job was enqueued for waitUntilFinished to work.
 */
export function getOrCreateQueueEvents(queueName: string): QueueEvents {
  let events = queueEventsCache.get(queueName);
  if (!events) {
    const connection = createRedisConnection();
    events = new QueueEvents(queueName, { connection });
    queueEventsCache.set(queueName, events);
    connectionCache.set(`events:${queueName}`, connection);
  }
  return events;
}

// ─── Backpressure check ───────────────────────────────────────────────────────

// MAX_QUEUE_DEPTH now comes from lib/config.ts (same value, same fallback) instead of
// being re-parsed from process.env here — 03-AMENDMENTS-QUEUE-PLAN §11 (B6).

/**
 * Check if a queue exceeds the MAX_QUEUE_DEPTH threshold.
 * Returns true if the queue is over capacity (should reject).
 */
export async function checkBackpressure(queue: Queue): Promise<boolean> {
  const counts = await queue.getJobCounts('waiting', 'delayed');
  const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0);
  return depth > MAX_QUEUE_DEPTH;
}

// ─── Route resolution ─────────────────────────────────────────────────────────

/**
 * Resolves the target pipeline queue and workflow-steps queue for a given apiKeyId.
 *
 * - If apiKeyId is null/undefined → default queues
 * - If profile not found → default queues (silent)
 * - If profile.workerGroup is null → default queues
 * - If profile.workerGroup references a valid group → group-specific queues
 * - If profile.workerGroup references a non-existent group → default queues (log warning)
 * - If DB lookup fails → throws (caller should handle as 503)
 */
export async function resolveTargetQueue(apiKeyId?: string): Promise<RouteResult> {
  // No apiKeyId → default queue
  if (!apiKeyId) {
    return buildRouteResult(PIPELINE_QUEUE_NAME, WORKFLOW_STEPS_QUEUE_NAME);
  }

  // Single query: lookup profile's workerGroup + verify group exists via LEFT JOIN
  const [result] = await db
    .select({
      workerGroup: apiKeys.workerGroup,
      groupName: workerGroups.name,
    })
    .from(apiKeys)
    .leftJoin(workerGroups, eq(workerGroups.name, apiKeys.workerGroup))
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1);

  // Profile not found → default queue (not an error per Req 3.9)
  if (!result) {
    return buildRouteResult(PIPELINE_QUEUE_NAME, WORKFLOW_STEPS_QUEUE_NAME);
  }

  // No workerGroup assigned → default queue
  if (!result.workerGroup) {
    return buildRouteResult(PIPELINE_QUEUE_NAME, WORKFLOW_STEPS_QUEUE_NAME);
  }

  // workerGroup set but group doesn't exist (stale reference) → default queue + warn
  if (!result.groupName) {
    logger.warn(
      `[resolveTargetQueue] Profile ${apiKeyId} references non-existent worker group "${result.workerGroup}" — routing to default queue`,
    );
    return buildRouteResult(PIPELINE_QUEUE_NAME, WORKFLOW_STEPS_QUEUE_NAME);
  }

  // Route to group-specific queues
  const pipelineQueueName = `pipeline.${result.workerGroup}`;
  const stepsQueueName = `workflow-steps.${result.workerGroup}`;
  return buildRouteResult(pipelineQueueName, stepsQueueName);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRouteResult(pipelineQueueName: string, stepsQueueName: string): RouteResult {
  return {
    queue: getOrCreateQueue(pipelineQueueName),
    queueName: pipelineQueueName,
    stepsQueue: getOrCreateQueue(stepsQueueName),
    stepsQueueName: stepsQueueName,
  };
}

async function quitCachedConnection(cacheKey: string): Promise<void> {
  const connection = connectionCache.get(cacheKey);
  if (!connection) return;
  connectionCache.delete(cacheKey);
  await connection.quit().catch(() => { connection.disconnect(); });
}

/**
 * Evict cached Queue/QueueEvents instances for a deleted worker group, free their
 * Redis connections, and — only when provably safe — obliterate the group's queues.
 *
 * Why obliterate here: this is the one place that knows a group is gone. Without it,
 * `bull:pipeline.<group>:*` survives in Redis while the WorkerGroup row does not, so
 * any cleanup that enumerates queues from the DB can never see those keys again.
 * That is the orphan-queue source; lib/queue-cleanup.ts can only detect the orphans
 * after the fact, via SCAN.
 *
 * Safety: obliterate is irreversible and wipes waiting jobs too, so it runs only when
 * waiting + active + delayed are all zero, and always with `force: false`. With
 * `force: true` a worker mid-job would have its keys pulled out from under it. If any
 * count is non-zero the queue is left completely intact and a warning is logged for
 * Ops to decide — pending jobs may be real customer work that has not run yet.
 *
 * Never throws: the caller is the worker-group DELETE route, and a Redis hiccup must
 * not fail a database deletion that already succeeded.
 */
export async function evictGroupFromCache(groupName: string): Promise<void> {
  const pipelineKey = `pipeline.${groupName}`;
  const stepsKey = `workflow-steps.${groupName}`;

  for (const key of [pipelineKey, stepsKey]) {
    // Reuse the cached instance when there is one; otherwise open a short-lived queue
    // so obliterate also works in a process that never routed to this group.
    const cached = queueCache.get(key);
    let ownConnection: IORedis | null = null;
    let queue: Queue;
    if (cached) {
      queue = cached;
    } else {
      ownConnection = createRedisConnection();
      queue = new Queue(key, { connection: ownConnection });
    }

    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
      const pending = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
      if (pending === 0) {
        await queue.obliterate({ force: false });
        logger.info(`[evictGroupFromCache] Obliterated queue "${key}" for deleted worker group`);
      } else {
        logger.warn(
          `[evictGroupFromCache] Queue "${key}" NOT obliterated — ${pending} unprocessed job(s) remain `
          + `(waiting=${counts.waiting ?? 0}, active=${counts.active ?? 0}, delayed=${counts.delayed ?? 0}). `
          + `Keys are left in Redis for Ops to review.`,
          {
            queue: key,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
          },
        );
      }
    } catch (err) {
      logger.warn(`[evictGroupFromCache] Could not obliterate queue "${key}"`, { queue: key }, err);
    } finally {
      await queue.close().catch(() => {});
      queueCache.delete(key);
      if (ownConnection) {
        await ownConnection.quit().catch(() => { ownConnection!.disconnect(); });
      } else {
        await quitCachedConnection(`queue:${key}`);
      }
    }

    const events = queueEventsCache.get(key);
    if (events) {
      await events.close().catch(() => {});
      queueEventsCache.delete(key);
      await quitCachedConnection(`events:${key}`);
    }
  }
}
