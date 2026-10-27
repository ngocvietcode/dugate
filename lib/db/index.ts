import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { db: ReturnType<typeof drizzle> | undefined };

function createDb() {
  const poolMax = parseInt(process.env.DB_POOL_MAX || (process.env.NODE_ENV === 'production' ? '10' : '3'), 10);
  const queryClient = postgres(process.env.DATABASE_URL!, {
    max: poolMax,
  });
  return drizzle(queryClient, {
    schema,
    logger: process.env.NODE_ENV === 'development',
  });
}

// Always cache on globalThis to prevent multiple pool instances across hot-reloads
// and dynamic imports. This is safe in both development and production.
export const db = globalForDb.db ?? createDb();
globalForDb.db = db;

export * from './schema';
