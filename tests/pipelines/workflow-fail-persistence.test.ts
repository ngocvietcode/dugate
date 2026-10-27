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
  apiKeys: {},
  profileEndpoints: {},
}));
jest.mock('drizzle-orm', () => ({ eq: jest.fn(() => 'where-clause'), and: jest.fn(), sql: jest.fn() }));

import { failWorkflow } from '@/lib/pipelines/workflow-engine';

function context() {
  return {
    operationId: 'operation-1',
    stepsResult: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    usageBreakdown: [],
    webhookUrl: null,
    logger: { error: jest.fn() },
  } as never;
}

describe('failWorkflow persistence — R14-O1', () => {
  beforeEach(() => {
    transitionMock.mockClear();
    updateMock.mockClear();
    setMock.mockClear();
    whereMock.mockClear();
  });

  it.each([
    ['EXCEL_PARSE_FAILED: invalid sheet', 'INPUT_INVALID'],
    ['Connection Error to ext-translator: timeout', 'CONNECTOR_ERROR'],
    ["Cannot read properties of undefined (reading 'rows')", 'SYSTEM_ERROR'],
  ] as const)('stores %s with the classified DB error code %s', async (message, errorCode) => {
    await failWorkflow(context(), new Error(message));

    expect(transitionMock).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'operation-1',
      state: 'FAILED',
      changes: expect.objectContaining({
        errorCode,
        errorMessage: expect.stringContaining(message.includes('EXCEL_PARSE_FAILED') ? 'EXCEL_PARSE_FAILED' : message.includes('Connection Error') ? 'Connection Error' : "reading 'rows'"),
      }),
    }));
  });
});
