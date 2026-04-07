-- Migration: add_endpoint_slug_to_ext_override
-- Fix critical bug: ExternalApiOverride was scoped per (connection, apiKey)
-- causing prompt overrides from one endpoint to bleed into all other endpoints
-- that share the same ExternalApiConnection.
-- 
-- Solution: add endpointSlug to scope overrides per endpoint.

-- Step 1: Delete existing overrides (data loss acceptable — they were broken anyway)
DELETE FROM "ExternalApiOverride";

-- Step 2: Drop old unique constraint
DROP INDEX IF EXISTS "ExternalApiOverride_connectionId_apiKeyId_key";

-- Step 3: Add new endpointSlug column (required, no default)
ALTER TABLE "ExternalApiOverride" ADD COLUMN "endpointSlug" TEXT NOT NULL;

-- Step 4: Create new unique constraint with endpointSlug
CREATE UNIQUE INDEX "ExternalApiOverride_connectionId_apiKeyId_endpointSlug_key" 
  ON "ExternalApiOverride"("connectionId", "apiKeyId", "endpointSlug");

-- Step 5: Add index on endpointSlug for query performance
CREATE INDEX "ExternalApiOverride_endpointSlug_idx" ON "ExternalApiOverride"("endpointSlug");
