import type { SQL } from 'drizzle-orm';
import { PgDialect, type PgTransactionConfig } from 'drizzle-orm/pg-core';
import {
  ALL_FILTER_VALUE,
  BUSINESS_QUERY_TRANSACTION_CONFIG,
  buildBusinessOperationsProjectionCtes,
  createBusinessOperationQueryService,
  type BusinessOperationsQueryInput,
  type BusinessQueryAuthorizationContext,
  type BusinessQueryExecutor,
  type BusinessQuerySnapshotContext,
  type BusinessQueryStore,
} from '@/lib/operations/business-query';

const dialect = new PgDialect();
const QUERY_TIMESTAMP = new Date('2026-03-21T04:05:06.789Z');
const TIMEZONE = 'Asia/Ho_Chi_Minh';

function compile(statement: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(statement);
  return { sql: query.sql, params: query.params };
}

function input(
  overrides: Partial<BusinessOperationsQueryInput> = {},
): BusinessOperationsQueryInput {
  return {
    range: 'today',
    profile: ALL_FILTER_VALUE,
    operationType: ALL_FILTER_VALUE,
    status: ALL_FILTER_VALUE,
    page: 1,
    ...overrides,
  };
}

const authorization: BusinessQueryAuthorizationContext = {
  actorId: 'operator-1',
  canReadOperations: true,
  allowedProfileIds: ['profile-a'],
  canReadInternalScope: true,
};

class RecordingStore implements BusinessQueryStore {
  transactionCalls = 0;
  transactionConfig: PgTransactionConfig | null = null;
  readonly statements: Array<{ sql: string; params: unknown[] }> = [];

  constructor(private readonly dashboardRow: Record<string, unknown>) {}

  async transaction<T>(
    callback: (transaction: BusinessQueryExecutor) => Promise<T>,
    config: PgTransactionConfig,
  ): Promise<T> {
    this.transactionCalls += 1;
    this.transactionConfig = config;

    const executor: BusinessQueryExecutor = {
      execute: async <TRow extends Record<string, unknown>>(statement: SQL): Promise<TRow[]> => {
        const compiled = compile(statement);
        this.statements.push(compiled);

        if (compiled.sql.includes('transaction_timestamp()')) {
          return [{
            queryTimestamp: QUERY_TIMESTAMP,
            calendarTimezone: TIMEZONE,
          }] as unknown as TRow[];
        }
        if (compiled.sql.includes('card_operation_metrics AS MATERIALIZED')) {
          return [this.dashboardRow] as unknown as TRow[];
        }
        return [];
      },
    };

    return callback(executor);
  }
}

const populatedDashboardRow = {
  summary: {
    totalCases: 2,
    tokensProcessed: 3500,
    totalCostUsd: '12.34',
    logicSuccessRate: 100,
    aiExtractionRate: 50,
    unpricedRequestCount: 1,
    costIncomplete: true,
  },
  breakdownCards: [{
    profileScope: { id: 'profile-a', name: 'Payroll' },
    operationType: 'workflows:payroll',
    businessOperationCount: 2,
    succeededCount: 1,
    failedCount: 1,
    successPercentage: 50,
    requestCount: 3,
    inputTokens: 2000,
    outputTokens: 1500,
    costUsd: '12.34',
    averageTokensPerBusinessOperation: 1750,
    averageDurationSeconds: 30.5,
    maxDurationOperationIdentifier: 'CASE-2',
    maxTokenOperationIdentifier: 'CASE-1',
    unpricedRequestCount: 1,
    costIncomplete: true,
  }],
  trendPoints: [{
    unit: 'hour',
    localKey: '2026-03-21T11',
    occurrence: 1,
    start: '2026-03-21T04:00:00.000Z',
    end: QUERY_TIMESTAMP.toISOString(),
    startInclusive: true,
    endInclusive: true,
    clippedStart: false,
    clippedEnd: true,
    counts: { IN_PROGRESS: 0, SUCCEEDED: 1, FAILED: 1 },
    total: 2,
  }],
  listItems: [{
    operationIdentifier: 'CASE-1',
    normalizedReference: 'CASE-1',
    profileScope: { id: 'profile-a', name: 'Payroll' },
    profileScopeId: 'profile-a',
    standaloneRequestId: 'request-1',
    operationTypes: ['extract', 'workflows:payroll'],
    businessStatus: 'SUCCEEDED',
    invalidData: false,
    requestCount: 2,
    startTime: '2026-03-21T03:00:00.000Z',
    updatedTime: '2026-03-21T04:00:00.000Z',
    totalTokens: 2500,
    totalCostUsd: '10.5',
    unpricedRequestCount: 0,
    missingData: false,
  }],
  listTotal: '51',
};

describe('atomic Business Operations dashboard query', () => {
  const originalTokenSecret = process.env.BUSINESS_OPERATION_TOKEN_SECRET;

  beforeAll(() => {
    process.env.BUSINESS_OPERATION_TOKEN_SECRET = 'dashboard-query-test-secret';
  });

  afterAll(() => {
    if (originalTokenSecret === undefined) {
      delete process.env.BUSINESS_OPERATION_TOKEN_SECRET;
    } else {
      process.env.BUSINESS_OPERATION_TOKEN_SECRET = originalTokenSecret;
    }
  });

  it('returns every dashboard section from one repeatable-read snapshot and one aggregate statement', async () => {
    const store = new RecordingStore(populatedDashboardRow);
    const service = createBusinessOperationQueryService(store);
    const queryInput = input({
      profile: 'profile-a',
      operationType: 'workflows:payroll',
      status: 'SUCCEEDED',
      query: 'case',
      searchMode: 'contains',
      page: 2,
    });

    const response = await service.getDashboardSnapshot(queryInput, authorization);

    expect(store.transactionCalls).toBe(1);
    expect(store.transactionConfig).toEqual(BUSINESS_QUERY_TRANSACTION_CONFIG);
    expect(store.statements).toHaveLength(3);
    expect(store.statements.filter(({ sql }) => (
      sql.includes('card_operation_metrics AS MATERIALIZED')
    ))).toHaveLength(1);

    expect(response.queryTimestamp).toBe(QUERY_TIMESTAMP.toISOString());
    expect(response.calendarTimezone).toBe(TIMEZONE);
    expect(response.resolvedWindow).toMatchObject({
      end: QUERY_TIMESTAMP.toISOString(),
      endInclusive: true,
      preset: 'today',
    });
    expect(response.appliedFilter).toEqual({
      range: 'today',
      profile: 'profile-a',
      operationType: 'workflows:payroll',
      status: 'SUCCEEDED',
      search: { query: 'case', mode: 'contains' },
      page: 2,
    });
    expect(response.summary).toEqual({
      ...populatedDashboardRow.summary,
      totalCostUsd: '12.3400000000',
    });
    expect(response.breakdownCards).toEqual([{
      ...populatedDashboardRow.breakdownCards[0],
      costUsd: '12.3400000000',
    }]);
    expect(response.trend.points).toEqual(populatedDashboardRow.trendPoints);
    expect(response.list).toMatchObject({ page: 2, pageSize: 50, total: 51, totalPages: 2 });
    expect(response.list.items[0]).toMatchObject({
      operationIdentifier: 'CASE-1',
      totalCostUsd: '10.5000000000',
    });
  });

  it('reuses grouped/status/filtered CTEs and the same resolved filter window for every section', async () => {
    const store = new RecordingStore(populatedDashboardRow);
    const service = createBusinessOperationQueryService(store);
    let projectionSql: { sql: string; params: unknown[] } | null = null;

    await service.withSnapshot(
      input({
        profile: 'profile-a',
        operationType: 'workflows:payroll',
        status: 'FAILED',
        query: 'CASE-9',
        searchMode: 'exact',
      }),
      authorization,
      async (context: BusinessQuerySnapshotContext) => {
        projectionSql = compile(buildBusinessOperationsProjectionCtes(context));
      },
    );

    expect(projectionSql).not.toBeNull();
    const projection = projectionSql as unknown as { sql: string; params: unknown[] };
    const normalizedSql = projection.sql.toLowerCase();
    expect(normalizedSql).toContain('grouped_operations as materialized');
    expect(normalizedSql).toContain('status_projection as materialized');
    expect(normalizedSql).toContain('filtered_business_operations as materialized');
    expect(normalizedSql).toContain('from authorized_requests');
    expect(normalizedSql).toContain('exists (');
    expect(normalizedSql).toContain('collate "c"');
    expect(projection.params).toEqual(expect.arrayContaining([
      'profile-a',
      'workflows:payroll',
      'FAILED',
      'CASE-9',
    ]));
    expect(projection.params.some((value) => (
      value instanceof Date && value.getTime() === QUERY_TIMESTAMP.getTime()
    ))).toBe(true);
  });

  it('preserves numeric SQL invariants, deterministic ordering, gap filling, and page-50 pagination', async () => {
    const store = new RecordingStore(populatedDashboardRow);
    await createBusinessOperationQueryService(store)
      .getDashboardSnapshot(input({ page: 2 }), authorization);

    const aggregate = store.statements[2];
    const sql = aggregate.sql.toLowerCase();
    expect(sql).toContain('sum(total_cost_usd)');
    expect(sql).toContain('0::numeric');
    expect(sql).toContain('round(');
    expect(sql).toContain('collate "c"');
    expect(sql).toContain('values');
    expect(sql).toContain('left join filtered_business_operations');
    expect(sql).toContain('limit 50 offset');
    expect(aggregate.params).toContain(50);
  });

  it('strictly denies request content fields from every dashboard response section', async () => {
    const store = new RecordingStore({
      ...populatedDashboardRow,
      summary: {
        ...populatedDashboardRow.summary,
        documentContent: 'private-summary-document',
      },
      breakdownCards: [{
        ...populatedDashboardRow.breakdownCards[0],
        pipelineJson: { stages: ['private-card-pipeline'] },
      }],
      trendPoints: [{
        ...populatedDashboardRow.trendPoints[0],
        outputContent: 'private-trend-output',
      }],
      listItems: [{
        ...populatedDashboardRow.listItems[0],
        filesJson: [{ name: 'private-list-file' }],
        prompt: 'private-list-prompt',
        document: 'private-list-document',
        output: 'private-list-output',
      }],
    });

    const response = await createBusinessOperationQueryService(store)
      .getDashboardSnapshot(input(), authorization);
    const serialized = JSON.stringify(response);

    for (const forbiddenField of [
      'documentContent',
      'pipelineJson',
      'outputContent',
      'filesJson',
      'prompt',
      'document',
      'output',
    ]) {
      expect(serialized).not.toContain(`"${forbiddenField}":`);
    }
    for (const forbiddenValue of [
      'private-summary-document',
      'private-card-pipeline',
      'private-trend-output',
      'private-list-file',
      'private-list-prompt',
      'private-list-document',
      'private-list-output',
    ]) {
      expect(serialized).not.toContain(forbiddenValue);
    }
  });

  it('maps deterministic empty KPI/card/list semantics and zero-filled trend points', async () => {
    const zeroPoint = {
      unit: 'hour',
      localKey: '2026-03-21T11',
      occurrence: 1,
      start: '2026-03-21T04:00:00.000Z',
      end: QUERY_TIMESTAMP.toISOString(),
      startInclusive: true,
      endInclusive: true,
      clippedStart: false,
      clippedEnd: true,
      counts: { IN_PROGRESS: 0, SUCCEEDED: 0, FAILED: 0 },
      total: 0,
    };
    const store = new RecordingStore({
      summary: {
        totalCases: 0,
        tokensProcessed: 0,
        totalCostUsd: '0',
        logicSuccessRate: null,
        aiExtractionRate: null,
        unpricedRequestCount: 0,
        costIncomplete: false,
      },
      breakdownCards: [],
      trendPoints: [zeroPoint],
      listItems: [],
      listTotal: 0,
    });

    const response = await createBusinessOperationQueryService(store)
      .getDashboardSnapshot(input(), authorization);

    expect(response.summary).toEqual({
      totalCases: 0,
      tokensProcessed: 0,
      totalCostUsd: '0.0000000000',
      logicSuccessRate: null,
      aiExtractionRate: null,
      unpricedRequestCount: 0,
      costIncomplete: false,
    });
    expect(response.breakdownCards).toEqual([]);
    expect(response.trend.points).toEqual([zeroPoint]);
    expect(response.list).toEqual({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
      totalPages: 0,
    });
  });
});
