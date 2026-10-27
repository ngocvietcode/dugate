import type { Operation } from '@/lib/db/schema';
import {
  createOperationStateTransitionService,
  ImmutableOperationIdentityError,
  OperationNotFoundError,
  type CompletionTimestampMode,
  type InsertOperationInput,
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

class MemoryStateStore implements OperationStateStore {
  readonly operations = new Map<string, Operation>();
  readonly snapshots = new Map<string, ValidBusinessStatus>();
  readonly events: string[] = [];
  transactionCalls = 0;

  readonly transactionApi: OperationStateTransaction = {
    insertOperation: async (input) => {
      const id = input.id ?? `operation-${this.operations.size + 1}`;
      const state = input.state ?? 'RUNNING';
      const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state);
      const inserted = operation({
        ...(input as Partial<Operation>),
        id,
        state,
        done: terminal,
        completedAt: terminal ? TERMINAL_TIME : null,
        businessGroupKey: groupKeyFor(input, id),
      });
      this.operations.set(id, inserted);
      this.events.push(`insert:${id}`);
      return inserted;
    },

    findOperationForTransition: async (operationId) => {
      this.events.push(`find:${operationId}`);
      return this.operations.get(operationId) ?? null;
    },

    updateOperationState: async (
      operationId: string,
      state: string,
      changes: OperationStateChanges,
      completionTimestampMode: CompletionTimestampMode,
    ) => {
      const existing = this.operations.get(operationId);
      if (!existing) return null;

      Object.assign(existing, changes, { state });
      if (completionTimestampMode === 'SET_IF_MISSING') {
        existing.completedAt ??= TERMINAL_TIME;
      } else if (completionTimestampMode === 'CLEAR') {
        existing.completedAt = null;
      }
      this.events.push(
        `update:${operationId}:${state}:${completionTimestampMode}`,
      );
      return existing;
    },

    deleteOperation: async (operationId) => {
      const existing = this.operations.get(operationId) ?? null;
      if (existing) {
        this.operations.delete(operationId);
        this.events.push(`remove:${operationId}`);
      }
      return existing;
    },

    updateOperationMembership: async (operationId, changes) => {
      const existing = this.operations.get(operationId);
      if (!existing) return null;
      Object.assign(existing, changes);
      this.events.push(`membership:${operationId}`);
      return existing;
    },

    lockBusinessGroup: async (businessGroupKey) => {
      this.events.push(`lock:${businessGroupKey}`);
    },

    listEligibleGroupStates: async (businessGroupKey) => {
      this.events.push(`list:${businessGroupKey}`);
      return [...this.operations.values()]
        .filter(
          (item) =>
            item.businessGroupKey === businessGroupKey &&
            item.deletedAt === null &&
            !item.hiddenFromOperations,
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((item) => item.state);
    },

    upsertLastValidStatus: async (businessGroupKey, status) => {
      this.snapshots.set(businessGroupKey, status);
      this.events.push(`upsert:${businessGroupKey}:${status}`);
    },

    deleteLastValidStatus: async (businessGroupKey) => {
      this.snapshots.delete(businessGroupKey);
      this.events.push(`delete:${businessGroupKey}`);
    },
  };

  async transaction<T>(
    callback: (transaction: OperationStateTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    this.events.push('transaction:start');
    const result = await callback(this.transactionApi);
    this.events.push('transaction:commit');
    return result;
  }
}

describe('Operation state-transition service', () => {
  it('inserts and snapshots an Operation in one transaction', async () => {
    const store = new MemoryStateStore();
    const service = createOperationStateTransitionService(store);

    const inserted = await service.insertOperation({
      id: 'request-1',
      apiKeyId: 'profile-1',
      clientReference: '  CASE-42  ',
      pipelineJson: '[]',
      state: 'RUNNING',
    });

    expect(store.transactionCalls).toBe(1);
    expect(inserted.businessGroupKey).toBe(
      'profile:profile-1:reference:CASE-42',
    );
    expect(store.snapshots.get(inserted.businessGroupKey)).toBe('IN_PROGRESS');
    expect(store.events).toEqual([
      'transaction:start',
      'insert:request-1',
      `lock:${inserted.businessGroupKey}`,
      `list:${inserted.businessGroupKey}`,
      `upsert:${inserted.businessGroupKey}:IN_PROGRESS`,
      'transaction:commit',
    ]);
  });

  it('deletes an Operation and recomputes its group snapshot in one transaction', async () => {
    const store = new MemoryStateStore();
    const group = 'profile:p1:reference:case-1';
    store.operations.set(
      'request-1',
      operation({ id: 'request-1', businessGroupKey: group, state: 'RUNNING' }),
    );
    store.operations.set(
      'request-2',
      operation({ id: 'request-2', businessGroupKey: group, state: 'SUCCEEDED' }),
    );
    store.snapshots.set(group, 'IN_PROGRESS');
    const service = createOperationStateTransitionService(store);

    const deleted = await service.deleteOperation('request-1');

    expect(deleted.id).toBe('request-1');
    expect(store.operations.has('request-1')).toBe(false);
    expect(store.snapshots.get(group)).toBe('SUCCEEDED');
    expect(store.transactionCalls).toBe(1);
    expect(store.events).toEqual([
      'transaction:start',
      'find:request-1',
      `lock:${group}`,
      'remove:request-1',
      `list:${group}`,
      `upsert:${group}:SUCCEEDED`,
      'transaction:commit',
    ]);
  });

  it('sets a terminal timestamp once and fully recomputes mixed terminal state', async () => {
    const store = new MemoryStateStore();
    const group = 'profile:p1:reference:case-1';
    store.operations.set(
      'request-1',
      operation({ id: 'request-1', businessGroupKey: group, state: 'RUNNING' }),
    );
    store.operations.set(
      'request-2',
      operation({ id: 'request-2', businessGroupKey: group, state: 'SUCCEEDED' }),
    );
    const service = createOperationStateTransitionService(store);

    const first = await service.transitionOperationState({
      operationId: 'request-1',
      state: 'FAILED',
      changes: { errorCode: 'PROCESSING_FAILED' },
    });
    const firstCompletedAt = first.completedAt;
    const second = await service.transitionOperationState({
      operationId: 'request-1',
      state: 'FAILED',
      changes: { errorCode: 'PROCESSING_FAILED' },
    });

    expect(first.done).toBe(true);
    expect(firstCompletedAt).toEqual(TERMINAL_TIME);
    expect(second.completedAt).toBe(firstCompletedAt);
    expect(store.snapshots.get(group)).toBe('FAILED');
    expect(store.events).toContain(
      'update:request-1:FAILED:SET_IF_MISSING',
    );
  });

  it('clears terminal completion data when a request returns to an active state', async () => {
    const store = new MemoryStateStore();
    const group = 'request:request-1';
    store.operations.set(
      'request-1',
      operation({
        id: 'request-1',
        businessGroupKey: group,
        state: 'FAILED',
        done: true,
        completedAt: TERMINAL_TIME,
      }),
    );
    const service = createOperationStateTransitionService(store);

    const updated = await service.transitionOperationState({
      operationId: 'request-1',
      state: 'WAITING_USER_INPUT',
    });

    expect(updated.done).toBe(false);
    expect(updated.completedAt).toBeNull();
    expect(store.snapshots.get(group)).toBe('IN_PROGRESS');
  });

  it('preserves the last-valid snapshot for unknown state and replaces it after recovery', async () => {
    const store = new MemoryStateStore();
    const group = 'request:request-1';
    store.operations.set(
      'request-1',
      operation({ id: 'request-1', businessGroupKey: group }),
    );
    store.snapshots.set(group, 'SUCCEEDED');
    const service = createOperationStateTransitionService(store);

    await service.transitionOperationState({
      operationId: 'request-1',
      state: 'LEGACY_UNKNOWN',
    });
    expect(store.snapshots.get(group)).toBe('SUCCEEDED');
    expect(store.events).not.toContain(`upsert:${group}:SUCCEEDED`);
    expect(store.events).not.toContain(`delete:${group}`);

    await service.transitionOperationState({
      operationId: 'request-1',
      state: 'RUNNING',
    });
    expect(store.snapshots.get(group)).toBe('IN_PROGRESS');
  });

  it('locks old/new group keys in deterministic order and deletes empty snapshots', async () => {
    const store = new MemoryStateStore();
    const service = createOperationStateTransitionService(store);
    store.snapshots.set('group:z', 'FAILED');
    store.snapshots.set('group:a', 'SUCCEEDED');

    const results = await service.recomputeGroups([
      'group:z',
      'group:a',
      'group:z',
    ]);

    expect(results).toEqual([
      { businessGroupKey: 'group:a', action: 'DELETED_EMPTY', status: null },
      { businessGroupKey: 'group:z', action: 'DELETED_EMPTY', status: null },
    ]);
    expect(store.events.filter((event) => event.startsWith('lock:'))).toEqual([
      'lock:group:a',
      'lock:group:z',
    ]);
    expect(store.snapshots.size).toBe(0);
  });

  it('does not overwrite a request when a conditional worker transition is stale', async () => {
    const store = new MemoryStateStore();
    const group = 'request:request-1';
    store.operations.set(
      'request-1',
      operation({
        id: 'request-1',
        businessGroupKey: group,
        state: 'SUCCEEDED',
        done: true,
      }),
    );
    store.snapshots.set(group, 'SUCCEEDED');
    const service = createOperationStateTransitionService(store);

    const unchanged = await service.transitionOperationState({
      operationId: 'request-1',
      state: 'FAILED',
      changes: { errorCode: 'STALLED' },
      onlyIf: { state: 'RUNNING', done: false },
    });

    expect(unchanged.state).toBe('SUCCEEDED');
    expect(unchanged.errorCode).toBeUndefined();
    expect(store.snapshots.get(group)).toBe('SUCCEEDED');
    expect(store.events).toEqual([
      'transaction:start',
      'find:request-1',
      'transaction:commit',
    ]);
  });

  it('onlyIf.stateNotIn blocks the write when the locked row is in the excluded set', async () => {
    const store = new MemoryStateStore();
    store.operations.set(
      'request-1',
      operation({ id: 'request-1', state: 'CANCELLED', done: true }),
    );
    const service = createOperationStateTransitionService(store);

    const unchanged = await service.transitionOperationState({
      operationId: 'request-1',
      state: 'SUCCEEDED',
      onlyIf: { stateNotIn: ['CANCELLED'] },
    });

    expect(unchanged.state).toBe('CANCELLED');
    expect(store.events).toEqual([
      'transaction:start',
      'find:request-1',
      'transaction:commit',
    ]);
  });

  it('onlyIf.stateNotIn applies the write when not excluded, and combines with done', async () => {
    const store = new MemoryStateStore();
    store.operations.set('request-1', operation({ id: 'request-1', state: 'RUNNING' }));
    store.operations.set(
      'request-2',
      operation({ id: 'request-2', state: 'RUNNING', done: false }),
    );
    const service = createOperationStateTransitionService(store);

    const applied = await service.transitionOperationState({
      operationId: 'request-1',
      state: 'SUCCEEDED',
      onlyIf: { stateNotIn: ['CANCELLED'] },
    });
    expect(applied.state).toBe('SUCCEEDED');

    const blockedByDone = await service.transitionOperationState({
      operationId: 'request-2',
      state: 'SUCCEEDED',
      onlyIf: { stateNotIn: ['CANCELLED'], done: true },
    });
    expect(blockedByDone.state).toBe('RUNNING');
  });

  it('updates eligible membership and recomputes or deletes the snapshot atomically', async () => {
    const store = new MemoryStateStore();
    const group = 'profile:p1:reference:case-1';
    store.operations.set(
      'request-1',
      operation({ id: 'request-1', businessGroupKey: group, state: 'RUNNING' }),
    );
    store.operations.set(
      'request-2',
      operation({ id: 'request-2', businessGroupKey: group, state: 'SUCCEEDED' }),
    );
    store.snapshots.set(group, 'IN_PROGRESS');
    const service = createOperationStateTransitionService(store);

    await service.updateOperationMembership({
      operationId: 'request-1',
      changes: { hiddenFromOperations: true },
    });
    expect(store.snapshots.get(group)).toBe('SUCCEEDED');

    await service.updateOperationMembership({
      operationId: 'request-2',
      changes: { deletedAt: TERMINAL_TIME },
    });
    expect(store.snapshots.has(group)).toBe(false);
    expect(store.events).toEqual(
      expect.arrayContaining([
        `lock:${group}`,
        'membership:request-1',
        `upsert:${group}:SUCCEEDED`,
        'membership:request-2',
        `delete:${group}`,
      ]),
    );
  });

  it('rejects identity mutation and missing operations without partial writes', async () => {
    const store = new MemoryStateStore();
    const service = createOperationStateTransitionService(store);

    await expect(
      service.transitionOperationState({
        operationId: 'request-1',
        state: 'RUNNING',
        changes: { clientReference: 'changed' } as OperationStateChanges,
      }),
    ).rejects.toBeInstanceOf(ImmutableOperationIdentityError);
    expect(store.transactionCalls).toBe(0);

    await expect(
      service.transitionOperationState({
        operationId: 'missing',
        state: 'FAILED',
      }),
    ).rejects.toBeInstanceOf(OperationNotFoundError);
    expect(store.events).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(update|upsert|delete):/)]),
    );
  });
});
