import http from 'node:http';
import type { AddressInfo } from 'node:net';

const mockLimit = jest.fn();
const mockSet = jest.fn();
const mockWhere = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn(() => ({ set: mockSet }));
const mockSelect = jest.fn(() => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }));
mockSet.mockReturnValue({ where: mockWhere });

jest.mock('@/lib/db', () => ({
  db: { select: mockSelect, update: mockUpdate },
}));

jest.mock('@/lib/db/schema', () => ({
  apiKeys: {
    id: 'id', callbackAuthConfig: 'callbackAuthConfig', callbackPayload: 'callbackPayload',
  },
  profileEndpoints: {
    apiKeyId: 'apiKeyId', endpointSlug: 'endpointSlug',
    fileUrlAuthConfig: 'fileUrlAuthConfig', callbackUrlOverride: 'callbackUrlOverride',
    callbackPayloadOverride: 'callbackPayloadOverride',
  },
  operations: { id: 'id' },
}));

jest.mock('drizzle-orm', () => ({
  eq: (column: string, value: string) => ({ column, value }),
  and: (...conditions: unknown[]) => conditions,
}));

jest.mock('@/lib/secrets', () => ({
  getSecretProvider: () => ({ getSecret: jest.fn().mockResolvedValue('resolved-gateway-secret') }),
}));

import { encrypt } from '@/lib/crypto';
import {
  resolveCallbackDeliveryConfig,
  sendConfiguredWebhook,
  type CallbackDeliveryConfig,
} from '@/lib/delivery/webhook-sender';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

function configured(overrides: Partial<CallbackDeliveryConfig> = {}): CallbackDeliveryConfig {
  return {
    active: true,
    payloadMode: 'WITH_RESULT',
    authConfigured: true,
    authConfig: {
      type: 'bearer',
      token: 'profile-bearer-token',
      gateway_headers: [{ name: 'X-Gateway-Client', value_secret_ref: 'vault://gateway/client' }],
    },
    ...overrides,
  };
}

describe('Profile callback delivery configuration', () => {
  const previousEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENCRYPTION_KEY = 'webhook-sender-test-key';
  });

  afterAll(() => {
    if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousEncryptionKey;
  });

  it('decrypts Profile auth, uses the Profile payload mode, and marks the new path active', async () => {
    mockLimit.mockResolvedValueOnce([{
      callbackAuthConfig: encrypt(JSON.stringify({ type: 'bearer', token: 'stored-token' })),
      callbackPayload: null,
    }]);

    await expect(resolveCallbackDeliveryConfig('profile-1')).resolves.toEqual({
      active: true,
      payloadMode: null,
      authConfigured: true,
      authConfig: { type: 'bearer', token: 'stored-token' },
    });
  });

  it('keeps the new path active but rejects a persisted query auth config defensively', async () => {
    mockLimit.mockResolvedValueOnce([{
      callbackAuthConfig: encrypt(JSON.stringify({ type: 'query', query_key: 'access_token', query_value: 'secret' })),
      callbackPayload: null,
    }]);

    await expect(resolveCallbackDeliveryConfig('profile-1')).resolves.toEqual({
      active: true,
      payloadMode: null,
      authConfigured: true,
      authConfig: undefined,
    });
  });

  it('is inactive when Profile callback auth and payload are both absent', async () => {
    mockLimit.mockResolvedValueOnce([{ callbackAuthConfig: null, callbackPayload: null }]);

    await expect(resolveCallbackDeliveryConfig('profile-1')).resolves.toEqual({
      active: false,
      payloadMode: null,
      authConfigured: false,
      authConfig: undefined,
    });
  });
});

describe('sendConfiguredWebhook', () => {
  let server: http.Server;
  let port: number;
  let received: { headers: http.IncomingHttpHeaders; body: unknown } | null;
  const originalPrivateHosts = process.env.ALLOWED_PRIVATE_HOSTS;
  const originalOrigins = process.env.ALLOWED_WEBHOOK_ORIGINS;

  beforeAll(async () => {
    process.env.ALLOWED_PRIVATE_HOSTS = 'localhost';
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        received = {
          headers: req.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    received = null;
    process.env.ALLOWED_WEBHOOK_ORIGINS = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (originalPrivateHosts === undefined) delete process.env.ALLOWED_PRIVATE_HOSTS;
    else process.env.ALLOWED_PRIVATE_HOSTS = originalPrivateHosts;
    if (originalOrigins === undefined) delete process.env.ALLOWED_WEBHOOK_ORIGINS;
    else process.env.ALLOWED_WEBHOOK_ORIGINS = originalOrigins;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('posts through a real local HTTP server with Profile auth/gateway headers and persists success', async () => {
    const result = await sendConfiguredWebhook({
      operationId: 'op-1',
      webhookUrl: `http://localhost:${port}/callback`,
      config: configured(),
      payload: { operation_id: 'op-1', state: 'SUCCEEDED', done: true },
      logger,
    });

    expect(result).toEqual({ delivered: true, attempts: 1, lastError: null });
    expect(received).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer profile-bearer-token',
        'x-gateway-client': 'resolved-gateway-secret',
      }),
      body: { operation_id: 'op-1', state: 'SUCCEEDED', done: true },
    }));
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      webhookAttempts: 1,
      webhookLastError: null,
      webhookSentAt: expect.any(Date),
    }));
  });

  it('applies the encryption transform to the wire body and merges its headers', async () => {
    const encryptTransform = jest.fn(async (_payload: Record<string, unknown>) => ({
      body: JSON.stringify({ encrypted_payload: 'CIPHERTEXT', encryption: { mode: 'full' } }),
      headers: { 'X-Encrypt-Mode': 'full', 'X-Nonce': 'abc' },
    }));

    const result = await sendConfiguredWebhook({
      operationId: 'op-enc',
      webhookUrl: `http://localhost:${port}/callback`,
      config: configured(),
      payload: { operation_id: 'op-enc', state: 'SUCCEEDED', done: true, extracted_data: { ma_may: 'A1123456' } },
      logger,
      encryptTransform,
    });

    expect(result.delivered).toBe(true);
    expect(encryptTransform).toHaveBeenCalledTimes(1);
    // Body on the wire is the ciphertext envelope, not the plaintext payload.
    expect(received?.body).toEqual({ encrypted_payload: 'CIPHERTEXT', encryption: { mode: 'full' } });
    expect(received?.headers).toEqual(expect.objectContaining({
      'x-encrypt-mode': 'full',
      'x-nonce': 'abc',
    }));
    // The plaintext business field must never appear on the wire.
    expect(JSON.stringify(received?.body)).not.toContain('A1123456');
  });

  it('fails closed when the encryption transform throws — never sends plaintext', async () => {
    const encryptTransform = jest.fn(async () => {
      throw new Error('selective fields matched nothing');
    });

    const result = await sendConfiguredWebhook({
      operationId: 'op-enc-fail',
      webhookUrl: `http://localhost:${port}/callback`,
      config: configured(),
      payload: { operation_id: 'op-enc-fail', state: 'SUCCEEDED', done: true, extracted_data: { ma_may: 'A1123456' } },
      logger,
      encryptTransform,
    });

    expect(result.delivered).toBe(false);
    expect(result.lastError).toContain('encryption failed');
    // Nothing was posted to the server.
    expect(received).toBeNull();
  });

  it('blocks a non-allowlisted destination before attaching Profile credentials and persists safe diagnostics', async () => {
    process.env.ALLOWED_WEBHOOK_ORIGINS = 'https://other.example';

    const result = await sendConfiguredWebhook({
      operationId: 'op-2',
      webhookUrl: `http://localhost:${port}/callback?token=do-not-store`,
      config: configured(),
      payload: { operation_id: 'op-2', state: 'FAILED' },
      logger,
    });

    expect(result).toEqual({ delivered: false, attempts: 0, lastError: 'Callback origin is not allowlisted.' });
    expect(received).toBeNull();
    expect(mockSet).toHaveBeenCalledWith({
      webhookAttempts: 0,
      webhookLastError: 'Callback origin is not allowlisted.',
    });
    expect(JSON.stringify(mockSet.mock.calls)).not.toContain('do-not-store');
    expect(JSON.stringify(mockSet.mock.calls)).not.toContain('profile-bearer-token');
  });
});
