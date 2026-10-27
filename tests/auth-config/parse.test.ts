import { parseFileUrlAuthConfig } from '@/lib/auth-config/parse';
import { parseFileUrlAuthConfig as parseFileUrlAuthConfigReExport } from '@/lib/file-url-downloader';

describe('parseFileUrlAuthConfig', () => {
  const validClientCredentials = {
    type: 'oauth2_client_credentials',
    token_url: 'https://idp.example.test/oauth/token',
    client_id: 'dugate',
    client_secret: 'client-secret',
  };

  it('keeps the existing csp_oauth2 result unchanged', () => {
    const config = {
      type: 'csp_oauth2',
      token_url: 'https://idp.example.test/csp/token',
      client_id: 'legacy-client',
      client_secret: 'legacy-secret',
      csp_chunk_size: 1024,
    };

    expect(parseFileUrlAuthConfig(config)).toEqual(config);
    expect(parseFileUrlAuthConfigReExport(config)).toEqual(config);
  });

  it('parses OAuth2 client credentials with secure defaults', () => {
    expect(parseFileUrlAuthConfig(validClientCredentials)).toEqual({
      ...validClientCredentials,
      token_body_format: 'form',
      token_auth_style: 'body',
    });
  });

  it.each([
    ['token_url', { ...validClientCredentials, token_url: undefined }],
    ['client_id', { ...validClientCredentials, client_id: undefined }],
    ['client_secret', { ...validClientCredentials, client_secret: undefined }],
  ])('rejects missing required OAuth2 field %s', (_field, config) => {
    expect(parseFileUrlAuthConfig(config)).toBeUndefined();
  });

  it.each([
    ['ftp token URL', { ...validClientCredentials, token_url: 'ftp://idp.example.test/token' }],
    ['invalid body format', { ...validClientCredentials, token_body_format: 'xml' }],
    ['invalid auth style', { ...validClientCredentials, token_auth_style: 'token' }],
    ['invalid scope', { ...validClientCredentials, scope: 'scope\r\nother' }],
    ['invalid chunk size', { ...validClientCredentials, csp_chunk_size: 0 }],
  ])('rejects %s', (_name, config) => {
    expect(parseFileUrlAuthConfig(config)).toBeUndefined();
  });

  it('keeps valid optional OAuth2 settings and accepts a Vault client-secret ref', () => {
    expect(parseFileUrlAuthConfig({
      ...validClientCredentials,
      client_secret: undefined,
      client_secret_ref: 'dugate/integrations/idp#client_secret',
      token_body_format: 'json',
      token_auth_style: 'basic',
      scope: 'documents.read',
      audience: 'integration-api',
      token_response_path: 'payload.access.token',
      csp_chunk_size: 2048,
    })).toEqual({
      type: 'oauth2_client_credentials',
      token_url: validClientCredentials.token_url,
      client_id: validClientCredentials.client_id,
      client_secret_ref: 'dugate/integrations/idp#client_secret',
      token_body_format: 'json',
      token_auth_style: 'basic',
      scope: 'documents.read',
      audience: 'integration-api',
      token_response_path: 'payload.access.token',
      csp_chunk_size: 2048,
    });
  });

  it('parses Vault references for each existing credential type', () => {
    expect(parseFileUrlAuthConfig({ type: 'bearer', token_secret_ref: 'dugate/token' }))
      .toEqual({ type: 'bearer', token_secret_ref: 'dugate/token' });
    expect(parseFileUrlAuthConfig({ type: 'header', header_name: 'X-API-Key', header_value_secret_ref: 'dugate/header' }))
      .toEqual({ type: 'header', header_name: 'X-API-Key', header_value_secret_ref: 'dugate/header' });
    expect(parseFileUrlAuthConfig({ type: 'query', query_key: 'access_token', query_value_secret_ref: 'dugate/query' }))
      .toEqual({ type: 'query', query_key: 'access_token', query_value_secret_ref: 'dugate/query' });
    expect(parseFileUrlAuthConfig({
      type: 'csp_oauth2',
      token_url: 'https://idp.example.test/csp/token',
      client_id: 'legacy-client',
      client_secret_ref: 'dugate/csp',
    })).toEqual({
      type: 'csp_oauth2',
      token_url: 'https://idp.example.test/csp/token',
      client_id: 'legacy-client',
      client_secret_ref: 'dugate/csp',
    });
  });

  it('rejects an unknown type', () => {
    expect(parseFileUrlAuthConfig({ type: 'oauth1' })).toBeUndefined();
  });

  it('normalizes ibm_client_id into a gateway header while retaining the legacy field', () => {
    const csp = parseFileUrlAuthConfig({
      type: 'csp_oauth2',
      token_url: 'https://idp.example.test/csp/token',
      client_id: 'legacy-client',
      client_secret: 'legacy-secret',
      ibm_client_id: 'gateway-1',
    });
    expect(csp).toMatchObject({
      type: 'csp_oauth2',
      ibm_client_id: 'gateway-1',
      gateway_headers: [{ name: 'X-IBM-Client-Id', value: 'gateway-1' }],
    });

    expect(parseFileUrlAuthConfig({
      ...validClientCredentials,
      ibm_client_id: 'gateway-2',
    })).toMatchObject({
      type: 'oauth2_client_credentials',
      ibm_client_id: 'gateway-2',
      gateway_headers: [{ name: 'X-IBM-Client-Id', value: 'gateway-2' }],
    });
  });

  it('accepts valid gateway headers, resolves Vault refs later, and lets an explicit IBM header win', () => {
    expect(parseFileUrlAuthConfig({
      type: 'bearer',
      token: 'content-token',
      ibm_client_id: 'legacy-gateway',
      gateway_headers: [
        { name: 'X-Gateway-Key', value_secret_ref: 'vault/gateway-key' },
        { name: 'x-ibm-client-id', value: 'explicit-gateway' },
        { name: 'Authorization', value: 'must-be-ignored' },
        { name: 'Bad Header', value: 'must-be-ignored' },
      ],
    })).toEqual({
      type: 'bearer',
      token: 'content-token',
      gateway_headers: [
        { name: 'X-Gateway-Key', value_secret_ref: 'vault/gateway-key' },
        { name: 'x-ibm-client-id', value: 'explicit-gateway' },
      ],
    });
  });

  it('ignores an invalid ibm_client_id but keeps the config valid (lenient pass-through)', () => {
    const parsed = parseFileUrlAuthConfig({ ...validClientCredentials, ibm_client_id: 42 });
    expect(parsed).toBeDefined();
    expect(parsed?.type).toBe('oauth2_client_credentials');
    expect(parsed).not.toHaveProperty('ibm_client_id');
  });
});
