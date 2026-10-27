import { and, asc, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  businessOperationStatusSnapshots,
  operations,
  type NewOperation,
  type Operation,
} from '@/lib/db/schema';
import {
  aggregateCurrentStatus,
  classifyRequestState,
  type ValidBusinessStatus,
} from '@/lib/operations/status';

const IMMUTABLE_IDENTITY_FIELDS = [
  'apiKeyId',
  'clientReference',
  'businessGroupKey',
] as const;

export type CompletionTimestampMode =
  | 'SET_IF_MISSING'
  | 'CLEAR'
  | 'PRESERVE';

export type InsertOperationInput = Omit<
  NewOperation,
  'businessGroupKey' | 'completedAt'
> & {
  businessGroupKey?: never;
  completedAt?: never;
};

export type OperationStateChanges = Omit<
  Partial<NewOperation>,
  | 'id'
  | 'state'
  | 'apiKeyId'
  | 'clientReference'
  | 'businessGroupKey'
  | 'createdAt'
  | 'updatedAt'
  | 'completedAt'
>;

export interface TransitionOperationStateInput {
  operationId: string;
  state: string;
  changes?: OperationStateChanges;
  /** Optional compare-and-set guard for worker paths that must not overwrite progress. */
  onlyIf?: {
    state?: string;
    done?: boolean;
    /** Skip the write when the locked row is already in one of these states (e.g. CANCELLED). */
    stateNotIn?: readonly string[];
  };
}

export type OperationMembershipChanges = Pick<
  Partial<Operation>,
  'deletedAt' | 'hiddenFromOperations'
>;

export interface UpdateOperationMembershipInput {
  operationId: string;
  changes: OperationMembershipChanges;
}

export type GroupRecomputeAction =
  | 'UPSERTED'
  | 'PRESERVED_UNKNOWN'
  | 'DELETED_EMPTY';

export interface GroupRecomputeResult {
  businessGroupKey: string;
  action: GroupRecomputeAction;
  status: ValidBusinessStatus | null;
}

/**
 * Narrow transaction boundary used by the state-transition orchestration.
 * Keeping this interface small makes the atomic behavior independently testable
 * while the production implementation remains a single Drizzle transaction.
 */
export interface OperationStateTransaction {
  insertOperation(input: InsertOperationInput): Promise<Operation>;
  findOperationForTransition(operationId: string): Promise<Operation | null>;
  updateOperationState(
    operationId: string,
    state: string,
    changes: OperationStateChanges,
    completionTimestampMode: CompletionTimestampMode,
  ): Promise<Operation | null>;
  deleteOperation(operationId: string): Promise<Operation | null>;
  updateOperationMembership(
    operationId: string,
    changes: OperationMembershipChanges,
  ): Promise<Operation | null>;
  lockBusinessGroup(businessGroupKey: string): Promise<void>;
  listEligibleGroupStates(businessGroupKey: string): Promise<string[]>;
  upsertLastValidStatus(
    businessGroupKey: string,
    status: ValidBusinessStatus,
  ): Promise<void>;
  deleteLastValidStatus(businessGroupKey: string): Promise<void>;
}

export interface OperationStateStore {
  transaction<T>(
    callback: (transaction: OperationStateTransaction) => Promise<T>,
  ): Promise<T>;
}

export class OperationNotFoundError extends Error {
  constructor(readonly operationId: string) {
    super(`Operation not found: ${operationId}`);
    this.name = 'OperationNotFoundError';
  }
}

export class ImmutableOperationIdentityError extends Error {
  constructor(readonly field: (typeof IMMUTABLE_IDENTITY_FIELDS)[number]) {
    super(`${field} is immutable after an Operation is inserted`);
    this.name = 'ImmutableOperationIdentityError';
  }
}

function completionTimestampModeForState(
  state: string,
): CompletionTimestampMode {
  const category = classifyRequestState(state);
  if (category === 'SUCCESSFUL' || category === 'UNSUCCESSFUL') {
    return 'SET_IF_MISSING';
  }
  if (category === 'ACTIVE') {
    return 'CLEAR';
  }
  return 'PRESERVE';
}

function normalizeKnownStateDoneFlag(
  state: string,
  changes: OperationStateChanges,
): OperationStateChanges {
  const category = classifyRequestState(state);
  if (category === 'SUCCESSFUL' || category === 'UNSUCCESSFUL') {
    return { ...changes, done: true };
  }
  if (category === 'ACTIVE') {
    return { ...changes, done: false };
  }
  return changes;
}

function assertIdentityIsNotMutated(changes: unknown): void {
  if (!changes || typeof changes !== 'object') return;

  for (const field of IMMUTABLE_IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      throw new ImmutableOperationIdentityError(field);
    }
  }
}

async function recomputeLockedBusinessGroup(
  transaction: OperationStateTransaction,
  businessGroupKey: string,
): Promise<GroupRecomputeResult> {
  const states = await transaction.listEligibleGroupStates(businessGroupKey);

  if (states.length === 0) {
    await transaction.deleteLastValidStatus(businessGroupKey);
    return {
      businessGroupKey,
      action: 'DELETED_EMPTY',
      status: null,
    };
  }

  const status = aggregateCurrentStatus(states);
  if (status === null) {
    // Unknown source state: preserve the last known-valid snapshot exactly as-is.
    return {
      businessGroupKey,
      action: 'PRESERVED_UNKNOWN',
      status: null,
    };
  }

  await transaction.upsertLastValidStatus(businessGroupKey, status);
  return {
    businessGroupKey,
    action: 'UPSERTED',
    status,
  };
}

/**
 * Recomputes one or more groups in an existing transaction. Keys are sorted and
 * de-duplicated before locking to give future old/new-group regroup commands a
 * stable lock order and avoid lock-order deadlocks.
 */
export async function recomputeBusinessOperationGroups(
  transaction: OperationStateTransaction,
  businessGroupKeys: readonly string[],
): Promise<GroupRecomputeResult[]> {
  const orderedKeys = [...new Set(businessGroupKeys)].sort();

  for (const businessGroupKey of orderedKeys) {
    await transaction.lockBusinessGroup(businessGroupKey);
  }

  const results: GroupRecomputeResult[] = [];
  for (const businessGroupKey of orderedKeys) {
    results.push(
      await recomputeLockedBusinessGroup(transaction, businessGroupKey),
    );
  }
  return results;
}

export function createOperationStateTransitionService(
  store: OperationStateStore,
) {
  return {
    async insertOperation(input: InsertOperationInput): Promise<Operation> {
      return store.transaction(async (transaction) => {
        const inserted = await transaction.insertOperation(input);
        await recomputeBusinessOperationGroups(transaction, [
          inserted.businessGroupKey,
        ]);
        return inserted;
      });
    },

    async deleteOperation(operationId: string): Promise<Operation> {
      return store.transaction(async (transaction) => {
        const existing = await transaction.findOperationForTransition(
          operationId,
        );
        if (!existing) {
          throw new OperationNotFoundError(operationId);
        }

        await transaction.lockBusinessGroup(existing.businessGroupKey);
        const deleted = await transaction.deleteOperation(operationId);
        if (!deleted) {
          throw new OperationNotFoundError(operationId);
        }

        await recomputeLockedBusinessGroup(
          transaction,
          existing.businessGroupKey,
        );
        return deleted;
      });
    },

    async updateOperationMembership(
      input: UpdateOperationMembershipInput,
    ): Promise<Operation> {
      return store.transaction(async (transaction) => {
        const existing = await transaction.findOperationForTransition(
          input.operationId,
        );
        if (!existing) {
          throw new OperationNotFoundError(input.operationId);
        }

        await transaction.lockBusinessGroup(existing.businessGroupKey);
        const updated = await transaction.updateOperationMembership(
          input.operationId,
          input.changes,
        );
        if (!updated) {
          throw new OperationNotFoundError(input.operationId);
        }

        await recomputeLockedBusinessGroup(
          transaction,
          existing.businessGroupKey,
        );
        return updated;
      });
    },

    async transitionOperationState(
      input: TransitionOperationStateInput,
    ): Promise<Operation> {
      assertIdentityIsNotMutated(input.changes);

      return store.transaction(async (transaction) => {
        const existing = await transaction.findOperationForTransition(
          input.operationId,
        );
        if (!existing) {
          throw new OperationNotFoundError(input.operationId);
        }

        if (
          (input.onlyIf?.state !== undefined &&
            existing.state !== input.onlyIf.state) ||
          (input.onlyIf?.done !== undefined &&
            existing.done !== input.onlyIf.done) ||
          input.onlyIf?.stateNotIn?.includes(existing.state)
        ) {
          return existing;
        }

        // Lock before writing so every writer for this business group observes
        // the latest committed constituent states when it recomputes.
        await transaction.lockBusinessGroup(existing.businessGroupKey);

        const changes = normalizeKnownStateDoneFlag(
          input.state,
          input.changes ?? {},
        );
        const updated = await transaction.updateOperationState(
          input.operationId,
          input.state,
          changes,
          completionTimestampModeForState(input.state),
        );
        if (!updated) {
          throw new OperationNotFoundError(input.operationId);
        }

        await recomputeLockedBusinessGroup(
          transaction,
          existing.businessGroupKey,
        );
        return updated;
      });
    },

    async recomputeGroups(
      businessGroupKeys: readonly string[],
    ): Promise<GroupRecomputeResult[]> {
      return store.transaction((transaction) =>
        recomputeBusinessOperationGroups(transaction, businessGroupKeys),
      );
    },
  };
}

const drizzleOperationStateStore: OperationStateStore = {
  transaction<T>(
    callback: (transaction: OperationStateTransaction) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (transaction) =>
      callback({
        async insertOperation(input) {
          const state = input.state ?? 'RUNNING';
          const category = classifyRequestState(state);
          const terminal =
            category === 'SUCCESSFUL' || category === 'UNSUCCESSFUL';
          const [inserted] = await transaction
            .insert(operations)
            .values({
              ...input,
              state,
              done:
                input.done ??
                (terminal ? true : category === 'ACTIVE' ? false : false),
              completedAt: terminal ? sql`CURRENT_TIMESTAMP(3)` : null,
            })
            .returning();
          return inserted;
        },

        async findOperationForTransition(operationId) {
          const [operation] = await transaction
            .select()
            .from(operations)
            .where(eq(operations.id, operationId))
            .limit(1)
            .for('update');
          return operation ?? null;
        },

        async updateOperationState(
          operationId,
          state,
          changes,
          completionTimestampMode,
        ) {
          const completionTimestamp =
            completionTimestampMode === 'SET_IF_MISSING'
              ? {
                  completedAt: sql`COALESCE(${operations.completedAt}, CURRENT_TIMESTAMP(3))`,
                }
              : completionTimestampMode === 'CLEAR'
                ? { completedAt: null }
                : {};
          const [updated] = await transaction
            .update(operations)
            .set({
              ...changes,
              ...completionTimestamp,
              state,
            })
            .where(eq(operations.id, operationId))
            .returning();
          return updated ?? null;
        },

        async deleteOperation(operationId) {
          const [deleted] = await transaction
            .delete(operations)
            .where(eq(operations.id, operationId))
            .returning();
          return deleted ?? null;
        },

        async updateOperationMembership(operationId, changes) {
          const [updated] = await transaction
            .update(operations)
            .set(changes)
            .where(eq(operations.id, operationId))
            .returning();
          return updated ?? null;
        },

        async lockBusinessGroup(businessGroupKey) {
          await transaction.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${businessGroupKey}, 0))`,
          );
        },

        async listEligibleGroupStates(businessGroupKey) {
          const rows = await transaction
            .select({ state: operations.state })
            .from(operations)
            .where(
              and(
                eq(operations.businessGroupKey, businessGroupKey),
                sql`${operations.deletedAt} IS NULL`,
                eq(operations.hiddenFromOperations, false),
              ),
            )
            .orderBy(asc(operations.id));
          return rows.map((row) => row.state);
        },

        async upsertLastValidStatus(businessGroupKey, status) {
          await transaction
            .insert(businessOperationStatusSnapshots)
            .values({
              businessGroupKey,
              lastValidStatus: status,
              updatedAt: sql`CURRENT_TIMESTAMP(3)`,
            })
            .onConflictDoUpdate({
              target: businessOperationStatusSnapshots.businessGroupKey,
              set: {
                lastValidStatus: status,
                updatedAt: sql`CURRENT_TIMESTAMP(3)`,
              },
            });
        },

        async deleteLastValidStatus(businessGroupKey) {
          await transaction
            .delete(businessOperationStatusSnapshots)
            .where(
              eq(
                businessOperationStatusSnapshots.businessGroupKey,
                businessGroupKey,
              ),
            );
        },
      }),
    );
  },
};

const defaultService = createOperationStateTransitionService(
  drizzleOperationStateStore,
);

export const insertOperation = defaultService.insertOperation;
export const deleteOperation = defaultService.deleteOperation;
export const updateOperationMembership =
  defaultService.updateOperationMembership;
export const transitionOperationState = defaultService.transitionOperationState;
export const recomputeBusinessOperationStatusGroups =
  defaultService.recomputeGroups;
