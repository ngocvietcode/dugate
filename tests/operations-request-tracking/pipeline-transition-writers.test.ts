const mockTransitionOperationState = jest.fn().mockResolvedValue({});
const mockUpdate = jest.fn();
const mockLoggerError = jest.fn();

const invalidOperation = {
  id: 'operation-1',
  apiKeyId: null,
  endpointSlug: 'extract:test',
  pipelineJson: '{invalid-json',
  filesJson: null,
  webhookUrl: null,
  outputFormat: 'json',
};

jest.mock('@/lib/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn().mockResolvedValue([invalidOperation]),
        })),
      })),
    })),
    update: mockUpdate,
  },
}));

jest.mock('@/lib/db/schema', () => ({
  operations: { id: 'operations.id' },
  apiKeys: {},
  externalApiConnections: {},
  externalApiOverrides: {},
}));

jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => 'where-clause'),
  inArray: jest.fn(),
  and: jest.fn(),
  sql: jest.fn(),
}));

jest.mock('@/lib/operations/state-transition', () => ({
  transitionOperationState: mockTransitionOperationState,
}));

jest.mock('@/lib/pipelines/processors/external-api', () => ({
  runExternalApiProcessor: jest.fn(),
}));
jest.mock('@/lib/delivery/webhook-sender', () => ({
  resolveCallbackDeliveryConfig: jest.fn(),
  sendProfileCallback: jest.fn(),
}));
jest.mock('@/lib/storage', () => ({ getStorageBackend: jest.fn() }));
jest.mock('@/lib/storage/local-backend', () => ({ LocalStorageBackend: class {} }));
jest.mock('@/lib/logger', () => ({
  Logger: class {
    error = mockLoggerError;
    warn = jest.fn();
    info = jest.fn();
  },
}));

import { runPipeline } from '@/lib/pipelines/engine';

describe('pipeline state writers', () => {
  beforeEach(() => {
    mockTransitionOperationState.mockClear();
    mockUpdate.mockClear();
    mockLoggerError.mockClear();
  });

  it('routes invalid-pipeline failure through the atomic transition service', async () => {
    await runPipeline('operation-1');

    expect(mockTransitionOperationState).toHaveBeenCalledWith({
      operationId: 'operation-1',
      state: 'FAILED',
      changes: {
        failedAtStep: 0,
        errorCode: 'PIPELINE_INVALID_JSON',
        errorMessage: 'Invalid pipeline payload.',
        stepsResultJson: '[]',
      },
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
