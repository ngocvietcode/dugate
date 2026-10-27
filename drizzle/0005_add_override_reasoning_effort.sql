-- Add per-profile, per-step reasoning_effort override to ExternalApiOverride.
-- null = use the reasoning_effort defined in the connection's staticFormFields
-- ("reasoning_effort" field), or omit it entirely when the connector has none.
-- NOTE: Production deploys use `drizzle-kit push` (see docker-entrypoint.sh),
-- which applies this column automatically from lib/db/schema.ts.
-- This file is provided for environments that apply migrations manually.
ALTER TABLE "ExternalApiOverride" ADD COLUMN IF NOT EXISTS "reasoningEffortOverride" text;
