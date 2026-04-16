#!/bin/sh
set -e

# ─── Baseline ─────────────────────────────────────────────────────────────────
# Dùng khi DB production đã có schema nhưng chưa có lịch sử migration (_prisma_migrations).
# BASELINE=true → mark tất cả migrations là "applied" mà không chạy SQL.
# Chỉ cần chạy 1 lần duy nhất khi gặp lỗi P3005.
if [ "$BASELINE" = "true" ]; then
  echo "[entrypoint] BASELINE=true → Resolving all existing migrations as applied..."
  for migration_dir in prisma/migrations/*/; do
    migration_name=$(basename "$migration_dir")
    # Bỏ qua migration_lock.toml và các file không phải thư mục migration
    if [ -f "${migration_dir}migration.sql" ]; then
      echo "[entrypoint]   Resolving: $migration_name"
      npx prisma migrate resolve --applied "$migration_name" || true
    fi
  done
  echo "[entrypoint] Baseline complete. Now running migrate deploy..."
  npx prisma migrate deploy
  echo "[entrypoint] Migration complete."
# ─── Migration ────────────────────────────────────────────────────────────────
# Chạy toàn bộ pending migrations khi MIGRATION=true
# prisma migrate deploy: idempotent — bỏ qua migration đã chạy, chỉ chạy cái mới
elif [ "$MIGRATION" = "true" ]; then
  echo "[entrypoint] MIGRATION=true → Running prisma migrate deploy..."
  npx prisma migrate deploy
  echo "[entrypoint] Migration complete."
elif [ "$DB_PUSH" = "true" ]; then
  echo "[entrypoint] DB_PUSH=true → Running prisma db push to sync schema directly"
  npx prisma db push --accept-data-loss
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
  if [ -f "./prisma/seed.js" ]; then
    node ./prisma/seed.js || echo "[entrypoint] Seed command exited with non-zero code. (Check if SEED_ADMIN_KEY is missing)"
  else
    npx tsx prisma/seed.ts || echo "[entrypoint] Seed command failed."
  fi
  echo "[entrypoint] Seeder complete."
else
  echo "[entrypoint] SEED not set to true → Skipping seed."
fi

# ─── Start server ─────────────────────────────────────────────────────────────
echo "[entrypoint] Starting server..."
exec node server.js
