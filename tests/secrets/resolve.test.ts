// tests/secrets/resolve.test.ts
import { resolveConnectionSecret } from '@/lib/secrets/resolve';
import { __setSecretProviderForTest } from '@/lib/secrets';
import type { SecretProvider } from '@/lib/secrets';

const fakeProvider: SecretProvider = {
  getSecret: jest.fn(async (ref: string) => `resolved:${ref}`),
  testResolve: jest.fn(async () => ({ ok: true as const })),
  // Part of the SecretProvider contract since caching was added; without it this
  // mock does not satisfy the interface and `tsc --noEmit` fails on this file.
  invalidate: jest.fn(),
};

describe('resolveConnectionSecret (dual-read)', () => {
  afterEach(() => __setSecretProviderForTest(null));

  it('uses Vault when vaultSecretPath is set', async () => {
    __setSecretProviderForTest(fakeProvider);
    const val = await resolveConnectionSecret({ authSecret: 'legacy-key', vaultSecretPath: 'aihub/team-a' });
    expect(val).toBe('resolved:aihub/team-a');
    expect(fakeProvider.getSecret).toHaveBeenCalledWith('aihub/team-a');
  });

  it('falls back to legacy authSecret when no vaultSecretPath', async () => {
    __setSecretProviderForTest(fakeProvider);
    const val = await resolveConnectionSecret({ authSecret: 'legacy-key', vaultSecretPath: null });
    expect(val).toBe('legacy-key');
  });

  it('treats empty/whitespace vaultSecretPath as not set', async () => {
    __setSecretProviderForTest(fakeProvider);
    expect(await resolveConnectionSecret({ authSecret: 'k', vaultSecretPath: '   ' })).toBe('k');
  });
});
