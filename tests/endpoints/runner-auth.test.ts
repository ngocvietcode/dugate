// tests/endpoints/runner-auth.test.ts
// Unit tests for API key authentication in the runner layer.
// Verifies that invalid/revoked/suspended keys are properly rejected (Phương án A fix).

import crypto from 'crypto';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the DB module — we control what db.select() returns
const mockSelect = jest.fn();
const mockFrom = jest.fn().mockReturnThis();
const mockWhere = jest.fn().mockReturnThis();
const mockLimit = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    select: () => {
      mockSelect();
      return { from: mockFrom, where: mockWhere, limit: mockLimit };
    },
  },
}));

// Wire up the chain: select().from().where().limit() → returns array
mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ limit: mockLimit });

jest.mock('@/lib/db/schema', () => ({
  apiKeys: {
    keyHash: 'keyHash',
    id: 'id',
    fileAuthConfig: 'fileAuthConfig',
  },
  profileEndpoints: {
    apiKeyId: 'apiKeyId',
    endpointSlug: 'endpointSlug',
  },
}));

jest.mock('drizzle-orm', () => ({
  eq: (col: string, val: string) => ({ col, val }),
}));

// Mock rate limiting (always allow)
jest.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: jest.fn().mockResolvedValue(null),
}));

// Mock profile-resolver
jest.mock('@/lib/endpoints/profile-resolver', () => ({
  loadProfileEndpoint: jest.fn().mockResolvedValue({ enabled: true, parameters: null, connectionsOverride: null }),
  mergeParameters: jest.fn().mockReturnValue({ ok: true, vars: {} }),
  parseConnectionSteps: jest.fn().mockReturnValue([{ slug: 'ext-gemini' }]),
  getFileUrlAuthConfig: jest.fn().mockReturnValue(undefined),
}));

jest.mock('@/lib/delivery/resolve-target', () => ({
  resolveCallbackTarget: jest.fn().mockResolvedValue({ ok: true, url: null, source: 'none' }),
}));

// Mock pipeline submit (always succeed)
jest.mock('@/lib/pipelines/submit', () => ({
  submitPipelineJob: jest.fn().mockResolvedValue({
    ok: true,
    operation: { id: 'op-123', done: false, state: 'RUNNING' },
    isIdempotent: false,
  }),
}));

// Mock pipeline format
jest.mock('@/lib/pipelines/format', () => ({
  formatOperationResponse: jest.fn((op) => op),
}));

// Mock registry
jest.mock('@/lib/endpoints/registry', () => ({
  SERVICE_REGISTRY: {
    extract: {
      displayName: 'Extract',
      discriminatorName: 'type',
      subCases: {
        _default: {
          displayName: 'Default Extract',
          connections: ['ext-gemini'],
          parameters: {},
        },
        invoice: {
          displayName: 'Invoice',
          connections: ['ext-gemini'],
          parameters: {},
        },
      },
    },
  },
  resolveAllowedExtensions: jest.fn().mockReturnValue(undefined),
}));

// Mock presets
jest.mock('@/lib/endpoints/presets', () => ({
  EXTRACT_PRESETS: {},
}));

// Mock logger
jest.mock('@/lib/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// Mock file-url-downloader
jest.mock('@/lib/file-url-downloader', () => ({
  MAX_FILE_URL_ENTRIES: 20,
}));

// Mock errors
jest.mock('@/lib/errors', () => ({
  BASE_TYPE_URI: 'urn:dugate:error',
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockRequest(headers: Record<string, string> = {}, body?: FormData): any {
  const formData = body ?? new FormData();
  formData.append('type', 'invoice');

  return {
    method: 'POST',
    url: 'http://localhost:2023/api/v1/extract',
    headers: new Headers(headers),
    formData: jest.fn().mockResolvedValue(formData),
    nextUrl: { searchParams: new URLSearchParams() },
  } as any;
}

// ─── Import runner AFTER mocks are set up ─────────────────────────────────────

import { runEndpoint } from '@/lib/endpoints/runner';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runner.ts — API key authentication (Phương án A)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('When x-api-key header is NOT provided', () => {
    it('should reject anonymous request with 401 (API key required)', async () => {
      const req = createMockRequest({ 'x-user-id': 'user-123' });
      const { loadProfileEndpoint } = require('@/lib/endpoints/profile-resolver');
      loadProfileEndpoint.mockResolvedValue(null);

      const response = await runEndpoint('extract', req);
      const json = await response.json();

      // Phase 2: anonymous access is no longer allowed — API key is required
      expect(response.status).toBe(401);
      expect(json.title).toBe('API Key Required');
    });
  });

  describe('When x-api-key header is provided with a VALID active key', () => {
    it('should resolve apiKeyId and proceed normally (202)', async () => {
      const rawKey = 'dg_valid_key_abc123';
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      mockLimit.mockResolvedValue([{ id: 'profile-001', keyHash, status: 'active', name: 'Test Profile' }]);

      // Once apiKeyId is resolved, loadProfileEndpoint must return a valid enabled profile
      const { loadProfileEndpoint } = require('@/lib/endpoints/profile-resolver');
      loadProfileEndpoint.mockResolvedValue({ enabled: true, parameters: null, connectionsOverride: null });

      const req = createMockRequest({ 'x-api-key': rawKey });
      const response = await runEndpoint('extract', req);

      expect(response.status).toBe(202);
      expect(mockLimit).toHaveBeenCalled();
    });
  });

  describe('When x-api-key header is provided but key does NOT exist (deleted/rotated)', () => {
    it('should return 401 Unauthorized', async () => {
      const rawKey = 'dg_revoked_key_xyz999';

      // DB returns empty array (key not found)
      mockLimit.mockResolvedValue([]);

      const req = createMockRequest({ 'x-api-key': rawKey });
      const response = await runEndpoint('extract', req);
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.title).toBe('Unauthorized');
      expect(json.detail).toContain('Invalid or revoked API key');
    });
  });

  describe('When x-api-key header maps to a SUSPENDED key', () => {
    it('should return 403 Forbidden', async () => {
      const rawKey = 'dg_suspended_key_def456';
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      // DB returns key with status = 'suspended'
      mockLimit.mockResolvedValue([{ id: 'profile-002', keyHash, status: 'suspended', name: 'Suspended Profile' }]);

      const req = createMockRequest({ 'x-api-key': rawKey });
      const response = await runEndpoint('extract', req);
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.title).toBe('Forbidden');
      expect(json.detail).toContain('deactivated or suspended');
    });
  });

  describe('When x-api-key header maps to a DEACTIVATED key', () => {
    it('should return 403 Forbidden', async () => {
      const rawKey = 'dg_deactivated_key_ghi789';
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      mockLimit.mockResolvedValue([{ id: 'profile-003', keyHash, status: 'deactivated', name: 'Deactivated Profile' }]);

      const req = createMockRequest({ 'x-api-key': rawKey });
      const response = await runEndpoint('extract', req);
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.title).toBe('Forbidden');
      expect(json.detail).toContain('deactivated or suspended');
    });
  });

  describe('When DB query throws an error during key resolution', () => {
    it('should return 500 Internal Error', async () => {
      const rawKey = 'dg_error_key_jkl000';

      // Simulate DB failure
      mockLimit.mockRejectedValue(new Error('Connection refused'));

      const req = createMockRequest({ 'x-api-key': rawKey });
      const response = await runEndpoint('extract', req);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.title).toBe('Internal Error');
      expect(json.detail).toContain('Failed to validate API key');
    });
  });

  describe('When x-api-key-id header is already set (pre-resolved)', () => {
    it('should skip x-api-key resolution and proceed', async () => {
      // x-api-key-id already set (e.g. by an internal proxy)
      const { loadProfileEndpoint } = require('@/lib/endpoints/profile-resolver');
      loadProfileEndpoint.mockResolvedValue({ enabled: true, parameters: null, connectionsOverride: null });

      const req = createMockRequest({ 'x-api-key-id': 'pre-resolved-id-001' });

      const response = await runEndpoint('extract', req);

      // Should NOT call DB for key resolution
      expect(mockSelect).not.toHaveBeenCalled();
      expect(response.status).toBe(202);
    });
  });

  describe('Rotate key scenario', () => {
    it('old key returns 401, new key returns 202', async () => {
      const oldKey = 'dg_old_key_before_rotate';
      const newKey = 'dg_new_key_after_rotate';
      const newKeyHash = crypto.createHash('sha256').update(newKey).digest('hex');

      // Old key → not found (hash changed after rotate)
      mockLimit.mockResolvedValueOnce([]);

      const req1 = createMockRequest({ 'x-api-key': oldKey });
      const res1 = await runEndpoint('extract', req1);
      expect(res1.status).toBe(401);

      // New key → found and active
      mockLimit.mockResolvedValueOnce([{ id: 'profile-rotated', keyHash: newKeyHash, status: 'active', name: 'Rotated Profile' }]);
      const { loadProfileEndpoint } = require('@/lib/endpoints/profile-resolver');
      loadProfileEndpoint.mockResolvedValue({ enabled: true, parameters: null, connectionsOverride: null });

      const req2 = createMockRequest({ 'x-api-key': newKey });
      const res2 = await runEndpoint('extract', req2);
      expect(res2.status).toBe(202);
    });
  });

  describe('Delete profile scenario', () => {
    it('deleted profile key returns 401 (row removed from DB)', async () => {
      const deletedKey = 'dg_deleted_profile_key';

      // Key row was deleted from DB
      mockLimit.mockResolvedValue([]);

      const req = createMockRequest({ 'x-api-key': deletedKey });
      const response = await runEndpoint('extract', req);
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.detail).toContain('Invalid or revoked API key');
    });
  });
});

// ─── T5: file_urls input — toggle, default chunks, tier-3 auth, _original ─────

describe('runner.ts — file_urls input (T5)', () => {
  const rawKey = 'dg_file_urls_key';
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const fdWith = (fields: Record<string, string>): FormData => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const resolver = require('@/lib/endpoints/profile-resolver');
    // Fresh vars object per call so _original_file_urls does not leak between tests.
    resolver.mergeParameters.mockImplementation(() => ({ ok: true, vars: {} }));
    resolver.parseConnectionSteps.mockReturnValue([{ slug: 'ext-gemini' }]);
    resolver.getFileUrlAuthConfig.mockReturnValue(undefined);
    // Tier-3 ApiKey lookup (when reached) returns "no row" by default.
    mockLimit.mockResolvedValue([]);
  });

  it('accepts file_urls even if a legacy fileUrlEnabled=false is present (input mode is NOT admin-gated)', async () => {
    // The fileUrlEnabled gate was removed by design: input mode (upload vs URL)
    // is the caller's per-request choice. A stale/legacy false value must be
    // ignored, not enforced — this test guards against re-introducing the gate.
    const resolver = require('@/lib/endpoints/profile-resolver');
    resolver.loadProfileEndpoint.mockResolvedValue({
      enabled: true, fileUrlEnabled: false, parameters: null, connectionsOverride: null,
    });

    const req = createMockRequest(
      { 'x-api-key-id': 'pre-id' },
      fdWith({ file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf' }]) }),
    );
    const res = await runEndpoint('extract', req);

    expect(res.status).toBe(202);
    const { submitPipelineJob } = require('@/lib/pipelines/submit');
    expect(submitPipelineJob.mock.calls[0][0].fileUrls).toHaveLength(1);
  });

  it('accepts file_urls when fileUrlEnabled is unset (default) — unchanged behaviour', async () => {
    const resolver = require('@/lib/endpoints/profile-resolver');
    resolver.loadProfileEndpoint.mockResolvedValue({
      enabled: true, parameters: null, connectionsOverride: null,
    });

    const req = createMockRequest(
      { 'x-api-key-id': 'pre-id' },
      fdWith({ file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf' }]) }),
    );
    const res = await runEndpoint('extract', req);

    expect(res.status).toBe(202);
    const { submitPipelineJob } = require('@/lib/pipelines/submit');
    expect(submitPipelineJob.mock.calls[0][0].fileUrls).toHaveLength(1);
  });

  it('backfills fileUrlDefaultChunks only into entries missing total_chunks', async () => {
    const resolver = require('@/lib/endpoints/profile-resolver');
    resolver.loadProfileEndpoint.mockResolvedValue({
      enabled: true, fileUrlDefaultChunks: 5, parameters: null, connectionsOverride: null,
    });

    const req = createMockRequest(
      { 'x-api-key-id': 'pre-id' },
      fdWith({
        file_urls: JSON.stringify([
          { url: 'https://x.test/a.pdf' },
          { url: 'https://x.test/b.pdf', total_chunks: 2 },
        ]),
      }),
    );
    const res = await runEndpoint('extract', req);
    expect(res.status).toBe(202);

    const { submitPipelineJob } = require('@/lib/pipelines/submit');
    const passed = submitPipelineJob.mock.calls[0][0].fileUrls;
    expect(passed[0].total_chunks).toBe(5); // backfilled
    expect(passed[1].total_chunks).toBe(2); // caller value preserved
  });

  it('uses ApiKey.fileAuthConfig and ignores a stale endpoint column', async () => {
    const resolver = require('@/lib/endpoints/profile-resolver');
    resolver.loadProfileEndpoint.mockResolvedValue({
      enabled: true, parameters: null, connectionsOverride: null,
      // The per-endpoint override was removed. A legacy row may still hold the retired
      // column; the runner must never read it. Only 'apikey-raw' resolves below, so if
      // this value were used the assertion at the end would fail.
      fileUrlAuthConfig: 'stale-endpoint-auth',
    });
    // Only the synthetic ApiKey object resolves to bearer.
    resolver.getFileUrlAuthConfig.mockImplementation((pe: any) =>
      pe?.fileUrlAuthConfig === 'apikey-raw' ? { type: 'bearer', token: 'tkn' } : undefined,
    );
    // x-api-key path so the full ApiKey record (with fileAuthConfig) is reused — no extra query.
    mockLimit.mockResolvedValue([
      { id: 'p1', keyHash, status: 'active', name: 'P', fileAuthConfig: 'apikey-raw' },
    ]);

    const req = createMockRequest(
      { 'x-api-key': rawKey },
      fdWith({ file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf' }]) }),
    );
    const res = await runEndpoint('extract', req);
    expect(res.status).toBe(202);

    const { submitPipelineJob } = require('@/lib/pipelines/submit');
    expect(submitPipelineJob.mock.calls[0][0].fileUrlAuthConfig).toEqual({ type: 'bearer', token: 'tkn' });
  });

  it('writes _original_file_urls into pipeline variables', async () => {
    const resolver = require('@/lib/endpoints/profile-resolver');
    resolver.loadProfileEndpoint.mockResolvedValue({
      enabled: true, parameters: null, connectionsOverride: null,
    });

    const req = createMockRequest(
      { 'x-api-key-id': 'pre-id' },
      fdWith({
        file_urls: JSON.stringify([
          { url: 'https://x.test/a.pdf', filename: 'a.pdf', mime_type: 'application/pdf' },
        ]),
      }),
    );
    const res = await runEndpoint('extract', req);
    expect(res.status).toBe(202);

    const { submitPipelineJob } = require('@/lib/pipelines/submit');
    const vars = submitPipelineJob.mock.calls[0][0].pipeline[0].variables;
    expect(vars._original_file_urls).toEqual([
      { url: 'https://x.test/a.pdf', filename: 'a.pdf', mime_type: 'application/pdf' },
    ]);
  });

  it('leaves requests without file_urls unchanged (no _original, no fileUrls)', async () => {
    const resolver = require('@/lib/endpoints/profile-resolver');
    resolver.loadProfileEndpoint.mockResolvedValue({
      enabled: true, parameters: null, connectionsOverride: null,
    });

    const req = createMockRequest({ 'x-api-key-id': 'pre-id' }, fdWith({}));
    const res = await runEndpoint('extract', req);
    expect(res.status).toBe(202);

    const { submitPipelineJob } = require('@/lib/pipelines/submit');
    const arg = submitPipelineJob.mock.calls[0][0];
    expect(arg.fileUrls).toBeUndefined();
    expect(arg.pipeline[0].variables._original_file_urls).toBeUndefined();
  });

  it('now validates total_chunks on the Core API (tightening) with the shared detail', async () => {
    const req = createMockRequest(
      { 'x-api-key-id': 'pre-id' },
      fdWith({ file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf', total_chunks: 0 }]) }),
    );
    const res = await runEndpoint('extract', req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.detail).toBe('file_urls[0]: "total_chunks" must be a positive integer (>= 1).');
  });
});

describe('runner.ts — callback target wiring (T12)', () => {
  const callbackForm = (fields: Record<string, string>): FormData => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return form;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const resolver = require('@/lib/endpoints/profile-resolver');
    resolver.loadProfileEndpoint.mockResolvedValue({
      enabled: true, parameters: null, connectionsOverride: null,
    });
    resolver.mergeParameters.mockReturnValue({ ok: true, vars: {} });
    resolver.parseConnectionSteps.mockReturnValue([{ slug: 'ext-gemini' }]);
    resolver.getFileUrlAuthConfig.mockReturnValue(undefined);
    require('@/lib/delivery/resolve-target').resolveCallbackTarget.mockResolvedValue({
      ok: true, url: 'https://resolved.test/hook', source: 'request',
    });
    require('@/lib/pipelines/submit').submitPipelineJob.mockResolvedValue({
      ok: true, operation: { id: 'op-callback', done: false, state: 'RUNNING' }, isIdempotent: false,
    });
  });

  it('passes only request aliases to the resolver, then persists its target', async () => {
    const fd = callbackForm({ callback_url: 'https://new.test/hook', webhook_url: 'https://new.test/hook' });
    const res = await runEndpoint('extract', createMockRequest({ 'x-api-key-id': 'callback-key' }, fd));

    expect(res.status).toBe(202);
    expect(require('@/lib/delivery/resolve-target').resolveCallbackTarget).toHaveBeenCalledWith({
      callbackUrl: 'https://new.test/hook',
      webhookUrl: 'https://new.test/hook',
    });
    expect(require('@/lib/pipelines/submit').submitPipelineJob.mock.calls[0][0].webhookUrl).toBe('https://resolved.test/hook');
  });

  it('returns the resolver mismatch error and does not submit an operation', async () => {
    require('@/lib/delivery/resolve-target').resolveCallbackTarget.mockResolvedValue({
      ok: false, detail: 'callback_url and webhook_url must match when both are provided.',
    });
    const res = await runEndpoint('extract', createMockRequest(
      { 'x-api-key-id': 'callback-key' },
      callbackForm({ callback_url: 'https://new.test/hook', webhook_url: 'https://legacy.test/hook' }),
    ));

    expect(res.status).toBe(400);
    expect(require('@/lib/pipelines/submit').submitPipelineJob).not.toHaveBeenCalled();
  });
});



