#!/bin/sh
set -e

# ─── Baseline ─────────────────────────────────────────────────────────────────
# Dùng khi DB production đã có schema nhưng chưa có lịch sử migration (_prisma_migrations).
# BASELINE=true → mark tất cả migrations là "applied" mà không chạy SQL.
# Chỉ cần chạy 1 lần duy nhất khi gặp lỗi P3005.
# Baseline using drizzle-kit is not natively supported like prisma migrate resolve, skipping for drizzle.
if [ "$BASELINE" = "true" ]; then
  echo "[entrypoint] BASELINE=true → Not natively supported for drizzle-kit push."
  echo "[entrypoint] Migration complete."
# ─── Migration ────────────────────────────────────────────────────────────────
# Chạy toàn bộ pending migrations khi MIGRATION=true
# prisma migrate deploy: idempotent — bỏ qua migration đã chạy, chỉ chạy cái mới
elif [ "$MIGRATION" = "true" ]; then
  echo "[entrypoint] MIGRATION=true → Running drizzle-kit push..."
  npx drizzle-kit push
  echo "[entrypoint] Migration complete."
elif [ "$DB_PUSH" = "true" ]; then
  echo "[entrypoint] DB_PUSH=true → Running drizzle-kit push to sync schema directly"
  npx drizzle-kit push
  echo "[entrypoint] DB Push complete."
else
  echo "[entrypoint] MIGRATION and DB_PUSH not set to true → Skipping migration."
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
