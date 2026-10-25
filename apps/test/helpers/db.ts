import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { type Db, migrate, schema } from '../../src/platform/db';

/** PostgreSQL thật (PGlite, chạy trong tiến trình) đã migrate — dùng cho test. */
export async function testDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db);
  return db;
}
