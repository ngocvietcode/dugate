import { runExternalApiProcessor } from '../../lib/pipelines/processors/external-api';
import type { ProcessorContext } from '../../lib/pipelines/engine';
import type { ExternalApiConnection } from '@prisma/client';

// Mock system fs/promises since external-api uses it
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('dummy file content'))
}));

describe('External API Processor', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    // Suppress console logs during tests to keep output clean
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const dummyContext: ProcessorContext = {
    operationId: 'op-123',
    stepIndex: 0,
    totalSteps: 1,
    filePaths: ['/tmp/dummy.pdf'],
    fileNames: ['dummy.pdf'],
    processorSlug: 'test-connector',
    variables: { name: 'Alice' },
    outputFormat: 'json',
    correlationId: 'test-corr-id',
    logger: new (require('../../lib/logger').Logger)({ correlationId: 'test-corr-id' })
  };

  const dummyConnection: ExternalApiConnection = {
    id: 'conn-1',
    slug: 'test-connector',
    name: 'Test Connector',
    description: null,
    endpointUrl: 'http://mock-service:3000/ext/test',
    httpMethod: 'POST',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'secret123',
    fileFieldName: 'file',
    promptFieldName: 'prompt',
    defaultPrompt: 'Hello {{name}}',
    responseContentPath: 'data.content',
    staticFormFields: JSON.stringify([{ key: 'format', value: 'markdown' }]),
    extraHeaders: null,
    timeoutSec: 10,
    state: 'ENABLED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should successfully execute pipeline step and extract content via dot-path', async () => {
    // Mock successful fetch
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          content: 'Extracted output successfully'
        }
      })
    });

    const result = await runExternalApiProcessor(dummyContext, dummyConnection);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://mock-service:3000/ext/test',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'secret123'
        })
      })
    );

    // Verify formData
    const fetchCall = mockFetch.mock.calls[0];
    const formData = fetchCall[1].body as FormData;
    expect(formData.get('prompt')).toBe('Hello Alice'); // variable interpolated
    expect(formData.get('format')).toBe('markdown'); // static field added

    // Verify output
    expect(result.content).toBe('Extracted output successfully');
    expect(result.modelUsed).toBe('ext:test-connector');
  });

  it('should correctly capture and throw HTTP Error with body string', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error near line 12'
    });

    await expect(runExternalApiProcessor(dummyContext, dummyConnection)).rejects.toThrow(
      'Connection Error to test-connector: External API returned HTTP 500: Internal Server Error near line 12'
    );
  });

  it('should capture network errors (fetch fail)', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed'));

    await expect(runExternalApiProcessor(dummyContext, dummyConnection)).rejects.toThrow(
      'Connection Error to test-connector: fetch failed'
    );
  });
});
