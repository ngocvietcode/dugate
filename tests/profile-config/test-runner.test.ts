import http from 'node:http';
import type { AddressInfo } from 'node:net';

const mockLimit = jest.fn();
const mockSelect = jest.fn(() => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }));
const mockOperationsInsert = jest.fn();
const mockOperationsUpdate = jest.fn();
const mockGetSecret = jest.fn(async (reference: string) => ({
  'vault/oauth-client': 'oauth-client-secret',
  'vault/gateway': 'gateway-secret',
}[reference]));

jest.mock('@/lib/db', () => ({
  db: {
    select: mockSelect,
    insert: mockOperationsInsert,
    update: mockOperationsUpdate,
  },
}));
jest.mock('@/lib/db/schema', () => ({
  apiKeys: { id: 'id', fileAuthConfig: 'fileAuthConfig', callbackAuthConfig: 'callbackAuthConfig' },
  profileEndpoints: { apiKeyId: 'apiKeyId', endpointSlug: 'endpointSlug', fileUrlAuthConfig: 'fileUrlAuthConfig' },
  operations: { id: 'id' },
}));
jest.mock('drizzle-orm', () => ({ eq: (...values: unknown[]) => values, and: (...values: unknown[]) => values }));
jest.mock('@/lib/secrets', () => ({ getSecretProvider: () => ({ getSecret: mockGetSecret }) }));
// The two test routes use a two-phase guard: endpoint:manage before the body is
// parsed, then per-Profile access once apiKeyId is known.
jest.mock('@/lib/auth-guard', () => ({
  requireCapability: jest.fn().mockResolvedValue({ session: { user: { id: 'u1', username: 'admin', role: 'ADMIN' } } }),
  requireProfileAccess: jest.fn().mockResolvedValue({ session: { user: { id: 'u1', username: 'admin', role: 'ADMIN' } } }),
}));

import { requireCapability, requireProfileAccess } from '@/lib/auth-guard';
import { testCallback, testFileUrl } from '@/lib/profile-config/test-runner';
import { POST as postFileTest } from '@/app/api/internal/profile-endpoints/test-file-url/route';
import { POST as postCallbackTest } from '@/app/api/internal/profile-endpoints/test-callback/route';

const mockedRequireCapability = requireCapability as jest.MockedFunction<typeof requireCapability>;
const mockedRequireProfileAccess = requireProfileAccess as jest.MockedFunction<typeof requireProfileAccess>;

type CapturedRequest = { url: string | undefined; headers: http.IncomingHttpHeaders; body: string };

function bodyOf(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function routeRequest(body: unknown) {
  return { json: jest.fn(async () => body) } as unknown as Parameters<typeof postFileTest>[0];
}

describe('profile integration test runner (T9)', () => {
  let server: http.Server;
  let baseUrl: string;
  let received: CapturedRequest[];
  const originalPrivateHosts = process.env.ALLOWED_PRIVATE_HOSTS;
  const originalFileOrigins = process.env.ALLOWED_FILE_AUTH_ORIGINS;
  const originalWebhookOrigins = process.env.ALLOWED_WEBHOOK_ORIGINS;

  beforeAll(async () => {
    process.env.ALLOWED_PRIVATE_HOSTS = 'localhost';
    server = http.createServer((request, response) => {
      void (async () => {
        const body = await bodyOf(request);
        received.push({ url: request.url, headers: request.headers, body });
        if (request.url === '/file.pdf') {
          response.writeHead(206, {
            'content-type': 'application/pdf',
            'content-length': '10',
            'content-disposition': 'attachment; filename="server-file.pdf"',
          });
          response.end('0123456789');
          return;
        }
        if (request.url === '/token') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"access_token":"test-oauth-token","expires_in":900}');
          return;
        }
        if (request.url === '/callback') {
          response.writeHead(202, { 'content-type': 'application/json' });
          response.end('{"accepted":true}');
          return;
        }
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found token=should-not-leak');
      })().catch(() => {
        response.writeHead(500);
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    received = [];
    mockLimit.mockReset();
    mockGetSecret.mockClear();
    mockLimit.mockResolvedValue([]);
    jest.clearAllMocks();
    const allowed = { session: { user: { id: 'u1', username: 'admin', role: 'ADMIN' } } };
    mockedRequireCapability.mockResolvedValue(allowed as Awaited<ReturnType<typeof requireCapability>>);
    mockedRequireProfileAccess.mockResolvedValue(
      { ...allowed, allowed: true } as Awaited<ReturnType<typeof requireProfileAccess>>,
    );
    process.env.ALLOWED_FILE_AUTH_ORIGINS = baseUrl;
    process.env.ALLOWED_WEBHOOK_ORIGINS = baseUrl;
  });

  afterAll(async () => {
    if (originalPrivateHosts === undefined) delete process.env.ALLOWED_PRIVATE_HOSTS;
    else process.env.ALLOWED_PRIVATE_HOSTS = originalPrivateHosts;
    if (originalFileOrigins === undefined) delete process.env.ALLOWED_FILE_AUTH_ORIGINS;
    else process.env.ALLOWED_FILE_AUTH_ORIGINS = originalFileOrigins;
    if (originalWebhookOrigins === undefined) delete process.env.ALLOWED_WEBHOOK_ORIGINS;
    else process.env.ALLOWED_WEBHOOK_ORIGINS = originalWebhookOrigins;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('performs a bounded ranged file GET with temporary auth and gateway headers without persistence', async () => {
    await expect(testFileUrl({
      apiKeyId: 'profile-1', endpointSlug: 'extract', url: `${baseUrl}/file.pdf`,
      authConfig: {
        type: 'bearer', token: 'test-file-token',
        gateway_headers: [{ name: 'X-Gateway-Client', value: 'gateway-key' }],
      },
    })).resolves.toEqual({
      ok: true, httpStatus: 206, contentType: 'application/pdf', contentLength: 10, filenameResolved: 'server-file.pdf',
    });
    expect(received).toHaveLength(1);
    expect(received[0].headers.range).toBe('bytes=0-4095');
    expect(received[0].headers.authorization).toBe('Bearer test-file-token');
    expect(received[0].headers['x-gateway-client']).toBe('gateway-key');
    expect(mockSelect).not.toHaveBeenCalled(); // Valid temporary config takes precedence over saved config.
    expect(mockOperationsInsert).not.toHaveBeenCalled();
    expect(mockOperationsUpdate).not.toHaveBeenCalled();
  });

  it('summarizes remote file failures without returning the response body', async () => {
    const result = await testFileUrl({ apiKeyId: 'profile-1', endpointSlug: 'extract', url: `${baseUrl}/missing` });
    expect(result).toEqual({ ok: false, httpStatus: 404, errorSummary: 'File server returned HTTP 404.' });
    expect(result.errorSummary).not.toContain('should-not-leak');
    expect(mockOperationsInsert).not.toHaveBeenCalled();
    expect(mockOperationsUpdate).not.toHaveBeenCalled();
  });

  // The per-endpoint override was removed: with no temporary auth on the form, the test
  // run must fall back to the Profile-level ApiKey.fileAuthConfig.
  it('loads saved Profile file auth when temporary auth is omitted', async () => {
    mockLimit.mockResolvedValueOnce([{
      fileAuthConfig: JSON.stringify({ type: 'header', header_name: 'X-Profile-Token', header_value: 'saved-profile-token' }),
    }]);
    await expect(testFileUrl({ apiKeyId: 'profile-1', endpointSlug: 'extract', url: `${baseUrl}/file.pdf` })).resolves.toMatchObject({
      ok: true, httpStatus: 206,
    });
    expect(received).toHaveLength(1);
    expect(received[0].headers['x-profile-token']).toBe('saved-profile-token');
    expect(mockOperationsInsert).not.toHaveBeenCalled();
    expect(mockOperationsUpdate).not.toHaveBeenCalled();
  });

  it('resolves OAuth2 and gateway secrets, then carries gateway headers to token and ranged file requests', async () => {
    await expect(testFileUrl({
      apiKeyId: 'profile-1', endpointSlug: 'extract', url: `${baseUrl}/file.pdf`,
      authConfig: {
        type: 'oauth2_client_credentials',
        token_url: `${baseUrl}/token`,
        client_id: 'test-client',
        client_secret_ref: 'vault/oauth-client',
        gateway_headers: [{ name: 'X-Gateway-Secret', value_secret_ref: 'vault/gateway' }],
      },
    })).resolves.toMatchObject({ ok: true, httpStatus: 206 });

    expect(mockGetSecret).toHaveBeenCalledWith('vault/oauth-client');
    expect(mockGetSecret).toHaveBeenCalledWith('vault/gateway');
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(expect.objectContaining({
      url: '/token', headers: expect.objectContaining({ 'x-gateway-secret': 'gateway-secret' }),
    }));
    expect(received[1]).toEqual(expect.objectContaining({
      url: '/file.pdf', headers: expect.objectContaining({
        authorization: 'Bearer test-oauth-token',
        'x-gateway-secret': 'gateway-secret',
        range: 'bytes=0-4095',
      }),
    }));
    expect(mockOperationsInsert).not.toHaveBeenCalled();
    expect(mockOperationsUpdate).not.toHaveBeenCalled();
  });

  it('loads saved callback auth when no temporary auth overrides it and sends one recognizable default payload', async () => {
    mockLimit.mockResolvedValueOnce([{
      callbackAuthConfig: JSON.stringify({ type: 'header', header_name: 'X-Profile-Token', header_value: 'saved-token' }),
    }]);
    await expect(testCallback({ apiKeyId: 'profile-1', endpointSlug: 'extract', url: `${baseUrl}/callback` })).resolves.toMatchObject({
      ok: true, httpStatus: 202,
    });
    expect(received).toHaveLength(1);
    expect(received[0].headers['x-profile-token']).toBe('saved-token');
    expect(JSON.parse(received[0].body)).toEqual({
      operation_id: '00000000-0000-0000-0000-000000000000',
      state: 'SUCCEEDED',
      done: true,
      extracted_data: { _test: true },
    });
    expect(mockOperationsInsert).not.toHaveBeenCalled();
    expect(mockOperationsUpdate).not.toHaveBeenCalled();
  });

  it('rejects callback query authentication before a request is sent', async () => {
    const result = await postCallbackTest(routeRequest({
      apiKeyId: 'profile-1', endpointSlug: 'extract', callbackUrl: `${baseUrl}/callback`,
      authConfig: { type: 'query', query_key: 'api_key', query_value: 'secret' },
    }) as Parameters<typeof postCallbackTest>[0]);
    expect(result.status).toBe(400);
    expect(received).toHaveLength(0);
  });

  it('checks the endpoint:manage capability before parsing the body or touching configuration', async () => {
    const denied = new (require('next/server').NextResponse)(null, { status: 403 });
    mockedRequireCapability.mockResolvedValueOnce(denied as Awaited<ReturnType<typeof requireCapability>>);
    const request = { json: jest.fn(async () => { throw new Error('must not parse'); }) } as unknown as Parameters<typeof postFileTest>[0];
    const result = await postFileTest(request);
    expect(result.status).toBe(403);
    expect(request.json).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
