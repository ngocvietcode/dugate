// tests/endpoints/workflows-encryption-merge.test.ts
//
// Regression guard for the workflow submit route: Profile-stored parameters
// (notably the encryption_* block turned on in the Profile UI) MUST be merged
// into pipelineJson[0].variables. encryptOperationResponse reads that block at
// poll/download time, so without this merge a Profile that enabled encryption
// still returns plaintext. See app/api/v1/docs/workflows/route.ts.

import crypto from 'crypto';

// ─── DB mock (x-api-key resolution) ───────────────────────────────────────────
const mockLimit = jest.fn();
const mockWhere = jest.fn().mockReturnValue({ limit: mockLimit });
const mockFrom = jest.fn().mockReturnValue({ where: mockWhere });
jest.mock('@/lib/db', () => ({
  db: { select: () => ({ from: mockFrom }) },
}));
jest.mock('@/lib/db/schema', () => ({
  apiKeys: { keyHash: 'keyHash', id: 'id', status: 'status', rateLimitPerMin: 'rateLimitPerMin' },
}));
jest.mock('drizzle-orm', () => ({ eq: (col: string, val: string) => ({ col, val }) }));

jest.mock('@/lib/rate-limit', () => ({ enforceRateLimit: jest.fn().mockResolvedValue(null) }));

jest.mock('@/lib/endpoints/profile-resolver', () => ({
  loadProfileEndpoint: jest.fn(),
  getFileUrlAuthConfig: jest.fn().mockReturnValue(undefined),
  // Use the REAL mergeParameters so the test exercises the actual merge logic.
  mergeParameters: jest.requireActual('@/lib/endpoints/profile-resolver').mergeParameters,
}));

jest.mock('@/lib/delivery/resolve-target', () => ({
  resolveCallbackTarget: jest.fn().mockResolvedValue({ ok: true, url: null, source: 'none' }),
}));

jest.mock('@/lib/pipelines/submit', () => ({
  submitPipelineJob: jest.fn().mockResolvedValue({
    ok: true, operation: { id: 'op-wf-1', done: false, state: 'RUNNING' }, isIdempotent: false,
  }),
}));

jest.mock('@/lib/reference-extract', () => ({ extractClientReference: jest.fn().mockReturnValue(null) }));

// Real registry so tracing-portal carries the auto-injected ENCRYPTION_PARAMS.
jest.mock('@/lib/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

import { POST } from '@/app/api/v1/docs/workflows/route';

const rawKey = 'dg_wf_key';
const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

function makeReq(fields: Record<string, string>, headers: Record<string, string> = {}): any {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  // A workflow requires at least one file source; attach a tiny dummy file.
  fd.append('files[]', new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' }));
  return {
    method: 'POST',
    url: 'http://localhost:2023/api/v2/docs/workflows',
    headers: new Headers({ 'x-api-key': rawKey, ...headers }),
    formData: jest.fn().mockResolvedValue(fd),
  };
}

describe('workflows route — Profile param merge into pipelineJson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLimit.mockResolvedValue([{ id: 'profile-tp', keyHash, status: 'active', name: 'tracing-portal' }]);
  });

  it('merges encryption_* from the Profile into pipeline[0].variables', async () => {
    const { loadProfileEndpoint } = require('@/lib/endpoints/profile-resolver');
    loadProfileEndpoint.mockResolvedValue({
      enabled: true,
      parameters: JSON.stringify({
        encryption_enabled: { value: true, isLocked: true },
        encryption_mode: { value: 'selective', isLocked: true },
        encryption_fields: { value: 'danh_sach_tai_lieu[].extracted_data.ma_may', isLocked: true },
      }),
    });

    const res = await POST(makeReq({ process: 'tracing-portal', metadata: '{}' }));
    expect(res.status).toBe(202);

    const { submitPipelineJob } = require('@/lib/pipelines/submit');
    const vars = submitPipelineJob.mock.calls[0][0].pipeline[0].variables;
    expect(vars.encryption_enabled).toBe(true);
    expect(vars.encryption_mode).toBe('selective');
    expect(vars.encryption_fields).toBe('danh_sach_tai_lieu[].extracted_data.ma_may');
  });

  it('lets the request supply the non-locked encryption_public_key', async () => {
    const { loadProfileEndpoint } = require('@/lib/endpoints/profile-resolver');
    loadProfileEndpoint.mockResolvedValue({
      enabled: true,
      parameters: JSON.stringify({
        encryption_enabled: { value: true, isLocked: true },
        encryption_mode: { value: 'selective', isLocked: true },
        encryption_fields: { value: 'extracted_data', isLocked: true },
      }),
    });

    const pem = '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----';
    const res = await POST(makeReq({ process: 'tracing-portal', encryption_public_key: pem }));
    expect(res.status).toBe(202);

    const { submitPipelineJob } = require('@/lib/pipelines/submit');
    const vars = submitPipelineJob.mock.calls[0][0].pipeline[0].variables;
    expect(vars.encryption_public_key).toBe(pem);
    expect(vars.encryption_enabled).toBe(true);
  });

  it('rejects a client attempt to override an admin-locked encryption field (400)', async () => {
    const { loadProfileEndpoint } = require('@/lib/endpoints/profile-resolver');
    loadProfileEndpoint.mockResolvedValue({
      enabled: true,
      parameters: JSON.stringify({
        encryption_enabled: { value: true, isLocked: true },
      }),
    });

    const res = await POST(makeReq({ process: 'tracing-portal', encryption_enabled: 'false' }));
    expect(res.status).toBe(400);
  });

  it('keeps behaviour unchanged when the Profile has no params (no encryption keys)', async () => {
    const { loadProfileEndpoint } = require('@/lib/endpoints/profile-resolver');
    loadProfileEndpoint.mockResolvedValue({ enabled: true, parameters: null });

    const res = await POST(makeReq({ process: 'tracing-portal' }));
    expect(res.status).toBe(202);

    const { submitPipelineJob } = require('@/lib/pipelines/submit');
    const vars = submitPipelineJob.mock.calls[0][0].pipeline[0].variables;
    expect(vars.encryption_enabled).toBeUndefined();
  });
});
