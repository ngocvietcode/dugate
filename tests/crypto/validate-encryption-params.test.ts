// tests/crypto/validate-encryption-params.test.ts
import { validateEncryptionParams } from '@/lib/crypto/validate-encryption-params';

const p = (obj: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(obj).map(([k, value]) => [k, { value }]));

describe('validateEncryptionParams (fail-closed, no defaults)', () => {
  it('passes when encryption is disabled or absent', () => {
    expect(validateEncryptionParams(null)).toBeNull();
    expect(validateEncryptionParams({})).toBeNull();
    expect(validateEncryptionParams(p({ encryption_enabled: false }))).toBeNull();
  });

  it('rejects enabled without fields (mode defaults to selective)', () => {
    // mode omitted → defaults to selective → fields required.
    expect(validateEncryptionParams(p({ encryption_enabled: true }))).toMatch(/encryption_fields/);
    expect(validateEncryptionParams(p({ encryption_enabled: 'true' }))).toMatch(/encryption_fields/);
  });

  it('rejects selective without fields', () => {
    expect(
      validateEncryptionParams(p({ encryption_enabled: true, encryption_mode: 'selective' })),
    ).toMatch(/encryption_fields/);
    expect(
      validateEncryptionParams(p({ encryption_enabled: true, encryption_mode: 'selective', encryption_fields: '  ,  ' })),
    ).toMatch(/encryption_fields|rỗng/);
  });

  it('passes selective with a non-empty field list', () => {
    expect(
      validateEncryptionParams(p({ encryption_enabled: true, encryption_mode: 'selective', encryption_fields: 'extracted_data' })),
    ).toBeNull();
  });

  it('passes full mode without fields', () => {
    expect(
      validateEncryptionParams(p({ encryption_enabled: true, encryption_mode: 'full' })),
    ).toBeNull();
  });
});
