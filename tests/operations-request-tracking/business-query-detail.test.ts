import type { SQL } from 'drizzle-orm';
import { PgDialect, type PgTransactionConfig } from 'drizzle-orm/pg-core';
import { encodeBusinessOperationToken, type BusinessIdentity } from '@/lib/operations/business-key';
import {
  BUSINESS_QUERY_TRANSACTION_CONFIG,
  BusinessQueryError,
  createBusinessOperationQueryService,
  type BusinessQueryAuthorizationContext,
  type BusinessQueryExecutor,
  type BusinessQueryStore,
} from '@/lib/operations/business-query';

const dialect = new PgDialect();
const QUERY_TIMESTAMP = new Date('2026-03-21T04:05:06.789Z');
const SENSITIVE_SOURCE_COLUMNS = [
  'files',
  'filesJson',
  'pipeline',
  'pipelineJson',
  'prompt',
  'prompts',
  'systemPrompt',
  'userPrompt',
  'document',
  'documentContent',
  'output',
  'outputContent',
  'extractedData',
  'stepsResultJson',
  'progressLogJson',
  'webhookUrl',
];

function compile(statement: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(statement);
  return { sql: query.sql, params: query.params };
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

class DetailRecordingStore implements BusinessQueryStore {
  transactionCalls = 0;
  transactionConfig: PgTransactionConfig | null = null;
  readonly statements: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly detailRows: Array<Record<string, unknown>> = [],
    private readonly filterRows: Array<Record<string, unknown>> = [],
  ) {}

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
        if (compiled.sql.includes('matched_requests AS MATERIALIZED')) {
          return this.detailRows as unknown as TRow[];
        }
        if (compiled.sql.includes('represented_operation_types AS MATERIALIZED')) {
          return this.filterRows as unknown as TRow[];
        }
        return [];
      },
    };
    return callback(executor);
  }
}

const referencedIdentity: BusinessIdentity = {
  kind: 'referenced',
  scope: { kind: 'profile', apiKeyId: 'profile-a' },
  normalizedReference: 'CASE-42',
};

const detailRow = {
  queryTimestamp: QUERY_TIMESTAMP,
  operation: {
    operationIdentifier: 'CASE-42',
    normalizedReference: 'CASE-42',
    profileScope: { id: 'profile-a', name: 'Payroll' },
    operationTypes: ['extract', 'validate'],
    businessStatus: 'FAILED',
    invalidData: false,
    requestCount: 205,
    startTime: '2026-03-21T01:00:00.000Z',
    updatedTime: '2026-03-21T04:00:00.000Z',
    totalTokens: 3500,
    totalCostUsd: '12.34',
    unpricedRequestCount: 1,
    missingData: true,
    endTime: '2026-03-21T03:00:00.000Z',
    durationSeconds: 7200,
  },
  requestItems: [{
    id: 'request-101',
    operationType: 'validate',
    state: 'FAILED',
    startedAt: '2026-03-21T02:00:00.000Z',
    completedAt: '2026-03-21T02:01:00.000Z',
    inputTokens: 100,
    outputTokens: null,
    costUsd: '0.125',
    errorCode: 'VALIDATION_FAILED',
    errorMessage: 'Invalid source structure',
    missingData: true,
    unpricedCost: false,
  }],
  requestTotal: '205',
};

describe('Business Operation constituent detail query', () => {
  const originalSecret = process.env.BUSINESS_OPERATION_TOKEN_SECRET;

  beforeAll(() => {
    process.env.BUSINESS_OPERATION_TOKEN_SECRET = 'business-query-detail-test-secret';
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.BUSINESS_OPERATION_TOKEN_SECRET;
    } else {
      process.env.BUSINESS_OPERATION_TOKEN_SECRET = originalSecret;
    }
  });

  it('decodes identity, re-authorizes current rows, and returns a fixed page-100 operational projection', async () => {
    const store = new DetailRecordingStore([detailRow]);
    const token = encodeBusinessOperationToken(referencedIdentity);

    const response = await createBusinessOperationQueryService(store)
      .getBusinessOperationDetail(token, 2, authorization());

    expect(store.transactionCalls).toBe(1);
    expect(store.transactionConfig).toEqual(BUSINESS_QUERY_TRANSACTION_CONFIG);
    expect(store.statements).toHaveLength(2);
    const detail = store.statements[1];
    expect(detail.sql).toContain('authorized_requests AS MATERIALIZED');
    expect(detail.sql).toContain('matched_requests AS MATERIALIZED');
    expect(detail.sql).toContain('"Operation"."deletedAt" is null');
    expect(detail.sql).toContain('"Operation"."hiddenFromOperations" =');
    expect(detail.sql).toContain('"Operation"."apiKeyId" in');
    expect(detail.sql).toContain('error_code');
    expect(detail.sql).toContain('error_message');
    expect(detail.sql).toContain('ORDER BY created_at ASC, request_id COLLATE "C" ASC');
    expect(detail.sql).toContain('LIMIT 100 OFFSET');
    expect(detail.params).toEqual(expect.arrayContaining([
      false,
      'profile-a',
      'profile:profile-a:reference:CASE-42',
      'CASE-42',
      100,
    ]));
    for (const sensitiveColumn of SENSITIVE_SOURCE_COLUMNS) {
      expect(detail.sql).not.toContain(`"Operation"."${sensitiveColumn}"`);
    }

    expect(response.queryTimestamp).toBe(QUERY_TIMESTAMP.toISOString());
    expect(response.operation).toMatchObject({
      token,
      operationIdentifier: 'CASE-42',
      totalCostUsd: '12.3400000000',
      endTime: '2026-03-21T03:00:00.000Z',
    });
    expect(response.requests).toEqual({
      items: [{
        ...detailRow.requestItems[0],
        costUsd: '0.1250000000',
      }],
      page: 2,
      pageSize: 100,
      total: 205,
      totalPages: 3,
    });
  });

  it('rejects invalid tokens, invalid pages, and revoked capability before database work', async () => {
    const token = encodeBusinessOperationToken(referencedIdentity);
    const cases: Array<{
      token: string;
      page: number;
      auth: BusinessQueryAuthorizationContext;
      code: string;
    }> = [
      { token: `${token}x`, page: 1, auth: authorization(), code: 'INVALID_OPERATION_TOKEN' },
      { token, page: 0, auth: authorization(), code: 'INVALID_FILTER' },
      {
        token,
        page: 1,
        auth: authorization({ canReadOperations: false }),
        code: 'OPERATIONS_FORBIDDEN',
      },
    ];

    for (const testCase of cases) {
      const store = new DetailRecordingStore();
      let error: unknown;
      try {
        await createBusinessOperationQueryService(store).getBusinessOperationDetail(
          testCase.token,
          testCase.page,
          testCase.auth,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(BusinessQueryError);
      expect((error as BusinessQueryError).code).toBe(testCase.code);
      expect(store.transactionCalls).toBe(0);
      expect(store.statements).toEqual([]);
    }
  });

  it('returns one generic not-found result when current authorized rows do not contain the identity', async () => {
    const store = new DetailRecordingStore([{
      queryTimestamp: QUERY_TIMESTAMP,
      operation: null,
      requestItems: [],
      requestTotal: 0,
    }]);
    let error: unknown;

    try {
      await createBusinessOperationQueryService(store).getBusinessOperationDetail(
        referencedIdentity,
        1,
        authorization({ allowedProfileIds: ['profile-b'] }),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(BusinessQueryError);
    expect((error as BusinessQueryError).code).toBe('BUSINESS_OPERATION_NOT_FOUND');
    expect((error as Error).message).toBe('Business Operation was not found');
    expect(store.statements[1].params).toEqual(expect.arrayContaining([
      'profile-b',
      'profile-a',
      'profile:profile-a:reference:CASE-42',
    ]));
  });
});

describe('Business Operation filter-options query', () => {
  it('returns authorized profiles and represented operation types without source payloads', async () => {
    const store = new DetailRecordingStore([], [{
      profiles: [{ id: 'profile-a', name: 'Payroll' }],
      operationTypes: ['extract', 'validate'],
      hasInternalScope: true,
    }]);

    const response = await createBusinessOperationQueryService(store)
      .getFilterOptions(authorization());

    expect(response).toEqual({
      profiles: [{ id: 'profile-a', name: 'Payroll' }],
      operationTypes: ['extract', 'validate'],
      hasInternalScope: true,
    });
    expect(store.transactionConfig).toEqual(BUSINESS_QUERY_TRANSACTION_CONFIG);
    expect(store.statements).toHaveLength(2);
    const options = store.statements[1];
    expect(options.sql).toContain('authorized_requests AS MATERIALIZED');
    expect(options.sql).toContain('represented_operation_types AS MATERIALIZED');
    expect(options.sql).toContain('"ApiKey"."id" in');
    expect(options.params).toEqual(expect.arrayContaining([false, 'profile-a', true]));
    for (const sensitiveColumn of [...SENSITIVE_SOURCE_COLUMNS, 'errorCode', 'errorMessage']) {
      expect(options.sql).not.toContain(`"Operation"."${sensitiveColumn}"`);
    }
  });

  it('fails closed before querying options when Operations capability is absent', async () => {
    const store = new DetailRecordingStore();
    await expect(createBusinessOperationQueryService(store).getFilterOptions(
      authorization({ canReadOperations: false }),
    )).rejects.toMatchObject({ code: 'OPERATIONS_FORBIDDEN' });
    expect(store.transactionCalls).toBe(0);
  });
});
