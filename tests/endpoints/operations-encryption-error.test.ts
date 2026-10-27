// tests/endpoints/operations-encryption-error.test.ts
//
// The poll route (GET /api/v1/operations/{id}) must translate a selective-
// encryption misconfiguration (wrong encryption_fields dot-path) into HTTP 422
// with a corrective hint — NOT a generic 500. A genuine unexpected error still
// surfaces as 500.

const mockLimit = jest.fn();
jest.mock('@/lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }) },
}));
jest.mock('@/lib/db/schema', () => ({ operations: { id: 'id' } }));
jest.mock('drizzle-orm', () => ({ eq: (col: string, val: string) => ({ col, val }) }));

jest.mock('@/lib/auth-resolve-key', () => ({
  resolveCallerIdentity: jest.fn().mockResolvedValue({ apiKeyId: 'key-1', userId: null, userRole: null }),
}));

jest.mock('@/lib/pipelines/format', () => ({
  formatOperationResponse: jest.fn(() => ({ name: 'operations/op-1', done: true, result: {} })),
}));

const mockEncrypt = jest.fn();
jest.mock('@/lib/crypto/operation-response-encrypt', () => ({
  encryptOperationResponse: (...a: unknown[]) => mockEncrypt(...a),
}));

jest.mock('@/lib/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

import { GET } from '@/app/api/v1/operations/[id]/route';
import { SelectiveEncryptionFieldError } from '@/lib/crypto/selective-encrypt';

function makeReq(): any {
  return { headers: new Headers({ 'x-api-key-id': 'key-1' }) };
}
const ctx = { params: Promise.resolve({ id: 'op-1' }) };

describe('GET /operations/{id} — selective encryption misconfig → 422', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Operation belongs to the caller's apiKeyId so ownership passes.
    mockLimit.mockResolvedValue([{ id: 'op-1', apiKeyId: 'key-1', done: true, state: 'SUCCEEDED' }]);
  });

  it('returns 422 with a corrective hint when encryption_fields does not match', async () => {
    mockEncrypt.mockRejectedValue(
      new SelectiveEncryptionFieldError(['extracted_data.ma_may'], ['name', 'done', 'result']),
    );
    const res = await GET(makeReq(), ctx);
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.title).toBe('Encryption Fields Mismatch');
    expect(json.configured_fields).toEqual(['extracted_data.ma_may']);
    expect(json.available_top_level_keys).toEqual(['name', 'done', 'result']);
    expect(json.detail).toContain('**.ma_may');
    expect(json.detail).toContain('result.extracted_data');
  });

  it('still returns 500 for a genuine unexpected error', async () => {
    mockEncrypt.mockRejectedValue(new Error('unexpected boom'));
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(500);
  });

  it('returns 200 with encrypted body on success', async () => {
    mockEncrypt.mockResolvedValue({ body: { encrypted_payload: 'x' }, headers: { 'X-Encrypt-Mode': 'full' } });
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Encrypt-Mode')).toBe('full');
  });
});
