import type { SQL } from 'drizzle-orm';
import { PgDialect, type PgTransactionConfig } from 'drizzle-orm/pg-core';
import postgres from 'postgres';

import {
  ALL_FILTER_VALUE,
  BUSINESS_QUERY_TRANSACTION_CONFIG,
  BusinessQueryError,
  createBusinessOperationQueryService,
  type BusinessOperationsDashboardResponse,
  type BusinessOperationsQueryInput,
  type BusinessQueryAuthorizationContext,
  type BusinessQueryExecutor,
  type BusinessQueryStore,
} from '@/lib/operations/business-query';

/**
 * Opt-in PostgreSQL integration coverage for task 6.5. This suite never uses
 * application DATABASE_URL. It requires a dedicated test URL and creates and
 * drops only a uniquely named disposable schema for each test.
 */
const integrationDatabaseUrl = process.env.OPERATIONS_TRACKING_TEST_DATABASE_URL
  ?? process.env.TEST_DATABASE_URL;
const describePostgres = integrationDatabaseUrl ? describe : describe.skip;
const dialect = new PgDialect();

type SqlClient = ReturnType<typeof postgres>;
type QueryParameter = string | number | boolean | Date | null;

const authorization: BusinessQueryAuthorizationContext = {
  actorId: 'integration-operator',
  canReadOperations: true,
  allowedProfileIds: ['profile-a'],
  canReadInternalScope: true,
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function input(overrides: Partial<BusinessOperationsQueryInput> = {}): BusinessOperationsQueryInput {
  return {
    range: 'this_month',
    profile: ALL_FILTER_VALUE,
    operationType: ALL_FILTER_VALUE,
    status: ALL_FILTER_VALUE,
    page: 1,
    ...overrides,
  };
}

class PostgresBusinessQueryStore implements BusinessQueryStore {
  transactionCalls = 0;
  afterMetadata: (() => Promise<void>) | null = null;

  constructor(private readonly client: SqlClient) {}

  async transaction<T>(
    callback: (transaction: BusinessQueryExecutor) => Promise<T>,
    config: PgTransactionConfig,
  ): Promise<T> {
    this.transactionCalls += 1;
    if (
      config.isolationLevel !== BUSINESS_QUERY_TRANSACTION_CONFIG.isolationLevel
      || config.accessMode !== BUSINESS_QUERY_TRANSACTION_CONFIG.accessMode
    ) {
      throw new Error('Business query did not request its required snapshot transaction');
    }

    const result = await this.client.begin(
      'isolation level repeatable read read only',
      async (databaseTransaction) => callback({
        execute: async <TRow extends Record<string, unknown>>(statement: SQL): Promise<TRow[]> => {
          const compiled = dialect.sqlToQuery(statement);
          const rows = await databaseTransaction.unsafe(
            compiled.sql,
            compiled.params as QueryParameter[],
          );
          if (compiled.sql.includes('transaction_timestamp()') && this.afterMetadata) {
            const hook = this.afterMetadata;
            this.afterMetadata = null;
            await hook();
          }
          return rows as unknown as TRow[];
        },
      }),
    );
    return result as unknown as T;
  }
}

async function createSchema(client: SqlClient): Promise<void> {
  await client.unsafe(`
    CREATE TABLE "ApiKey" (
      "id" text PRIMARY KEY,
      "name" text NOT NULL,
      "displayName" text
    );
    CREATE TABLE "AppSetting" (
      "key" text PRIMARY KEY,
      "value" text NOT NULL
    );
    CREATE TABLE "Operation" (
      "id" text PRIMARY KEY,
      "apiKeyId" text REFERENCES "ApiKey"("id"),
      "clientReference" text,
      "businessGroupKey" text GENERATED ALWAYS AS (
        CASE WHEN NULLIF(BTRIM("clientReference"), '') IS NULL
          THEN 'request:' || "id"
          ELSE 'profile:' || COALESCE("apiKeyId", '__internal__')
            || ':reference:' || BTRIM("clientReference")
        END
      ) STORED,
      "endpointSlug" text,
      "state" text NOT NULL,
      "logicResult" text,
      "extractionResult" text,
      "totalInputTokens" integer NOT NULL DEFAULT 0,
      "totalOutputTokens" integer NOT NULL DEFAULT 0,
      "totalCostUsd" numeric(30, 10) NOT NULL DEFAULT 0,
      "inputTokensMissing" boolean NOT NULL DEFAULT false,
      "outputTokensMissing" boolean NOT NULL DEFAULT false,
      "costMissing" boolean NOT NULL DEFAULT false,
      "hasUnpricedCost" boolean NOT NULL DEFAULT false,
      "hiddenFromOperations" boolean NOT NULL DEFAULT false,
      "createdAt" timestamptz NOT NULL,
      "updatedAt" timestamptz NOT NULL,
      "completedAt" timestamptz,
      "deletedAt" timestamptz
    );
    CREATE TABLE "BusinessOperationStatusSnapshot" (
      "businessGroupKey" text PRIMARY KEY,
      "lastValidStatus" text NOT NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    );
    INSERT INTO "ApiKey" ("id", "name", "displayName")
      VALUES
        ('profile-a', 'profile-a', 'Profile A'),
        ('profile-b', 'profile-b', 'Profile B');
    INSERT INTO "AppSetting" ("key", "value")
      VALUES ('ops_calendar_timezone', 'UTC');
  `);
}

async function fixtureTime(client: SqlClient): Promise<Date> {
  const rows = await client`
    SELECT date_trunc('month', CURRENT_TIMESTAMP) + interval '1 hour' AS value
  `;
  return new Date(rows[0].value as Date);
}

interface OperationFixture {
  id: string;
  createdAt: Date;
  profileId?: string | null;
  reference?: string | null;
  state?: string;
  input?: number;
  output?: number;
  cost?: string;
  updatedAt?: Date;
}

async function insertOperation(client: SqlClient, fixture: OperationFixture): Promise<void> {
  const state = fixture.state ?? 'SUCCEEDED';
  const completedAt = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state)
    ? fixture.updatedAt ?? fixture.createdAt
    : null;
  await client`
    INSERT INTO "Operation" (
      "id", "apiKeyId", "clientReference", "endpointSlug", "state",
      "totalInputTokens", "totalOutputTokens", "totalCostUsd",
      "createdAt", "updatedAt", "completedAt"
    ) VALUES (
      ${fixture.id}, ${fixture.profileId === undefined ? 'profile-a' : fixture.profileId},
      ${fixture.reference ?? null}, 'extract', ${state},
      ${fixture.input ?? 0}, ${fixture.output ?? 0}, ${fixture.cost ?? '0'},
      ${fixture.createdAt}, ${fixture.updatedAt ?? fixture.createdAt}, ${completedAt}
    )
  `;
}

function expectSingleGroup(
  response: BusinessOperationsDashboardResponse,
  expected: { count: number; status: string; tokens: number; cost: string },
): void {
  expect(response.summary).toMatchObject({
    totalCases: 1,
    tokensProcessed: expected.tokens,
    totalCostUsd: expected.cost,
  });
  expect(response.breakdownCards).toHaveLength(1);
  expect(response.breakdownCards[0]).toMatchObject({
    businessOperationCount: 1,
    requestCount: expected.count,
    inputTokens: expected.tokens,
    outputTokens: 0,
    costUsd: expected.cost,
  });
  expect(response.list.items).toHaveLength(1);
  expect(response.list.items[0]).toMatchObject({
    businessStatus: expected.status,
    requestCount: expected.count,
    totalTokens: expected.tokens,
    totalCostUsd: expected.cost,
  });
}

describePostgres('Business Operation PostgreSQL consistency, search, and pagination', () => {
  let administrationClient: SqlClient;
  let client: SqlClient;
  let writer: SqlClient;
  let schemaName: string;
  let store: PostgresBusinessQueryStore;
  let service: ReturnType<typeof createBusinessOperationQueryService>;
  const originalSecret = process.env.BUSINESS_OPERATION_TOKEN_SECRET;

  beforeAll(() => {
    process.env.BUSINESS_OPERATION_TOKEN_SECRET = 'business-query-postgres-test-secret';
    administrationClient = postgres(integrationDatabaseUrl!, { max: 1 });
  });

  beforeEach(async () => {
    schemaName = `business_query_consistency_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await administrationClient.unsafe(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    const connection = { search_path: schemaName, TimeZone: 'UTC' };
    client = postgres(integrationDatabaseUrl!, { max: 2, connection });
    writer = postgres(integrationDatabaseUrl!, { max: 1, connection });
    await createSchema(client);
    store = new PostgresBusinessQueryStore(client);
    service = createBusinessOperationQueryService(store);
  });

  afterEach(async () => {
    await Promise.all([client.end({ timeout: 5 }), writer.end({ timeout: 5 })]);
    await administrationClient.unsafe(
      `DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`,
    );
  });

  afterAll(async () => {
    await administrationClient.end({ timeout: 5 });
    if (originalSecret === undefined) delete process.env.BUSINESS_OPERATION_TOKEN_SECRET;
    else process.env.BUSINESS_OPERATION_TOKEN_SECRET = originalSecret;
  });

  it('keeps all dashboard sections on one REPEATABLE READ snapshot during a concurrent update', async () => {
    const createdAt = await fixtureTime(client);
    await insertOperation(client, {
      id: 'consistent-request', reference: 'CONSISTENT', createdAt,
      state: 'SUCCEEDED', input: 10, output: 20, cost: '1',
    });
    store.afterMetadata = async () => {
      await writer`
        UPDATE "Operation" SET
          "state" = 'FAILED', "totalInputTokens" = 200,
          "totalOutputTokens" = 100, "totalCostUsd" = 9,
          "updatedAt" = "updatedAt" + interval '1 minute'
        WHERE "id" = 'consistent-request'
      `;
    };

    const oldSnapshot = await service.getDashboardSnapshot(input(), authorization);
    expect(oldSnapshot.queryTimestamp).toBe(oldSnapshot.resolvedWindow.end);
    expectSingleGroup(oldSnapshot, {
      count: 1, status: 'SUCCEEDED', tokens: 30, cost: '1.0000000000',
    });
    expect(oldSnapshot.breakdownCards[0]).toMatchObject({ succeededCount: 1, failedCount: 0 });
    expect(oldSnapshot.trend.points.reduce(
      (sum, point) => sum + point.counts.SUCCEEDED,
      0,
    )).toBe(1);
    expect(oldSnapshot.trend.points.reduce(
      (sum, point) => sum + point.counts.FAILED,
      0,
    )).toBe(0);

    const newSnapshot = await service.getDashboardSnapshot(input(), authorization);
    expectSingleGroup(newSnapshot, {
      count: 1, status: 'FAILED', tokens: 300, cost: '9.0000000000',
    });
    expect(newSnapshot.breakdownCards[0]).toMatchObject({ succeededCount: 0, failedCount: 1 });
    expect(newSnapshot.trend.points.reduce(
      (sum, point) => sum + point.counts.FAILED,
      0,
    )).toBe(1);
  });

  it('supports exact reference, case-insensitive contains, and exact request-ID search', async () => {
    const createdAt = await fixtureTime(client);
    await insertOperation(client, {
      id: 'alpha-parent', reference: '  Case-Alpha ', createdAt, input: 1,
    });
    await insertOperation(client, {
      id: 'alpha-child', reference: 'Case-Alpha', createdAt, input: 2,
    });
    await insertOperation(client, {
      id: 'alpha-secondary', reference: 'ALPHA-secondary', createdAt, input: 3,
    });
    await insertOperation(client, {
      id: 'beta-request', reference: 'Beta', createdAt, input: 4,
    });

    const exact = await service.getDashboardSnapshot(input({
      query: ' Case-Alpha ', searchMode: 'exact',
    }), authorization);
    expect(exact.list.total).toBe(1);
    expect(exact.list.items[0]).toMatchObject({
      operationIdentifier: 'Case-Alpha', requestCount: 2, totalTokens: 3,
    });

    const contains = await service.getDashboardSnapshot(input({
      query: 'alpha', searchMode: 'contains',
    }), authorization);
    expect(contains.list.total).toBe(2);
    expect(contains.list.items.map((item) => item.operationIdentifier).sort()).toEqual([
      'ALPHA-secondary', 'Case-Alpha',
    ]);

    const requestId = await service.getDashboardSnapshot(input({
      query: 'alpha-child', searchMode: 'exact',
    }), authorization);
    expect(requestId.list.total).toBe(1);
    expect(requestId.list.items[0]).toMatchObject({
      operationIdentifier: 'Case-Alpha', requestCount: 2,
    });
  });

  it('returns no unauthorized identifiers or aggregates for exact reference and request-ID searches', async () => {
    const createdAt = await fixtureTime(client);
    await insertOperation(client, {
      id: 'authorized-request',
      profileId: 'profile-a',
      reference: 'AUTHORIZED-CASE',
      createdAt,
      input: 5,
    });
    await insertOperation(client, {
      id: 'private-request-id',
      profileId: 'profile-b',
      reference: 'PRIVATE-CASE',
      createdAt,
      input: 999,
      cost: '77.77',
    });

    const byReference = await service.getDashboardSnapshot(input({
      query: 'PRIVATE-CASE',
      searchMode: 'exact',
    }), authorization);
    expect(byReference.summary).toMatchObject({
      totalCases: 0,
      tokensProcessed: 0,
      totalCostUsd: '0.0000000000',
    });
    expect(byReference.breakdownCards).toEqual([]);
    expect(byReference.list).toMatchObject({ items: [], total: 0, totalPages: 0 });
    expect(byReference.trend.points.every((point) => point.total === 0)).toBe(true);
    expect(JSON.stringify(byReference)).not.toContain('private-request-id');
    expect(JSON.stringify(byReference)).not.toContain('profile-b');
    expect(JSON.stringify(byReference)).not.toContain('77.7700000000');

    const byRequestId = await service.getDashboardSnapshot(input({
      query: 'private-request-id',
      searchMode: 'exact',
    }), authorization);
    expect(byRequestId.summary.totalCases).toBe(0);
    expect(byRequestId.list).toMatchObject({ items: [], total: 0, totalPages: 0 });
    expect(JSON.stringify(byRequestId)).not.toContain('PRIVATE-CASE');
    expect(JSON.stringify(byRequestId)).not.toContain('profile-b');
  });

  it('short-circuits blank and overlong search without a transaction', async () => {
    for (const query of ['   ', 'x'.repeat(257)]) {
      const before = store.transactionCalls;
      await expect(service.getDashboardSnapshot(input({ query }), authorization))
        .rejects.toMatchObject<Partial<BusinessQueryError>>({ code: 'INVALID_SEARCH' });
      expect(store.transactionCalls).toBe(before);
    }
  });

  it('partitions business rows by 50 and constituent requests by 100', async () => {
    const createdAt = await fixtureTime(client);
    for (let index = 1; index <= 51; index += 1) {
      const suffix = String(index).padStart(3, '0');
      await insertOperation(client, {
        id: `page-${suffix}`, reference: `PAGE-${suffix}`, createdAt,
        updatedAt: createdAt, input: index,
      });
    }
    const businessPage1 = await service.getDashboardSnapshot(input({ page: 1 }), authorization);
    const businessPage2 = await service.getDashboardSnapshot(input({ page: 2 }), authorization);
    expect(businessPage1.list).toMatchObject({ page: 1, pageSize: 50, total: 51, totalPages: 2 });
    expect(businessPage2.list).toMatchObject({ page: 2, pageSize: 50, total: 51, totalPages: 2 });
    const identifiers = [...businessPage1.list.items, ...businessPage2.list.items]
      .map((item) => item.operationIdentifier);
    expect(new Set(identifiers).size).toBe(51);
    expect(identifiers).toEqual(Array.from(
      { length: 51 },
      (_, index) => `PAGE-${String(index + 1).padStart(3, '0')}`,
    ));

    await client`TRUNCATE TABLE "Operation"`;
    for (let index = 1; index <= 101; index += 1) {
      await insertOperation(client, {
        id: `detail-${String(index).padStart(3, '0')}`,
        reference: 'DETAIL', createdAt, updatedAt: createdAt, input: index,
      });
    }
    const identity = {
      kind: 'referenced' as const,
      scope: { kind: 'profile' as const, apiKeyId: 'profile-a' },
      normalizedReference: 'DETAIL',
    };
    const detailPage1 = await service.getBusinessOperationDetail(identity, 1, authorization);
    const detailPage2 = await service.getBusinessOperationDetail(identity, 2, authorization);
    expect(detailPage1.requests).toMatchObject({ page: 1, pageSize: 100, total: 101, totalPages: 2 });
    expect(detailPage2.requests).toMatchObject({ page: 2, pageSize: 100, total: 101, totalPages: 2 });
    const requestIds = [...detailPage1.requests.items, ...detailPage2.requests.items]
      .map((request) => request.id);
    expect(new Set(requestIds).size).toBe(101);
    expect(requestIds).toEqual(Array.from(
      { length: 101 },
      (_, index) => `detail-${String(index + 1).padStart(3, '0')}`,
    ));
  });

  it('fully recomputes after metric, state, soft-delete, and hide changes', async () => {
    const createdAt = await fixtureTime(client);
    for (let index = 1; index <= 3; index += 1) {
      await insertOperation(client, {
        id: `recompute-${index}`, reference: 'RECOMPUTE', createdAt,
        updatedAt: new Date(createdAt.getTime() + index * 1_000),
        input: index * 10, cost: String(index), state: 'SUCCEEDED',
      });
    }
    expectSingleGroup(await service.getDashboardSnapshot(input(), authorization), {
      count: 3, status: 'SUCCEEDED', tokens: 60, cost: '6.0000000000',
    });

    await client`
      UPDATE "Operation" SET "totalInputTokens" = 100, "totalCostUsd" = 10,
        "updatedAt" = "updatedAt" + interval '1 minute'
      WHERE "id" = 'recompute-1'
    `;
    await client`
      UPDATE "Operation" SET "state" = 'FAILED',
        "updatedAt" = "updatedAt" + interval '2 minutes'
      WHERE "id" = 'recompute-2'
    `;
    expectSingleGroup(await service.getDashboardSnapshot(input(), authorization), {
      count: 3, status: 'FAILED', tokens: 150, cost: '15.0000000000',
    });

    await client`
      UPDATE "Operation" SET "deletedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'recompute-2'
    `;
    expectSingleGroup(await service.getDashboardSnapshot(input(), authorization), {
      count: 2, status: 'SUCCEEDED', tokens: 130, cost: '13.0000000000',
    });

    await client`
      UPDATE "Operation" SET "hiddenFromOperations" = true
      WHERE "id" = 'recompute-3'
    `;
    const finalSnapshot = await service.getDashboardSnapshot(input(), authorization);
    expectSingleGroup(finalSnapshot, {
      count: 1, status: 'SUCCEEDED', tokens: 100, cost: '10.0000000000',
    });
    const rerun = await service.getDashboardSnapshot(input(), authorization);
    expect(rerun.summary).toEqual(finalSnapshot.summary);
    expect(rerun.breakdownCards).toEqual(finalSnapshot.breakdownCards);
    expect(rerun.list).toEqual(finalSnapshot.list);
  });
});
