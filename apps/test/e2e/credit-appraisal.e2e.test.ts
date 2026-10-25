// E2E App credit-appraisal-assist (spec 002 §8) trên Temporal dev server thật:
// API Hono -> workflow TS -> activity LAC Python (tiến trình con) -> Core giả (DU v5 + "AIHub") -> webhook có chữ ký.
// Cần: TEMPORAL_CLI (binary temporal) và LAC_PYTHON (python có package lac[worker]).
import { type ChildProcess, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Client } from '@temporalio/client';
import { temporal } from '@temporalio/proto';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APPS } from '../../src/apps';
import { createApi } from '../../src/platform/api';
import { verifyAuditChain } from '../../src/platform/audit';
import { dataConverter, keyRingFromEnv } from '../../src/platform/codec';
import { CoreClient } from '../../src/platform/core-client';
import type { Db } from '../../src/platform/db';
import { verifySignature } from '../../src/platform/security/hmac';
import { buildActivities } from '../../src/worker';
import { testDb } from '../helpers/db';
import { startFakeCore } from '../helpers/fake-core';
import { localEnv } from '../helpers/temporal';

const ROOT = path.resolve(__dirname, '..', '..');
const LAC_DIR = path.join(ROOT, 'credit-kit', 'lac');
const FIX = path.join(LAC_DIR, 'tests', 'fixtures');
const VEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'credit-kit', 'contracts', 'codec-vectors.json'), 'utf8'));
const KEYS = { APPS_PAYLOAD_KEYS: VEC.keys, APPS_PAYLOAD_KEY_ID: VEC.key_id }; // khoá TEST ONLY
const enabled = !!process.env.TEMPORAL_CLI && !!process.env.LAC_PYTHON;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let env: TestWorkflowEnvironment;
let client: Client;
let db: Db;
let core: Awaited<ReturnType<typeof startFakeCore>>;
let tsWorker: Worker;
let tsRun: Promise<void>;
const pyWorkers: ChildProcess[] = [];
const hooks: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let hookServer: http.Server;
let hookUrl: string;
const TQ = `apps-e2e-${process.pid}`;
const LAC_TQ = `lac-e2e-${process.pid}`;
let branch2Calls: { questions: string; md: string }[] = [];

/** "AIHub" giả: đọc bản trích LAC, trả kết luận trích đúng mã + một kết luận bịa số (phải bị loại). */
function fakeBranch2(questions: string, md: string) {
  branch2Calls.push({ questions, md });
  const fid = (field: string) => md.match(new RegExp(`\\b(F\\d+) ${field.replace('.', '\\.')}:`))?.[1];
  const conflict = md.split('## Mâu thuẫn nội dung')[1]?.match(/^(X\d+) /m)?.[1];
  const profit = fid('net_profit_annual');
  const revenue = fid('net_revenue_annual');
  const only = questions.match(/Chỉ đánh giá lại các kết luận ([K\d, ]+)/)?.[1]?.split(',').map((x) => x.trim());
  const k1 = conflict
    ? { id: 'K1', text: `Lợi nhuận năm 300.000.000 (${profit}) lệch thu nhập khai ${conflict}; cần xác minh kỳ thu nhập.`,
      fields: [profit], conflicts: [conflict], signals: [] }
    : { id: 'K1', text: `Lợi nhuận năm 300.000.000 (${profit}) đủ trả lãi; biên lợi nhuận 0,2 (M-MARGIN).`, fields: [profit], conflicts: [], signals: [] };
  const k2 = { id: 'K2', text: `Doanh thu năm 1,5 tỷ (${revenue}); số vay bằng 0,5333 lần doanh thu (M-LOAN-REVENUE).`,
    fields: [revenue], conflicts: [], signals: [] };
  const bad = { id: 'K9', text: `Doanh thu thực tế khoảng 9,9 tỷ (${revenue}), đề xuất cho vay.`, fields: [revenue], conflicts: [], signals: [] };
  const out = only ? [k1, k2].filter((k) => only.includes(k.id)) : [k1, k2, bad];
  return { content: '```json\n' + JSON.stringify(out) + '\n```' };
}

function startPyWorker(taskQueue: string) {
  const p = spawn(process.env.LAC_PYTHON!, ['-m', 'lac.worker'], { cwd: LAC_DIR, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ...KEYS, TEMPORAL_ADDRESS: env.address, TEMPORAL_NAMESPACE: 'default', LAC_TASK_QUEUE: taskQueue } });
  p.stderr?.on('data', (b) => { if (/Error|Traceback/.test(String(b))) process.stderr.write(`[lac.worker] ${b}`); });
  pyWorkers.push(p);
  return p;
}

async function startTsWorker() {
  tsWorker = await Worker.create({
    connection: env.nativeConnection, namespace: 'default', taskQueue: TQ,
    workflowsPath: path.join(ROOT, 'src', 'workflows.ts'), dataConverter: dataConverter(keyRingFromEnv(KEYS)),
    activities: buildActivities({ core: new CoreClient({ baseUrl: core.url, apiKey: 'core-key' }), db, webhookSecret: 'hook-secret',
      callbackHosts: ['127.0.0.1'], sourceHosts: [], pollMs: 20 }),
  });
  tsRun = tsWorker.run();
}

const makeApi = (lacTaskQueue: string) => createApi({ db, temporal: client, apps: APPS, taskQueue: TQ, callbackHosts: ['127.0.0.1'],
  callers: [{ id: 'LOS', keySha256: sha('los-key'), trustedUserHeaders: true }],
  env: { lacTaskQueue, reviewTimeout: '5 minutes' } });
let api: ReturnType<typeof makeApi>;

const H = (user?: string, roles = 'CREDIT_APPRAISER') => ({ 'content-type': 'application/json', 'x-api-key': 'los-key',
  ...(user ? { 'x-user-id': user, 'x-user-roles': roles } : {}) });
const call = async (a: typeof api, method: string, url: string, body?: unknown, user?: string, roles?: string) => {
  const res = await a.request(url, { method, headers: H(user, roles), body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() as Record<string, any> };
};

const startBody = (requestId: string, opId: string, extra: object = {}) => ({
  requestId, businessRef: { system: 'LOS', type: 'LOAN_APPLICATION', id: requestId },
  context: { product: 'pp-hkd-secured@0.1.0', referenceDate: '2026-10-23', extracted: { coreOperationId: opId }, ...extra },
  review: { mode: 'DELEGATED', makerUserId: 'rm01' },
  callback: { url: hookUrl, events: ['run.started', 'run.review_required', 'run.updated', 'run.completed', 'run.failed'] },
});

async function waitFor(a: typeof api, runId: string, pred: (r: Record<string, any>) => boolean, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = (await call(a, 'GET', `/apps/v1/runs/${runId}`)).json;
    if (pred(r)) return r;
    if (Date.now() - t0 > ms) throw new Error(`hết thời gian chờ run ${runId}: ${JSON.stringify({ s: r.status, p: r.progress, e: r.error })}`);
    await sleep(100);
  }
}

describe.skipIf(!enabled)('E2E credit-appraisal-assist', () => {
  beforeAll(async () => {
    env = await localEnv();
    client = new Client({ connection: env.connection, namespace: 'default', dataConverter: dataConverter(keyRingFromEnv(KEYS)) });
    db = await testDb();
    core = await startFakeCore({ apiKey: 'core-key', respond: (svc, form, files) =>
      svc === 'generate' ? fakeBranch2(form.questions, files['lac-branch2.md'] ?? '') : { content: 'unexpected' } });
    for (const n of ['hkd_cic_spouse_stale', 'hkd_income_x12', 'hkd_baseline']) {
      core.seed(`du_${n}`, JSON.parse(fs.readFileSync(path.join(FIX, `${n}.json`), 'utf8')));
    }
    hookServer = http.createServer(async (req, res) => {
      let body = ''; for await (const c of req) body += c;
      hooks.push({ headers: req.headers, body }); res.writeHead(204); res.end();
    });
    await new Promise<void>((r) => hookServer.listen(0, '127.0.0.1', r));
    hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;
    startPyWorker(LAC_TQ);
    await startTsWorker();
    api = makeApi(LAC_TQ);
  }, 180_000);

  afterAll(async () => {
    for (const p of pyWorkers) p.kill();
    tsWorker?.shutdown(); await tsRun;
    hookServer?.close(); await core?.close(); await env?.teardown();
  });

  it('AC-1: CIC của vợ/chồng -> cổng GĐ1 chặn, PENDING_SUPPLEMENT, không gọi nhánh 2', async () => {
    branch2Calls = [];
    const s = await call(api, 'POST', '/apps/v1/credit-appraisal-assist/runs', startBody('REQ-AC1', 'du_hkd_cic_spouse_stale'));
    expect(s.status).toBe(202);
    const r = await waitFor(api, s.json.runId, (x) => x.status === 'COMPLETED');
    expect(r.outcome).toBe('PENDING_SUPPLEMENT');
    const cl = r.findings.find((f: any) => f.code === 'CHECKLIST-MISSING' && f.message.startsWith('credit_cic_report'));
    expect(cl.message).toMatch(/cần của người vay P1/);
    expect(branch2Calls).toHaveLength(0);
  }, 90_000);

  it('idempotency: cùng requestId -> cùng run', async () => {
    const a = await call(api, 'POST', '/apps/v1/credit-appraisal-assist/runs', startBody('REQ-AC1', 'du_hkd_cic_spouse_stale'));
    expect(a.status).toBe(200);
    expect(a.json.runId).toBe(`run_${sha('LOS|credit-appraisal-assist|REQ-AC1').slice(0, 24)}`);
  });

  it('context sai -> 400 có đường dẫn lỗi; callback host lạ -> 400', async () => {
    const bad = await call(api, 'POST', '/apps/v1/credit-appraisal-assist/runs', { ...startBody('REQ-X', 'x'), context: { product: 'x' } });
    expect(bad.status).toBe(400);
    expect(bad.json.issues.map((i: any) => i.path.join('.'))).toEqual(expect.arrayContaining(['product', 'referenceDate']));
    const cb = await call(api, 'POST', '/apps/v1/credit-appraisal-assist/runs',
      { ...startBody('REQ-Y', 'x'), callback: { url: 'https://evil.example.com/h', events: ['run.completed'] } });
    expect(cb.status).toBe(400);
  });

  it('AC-3/8/9/10/11 + replay: soát, sửa giá trị, chạy lại một phần, ghép, audit, webhook', async () => {
    branch2Calls = [];
    const s = await call(api, 'POST', '/apps/v1/credit-appraisal-assist/runs', startBody('REQ-INC', 'du_hkd_income_x12'));
    const runId = s.json.runId;
    let r = await waitFor(api, runId, (x) => x.status === 'WAITING_REVIEW' && x.openTasks === 2 && x.outcome === 'PROVISIONAL');
    // AC-3: mâu thuẫn thu nhập C1 S2 có trong findings
    expect(r.findings.some((f: any) => f.code === 'R-INCOME' && f.severity === 'S2')).toBe(true);
    const tasks = (await call(api, 'GET', `/apps/v1/runs/${runId}/tasks`)).json as unknown as any[];
    const disc = tasks.find((t) => t.kind === 'DISCREPANCY');
    const link = tasks.find((t) => t.kind === 'PERSON_LINK');

    // AC-11: maker không được tự duyệt; thiếu vai trò cũng bị chặn
    expect((await call(api, 'POST', `/apps/v1/tasks/${encodeURIComponent(link.taskId)}/decision`,
      { action: 'CONFIRM', reason: 'tự duyệt' }, 'rm01')).status).toBe(403);
    expect((await call(api, 'POST', `/apps/v1/tasks/${encodeURIComponent(link.taskId)}/decision`,
      { action: 'CONFIRM', reason: 'xem ảnh' }, 'cv09', 'VIEWER')).status).toBe(403);
    // quyết định sai nghiệp vụ -> 409
    expect((await call(api, 'POST', `/apps/v1/tasks/${encodeURIComponent(disc.taskId)}/decision`,
      { action: 'REQUEST_SUPPLEMENT', reason: 'thử' }, 'cv02')).status).toBe(409);

    expect((await call(api, 'POST', `/apps/v1/tasks/${encodeURIComponent(link.taskId)}/decision`,
      { action: 'CONFIRM', reason: 'chủ GCN đúng người vay' }, 'cv02')).status).toBe(200);
    const handle = client.workflow.getHandle(runId);
    const untilQuery = async (pred: (p: { openTasks: number; message: string }) => boolean) => {
      for (let i = 0; i < 300; i++) { const p = await handle.query<{ openTasks: number; message: string }>('progress'); if (pred(p)) return p; await sleep(100); }
      throw new Error('hết thời gian chờ workflow');
    };
    await untilQuery((p) => p.openTasks === 1 && p.message.startsWith('Còn 1'));

    // khởi động lại worker TS giữa chừng: workflow tiếp tục (replay)
    tsWorker.shutdown(); await tsRun; await startTsWorker();

    // AC-10: đọc lại ảnh đơn vay thấy "/năm" -> sửa kỳ thu nhập -> X# hạ về A -> chỉ K1 (trích X#) chạy lại
    const periodField = branch2Calls[0].md.match(/\b(F\d+) financial_info\.total_income_period:/)![1];
    expect((await call(api, 'POST', `/apps/v1/tasks/${encodeURIComponent(disc.taskId)}/decision`,
      { action: 'CORRECT_VALUE', field: periodField, value: 'ANNUAL', reason: 'ảnh đơn vay ghi /năm (A3)' }, 'cv02')).status).toBe(200);
    r = await waitFor(api, runId, (x) => x.status === 'COMPLETED');
    // tổng: 1 lần đầu + 1 lần chạy lại chỉ cho K1 (xác nhận liên kết người không đổi dữ liệu nào K# trích)
    expect(branch2Calls).toHaveLength(2);
    expect(branch2Calls[1].questions).toMatch(/Chỉ đánh giá lại các kết luận K1 /);

    // AC-9: hết S1, K# không còn vướng S2 -> ELIGIBLE_TO_SUBMIT
    expect(r.outcome).toBe('ELIGIBLE_TO_SUBMIT');
    const res = (await call(api, 'GET', `/apps/v1/runs/${runId}/result`)).json;
    expect(res.conclusions.map((k: any) => k.id), JSON.stringify(res.rejectedConclusions)).toEqual(['K1', 'K2']);
    expect(res.conclusions.every((k: any) => !k.provisional)).toBe(true);
    // AC-8: kết luận bịa số / đề xuất cho vay bị loại
    const k9 = res.rejectedConclusions.find((k: any) => k.id === 'K9');
    expect(k9.reasons.join(' ')).toMatch(/9,9.*không có trong LAC/);
    expect(k9.reasons.join(' ')).toMatch(/đề xuất quyết định/);
    expect(res.trace.lacBuilds).toBe(3); // dựng ban đầu + sau xác nhận liên kết + sau sửa giá trị
    const x = res.lac.discrepancies.find((d: any) => d.rule === 'R-INCOME');
    expect([x.class, x.to_branch2]).toEqual(['A', false]);

    // audit toàn vẹn
    expect(await verifyAuditChain(db)).toBeNull();
    // webhook: đúng thứ tự, đúng chữ ký (webhook gửi sau projection -> chờ tới run.completed)
    const mine = () => hooks.filter((h) => JSON.parse(h.body).runId === runId);
    for (let i = 0; i < 100 && !mine().some((h) => JSON.parse(h.body).type === 'run.completed'); i++) await sleep(100);
    const types = mine().map((h) => JSON.parse(h.body).type);
    expect(types[0]).toBe('run.started');
    expect(types).toContain('run.review_required');
    expect(types.at(-1)).toBe('run.completed');
    for (const h of mine()) {
      expect(verifySignature('hook-secret', String(h.headers['x-dugate-timestamp']), h.body, String(h.headers['x-dugate-signature']))).toBe(true);
    }

    // replay: lịch sử chạy thật replay lại không lỗi nondeterminism; lưu cho test replay offline
    const history = await client.workflow.getHandle(runId).fetchHistory();
    await Worker.runReplayHistory({ workflowsPath: path.join(ROOT, 'src', 'workflows.ts'),
      dataConverter: dataConverter(keyRingFromEnv(KEYS)) }, history, runId);
    if (process.env.RECORD_HISTORIES === '1') {
      const bin = temporal.api.history.v1.History.encode(history).finish();
      fs.writeFileSync(path.join(ROOT, 'src', 'credit-appraisal-assist', 'histories', 'income-x12.history.json'),
        JSON.stringify({ format: 'temporal.api.history.v1.History/protobuf-base64', workflowId: runId,
          data: Buffer.from(bin).toString('base64') }) + '\n');
    }
  }, 180_000);

  it('AC-12: chưa có worker LAC -> run chờ; bật worker -> chạy tiếp và xong', async () => {
    const lateTq = `${LAC_TQ}-late`;
    const late = makeApi(lateTq);
    const s = await call(late, 'POST', '/apps/v1/credit-appraisal-assist/runs',
      { ...startBody('REQ-LATE', 'du_hkd_baseline'), review: { mode: 'NONE', makerUserId: 'rm01' } });
    await sleep(3000);
    const mid = (await call(late, 'GET', `/apps/v1/runs/${s.json.runId}`)).json;
    expect(mid.status).toBe('RUNNING');
    startPyWorker(lateTq);
    const r = await waitFor(late, s.json.runId, (x) => x.status === 'COMPLETED', 90_000);
    expect(r.outcome).toBe('ELIGIBLE_TO_SUBMIT');
  }, 150_000);

  it('huỷ run đang chờ soát', async () => {
    const s = await call(api, 'POST', '/apps/v1/credit-appraisal-assist/runs', startBody('REQ-CANCEL', 'du_hkd_income_x12'));
    await waitFor(api, s.json.runId, (x) => x.status === 'WAITING_REVIEW');
    expect((await call(api, 'POST', `/apps/v1/runs/${s.json.runId}/cancel`)).status).toBe(202);
    const r = await waitFor(api, s.json.runId, (x) => x.status === 'CANCELLED');
    expect(r.status).toBe('CANCELLED');
  }, 90_000);
});
