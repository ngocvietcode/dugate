import crypto from 'node:crypto';
import { asc, desc, sql } from 'drizzle-orm';
import type { Db } from './db';
import { appAuditEvent } from './db/schema';

export interface AuditInput {
  runId?: string | null;
  actor: string;
  action: string;
  object: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  correlationId?: string | null;
  at: string; // ISO, do người gọi cấp để workflow/replay ổn định
}

export const GENESIS = '0'.repeat(64);

/** JSON có khoá sắp xếp — để hash không phụ thuộc thứ tự khoá. */
export function canonical(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function eventHash(prev: string, e: AuditInput): string {
  const body = canonical({ runId: e.runId ?? null, actor: e.actor, action: e.action, object: e.object,
    before: e.before ?? null, after: e.after ?? null, reason: e.reason ?? null,
    correlationId: e.correlationId ?? null, at: new Date(e.at).toISOString() });
  return crypto.createHash('sha256').update(prev).update('\n').update(body).digest('hex');
}

/** Ghi một sự kiện audit vào chuỗi hash toàn cục (khoá advisory để tuần tự hoá). */
export async function appendAudit(db: Db, e: AuditInput): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('apps.app_audit_event'))`);
    const [last] = await tx.select({ hash: appAuditEvent.hash }).from(appAuditEvent).orderBy(desc(appAuditEvent.seq)).limit(1);
    const prev = last?.hash ?? GENESIS;
    const hash = eventHash(prev, e);
    await tx.insert(appAuditEvent).values({
      runId: e.runId ?? null, actor: e.actor, action: e.action, object: e.object,
      before: (e.before ?? null) as object | null, after: (e.after ?? null) as object | null,
      reason: e.reason ?? null, correlationId: e.correlationId ?? null, at: new Date(e.at), prevHash: prev, hash,
    });
    return hash;
  });
}

/** Kiểm toàn bộ chuỗi; trả seq đầu tiên bị sai hoặc null nếu toàn vẹn. */
export async function verifyAuditChain(db: Db): Promise<number | null> {
  const rows = await db.select().from(appAuditEvent).orderBy(asc(appAuditEvent.seq));
  let prev = GENESIS;
  for (const r of rows) {
    const h = eventHash(prev, { runId: r.runId, actor: r.actor, action: r.action, object: r.object, before: r.before,
      after: r.after, reason: r.reason, correlationId: r.correlationId, at: r.at.toISOString() });
    if (r.prevHash !== prev || r.hash !== h) return r.seq;
    prev = r.hash;
  }
  return null;
}
