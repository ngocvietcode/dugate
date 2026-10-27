import { applyQueryAuth, buildSyncAuthHeaders } from '@/lib/auth-config/apply';

describe('synchronous auth application', () => {
  it('preserves the no-auth and bearer behavior', () => {
    expect(buildSyncAuthHeaders({ type: 'none' })).toEqual({});
    expect(buildSyncAuthHeaders({ type: 'bearer', token: 'access-token' }))
      .toEqual({ Authorization: 'Bearer access-token' });
  });

  it('preserves custom header behavior', () => {
    expect(buildSyncAuthHeaders({ type: 'header', header_name: 'X-API-Key', header_value: 'key-value' }))
      .toEqual({ 'X-API-Key': 'key-value' });
  });

  it('preserves query parameter behavior and leaves malformed URLs unchanged', () => {
    expect(applyQueryAuth('https://files.example.test/report.pdf?existing=true', {
      type: 'query',
      query_key: 'access_token',
      query_value: 'query-token',
    })).toBe('https://files.example.test/report.pdf?existing=true&access_token=query-token');
    expect(applyQueryAuth('not a URL', {
      type: 'query',
      query_key: 'access_token',
      query_value: 'query-token',
    })).toBe('not a URL');
  });

  it('does not synchronously attach OAuth2 credentials', () => {
    expect(buildSyncAuthHeaders({
      type: 'oauth2_client_credentials',
      token_url: 'https://idp.example.test/token',
      client_id: 'dugate',
      client_secret: 'secret',
    })).toEqual({});
  });
});
