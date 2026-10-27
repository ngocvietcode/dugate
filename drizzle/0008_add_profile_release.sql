-- Profile Release is additive only. Apply this SQL manually after DBA review.
-- Do not enable drizzle-kit push for this migration.
CREATE TABLE IF NOT EXISTS "ProfileRelease" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "profileName" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "revision" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "bundle" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "sourceEnv" TEXT,
  "sourceHash" TEXT,
  "appVersion" TEXT,
  "message" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "profile_release_unique_idx" ON "ProfileRelease" ("profileName", "revision");
CREATE INDEX IF NOT EXISTS "profile_release_name_idx" ON "ProfileRelease" ("profileName");
CREATE INDEX IF NOT EXISTS "profile_release_hash_idx" ON "ProfileRelease" ("contentHash");

CREATE TABLE IF NOT EXISTS "ConfigAudit" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "entityName" TEXT,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "changes" TEXT,
  "detail" TEXT,
  "fromHash" TEXT,
  "toHash" TEXT,
  "planHash" TEXT,
  "ticketId" TEXT,
  "actorUserId" TEXT,
  "actorRole" TEXT,
  "sourceIp" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "config_audit_entity_idx" ON "ConfigAudit" ("entityType", "entityName");
CREATE INDEX IF NOT EXISTS "config_audit_createdAt_idx" ON "ConfigAudit" ("createdAt");
CREATE INDEX IF NOT EXISTS "config_audit_actor_idx" ON "ConfigAudit" ("actorUserId");
