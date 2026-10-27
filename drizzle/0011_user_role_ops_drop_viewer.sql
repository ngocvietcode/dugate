-- 0011_user_role_ops_drop_viewer.sql
-- RBAC redesign (BA dunglt32, Sep 2026): the operations UI is restricted to TWO
-- roles only — ADMIN (full system admin) and OPS (operations staff). The legacy
-- "USER" role is renamed to "OPS"; the "VIEWER" role is removed entirely.
--
-- Rationale (security / SEC audit): the UI must serve operations + admin ONLY.
-- There is no general "viewer"/read-only tier, and no anonymous/self-service
-- access. Application code no longer recognises 'USER' or 'VIEWER'.
--
-- NOTE: this only touches "User"."role" (the login/auth role). It intentionally
-- does NOT touch "ApiKey"."role" (STANDARD/ADMIN/VIEWER), which is a separate
-- profile-level concept unrelated to user authentication.

-- 1) Rename the operations role: USER → OPS.
UPDATE "User" SET "role" = 'OPS' WHERE "role" = 'USER';

-- 2) New default for freshly-created accounts is OPS (was 'USER').
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'OPS';

-- 3) Legacy VIEWER accounts — REQUIRES ADMIN DECISION before running in prod.
--    A leftover 'VIEWER' role string is not recognised by the app: such an
--    account can still authenticate but has no operational permissions and an
--    empty profile scope. For a clean SEC posture, pick ONE of the options
--    below and uncomment it. By default this migration leaves VIEWER rows as-is
--    so an admin can review each account first.
--
--    Option A — promote VIEWER users to OPS (grant operational access):
--        UPDATE "User" SET "role" = 'OPS' WHERE "role" = 'VIEWER';
--
--    Option B — lock VIEWER users out of everything (keep the row, no access):
--        UPDATE "User" SET "role" = 'DISABLED' WHERE "role" = 'VIEWER';
--
--    Option C — remove VIEWER accounts entirely (irreversible):
--        DELETE FROM "User" WHERE "role" = 'VIEWER';

-- Verification (run manually after applying):
--   SELECT role, COUNT(*) FROM "User" GROUP BY role;   -- expect only ADMIN / OPS (+ any VIEWER left for review)
