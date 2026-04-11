// lib/queue/pipeline-queue.ts
// BullMQ Queue + QueueEvents singletons for the Pipeline Engine.
// Queue (producer) is used in submit.ts to enqueue jobs.
// QueueEvents is used for sync mode: job.waitUntilFinished(queueEvents).

import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

export const PIPELINE_QUEUE_NAME = 'pipeline';

/** Default timeout for executeSync mode (ms). Override via SYNC_TIMEOUT_MS env var. */
export const SYNC_TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT_MS || '30000', 10);

// ─── Redis Connection ──────────────────────────────────────────────────────────

function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  return new IORedis(url, {
    maxRetriesPerRequest: null, // Required by BullMQ — disables auto-throw on queue full
    enableReadyCheck: false,
    lazyConnect: true,          // Don't connect at import time (safe during Next.js build)
  });
}

// ─── Queue (Producer) ─────────────────────────────────────────────────────────

let queueInstance: Queue | null = null;

export function getPipelineQueue(): Queue {
  if (!queueInstance) {
    queueInstance = new Queue(PIPELINE_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 },  // Keep completed jobs for 1h (debug)
        removeOnFail: { age: 86400 },     // Keep failed jobs for 24h
      },
    });
  }
  return queueInstance;
}

// ─── QueueEvents (for sync waitUntilFinished) ─────────────────────────────────
// QueueEvents requires its own dedicated Redis connection per BullMQ requirement.

let queueEventsInstance: QueueEvents | null = null;

export function getPipelineQueueEvents(): QueueEvents {
  if (!queueEventsInstance) {
    queueEventsInstance = new QueueEvents(PIPELINE_QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }
  return queueEventsInstance;
}

// ─── Job Data Type ────────────────────────────────────────────────────────────

export interface PipelineJobData {
  operationId: string;
  correlationId?: string;
}
