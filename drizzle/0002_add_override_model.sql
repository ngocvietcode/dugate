-- Add per-profile, per-step model override to ExternalApiOverride.
-- null = use the model defined in the connection's staticFormFields ("model" field).
-- NOTE: Production deploys use `drizzle-kit push` (see docker-entrypoint.sh),
-- which applies this column automatically from lib/db/schema.ts.
-- This file is provided for environments that apply migrations manually.
ALTER TABLE "ExternalApiOverride" ADD COLUMN IF NOT EXISTS "modelOverride" text;
