-- Durable, bounded operation progress history for Operations polling and post-run diagnostics.
ALTER TABLE "Operation" ADD COLUMN IF NOT EXISTS "progressLogJson" TEXT;
