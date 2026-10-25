import { MockActivityEnvironment } from '@temporalio/testing';
import { ApplicationFailure } from '@temporalio/common';
import { afterEach, describe, expect, it } from 'vitest';
import { type CallCoreResult, createCoreActivities } from '../src/platform/activities/core';
import { CoreClient } from '../src/platform/core-client';
import { startFakeCore } from './helpers/fake-core';

let core: Awaited<ReturnType<typeof startFakeCore>> | undefined;
afterEach(async () => { await core?.close(); core = undefined; });

const input = { runId: 'run_1', stepKey: 'extract:D1', service: 'extract' as const, sub: 'custom',
  params: { schema: '{"type":"object"}' }, fileUrls: [{ url: 'https://ecm.bank.local/d/1' }] };

describe('callCore', () => {
  it('gửi đúng discriminator, file_urls, api key; poll tới khi xong', async () => {
    core = await startFakeCore({ apiKey: 'k1', pollsUntilDone: 3, respond: () => ({ extracted_data: { a: 1 } }) });
    const acts = createCoreActivities(new CoreClient({ baseUrl: core.url, apiKey: 'k1' }), { pollMs: 5 });
    const r = (await new MockActivityEnvironment().run(acts.callCore, input)) as CallCoreResult;
    expect(r.extractedData).toEqual({ a: 1 });
    expect(r.usage.model).toBe('ext:fake');
    const op = [...core.ops.values()][0];
    expect(op.form).toMatchObject({ type: 'custom', schema: '{"type":"object"}' });
    expect(JSON.parse(op.form.file_urls)).toEqual([{ url: 'https://ecm.bank.local/d/1' }]);
    expect(op.key).toBe('run_1:extract:D1');
  });

  it('gọi lại cùng runId:stepKey không tạo Operation mới', async () => {
    core = await startFakeCore();
    const acts = createCoreActivities(new CoreClient({ baseUrl: core.url, apiKey: 'k' }), { pollMs: 5 });
    const a = (await new MockActivityEnvironment().run(acts.callCore, input)) as CallCoreResult;
    const b = (await new MockActivityEnvironment().run(acts.callCore, input)) as CallCoreResult;
    expect(a.operationId).toBe(b.operationId);
    expect(core.ops.size).toBe(1);
  });

  it('4xx là lỗi không thử lại', async () => {
    core = await startFakeCore({ rejectStatus: 400 });
    const acts = createCoreActivities(new CoreClient({ baseUrl: core.url, apiKey: 'k' }), { pollMs: 5 });
    const err = await new MockActivityEnvironment().run(acts.callCore, input).catch((e) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect((err as ApplicationFailure).type).toBe('CoreRequestRejected');
  });

  it('5xx là lỗi thử lại được', async () => {
    core = await startFakeCore({ rejectStatus: 503 });
    const acts = createCoreActivities(new CoreClient({ baseUrl: core.url, apiKey: 'k' }), { pollMs: 5 });
    const err = await new MockActivityEnvironment().run(acts.callCore, input).catch((e) => e);
    expect(err).not.toBeInstanceOf(ApplicationFailure);
    expect(String(err)).toMatch(/Core 503/);
  });

  it('Operation FAILED ở Core -> lỗi không thử lại', async () => {
    core = await startFakeCore({ respond: () => 'FAIL' });
    const acts = createCoreActivities(new CoreClient({ baseUrl: core.url, apiKey: 'k' }), { pollMs: 5 });
    const err = await new MockActivityEnvironment().run(acts.callCore, input).catch((e) => e);
    expect((err as ApplicationFailure).type).toBe('CoreOperationFailed');
  });
});
