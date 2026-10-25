import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { appendAudit, verifyAuditChain } from '../src/platform/audit';
import { type Db, migrate } from '../src/platform/db';
import { appRun } from '../src/platform/db/schema';
import { testDb } from './helpers/db';

let db: Db;

async function dbError(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; return `${err.message} ${err.cause?.message ?? ''}`; }
  return 'không lỗi';
}
beforeAll(async () => { db = await testDb(); });

const run = { runId: 'run_1', app: 'x', appVersion: '0.1.0', caller: 'LOS', requestId: 'r1',
  businessRef: { system: 'LOS', type: 'T', id: '1' }, makerUserId: 'rm01', reviewMode: 'DELEGATED', status: 'RUNNING' };

describe('DB tầng Apps', () => {
  it('migration chạy lại không lỗi (idempotent)', async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it('idempotency (caller, app, requestId) là duy nhất', async () => {
    await db.insert(appRun).values(run);
    await expect(db.insert(appRun).values({ ...run, runId: 'run_2' })).rejects.toThrow();
  });

  it('audit: chuỗi hash toàn vẹn, không sửa/xoá được', async () => {
    const at = '2026-10-25T00:00:00.000Z';
    await appendAudit(db, { runId: 'run_1', actor: 'rm01', action: 'run.start', object: 'run_1', at });
    await appendAudit(db, { runId: 'run_1', actor: 'cv02', action: 'review.decide', object: 'X03',
      before: { class: 'C' }, after: { class: 'A' }, reason: 'đọc lại ảnh: ghi /năm', at });
    expect(await verifyAuditChain(db)).toBeNull();
    expect(await dbError(db.execute(sql`UPDATE apps.app_audit_event SET reason = 'x'`))).toMatch(/append-only/);
    expect(await dbError(db.execute(sql`DELETE FROM apps.app_audit_event`))).toMatch(/append-only/);
  });

  it('phát hiện sửa đổi khi vượt trigger (vd quyền DB bị lạm dụng)', async () => {
    await db.execute(sql`ALTER TABLE apps.app_audit_event DISABLE TRIGGER app_audit_no_update`);
    await db.execute(sql`UPDATE apps.app_audit_event SET reason = 'sửa lén' WHERE seq = 2`);
    await db.execute(sql`ALTER TABLE apps.app_audit_event ENABLE TRIGGER app_audit_no_update`);
    expect(await verifyAuditChain(db)).toBe(2);
  });
});
