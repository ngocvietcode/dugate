-- Add per-profile rate limit (requests/minute) to ApiKey.
-- 0 = use the global default (RATE_LIMIT_API_KEY env var).
-- NOTE: Production deploys use `drizzle-kit push` (see docker-entrypoint.sh),
-- which applies this column automatically from lib/db/schema.ts.
-- This file is provided for environments that apply migrations manually.
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "rateLimitPerMin" integer DEFAULT 0 NOT NULL;
