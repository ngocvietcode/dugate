-- 0003_add_operation_tracing.sql
-- Feature: Operation Search & Reference Tracking for Ops team
-- SAFE: All columns are nullable, no default, no constraint on existing data.
-- Existing rows remain untouched (all new columns = NULL for old records).

-- 1. Operation: correlation ID for distributed tracing (saved from x-correlation-id header)
ALTER TABLE "Operation" ADD COLUMN IF NOT EXISTS "correlationId" TEXT;

-- 2. Operation: client reference extracted from request body per profile config
ALTER TABLE "Operation" ADD COLUMN IF NOT EXISTS "clientReference" TEXT;

-- 3. Indexes for search
-- B-tree indexes cover equality (=) and prefix LIKE ('abc%') queries.
-- For exact-match search (most common ops pattern), these are sufficient.
-- If future full-text ILIKE ('%abc%') becomes slow at scale,
-- add: CREATE EXTENSION IF NOT EXISTS pg_trgm; + GIN index.
CREATE INDEX IF NOT EXISTS "operation_correlationId_idx"
  ON "Operation" ("correlationId") WHERE "correlationId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "operation_clientReference_idx"
  ON "Operation" ("clientReference") WHERE "clientReference" IS NOT NULL;

-- Also index idempotencyKey for search (already has UNIQUE constraint but adding
-- partial index for search queries that filter non-null values)
CREATE INDEX IF NOT EXISTS "operation_idempotencyKey_search_idx"
  ON "Operation" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

-- 4. ProfileEndpoint: admin-configurable reference field name to extract from request body
ALTER TABLE "ProfileEndpoint" ADD COLUMN IF NOT EXISTS "referenceExtract" TEXT;
