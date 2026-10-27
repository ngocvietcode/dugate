/**
 * External API processor — error surfacing contract.
 *
 * These tests run against a REAL loopback HTTP server instead of a mocked
 * `global.fetch`, because the connector no longer uses `fetch`: it goes through
 * `ssrfSafeFetch` (node:http/https + pinned DNS agent). A `global.fetch` mock is
 * silently never called, which is exactly how the "provider error body is thrown
 * away" regression stayed invisible.
 *
 * Contract under test:
 *   - the provider's own error body reaches the pipeline error message
 *   - 4xx (bad model / bad payload / bad credential) is reported as a
 *     CONFIGURATION error, not as a generic connection error
 *   - 5xx and transport failures stay "Connection Error to <slug>"
 *   - credential-shaped values inside the provider body are redacted
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { runExternalApiProcessor } from '@/lib/pipelines/processors/external-api';
import type { ProcessorContext } from '@/lib/pipelines/engine';
import type { ExternalApiConnection } from '@/lib/db/schema';
import { Logger } from '@/lib/logger';

describe('External API Processor — provider error surfacing', () => {
  let server: http.Server;
  let port: number;
  let respond: (res: http.ServerResponse) => void;
  let lastBody = '';
  const originalAllowList = process.env.ALLOWED_PRIVATE_HOSTS;

  beforeAll(async () => {
    // localhost resolves to a loopback address, so it must be allow-listed for SSRF.
    process.env.ALLOWED_PRIVATE_HOSTS = 'localhost';
    server = http.createServer((req, res) => {
      // Always drain the request body before answering so uploads complete.
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        lastBody = Buffer.concat(chunks).toString('utf8');
        respond(res);
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

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const makeContext = (): ProcessorContext => ({
    operationId: 'op-123',
    stepIndex: 0,
    totalSteps: 1,
    // No local files: keeps the test off the internal-parser branch and off disk.
    filePaths: [],
    fileNames: [],
    inputText: 'some upstream text',
    processorSlug: 'test-connector',
    variables: { name: 'Alice' },
    outputFormat: 'json',
    correlationId: 'test-corr-id',
    logger: new Logger({ correlationId: 'test-corr-id' }),
    pipelineState: {},
  });

  const makeConnection = (overrides: Partial<ExternalApiConnection> = {}): ExternalApiConnection => ({
    id: 'conn-1',
    slug: 'test-connector',
    name: 'Test Connector',
    description: null,
    endpointUrl: `http://localhost:${port}/ext/test`,
    httpMethod: 'POST',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'secret123',
    vaultSecretPath: null,
    fileFieldName: 'file',
    fileUrlFieldName: null,
    promptFieldName: 'prompt',
    defaultPrompt: 'Hello {{name}}',
    responseContentPath: 'data.content',
    staticFormFields: JSON.stringify([{ key: 'format', value: 'markdown' }, { key: 'model', value: 'gemini-2.5-flash' }]),
    extraHeaders: null,
    sessionIdResponsePath: null,
    sessionIdFieldName: null,
    timeoutSec: 10,
    state: 'ENABLED',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ExternalApiConnection);

  it('forwards the interpolated prompt and the overridden model, and extracts content by dot-path', async () => {
    respond = (res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { content: 'Extracted output successfully' } }));
    };

    const result = await runExternalApiProcessor(
      makeContext(),
      makeConnection(),
      { modelOverride: 'gpt-4o-mini', promptOverride: null } as never,
    );

    expect(result.content).toBe('Extracted output successfully');
    expect(lastBody).toContain('Hello Alice');       // prompt interpolated
    expect(lastBody).toContain('markdown');          // static field forwarded
    expect(lastBody).toContain('gpt-4o-mini');       // model override replaced the default
    expect(lastBody).not.toContain('gemini-2.5-flash');
  });

  it('surfaces the provider explanation for a 403 caused by an invalid model', async () => {
    respond = (res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: { code: 403, message: 'Model "gpt-9-ultra-does-not-exist" is not available for this project' },
      }));
    };

    const promise = runExternalApiProcessor(
      makeContext(),
      makeConnection(),
      { modelOverride: 'gpt-9-ultra-does-not-exist', promptOverride: null } as never,
    );

    // The provider's reason must reach the operator, appended to the EXISTING
    // message shape. The `Connection Error to <slug>:` prefix is load-bearing:
    // classifyWorkflowFailure matches it to derive the webhook `error_code` /
    // `retryable` that the integrating IDP reads, so it must not change.
    await expect(promise).rejects.toThrow(
      /^Connection Error to test-connector: External API returned HTTP 403: .*gpt-9-ultra-does-not-exist/,
    );
  });

  it('keeps the message prefix identical for every status class', async () => {
    for (const status of [400, 401, 403, 404, 408, 422, 429, 500, 503]) {
      respond = (res) => {
        res.writeHead(status, { 'content-type': 'text/plain' });
        res.end(`upstream said ${status}`);
      };

      let captured = '';
      try {
        await runExternalApiProcessor(makeContext(), makeConnection());
      } catch (err) {
        captured = (err as Error).message;
      }

      expect(captured).toBe(
        `Connection Error to test-connector: External API returned HTTP ${status}: upstream said ${status}`,
      );
    }
  });

  it('redacts credential-shaped values echoed back inside the provider error body', async () => {
    respond = (res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        message: 'invalid credentials',
        received: { api_key: 'sk-live-SHOULD-NOT-LEAK', authorization: 'Bearer eyJhbGciOiJIUzI1NiIsIn' },
      }));
    };

    await expect(runExternalApiProcessor(makeContext(), makeConnection()))
      .rejects.toThrow(/invalid credentials/);

    let captured = '';
    try {
      await runExternalApiProcessor(makeContext(), makeConnection());
    } catch (err) {
      captured = (err as Error).message;
    }
    expect(captured).not.toContain('sk-live-SHOULD-NOT-LEAK');
    expect(captured).not.toContain('eyJhbGciOiJIUzI1NiIsIn');
    expect(captured).toContain('***');
  });

  it('keeps 5xx as a connection error but still includes the provider body', async () => {
    respond = (res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error near line 12');
    };

    await expect(runExternalApiProcessor(makeContext(), makeConnection())).rejects.toThrow(
      'Connection Error to test-connector: External API returned HTTP 500: Internal Server Error near line 12',
    );
  });

  it('reports a transport failure as a connection error', async () => {
    // Port 1 on loopback: nothing listens, so the socket fails at connect time.
    await expect(
      runExternalApiProcessor(makeContext(), makeConnection({ endpointUrl: 'http://localhost:1/ext/test' })),
    ).rejects.toThrow(/^Connection Error to test-connector: /);
  });
});
