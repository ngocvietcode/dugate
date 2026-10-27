const whereMock = jest.fn().mockResolvedValue(undefined);
const setMock = jest.fn(() => ({ where: whereMock }));
const updateMock = jest.fn(() => ({ set: setMock }));
const transitionMock = jest.fn().mockResolvedValue({});

jest.mock('@/lib/db', () => ({ db: { update: updateMock } }));
jest.mock('@/lib/operations/state-transition', () => ({
  insertOperation: jest.fn(),
  transitionOperationState: transitionMock,
}));
jest.mock('@/lib/db/schema', () => ({
  operations: { id: 'operations.id' },
  apiKeys: { id: 'apiKeys.id', totalUsed: 'apiKeys.totalUsed' },
  profileEndpoints: {},
}));
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => 'where-clause'),
  and: jest.fn(),
  sql: jest.fn(),
}));

import {
  completeWorkflow,
  pauseWorkflow,
} from '@/lib/pipelines/workflow-engine';

function context() {
  return {
    operationId: 'operation-1',
    stepsResult: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    inputTokensMissing: false,
    outputTokensMissing: true,
    costMissing: false,
    hasUnpricedCost: true,
    usageBreakdown: [{
      processor: 'ext-extract',
      model: 'ext:model',
      input_tokens: 0,
      output_tokens: null,
      cost_usd: 0,
      cost_source: 'unpriced',
    }],
    webhookUrl: null,
    apiKeyId: null,
    logger: { info: jest.fn() },
  } as never;
}

describe('workflow canonical metadata persistence', () => {
  beforeEach(() => {
    transitionMock.mockClear();
    updateMock.mockClear();
    setMock.mockClear();
    whereMock.mockClear();
  });

  it('writes explicit canonical results and completeness flags on completion', async () => {
    await completeWorkflow(context(), null, { result: true }, {
      logicResult: 'PASS',
      extractionResult: 'SUCCESS',
    });

    expect(transitionMock).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'operation-1',
      state: 'SUCCEEDED',
      changes: expect.objectContaining({
        logicResult: 'PASS',
        extractionResult: 'SUCCESS',
        inputTokensMissing: false,
        outputTokensMissing: true,
        costMissing: false,
        hasUnpricedCost: true,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      }),
    }));
  });

  it('transitions waiting-user-input through the atomic state service', async () => {
    await pauseWorkflow(context(), 'Waiting for review', 3);

    expect(transitionMock).toHaveBeenCalledWith({
      operationId: 'operation-1',
      state: 'WAITING_USER_INPUT',
      changes: expect.objectContaining({
        progressMessage: 'Waiting for review',
        currentStep: 3,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      }),
    });
  });

  it('stores NOT_AVAILABLE canonical outcomes as null instead of guessing', async () => {
    await completeWorkflow(context(), null, null);

    expect(transitionMock).toHaveBeenCalledWith(expect.objectContaining({
      state: 'SUCCEEDED',
      changes: expect.objectContaining({
        logicResult: null,
        extractionResult: null,
      }),
    }));
  });
});
