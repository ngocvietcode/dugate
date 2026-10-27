// tests/endpoints/workflows-file-urls.test.ts
// T6 smoke tests: the workflows route now uses the shared file_urls validator,
// while its LIVE-critical branches are preserved intact:
//   • csp_* credentials built from Profile parameters (payroll LIVE depends on this)
//   • inline file_url_auth from the request
//   • _original_file_urls recorded for the Operations UI
// It also gains file_id validation (tightening only invalid input).

const mockLimit = jest.fn();
jest.mock('@/lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }) },
}));
jest.mock('@/lib/db/schema', () => ({
  apiKeys: { id: 'id', status: 'status', rateLimitPerMin: 'rateLimitPerMin', keyHash: 'keyHash', fileAuthConfig: 'fileAuthConfig' },
}));
jest.mock('drizzle-orm', () => ({ eq: (col: string, val: string) => ({ col, val }) }));

// Minimal runner surface (avoids pulling the whole runner dependency tree).
jest.mock('@/lib/endpoints/runner', () => {
  const { NextResponse } = require('next/server');
  return {
    apiError: (status: number, title: string, detail: string) =>
      NextResponse.json({ title, status, detail }, { status }),
    normalizeFiles: () => [] as File[],
  };
});

// Real auth-config parser (so csp_* and inline auth are genuinely validated),
// without executing the heavy file-url-downloader module.
jest.mock('@/lib/file-url-downloader', () => ({
  parseFileUrlAuthConfig: require('@/lib/auth-config/parse').parseFileUrlAuthConfig,
  MAX_FILE_URL_ENTRIES: 20,
}));

jest.mock('@/lib/endpoints/registry', () => ({
  SERVICE_REGISTRY: {
    workflows: { subCases: { 'payroll-verify': { parameters: {} } } },
  },
  resolveAllowedExtensions: jest.fn().mockReturnValue(undefined),
}));

const mockLoadProfileEndpoint = jest.fn();
const mockGetFileUrlAuthConfig = jest.fn();

jest.mock('@/lib/endpoints/profile-resolver', () => ({
  loadProfileEndpoint: (...a: unknown[]) => mockLoadProfileEndpoint(...a),
  getFileUrlAuthConfig: (...a: unknown[]) => mockGetFileUrlAuthConfig(...a),

  // The route now merges Profile params into pipeline variables (encryption parity).
  // Use the real merge so these smoke tests continue to exercise genuine behaviour.
  mergeParameters: jest.requireActual('@/lib/endpoints/profile-resolver').mergeParameters,
}));

jest.mock('@/lib/delivery/resolve-target', () => ({
  resolveCallbackTarget: jest.fn().mockResolvedValue({ ok: true, url: null, source: 'none' }),
}));

jest.mock('@/lib/rate-limit', () => ({ enforceRateLimit: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/pipelines/processors/http-client', () => ({
  assertSafeUrl: jest.fn(async (u: string) => u),
  isUrlOriginAllowed: jest.fn().mockReturnValue(true),
}));
jest.mock('@/lib/reference-extract', () => ({ extractClientReference: jest.fn().mockReturnValue(undefined) }));
jest.mock('@/lib/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

const mockSubmit = jest.fn();
jest.mock('@/lib/pipelines/submit', () => ({ submitPipelineJob: (...a: unknown[]) => mockSubmit(...a) }));

import { POST } from '@/app/api/v1/docs/workflows/route';

const RAW_KEY = 'dg_workflow_key';

function req(fields: Record<string, string>): any {
  const fd = new FormData();
  fd.append('process', 'payroll-verify');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return {
    headers: new Headers({ 'x-api-key': RAW_KEY }),
    formData: jest.fn().mockResolvedValue(fd),
  };
}

describe('workflows route — shared file_urls validator (T6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLimit.mockResolvedValue([{ id: 'key-1', status: 'active', rateLimitPerMin: 100 }]);
    mockLoadProfileEndpoint.mockResolvedValue({
      enabled: true, parameters: null, allowedFileExtensions: null, fileUrlAuthConfig: null,
    });
    mockGetFileUrlAuthConfig.mockReturnValue(undefined);
    mockSubmit.mockResolvedValue({ ok: true, operation: { id: 'op-1' } });
  });

  it('accepts valid file_urls and submits them (202)', async () => {
    const res = await POST(req({ file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf' }]) }));
    expect(res.status).toBe(202);
    expect(mockSubmit.mock.calls[0][0].fileUrls).toHaveLength(1);
  });

  it('rejects a malformed url with the shared detail string', async () => {
    const res = await POST(req({ file_urls: JSON.stringify([{ url: 'bad' }]) }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.detail).toBe('file_urls[0]: "bad" is not a valid URL format.');
  });

  it('now validates file_id type (tightening) with the shared detail string', async () => {
    const res = await POST(req({ file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf', file_id: 123 }]) }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.detail).toBe('file_urls[0]: "file_id" must be a string when provided.');
  });

  it('uses Profile Integration Auth before legacy workflow params', async () => {
    mockLimit.mockResolvedValue([{ id: 'key-1', status: 'active', rateLimitPerMin: 100, fileAuthConfig: 'profile-file-auth' }]);
    mockGetFileUrlAuthConfig.mockImplementation((value: any) =>
      value?.fileUrlAuthConfig === 'profile-file-auth'
        ? { type: 'bearer', token: 'profile-token' }
        : undefined,
    );
    mockLoadProfileEndpoint.mockResolvedValue({
      enabled: true,
      allowedFileExtensions: null,
      fileUrlAuthConfig: null,
      parameters: JSON.stringify({
        csp_token_url: { value: 'https://legacy.test/oauth' },
        csp_client_id: { value: 'legacy-client' },
        csp_client_secret: { value: 'legacy-secret' },
      }),
    });

    const res = await POST(req({ file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf' }]) }));
    expect(res.status).toBe(202);
    expect(mockSubmit.mock.calls[0][0].fileUrlAuthConfig).toEqual({ type: 'bearer', token: 'profile-token' });
  });

  it('still builds csp_* auth from Profile parameters for unmigrated workflows', async () => {
    mockLoadProfileEndpoint.mockResolvedValue({
      enabled: true,
      allowedFileExtensions: null,
      fileUrlAuthConfig: null,
      parameters: JSON.stringify({
        csp_token_url: { value: 'https://token.test/oauth' },
        csp_client_id: { value: 'client-1' },
        csp_client_secret: { value: 'secret-1' },
      }),
    });

    const res = await POST(req({ file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf' }]) }));
    expect(res.status).toBe(202);
    expect(mockSubmit.mock.calls[0][0].fileUrlAuthConfig).toMatchObject({ type: 'csp_oauth2' });
  });

  it('still honours inline file_url_auth from the request', async () => {
    const res = await POST(req({
      file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf' }]),
      file_url_auth: JSON.stringify({ type: 'bearer', token: 'inline-token' }),
    }));
    expect(res.status).toBe(202);
    expect(mockSubmit.mock.calls[0][0].fileUrlAuthConfig).toMatchObject({ type: 'bearer' });
  });

  it('still records _original_file_urls for the Operations UI', async () => {
    const res = await POST(req({
      file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf', filename: 'a.pdf', mime_type: 'application/pdf' }]),
    }));
    expect(res.status).toBe(202);
    const vars = mockSubmit.mock.calls[0][0].pipeline[0].variables;
    expect(vars._original_file_urls).toEqual([
      { url: 'https://x.test/a.pdf', filename: 'a.pdf', mime_type: 'application/pdf' },
    ]);
  });

  // Parity fix (review item 1): the workflow path now honours the endpoint-level
  // fileUrlDefaultChunks exactly like the Core API runner (step 5b).
  it('backfills total_chunks from fileUrlDefaultChunks (parity with Core API); caller value wins', async () => {
    mockLoadProfileEndpoint.mockResolvedValue({
      enabled: true, parameters: null, allowedFileExtensions: null, fileUrlAuthConfig: null,
      fileUrlDefaultChunks: 4,
    });
    const res = await POST(req({
      file_urls: JSON.stringify([
        { url: 'https://x.test/a.pdf' },
        { url: 'https://x.test/b.pdf', total_chunks: 9 },
      ]),
    }));
    expect(res.status).toBe(202);
    const submitted = mockSubmit.mock.calls[0][0].fileUrls;
    expect(submitted[0].total_chunks).toBe(4); // backfilled from endpoint default
    expect(submitted[1].total_chunks).toBe(9); // caller-supplied value preserved
  });

  it('leaves total_chunks unset when fileUrlDefaultChunks is absent (unchanged behaviour)', async () => {
    const res = await POST(req({ file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf' }]) }));
    expect(res.status).toBe(202);
    expect(mockSubmit.mock.calls[0][0].fileUrls[0].total_chunks).toBeUndefined();
  });

  it('uses the shared resolver for callback_url and persists its request-selected target', async () => {
    require('@/lib/delivery/resolve-target').resolveCallbackTarget.mockResolvedValue({
      ok: true, url: 'https://resolved.test/hook', source: 'request',
    });

    const res = await POST(req({
      file_urls: JSON.stringify([{ url: 'https://x.test/a.pdf' }]),
      callback_url: 'https://new.test/hook', webhook_url: 'https://new.test/hook',
    }));

    expect(res.status).toBe(202);
    expect(require('@/lib/delivery/resolve-target').resolveCallbackTarget).toHaveBeenCalledWith({
      callbackUrl: 'https://new.test/hook',
      webhookUrl: 'https://new.test/hook',
    });
    expect(mockSubmit.mock.calls[0][0].webhookUrl).toBe('https://resolved.test/hook');
  });
});
