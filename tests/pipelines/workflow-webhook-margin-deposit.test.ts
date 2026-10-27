const whereMock = jest.fn().mockResolvedValue(undefined);
const setMock = jest.fn(() => ({ where: whereMock }));
const updateMock = jest.fn(() => ({ set: setMock }));
const transitionMock = jest.fn().mockResolvedValue({});
const ssrfSafeFetchMock = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  text: jest.fn().mockResolvedValue('ok'),
});

jest.mock('@/lib/db', () => ({ db: { update: updateMock } }));
jest.mock('@/lib/operations/state-transition', () => ({
  insertOperation: jest.fn(),
  transitionOperationState: transitionMock,
}));
jest.mock('@/lib/db/schema', () => ({
  operations: { id: 'operations.id' },
  apiKeys: { totalUsed: 'apiKeys.totalUsed' },
  profileEndpoints: {},
}));
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => 'where-clause'),
  and: jest.fn(),
  sql: jest.fn(() => 'sql-expression'),
}));
jest.mock('@/lib/delivery/webhook-sender', () => ({
  resolveCallbackDeliveryConfig: jest.fn(),
}));
jest.mock('@/lib/crypto/build-transform', () => ({
  buildEncryptTransform: jest.fn(() => undefined),
}));
jest.mock('@/lib/pipelines/processors/http-client', () => ({
  assertSafeUrl: jest.fn(async (url: string) => url),
  isUrlOriginAllowed: jest.fn(() => true),
  sanitizeUrlForLogging: jest.fn((url: string) => url),
  ssrfSafeFetch: (...args: unknown[]) => ssrfSafeFetchMock(...args),
  summarizeErrorBody: jest.fn((message: string) => message),
}));
// workflow-engine registers every workflow at module scope. Mock them so this
// unit test stays isolated from unrelated workflow dependency trees.
jest.mock('@/lib/pipelines/workflows/disbursement', () => ({ runDisbursement: jest.fn() }));
jest.mock('@/lib/pipelines/workflows/lc-checker', () => ({ runLcChecker: jest.fn() }));
jest.mock('@/lib/pipelines/workflows/payroll-verify', () => ({ runPayrollVerify: jest.fn() }));
jest.mock('@/lib/pipelines/workflows/structure-compare', () => ({ runStructureCompare: jest.fn() }));
jest.mock('@/lib/pipelines/workflows/brd-analyze', () => ({ runBrdAnalyze: jest.fn() }));
jest.mock('@/lib/pipelines/workflows/payment-account-management', () => ({ runPaymentAccountManagement: jest.fn() }));
jest.mock('@/lib/pipelines/workflows/financial-report-translation', () => ({ runFinancialReportTranslation: jest.fn() }));
jest.mock('@/lib/pipelines/workflows/statement-analyze', () => ({ runStatementAnalyze: jest.fn() }));
jest.mock('@/lib/pipelines/workflows/tracing-portal', () => ({ runTracingPortal: jest.fn() }));
jest.mock('@/lib/pipelines/workflows/loan-appraisal', () => ({ runLoanAppraisal: jest.fn() }));
jest.mock('@/lib/pipelines/workflows/margin-deposit', () => ({ runMarginDeposit: jest.fn() }));

import { completeWorkflow } from '@/lib/pipelines/workflow-engine';
import type { WorkflowContext } from '@/lib/pipelines/workflow-engine';

function makeContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    operationId: 'operation-1',
    correlationId: 'corr-123',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
    filesJson: null,
    filesData: [],
    pipelineVars: {},
    stepsResult: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    usageBreakdown: [],
    webhookUrl: 'https://partner.example.com/callback',
    apiKeyId: null,
    createdByUserId: null,
    promptOverrides: {},
    modelOverrides: {},
    reasoningEffortOverrides: {},
    currentStep: 0,
    endpointSlug: 'workflows:margin-deposit',
    ...overrides,
  } as WorkflowContext;
}

describe('margin-deposit workflow callback transaction_id', () => {
  beforeEach(() => {
    transitionMock.mockClear();
    updateMock.mockClear();
    setMock.mockClear();
    whereMock.mockClear();
    ssrfSafeFetchMock.mockClear();
  });

  it('maps x-correlation-id to transaction_id in the margin-deposit callback payload', async () => {
    await completeWorkflow(makeContext(), null, { result: true });

    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = ssrfSafeFetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(requestInit.body)).toEqual(expect.objectContaining({
      operation_id: 'operation-1',
      state: 'SUCCEEDED',
      done: true,
      transaction_id: 'corr-123',
      extracted_data: { result: true },
    }));
  });

  it('does not add transaction_id for non margin-deposit workflows', async () => {
    await completeWorkflow(makeContext({ endpointSlug: 'workflows:disbursement' }), null, { result: true });

    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = ssrfSafeFetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(requestInit.body)).not.toHaveProperty('transaction_id');
  });
});
