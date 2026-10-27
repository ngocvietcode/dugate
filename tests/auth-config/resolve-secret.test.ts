import { __setSecretProviderForTest } from '@/lib/secrets';
import type { SecretProvider } from '@/lib/secrets';
import { resolveAuthConfigSecrets } from '@/lib/auth-config/resolve-secret';

const fakeProvider: SecretProvider = {
  getSecret: jest.fn(async (ref: string) => `resolved:${ref}`),
  testResolve: jest.fn(async () => ({ ok: true as const })),
  invalidate: jest.fn(),
};

describe('resolveAuthConfigSecrets', () => {
  afterEach(() => {
    __setSecretProviderForTest(null);
    jest.clearAllMocks();
  });

  it('uses an inline value that has already been decrypted', async () => {
    __setSecretProviderForTest(fakeProvider);

    await expect(resolveAuthConfigSecrets({ type: 'bearer', token: 'inline-token' }))
      .resolves.toEqual({ type: 'bearer', token: 'inline-token' });
    expect(fakeProvider.getSecret).not.toHaveBeenCalled();
  });

  it('prefers a configured Vault reference over an inline fallback', async () => {
    __setSecretProviderForTest(fakeProvider);

    await expect(resolveAuthConfigSecrets({
      type: 'oauth2_client_credentials',
      token_url: 'https://idp.example.test/token',
      client_id: 'dugate',
      client_secret: 'inline-fallback',
      client_secret_ref: 'dugate/idp#client_secret',
    })).resolves.toEqual({
      type: 'oauth2_client_credentials',
      token_url: 'https://idp.example.test/token',
      client_id: 'dugate',
      client_secret: 'resolved:dugate/idp#client_secret',
      client_secret_ref: 'dugate/idp#client_secret',
    });
    expect(fakeProvider.getSecret).toHaveBeenCalledWith('dugate/idp#client_secret');
  });

  it('resolves gateway-header Vault references alongside the content credential', async () => {
    __setSecretProviderForTest(fakeProvider);

    await expect(resolveAuthConfigSecrets({
      type: 'oauth2_client_credentials',
      token_url: 'https://idp.example.test/token',
      client_id: 'dugate',
      client_secret: 'inline-secret',
      gateway_headers: [
        { name: 'X-Gateway-Key', value: 'inline-gateway' },
        { name: 'X-Gateway-Secret', value_secret_ref: 'dugate/gateway#secret' },
      ],
    })).resolves.toMatchObject({
      gateway_headers: [
        { name: 'X-Gateway-Key', value: 'inline-gateway' },
        { name: 'X-Gateway-Secret', value: 'resolved:dugate/gateway#secret', value_secret_ref: 'dugate/gateway#secret' },
      ],
    });
    expect(fakeProvider.getSecret).toHaveBeenCalledWith('dugate/gateway#secret');
  });

  it('resolves the UI Vault refs for bearer and API Key header/query modes', async () => {
    __setSecretProviderForTest(fakeProvider);

    await expect(resolveAuthConfigSecrets({ type: 'bearer', token_secret_ref: 'eda/rpa/dugate#bearer' }))
      .resolves.toMatchObject({ token: 'resolved:eda/rpa/dugate#bearer' });
    await expect(resolveAuthConfigSecrets({ type: 'header', header_name: 'X-API-Key', header_value_secret_ref: 'eda/rpa/dugate#header' }))
      .resolves.toMatchObject({ header_value: 'resolved:eda/rpa/dugate#header' });
    await expect(resolveAuthConfigSecrets({ type: 'query', query_key: 'api_key', query_value_secret_ref: 'eda/rpa/dugate#query' }))
      .resolves.toMatchObject({ query_value: 'resolved:eda/rpa/dugate#query' });
    expect(fakeProvider.getSecret).toHaveBeenCalledWith('eda/rpa/dugate#bearer');
    expect(fakeProvider.getSecret).toHaveBeenCalledWith('eda/rpa/dugate#header');
    expect(fakeProvider.getSecret).toHaveBeenCalledWith('eda/rpa/dugate#query');
  });

  it('warns and returns no credentials when Vault resolution fails', async () => {
    const warn = jest.fn();
    const failingProvider: SecretProvider = {
      ...fakeProvider,
      getSecret: jest.fn().mockRejectedValue(new Error('Vault unavailable')),
    };
    __setSecretProviderForTest(failingProvider);

    await expect(resolveAuthConfigSecrets({
      type: 'header',
      header_name: 'X-API-Key',
      header_value_secret_ref: 'dugate/header',
    }, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('credentials were not attached'));
    expect(warn.mock.calls.flat().join(' ')).not.toContain('dugate/header');
  });
});
