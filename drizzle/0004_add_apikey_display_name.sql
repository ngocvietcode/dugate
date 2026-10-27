-- Additive Profile presentation field. Technical identity remains "name".
-- This is a manual/DBA artifact; current runtime uses drizzle-kit push, not SQL sequencing.
ALTER TABLE "ApiKey"
  ADD COLUMN IF NOT EXISTS "displayName" text;
