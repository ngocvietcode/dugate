import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { db: ReturnType<typeof drizzle> | undefined };

function createDb() {
  const queryClient = postgres(process.env.DATABASE_URL!, {
    max: process.env.NODE_ENV === 'production' ? 10 : 3,
  });
  return drizzle(queryClient, {
    schema,
    logger: process.env.NODE_ENV === 'development',
  });
}

export const db = globalForDb.db ?? createDb();
if (process.env.NODE_ENV !== 'production') globalForDb.db = db;

export * from './schema';
