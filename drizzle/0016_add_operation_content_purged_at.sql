-- 0016_add_operation_content_purged_at.sql
-- Operations data exposure, giai đoạn 2 (handover-report/DUImprovement/OperationsDataExposure/05-WORKPLAN.md).
--
-- Customer content carried by a request (parameters, prompts, extracted data, output,
-- per-step artifacts, file URLs) is no longer kept long-term. lib/operations/content-retention.ts
-- scrubs those columns in place and stamps "contentPurgedAt". Rows are NEVER deleted:
-- state, timestamps, tokens, cost, usage and errors stay for statistics and billing.
--
-- SAFE: nullable column, no default, existing rows untouched. Deploy applies it through
-- `drizzle-kit push` (MIGRATION=true once); this file is the reviewable record.
ALTER TABLE "Operation" ADD COLUMN IF NOT EXISTS "contentPurgedAt" timestamp (3);

-- Partial index for the retention scan (rows whose content is still present).
CREATE INDEX IF NOT EXISTS "operation_content_pending_purge_idx"
  ON "Operation" USING btree ("createdAt")
  WHERE "contentPurgedAt" IS NULL;
