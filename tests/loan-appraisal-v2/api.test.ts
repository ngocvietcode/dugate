import { ApiError, cancelOperation, getOperation, submitWorkflow } from '@/app/loan-appraisal-v2/lib/api';

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;
let fetchMock: FetchMock;

function reply(status: number, body: unknown, json = true): void {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: json ? async () => body : async () => { throw new Error('not json'); },
  } as unknown as Response);
}

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: FetchMock }).fetch = fetchMock;
});

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try { await promise; return 'ok'; } catch (e) { return e instanceof ApiError ? e.kind : 'other'; }
}

describe('submitWorkflow', () => {
  const file = new Blob(['x'], { type: 'application/pdf' }) as unknown as File;

  it('posts FormData with the contract fields and X-API-Key', async () => {
    reply(200, { name: 'operations/abc12345' });
    const id = await submitWorkflow([file], 'key', 'hkd-loan', 'FAST');
    expect(id).toBe('abc12345');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/docs/workflows');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'X-API-Key': 'key' });
    const form = init?.body as FormData;
    expect(form.get('process')).toBe('loan-appraisal');
    expect(form.get('product_code')).toBe('hkd-loan');
    expect(form.get('flow')).toBe('FAST');
    expect(form.getAll('files[]')).toHaveLength(1);
    expect(form.get('stop_after_intake')).toBe('false');
  });

  it('sends stop_after_intake=true only when requested', async () => {
    reply(200, { name: 'operations/abc12345' });
    await submitWorkflow([file], 'key', 'hkd-loan', 'FAST', undefined, true);
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get('stop_after_intake')).toBe('true');
  });

  it('omits lac_mode by default and sends it only when not off', async () => {
    reply(200, { name: 'operations/abc12345' });
    await submitWorkflow([file], 'key', 'hkd-loan', 'FAST');
    // Không gửi khi off: Profile có thể khoá lac_mode, gửi giá trị bị từ chối.
    expect((fetchMock.mock.calls[0][1]?.body as FormData).has('lac_mode')).toBe(false);
    reply(200, { name: 'operations/abc12345' });
    await submitWorkflow([file], 'key', 'hkd-loan', 'FAST', undefined, false, 'on');
    expect((fetchMock.mock.calls[1][1]?.body as FormData).get('lac_mode')).toBe('on');
  });

  it('falls back to id and reports missing id', async () => {
    reply(200, { id: 'zzz99999' });
    expect(await submitWorkflow([file], undefined, 'hkd-loan', undefined)).toBe('zzz99999');
    reply(200, {});
    expect(await kindOf(submitWorkflow([file], 'k', 'hkd-loan', 'FULL'))).toBe('http');
  });

  it('maps errors', async () => {
    reply(401, { detail: 'nope' });
    expect(await kindOf(submitWorkflow([file], 'k', 'p', 'FULL'))).toBe('forbidden');
    reply(500, { detail: 'boom' });
    await expect(submitWorkflow([file], 'k', 'p', 'FULL')).rejects.toThrow('boom');
    reply(502, null, false);
    await expect(submitWorkflow([file], 'k', 'p', 'FULL')).rejects.toThrow('API Error 502');
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await kindOf(submitWorkflow([file], 'k', 'p', 'FULL'))).toBe('network');
    expect(await kindOf(submitWorkflow([], 'k', 'p', 'FULL'))).toBe('http');
  });
});

describe('getOperation', () => {
  it('builds compact and full URLs with encoded id', async () => {
    reply(200, { done: false });
    await getOperation('a/b', { apiKey: 'k', compact: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/operations/a%2Fb?view=compact');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ 'X-API-Key': 'k' });
    reply(200, { done: false });
    await getOperation('abc12345');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/operations/abc12345');
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({});
  });

  it('maps 401/403/404/5xx/non-JSON', async () => {
    reply(401, {});
    expect(await kindOf(getOperation('x'))).toBe('forbidden');
    reply(403, {});
    expect(await kindOf(getOperation('x'))).toBe('forbidden');
    reply(404, {});
    expect(await kindOf(getOperation('x'))).toBe('not-found');
    reply(500, { error: 'db' });
    await expect(getOperation('x')).rejects.toThrow('db');
    reply(200, null, false);
    expect(await kindOf(getOperation('x'))).toBe('invalid-json');
  });
});

describe('cancelOperation', () => {
  it('POSTs to the cancel endpoint and returns the body', async () => {
    reply(200, { metadata: { state: 'CANCELLED' } });
    const body = await cancelOperation('abc12345', 'k');
    expect(body).toEqual({ metadata: { state: 'CANCELLED' } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/operations/abc12345/cancel');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('maps 409/401/404/500', async () => {
    reply(409, {});
    expect(await kindOf(cancelOperation('x'))).toBe('already-done');
    reply(403, {});
    expect(await kindOf(cancelOperation('x'))).toBe('forbidden');
    reply(404, {});
    expect(await kindOf(cancelOperation('x'))).toBe('not-found');
    reply(500, { detail: 'oops' });
    await expect(cancelOperation('x')).rejects.toThrow('oops');
  });
});
