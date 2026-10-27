const transitionOperationStateMock = jest.fn();

class MockOperationNotFoundError extends Error {}

jest.mock('@/lib/operations/state-transition', () => ({
  transitionOperationState: transitionOperationStateMock,
  OperationNotFoundError: MockOperationNotFoundError,
}));

import { markDlqOperationFailed } from '@/lib/worker-dlq';

describe('DLQ operation persistence — R14-R3', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes a conditional RUNNING failure through snapshot maintenance', async () => {
    await markDlqOperationFailed('operation-1', 'worker crashed');

    expect(transitionOperationStateMock).toHaveBeenCalledWith({
      operationId: 'operation-1',
      state: 'FAILED',
      changes: {
        errorCode: 'WORKER_CRASH',
        errorMessage: 'worker crashed',
      },
      onlyIf: { state: 'RUNNING', done: false },
    });
  });

  it('does not write for a failed event without an operation id', async () => {
    await markDlqOperationFailed(undefined, 'worker crashed');
    expect(transitionOperationStateMock).not.toHaveBeenCalled();
  });

  it('preserves the former no-op behavior when the operation no longer exists', async () => {
    transitionOperationStateMock.mockRejectedValueOnce(
      new MockOperationNotFoundError(),
    );

    await expect(
      markDlqOperationFailed('removed', 'worker crashed'),
    ).resolves.toBeUndefined();
  });
});
