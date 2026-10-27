import http from 'node:http';
import type { AddressInfo } from 'node:net';

jest.mock('@/lib/storage', () => ({ getStorageBackend: jest.fn() }));
jest.mock('@/lib/storage/dedup', () => ({ dedup: jest.fn() }));

import { __setSecretProviderForTest } from '@/lib/secrets';
import type { SecretProvider } from '@/lib/secrets';
import { getStorageBackend } from '@/lib/storage';
import { dedup } from '@/lib/storage/dedup';
import { downloadFileUrl } from '@/lib/file-url-downloader';

const mockedGetStorageBackend = getStorageBackend as jest.MockedFunction<typeof getStorageBackend>;
const mockedDedup = dedup as jest.MockedFunction<typeof dedup>;
const content = Buffer.from('minimal pdf bytes');

async function consume(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function sendFile(response: http.ServerResponse): void {
  response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': content.length });
  response.end(content);
}

describe('downloadFileUrl secret references', () => {
  let server: http.Server;
  let baseUrl: string;
  let requests: Array<{ url: string; headers: http.IncomingHttpHeaders; body: string }>;
  const originalPrivateHosts = process.env.ALLOWED_PRIVATE_HOSTS;
  const originalFileOrigins = process.env.ALLOWED_FILE_AUTH_ORIGINS;

  beforeAll(async () => {
    process.env.ALLOWED_PRIVATE_HOSTS = 'localhost';
    server = http.createServer((request, response) => {
      void consume(request).then((body) => {
        requests.push({ url: request.url ?? '', headers: request.headers, body });
        if (request.url === '/csp-token') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ access_token: 'csp-token', expires_in: 900 }));
          return;
        }
        if (request.url === '/bearer.pdf') {
          if (request.headers.authorization !== 'Bearer bearer-secret') return response.end('missing bearer');
          return sendFile(response);
        }
        if (request.url === '/header.pdf') {
          if (request.headers['x-file-key'] !== 'header-secret') return response.end('missing header');
          return sendFile(response);
        }
        if (request.url === '/query.pdf?access_token=query-secret') return sendFile(response);
        if (request.url === '/csp.pdf') {
          if (request.headers.authorization !== 'Bearer csp-token') return response.end('missing CSP token');
          return sendFile(response);
        }
        response.writeHead(404);
        response.end('unexpected request');
      }).catch(() => { response.writeHead(500); response.end(); });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    requests = [];
    process.env.ALLOWED_FILE_AUTH_ORIGINS = baseUrl;
    mockedGetStorageBackend.mockResolvedValue({
      upload: jest.fn(async (key: string, stream: AsyncIterable<Uint8Array>) => {
        let size = 0;
        for await (const chunk of stream) size += chunk.length;
        return { s3Key: key, bytesWritten: size, md5: 'mock-md5' };
      }),
      delete: jest.fn(async () => undefined),
    } as never);
    mockedDedup.mockImplementation(async (_md5, s3Key) => ({ id: 'cache-id', s3Key }));
  });

  afterEach(() => {
    __setSecretProviderForTest(null);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (originalPrivateHosts === undefined) delete process.env.ALLOWED_PRIVATE_HOSTS;
    else process.env.ALLOWED_PRIVATE_HOSTS = originalPrivateHosts;
    if (originalFileOrigins === undefined) delete process.env.ALLOWED_FILE_AUTH_ORIGINS;
    else process.env.ALLOWED_FILE_AUTH_ORIGINS = originalFileOrigins;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('resolves bearer, header, query, and CSP client-secret refs exactly once before live requests', async () => {
    const secretProvider: SecretProvider = {
      getSecret: jest.fn(async (ref: string): Promise<string> => {
        const secrets: Record<string, string> = {
          'vault/bearer': 'bearer-secret', 'vault/header': 'header-secret',
          'vault/query': 'query-secret', 'vault/csp': 'csp-secret',
        };
        const secret = secrets[ref];
        if (!secret) throw new Error(`Unexpected secret reference: ${ref}`);
        return secret;
      }),
      testResolve: jest.fn(async () => ({ ok: true as const })),
      invalidate: jest.fn(),
    };
    __setSecretProviderForTest(secretProvider);

    await expect(downloadFileUrl({ url: `${baseUrl}/bearer.pdf` }, 'op-bearer', 0, { type: 'bearer', token_secret_ref: 'vault/bearer' })).resolves.toMatchObject({ size: content.length });
    await expect(downloadFileUrl({ url: `${baseUrl}/header.pdf` }, 'op-header', 0, { type: 'header', header_name: 'X-File-Key', header_value_secret_ref: 'vault/header' })).resolves.toMatchObject({ size: content.length });
    await expect(downloadFileUrl({ url: `${baseUrl}/query.pdf` }, 'op-query', 0, { type: 'query', query_key: 'access_token', query_value_secret_ref: 'vault/query' })).resolves.toMatchObject({ size: content.length });
    await expect(downloadFileUrl({ url: `${baseUrl}/csp.pdf` }, 'op-csp', 0, {
      type: 'csp_oauth2', token_url: `${baseUrl}/csp-token`, client_id: 'csp-client', client_secret_ref: 'vault/csp',
    })).resolves.toMatchObject({ size: content.length });

    expect(secretProvider.getSecret).toHaveBeenCalledTimes(4);
    expect(secretProvider.getSecret).toHaveBeenCalledWith('vault/bearer');
    expect(secretProvider.getSecret).toHaveBeenCalledWith('vault/header');
    expect(secretProvider.getSecret).toHaveBeenCalledWith('vault/query');
    expect(secretProvider.getSecret).toHaveBeenCalledWith('vault/csp');
    expect(requests.map(({ url }) => url)).toEqual(['/bearer.pdf', '/header.pdf', '/query.pdf?access_token=query-secret', '/csp-token', '/csp.pdf']);
  });

  it('fails without exposing a secret reference when credential resolution fails', async () => {
    const secretProvider: SecretProvider = {
      getSecret: jest.fn().mockRejectedValue(new Error('vault unavailable')),
      testResolve: jest.fn(async () => ({ ok: true as const })),
      invalidate: jest.fn(),
    };
    __setSecretProviderForTest(secretProvider);

    await expect(downloadFileUrl({ url: `${baseUrl}/bearer.pdf` }, 'op-fail', 0, {
      type: 'bearer', token_secret_ref: 'vault/should-not-leak',
    })).rejects.toThrow('Profile file credentials could not be resolved');
    expect(requests).toHaveLength(0);
  });
});
