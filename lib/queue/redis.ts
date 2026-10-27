// lib/queue/redis.ts
// Shared Redis connection factory for BullMQ.
// All queue, worker, and queueEvents instances should use this factory
// to avoid creating redundant connections.

import IORedis from 'ioredis';

/**
 * Create a new IORedis connection configured for BullMQ.
 * Each BullMQ component (Queue, Worker, QueueEvents) requires its own
 * dedicated connection — do not share a single instance between them.
 */
export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  return new IORedis(url, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    lazyConnect: true,          // Safe for Next.js build-time imports
  });
}
