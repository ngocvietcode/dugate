/**
 * Regression test for the pinned-DNS Agent used by ssrfSafeFetch.
 *
 * Node >= 20 enables Happy Eyeballs (`autoSelectFamily`) by default, so
 * net.connect invokes a custom `lookup` hook with `{ all: true }` and expects
 * `callback(null, [{ address, family }])`. The original implementation always
 * answered with the legacy `callback(null, address, family)` shape, so Node read
 * `addresses[0]` from a string and aborted every DNS-resolved outbound call with
 * `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`.
 *
 * The pinned agent is only installed for hostnames that go through DNS: a literal
 * IP short-circuits earlier in resolveSafeUrl. These tests therefore drive the
 * request through the hostname `localhost` so the pinned lookup is exercised.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

describe('ssrfSafeFetch pinned DNS agent', () => {
  let server: http.Server;
  let port: number;
  const originalAllowList = process.env.ALLOWED_PRIVATE_HOSTS;

  beforeAll(async () => {
    // localhost resolves to a private address, so it must be allow-listed here.
    process.env.ALLOWED_PRIVATE_HOSTS = 'localhost';
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, method: req.method }));
    });
    // Bind every loopback family so the pinned address (IPv4 or IPv6) connects.
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (originalAllowList === undefined) delete process.env.ALLOWED_PRIVATE_HOSTS;
    else process.env.ALLOWED_PRIVATE_HOSTS = originalAllowList;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('completes a DNS-resolved GET through the pinned agent', async () => {
    const { ssrfSafeFetch } = await import('@/lib/pipelines/processors/http-client');
    const response = await ssrfSafeFetch(`http://localhost:${port}/health`, { method: 'GET' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, method: 'GET' });
  });

  it('sends a DNS-resolved POST body through the pinned agent', async () => {
    const { ssrfSafeFetch } = await import('@/lib/pipelines/processors/http-client');
    const response = await ssrfSafeFetch(`http://localhost:${port}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, method: 'POST' });
  });
});

/**
 * The connector layer has two distinct transports through ssrfSafeFetch:
 *   - multipart/form-data via fetchWithTimeout      (most ext-* connectors)
 *   - application/json    via fetchJsonWithTimeout  (AIHub branch)
 * Both must survive the pinned-DNS agent, so both are exercised end to end
 * against a real socket rather than a mocked fetch.
 */
describe('connector transports through the pinned agent', () => {
  let server: http.Server;
  let port: number;
  let lastRequest: { contentType: string; length: number; body: string } | null = null;
  const originalAllowList = process.env.ALLOWED_PRIVATE_HOSTS;

  beforeAll(async () => {
    process.env.ALLOWED_PRIVATE_HOSTS = 'localhost';
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        lastRequest = {
          contentType: req.headers['content-type'] ?? '',
          length: body.length,
          body: body.toString('utf8'),
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ content: 'ok' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (originalAllowList === undefined) delete process.env.ALLOWED_PRIVATE_HOSTS;
    else process.env.ALLOWED_PRIVATE_HOSTS = originalAllowList;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('delivers a multipart connector call with files intact', async () => {
    const { fetchWithTimeout } = await import('@/lib/pipelines/processors/http-client');
    const form = new FormData();
    form.append('query', 'extract this');
    form.append('files', new Blob([Buffer.from('%PDF-1.7 fake pdf bytes')], { type: 'application/pdf' }), 'doc.pdf');

    const result = await fetchWithTimeout(
      `http://localhost:${port}/extract`,
      'POST',
      { 'x-api-key': 'secret' },
      form,
      10_000,
    );

    expect(result).toEqual({ content: 'ok' });
    expect(lastRequest?.contentType).toContain('multipart/form-data');
    expect(lastRequest?.contentType).toContain('boundary=');
    expect(lastRequest?.body).toContain('extract this');
    expect(lastRequest?.body).toContain('doc.pdf');
    expect(lastRequest?.body).toContain('%PDF-1.7 fake pdf bytes');
  });

  it('delivers a JSON connector call with the body intact', async () => {
    const { fetchJsonWithTimeout } = await import('@/lib/pipelines/processors/http-client');
    const payload = JSON.stringify({ model: 'gemini-2.5-pro', messages: [{ role: 'user', content: 'hi' }] });

    const result = await fetchJsonWithTimeout(
      `http://localhost:${port}/chat/completions`,
      'POST',
      { 'x-api-key': 'secret' },
      payload,
      10_000,
    );

    expect(result).toEqual({ content: 'ok' });
    expect(lastRequest?.contentType).toBe('application/json');
    expect(lastRequest?.length).toBe(Buffer.byteLength(payload));
    expect(lastRequest?.body).toBe(payload);
  });
});
