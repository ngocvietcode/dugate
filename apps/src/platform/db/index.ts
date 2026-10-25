import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export { schema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.join(__dirname, 'migrations');

/** Tách file SQL thành từng câu lệnh; giữ nguyên dấu ";" trong khối $$...$$ và bỏ comment dòng. */
export function splitSql(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inDollar = false;
  for (const line of text.split('\n')) {
    const code = inDollar ? line : line.replace(/--.*$/, '');
    for (let i = 0; i < code.length; i++) {
      if (code.startsWith('$$', i)) { inDollar = !inDollar; cur += '$$'; i++; continue; }
      if (code[i] === ';' && !inDollar) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += code[i];
    }
    cur += '\n';
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Chạy migration SQL theo thứ tự tên file, ghi vết trong apps.schema_migrations. */
export async function migrate(db: Db): Promise<string[]> {
  await db.execute(sql.raw('CREATE SCHEMA IF NOT EXISTS apps'));
  await db.execute(sql.raw('CREATE TABLE IF NOT EXISTS apps.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'));
  const done = new Set(
    ((await db.execute(sql`SELECT name FROM apps.schema_migrations`)) as unknown as { rows: { name: string }[] }).rows
      .map((r) => r.name));
  const applied: string[] = [];
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await db.transaction(async (tx) => {
      for (const stmt of splitSql(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))) await tx.execute(sql.raw(stmt));
      await tx.execute(sql`INSERT INTO apps.schema_migrations (name) VALUES (${f})`);
    });
    applied.push(f);
  }
  return applied;
}

/** Kết nối PostgreSQL thật (production/dev). */
export async function connectPg(url: string): Promise<Db> {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  return drizzle(new Pool({ connectionString: url }), { schema }) as unknown as Db;
}
