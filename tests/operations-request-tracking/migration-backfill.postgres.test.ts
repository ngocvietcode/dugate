import { readFileSync } from 'node:fs';
import path from 'node:path';

import postgres from 'postgres';

import {
  runOperationsBackfill,
  type ApplyOperationBatchResult,
  type BackfillCheckpoint,
  type HistoricalOperationRow,
  type OperationCursor,
  type OperationMetadataPatch,
  type OperationsBackfillRepository,
  type SnapshotGroupRow,
  type SnapshotPatch,
} from '@/lib/operations/backfill';

/**
 * Opt-in PostgreSQL integration suite for task 1.4.
 *
 * It never uses DATABASE_URL, because every test creates and drops schemas. Set
 * OPERATIONS_TRACKING_TEST_DATABASE_URL (or TEST_DATABASE_URL) to a disposable
 * PostgreSQL database to enable it.
 */
const integrationDatabaseUrl = process.env.OPERATIONS_TRACKING_TEST_DATABASE_URL
  ?? process.env.TEST_DATABASE_URL;
const describePostgres = integrationDatabaseUrl ? describe : describe.skip;
const migrationSql = readFileSync(
  path.resolve(process.cwd(), 'drizzle/0015_business_operation_persistence.sql'),
  'utf8',
);
const silentLogger = { info: jest.fn(), warn: jest.fn() };
const checkpointKey = 'operations_request_tracking_backfill_v1';

type SqlClient = ReturnType<typeof postgres>;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function createBaselineSchema(client: SqlClient): Promise<void> {
  await client.unsafe(`
    CREATE TABLE "Operation" (
      "id" text PRIMARY KEY,
      "apiKeyId" text,
      "clientReference" text,
      "endpointSlug" text,
      "state" text NOT NULL,
      "totalCostUsd" double precision NOT NULL DEFAULT 0,
      "usageBreakdown" text,
      "stepsResultJson" text,
      "extractedData" text,
      "outputContent" text,
      "createdAt" timestamp(3) NOT NULL,
      "updatedAt" timestamp(3) NOT NULL,
      "deletedAt" timestamp(3)
    );

    CREATE TABLE "AppSetting" (
      "key" text PRIMARY KEY,
      "value" text NOT NULL,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    );
  `);
}

async function applyMigration(client: SqlClient): Promise<void> {
  await client.begin(async (transaction) => {
    await transaction.unsafe(migrationSql);
  });
}

function createPostgresBackfillRepository(client: SqlClient): OperationsBackfillRepository & {
  failNextOperationBatch: boolean;
} {
  return {
    failNextOperationBatch: false,

    async loadCheckpoint(): Promise<BackfillCheckpoint | null> {
      const rows = await client`
        SELECT "value"
          FROM "AppSetting"
         WHERE "key" = ${checkpointKey}
         LIMIT 1
      `;
      return rows[0]
        ? JSON.parse(String(rows[0].value)) as BackfillCheckpoint
        : null;
    },

    async saveCheckpoint(checkpoint: BackfillCheckpoint): Promise<void> {
      await client`
        INSERT INTO "AppSetting" ("key", "value", "updatedAt")
        VALUES (${checkpointKey}, ${JSON.stringify(checkpoint)}, CURRENT_TIMESTAMP(3))
        ON CONFLICT ("key") DO UPDATE
          SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"
      `;
    },

    async readOperationBatch(
      cursor: OperationCursor | null,
      limit: number,
    ): Promise<HistoricalOperationRow[]> {
      const rows = cursor
        ? await client`
            SELECT "id", "createdAt", "endpointSlug", "usageBreakdown",
                   "stepsResultJson", "extractedData", "outputContent",
                   "logicResult", "extractionResult"
              FROM "Operation"
             WHERE ("createdAt", "id") > (${new Date(cursor.createdAt)}, ${cursor.id})
             ORDER BY "createdAt" ASC, "id" ASC
             LIMIT ${limit}
          `
        : await client`
            SELECT "id", "createdAt", "endpointSlug", "usageBreakdown",
                   "stepsResultJson", "extractedData", "outputContent",
                   "logicResult", "extractionResult"
              FROM "Operation"
             ORDER BY "createdAt" ASC, "id" ASC
             LIMIT ${limit}
          `;
      return rows.map((row) => ({
        id: String(row.id),
        createdAt: row.createdAt as Date,
        endpointSlug: row.endpointSlug === null ? null : String(row.endpointSlug),
        usageBreakdown: row.usageBreakdown === null ? null : String(row.usageBreakdown),
        stepsResultJson: row.stepsResultJson === null ? null : String(row.stepsResultJson),
        extractedData: row.extractedData === null ? null : String(row.extractedData),
        outputContent: row.outputContent === null ? null : String(row.outputContent),
        logicResult: row.logicResult === null ? null : String(row.logicResult),
        extractionResult: row.extractionResult === null ? null : String(row.extractionResult),
      }));
    },

    async applyOperationBatch(
      patches: OperationMetadataPatch[],
      hiddenChildIds: string[],
      checkpoint: BackfillCheckpoint,
    ): Promise<ApplyOperationBatchResult> {
      return client.begin(async (transaction) => {
        const metadataIds = new Set<string>();
        for (const patch of patches) {
          if (patch.hasUnpricedCost !== undefined) {
            const rows = await transaction`
              UPDATE "Operation"
                 SET "hasUnpricedCost" = ${patch.hasUnpricedCost}
               WHERE "id" = ${patch.id}
               RETURNING "id"
            `;
            rows.forEach((row) => metadataIds.add(String(row.id)));
          }
          if (patch.logicResult !== undefined) {
            const rows = await transaction`
              UPDATE "Operation"
                 SET "logicResult" = ${patch.logicResult}
               WHERE "id" = ${patch.id}
               RETURNING "id"
            `;
            rows.forEach((row) => metadataIds.add(String(row.id)));
          }
          if (patch.extractionResult !== undefined) {
            const rows = await transaction`
              UPDATE "Operation"
                 SET "extractionResult" = ${patch.extractionResult}
               WHERE "id" = ${patch.id}
               RETURNING "id"
            `;
            rows.forEach((row) => metadataIds.add(String(row.id)));
          }
        }

        let hiddenChildrenMarked = 0;
        for (const childId of new Set(hiddenChildIds)) {
          const rows = await transaction`
            UPDATE "Operation"
               SET "hiddenFromOperations" = true
             WHERE "id" = ${childId}
               AND "hiddenFromOperations" = false
             RETURNING "id"
          `;
          hiddenChildrenMarked += rows.length;
        }

        if (this.failNextOperationBatch) {
          this.failNextOperationBatch = false;
          throw new Error('injected PostgreSQL batch failure');
        }

        await transaction`
          INSERT INTO "AppSetting" ("key", "value", "updatedAt")
          VALUES (${checkpointKey}, ${JSON.stringify(checkpoint)}, CURRENT_TIMESTAMP(3))
          ON CONFLICT ("key") DO UPDATE
            SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"
        `;
        return { metadataRowsUpdated: metadataIds.size, hiddenChildrenMarked };
      });
    },

    async readSnapshotBatch(cursor: string | null, limit: number): Promise<SnapshotGroupRow[]> {
      const rows = cursor
        ? await client`
            SELECT "businessGroupKey", array_agg("state" ORDER BY "id") AS states
              FROM "Operation"
             WHERE "deletedAt" IS NULL
               AND "hiddenFromOperations" = false
               AND "businessGroupKey" > ${cursor}
             GROUP BY "businessGroupKey"
             ORDER BY "businessGroupKey" ASC
             LIMIT ${limit}
          `
        : await client`
            SELECT "businessGroupKey", array_agg("state" ORDER BY "id") AS states
              FROM "Operation"
             WHERE "deletedAt" IS NULL
               AND "hiddenFromOperations" = false
             GROUP BY "businessGroupKey"
             ORDER BY "businessGroupKey" ASC
             LIMIT ${limit}
          `;
      return rows.map((row) => ({
        businessGroupKey: String(row.businessGroupKey),
        states: row.states as string[],
      }));
    },

    async applySnapshotBatch(
      patches: SnapshotPatch[],
      checkpoint: BackfillCheckpoint,
    ): Promise<number> {
      return client.begin(async (transaction) => {
        for (const patch of patches) {
          await transaction`
            INSERT INTO "BusinessOperationStatusSnapshot"
              ("businessGroupKey", "lastValidStatus", "updatedAt")
            VALUES (${patch.businessGroupKey}, ${patch.lastValidStatus}, CURRENT_TIMESTAMP(3))
            ON CONFLICT ("businessGroupKey") DO UPDATE
              SET "lastValidStatus" = EXCLUDED."lastValidStatus",
                  "updatedAt" = EXCLUDED."updatedAt"
          `;
        }
        await transaction`
          INSERT INTO "AppSetting" ("key", "value", "updatedAt")
          VALUES (${checkpointKey}, ${JSON.stringify(checkpoint)}, CURRENT_TIMESTAMP(3))
          ON CONFLICT ("key") DO UPDATE
            SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"
        `;
        return patches.length;
      });
    },
  };
}

describePostgres('Operations migration and backfill PostgreSQL integration', () => {
  let administrationClient: SqlClient;
  let client: SqlClient;
  let schemaName: string;

  beforeAll(() => {
    administrationClient = postgres(integrationDatabaseUrl!, { max: 1 });
  });

  beforeEach(async () => {
    schemaName = `operations_tracking_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await administrationClient.unsafe(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    client = postgres(integrationDatabaseUrl!, {
      max: 1,
      connection: { search_path: schemaName },
    });
    await createBaselineSchema(client);
  });

  afterEach(async () => {
    await client.end({ timeout: 5 });
    await administrationClient.unsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
  });

  afterAll(async () => {
    await administrationClient.end({ timeout: 5 });
  });

  it('runs migration twice and preserves generated identity, exact cost precision, and index predicates', async () => {
    await applyMigration(client);
    await applyMigration(client);

    await client`
      INSERT INTO "Operation" (
        "id", "apiKeyId", "clientReference", "endpointSlug", "state",
        "totalCostUsd", "createdAt", "updatedAt"
      ) VALUES
        ('referenced', 'profile-a', '  CASE-001  ', 'extract', 'SUCCEEDED',
         0.1234567891, '2025-01-01T00:00:00Z', '2025-01-01T00:00:01Z'),
        ('standalone', NULL, '   ', 'extract', 'SUCCEEDED',
         0.0000000001, '2025-01-01T00:00:02Z', '2025-01-01T00:00:03Z')
    `;

    const columns = await client`
      SELECT "column_name", "data_type", "numeric_precision", "numeric_scale", "is_generated"
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'Operation'
    `;
    const costColumn = columns.find((column) => column.column_name === 'totalCostUsd');
    const groupColumn = columns.find((column) => column.column_name === 'businessGroupKey');
    expect(costColumn).toMatchObject({
      data_type: 'numeric',
      numeric_precision: 30,
      numeric_scale: 10,
    });
    expect(groupColumn).toMatchObject({ is_generated: 'ALWAYS' });

    const operations = await client`
      SELECT "id", "businessGroupKey", "totalCostUsd"::text AS cost
        FROM "Operation"
       ORDER BY "id"
    `;
    expect(operations).toEqual([
      { id: 'referenced', businessGroupKey: 'profile:profile-a:reference:CASE-001', cost: '0.1234567891' },
      { id: 'standalone', businessGroupKey: 'request:standalone', cost: '0.0000000001' },
    ]);
    const [sum] = await client`SELECT SUM("totalCostUsd")::text AS value FROM "Operation"`;
    expect(sum.value).toBe('0.1234567892');

    const indexes = await client`
      SELECT index_class.relname AS name,
             pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate
        FROM pg_index index_meta
        JOIN pg_class table_class ON table_class.oid = index_meta.indrelid
        JOIN pg_class index_class ON index_class.oid = index_meta.indexrelid
       WHERE table_class.relnamespace = current_schema()::regnamespace
         AND table_class.relname = 'Operation'
         AND index_class.relname LIKE 'operation_%'
       ORDER BY index_class.relname
    `;
    expect(indexes.map((index) => index.name)).toEqual([
      'operation_business_group_created_id_idx',
      'operation_endpoint_business_group_idx',
      'operation_profile_created_idx',
      'operation_profile_normalized_reference_idx',
      'operation_updated_business_group_idx',
    ]);
    for (const index of indexes) {
      expect(String(index.predicate)).toContain('"deletedAt" IS NULL');
      expect(String(index.predicate)).toContain('"hiddenFromOperations" = false');
    }
    expect(String(indexes.find((index) => index.name === 'operation_profile_normalized_reference_idx')?.predicate))
      .toContain('NULLIF(btrim("clientReference"), \'\'::text) IS NOT NULL');
  });

  it('rolls back all migration DDL when a transaction fails after applying the script', async () => {
    await expect(client.begin(async (transaction) => {
      await transaction.unsafe(`${migrationSql}\nDO $forced$ BEGIN RAISE EXCEPTION 'forced migration failure'; END $forced$;`);
    })).rejects.toThrow('forced migration failure');

    const [state] = await client`
      SELECT
        to_regclass('"BusinessOperationStatusSnapshot"') AS "snapshotTable",
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'Operation'
             AND column_name = 'businessGroupKey'
        ) AS "hasGroupColumn",
        (
          SELECT data_type FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'Operation'
             AND column_name = 'totalCostUsd'
        ) AS "costType"
    `;
    expect(state).toEqual({
      snapshotTable: null,
      hasGroupColumn: false,
      costType: 'double precision',
    });
  });

  it('atomically resumes backfill batches, excludes only marked rows, and does not duplicate snapshots on rerun', async () => {
    await applyMigration(client);
    await client`
      INSERT INTO "Operation" (
        "id", "apiKeyId", "clientReference", "endpointSlug", "state",
        "totalCostUsd", "usageBreakdown", "stepsResultJson",
        "createdAt", "updatedAt", "deletedAt"
      ) VALUES
        ('parent', 'profile-a', '  CASE-42 ', 'workflow', 'SUCCEEDED', 1.0000000001,
         '[{"cost_source":"unpriced"}]', '{"sub_operation_id":"child"}',
         '2025-01-01T00:00:00Z', '2025-01-01T00:00:01Z', NULL),
        ('sibling', 'profile-a', 'CASE-42', 'workflow', 'FAILED', 2.0000000002,
         '[]', NULL, '2025-01-01T00:01:00Z', '2025-01-01T00:01:01Z', NULL),
        ('child', 'profile-a', NULL, 'internal-child', 'SUCCEEDED', 3.0000000003,
         '[]', NULL, '2025-01-01T00:02:00Z', '2025-01-01T00:02:01Z', NULL),
        ('unknown', NULL, NULL, 'legacy', 'LEGACY_STATE', 4.0000000004,
         '[]', NULL, '2025-01-01T00:03:00Z', '2025-01-01T00:03:01Z', NULL),
        ('soft-deleted', NULL, NULL, 'legacy', 'SUCCEEDED', 5.0000000005,
         '[]', NULL, '2025-01-01T00:04:00Z', '2025-01-01T00:04:01Z', '2025-01-02T00:00:00Z')
    `;

    const [before] = await client`
      SELECT COUNT(*)::int AS eligible
        FROM "Operation"
       WHERE "deletedAt" IS NULL AND "hiddenFromOperations" = false
    `;
    expect(before.eligible).toBe(4);

    const repository = createPostgresBackfillRepository(client);
    repository.failNextOperationBatch = true;
    await expect(runOperationsBackfill(repository, {
      batchSize: 10,
      logger: silentLogger,
    })).rejects.toThrow('injected PostgreSQL batch failure');

    const [rolledBack] = await client`
      SELECT
        (SELECT "hasUnpricedCost" FROM "Operation" WHERE "id" = 'parent') AS unpriced,
        (SELECT "hiddenFromOperations" FROM "Operation" WHERE "id" = 'child') AS hidden,
        (SELECT COUNT(*)::int FROM "AppSetting" WHERE "key" = ${checkpointKey}) AS checkpoints
    `;
    expect(rolledBack).toEqual({ unpriced: false, hidden: false, checkpoints: 0 });

    const paused = await runOperationsBackfill(repository, {
      batchSize: 10,
      maxBatches: 1,
      logger: silentLogger,
    });
    expect(paused.phase).toBe('operations');
    expect(paused.operationCursor?.id).toBe('soft-deleted');

    const completed = await runOperationsBackfill(repository, {
      batchSize: 10,
      logger: silentLogger,
    });
    expect(completed.phase).toBe('complete');
    expect(completed.counters.hiddenChildrenMarked).toBe(1);
    expect(completed.counters.unknownGroupsSkipped).toBe(1);

    const [after] = await client`
      SELECT
        COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "hiddenFromOperations" = false)::int AS eligible,
        COUNT(*) FILTER (WHERE "hiddenFromOperations" = true)::int AS "explicitlyHidden",
        COUNT(*) FILTER (WHERE "deletedAt" IS NOT NULL)::int AS "softDeleted"
      FROM "Operation"
    `;
    expect(after).toEqual({ eligible: 3, explicitlyHidden: 1, softDeleted: 1 });
    expect(before.eligible - after.eligible).toBe(after.explicitlyHidden);

    const snapshotsAfterFirstRun = await client`
      SELECT "businessGroupKey", "lastValidStatus"
        FROM "BusinessOperationStatusSnapshot"
       ORDER BY "businessGroupKey"
    `;
    expect(snapshotsAfterFirstRun).toEqual([{
      businessGroupKey: 'profile:profile-a:reference:CASE-42',
      lastValidStatus: 'FAILED',
    }]);

    const completedAgain = await runOperationsBackfill(repository, {
      batchSize: 10,
      logger: silentLogger,
    });
    expect(completedAgain).toEqual(completed);

    await runOperationsBackfill(repository, {
      batchSize: 10,
      restart: true,
      logger: silentLogger,
    });
    const [deduplication] = await client`
      SELECT
        (SELECT COUNT(*)::int FROM "BusinessOperationStatusSnapshot") AS snapshots,
        (SELECT COUNT(*)::int FROM "AppSetting" WHERE "key" = ${checkpointKey}) AS checkpoints,
        (SELECT COUNT(*)::int FROM "Operation" WHERE "hiddenFromOperations" = true) AS hidden
    `;
    expect(deduplication).toEqual({ snapshots: 1, checkpoints: 1, hidden: 1 });
    expect(await client`
      SELECT "businessGroupKey", "lastValidStatus"
        FROM "BusinessOperationStatusSnapshot"
    `).toEqual(snapshotsAfterFirstRun);
  });
});
