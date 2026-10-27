import http from 'node:http';
import type { AddressInfo } from 'node:net';

jest.mock('@/lib/storage', () => ({
  getStorageBackend: jest.fn(),
}));
jest.mock('@/lib/storage/dedup', () => ({
  dedup: jest.fn(),
}));

import { __setSecretProviderForTest } from '@/lib/secrets';
import type { SecretProvider } from '@/lib/secrets';
import { getStorageBackend } from '@/lib/storage';
import { dedup } from '@/lib/storage/dedup';
import { clearCspTokenCache, getCspToken } from '@/lib/csp-token';
import { getOAuth2Token } from '@/lib/auth-config/oauth2-token';
import { downloadFileUrl } from '@/lib/file-url-downloader';

const mockedGetStorageBackend = getStorageBackend as jest.MockedFunction<typeof getStorageBackend>;
const mockedDedup = dedup as jest.MockedFunction<typeof dedup>;
const FILE_CONTENT = Buffer.from('0123456789');

type CapturedRequest = { headers: http.IncomingHttpHeaders; body: string };

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function sendFile(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  expectedToken: string,
): void {
  if (request.headers.authorization !== `Bearer ${expectedToken}`) {
    response.writeHead(401);
    response.end('missing bearer token');
    return;
  }
  const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
  const body = match
    ? FILE_CONTENT.subarray(Number(match[1]), Math.min(Number(match[2]) + 1, FILE_CONTENT.length))
    : FILE_CONTENT;
  response.writeHead(match ? 206 : 200, {
    'content-type': 'application/pdf',
    'content-length': body.length,
    'content-disposition': 'attachment; filename="from-server.pdf"',
  });
  response.end(body);
}

describe('OAuth2 client-credentials token download', () => {
  let server: http.Server;
  let baseUrl: string;
  let requestHandler: (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;
  let uploadedFiles: Buffer[];
  const originalAllowedPrivateHosts = process.env.ALLOWED_PRIVATE_HOSTS;

  beforeAll(async () => {
    process.env.ALLOWED_PRIVATE_HOSTS = 'localhost';
    server = http.createServer((request, response) => {
      void requestHandler(request, response).catch((error) => {
        response.writeHead(500);
        response.end(error instanceof Error ? error.message : 'unexpected test server error');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    uploadedFiles = [];
    const backend = {
      upload: jest.fn(async (storageKey: string, stream: AsyncIterable<Uint8Array>) => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const file = Buffer.concat(chunks);
        uploadedFiles.push(file);
        return { s3Key: storageKey, bytesWritten: file.length, md5: 'mock-md5' };
      }),
      delete: jest.fn(async () => undefined),
    };
    mockedGetStorageBackend.mockResolvedValue(backend as unknown as Awaited<ReturnType<typeof getStorageBackend>>);
    mockedDedup.mockImplementation(async (_md5, s3Key) => ({ id: 'cache-id', s3Key }));
    requestHandler = async (_request, response) => {
      response.writeHead(404);
      response.end();
    };
  });

  afterEach(() => {
    __setSecretProviderForTest(null);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (originalAllowedPrivateHosts === undefined) delete process.env.ALLOWED_PRIVATE_HOSTS;
    else process.env.ALLOWED_PRIVATE_HOSTS = originalAllowedPrivateHosts;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('downloads with form/body credentials resolved from Vault and uses configured chunks', async () => {
    let tokenRequest: CapturedRequest | undefined;
    const fileRequests: CapturedRequest[] = [];
    requestHandler = async (request, response) => {
      const body = await readBody(request);
      if (request.url === '/form-token') {
        tokenRequest = { headers: request.headers, body };
        sendJson(response, 200, { access_token: 'form-download-token', expires_in: 900 });
        return;
      }
      if (request.url === '/form-file.pdf') {
        fileRequests.push({ headers: request.headers, body });
        sendFile(request, response, 'form-download-token');
        return;
      }
      response.writeHead(404);
      response.end();
    };
    const secretProvider: SecretProvider = {
      getSecret: jest.fn(async () => 'vault-form-secret'),
      testResolve: jest.fn(async () => ({ ok: true as const })),
      invalidate: jest.fn(),
    };
    __setSecretProviderForTest(secretProvider);

    await expect(downloadFileUrl({
      url: `${baseUrl}/form-file.pdf`,
      filename: 'form-file.pdf',
      total_chunks: 3,
    }, 'form-operation', 0, {
      type: 'oauth2_client_credentials',
      token_url: `${baseUrl}/form-token`,
      client_id: 'form-client',
      client_secret_ref: 'vault/form-client',
      token_body_format: 'form',
      token_auth_style: 'body',
      scope: 'documents.read',
      audience: 'file-api',
      csp_chunk_size: 4,
    })).resolves.toMatchObject({ name: 'form-file.pdf', size: FILE_CONTENT.length });

    expect(secretProvider.getSecret).toHaveBeenCalledWith('vault/form-client');
    expect(tokenRequest?.headers['content-type']).toContain('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(tokenRequest?.body))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'form-client',
      client_secret: 'vault-form-secret',
      scope: 'documents.read',
      audience: 'file-api',
    });
    expect(fileRequests.map(({ headers }) => headers.authorization)).toEqual([
      'Bearer form-download-token',
      'Bearer form-download-token',
      'Bearer form-download-token',
    ]);
    expect(fileRequests.map(({ headers }) => headers.range)).toEqual(['bytes=0-3', 'bytes=4-7', 'bytes=8-11']);
    expect(uploadedFiles).toEqual([FILE_CONTENT]);
  });

  it('downloads with json/basic credentials and a configured token response path', async () => {
    let tokenRequest: CapturedRequest | undefined;
    let fileRequest: CapturedRequest | undefined;
    requestHandler = async (request, response) => {
      const body = await readBody(request);
      if (request.url === '/basic-token') {
        tokenRequest = { headers: request.headers, body };
        sendJson(response, 200, { payload: { token: 'basic-download-token' } });
        return;
      }
      if (request.url === '/basic-file.pdf') {
        fileRequest = { headers: request.headers, body };
        sendFile(request, response, 'basic-download-token');
        return;
      }
      response.writeHead(404);
      response.end();
    };

    await expect(downloadFileUrl({ url: `${baseUrl}/basic-file.pdf`, filename: 'basic-file.pdf' }, 'basic-operation', 0, {
      type: 'oauth2_client_credentials',
      token_url: `${baseUrl}/basic-token`,
      client_id: 'basic-client',
      client_secret: 'json-basic-secret',
      token_body_format: 'json',
      token_auth_style: 'basic',
      scope: 'documents.write',
      audience: 'file-api',
      token_response_path: 'payload.token',
    })).resolves.toMatchObject({ name: 'basic-file.pdf', size: FILE_CONTENT.length });

    expect(tokenRequest?.headers['content-type']).toContain('application/json');
    expect(tokenRequest?.headers.authorization).toBe(`Basic ${Buffer.from('basic-client:json-basic-secret').toString('base64')}`);
    expect(JSON.parse(tokenRequest?.body ?? '')).toEqual({
      grant_type: 'client_credentials',
      scope: 'documents.write',
      audience: 'file-api',
    });
    expect(tokenRequest?.body).not.toContain('json-basic-secret');
    expect(fileRequest?.headers.authorization).toBe('Bearer basic-download-token');
  });

  it('fails download on a token 401 without exposing the client secret', async () => {
    requestHandler = async (request, response) => {
      await readBody(request);
      if (request.url === '/error-token') {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end('{"error":"invalid_client","client_secret":"must-not-leak"}');
        return;
      }
      response.writeHead(404);
      response.end();
    };

    await expect(downloadFileUrl({ url: `${baseUrl}/never-fetched.pdf`, filename: 'never-fetched.pdf' }, 'error-operation', 0, {
      type: 'oauth2_client_credentials',
      token_url: `${baseUrl}/error-token`,
      client_id: 'error-client',
      client_secret: 'must-not-leak',
    })).rejects.toThrow('OAuth2 token request failed (HTTP 401)');
    try {
      await downloadFileUrl({ url: `${baseUrl}/never-fetched.pdf`, filename: 'never-fetched.pdf' }, 'error-operation', 0, {
        type: 'oauth2_client_credentials', token_url: `${baseUrl}/error-token`, client_id: 'error-client-2', client_secret: 'must-not-leak',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('must-not-leak');
      expect((error as Error).message).not.toContain('client_secret');
    }
  });

  it('uses separate generic cache entries for different scopes', async () => {
    let requests = 0;
    requestHandler = async (request, response) => {
      await readBody(request);
      if (request.url === '/scope-token') {
        requests += 1;
        sendJson(response, 200, { access_token: `scope-token-${requests}`, expires_in: 900 });
        return;
      }
      response.writeHead(404);
      response.end();
    };
    const config = { token_url: `${baseUrl}/scope-token`, client_id: 'scope-client', client_secret: 'scope-secret' };

    await expect(getOAuth2Token({ ...config, scope: 'read' })).resolves.toBe('scope-token-1');
    await expect(getOAuth2Token({ ...config, scope: 'read' })).resolves.toBe('scope-token-1');
    await expect(getOAuth2Token({ ...config, scope: 'write' })).resolves.toBe('scope-token-2');
    expect(requests).toBe(2);
  });

  it('keeps the CSP cache key compatible with clearCspTokenCache', async () => {
    let requests = 0;
    requestHandler = async (request, response) => {
      await readBody(request);
      if (request.url === '/csp-token') {
        requests += 1;
        sendJson(response, 200, { data: { access_token: `csp-token-${requests}`, expires_in: 900 } });
        return;
      }
      response.writeHead(404);
      response.end();
    };
    const config = { token_url: `${baseUrl}/csp-token`, client_id: 'csp-client', client_secret: 'csp-secret' };
    clearCspTokenCache(config);

    await expect(getCspToken(config)).resolves.toBe('csp-token-1');
    await expect(getCspToken(config)).resolves.toBe('csp-token-1');
    clearCspTokenCache(config);
    await expect(getCspToken(config)).resolves.toBe('csp-token-2');
    expect(requests).toBe(2);
  });

  it('reports a missing token response without exposing the configured secret', async () => {
    requestHandler = async (request, response) => {
      await readBody(request);
      if (request.url === '/missing-token') {
        sendJson(response, 200, { message: 'token absent' });
        return;
      }
      response.writeHead(404);
      response.end();
    };

    await expect(getOAuth2Token({
      token_url: `${baseUrl}/missing-token`, client_id: 'missing-client', client_secret: 'missing-secret',
    })).rejects.toThrow('OAuth2 token response missing access_token field');
    try {
      await getOAuth2Token({
        token_url: `${baseUrl}/missing-token`, client_id: 'missing-client-2', client_secret: 'missing-secret',
      });
    } catch (error) {
      expect((error as Error).message).not.toContain('missing-secret');
      expect((error as Error).message).not.toContain('client_secret');
    }
  });

  // ─── APIC gateway header (X-IBM-Client-Id) — carried over from 140be39 ────────

  it('sends X-IBM-Client-Id on the CSP token request when ibm_client_id is set', async () => {
    let tokenRequest: CapturedRequest | undefined;
    requestHandler = async (request, response) => {
      const body = await readBody(request);
      tokenRequest = { headers: request.headers, body };
      sendJson(response, 200, { access_token: 'ibm-token', expires_in: 900 });
    };
    const config = {
      token_url: `${baseUrl}/csp-ibm-token`,
      client_id: 'ibm-client',
      client_secret: 'ibm-secret',
      ibm_client_id: 'gateway-42',
    };
    clearCspTokenCache(config);

    await expect(getCspToken(config)).resolves.toBe('ibm-token');
    expect(tokenRequest?.headers['x-ibm-client-id']).toBe('gateway-42');
  });

  it('does not share a CSP token across different ibm_client_id gateways', async () => {
    let requests = 0;
    requestHandler = async (request, response) => {
      await readBody(request);
      requests += 1;
      sendJson(response, 200, { access_token: `ibm-token-${requests}`, expires_in: 900 });
    };
    const base = { token_url: `${baseUrl}/csp-multi-gw`, client_id: 'shared-client', client_secret: 'shared-secret' };
    clearCspTokenCache({ ...base, ibm_client_id: 'gw-a' });
    clearCspTokenCache({ ...base, ibm_client_id: 'gw-b' });

    await expect(getCspToken({ ...base, ibm_client_id: 'gw-a' })).resolves.toBe('ibm-token-1');
    await expect(getCspToken({ ...base, ibm_client_id: 'gw-a' })).resolves.toBe('ibm-token-1');
    await expect(getCspToken({ ...base, ibm_client_id: 'gw-b' })).resolves.toBe('ibm-token-2');
    expect(requests).toBe(2);
  });

  it('sends X-IBM-Client-Id on both the CSP token and file download requests', async () => {
    let tokenRequest: CapturedRequest | undefined;
    const fileRequests: CapturedRequest[] = [];
    requestHandler = async (request, response) => {
      const body = await readBody(request);
      if (request.url === '/csp-dl-token') {
        tokenRequest = { headers: request.headers, body };
        sendJson(response, 200, { access_token: 'csp-dl-token', expires_in: 900 });
        return;
      }
      if (request.url === '/csp-dl-file.pdf') {
        fileRequests.push({ headers: request.headers, body });
        sendFile(request, response, 'csp-dl-token');
        return;
      }
      response.writeHead(404);
      response.end();
    };
    clearCspTokenCache({ token_url: `${baseUrl}/csp-dl-token`, client_id: 'dl-client', client_secret: 'dl-secret', ibm_client_id: 'gw-dl' });

    await expect(downloadFileUrl({ url: `${baseUrl}/csp-dl-file.pdf`, filename: 'csp-dl-file.pdf' }, 'csp-dl-op', 0, {
      type: 'csp_oauth2',
      token_url: `${baseUrl}/csp-dl-token`,
      client_id: 'dl-client',
      client_secret: 'dl-secret',
      ibm_client_id: 'gw-dl',
    })).resolves.toMatchObject({ name: 'csp-dl-file.pdf' });

    expect(tokenRequest?.headers['x-ibm-client-id']).toBe('gw-dl');
    expect(fileRequests[0]?.headers['x-ibm-client-id']).toBe('gw-dl');
  });

  it('sends X-IBM-Client-Id for oauth2_client_credentials downloads too', async () => {
    let tokenRequest: CapturedRequest | undefined;
    const fileRequests: CapturedRequest[] = [];
    requestHandler = async (request, response) => {
      const body = await readBody(request);
      if (request.url === '/occ-token') {
        tokenRequest = { headers: request.headers, body };
        sendJson(response, 200, { access_token: 'occ-token', expires_in: 900 });
        return;
      }
      if (request.url === '/occ-file.pdf') {
        fileRequests.push({ headers: request.headers, body });
        sendFile(request, response, 'occ-token');
        return;
      }
      response.writeHead(404);
      response.end();
    };

    await expect(downloadFileUrl({ url: `${baseUrl}/occ-file.pdf`, filename: 'occ-file.pdf' }, 'occ-op', 0, {
      type: 'oauth2_client_credentials',
      token_url: `${baseUrl}/occ-token`,
      client_id: 'occ-client',
      client_secret: 'occ-secret',
      ibm_client_id: 'gw-occ',
    })).resolves.toMatchObject({ name: 'occ-file.pdf' });

    expect(tokenRequest?.headers['x-ibm-client-id']).toBe('gw-occ');
    expect(fileRequests[0]?.headers['x-ibm-client-id']).toBe('gw-occ');
  });

  it('sends resolved gateway headers on OAuth2 token and every ranged file request', async () => {
    let tokenRequest: CapturedRequest | undefined;
    const fileRequests: CapturedRequest[] = [];
    requestHandler = async (request, response) => {
      const body = await readBody(request);
      if (request.url === '/gateway-token') {
        tokenRequest = { headers: request.headers, body };
        sendJson(response, 200, { access_token: 'gateway-token', expires_in: 900 });
        return;
      }
      if (request.url === '/gateway-file.pdf') {
        fileRequests.push({ headers: request.headers, body });
        sendFile(request, response, 'gateway-token');
        return;
      }
      response.writeHead(404);
      response.end();
    };
    const secretProvider: SecretProvider = {
      getSecret: jest.fn(async () => 'vault-gateway-secret'),
      testResolve: jest.fn(async () => ({ ok: true as const })),
      invalidate: jest.fn(),
    };
    __setSecretProviderForTest(secretProvider);

    await expect(downloadFileUrl({
      url: `${baseUrl}/gateway-file.pdf`, filename: 'gateway-file.pdf', total_chunks: 3,
    }, 'gateway-op', 0, {
      type: 'oauth2_client_credentials',
      token_url: `${baseUrl}/gateway-token`,
      client_id: 'gateway-client',
      client_secret: 'gateway-secret',
      csp_chunk_size: 4,
      gateway_headers: [
        { name: 'X-Gateway-Client', value: 'gateway-client-key' },
        { name: 'X-Gateway-Secret', value_secret_ref: 'vault/gateway-secret' },
      ],
    })).resolves.toMatchObject({ name: 'gateway-file.pdf' });

    expect(secretProvider.getSecret).toHaveBeenCalledWith('vault/gateway-secret');
    expect(tokenRequest?.headers['x-gateway-client']).toBe('gateway-client-key');
    expect(tokenRequest?.headers['x-gateway-secret']).toBe('vault-gateway-secret');
    expect(fileRequests).toHaveLength(3);
    for (const request of fileRequests) {
      expect(request.headers['x-gateway-client']).toBe('gateway-client-key');
      expect(request.headers['x-gateway-secret']).toBe('vault-gateway-secret');
    }
  });

  it('does not share generic OAuth2 tokens across different gateway headers', async () => {
    let requests = 0;
    requestHandler = async (request, response) => {
      await readBody(request);
      if (request.url === '/generic-gateway-token') {
        requests += 1;
        sendJson(response, 200, { access_token: `gateway-cache-${requests}`, expires_in: 900 });
        return;
      }
      response.writeHead(404);
      response.end();
    };
    const config = {
      token_url: `${baseUrl}/generic-gateway-token`,
      client_id: 'gateway-cache-client',
      client_secret: 'gateway-cache-secret',
    };

    await expect(getOAuth2Token({ ...config, token_extra_headers: { 'X-Gateway': 'one' } })).resolves.toBe('gateway-cache-1');
    await expect(getOAuth2Token({ ...config, token_extra_headers: { 'X-Gateway': 'one' } })).resolves.toBe('gateway-cache-1');
    await expect(getOAuth2Token({ ...config, token_extra_headers: { 'X-Gateway': 'two' } })).resolves.toBe('gateway-cache-2');
    expect(requests).toBe(2);
  });
});
