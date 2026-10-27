import postgres from 'postgres';

import type { Operation } from '@/lib/db/schema';
import {
  createOperationStateTransitionService,
  type InsertOperationInput,
  type OperationStateStore,
  type OperationStateTransaction,
} from '@/lib/operations/state-transition';

/**
 * Opt-in PostgreSQL integration suite for task 5.4.
 *
 * The suite creates and drops an isolated schema and never falls back to the
 * application DATABASE_URL. Point OPERATIONS_TRACKING_TEST_DATABASE_URL (or
 * TEST_DATABASE_URL) at a disposable PostgreSQL database to enable it.
 */
const integrationDatabaseUrl = process.env.OPERATIONS_TRACKING_TEST_DATABASE_URL
  ?? process.env.TEST_DATABASE_URL;
const describePostgres = integrationDatabaseUrl ? describe : describe.skip;

type SqlClient = ReturnType<typeof postgres>;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function groupKeyFor(input: InsertOperationInput, id: string): string {
  const reference = input.clientReference?.trim();
  return reference
    ? `profile:${input.apiKeyId ?? '__internal__'}:reference:${reference}`
    : `request:${id}`;
}

function toOperation(row: Record<string, unknown>): Operation {
  return {
    id: String(row.id),
    apiKeyId: row.apiKeyId === null ? null : String(row.apiKeyId),
    clientReference:
      row.clientReference === null ? null : String(row.clientReference),
    businessGroupKey: String(row.businessGroupKey),
    pipelineJson: '[]',
    state: String(row.state),
    done: Boolean(row.done),
    hiddenFromOperations: Boolean(row.hiddenFromOperations),
    deletedAt: row.deletedAt === null ? null : row.deletedAt as Date,
    completedAt: row.completedAt === null ? null : row.completedAt as Date,
  } as Operation;
}

class TwoWriterBarrier {
  private arrivals = 0;
  private release!: () => void;
  private readonly released = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async wait(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals === 2) this.release();
    await this.released;
  }
}

class PostgresOperationStateStore implements OperationStateStore {
  failAfterNextSnapshotWrite = false;
  lockBarrier: TwoWriterBarrier | null = null;

  constructor(private readonly client: SqlClient) {}

  async transaction<T>(
    callback: (transaction: OperationStateTransaction) => Promise<T>,
  ): Promise<T> {
    const result = await this.client.begin(async (databaseTransaction) =>
      callback({
        insertOperation: async (input) => {
          const id = input.id ?? `operation-${Date.now()}`;
          const state = input.state ?? 'RUNNING';
          const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state);
          const rows = await databaseTransaction`
            INSERT INTO "Operation" (
              "id", "apiKeyId", "clientReference", "businessGroupKey",
              "state", "done", "completedAt"
            ) VALUES (
              ${id}, ${input.apiKeyId ?? null}, ${input.clientReference ?? null},
              ${groupKeyFor(input, id)}, ${state},
              ${input.done ?? terminal},
              ${terminal ? new Date('2025-02-01T12:00:00.000Z') : null}
            )
            RETURNING *
          `;
          return toOperation(rows[0]);
        },

        findOperationForTransition: async (operationId) => {
          const rows = await databaseTransaction`
            SELECT * FROM "Operation"
             WHERE "id" = ${operationId}
             LIMIT 1
             FOR UPDATE
          `;
          return rows[0] ? toOperation(rows[0]) : null;
        },

        updateOperationState: async (
          operationId,
          state,
          changes,
          completionTimestampMode,
        ) => {
          const done = changes.done ?? null;
          const rows = completionTimestampMode === 'SET_IF_MISSING'
            ? await databaseTransaction`
                UPDATE "Operation"
                   SET "state" = ${state},
                       "done" = COALESCE(${done}, "done"),
                       "completedAt" = COALESCE(
                         "completedAt", CURRENT_TIMESTAMP(3)
                       )
                 WHERE "id" = ${operationId}
                 RETURNING *
              `
            : completionTimestampMode === 'CLEAR'
              ? await databaseTransaction`
                  UPDATE "Operation"
                     SET "state" = ${state},
                         "done" = COALESCE(${done}, "done"),
                         "completedAt" = NULL
                   WHERE "id" = ${operationId}
                   RETURNING *
                `
              : await databaseTransaction`
                  UPDATE "Operation"
                     SET "state" = ${state},
                         "done" = COALESCE(${done}, "done")
                   WHERE "id" = ${operationId}
                   RETURNING *
                `;
          return rows[0] ? toOperation(rows[0]) : null;
        },

        deleteOperation: async (operationId) => {
          const rows = await databaseTransaction`
            DELETE FROM "Operation"
             WHERE "id" = ${operationId}
             RETURNING *
          `;
          return rows[0] ? toOperation(rows[0]) : null;
        },

        updateOperationMembership: async (operationId, changes) => {
          const hasHidden = changes.hiddenFromOperations !== undefined;
          const hasDeleted = Object.prototype.hasOwnProperty.call(
            changes,
            'deletedAt',
          );
          const rows = await databaseTransaction`
            UPDATE "Operation"
               SET "hiddenFromOperations" = CASE
                     WHEN ${hasHidden} THEN ${changes.hiddenFromOperations ?? false}
                     ELSE "hiddenFromOperations"
                   END,
                   "deletedAt" = CASE
                     WHEN ${hasDeleted}
                       THEN ${changes.deletedAt ?? null}::timestamptz
                     ELSE "deletedAt"
                   END
             WHERE "id" = ${operationId}
             RETURNING *
          `;
          return rows[0] ? toOperation(rows[0]) : null;
        },

        lockBusinessGroup: async (businessGroupKey) => {
          const barrier = this.lockBarrier;
          if (barrier) await barrier.wait();
          await databaseTransaction`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${businessGroupKey}, 0)
            )
          `;
        },

        listEligibleGroupStates: async (businessGroupKey) => {
          const rows = await databaseTransaction`
            SELECT "state"
              FROM "Operation"
             WHERE "businessGroupKey" = ${businessGroupKey}
               AND "deletedAt" IS NULL
               AND "hiddenFromOperations" = false
             ORDER BY "id" ASC
          `;
          return rows.map((row) => String(row.state));
        },

        upsertLastValidStatus: async (businessGroupKey, status) => {
          await databaseTransaction`
            INSERT INTO "BusinessOperationStatusSnapshot" (
              "businessGroupKey", "lastValidStatus", "updatedAt"
            ) VALUES (${businessGroupKey}, ${status}, CURRENT_TIMESTAMP(3))
            ON CONFLICT ("businessGroupKey") DO UPDATE
              SET "lastValidStatus" = EXCLUDED."lastValidStatus",
                  "updatedAt" = EXCLUDED."updatedAt"
          `;
          if (this.failAfterNextSnapshotWrite) {
            this.failAfterNextSnapshotWrite = false;
            throw new Error('injected PostgreSQL snapshot failure');
          }
        },

        deleteLastValidStatus: async (businessGroupKey) => {
          await databaseTransaction`
            DELETE FROM "BusinessOperationStatusSnapshot"
             WHERE "businessGroupKey" = ${businessGroupKey}
          `;
        },
      }),
    );
    return result as unknown as T;
  }
}

async function createTransitionSchema(client: SqlClient): Promise<void> {
  await client.unsafe(`
    CREATE TABLE "Operation" (
      "id" text PRIMARY KEY,
      "apiKeyId" text,
      "clientReference" text,
      "businessGroupKey" text NOT NULL,
      "state" text NOT NULL,
      "done" boolean NOT NULL DEFAULT false,
      "hiddenFromOperations" boolean NOT NULL DEFAULT false,
      "deletedAt" timestamptz,
      "completedAt" timestamptz
    );

    CREATE TABLE "BusinessOperationStatusSnapshot" (
      "businessGroupKey" text PRIMARY KEY,
      "lastValidStatus" text NOT NULL CHECK (
        "lastValidStatus" IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED')
      ),
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    );
  `);
}

describePostgres('Operation state-transition PostgreSQL concurrency', () => {
  let administrationClient: SqlClient;
  let client: SqlClient;
  let schemaName: string;
  let store: PostgresOperationStateStore;

  beforeAll(() => {
    administrationClient = postgres(integrationDatabaseUrl!, { max: 1 });
  });

  beforeEach(async () => {
    schemaName = `operation_transition_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await administrationClient.unsafe(
      `CREATE SCHEMA ${quoteIdentifier(schemaName)}`,
    );
    client = postgres(integrationDatabaseUrl!, {
      max: 4,
      connection: { search_path: schemaName },
    });
    await createTransitionSchema(client);
    store = new PostgresOperationStateStore(client);
  });

  afterEach(async () => {
    await client.end({ timeout: 5 });
    await administrationClient.unsafe(
      `DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`,
    );
  });

  afterAll(async () => {
    await administrationClient.end({ timeout: 5 });
  });

  it('serializes same-group writers and snapshots the fully committed state vector', async () => {
    const group = 'profile:p1:reference:concurrent-case';
    await client`
      INSERT INTO "Operation" (
        "id", "businessGroupKey", "state", "done"
      ) VALUES
        ('request-1', ${group}, 'RUNNING', false),
        ('request-2', ${group}, 'RUNNING', false)
    `;
    await client`
      INSERT INTO "BusinessOperationStatusSnapshot" (
        "businessGroupKey", "lastValidStatus"
      ) VALUES (${group}, 'IN_PROGRESS')
    `;

    store.lockBarrier = new TwoWriterBarrier();
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
    store.lockBarrier = null;

    const rows = await client`
      SELECT "id", "state" FROM "Operation" ORDER BY "id" ASC
    `;
    const snapshots = await client`
      SELECT "lastValidStatus"
        FROM "BusinessOperationStatusSnapshot"
       WHERE "businessGroupKey" = ${group}
    `;

    expect(rows.map((row) => [row.id, row.state])).toEqual([
      ['request-1', 'SUCCEEDED'],
      ['request-2', 'FAILED'],
    ]);
    expect(snapshots[0].lastValidStatus).toBe('FAILED');
  });

  it('does not regress a snapshot when an unknown state interleaves with a known transition', async () => {
    const group = 'profile:p1:reference:unknown-case';
    await client`
      INSERT INTO "Operation" (
        "id", "businessGroupKey", "state", "done"
      ) VALUES
        ('request-1', ${group}, 'RUNNING', false),
        ('request-2', ${group}, 'RUNNING', false)
    `;
    await client`
      INSERT INTO "BusinessOperationStatusSnapshot" (
        "businessGroupKey", "lastValidStatus"
      ) VALUES (${group}, 'IN_PROGRESS')
    `;

    store.lockBarrier = new TwoWriterBarrier();
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
    store.lockBarrier = null;

    const preserved = await client`
      SELECT "lastValidStatus"
        FROM "BusinessOperationStatusSnapshot"
       WHERE "businessGroupKey" = ${group}
    `;
    expect(preserved[0].lastValidStatus).toBe('IN_PROGRESS');

    await service.transitionOperationState({
      operationId: 'request-1',
      state: 'SUCCEEDED',
    });
    const recovered = await client`
      SELECT "lastValidStatus"
        FROM "BusinessOperationStatusSnapshot"
       WHERE "businessGroupKey" = ${group}
    `;
    expect(recovered[0].lastValidStatus).toBe('SUCCEEDED');
  });

  it('rolls back the Operation update when snapshot maintenance fails, then commits both together', async () => {
    const group = 'request:request-rollback';
    await client`
      INSERT INTO "Operation" (
        "id", "businessGroupKey", "state", "done"
      ) VALUES ('request-rollback', ${group}, 'RUNNING', false)
    `;
    await client`
      INSERT INTO "BusinessOperationStatusSnapshot" (
        "businessGroupKey", "lastValidStatus"
      ) VALUES (${group}, 'IN_PROGRESS')
    `;

    const service = createOperationStateTransitionService(store);
    store.failAfterNextSnapshotWrite = true;
    await expect(
      service.transitionOperationState({
        operationId: 'request-rollback',
        state: 'SUCCEEDED',
      }),
    ).rejects.toThrow('injected PostgreSQL snapshot failure');

    const afterRollback = await client`
      SELECT o."state", o."done", s."lastValidStatus"
        FROM "Operation" o
        JOIN "BusinessOperationStatusSnapshot" s
          ON s."businessGroupKey" = o."businessGroupKey"
       WHERE o."id" = 'request-rollback'
    `;
    expect(afterRollback[0]).toMatchObject({
      state: 'RUNNING',
      done: false,
      lastValidStatus: 'IN_PROGRESS',
    });

    await service.transitionOperationState({
      operationId: 'request-rollback',
      state: 'SUCCEEDED',
    });
    const afterCommit = await client`
      SELECT o."state", o."done", s."lastValidStatus"
        FROM "Operation" o
        JOIN "BusinessOperationStatusSnapshot" s
          ON s."businessGroupKey" = o."businessGroupKey"
       WHERE o."id" = 'request-rollback'
    `;
    expect(afterCommit[0]).toMatchObject({
      state: 'SUCCEEDED',
      done: true,
      lastValidStatus: 'SUCCEEDED',
    });
  });
});
