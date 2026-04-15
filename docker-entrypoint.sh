#!/bin/sh
set -e

# ─── Migration ────────────────────────────────────────────────────────────────
# Chạy toàn bộ pending migrations khi MIGRATION=true
# prisma migrate deploy: idempotent — bỏ qua migration đã chạy, chỉ chạy cái mới
if [ "$MIGRATION" = "true" ]; then
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
# Seed dùng upsert — idempotent, chạy nhiều lần không tạo duplicate
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
