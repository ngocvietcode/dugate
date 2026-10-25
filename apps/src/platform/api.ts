// API /apps/v1/* — Workflow Service Contract (LAYERED_ARCHITECTURE §5.1).
import crypto from 'node:crypto';
import { type Client, WorkflowUpdateFailedError } from '@temporalio/client';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDef, AppEnv } from '../apps';
import { type Actor, ReviewDecisionBody, type RunView, StartRunRequest } from './contract';
import type { Db } from './db';
import { appRun, reviewTask } from './db/schema';
import { assertAllowedCallback } from './security/callback-url';
import { submitDecision } from './workflow-kit';

export interface Caller { id: string; keySha256: string; trustedUserHeaders: boolean }
export interface ApiDeps {
  db: Db; temporal: Client; apps: Record<string, AppDef>; callers: Caller[]; taskQueue: string; callbackHosts: string[];
  env: AppEnv;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const problem = (status: number, title: string, detail: string) => ({ type: `https://dugate.vn/apps/errors/${status}`, title, status, detail });

export function createApi(d: ApiDeps) {
  const api = new Hono<{ Variables: { caller: Caller } }>().basePath('/apps/v1');

  api.use('*', async (c, next) => {
    const key = c.req.header('x-api-key');
    const h = key ? Buffer.from(sha256(key)) : null;
    const caller = h ? d.callers.find((x) => x.keySha256.length === h.length && crypto.timingSafeEqual(Buffer.from(x.keySha256), h)) : undefined;
    if (!caller) return c.json(problem(401, 'Unauthorized', 'thiếu hoặc sai x-api-key'), 401);
    c.set('caller', caller);
    await next();
  });

  const actorOf = (c: { req: { header(n: string): string | undefined } }, caller: Caller): Actor | null => {
    if (!caller.trustedUserHeaders) return null; // OIDC trực tiếp: chưa hỗ trợ (v1)
    const userId = c.req.header('x-user-id');
    return userId ? { userId, roles: (c.req.header('x-user-roles') ?? '').split(',').map((s) => s.trim()).filter(Boolean) } : null;
  };

  const loadRun = async (runId: string, caller: Caller) => {
    const [r] = await d.db.select().from(appRun).where(and(eq(appRun.runId, runId), eq(appRun.caller, caller.id)));
    return r; // không lộ việc run của caller khác có tồn tại hay không
  };

  const view = (r: typeof appRun.$inferSelect): RunView => ({
    runId: r.runId, app: r.app, appVersion: r.appVersion, businessRef: r.businessRef as RunView['businessRef'],
    status: r.status as RunView['status'], outcome: r.outcome,
    progress: { percent: r.progressPercent, message: r.progressMessage }, findings: r.findings as RunView['findings'],
    openTasks: r.openTasks, error: r.error as RunView['error'], createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  });

  api.get('/', (c) => c.json(Object.values(d.apps).map((a) => ({ name: a.name, version: a.version, outcomes: a.outcomes,
    context: z.toJSONSchema(a.context, { io: 'input' }) }))));

  api.post('/:app/runs', async (c) => {
    const caller = c.get('caller');
    const app = d.apps[c.req.param('app')];
    if (!app) return c.json(problem(404, 'Not Found', 'App không tồn tại'), 404);
    const body = StartRunRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ ...problem(400, 'Invalid Request', 'request không hợp lệ'), issues: body.error.issues }, 400);
    const ctx = app.context.safeParse(body.data.context);
    if (!ctx.success) return c.json({ ...problem(400, 'Invalid Context', 'context không hợp lệ'), issues: ctx.error.issues }, 400);
    if (body.data.callback) {
      try { assertAllowedCallback(body.data.callback.url, d.callbackHosts); }
      catch (e) { return c.json(problem(400, 'Invalid Callback', (e as Error).message), 400); }
    }
    const runId = `run_${sha256(`${caller.id}|${app.name}|${body.data.requestId}`).slice(0, 24)}`;
    const inserted = await d.db.insert(appRun).values({
      runId, app: app.name, appVersion: app.version, caller: caller.id, requestId: body.data.requestId,
      businessRef: body.data.businessRef, makerUserId: body.data.review.makerUserId, reviewMode: body.data.review.mode,
      callback: body.data.callback ?? null, status: 'RUNNING', progressMessage: 'Đã tiếp nhận',
    }).onConflictDoNothing().returning({ runId: appRun.runId });
    if (!inserted.length) {
      const existing = await loadRun(runId, caller);
      return c.json(view(existing!), 200); // idempotent: cùng requestId -> cùng run
    }
    try {
      await d.temporal.workflow.start(app.workflowType, {
        taskQueue: d.taskQueue, workflowId: runId, workflowIdConflictPolicy: 'USE_EXISTING',
        args: [app.buildInput(body.data, ctx.data, runId, caller.id, d.env)],
      });
    } catch (e) {
      await d.db.update(appRun).set({ status: 'FAILED', error: { code: 'START_FAILED', message: (e as Error).message } })
        .where(eq(appRun.runId, runId));
      return c.json(problem(503, 'Unavailable', 'không khởi chạy được workflow'), 503);
    }
    const r = await loadRun(runId, caller);
    return c.json(view(r!), 202, { Location: `/apps/v1/runs/${runId}` });
  });

  api.get('/runs/:runId', async (c) => {
    const r = await loadRun(c.req.param('runId'), c.get('caller'));
    return r ? c.json(view(r)) : c.json(problem(404, 'Not Found', 'run không tồn tại'), 404);
  });

  api.get('/runs/:runId/result', async (c) => {
    const r = await loadRun(c.req.param('runId'), c.get('caller'));
    if (!r) return c.json(problem(404, 'Not Found', 'run không tồn tại'), 404);
    if (r.status !== 'COMPLETED') return c.json(problem(409, 'Not Ready', `run đang ${r.status}`), 409);
    return c.json(r.result);
  });

  api.get('/runs/:runId/tasks', async (c) => {
    const r = await loadRun(c.req.param('runId'), c.get('caller'));
    if (!r) return c.json(problem(404, 'Not Found', 'run không tồn tại'), 404);
    const rows = await d.db.select().from(reviewTask).where(eq(reviewTask.runId, r.runId));
    return c.json(rows.map((t) => ({ taskId: t.taskId, runId: t.runId, kind: t.kind, ref: t.ref, severity: t.severity,
      title: t.title, status: t.status })));
  });

  api.post('/tasks/:taskId/decision', async (c) => {
    const caller = c.get('caller');
    const actor = actorOf(c, caller);
    if (!actor) return c.json(problem(403, 'Forbidden', 'cần danh tính người dùng do hệ thống tin cậy chuyển tới'), 403);
    const [t] = await d.db.select().from(reviewTask).where(eq(reviewTask.taskId, c.req.param('taskId')));
    const r = t && (await loadRun(t.runId, caller));
    if (!r) return c.json(problem(404, 'Not Found', 'task không tồn tại'), 404);
    const body = ReviewDecisionBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ ...problem(400, 'Invalid Decision', 'quyết định không hợp lệ'), issues: body.error.issues }, 400);
    try {
      const ack = await d.temporal.workflow.getHandle(r.runId).executeUpdate(submitDecision, {
        args: [{ ...body.data, taskId: t.taskId, actor, at: new Date().toISOString() }] });
      return c.json(ack);
    } catch (e) {
      if (e instanceof WorkflowUpdateFailedError) {
        const msg = e.cause?.message ?? e.message;
        const forbidden = /maker-checker|vai trò|người thực hiện/.test(msg);
        return c.json(problem(forbidden ? 403 : 409, forbidden ? 'Forbidden' : 'Conflict', msg), forbidden ? 403 : 409);
      }
      throw e;
    }
  });

  api.post('/runs/:runId/cancel', async (c) => {
    const r = await loadRun(c.req.param('runId'), c.get('caller'));
    if (!r) return c.json(problem(404, 'Not Found', 'run không tồn tại'), 404);
    await d.temporal.workflow.getHandle(r.runId).cancel();
    return c.json({ runId: r.runId, status: 'CANCELLING' }, 202);
  });

  return api;
}
