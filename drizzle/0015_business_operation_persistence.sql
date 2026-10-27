-- 0015_business_operation_persistence.sql
-- Feature: operations-request-tracking, task 1.1.
--
-- Operation remains the source of truth. This migration adds only canonical source
-- metadata, a generated grouping key, exact numeric cost, lookup indexes, and the
-- last-valid status snapshot required when a group's current states are unknown.
-- Every DDL operation is guarded so a deployment can safely rerun the migration.

-- Fail before changing the type when a legacy floating-point value cannot fit in
-- numeric(30,10). The maximum absolute integer boundary is 10^(30 - 10).
DO $migration$
DECLARE
  incompatible_cost_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'Operation'
       AND column_name = 'totalCostUsd'
       AND (
         data_type <> 'numeric'
         OR numeric_precision IS DISTINCT FROM 30
         OR numeric_scale IS DISTINCT FROM 10
       )
  ) THEN
    SELECT COUNT(*)
      INTO incompatible_cost_count
      FROM "Operation"
     WHERE "totalCostUsd"::text IN ('NaN', 'Infinity', '-Infinity')
        OR ABS("totalCostUsd"::numeric) >= POWER(10::numeric, 20);

    IF incompatible_cost_count > 0 THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'Cannot migrate Operation.totalCostUsd to numeric(30,10): %s value(s) are non-finite or exceed the supported range',
          incompatible_cost_count
        ),
        HINT = 'Correct the reported legacy cost values, then rerun migration 0015.';
    END IF;

    ALTER TABLE "Operation"
      ALTER COLUMN "totalCostUsd" DROP DEFAULT,
      ALTER COLUMN "totalCostUsd" TYPE numeric(30, 10)
        USING ROUND("totalCostUsd"::numeric, 10);
  END IF;
END
$migration$;

ALTER TABLE "Operation"
  ALTER COLUMN "totalCostUsd" SET DEFAULT 0.0000000000;

ALTER TABLE "Operation"
  ADD COLUMN IF NOT EXISTS "businessGroupKey" text
    GENERATED ALWAYS AS (
      CASE
        WHEN NULLIF(BTRIM("clientReference"), '') IS NULL
          THEN 'request:' || "id"
        ELSE 'profile:' || COALESCE("apiKeyId", '__internal__')
          || ':reference:' || BTRIM("clientReference")
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS "hiddenFromOperations" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "logicResult" text,
  ADD COLUMN IF NOT EXISTS "extractionResult" text,
  ADD COLUMN IF NOT EXISTS "inputTokensMissing" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "outputTokensMissing" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "costMissing" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasUnpricedCost" boolean DEFAULT false;

-- Repair defaults/nullability if an earlier run stopped after adding columns.
UPDATE "Operation"
   SET "hiddenFromOperations" = COALESCE("hiddenFromOperations", false),
       "inputTokensMissing" = COALESCE("inputTokensMissing", false),
       "outputTokensMissing" = COALESCE("outputTokensMissing", false),
       "costMissing" = COALESCE("costMissing", false),
       "hasUnpricedCost" = COALESCE("hasUnpricedCost", false)
 WHERE "hiddenFromOperations" IS NULL
    OR "inputTokensMissing" IS NULL
    OR "outputTokensMissing" IS NULL
    OR "costMissing" IS NULL
    OR "hasUnpricedCost" IS NULL;

ALTER TABLE "Operation"
  ALTER COLUMN "businessGroupKey" SET NOT NULL,
  ALTER COLUMN "hiddenFromOperations" SET DEFAULT false,
  ALTER COLUMN "hiddenFromOperations" SET NOT NULL,
  ALTER COLUMN "inputTokensMissing" SET DEFAULT false,
  ALTER COLUMN "inputTokensMissing" SET NOT NULL,
  ALTER COLUMN "outputTokensMissing" SET DEFAULT false,
  ALTER COLUMN "outputTokensMissing" SET NOT NULL,
  ALTER COLUMN "costMissing" SET DEFAULT false,
  ALTER COLUMN "costMissing" SET NOT NULL,
  ALTER COLUMN "hasUnpricedCost" SET DEFAULT false,
  ALTER COLUMN "hasUnpricedCost" SET NOT NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"Operation"'::regclass
       AND conname = 'operation_logic_result_check'
  ) THEN
    ALTER TABLE "Operation"
      ADD CONSTRAINT "operation_logic_result_check"
      CHECK ("logicResult" IS NULL OR "logicResult" IN ('PASS', 'FAIL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"Operation"'::regclass
       AND conname = 'operation_extraction_result_check'
  ) THEN
    ALTER TABLE "Operation"
      ADD CONSTRAINT "operation_extraction_result_check"
      CHECK ("extractionResult" IS NULL OR "extractionResult" IN ('SUCCESS', 'FAIL'));
  END IF;
END
$constraints$;

CREATE TABLE IF NOT EXISTS "BusinessOperationStatusSnapshot" (
  "businessGroupKey" text PRIMARY KEY,
  "lastValidStatus" text NOT NULL,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"BusinessOperationStatusSnapshot"'::regclass
       AND conname = 'business_operation_status_snapshot_status_check'
  ) THEN
    ALTER TABLE "BusinessOperationStatusSnapshot"
      ADD CONSTRAINT "business_operation_status_snapshot_status_check"
      CHECK ("lastValidStatus" IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED'));
  END IF;
END
$constraints$;

-- Eligible-row indexes used by grouping, filtering, breakdown, ordering, and detail.
CREATE INDEX IF NOT EXISTS "operation_business_group_created_id_idx"
  ON "Operation" ("businessGroupKey", "createdAt", "id")
  WHERE "deletedAt" IS NULL AND "hiddenFromOperations" = false;

CREATE INDEX IF NOT EXISTS "operation_profile_created_idx"
  ON "Operation" ("apiKeyId", "createdAt")
  WHERE "deletedAt" IS NULL AND "hiddenFromOperations" = false;

CREATE INDEX IF NOT EXISTS "operation_endpoint_business_group_idx"
  ON "Operation" ("endpointSlug", "businessGroupKey")
  WHERE "deletedAt" IS NULL AND "hiddenFromOperations" = false;

CREATE INDEX IF NOT EXISTS "operation_updated_business_group_idx"
  ON "Operation" ("updatedAt" DESC, "businessGroupKey")
  WHERE "deletedAt" IS NULL AND "hiddenFromOperations" = false;

CREATE INDEX IF NOT EXISTS "operation_profile_normalized_reference_idx"
  ON "Operation" ("apiKeyId", (NULLIF(BTRIM("clientReference"), '')))
  WHERE "deletedAt" IS NULL
    AND "hiddenFromOperations" = false
    AND NULLIF(BTRIM("clientReference"), '') IS NOT NULL;
