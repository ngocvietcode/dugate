-- Additive Profile Integration Config schema for URL-file authentication and callbacks.
-- Defaults preserve existing permissive behavior; nullable fields preserve legacy callback semantics.

ALTER TABLE "ApiKey"
  ADD COLUMN IF NOT EXISTS "fileAuthConfig" text,
  ADD COLUMN IF NOT EXISTS "callbackUrl" text,
  ADD COLUMN IF NOT EXISTS "callbackAuthConfig" text,
  ADD COLUMN IF NOT EXISTS "callbackPayload" text,
  ADD COLUMN IF NOT EXISTS "callbackUrlLocked" boolean DEFAULT false NOT NULL;

ALTER TABLE "ProfileEndpoint"
  ADD COLUMN IF NOT EXISTS "fileUrlEnabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "callbackEnabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "fileUrlDefaultChunks" integer,
  ADD COLUMN IF NOT EXISTS "callbackUrlOverride" text,
  ADD COLUMN IF NOT EXISTS "callbackPayloadOverride" text;

ALTER TABLE "Operation"
  ADD COLUMN IF NOT EXISTS "webhookAttempts" integer,
  ADD COLUMN IF NOT EXISTS "webhookLastError" text;
