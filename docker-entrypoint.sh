#!/bin/sh
set -e

# Run migrations safely when MIGRATION=true
if [ "$MIGRATION" = "true" ]; then
  echo "[entrypoint] MIGRATION=true → Running prisma migrate deploy"
  npx prisma migrate deploy
  echo "[entrypoint] Migration complete."
elif [ "$DB_PUSH" = "true" ]; then
  echo "[entrypoint] DB_PUSH=true → Running prisma db push to sync schema directly"
  npx prisma db push --accept-data-loss
  echo "[entrypoint] DB Push complete."
else
  echo "[entrypoint] MIGRATION and DB_PUSH not set to true → Skipping migration."
fi

# Run seeding when SEED=true
if [ "$SEED" = "true" ]; then
  echo "[entrypoint] SEED=true → Running database seeder"
  if [ -f "./prisma/seed.js" ]; then
    node ./prisma/seed.js || echo "[entrypoint] Seed command exited with non-zero code. (Check if SEED_ADMIN_KEY is missing)"
  else
    npx tsx prisma/seed.ts || echo "[entrypoint] Seed command failed."
  fi
  echo "[entrypoint] Seeder complete."
fi

echo "[entrypoint] Starting server..."
exec node server.js
