-- 0012_add_role_permissions.sql
-- Configurable RBAC: ADMIN is always full access in application code; OPS gets
-- a curated set of configurable capability grants stored in RolePermission.
-- Locked identity/RBAC capabilities are never seeded and are ignored by the
-- resolver even if inserted manually.
--
-- Deployment order: apply 0011_user_role_ops_drop_viewer.sql first, review any
-- legacy VIEWER account, then apply this migration before deploying code that
-- requires RolePermission. Migration is intentionally idempotent.

CREATE TABLE IF NOT EXISTS "RolePermission" (
  "id" text PRIMARY KEY NOT NULL,
  "role" text NOT NULL,
  "permission" text NOT NULL,
  "granted" boolean NOT NULL DEFAULT true,
  "updatedByUserId" text,
  "updatedAt" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "role_permission_unique_idx"
  ON "RolePermission" USING btree ("role", "permission");
CREATE INDEX IF NOT EXISTS "role_permission_role_idx"
  ON "RolePermission" USING btree ("role");

-- OPS defaults approved in TASK2-RBAC-CONFIGURABLE-DESIGN.md. Baseline caps
-- (profile:read, connector:read, operations:read) live in code; ADMIN has every
-- capability in code; locked Identity caps have no writable grant row.
INSERT INTO "RolePermission" ("id", "role", "permission", "granted") VALUES
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'profile:create', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'profile:update', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'profile:delete', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'profile:rotate', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'endpoint:manage', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'release:manage', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'connector:manage', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'operations:cancel', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'operations:resume', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'operations:export', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'settings:manage', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'workergroups:manage', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'queue:view', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'observability:view', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'audit:view', true),
  (md5(random()::text || clock_timestamp()::text), 'OPS', 'data:all-profiles', true)
ON CONFLICT ("role", "permission") DO NOTHING;

-- Post-deploy verification:
--   SELECT "role", "permission", "granted" FROM "RolePermission" ORDER BY "role", "permission";
-- Rollback (only if reverting the corresponding application version):
--   DROP TABLE IF EXISTS "RolePermission";
