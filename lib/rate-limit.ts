// lib/rate-limit.ts
// Redis sliding-window rate limiter for /api/v1/ endpoints.
// Returns { allowed, remaining, retryAfter } without throwing.

import IORedis from 'ioredis';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { BASE_TYPE_URI } from '@/lib/errors';

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

// ─── Shared enforcement helper ──────────────────────────────────────────────

interface ResolvedApiKey {
  id: string;
  rateLimitPerMin?: number | null;
}

export interface EnforceRateLimitOptions {
  /** Resolved ApiKey record — keys the limit by API key and uses its per-profile rateLimitPerMin. */
  apiKey?: ResolvedApiKey | null;
  /** Force IP-based scoping regardless of headers (use for public/browser endpoints). */
  scope?: 'ip';
  /** Explicit limit override (requests/window). Takes precedence over defaults but not over a configured per-profile limit. */
  limit?: number;
  /** Window size in seconds (default 60). */
  windowSec?: number;
  /** Return RFC 9457 application/problem+json (true, default) or a simple { error } body (false). */
  problemJson?: boolean;
}

function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Resolve the rate-limit key + limit for a request, run the check, and return a
 * 429 response if the caller is over the limit — otherwise null (allowed).
 *
 * Keying priority (when scope !== 'ip'):
 *   1. Resolved API key (per-profile limit) — for server-to-server /api/v1 callers
 *   2. Raw x-api-key header (hash prefix) — key present but not yet resolved
 *   3. Authenticated browser user (x-user-id)
 *   4. Client IP (fallback)
 */
export async function enforceRateLimit(
  req: Request,
  opts: EnforceRateLimitOptions = {},
): Promise<NextResponse | null> {
  const windowSec = opts.windowSec ?? 60;
  const problemJson = opts.problemJson ?? true;

  let key: string;
  let limit: number;

  if (opts.scope === 'ip') {
    key = `ratelimit:ip:${getClientIp(req)}`;
    limit = opts.limit ?? RATE_LIMIT_IP;
  } else if (opts.apiKey) {
    key = `ratelimit:apikey:${opts.apiKey.id}`;
    const perProfile = opts.apiKey.rateLimitPerMin ?? 0;
    limit = perProfile > 0 ? perProfile : (opts.limit ?? RATE_LIMIT_API_KEY);
  } else {
    const rawKey = req.headers.get('x-api-key');
    const userId = req.headers.get('x-user-id');
    if (rawKey) {
      const hashPrefix = crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 16);
      key = `ratelimit:apikey:raw:${hashPrefix}`;
      limit = opts.limit ?? RATE_LIMIT_API_KEY;
    } else if (userId) {
      key = `ratelimit:user:${userId}`;
      limit = opts.limit ?? RATE_LIMIT_API_KEY;
    } else {
      key = `ratelimit:ip:${getClientIp(req)}`;
      limit = opts.limit ?? RATE_LIMIT_IP;
    }
  }

  const rl = await checkRateLimit(key, limit, windowSec);
  if (rl.allowed) return null;

  const headers = {
    'Retry-After': String(rl.retryAfter),
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': '0',
  };

  const body = problemJson
    ? {
        type: `${BASE_TYPE_URI}/too-many-requests`,
        title: 'Too Many Requests',
        status: 429,
        detail: `Rate limit of ${limit} requests per ${windowSec}s exceeded. Retry after ${rl.retryAfter}s.`,
      }
    : { error: 'Too Many Requests' };

  return NextResponse.json(body, { status: 429, headers });
}
