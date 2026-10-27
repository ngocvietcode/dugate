#!/bin/sh
set -e

# ─── Schema Sync ──────────────────────────────────────────────────────────────
# MIGRATION=true → chạy drizzle-kit push để đồng bộ schema từ code lên DB.
# Lệnh chạy fail-closed; mọi schema diff vẫn phải được review trước khi bật MIGRATION.
# Mặc định: true (luôn sync khi deploy image mới).
if [ "$MIGRATION" = "true" ]; then
  echo "[entrypoint] MIGRATION=true → Running drizzle-kit push..."
  # Fail closed: an application compiled against a newer schema must never start
  # when schema synchronization fails. A successful no-op push exits with code 0.
  if ! yes | npx drizzle-kit push --force 2>&1; then
    echo "[entrypoint] ERROR: drizzle-kit push failed; refusing to start the application." >&2
    exit 1
  fi
  echo "[entrypoint] Schema sync complete."
else
  echo "[entrypoint] MIGRATION not set to true → Skipping schema sync."
fi

# ─── Seed ─────────────────────────────────────────────────────────────────────
# Chạy seed khi SEED=true
# Seed tìm record theo tên cố định → idempotent, chạy nhiều lần không tạo duplicate.
# Nếu SEED_ADMIN_KEY thay đổi, seed sẽ update keyHash của record hiện có (không tạo mới).
if [ "$SEED" = "true" ]; then
  echo "[entrypoint] SEED=true → Running database seeder"
  if [ -f "./dist/seed.js" ]; then
    node ./dist/seed.js || echo "[entrypoint] Seed command exited with non-zero code."
  else
    npx tsx lib/db/seed.ts || echo "[entrypoint] Seed command failed."
  fi
  echo "[entrypoint] Seeder complete."
else
  echo "[entrypoint] SEED not set to true → Skipping seed."
fi

# ─── Start server ─────────────────────────────────────────────────────────────
echo "[entrypoint] Starting server..."
exec node server.js
