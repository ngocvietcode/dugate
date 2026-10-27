import type { Operation } from '@/lib/db/schema';
import {
  createOperationStateTransitionService,
  type CompletionTimestampMode,
  type InsertOperationInput,
  type OperationMembershipChanges,
  type OperationStateChanges,
  type OperationStateStore,
  type OperationStateTransaction,
} from '@/lib/operations/state-transition';
import type { ValidBusinessStatus } from '@/lib/operations/status';

const TERMINAL_TIME = new Date('2025-02-01T12:00:00.000Z');

function operation(
  overrides: Partial<Operation> & Pick<Operation, 'id'>,
): Operation {
  return {
    apiKeyId: null,
    clientReference: null,
    businessGroupKey: `request:${overrides.id}`,
    pipelineJson: '[]',
    state: 'RUNNING',
    done: false,
    hiddenFromOperations: false,
    deletedAt: null,
    completedAt: null,
    ...overrides,
  } as Operation;
}

function groupKeyFor(input: InsertOperationInput, id: string): string {
  const reference = input.clientReference?.trim();
  return reference
    ? `profile:${input.apiKeyId ?? '__internal__'}:reference:${reference}`
    : `request:${id}`;
}

function cloneOperations(
  source: ReadonlyMap<string, Operation>,
): Map<string, Operation> {
  return new Map(
    [...source].map(([id, item]) => [id, { ...item }]),
  );
}

/**
 * A deterministic transactional store. Transactions are queued, work against
 * private copies, and publish Operation plus snapshot state only on commit.
 */
class TransactionalMemoryStateStore implements OperationStateStore {
  readonly operations = new Map<string, Operation>();
  readonly snapshots = new Map<string, ValidBusinessStatus>();
  snapshotWrites = 0;
  failAfterNextSnapshotWrite = false;

  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(
    callback: (transaction: OperationStateTransaction) => Promise<T>,
  ): Promise<T> {
    const predecessor = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;

    const workingOperations = cloneOperations(this.operations);
    const workingSnapshots = new Map(this.snapshots);

    const transaction: OperationStateTransaction = {
      insertOperation: async (input) => {
        const id = input.id ?? `operation-${workingOperations.size + 1}`;
        const state = input.state ?? 'RUNNING';
        const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state);
        const inserted = operation({
          ...(input as Partial<Operation>),
          id,
          state,
          done: input.done ?? terminal,
          completedAt: terminal ? TERMINAL_TIME : null,
          businessGroupKey: groupKeyFor(input, id),
        });
        workingOperations.set(id, inserted);
        return inserted;
      },

      findOperationForTransition: async (operationId) =>
        workingOperations.get(operationId) ?? null,

      updateOperationState: async (
        operationId: string,
        state: string,
        changes: OperationStateChanges,
        completionTimestampMode: CompletionTimestampMode,
      ) => {
        const existing = workingOperations.get(operationId);
        if (!existing) return null;

        Object.assign(existing, changes, { state });
        if (completionTimestampMode === 'SET_IF_MISSING') {
          existing.completedAt ??= TERMINAL_TIME;
        } else if (completionTimestampMode === 'CLEAR') {
          existing.completedAt = null;
        }
        return existing;
      },

      deleteOperation: async (operationId) => {
        const existing = workingOperations.get(operationId) ?? null;
        workingOperations.delete(operationId);
        return existing;
      },

      updateOperationMembership: async (
        operationId: string,
        changes: OperationMembershipChanges,
      ) => {
        const existing = workingOperations.get(operationId);
        if (!existing) return null;
        Object.assign(existing, changes);
        return existing;
      },

      lockBusinessGroup: async () => undefined,

      listEligibleGroupStates: async (businessGroupKey) =>
        [...workingOperations.values()]
          .filter(
            (item) =>
              item.businessGroupKey === businessGroupKey &&
              item.deletedAt === null &&
              !item.hiddenFromOperations,
          )
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((item) => item.state),

      upsertLastValidStatus: async (businessGroupKey, status) => {
        workingSnapshots.set(businessGroupKey, status);
        this.snapshotWrites += 1;
        if (this.failAfterNextSnapshotWrite) {
          this.failAfterNextSnapshotWrite = false;
          throw new Error('injected snapshot write failure');
        }
      },

      deleteLastValidStatus: async (businessGroupKey) => {
        workingSnapshots.delete(businessGroupKey);
      },
    };

    try {
      const result = await callback(transaction);
      this.operations.clear();
      workingOperations.forEach((item, id) => this.operations.set(id, item));
      this.snapshots.clear();
      workingSnapshots.forEach((status, key) => this.snapshots.set(key, status));
      return result;
    } finally {
      release();
    }
  }
}

describe('Operation state-transition transactional and concurrency behavior', () => {
  it('makes duplicate terminal transitions idempotent', async () => {
    const store = new TransactionalMemoryStateStore();
    const group = 'request:request-1';
    store.operations.set(
      'request-1',
      operation({ id: 'request-1', businessGroupKey: group }),
    );
    store.snapshots.set(group, 'IN_PROGRESS');
    const service = createOperationStateTransitionService(store);

    const first = await service.transitionOperationState({
      operationId: 'request-1',
      state: 'SUCCEEDED',
    });
    const second = await service.transitionOperationState({
      operationId: 'request-1',
      state: 'SUCCEEDED',
    });

    expect(first.completedAt).toEqual(TERMINAL_TIME);
    expect(second.completedAt).toEqual(TERMINAL_TIME);
    expect(store.operations.get('request-1')).toMatchObject({
      state: 'SUCCEEDED',
      done: true,
      completedAt: TERMINAL_TIME,
    });
    expect(store.snapshots.get(group)).toBe('SUCCEEDED');
    expect(store.snapshotWrites).toBe(2);
  });

  it('serializes concurrent writers in one group without losing either state update', async () => {
    const store = new TransactionalMemoryStateStore();
    const group = 'profile:p1:reference:case-1';
    store.operations.set(
      'request-1',
      operation({ id: 'request-1', businessGroupKey: group }),
    );
    store.operations.set(
      'request-2',
      operation({ id: 'request-2', businessGroupKey: group }),
    );
    store.snapshots.set(group, 'IN_PROGRESS');
    const service = createOperationStateTransitionService(store);

    await Promise.all([
      service.transitionOperationState({
        operationId: 'request-1',
        state: 'SUCCEEDED',
      }),
      service.transitionOperationState({
        operationId: 'request-2',
        state: 'FAILED',
      }),
    ]);

    expect(store.operations.get('request-1')?.state).toBe('SUCCEEDED');
    expect(store.operations.get('request-2')?.state).toBe('FAILED');
    expect(store.snapshots.get(group)).toBe('FAILED');
  });

  it('preserves the last-valid snapshot through unknown-state interleaving and recovers from current rows', async () => {
    const store = new TransactionalMemoryStateStore();
    const group = 'profile:p1:reference:case-unknown';
    store.operations.set(
      'request-1',
      operation({ id: 'request-1', businessGroupKey: group }),
    );
    store.operations.set(
      'request-2',
      operation({ id: 'request-2', businessGroupKey: group }),
    );
    store.snapshots.set(group, 'IN_PROGRESS');
    const service = createOperationStateTransitionService(store);

    await Promise.all([
      service.transitionOperationState({
        operationId: 'request-1',
        state: 'LEGACY_UNKNOWN',
      }),
      service.transitionOperationState({
        operationId: 'request-2',
        state: 'SUCCEEDED',
      }),
    ]);

    expect(store.snapshots.get(group)).toBe('IN_PROGRESS');

    await service.transitionOperationState({
      operationId: 'request-1',
      state: 'SUCCEEDED',
    });

    expect(store.snapshots.get(group)).toBe('SUCCEEDED');
  });

  it('recomputes snapshots after add, state update, hide, unhide, soft-delete, and hard-delete', async () => {
    const store = new TransactionalMemoryStateStore();
    const group = 'profile:p1:reference:case-membership';
    store.operations.set(
      'request-1',
      operation({
        id: 'request-1',
        businessGroupKey: group,
        apiKeyId: 'p1',
        clientReference: 'case-membership',
        state: 'SUCCEEDED',
        done: true,
        completedAt: TERMINAL_TIME,
      }),
    );
    store.snapshots.set(group, 'SUCCEEDED');
    const service = createOperationStateTransitionService(store);

    await service.insertOperation({
      id: 'request-2',
      apiKeyId: 'p1',
      clientReference: ' case-membership ',
      pipelineJson: '[]',
      state: 'RUNNING',
    });
    expect(store.snapshots.get(group)).toBe('IN_PROGRESS');

    await service.transitionOperationState({
      operationId: 'request-2',
      state: 'FAILED',
    });
    expect(store.snapshots.get(group)).toBe('FAILED');

    await service.updateOperationMembership({
      operationId: 'request-2',
      changes: { hiddenFromOperations: true },
    });
    expect(store.snapshots.get(group)).toBe('SUCCEEDED');

    await service.updateOperationMembership({
      operationId: 'request-2',
      changes: { hiddenFromOperations: false },
    });
    expect(store.snapshots.get(group)).toBe('FAILED');

    await service.updateOperationMembership({
      operationId: 'request-2',
      changes: { deletedAt: TERMINAL_TIME },
    });
    expect(store.snapshots.get(group)).toBe('SUCCEEDED');

    await service.deleteOperation('request-1');
    expect(store.snapshots.has(group)).toBe(false);
  });

  it('commits Operation and snapshot together and rolls both back on snapshot failure', async () => {
    const store = new TransactionalMemoryStateStore();
    const service = createOperationStateTransitionService(store);
    const group = 'request:request-rollback';
    store.failAfterNextSnapshotWrite = true;

    await expect(
      service.insertOperation({
        id: 'request-rollback',
        pipelineJson: '[]',
        state: 'RUNNING',
      }),
    ).rejects.toThrow('injected snapshot write failure');

    expect(store.operations.has('request-rollback')).toBe(false);
    expect(store.snapshots.has(group)).toBe(false);

    await service.insertOperation({
      id: 'request-rollback',
      pipelineJson: '[]',
      state: 'RUNNING',
    });

    expect(store.operations.get('request-rollback')?.state).toBe('RUNNING');
    expect(store.snapshots.get(group)).toBe('IN_PROGRESS');
  });
});
