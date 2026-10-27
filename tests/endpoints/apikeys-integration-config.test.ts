// tests/endpoints/apikeys-integration-config.test.ts
// T7 — Profile-level (ApiKey) integration config persistence.
// Verifies: secrets encrypted to iv:tag:ciphertext (never plaintext) before
// db.update(); has(key) semantics (updates object contains ONLY sent keys, so
// note/rateLimitPerMin/status etc. are never clobbered); callback validation.
// No real DB — asserts the argument passed to db.update().set().

import { decrypt, encrypt } from '@/lib/crypto';

const dbUpdateSet = jest.fn();
// Stored ciphertext returned by the pre-update SELECT used for secret-preserving
// merges. Tests set this to simulate an existing saved config; default is empty.
const storedRow: { fileAuthConfig: string | null; callbackAuthConfig: string | null } = {
  fileAuthConfig: null,
  callbackAuthConfig: null,
};
jest.mock('@/lib/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([storedRow]) }) }),
    })),
    update: jest.fn(() => ({
      set: (v: unknown) => {
        dbUpdateSet(v);
        return { where: () => ({ returning: () => Promise.resolve([{ id: 'p1', name: 'Profile' }]) }) };
      },
    })),
  },
}));

jest.mock('@/lib/db/schema', () => {
  const proxy = new Proxy({}, { get: (_t, p) => String(p) });
  return { apiKeys: proxy, profileEndpoints: proxy, operations: proxy };
});
jest.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ a }), inArray: () => ({}), desc: () => ({}),
  and: () => ({}), count: () => ({}), max: () => ({}),
}));
jest.mock('@/lib/logger', () => ({ Logger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));
jest.mock('@/lib/auth-guard', () => ({
  requireAdmin: jest.fn().mockResolvedValue({ session: { user: { role: 'ADMIN' } } }),
  requireAuth: jest.fn().mockResolvedValue({ session: { user: { role: 'ADMIN' } } }),
  requireCapability: jest.fn().mockResolvedValue({ session: { user: { id: 'u1', username: 'admin', role: 'ADMIN' } } }),
  requireProfileAccess: jest.fn().mockResolvedValue({ session: { user: { id: 'u1', username: 'admin', role: 'ADMIN' } } }),
  getAssignedProfileIds: jest.fn().mockResolvedValue(null),
}));
// GET decides whether to expose non-secret integration metadata via this resolver.
jest.mock('@/lib/rbac/resolve', () => ({ roleHasCapability: jest.fn().mockResolvedValue(true) }));
// Real auth-config parser without loading the heavy downloader module.
jest.mock('@/lib/file-url-downloader', () => ({
  parseFileUrlAuthConfig: require('@/lib/auth-config/parse').parseFileUrlAuthConfig,
}));
const mockIsAllowed = jest.fn((_url: string, _allowedOrigins: string) => true);
jest.mock('@/lib/pipelines/processors/http-client', () => ({
  assertSafeUrl: jest.fn(async (u: string) => u),
  isUrlOriginAllowed: (...a: unknown[]) => mockIsAllowed(...(a as [string, string])),
}));

import { PUT } from '@/app/api/internal/apikeys/route';

const put = (body: unknown) => PUT({ json: async () => body } as never);

describe('apikeys route — Profile integration config (T7)', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'unit-test-encryption-key-32chars!';
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAllowed.mockReturnValue(true);
    storedRow.fileAuthConfig = null;
    storedRow.callbackAuthConfig = null;
  });

  it('encrypts fileAuthConfig to iv:tag:ciphertext and never stores plaintext', async () => {
    const res = await put({ id: 'p1', fileAuthConfig: { type: 'bearer', token: 'super-secret-token' } });
    expect(res.status).toBe(200);

    const updates = dbUpdateSet.mock.calls[0][0] as Record<string, string>;
    // has() semantics: ONLY the sent key is present.
    expect(Object.keys(updates)).toEqual(['fileAuthConfig']);
    expect(updates.fileAuthConfig).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(updates.fileAuthConfig).not.toContain('super-secret-token');
    expect(JSON.parse(decrypt(updates.fileAuthConfig))).toEqual({ type: 'bearer', token: 'super-secret-token' });
  });

  it('encrypts callbackAuthConfig the same way', async () => {
    const res = await put({ id: 'p1', callbackAuthConfig: { type: 'bearer', token: 'cb-secret' } });
    expect(res.status).toBe(200);
    const updates = dbUpdateSet.mock.calls[0][0] as Record<string, string>;
    expect(Object.keys(updates)).toEqual(['callbackAuthConfig']);
    expect(updates.callbackAuthConfig).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(updates.callbackAuthConfig).not.toContain('cb-secret');
  });

  it('does not clobber unrelated fields: only sent keys reach db.update (has semantics)', async () => {
    await put({ id: 'p1', note: 'a note', rateLimitPerMin: 50 });
    const updates = dbUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(updates).toEqual({ note: 'a note', rateLimitPerMin: 50 });
    // No integration-config keys leaked in.
    expect(updates).not.toHaveProperty('fileAuthConfig');
    expect(updates).not.toHaveProperty('callbackUrl');
  });

  it('clears fileAuthConfig with null (no encryption)', async () => {
    await put({ id: 'p1', fileAuthConfig: null });
    const updates = dbUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(updates).toEqual({ fileAuthConfig: null });
  });

  it('rejects an invalid callbackPayload mode with 400', async () => {
    const res = await put({ id: 'p1', callbackPayload: 'BOGUS' });
    expect(res.status).toBe(400);
    expect(dbUpdateSet).not.toHaveBeenCalled();
  });

  it('accepts callbackPayload WITH_RESULT and null', async () => {
    await put({ id: 'p1', callbackPayload: 'WITH_RESULT' });
    expect(dbUpdateSet.mock.calls[0][0]).toEqual({ callbackPayload: 'WITH_RESULT' });
    dbUpdateSet.mockClear();
    await put({ id: 'p1', callbackPayload: null });
    expect(dbUpdateSet.mock.calls[0][0]).toEqual({ callbackPayload: null });
  });

  it('ignores legacy callback URL and lock fields while persisting the Profile payload mode', async () => {
    await put({
      id: 'p1',
      callbackPayload: 'WITH_RESULT',
      callbackUrl: 'https://legacy.test/callback',
      callbackUrlLocked: true,
    });
    expect(dbUpdateSet.mock.calls[0][0]).toEqual({ callbackPayload: 'WITH_RESULT' });
  });

  // Review item 2: 'query' auth puts the credential in the URL, which leaks into
  // the receiver's logs — forbidden for callbacks, but still fine for downloads.
  it("rejects callbackAuthConfig of type 'query' (credential would leak to receiver logs)", async () => {
    const res = await put({ id: 'p1', callbackAuthConfig: { type: 'query', query_key: 'apikey', query_value: 'v' } });
    expect(res.status).toBe(400);
    expect(dbUpdateSet).not.toHaveBeenCalled();
  });

  it("still accepts fileAuthConfig of type 'query' (query auth is valid for downloads)", async () => {
    const res = await put({ id: 'p1', fileAuthConfig: { type: 'query', query_key: 'apikey', query_value: 'v' } });
    expect(res.status).toBe(200);
    const updates = dbUpdateSet.mock.calls[0][0] as Record<string, string>;
    expect(Object.keys(updates)).toEqual(['fileAuthConfig']);
    expect(JSON.parse(decrypt(updates.fileAuthConfig))).toEqual({ type: 'query', query_key: 'apikey', query_value: 'v' });
  });

  it('preserves the stored client secret when only a non-secret OAuth2 field changes', async () => {
    // Existing saved OAuth2 config with an inline client secret.
    const stored = {
      type: 'oauth2_client_credentials',
      token_url: 'https://old.example/token',
      client_id: 'client-123',
      client_secret: 'super-secret-value',
      token_body_format: 'json',
      token_auth_style: 'body',
    };
    storedRow.fileAuthConfig = encrypt(JSON.stringify(stored));

    // Client edits only Token URL and sends NO secret (blanked on reload).
    const res = await put({
      id: 'p1',
      fileAuthConfig: {
        type: 'oauth2_client_credentials',
        token_url: 'https://new.example/token',
        client_id: 'client-123',
        token_body_format: 'json',
        token_auth_style: 'body',
      },
    });
    expect(res.status).toBe(200);
    const updates = dbUpdateSet.mock.calls[0][0] as Record<string, string>;
    const saved = JSON.parse(decrypt(updates.fileAuthConfig));
    expect(saved.token_url).toBe('https://new.example/token');
    // The previously stored secret is preserved without the client re-sending it.
    expect(saved.client_secret).toBe('super-secret-value');
  });

  it('carries forward non-secret fields the client omitted', async () => {
    const stored = {
      type: 'oauth2_client_credentials',
      token_url: 'https://idp.example/token',
      client_id: 'client-123',
      client_secret: 'super-secret-value',
      scope: 'file.read',
      audience: 'dugate',
      token_body_format: 'json',
      token_auth_style: 'body',
    };
    storedRow.fileAuthConfig = encrypt(JSON.stringify(stored));

    // A caller that only re-sends the secret must not wipe token_url / scope / audience.
    const res = await put({
      id: 'p1',
      fileAuthConfig: { type: 'oauth2_client_credentials', client_secret: 'rotated-secret' },
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(decrypt((dbUpdateSet.mock.calls[0][0] as Record<string, string>).fileAuthConfig));
    expect(saved.token_url).toBe('https://idp.example/token');
    expect(saved.client_id).toBe('client-123');
    expect(saved.scope).toBe('file.read');
    expect(saved.audience).toBe('dugate');
    expect(saved.client_secret).toBe('rotated-secret');
  });

  it('deletes a null-valued field even when there is no stored config to merge', async () => {
    // The null-stripping must happen on every path, including the early return taken when
    // the column is empty; otherwise parseFileUrlAuthConfig sees `scope: null` and 400s.
    storedRow.fileAuthConfig = null;
    const res = await put({
      id: 'p1',
      fileAuthConfig: {
        type: 'oauth2_client_credentials',
        token_url: 'https://idp.example/token',
        client_id: 'client-123',
        client_secret: 'brand-new',
        scope: null,
      },
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(decrypt((dbUpdateSet.mock.calls[0][0] as Record<string, string>).fileAuthConfig));
    expect(saved.scope).toBeUndefined();
    expect(saved.client_secret).toBe('brand-new');
  });

  it('clears an optional non-secret field when the client sends an explicit null', async () => {
    const stored = {
      type: 'oauth2_client_credentials',
      token_url: 'https://idp.example/token',
      client_id: 'client-123',
      client_secret: 'super-secret-value',
      scope: 'file.read',
      token_body_format: 'json',
      token_auth_style: 'body',
    };
    storedRow.fileAuthConfig = encrypt(JSON.stringify(stored));

    const res = await put({
      id: 'p1',
      fileAuthConfig: {
        type: 'oauth2_client_credentials',
        token_url: 'https://idp.example/token',
        client_id: 'client-123',
        scope: null,
        token_body_format: 'json',
        token_auth_style: 'body',
      },
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(decrypt((dbUpdateSet.mock.calls[0][0] as Record<string, string>).fileAuthConfig));
    expect(saved.scope).toBeUndefined();
    expect(saved.client_secret).toBe('super-secret-value');
  });

  it('preserves a stored Vault secret reference on a non-secret edit', async () => {
    const stored = {
      type: 'oauth2_client_credentials',
      token_url: 'https://old.example/token',
      client_id: 'client-123',
      client_secret_ref: 'eda/rpa/dugate/oauth#client_secret',
      token_body_format: 'json',
      token_auth_style: 'body',
    };
    storedRow.fileAuthConfig = encrypt(JSON.stringify(stored));

    const res = await put({
      id: 'p1',
      fileAuthConfig: {
        type: 'oauth2_client_credentials',
        token_url: 'https://old.example/token',
        client_id: 'client-999',
        token_body_format: 'json',
        token_auth_style: 'body',
      },
    });
    expect(res.status).toBe(200);
    const updates = dbUpdateSet.mock.calls[0][0] as Record<string, string>;
    const saved = JSON.parse(decrypt(updates.fileAuthConfig));
    expect(saved.client_id).toBe('client-999');
    expect(saved.client_secret_ref).toBe('eda/rpa/dugate/oauth#client_secret');
    expect(saved.client_secret).toBeUndefined();
    // The Vault path (a permission-guarded pointer, not the secret) is returned in
    // FULL in the response metadata so the UI can display and round-trip it.
    const body = await res.json();
    expect(body.apiKey.fileAuthMetadata.client_secret_ref).toBe('eda/rpa/dugate/oauth#client_secret');
  });

  it('returns masked non-secret metadata (first 3 + last 3) after saving an inline secret', async () => {
    const res = await put({
      id: 'p1',
      fileAuthConfig: {
        type: 'oauth2_client_credentials',
        token_url: 'https://new.example/token',
        client_id: 'client-123',
        client_secret: 'sktopsecretvaluet11',
        token_body_format: 'json',
        token_auth_style: 'body',
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const meta = body.apiKey.fileAuthMetadata;
    expect(meta.client_secret_preview).toBe('skt•••••••••••••••t11');
    // Never leak the raw secret in the response.
    expect(JSON.stringify(body)).not.toContain('sktopsecretvaluet11');
  });
});
