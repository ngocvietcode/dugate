-- AlterTable: Add OIDC provider fields to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "provider" TEXT,
ADD COLUMN IF NOT EXISTS "providerSub" TEXT,
ADD COLUMN IF NOT EXISTS "email" TEXT,
ADD COLUMN IF NOT EXISTS "displayName" TEXT;

-- Add unique constraint on providerSub (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS "User_providerSub_key" ON "User"("providerSub");
