/**
 * Failed-billing policy, workflow side: a parent workflow owns no AI spend (its sub-ops already
 * charged themselves in runPipeline), so failWorkflow / pauseWorkflow must never add to totalUsed.
 * See .agents/tasks/h4-failed-billing-plan.md.
 */
const mockOps = new Map<string, Record<string, unknown>>();
const updateSetMock = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
const updateMock = jest.fn(() => ({ set: updateSetMock }));
const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });

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
  and: jest.fn(() => 'and-clause'),
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

import { completeWorkflow, failWorkflow, pauseWorkflow } from '@/lib/pipelines/workflow-engine';

function seed(state: string) {
  mockOps.set('op-1', { id: 'op-1', businessGroupKey: 'request:op-1', state, done: state !== 'RUNNING' });
}
function context() {
  return {
    operationId: 'op-1',
    endpointSlug: 'workflows:loan-appraisal',
    stepsResult: [],
    currentStep: 0,
    totalInputTokens: 10,
    totalOutputTokens: 5,
    totalCost: 1.5,
    usageBreakdown: [],
    pipelineVars: {},
    webhookUrl: 'https://example.test/hook',
    apiKeyId: 'k1',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as never;
}
function totalUsedUpdates() {
  return (updateSetMock.mock.calls as unknown[][]).filter(([arg]) => arg && 'totalUsed' in (arg as object));
}

describe('workflow parent never re-charges what sub-ops already billed', () => {
  beforeEach(() => {
    mockOps.clear();
    jest.clearAllMocks();
  });

  it('W1 FAILED parent carries the children sum on the row but adds nothing to totalUsed; webhook sent', async () => {
    seed('RUNNING');
    await failWorkflow(context(), new Error('boom'));
    expect(mockOps.get('op-1')?.state).toBe('FAILED');
    expect(mockOps.get('op-1')?.totalCostUsd).toBe(1.5);
    expect(totalUsedUpdates()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('W2 repeated failWorkflow adds nothing', async () => {
    seed('RUNNING');
    const ctx = context();
    await failWorkflow(ctx, new Error('boom'));
    await failWorkflow(ctx, new Error('boom'));
    expect(totalUsedUpdates()).toHaveLength(0);
  });

  it('W3 CANCELLED parent stays uncharged after fail/complete', async () => {
    seed('CANCELLED');
    const ctx = context();
    await failWorkflow(ctx, new Error('boom'));
    await completeWorkflow(ctx, 'out', {});
    expect(totalUsedUpdates()).toHaveLength(0);
  });

  it('W4 pauseWorkflow does not charge', async () => {
    seed('RUNNING');
    await pauseWorkflow(context(), 'need input', 1);
    expect(totalUsedUpdates()).toHaveLength(0);
  });

  // Sub-ops already charged their own cost in runPipeline and ctx.totalCost is only the sum of
  // those costs, so a SUCCEEDED parent must not charge it a second time (double count removed).
  it('C1 completeWorkflow carries the children sum on the row but adds nothing to totalUsed', async () => {
    seed('RUNNING');
    await completeWorkflow(context(), 'out', {});
    expect(mockOps.get('op-1')?.state).toBe('SUCCEEDED');
    expect(mockOps.get('op-1')?.totalCostUsd).toBe(1.5);
    expect(totalUsedUpdates()).toHaveLength(0);
  });
});
