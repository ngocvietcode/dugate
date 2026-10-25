import path from 'node:path';
import { Worker } from '@temporalio/worker';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { WorkflowUpdateFailedError } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { progressQuery, submitDecision } from '../src/platform/workflow-kit';
import { localEnv } from './helpers/temporal';

let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;
const TQ = 'wk-test';

beforeAll(async () => {
  env = await localEnv();
  worker = await Worker.create({ connection: env.nativeConnection, taskQueue: TQ,
    workflowsPath: path.join(__dirname, 'workflows', 'review-probe.workflow.ts') });
  running = worker.run();
});
afterAll(async () => { worker?.shutdown(); await running; await env?.teardown(); });

const at = '2026-10-25T00:00:00Z';
const checker = { userId: 'cv02', roles: ['CREDIT_APPRAISER'] };

describe('workflow-kit: ReviewInbox', () => {
  it('nhận quyết định hợp lệ; từ chối maker, thiếu role, task không mở', async () => {
    const h = await env.client.workflow.start('reviewProbe', { taskQueue: TQ, workflowId: `wk-${Date.now()}`,
      args: [{ maker: 'rm01', tasks: ['t1', 't2'], timeout: '1 minute' }] });
    const reject = async (d: object) => {
      const e = await h.executeUpdate(submitDecision, { args: [{ taskId: 't1', action: 'CONFIRM', reason: 'ok ok', at, actor: checker, ...d }] })
        .catch((x) => x);
      expect(e).toBeInstanceOf(WorkflowUpdateFailedError);
      return String((e as WorkflowUpdateFailedError).cause?.message);
    };
    expect(await reject({ actor: { userId: 'rm01', roles: ['CREDIT_APPRAISER'] } })).toMatch(/maker-checker/);
    expect(await reject({ actor: { userId: 'x', roles: ['VIEWER'] } })).toMatch(/thiếu vai trò/);
    expect(await reject({ taskId: 'zzz' })).toMatch(/không mở/);
    const ack = await h.executeUpdate(submitDecision, { args: [{ taskId: 't1', action: 'CONFIRM', reason: 'đã xem ảnh', at, actor: checker }] });
    expect(ack.accepted).toBe(true);
    expect((await h.query(progressQuery)).openTasks).toBe(1);
    await h.executeUpdate(submitDecision, { args: [{ taskId: 't2', action: 'RECLASSIFY', newClass: 'A', reason: 'ảnh ghi /năm', at, actor: checker }] });
    expect(await h.result()).toEqual(['t1:CONFIRM:cv02', 't2:RECLASSIFY:cv02']);
  });

  it('hết hạn chờ soát -> TIMEOUT', async () => {
    const h = await env.client.workflow.start('reviewProbe', { taskQueue: TQ, workflowId: `wk-to-${Date.now()}`,
      args: [{ maker: 'rm01', tasks: ['t1'], timeout: '2 seconds' }] });
    expect(await h.result()).toEqual(['TIMEOUT']);
  });
});
