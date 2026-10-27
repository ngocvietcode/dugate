CREATE INDEX IF NOT EXISTS "config_audit_entity_id_createdAt_idx"
  ON "ConfigAudit" ("entityType", "entityId", "createdAt" DESC);

ALTER TABLE "ConfigAudit" ADD COLUMN IF NOT EXISTS "scopeEntityId" text;

CREATE INDEX IF NOT EXISTS "config_audit_scope_entity_createdAt_idx"
  ON "ConfigAudit" ("scopeEntityId", "createdAt" DESC);
