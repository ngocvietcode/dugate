/**
 * H4: a CANCELLED operation must never be overwritten by completeWorkflow / failWorkflow,
 * must not send a SUCCEEDED/FAILED webhook and must not bill apiKeys.totalUsed.
 * The transition service runs for real over an in-memory store (same guard code path as prod).
 */
const mockOps = new Map<string, Record<string, unknown>>();
const updateWhereMock = jest.fn().mockResolvedValue(undefined);
const updateSetMock = jest.fn(() => ({ where: updateWhereMock }));
const updateMock = jest.fn(() => ({ set: updateSetMock }));
const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
const andMock = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    update: updateMock,
    select: jest.fn(() => ({
      from: () => ({ where: () => ({ limit: async () => [{ progressLogJson: null }] }) }),
    })),
  },
}));
jest.mock('@/lib/db/schema', () => ({
  operations: { id: 'operations.id', state: 'operations.state' },
  apiKeys: { id: 'apiKeys.id', totalUsed: 'apiKeys.totalUsed' },
  profileEndpoints: {},
}));
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => 'eq-clause'),
  and: (...args: unknown[]) => { andMock(...args); return 'and-clause'; },
  sql: jest.fn(() => 'sql-clause'),
}));
jest.mock('@/lib/pipelines/processors/http-client', () => ({
  ...jest.requireActual('@/lib/pipelines/processors/http-client'),
  assertSafeUrl: jest.fn(async (url: string) => url),
  isUrlOriginAllowed: jest.fn(() => true),
  ssrfSafeFetch: (...args: unknown[]) => fetchMock(...args),
}));
jest.mock('@/lib/operations/state-transition', () => {
  const actual = jest.requireActual('@/lib/operations/state-transition');
  const tx = {
    insertOperation: async () => { throw new Error('unused'); },
    findOperationForTransition: async (id: string) => mockOps.get(id) ?? null,
    updateOperationState: async (id: string, state: string, changes: Record<string, unknown>) => {
      const existing = mockOps.get(id);
      if (!existing) return null;
      Object.assign(existing, changes, { state });
      return existing;
    },
    deleteOperation: async () => null,
    updateOperationMembership: async () => null,
    lockBusinessGroup: async () => undefined,
    listEligibleGroupStates: async () => [],
    upsertLastValidStatus: async () => undefined,
    deleteLastValidStatus: async () => undefined,
  };
  const service = actual.createOperationStateTransitionService({
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  });
  return {
    insertOperation: jest.fn(),
    transitionOperationState: jest.fn(service.transitionOperationState),
  };
});

import {
  completeWorkflow,
  failWorkflow,
  updateProgress,
  WorkflowCancelledError,
} from '@/lib/pipelines/workflow-engine';
import { transitionOperationState } from '@/lib/operations/state-transition';

function seed(state: string) {
  mockOps.set('op-1', { id: 'op-1', businessGroupKey: 'request:op-1', state, done: state !== 'RUNNING' });
}

function context() {
  return {
    operationId: 'op-1',
    endpointSlug: 'workflows:loan-appraisal',
    stepsResult: [],
    currentStep: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 1.5,
    usageBreakdown: [],
    pipelineVars: {},
    webhookUrl: 'https://example.test/hook',
    apiKeyId: 'k1',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as never;
}

function usageUpdates() {
  return (updateSetMock.mock.calls as unknown[][]).filter(([arg]) => arg && 'totalCostUsd' in (arg as object));
}
function costContext() {
  const ctx = context() as unknown as Record<string, unknown>;
  Object.assign(ctx, { totalInputTokens: 10, totalOutputTokens: 5, usageBreakdown: [{ step: 's1' }] });
  return ctx as never;
}
const EXPECTED_USAGE = expect.objectContaining({
  totalInputTokens: 10, totalOutputTokens: 5, totalCostUsd: 1.5, usageBreakdown: JSON.stringify([{ step: 's1' }]),
});
function totalUsedUpdates() {
  return (updateSetMock.mock.calls as unknown[][]).filter(([arg]) => arg && 'totalUsed' in (arg as object));
}

describe('H4 cancel is not overwritten by complete/fail', () => {
  beforeEach(() => {
    mockOps.clear();
    jest.clearAllMocks();
  });

  it('completeWorkflow leaves CANCELLED, no webhook, no totalUsed', async () => {
    seed('CANCELLED');
    await expect(completeWorkflow(context(), 'out', { a: 1 })).resolves.toBeUndefined();
    expect(mockOps.get('op-1')?.state).toBe('CANCELLED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(totalUsedUpdates()).toHaveLength(0);
  });

  it('failWorkflow leaves CANCELLED and sends no FAILED webhook', async () => {
    seed('CANCELLED');
    await expect(failWorkflow(context(), new Error('boom'))).resolves.toBeUndefined();
    expect(mockOps.get('op-1')?.state).toBe('CANCELLED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('control: RUNNING op still becomes SUCCEEDED, webhook sent, parent adds no totalUsed (sub-ops bill themselves)', async () => {
    seed('RUNNING');
    await completeWorkflow(context(), 'out', { a: 1 });
    expect(mockOps.get('op-1')?.state).toBe('SUCCEEDED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(totalUsedUpdates()).toHaveLength(0);
  });

  it('control: RUNNING op still becomes FAILED with webhook', async () => {
    seed('RUNNING');
    await failWorkflow(context(), new Error('boom'));
    expect(mockOps.get('op-1')?.state).toBe('FAILED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('failWorkflow(WorkflowCancelledError) does not touch the operation at all', async () => {
    seed('CANCELLED');
    await failWorkflow(context(), new WorkflowCancelledError('op-1'));
    expect(transitionOperationState).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('updateProgress only writes when the operation is not CANCELLED', async () => {
    seed('CANCELLED');
    await updateProgress(context(), 10, 'x');
    expect(andMock).toHaveBeenCalledTimes(1);
    expect(andMock.mock.calls[0]).toHaveLength(2);
  });

  describe('H4 item 3: usage already incurred is recorded on the CANCELLED op (no extra totalUsed; sub-ops bill themselves)', () => {
    it('completeWorkflow on CANCELLED records usage once, no totalUsed, no webhook', async () => {
      seed('CANCELLED');
      await completeWorkflow(costContext(), 'out', { a: 1 });
      expect(usageUpdates()).toHaveLength(1);
      expect(usageUpdates()[0][0]).toEqual(EXPECTED_USAGE);
      expect(totalUsedUpdates()).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockOps.get('op-1')?.state).toBe('CANCELLED');
    });
    it('failWorkflow(Error) on CANCELLED records usage once, no totalUsed, no webhook', async () => {
      seed('CANCELLED');
      await failWorkflow(costContext(), new Error('boom'));
      expect(usageUpdates()).toHaveLength(1);
      expect(usageUpdates()[0][0]).toEqual(EXPECTED_USAGE);
      expect(totalUsedUpdates()).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockOps.get('op-1')?.state).toBe('CANCELLED');
    });
    it('failWorkflow(WorkflowCancelledError) records usage without any transition', async () => {
      seed('CANCELLED');
      await failWorkflow(costContext(), new WorkflowCancelledError('op-1'));
      expect(usageUpdates()).toHaveLength(1);
      expect(usageUpdates()[0][0]).toEqual(EXPECTED_USAGE);
      expect(transitionOperationState).not.toHaveBeenCalled();
      expect(totalUsedUpdates()).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it('is idempotent: repeated calls write identical absolute values and never touch totalUsed', async () => {
      seed('CANCELLED');
      const ctx = costContext();
      await failWorkflow(ctx, new WorkflowCancelledError('op-1'));
      await completeWorkflow(ctx, 'out', {});
      await failWorkflow(ctx, new Error('boom'));
      const updates = usageUpdates();
      expect(updates).toHaveLength(3);
      updates.forEach(([arg]) => expect(arg).toEqual(EXPECTED_USAGE));
      expect(totalUsedUpdates()).toHaveLength(0);
      expect(mockOps.get('op-1')?.state).toBe('CANCELLED');
    });
    it('usage write is conditional on state = CANCELLED', async () => {
      seed('CANCELLED');
      await failWorkflow(costContext(), new WorkflowCancelledError('op-1'));
      expect(andMock).toHaveBeenCalledTimes(1);
      expect(andMock.mock.calls[0]).toHaveLength(2);
    });
    it('a DB error while recording usage is swallowed and warned', async () => {
      seed('CANCELLED');
      updateWhereMock.mockRejectedValueOnce(new Error('db down'));
      const ctx = costContext();
      await expect(failWorkflow(ctx, new WorkflowCancelledError('op-1'))).resolves.toBeUndefined();
      expect((ctx as unknown as { logger: { warn: jest.Mock } }).logger.warn).toHaveBeenCalled();
    });
    it('control: RUNNING failWorkflow writes no CANCELLED-usage update beyond the transition', async () => {
      seed('RUNNING');
      await failWorkflow(costContext(), new Error('boom'));
      expect(usageUpdates()).toHaveLength(0);
      expect(totalUsedUpdates()).toHaveLength(0);
      expect(mockOps.get('op-1')?.state).toBe('FAILED');
    });
  });});
