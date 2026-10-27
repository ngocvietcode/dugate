const whereMock = jest.fn();
const selectMock = jest.fn();
const transitionOperationStateMock = jest.fn();
const ltMock = jest.fn((field, date) => ({ field, date }));

class MockOperationNotFoundError extends Error {}

jest.mock('@/lib/db', () => ({ db: { select: selectMock } }));
jest.mock('@/lib/db/schema', () => ({
  operations: {
    id: 'id',
    endpointSlug: 'endpointSlug',
    updatedAt: 'updatedAt',
    state: 'state',
    done: 'done',
  },
}));
jest.mock('@/lib/operations/state-transition', () => ({
  transitionOperationState: transitionOperationStateMock,
  OperationNotFoundError: MockOperationNotFoundError,
}));
jest.mock('drizzle-orm', () => ({
  and: jest.fn((...parts) => parts),
  eq: jest.fn((field, value) => ({ field, value })),
  lt: ltMock,
}));

import { recoverStalledOperations } from '@/lib/stalled-reaper';

describe('stalled operation reaper — R14-R2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    selectMock.mockReturnValue({ from: () => ({ where: whereMock }) });
  });

  it('selects by stale updatedAt and transitions every candidate atomically', async () => {
    whereMock.mockResolvedValue([
      {
        id: 'old-1',
        endpointSlug: 'workflows:financial-report-translation',
        updatedAt: new Date(0),
      },
      {
        id: 'old-2',
        endpointSlug: 'extract',
        updatedAt: new Date(1),
      },
    ]);

    await expect(recoverStalledOperations(9_000_000)).resolves.toHaveLength(2);

    expect(ltMock).toHaveBeenCalledWith('updatedAt', expect.any(Date));
    expect(transitionOperationStateMock).toHaveBeenNthCalledWith(1, {
      operationId: 'old-1',
      state: 'FAILED',
      changes: {
        errorCode: 'STALLED',
        errorMessage:
          'Operation exceeded stall threshold of 9000s with no progress.',
        progressMessage: null,
      },
      onlyIf: { state: 'RUNNING', done: false },
    });
    expect(transitionOperationStateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ operationId: 'old-2' }),
    );
  });

  it('leaves a fresh operation untouched', async () => {
    whereMock.mockResolvedValue([]);

    await expect(recoverStalledOperations(9_000_000)).resolves.toEqual([]);
    expect(transitionOperationStateMock).not.toHaveBeenCalled();
  });

  it('continues when a candidate is deleted after selection', async () => {
    whereMock.mockResolvedValue([
      { id: 'removed', endpointSlug: null, updatedAt: new Date(0) },
      { id: 'still-running', endpointSlug: null, updatedAt: new Date(1) },
    ]);
    transitionOperationStateMock
      .mockRejectedValueOnce(new MockOperationNotFoundError())
      .mockResolvedValueOnce(undefined);

    await expect(recoverStalledOperations()).resolves.toHaveLength(2);
    expect(transitionOperationStateMock).toHaveBeenCalledTimes(2);
  });
});
