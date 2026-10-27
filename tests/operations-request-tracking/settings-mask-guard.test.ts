// tests/operations-request-tracking/settings-mask-guard.test.ts
// SEC scan 18/09, P1.1 — PUT /api/settings must not take a mask at face value.
//
// GET /api/settings returns maskApiKey() of s3_access_key and s3_secret_key, so a
// client that saves a form it never edited posts the mask straight back. Before this
// guard the route accepted any string and wrote the mask over the real secret.
//
// The guard has to compare against the mask of the value *currently stored*, never
// against '' — matching on empty would silently remove the ability to clear a secret.
// All three outcomes are covered below.

const mockRequireCapability = jest.fn();
const mockGetAllSettings = jest.fn();
const mockSetSettings = jest.fn();
const mockResetStorageBackend = jest.fn();

jest.mock('@/lib/auth-guard', () => ({
  requireCapability: (...args: unknown[]) => mockRequireCapability(...args),
}));

jest.mock('@/lib/settings', () => ({
  getAllSettings: (...args: unknown[]) => mockGetAllSettings(...args),
  setSettings: (...args: unknown[]) => mockSetSettings(...args),
}));

jest.mock('@/lib/storage', () => ({
  resetStorageBackend: (...args: unknown[]) => mockResetStorageBackend(...args),
}));

jest.mock('@/lib/logger', () => ({
  Logger: jest.fn(() => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() })),
}));

import { maskApiKey } from '@/lib/crypto';
import { PUT } from '@/app/api/settings/route';

const STORED_SECRET = 'SECRETvalue1234wxyz';
const STORED_ACCESS = 'ACCESSvalue1234wxyz';

function putRequest(body: Record<string, unknown>): Request {
  return { json: async () => body } as unknown as Request;
}

describe('PUT /api/settings — masked secret guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCapability.mockResolvedValue({
      session: { user: { id: 'u1', username: 'admin', role: 'ADMIN' } },
    });
    mockGetAllSettings.mockResolvedValue({
      s3_access_key: STORED_ACCESS,
      s3_secret_key: STORED_SECRET,
    });
    mockSetSettings.mockResolvedValue(undefined);
  });

  // State 1 of 3 — a genuinely new value is written.
  it('writes a fresh secret through', async () => {
    const response = await PUT(putRequest({ s3_secret_key: 'brand-new-secret' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      ignoredMaskedKeys: [],
      masked: { s3_secret_key: maskApiKey('brand-new-secret') },
    });
    expect(mockSetSettings).toHaveBeenCalledWith({ s3_secret_key: 'brand-new-secret' });
    expect(mockResetStorageBackend).toHaveBeenCalled();
  });

  // State 2 of 3 — the mask of the stored value keeps the stored value.
  it('keeps the stored secret when the payload is its own mask', async () => {
    const response = await PUT(
      putRequest({
        s3_access_key: maskApiKey(STORED_ACCESS),
        s3_secret_key: maskApiKey(STORED_SECRET),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.ignoredMaskedKeys.sort()).toEqual(['s3_access_key', 's3_secret_key']);
    // Nothing was persisted, so the real secret survives untouched.
    expect(mockSetSettings).not.toHaveBeenCalled();
  });

  // State 3 of 3 — the regression this guard must not introduce.
  it('still clears a secret when the payload is an empty string', async () => {
    const response = await PUT(putRequest({ s3_secret_key: '' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      ignoredMaskedKeys: [],
      masked: { s3_secret_key: '' },
    });
    expect(mockSetSettings).toHaveBeenCalledWith({ s3_secret_key: '' });
  });

  it('writes a half-edited mask instead of matching it, so nothing is silently dropped', async () => {
    // 'abcd****wxyzX' still contains '****' but is not the mask of anything stored.
    const halfEdited = `${maskApiKey(STORED_SECRET)}X`;
    await PUT(putRequest({ s3_secret_key: halfEdited }));

    expect(mockSetSettings).toHaveBeenCalledWith({ s3_secret_key: halfEdited });
  });

  it('leaves non-secret keys alone and never reads current settings for them', async () => {
    const response = await PUT(putRequest({ home_mode: 'developer' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, masked: {} });
    expect(mockGetAllSettings).not.toHaveBeenCalled();
    expect(mockSetSettings).toHaveBeenCalledWith({ home_mode: 'developer' });
    expect(mockResetStorageBackend).not.toHaveBeenCalled();
  });

  it('does not compare against an empty stored value, so a first-time secret is written', async () => {
    mockGetAllSettings.mockResolvedValue({ s3_access_key: '', s3_secret_key: '' });

    await PUT(putRequest({ s3_secret_key: '****' }));

    // maskApiKey('') is '****'. Guarding on `stored &&` keeps that from being read as
    // "matches the mask", so the operator's literal input is still honoured.
    expect(mockSetSettings).toHaveBeenCalledWith({ s3_secret_key: '****' });
  });
});
