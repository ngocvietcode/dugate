import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApplicationFailure } from '@temporalio/common';
import { MockActivityEnvironment } from '@temporalio/testing';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProjectionActivities } from '../src/platform/activities/projection';
import { createWebhookActivities } from '../src/platform/activities/webhook';
import { verifyAuditChain } from '../src/platform/audit';
import type { RunEvent } from '../src/platform/contract';
import type { Db } from '../src/platform/db';
import { appRun, reviewTask } from '../src/platform/db/schema';
import { verifySignature } from '../src/platform/security/hmac';
import { testDb } from './helpers/db';

let db: Db;
beforeAll(async () => {
  db = await testDb();
  await db.insert(appRun).values({ runId: 'r1', app: 'a', appVersion: '1', caller: 'LOS', requestId: 'q1',
    businessRef: { system: 'LOS', type: 'T', id: '1' }, makerUserId: 'rm', reviewMode: 'DELEGATED', status: 'RUNNING' });
});

describe('projection', () => {
  it('cập nhật run, đồng bộ task, đóng task, ghi audit', async () => {
    const p = createProjectionActivities(db);
    await p.updateRun('r1', { status: 'WAITING_REVIEW', progress: { percent: 60, message: 'chờ soát' } });
    const tasks = [{ taskId: 't1', runId: 'r1', kind: 'DISCREPANCY' as const, ref: 'X01', severity: 'S1', title: 'a' },
      { taskId: 't2', runId: 'r1', kind: 'DISCREPANCY' as const, ref: 'X02', severity: 'S2', title: 'b' }];
    await p.syncTasks('r1', tasks);
    await p.syncTasks('r1', tasks); // gọi lại không nhân đôi
    let [run] = await db.select().from(appRun).where(eq(appRun.runId, 'r1'));
    expect([run.status, run.progressPercent, run.openTasks]).toEqual(['WAITING_REVIEW', 60, 2]);
    await p.closeTask('r1', 't1', 'cv02', { action: 'CONFIRM' });
    [run] = await db.select().from(appRun).where(eq(appRun.runId, 'r1'));
    expect(run.openTasks).toBe(1);
    const [t1] = await db.select().from(reviewTask).where(eq(reviewTask.taskId, 't1'));
    expect([t1.status, t1.decidedBy]).toEqual(['DONE', 'cv02']);
    await p.audit({ runId: 'r1', actor: 'cv02', action: 'review.decide', object: 'X01', at: new Date().toISOString() });
    expect(await verifyAuditChain(db)).toBeNull();
  });
});

const event: RunEvent = { type: 'run.completed', runId: 'r1', app: 'a', businessRef: { system: 'LOS', type: 'T', id: '1' },
  status: 'COMPLETED', outcome: 'ELIGIBLE_TO_SUBMIT', at: '2026-10-25T00:00:00Z' };

async function receiver(status = 200) {
  const got: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const s = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    got.push({ headers: req.headers, body }); res.writeHead(status); res.end();
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/hook`, got, close: () => s.close() };
}

describe('webhook', () => {
  it('ký HMAC, bên nhận kiểm được', async () => {
    const r = await receiver();
    const w = createWebhookActivities({ secret: 's3cret', allowedHosts: ['127.0.0.1'] });
    await new MockActivityEnvironment().run(w.deliverWebhook, { url: r.url, event, eventId: 'r1:run.completed:1' });
    const h = r.got[0].headers;
    expect(verifySignature('s3cret', String(h['x-dugate-timestamp']), r.got[0].body, String(h['x-dugate-signature']))).toBe(true);
    expect(verifySignature('khac', String(h['x-dugate-timestamp']), r.got[0].body, String(h['x-dugate-signature']))).toBe(false);
    expect(h['x-dugate-event-id']).toBe('r1:run.completed:1');
    r.close();
  });

  it('host chưa đăng ký bị chặn, không gửi', async () => {
    const r = await receiver();
    const w = createWebhookActivities({ secret: 's', allowedHosts: ['esb.bank.local'] });
    const err = await new MockActivityEnvironment().run(w.deliverWebhook, { url: r.url, event, eventId: 'e' }).catch((e) => e);
    expect((err as ApplicationFailure).type).toBe('CallbackNotAllowed');
    expect(r.got).toHaveLength(0);
    r.close();
  });

  it('4xx không thử lại, 5xx thử lại', async () => {
    const r4 = await receiver(410);
    const w = createWebhookActivities({ secret: 's', allowedHosts: ['127.0.0.1'] });
    const e4 = await new MockActivityEnvironment().run(w.deliverWebhook, { url: r4.url, event, eventId: 'e' }).catch((e) => e);
    expect((e4 as ApplicationFailure).nonRetryable).toBe(true);
    const r5 = await receiver(503);
    const e5 = await new MockActivityEnvironment().run(w.deliverWebhook, { url: r5.url, event, eventId: 'e' }).catch((e) => e);
    expect(e5).not.toBeInstanceOf(ApplicationFailure);
    r4.close(); r5.close();
  });
});
