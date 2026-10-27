// tests/secrets/vault-provider.test.ts
import { VaultSecretProvider } from '@/lib/secrets/vault-provider';

// No path prefix: the connector path is used VERBATIM within the mount.
const CFG = {
  addr: 'https://vault.example',
  roleId: 'role-1',
  secretId: 'secret-1',
  mount: 'secret',
  namespace: '',
  ttlMs: 60_000,
  staleMs: 600_000,
  timeoutMs: 5_000,
  renewSkewMs: 30_000,
};

function loginResponse(token = 'tok-1', lease = 3600) {
  return { ok: true, status: 200, json: async () => ({ auth: { client_token: token, lease_duration: lease } }), text: async () => '' };
}
function kvResponse(data: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ data: { data } }), text: async () => '' };
}

describe('VaultSecretProvider', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('logs in via AppRole then reads KV v2 at the VERBATIM path (default mount)', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(kvResponse({ api_key: 'sk-live-123' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new VaultSecretProvider(CFG);
    const val = await p.getSecret('eda/rpa/dugate/aihub');
    expect(val).toBe('sk-live-123');

    expect(fetchMock.mock.calls[0][0]).toBe('https://vault.example/v1/auth/approle/login');
    // path used verbatim under default mount 'secret' — no hidden prefix
    expect(fetchMock.mock.calls[1][0]).toBe('https://vault.example/v1/secret/data/eda/rpa/dugate/aihub');
  });

  it('supports explicit #field and default api_key', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(kvResponse({ 'ext-doc-layout': 'tok-xyz', api_key: 'nope' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new VaultSecretProvider(CFG);
    expect(await p.getSecret('eda/rpa/dugate/agent-toolkit#ext-doc-layout')).toBe('tok-xyz');
    expect(fetchMock.mock.calls[1][0]).toBe('https://vault.example/v1/secret/data/eda/rpa/dugate/agent-toolkit');
  });

  it('caches value within TTL (no second network read)', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(kvResponse({ api_key: 'v1' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new VaultSecretProvider(CFG);
    await p.getSecret('a/b/x');
    await p.getSecret('a/b/x');
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 login + 1 read; second served from cache
  });

  it('single-flights concurrent gets for the same ref', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(kvResponse({ api_key: 'v1' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new VaultSecretProvider(CFG);
    const [a, b] = await Promise.all([p.getSecret('a/b/x'), p.getSecret('a/b/x')]);
    expect(a).toBe('v1');
    expect(b).toBe('v1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-logs in once on 403 then retries the read', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(loginResponse('tok-expired'))
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}), text: async () => 'denied' })
      .mockResolvedValueOnce(loginResponse('tok-fresh'))
      .mockResolvedValueOnce(kvResponse({ api_key: 'sk-after-relogin' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new VaultSecretProvider(CFG);
    expect(await p.getSecret('a/b/x')).toBe('sk-after-relogin');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('mount override (mount:path) uses a different KV mount', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(kvResponse({ api_key: 'sk-mnt' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new VaultSecretProvider(CFG);
    expect(await p.getSecret('kv-aihub:eda/aihub/shared#api_key')).toBe('sk-mnt');
    expect(fetchMock.mock.calls[1][0]).toBe('https://vault.example/v1/kv-aihub/data/eda/aihub/shared');
  });

  it('tolerates a leading slash (stripped, used verbatim)', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(kvResponse({ api_key: 'sk-slash' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new VaultSecretProvider(CFG);
    expect(await p.getSecret('/eda/rpa/dugate/aihub#api_key')).toBe('sk-slash');
    expect(fetchMock.mock.calls[1][0]).toBe('https://vault.example/v1/secret/data/eda/rpa/dugate/aihub');
  });

  it('testResolve returns ok:false with message when field missing', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(kvResponse({ other: 'x' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new VaultSecretProvider(CFG);
    const res = await p.testResolve('a/b/x');
    expect(res.ok).toBe(false);
  });
});
