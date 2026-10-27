import { PgDialect, type PgTransactionConfig } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  ALL_FILTER_VALUE,
  BUSINESS_QUERY_STATEMENT_TIMEOUT_MS,
  BUSINESS_QUERY_TRANSACTION_CONFIG,
  BusinessQueryError,
  buildAuthorizedRequestsCte,
  createBusinessOperationQueryService,
  validateBusinessOperationsQueryInput,
  type BusinessOperationsQueryInput,
  type BusinessQueryAuthorizationContext,
  type BusinessQueryExecutor,
  type BusinessQueryStore,
} from '@/lib/operations/business-query';

const dialect = new PgDialect();
const QUERY_TIMESTAMP = new Date('2026-03-21T04:05:06.789Z');

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

function authorization(
  overrides: Partial<BusinessQueryAuthorizationContext> = {},
): BusinessQueryAuthorizationContext {
  return {
    actorId: 'operator-1',
    canReadOperations: true,
    allowedProfileIds: ['profile-a'],
    canReadInternalScope: true,
    ...overrides,
  };
}

class RecordingStore implements BusinessQueryStore {
  transactionCalls = 0;
  transactionConfig: PgTransactionConfig | null = null;
  readonly statements: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly dashboardRows: Array<Record<string, unknown>> = [],
  ) {}

  async transaction<T>(
    callback: (transaction: BusinessQueryExecutor) => Promise<T>,
    config: PgTransactionConfig,
  ): Promise<T> {
    this.transactionCalls += 1;
    this.transactionConfig = config;

    const executor: BusinessQueryExecutor = {
      execute: async <TRow extends Record<string, unknown>>(statement: SQL): Promise<TRow[]> => {
        const query = compile(statement);
        this.statements.push(query);
        if (query.sql.includes('transaction_timestamp()')) {
          return [{
            queryTimestamp: QUERY_TIMESTAMP,
            calendarTimezone: 'Asia/Ho_Chi_Minh',
          }] as unknown as TRow[];
        }
        if (query.sql.includes('grouped_operations AS MATERIALIZED')) {
          return this.dashboardRows as unknown as TRow[];
        }
        return [];
      },
    };

    return callback(executor);
  }
}

describe('Business Operation query validation and authorization', () => {
  it('normalizes the stable service input before database work', () => {
    expect(validateBusinessOperationsQueryInput(input({
      profile: ' profile-a ',
      operationType: ' extract ',
      query: ' Case-42 ',
      searchMode: 'contains',
      page: 3,
    }))).toEqual({
      range: 'today',
      profile: 'profile-a',
      operationType: 'extract',
      status: 'ALL',
      search: { query: 'Case-42', mode: 'contains' },
      page: 3,
    });
  });

  it('rejects invalid filters, searches, capability, and profile scope before a transaction', async () => {
    const cases: Array<{
      queryInput: BusinessOperationsQueryInput;
      auth: BusinessQueryAuthorizationContext;
      code: string;
    }> = [
      {
        queryInput: input({ range: 'rolling_week' as BusinessOperationsQueryInput['range'] }),
        auth: authorization(),
        code: 'INVALID_FILTER',
      },
      {
        queryInput: input({ query: '   ' }),
        auth: authorization(),
        code: 'INVALID_SEARCH',
      },
      {
        queryInput: input({ query: 'x'.repeat(257) }),
        auth: authorization(),
        code: 'INVALID_SEARCH',
      },
      {
        queryInput: input(),
        auth: authorization({ canReadOperations: false }),
        code: 'OPERATIONS_FORBIDDEN',
      },
      {
        queryInput: input({ profile: 'profile-private' }),
        auth: authorization(),
        code: 'PROFILE_SCOPE_FORBIDDEN',
      },
      {
        queryInput: input({ profile: '__internal__' }),
        auth: authorization({ canReadInternalScope: false }),
        code: 'PROFILE_SCOPE_FORBIDDEN',
      },
    ];

    for (const testCase of cases) {
      const store = new RecordingStore();
      const service = createBusinessOperationQueryService(store);
      let error: unknown;
      try {
        await service.withSnapshot(testCase.queryInput, testCase.auth, async () => null);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(BusinessQueryError);
      expect((error as BusinessQueryError).code).toBe(testCase.code);
      expect(store.transactionCalls).toBe(0);
      expect(store.statements).toEqual([]);
    }
  });
});

describe('Business Operation database snapshot foundation', () => {
  it('uses one read-only repeatable-read transaction, timeout, timestamp, and calendar setting', async () => {
    const store = new RecordingStore();
    const service = createBusinessOperationQueryService(store);

    const result = await service.withSnapshot(
      input({ profile: 'profile-a' }),
      authorization(),
      async (context) => ({
        queryTimestamp: context.queryTimestamp,
        windowQueryTimestamp: context.resolvedWindow.queryTimestamp,
        timezone: context.calendarTimezone,
        profile: context.appliedFilter.profile,
      }),
    );

    expect(store.transactionCalls).toBe(1);
    expect(store.transactionConfig).toEqual(BUSINESS_QUERY_TRANSACTION_CONFIG);
    expect(store.transactionConfig).toEqual({
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
    expect(store.statements[0].sql).toBe(
      `SET LOCAL statement_timeout = '${BUSINESS_QUERY_STATEMENT_TIMEOUT_MS}ms'`,
    );
    expect(store.statements[1].sql).toContain('transaction_timestamp()');
    expect(store.statements[1].sql).toContain('ops_calendar_timezone');
    expect(result).toEqual({
      queryTimestamp: QUERY_TIMESTAMP,
      windowQueryTimestamp: QUERY_TIMESTAMP,
      timezone: 'Asia/Ho_Chi_Minh',
      profile: 'profile-a',
    });
  });

  it('projects only eligible operational metadata and scopes rows before grouping or search', () => {
    const restricted = compile(buildAuthorizedRequestsCte(authorization({
      allowedProfileIds: ['profile-a', 'profile-b'],
      canReadInternalScope: true,
    })));

    expect(restricted.sql).toContain('authorized_requests AS MATERIALIZED');
    expect(restricted.sql).toContain('"Operation"."deletedAt" is null');
    expect(restricted.sql).toContain('"Operation"."hiddenFromOperations" =');
    expect(restricted.sql).toContain('"Operation"."apiKeyId" in');
    expect(restricted.sql).toContain('"Operation"."apiKeyId" is null');
    expect(restricted.params).toEqual(expect.arrayContaining([
      false,
      'profile-a',
      'profile-b',
    ]));

    expect(restricted.sql).toContain('request_id');
    expect(restricted.sql).toContain('business_group_key');
    expect(restricted.sql).toContain('normalized_reference');
    expect(restricted.sql).toContain('total_cost_usd');
    expect(restricted.sql).not.toContain('filesJson');
    expect(restricted.sql).not.toContain('pipelineJson');
    expect(restricted.sql).not.toContain('outputContent');
    expect(restricted.sql).not.toContain('extractedData');
    expect(restricted.sql).not.toContain('stepsResultJson');
    expect(restricted.sql).not.toContain('progressLogJson');
  });

  it('models global, assigned-only, and empty authorization scopes explicitly', () => {
    const globalProfilesOnly = compile(buildAuthorizedRequestsCte(authorization({
      allowedProfileIds: null,
      canReadInternalScope: false,
    })));
    expect(globalProfilesOnly.sql).toContain('"Operation"."apiKeyId" is not null');
    expect(globalProfilesOnly.sql).not.toContain('"Operation"."apiKeyId" is null');

    const noVisibleScope = compile(buildAuthorizedRequestsCte(authorization({
      allowedProfileIds: [],
      canReadInternalScope: false,
    })));
    expect(noVisibleScope.sql).toContain('false');
  });
});


describe('Atomic Business Operations dashboard snapshot', () => {
  const dashboardRow = {
    summary: {
      totalCases: 2,
      tokensProcessed: 3500,
      totalCostUsd: '12.34',
      logicSuccessRate: 100,
      aiExtractionRate: null,
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

  it('uses shared grouped/status/filtered CTEs for all response sections', async () => {
    const store = new RecordingStore([dashboardRow]);
    const service = createBusinessOperationQueryService(store);
    const previousSecret = process.env.BUSINESS_OPERATION_TOKEN_SECRET;
    process.env.BUSINESS_OPERATION_TOKEN_SECRET = 'dashboard-query-test-secret';

    try {
      const response = await service.getDashboardSnapshot(
        input({
          profile: 'profile-a',
          operationType: 'workflows:payroll',
          status: 'SUCCEEDED',
          query: 'case',
          searchMode: 'contains',
          page: 2,
        }),
        authorization(),
      );

      expect(store.transactionCalls).toBe(1);
      expect(store.statements).toHaveLength(3);
      const aggregate = store.statements[2];
      const aggregateSql = aggregate.sql.toLowerCase();
      expect(aggregateSql).toContain('grouped_operations as materialized');
      expect(aggregateSql).toContain('status_projection as materialized');
      expect(aggregateSql).toContain('filtered_business_operations as materialized');
      expect(aggregateSql).toContain('card_operation_metrics as materialized');
      expect(aggregateSql).toContain('trend_buckets');
      expect(aggregateSql).toContain('left join filtered_business_operations');
      expect(aggregateSql).toContain('exists (');
      expect(aggregateSql).toContain('::numeric');
      expect(aggregateSql).toContain('collate "c"');
      expect(aggregateSql).toContain('limit 50 offset');
      expect(aggregate.params).toEqual(expect.arrayContaining([
        'profile-a',
        'workflows:payroll',
        'SUCCEEDED',
        'case',
        50,
      ]));

      expect(response.summary).toEqual({
        ...dashboardRow.summary,
        totalCostUsd: '12.3400000000',
      });
      expect(response.breakdownCards[0]).toEqual({
        ...dashboardRow.breakdownCards[0],
        costUsd: '12.3400000000',
      });
      expect(response.breakdownCards[0].successPercentage).toBe(50);
      expect(response.list).toMatchObject({ page: 2, pageSize: 50, total: 51, totalPages: 2 });
      expect(response.list.items[0]).toMatchObject({
        operationIdentifier: 'CASE-1',
        totalCostUsd: '10.5000000000',
      });
      expect(response.list.items[0].token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(response.trend.points[0]).toEqual(dashboardRow.trendPoints[0]);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.BUSINESS_OPERATION_TOKEN_SECRET;
      } else {
        process.env.BUSINESS_OPERATION_TOKEN_SECRET = previousSecret;
      }
    }
  });

  it('returns deterministic empty KPI/card/list semantics from the same snapshot', async () => {
    const store = new RecordingStore([{
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
      trendPoints: [],
      listItems: [],
      listTotal: 0,
    }]);

    const response = await createBusinessOperationQueryService(store)
      .getDashboardSnapshot(input(), authorization());

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
    expect(response.list).toEqual({
      items: [], page: 1, pageSize: 50, total: 0, totalPages: 0,
    });
  });
});
