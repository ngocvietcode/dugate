-- 0010_add_operation_completed_at.sql
-- Bug fix (BA dunglt32, 03/09/2026): "Tiến trình và Thời gian (Tạo - Xong) không chính xác".
--
-- Root cause: Operation."updatedAt" uses $onUpdate → it is bumped by ANY later write
-- (webhook delivery/retry, cleanup setting filesDeleted=true hours/days later). The UI
-- computed processing time as (updatedAt - createdAt), so the displayed duration inflated
-- long after the operation actually finished.
--
-- Fix: add a dedicated "completedAt" that is set once, when the operation reaches a
-- terminal state (SUCCEEDED/FAILED/CANCELLED), and never touched again.
--
-- SAFE: column is nullable, no default, no constraint on existing rows.
ALTER TABLE "Operation" ADD COLUMN IF NOT EXISTS "completedAt" timestamp (3);

-- Backfill legacy finished rows: approximate completedAt with updatedAt. This is only an
-- approximation for old data (updatedAt may already have drifted), but it is strictly better
-- than leaving NULL for historical rows and keeps duration display sensible. New operations
-- get an accurate completedAt from the engine.
UPDATE "Operation"
   SET "completedAt" = "updatedAt"
 WHERE "done" = true
   AND "completedAt" IS NULL;
