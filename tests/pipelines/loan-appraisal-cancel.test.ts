/**
 * H4: cancel must stop runLoanAppraisal early and must never be turned into FAILED.
 */
const enqueueMock = jest.fn();
const assertNotCancelledMock = jest.fn();
const failWorkflowMock = jest.fn();
const completeWorkflowMock = jest.fn();

jest.mock('@/lib/pipelines/workflow-engine', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflow-engine');
  return {
    ...actual,
    enqueueSubStep: (...args: unknown[]) => enqueueMock(...args),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    completeWorkflow: (...args: unknown[]) => completeWorkflowMock(...args),
    failWorkflow: (...args: unknown[]) => failWorkflowMock(...args),
    assertNotCancelled: (...args: unknown[]) => assertNotCancelledMock(...args),
  };
});

import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { WorkflowCancelledError } from '@/lib/pipelines/workflow-engine';

function context() {
  return {
    operationId: 'op-1',
    endpointSlug: 'workflows:loan-appraisal',
    stepsResult: [],
    currentStep: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    usageBreakdown: [],
    pipelineVars: {},
    promptOverrides: {},
    modelOverrides: {},
    reasoningEffortOverrides: {},
    filesData: [
      { name: 'a.pdf', path: '/tmp/a.pdf', mime: 'application/pdf', size: 1 },
      { name: 'b.pdf', path: '/tmp/b.pdf', mime: 'application/pdf', size: 1 },
    ],
    webhookUrl: null,
    apiKeyId: null,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as never;
}

describe('H4 runLoanAppraisal cancel early stop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
    failWorkflowMock.mockResolvedValue(undefined);
    completeWorkflowMock.mockResolvedValue(undefined);
  });

  it('cancelled before stage 0: no sub-step is enqueued and nothing completes', async () => {
    assertNotCancelledMock.mockRejectedValue(new WorkflowCancelledError('op-1'));
    await runLoanAppraisal(context());
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(completeWorkflowMock).not.toHaveBeenCalled();
  });

  it('cancel is handed to failWorkflow only as the sentinel (never a plain failure)', async () => {
    assertNotCancelledMock.mockRejectedValue(new WorkflowCancelledError('op-1'));
    await runLoanAppraisal(context());
    for (const [, err] of failWorkflowMock.mock.calls) {
      expect(err).toBeInstanceOf(WorkflowCancelledError);
    }
  });

  it('cancelled after stage-0 begin: the per-file catch does not swallow it and no more sub-steps run', async () => {
    assertNotCancelledMock
      .mockResolvedValueOnce(undefined) // beginStage(0)
      .mockRejectedValue(new WorkflowCancelledError('op-1')); // before each enqueue
    await runLoanAppraisal(context());
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(completeWorkflowMock).not.toHaveBeenCalled();
    for (const [, err] of failWorkflowMock.mock.calls) {
      expect(err).toBeInstanceOf(WorkflowCancelledError);
    }
  });
});
