/**
 * Authorization on the two internal routes that spend a connector's outbound
 * credentials, plus the credential-leak-through-redirect guard.
 *
 * `/api/internal` is in the middleware BYPASS_PREFIXES list, so each route is
 * solely responsible for its own guard:
 *   - prompt-wizard was `requireAuth` (any logged-in account, even one with no
 *     Profile assignment, could drive the connector's AI budget). It stays
 *     ADMIN-only: it is not part of the capability catalog offered to OPS.
 *   - ext-connections/[id]/test had NO guard at all. It resolves the connector
 *     secret, sends caller-supplied content upstream and returns the raw upstream
 *     body plus `authDebug` (secret source / Vault path / key length /
 *     fingerprint), so it now requires the connector:manage capability.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextResponse } from 'next/server';

const requireAdmin = jest.fn();
const requireCapability = jest.fn();
const limit = jest.fn();

jest.mock('@/lib/auth-guard', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  requireCapability: (...args: unknown[]) => requireCapability(...args),
}));
jest.mock('@/lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) },
}));
jest.mock('@/lib/secrets/resolve', () => ({
  resolveConnectionSecret: jest.fn().mockResolvedValue('connector-secret'),
}));

const connector = (endpointUrl: string) => ({
  id: 'conn-wizard',
  slug: 'ext-prompt-wizard',
  name: 'Prompt Wizard',
  endpointUrl,
  httpMethod: 'POST',
  authType: 'API_KEY_HEADER',
  authKeyHeader: 'x-api-key',
  authSecret: 'connector-secret',
  vaultSecretPath: null,
  promptFieldName: 'query',
  staticFormFields: null,
  extraHeaders: null,
  responseContentPath: 'content',
  timeoutSec: 5,
  state: 'ENABLED',
});

const callWizard = async (endpointUrl: string) => {
  const { POST } = await import('@/app/api/internal/prompt-wizard/route');
  limit.mockResolvedValue([connector(endpointUrl)]);
  const req = new Request('http://localhost/api/internal/prompt-wizard', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPrompt: 'Tóm tắt tài liệu.' }),
  });
  return POST(req as never);
};

describe('internal routes that use connector credentials', () => {
  let server: http.Server;
  let port: number;
  let lastAuthHeader: string | undefined;
  let mode: 'ok' | 'redirect' = 'ok';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (mode === 'redirect') {
          lastAuthHeader = undefined;
          // Second hop records whether the credential was replayed.
          if (req.url === '/followed') {
            lastAuthHeader = req.headers['x-api-key'] as string | undefined;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ content: 'should never be reached' }));
            return;
          }
          res.writeHead(302, { location: `http://localhost:${port}/followed` });
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ content: 'upgraded prompt' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mode = 'ok';
    lastAuthHeader = undefined;
    requireAdmin.mockResolvedValue({ session: { user: { id: 'u1', role: 'ADMIN' } } });
    requireCapability.mockResolvedValue({ session: { user: { id: 'u1', role: 'ADMIN' } } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('prompt-wizard is ADMIN-gated, not merely logged-in', async () => {
    requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 }));

    const response = await callWizard(`http://localhost:${port}/wizard`);

    expect(response.status).toBe(403);
    // The guard runs before anything is read from the database.
    expect(limit).not.toHaveBeenCalled();
  });

  it('prompt-wizard works for an admin', async () => {
    const response = await callWizard(`http://localhost:${port}/wizard`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, upgradedPrompt: 'upgraded prompt' });
  });

  it('prompt-wizard refuses a redirect instead of replaying the connector key', async () => {
    mode = 'redirect';

    const response = await callWizard(`http://localhost:${port}/wizard`);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toMatch(/redirect/i);
    // The credential must never have reached the redirect target.
    expect(lastAuthHeader).toBeUndefined();
  });

  it('ext-connections/[id]/test requires the connector:manage capability', async () => {
    requireCapability.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { POST } = await import('@/app/api/internal/ext-connections/[id]/test/route');

    const req = new Request('http://localhost/api/internal/ext-connections/conn-1/test', {
      method: 'POST',
      body: new FormData(),
    });
    const response = await POST(req as never, { params: Promise.resolve({ id: 'conn-1' }) });

    expect(response.status).toBe(403);
    expect(requireCapability).toHaveBeenCalledWith('connector:manage');
    // No connector row read, so no secret was resolved and no authDebug produced.
    expect(limit).not.toHaveBeenCalled();
  });
});
