-- Add semantic release version without altering the already-issued 0008 migration.
-- Apply manually after 0008 and DBA review.
ALTER TABLE IF EXISTS "ProfileRelease" ADD COLUMN IF NOT EXISTS "version" TEXT;
