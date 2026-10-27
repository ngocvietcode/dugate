// Giai đoạn 2 — a finished workflow run scrubs its sub-steps' prompts and model
// output (completeWorkflow / failWorkflow), but a paused run (WAITING_USER_INPUT)
// keeps them because it will resume.

const transitionMock = jest.fn().mockResolvedValue({});
const purgeMock = jest.fn().mockResolvedValue(0);

jest.mock('@/lib/db', () => ({ db: { update: jest.fn() } }));
jest.mock('@/lib/operations/state-transition', () => ({
  insertOperation: jest.fn(),
  transitionOperationState: transitionMock,
}));
jest.mock('@/lib/operations/content-retention', () => ({
  ensureContentRetentionScheduled: jest.fn(),
  purgeWorkflowSubSteps: (...args: unknown[]) => purgeMock(...args),
}));

import { completeWorkflow, failWorkflow, pauseWorkflow } from '@/lib/pipelines/workflow-engine';

function context() {
  return {
    operationId: 'parent-1',
    correlationId: 'corr-job',
    stepsResult: [{ step: 0, stepName: 'Phân loại', processor: 'ext-classifier', sub_operation_id: 'child-1' }],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    usageBreakdown: [],
    webhookUrl: null,
    apiKeyId: null,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as never;
}

beforeEach(() => {
  transitionMock.mockClear();
  purgeMock.mockClear();
});

it('purges sub-steps after a SUCCEEDED run, linked by the run artifacts and correlationId', async () => {
  const ctx = context();
  await completeWorkflow(ctx, null, { result: { sub_operation_id: 'child-2' } });

  expect(purgeMock).toHaveBeenCalledTimes(1);
  expect(purgeMock).toHaveBeenCalledWith(expect.objectContaining({
    parentOperationId: 'parent-1',
    correlationIds: ['corr-job'],
    references: [
      [expect.objectContaining({ sub_operation_id: 'child-1' })],
      { result: { sub_operation_id: 'child-2' } },
    ],
  }));
  // The final state is persisted before anything is scrubbed.
  expect(transitionMock.mock.invocationCallOrder[0]).toBeLessThan(purgeMock.mock.invocationCallOrder[0]);
});

it('purges sub-steps after a FAILED run', async () => {
  await failWorkflow(context(), new Error('Connection Error: timeout'));
  expect(purgeMock).toHaveBeenCalledWith(expect.objectContaining({ parentOperationId: 'parent-1' }));
});

it('keeps sub-step content while the run waits for user input', async () => {
  await pauseWorkflow(context(), 'Chờ xác nhận', 0);
  expect(purgeMock).not.toHaveBeenCalled();
});
