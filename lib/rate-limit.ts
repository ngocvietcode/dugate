// lib/rate-limit.ts
// Redis sliding-window rate limiter for /api/v1/ endpoints.
// Returns { allowed, remaining, retryAfter } without throwing.

import IORedis from 'ioredis';

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redis.on('error', () => { /* suppress — rate limiting degrades gracefully */ });
  }
  return redis;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds until window resets
}

/**
 * Check and increment the sliding-window counter for a given key.
 *
 * @param key     Unique identifier — e.g. `ratelimit:apikey:<id>` or `ratelimit:ip:<ip>`
 * @param limit   Maximum requests per window
 * @param windowSec  Window duration in seconds (default 60)
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec = 60,
): Promise<RateLimitResult> {
  try {
    const client = getRedis();
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const windowStart = now - windowMs;

    // Use a sorted set: member = timestamp, score = timestamp
    const pipeline = client.pipeline();
    pipeline.zremrangebyscore(key, '-inf', windowStart);       // purge expired entries
    pipeline.zadd(key, now, `${now}-${Math.random()}`);        // add current request
    pipeline.zcard(key);                                        // count in window
    pipeline.expire(key, windowSec + 1);                       // auto-expire key
    const results = await pipeline.exec();

    const count = (results?.[2]?.[1] as number) ?? 0;
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const retryAfter = allowed ? 0 : windowSec;

    return { allowed, remaining, retryAfter };
  } catch {
    // Redis failure → fail open (allow request) to avoid availability issues
    return { allowed: true, remaining: 1, retryAfter: 0 };
  }
}

// Default limits — can override via env vars
export const RATE_LIMIT_API_KEY = parseInt(process.env.RATE_LIMIT_API_KEY || '100');   // per api key per minute
export const RATE_LIMIT_IP = parseInt(process.env.RATE_LIMIT_IP || '30');              // per IP per minute (unauthenticated)
