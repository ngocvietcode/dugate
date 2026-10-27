import type { SQL } from 'drizzle-orm';
import { PgDialect, type PgTransactionConfig } from 'drizzle-orm/pg-core';
import postgres from 'postgres';

import {
  aggregateBusinessOperations,
  aggregateBusinessOperationsSummary,
  type AggregationRequestSource,
} from '@/lib/operations/aggregation';
import {
  ALL_FILTER_VALUE,
  createBusinessOperationQueryService,
  type BusinessOperationsDashboardBreakdownCard,
  type BusinessOperationsDashboardListItem,
  type BusinessOperationsDashboardResponse,
  type BusinessOperationsQueryInput,
  type BusinessQueryAuthorizationContext,
  type BusinessQueryExecutor,
  type BusinessQueryStore,
} from '@/lib/operations/business-query';
import {
  filterBusinessOperations,
  projectBusinessOperations,
  type BusinessOperationProjection,
} from '@/lib/operations/projection';
import {
  buildBusinessOperationTrend,
  createBusinessOperationListPage,
} from '@/lib/operations/reference-helpers';
import { encodeBusinessOperationToken } from '@/lib/operations/business-key';
import {
  buildCalendarBuckets,
  resolveTimeWindow,
  type ResolvedTimeWindow,
} from '@/lib/operations/time-window';

/**
 * Opt-in PostgreSQL SQL-to-reference suite for task 6.4.
 *
 * The suite never reads application DATABASE_URL. Set only
 * OPERATIONS_TRACKING_TEST_DATABASE_URL (or TEST_DATABASE_URL) to a disposable
 * PostgreSQL database. Every run creates and drops a uniquely named schema.
 */
const integrationDatabaseUrl = process.env.OPERATIONS_TRACKING_TEST_DATABASE_URL
  ?? process.env.TEST_DATABASE_URL;
const describePostgres = integrationDatabaseUrl ? describe : describe.skip;
const dialect = new PgDialect();

type SqlClient = ReturnType<typeof postgres>;
type FixtureRequest = AggregationRequestSource;
type DashboardComparable = {
  summary: BusinessOperationsDashboardResponse['summary'];
  breakdownCards: BusinessOperationsDashboardBreakdownCard[];
  trend: BusinessOperationsDashboardResponse['trend'];
  list: Omit<BusinessOperationsDashboardResponse['list'], 'items'> & {
    items: Array<Omit<BusinessOperationsDashboardListItem, 'token'>>;
  };
};

const PROFILE_NAMES = new Map<string | null, string>([
  ['profile-a', 'Profile A'],
  ['profile-b', 'Profile B'],
  [null, 'Internal'],
]);

const authorization: BusinessQueryAuthorizationContext = {
  actorId: 'sql-reference-operator',
  canReadOperations: true,
  allowedProfileIds: ['profile-a', 'profile-b'],
  canReadInternalScope: true,
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function compile(statement: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(statement);
  return { sql: query.sql, params: query.params };
}

class PostgresBusinessQueryStore implements BusinessQueryStore {
  constructor(
    private readonly client: SqlClient,
    private readonly queryTimestamp: Date,
    private readonly calendarTimezone: string,
  ) {}

  async transaction<T>(
    callback: (transaction: BusinessQueryExecutor) => Promise<T>,
    _config: PgTransactionConfig,
  ): Promise<T> {
    const result = await this.client.begin(
      'isolation level repeatable read read only',
      async (databaseTransaction) => callback({
        execute: async <TRow extends Record<string, unknown>>(
          statement: SQL,
        ): Promise<TRow[]> => {
          const compiled = compile(statement);

          // Fixed snapshot metadata keeps calendar boundary tests deterministic.
          // The aggregate statement itself is always executed by PostgreSQL.
          if (
            compiled.sql.includes('transaction_timestamp()')
            && compiled.sql.includes('ops_calendar_timezone')
          ) {
            return [{
              queryTimestamp: new Date(this.queryTimestamp),
              calendarTimezone: this.calendarTimezone,
            }] as unknown as TRow[];
          }

          const executeUnsafe = databaseTransaction.unsafe as unknown as (
            query: string,
            parameters: readonly unknown[],
          ) => Promise<Record<string, unknown>[]>;
          const rows = await executeUnsafe(compiled.sql, compiled.params);
          return rows as TRow[];
        },
      }),
    );
    return result as T;
  }
}

function dashboardInput(
  overrides: Partial<BusinessOperationsQueryInput> = {},
): BusinessOperationsQueryInput {
  return {
    range: 'last_month',
    profile: ALL_FILTER_VALUE,
    operationType: ALL_FILTER_VALUE,
    status: ALL_FILTER_VALUE,
    page: 1,
    ...overrides,
  };
}

function request(
  id: string,
  overrides: Partial<FixtureRequest> = {},
): FixtureRequest {
  const createdAt = overrides.createdAt ?? new Date('2025-03-10T01:00:00.000Z');
  return {
    id,
    apiKeyId: 'profile-a',
    clientReference: id,
    endpointSlug: 'extract',
    state: 'SUCCEEDED',
    createdAt,
    updatedAt: overrides.updatedAt ?? new Date(createdAt.getTime() + 60_000),
    completedAt: overrides.completedAt === undefined
      ? new Date(createdAt.getTime() + 60_000)
      : overrides.completedAt,
    deletedAt: null,
    hiddenFromOperations: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: '0.0000000000',
    logicResult: null,
    extractionResult: null,
    inputTokensMissing: false,
    outputTokensMissing: false,
    costMissing: false,
    hasUnpricedCost: false,
    ...overrides,
  };
}

function mainFixtures(): FixtureRequest[] {
  const tieStart = new Date('2025-03-01T00:00:00.000Z');
  const tieEnd = new Date('2025-03-01T00:02:00.000Z');

  return [
    request('shared-a-extract', {
      apiKeyId: 'profile-a',
      clientReference: '  SHARED-REF  ',
      endpointSlug: 'extract',
      totalInputTokens: 10,
      totalOutputTokens: 20,
      totalCostUsd: '0.1000000001',
      logicResult: 'PASS',
      extractionResult: 'SUCCESS',
    }),
    request('shared-a-validate', {
      apiKeyId: 'profile-a',
      clientReference: 'SHARED-REF',
      endpointSlug: 'validate',
      createdAt: new Date('2025-03-10T01:01:00.000Z'),
      updatedAt: new Date('2025-03-10T01:03:00.000Z'),
      completedAt: new Date('2025-03-10T01:03:00.000Z'),
      totalInputTokens: 0,
      totalOutputTokens: 30,
      totalCostUsd: '0.2000000002',
      logicResult: 'PASS',
      extractionResult: 'FAIL',
      inputTokensMissing: true,
    }),
    request('shared-b-failed', {
      apiKeyId: 'profile-b',
      clientReference: 'SHARED-REF',
      state: 'FAILED',
      totalInputTokens: 30,
      totalOutputTokens: 0,
      totalCostUsd: '1.0000000000',
      logicResult: 'FAIL',
      extractionResult: 'SUCCESS',
    }),
    request('standalone-internal', {
      apiKeyId: null,
      clientReference: '   ',
      endpointSlug: 'internal-run',
      state: 'PENDING',
      completedAt: null,
      totalInputTokens: 4,
      totalOutputTokens: 0,
    }),
    request('unknown-with-snapshot', {
      apiKeyId: 'profile-a',
      clientReference: 'UNKNOWN-SNAPSHOT',
      state: 'LEGACY_UNKNOWN',
      completedAt: null,
      totalInputTokens: 5,
      totalOutputTokens: 5,
      totalCostUsd: '99.0000000000',
      hasUnpricedCost: true,
    }),
    request('unknown-without-snapshot', {
      apiKeyId: null,
      clientReference: 'UNKNOWN-NO-SNAPSHOT',
      endpointSlug: 'internal-run',
      state: 'LEGACY_UNKNOWN',
      completedAt: null,
      totalInputTokens: 1,
      totalOutputTokens: 1,
    }),
    request('missing-measurement', {
      apiKeyId: 'profile-a',
      clientReference: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: '7.0000000000',
      outputTokensMissing: true,
      costMissing: true,
    }),
    request('tie-a', {
      clientReference: 'A-TIE',
      endpointSlug: 'tie-type',
      createdAt: tieStart,
      updatedAt: tieEnd,
      completedAt: tieEnd,
      totalInputTokens: 40,
      totalOutputTokens: 60,
      totalCostUsd: '0.5000000000',
    }),
    request('tie-b', {
      clientReference: 'B-TIE',
      endpointSlug: 'tie-type',
      createdAt: tieStart,
      updatedAt: tieEnd,
      completedAt: tieEnd,
      totalInputTokens: 50,
      totalOutputTokens: 50,
      totalCostUsd: '0.5000000000',
    }),
    request('exclusive-end', {
      clientReference: 'EXCLUSIVE-END',
      createdAt: new Date('2025-04-01T00:00:00.000Z'),
      updatedAt: new Date('2025-04-01T00:01:00.000Z'),
      completedAt: new Date('2025-04-01T00:01:00.000Z'),
      totalInputTokens: 1000,
      totalOutputTokens: 1000,
      totalCostUsd: '1000.0000000000',
    }),
    request('hidden-row', {
      clientReference: 'HIDDEN',
      hiddenFromOperations: true,
      totalInputTokens: 1000,
      totalOutputTokens: 1000,
      totalCostUsd: '1000.0000000000',
    }),
    request('deleted-row', {
      clientReference: 'DELETED',
      deletedAt: new Date('2025-03-11T00:00:00.000Z'),
      totalInputTokens: 1000,
      totalOutputTokens: 1000,
      totalCostUsd: '1000.0000000000',
    }),
  ];
}

function lastValidStatuses(): ReadonlyMap<string, 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED'> {
  return new Map([
    ['profile:profile-a:reference:UNKNOWN-SNAPSHOT', 'FAILED'],
  ]);
}

async function createDashboardSchema(client: SqlClient): Promise<void> {
  await client.unsafe(`
    CREATE TABLE "Operation" (
      "id" text PRIMARY KEY,
      "apiKeyId" text,
      "clientReference" text,
      "endpointSlug" text,
      "state" text NOT NULL,
      "businessGroupKey" text GENERATED ALWAYS AS (
        CASE
          WHEN NULLIF(BTRIM("clientReference"), '') IS NULL
            THEN 'request:' || "id"
          ELSE 'profile:' || COALESCE("apiKeyId", '__internal__')
            || ':reference:' || BTRIM("clientReference")
        END
      ) STORED,
      "hiddenFromOperations" boolean NOT NULL DEFAULT false,
      "logicResult" text,
      "extractionResult" text,
      "totalInputTokens" integer NOT NULL DEFAULT 0,
      "totalOutputTokens" integer NOT NULL DEFAULT 0,
      "totalCostUsd" numeric(30, 10) NOT NULL DEFAULT 0,
      "inputTokensMissing" boolean NOT NULL DEFAULT false,
      "outputTokensMissing" boolean NOT NULL DEFAULT false,
      "costMissing" boolean NOT NULL DEFAULT false,
      "hasUnpricedCost" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) NOT NULL,
      "updatedAt" timestamp(3) NOT NULL,
      "completedAt" timestamp(3),
      "deletedAt" timestamp(3)
    );

    CREATE TABLE "BusinessOperationStatusSnapshot" (
      "businessGroupKey" text PRIMARY KEY,
      "lastValidStatus" text NOT NULL,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    );

    CREATE TABLE "ApiKey" (
      "id" text PRIMARY KEY,
      "name" text NOT NULL,
      "displayName" text
    );

    CREATE TABLE "AppSetting" (
      "key" text PRIMARY KEY,
      "value" text NOT NULL
    );
  `);
}

async function resetAndSeed(
  client: SqlClient,
  sources: readonly FixtureRequest[],
  snapshots: ReadonlyMap<string, 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED'> = new Map(),
): Promise<void> {
  await client.unsafe(`
    TRUNCATE TABLE "Operation", "BusinessOperationStatusSnapshot", "ApiKey", "AppSetting";
    INSERT INTO "ApiKey" ("id", "name", "displayName") VALUES
      ('profile-a', 'profile-a-technical', 'Profile A'),
      ('profile-b', 'profile-b-technical', 'Profile B');
  `);

  for (const source of sources) {
    await client`
      INSERT INTO "Operation" (
        "id", "apiKeyId", "clientReference", "endpointSlug", "state",
        "hiddenFromOperations", "logicResult", "extractionResult",
        "totalInputTokens", "totalOutputTokens", "totalCostUsd",
        "inputTokensMissing", "outputTokensMissing", "costMissing",
        "hasUnpricedCost", "createdAt", "updatedAt", "completedAt", "deletedAt"
      ) VALUES (
        ${source.id}, ${source.apiKeyId}, ${source.clientReference},
        ${source.endpointSlug}, ${source.state}, ${source.hiddenFromOperations},
        ${source.logicResult}, ${source.extractionResult},
        ${source.totalInputTokens ?? 0}, ${source.totalOutputTokens ?? 0},
        ${String(source.totalCostUsd ?? 0)}::numeric,
        ${source.inputTokensMissing}, ${source.outputTokensMissing},
        ${source.costMissing}, ${source.hasUnpricedCost}, ${source.createdAt},
        ${source.updatedAt}, ${source.completedAt}, ${source.deletedAt}
      )
    `;
  }

  for (const [businessGroupKey, lastValidStatus] of snapshots) {
    await client`
      INSERT INTO "BusinessOperationStatusSnapshot" (
        "businessGroupKey", "lastValidStatus"
      ) VALUES (${businessGroupKey}, ${lastValidStatus})
    `;
  }
}

/**
 * Mirrors PostgreSQL PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY x): linear
 * interpolation between the two nearest ranks over an ascending sample.
 */
function percentileContinuous(sortedAscending: readonly number[], fraction: number): number {
  const count = sortedAscending.length;
  if (count === 1) return sortedAscending[0];
  const rank = fraction * (count - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) return sortedAscending[lowerIndex];
  const lower = sortedAscending[lowerIndex];
  const upper = sortedAscending[upperIndex];
  return lower + (upper - lower) * (rank - lowerIndex);
}

/** Matches PostgreSQL ROUND(numeric, 1) for the non-negative durations here. */
function roundToOneDecimal(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function profileDisplay(scopeId: string | null): { id: string | null; name: string } {
  return {
    id: scopeId,
    name: PROFILE_NAMES.get(scopeId) ?? scopeId ?? 'Internal',
  };
}

function profileId(
  operation: BusinessOperationProjection<FixtureRequest>,
): string | null {
  return operation.profileScope.kind === 'internal'
    ? null
    : operation.profileScope.apiKeyId;
}

function referenceDashboard(
  sources: readonly FixtureRequest[],
  queryTimestamp: Date,
  calendarTimezone: string,
  input: BusinessOperationsQueryInput,
  snapshots: ReadonlyMap<string, 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED'> = new Map(),
): DashboardComparable {
  const window = resolveTimeWindow(input.range, queryTimestamp, calendarTimezone);
  const projected = projectBusinessOperations(sources, {
    lastValidStatusByBusinessGroupKey: snapshots,
  });
  const filtered = filterBusinessOperations(projected, {
    timeWindow: {
      start: window.start,
      end: window.end,
      startInclusive: true,
      endInclusive: window.endInclusive,
    },
    profileScope: input.profile === ALL_FILTER_VALUE
      ? 'ALL'
      : input.profile === '__internal__'
        ? { kind: 'internal' }
        : { kind: 'profile', apiKeyId: input.profile },
    operationType: input.operationType,
    businessStatus: input.status,
  });
  const aggregate = aggregateBusinessOperations(filtered);
  const page = createBusinessOperationListPage(filtered, input.page ?? 1);

  const summaryTerminalDurations = filtered
    .filter((operation) => (
      (operation.businessStatus === 'SUCCEEDED'
        || operation.businessStatus === 'FAILED')
      && operation.durationSeconds !== null
    ))
    .map((operation) => operation.durationSeconds as number)
    .sort((left, right) => left - right);
  const p95DurationSeconds = summaryTerminalDurations.length === 0
    ? null
    : roundToOneDecimal(percentileContinuous(summaryTerminalDurations, 0.95));

  return {
    summary: {
      totalCases: aggregate.summary.totalCases,
      tokensProcessed: aggregate.summary.tokensProcessed,
      totalCostUsd: aggregate.summary.totalCostUsd,
      logicSuccessRate: aggregate.summary.logicSuccessRate,
      aiExtractionRate: aggregate.summary.aiExtractionRate,
      p95DurationSeconds,
      unpricedRequestCount: aggregate.summary.unpricedRequestCount,
      costIncomplete: aggregate.summary.costIncomplete,
    },
    breakdownCards: aggregate.breakdownCards.map((card) => {
      const scopeId = card.profileScope.kind === 'internal'
        ? null
        : card.profileScope.apiKeyId;
      const cardOperations = filtered.filter((operation) => {
        const operationScopeId = operation.profileScope.kind === 'internal'
          ? null
          : operation.profileScope.apiKeyId;
        return operationScopeId === scopeId
          && operation.requests.some(
            (request) => request.operationType === card.operationType,
          );
      });
      const terminalDurations = cardOperations
        .filter((operation) => (
          (operation.businessStatus === 'SUCCEEDED'
            || operation.businessStatus === 'FAILED')
          && operation.durationSeconds !== null
        ))
        .map((operation) => operation.durationSeconds as number);
      const maxDurationSeconds = terminalDurations.length === 0
        ? null
        : Math.max(...terminalDurations);
      const maxTokenCount = cardOperations.reduce((max, operation) => {
        const operationTokens = operation.requests
          .filter((request) => request.operationType === card.operationType)
          .reduce((sum, request) => (
            sum
            + (request.source.totalInputTokens ?? 0)
            + (request.source.totalOutputTokens ?? 0)
          ), 0);
        return Math.max(max, operationTokens);
      }, 0);
      // The SQL encodes the extremum operation's token from its identity. Locate
      // the operation the aggregate already selected (matching tie-breaks) and
      // encode with the same helper the service uses for list/detail tokens.
      const maxDurationOperation = card.maxDurationOperationIdentifier === null
        ? null
        : cardOperations.find(
          (operation) => operation.operationIdentifier === card.maxDurationOperationIdentifier,
        ) ?? null;
      const maxTokenOperation = cardOperations.find(
        (operation) => operation.operationIdentifier === card.maxTokenOperationIdentifier,
      ) ?? null;
      return {
        profileScope: profileDisplay(scopeId),
        operationType: card.operationType,
        businessOperationCount: card.businessOperationCount,
        succeededCount: card.succeededCount,
        failedCount: card.failedCount,
        successPercentage: Math.round(
          (card.succeededCount * 100 / card.businessOperationCount) * 100,
        ) / 100,
        requestCount: card.requestCount,
        inputTokens: card.inputTokens,
        outputTokens: card.outputTokens,
        costUsd: card.costUsd,
        averageTokensPerBusinessOperation: card.averageTokensPerBusinessOperation,
        averageDurationSeconds: card.averageDurationSeconds,
        maxDurationSeconds,
        maxTokenCount,
        maxDurationOperationIdentifier: card.maxDurationOperationIdentifier,
        maxTokenOperationIdentifier: card.maxTokenOperationIdentifier,
        maxDurationOperationToken: maxDurationOperation
          ? encodeBusinessOperationToken(maxDurationOperation.identity)
          : null,
        maxTokenOperationToken: maxTokenOperation
          ? encodeBusinessOperationToken(maxTokenOperation.identity)
          : null,
        unpricedRequestCount: card.unpricedRequestCount,
        costIncomplete: card.costIncomplete,
      };
    }),
    trend: {
      bucket: window.bucket,
      points: buildBusinessOperationTrend(filtered, window).map((point) => ({
        ...point,
        start: point.start.toISOString(),
        end: point.end.toISOString(),
      })),
    },
    list: {
      items: page.items.map((operation) => {
        const operationSummary = aggregateBusinessOperationsSummary([operation]);
        const scopeId = profileId(operation);
        return {
          operationIdentifier: operation.operationIdentifier,
          normalizedReference: operation.normalizedReference,
          profileScope: profileDisplay(scopeId),
          operationTypes: operation.operationTypes,
          businessStatus: operation.businessStatus,
          invalidData: operation.invalidData,
          requestCount: operation.requestCount,
          startTime: operation.startTime.toISOString(),
          updatedTime: operation.updatedTime.toISOString(),
          endTime: operation.endTime === null ? null : operation.endTime.toISOString(),
          durationSeconds: operation.durationSeconds,
          totalTokens: operationSummary.tokensProcessed,
          totalCostUsd: operationSummary.totalCostUsd,
          unpricedRequestCount: operationSummary.unpricedRequestCount,
          missingData: operationSummary.missingData,
        };
      }),
      page: page.page,
      pageSize: 50,
      total: page.total,
      totalPages: Math.ceil(page.total / 50),
    },
  };
}

function comparableDashboard(
  response: BusinessOperationsDashboardResponse,
): DashboardComparable {
  return {
    summary: response.summary,
    breakdownCards: response.breakdownCards,
    trend: response.trend,
    list: {
      ...response.list,
      items: response.list.items.map(({ token: _token, ...item }) => item),
    },
  };
}

function timezoneFixtures(window: ResolvedTimeWindow): FixtureRequest[] {
  return [
    request('timezone-start', {
      apiKeyId: null,
      clientReference: null,
      endpointSlug: 'timezone',
      createdAt: new Date(window.start),
      updatedAt: new Date(window.start),
      completedAt: new Date(window.start),
      totalInputTokens: 1,
    }),
    request('timezone-end', {
      apiKeyId: null,
      clientReference: null,
      endpointSlug: 'timezone',
      state: 'FAILED',
      createdAt: new Date(window.end),
      updatedAt: new Date(window.end),
      completedAt: new Date(window.end),
      totalOutputTokens: 1,
    }),
  ];
}

describePostgres('Business dashboard SQL-to-reference PostgreSQL integration', () => {
  let administrationClient: SqlClient;
  let client: SqlClient;
  let schemaName: string;
  let originalTokenSecret: string | undefined;
  let originalTimezone: string | undefined;

  beforeAll(async () => {
    originalTokenSecret = process.env.BUSINESS_OPERATION_TOKEN_SECRET;
    originalTimezone = process.env.TZ;
    process.env.BUSINESS_OPERATION_TOKEN_SECRET = 'sql-reference-integration-secret';
    process.env.TZ = 'UTC';

    administrationClient = postgres(integrationDatabaseUrl!, { max: 1 });
    schemaName = `business_query_reference_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await administrationClient.unsafe(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    client = postgres(integrationDatabaseUrl!, {
      max: 1,
      connection: { search_path: schemaName },
    });
    await client.unsafe(`SET TIME ZONE 'UTC'`);
    await createDashboardSchema(client);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
    await administrationClient.unsafe(
      `DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`,
    );
    await administrationClient.end({ timeout: 5 });

    if (originalTokenSecret === undefined) {
      delete process.env.BUSINESS_OPERATION_TOKEN_SECRET;
    } else {
      process.env.BUSINESS_OPERATION_TOKEN_SECRET = originalTokenSecret;
    }
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  it('matches the pure model for grouping, status, exact decimals, missing/unpriced data, boundaries, ties, and empty output', async () => {
    const queryTimestamp = new Date('2025-04-15T12:00:00.000Z');
    const sources = mainFixtures();
    const snapshots = lastValidStatuses();
    await resetAndSeed(client, sources, snapshots);

    const input = dashboardInput();
    const service = createBusinessOperationQueryService(
      new PostgresBusinessQueryStore(client, queryTimestamp, 'UTC'),
    );
    const response = await service.getDashboardSnapshot(input, authorization);

    expect(comparableDashboard(response)).toEqual(
      referenceDashboard(sources, queryTimestamp, 'UTC', input, snapshots),
    );
    expect(response.summary.totalCostUsd).toBe('2.3000000003');
    expect(response.list.items.map((item) => item.operationIdentifier)).not.toContain(
      'EXCLUSIVE-END',
    );
    expect(response.list.items.filter((item) => (
      item.operationIdentifier === 'SHARED-REF'
    ))).toHaveLength(2);
    expect(response.list.items.find((item) => (
      item.operationIdentifier === 'UNKNOWN-SNAPSHOT'
    ))).toMatchObject({ businessStatus: 'FAILED', invalidData: true });
    expect(response.list.items.find((item) => (
      item.operationIdentifier === 'UNKNOWN-NO-SNAPSHOT'
    ))).toMatchObject({ businessStatus: 'N/A', invalidData: true });
    expect(response.breakdownCards.find((card) => (
      card.operationType === 'tie-type'
    ))).toMatchObject({
      maxDurationOperationIdentifier: 'A-TIE',
      maxTokenOperationIdentifier: 'A-TIE',
    });

    const emptyInput = dashboardInput({ operationType: 'not-represented' });
    const emptyResponse = await service.getDashboardSnapshot(emptyInput, authorization);
    expect(comparableDashboard(emptyResponse)).toEqual(
      referenceDashboard(sources, queryTimestamp, 'UTC', emptyInput, snapshots),
    );
    expect(emptyResponse.summary).toEqual({
      totalCases: 0,
      tokensProcessed: 0,
      totalCostUsd: '0.0000000000',
      logicSuccessRate: null,
      aiExtractionRate: null,
      p95DurationSeconds: null,
      unpricedRequestCount: 0,
      costIncomplete: false,
    });
    expect(emptyResponse.breakdownCards).toEqual([]);
    expect(emptyResponse.list.items).toEqual([]);
    expect(emptyResponse.trend.points.every((point) => point.total === 0)).toBe(true);
  });

  it.each([
    'Asia/Ho_Chi_Minh',
    'UTC',
    'America/New_York',
  ])('matches local-calendar hour buckets in %s', async (calendarTimezone) => {
    const queryTimestamp = new Date('2025-03-10T03:30:00.000Z');
    const window = resolveTimeWindow('today', queryTimestamp, calendarTimezone);
    const sources = timezoneFixtures(window);
    await resetAndSeed(client, sources);

    const input = dashboardInput({ range: 'today' });
    const response = await createBusinessOperationQueryService(
      new PostgresBusinessQueryStore(client, queryTimestamp, calendarTimezone),
    ).getDashboardSnapshot(input, authorization);

    expect(comparableDashboard(response)).toEqual(
      referenceDashboard(sources, queryTimestamp, calendarTimezone, input),
    );
    expect(response.trend.points.reduce((total, point) => total + point.total, 0)).toBe(2);
    expect(response.trend.points[0].start).toBe(window.start.toISOString());
    expect(response.trend.points.at(-1)?.end).toBe(window.end.toISOString());

    if (calendarTimezone === 'America/New_York') {
      expect(buildCalendarBuckets(window)).toHaveLength(23);
      expect(response.trend.points.some((point) => point.localKey.endsWith('T02'))).toBe(false);
    }
  });
});
