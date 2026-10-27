import type { SQL } from 'drizzle-orm';
import { PgDialect, type PgTransactionConfig } from 'drizzle-orm/pg-core';
import { Logger } from '@/lib/logger';
import {
  createBusinessOperationQueryService,
  type BusinessOperationsQueryInput,
  type BusinessQueryAuthorizationContext,
  type BusinessQueryExecutor,
  type BusinessQueryStore,
} from '@/lib/operations/business-query';
import type {
  BusinessOperationsMetric,
  BusinessOperationsMetricsEmitter,
} from '@/lib/operations/telemetry';

const dialect = new PgDialect();

class ShadowStore implements BusinessQueryStore {
  readonly statements: string[] = [];

  constructor(private readonly comparisonRow: Record<string, unknown>) {}

  async transaction<T>(
    callback: (transaction: BusinessQueryExecutor) => Promise<T>,
    _config: PgTransactionConfig,
  ): Promise<T> {
    return callback({
      execute: async <TRow extends Record<string, unknown>>(statement: SQL): Promise<TRow[]> => {
        const compiled = dialect.sqlToQuery(statement);
        this.statements.push(compiled.sql.toLowerCase());
        if (compiled.sql.includes('transaction_timestamp()')) {
          return [{
            queryTimestamp: new Date('2026-03-21T04:05:06.789Z'),
            calendarTimezone: 'Asia/Ho_Chi_Minh',
          }] as unknown as TRow[];
        }
        if (compiled.sql.includes('card_operation_metrics AS MATERIALIZED')) {
          return [{
            summary: {
              totalCases: 1,
              tokensProcessed: 30,
              totalCostUsd: '1.2',
              logicSuccessRate: null,
              aiExtractionRate: null,
              unpricedRequestCount: 0,
              costIncomplete: false,
            },
            breakdownCards: [],
            trendPoints: [],
            listItems: [],
            listTotal: '1',
          }] as unknown as TRow[];
        }
        if (compiled.sql.includes('shadow_source_totals')) {
          return [this.comparisonRow] as TRow[];
        }
        return [];
      },
    });
  }
}

class RecordingMetrics implements BusinessOperationsMetricsEmitter {
  readonly events: BusinessOperationsMetric[] = [];

  emit(metric: BusinessOperationsMetric): void {
    this.events.push(metric);
  }
}

const input: BusinessOperationsQueryInput = {
  range: 'today',
  profile: 'ALL',
  operationType: 'ALL',
  status: 'ALL',
  page: 1,
};

const authorization: BusinessQueryAuthorizationContext = {
  actorId: 'shadow-operator',
  actorRole: 'OPS',
  requestId: 'shadow-request-1',
  canReadOperations: true,
  allowedProfileIds: ['profile-a'],
  canReadInternalScope: true,
};

describe('Business Operations shadow comparison', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits one safe mismatch metric per aggregate measure without exposing shadow rows', async () => {
    const store = new ShadowStore({
      sourceRequestCount: '2',
      sourceTokenTotal: '30',
      sourceCostTotal: '1.2000000000',
      projectionRequestCount: '3',
      projectionTokenTotal: '31',
      projectionCostTotal: '1.3000000000',
    });
    const metrics = new RecordingMetrics();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const response = await createBusinessOperationQueryService(store, { metrics })
      .getDashboardSnapshot(input, authorization, { shadowRead: true });

    expect(warn).toHaveBeenCalledWith(
      'Business Operations shadow comparison mismatch',
      expect.objectContaining({
        requestId: 'shadow-request-1',
        actorId: 'shadow-operator',
        profileScopeCount: 1,
        preset: 'today',
        mismatchMeasures: ['request_count', 'token_total', 'cost_total'],
      }),
    );
    expect(metrics.events.filter((event) => (
      event.name === 'business_operations_snapshot_mismatch_total'
    ))).toEqual([
      expect.objectContaining({ value: 1, labels: { measure: 'request_count', preset: 'today' } }),
      expect.objectContaining({ value: 1, labels: { measure: 'token_total', preset: 'today' } }),
      expect.objectContaining({ value: 1, labels: { measure: 'cost_total', preset: 'today' } }),
    ]);

    const responseText = JSON.stringify(response);
    expect(responseText).not.toContain('sourceRequestCount');
    expect(responseText).not.toContain('projectionRequestCount');
    expect(responseText).not.toContain('shadow');
    expect(response.summary).toMatchObject({ tokensProcessed: 30, totalCostUsd: '1.2000000000' });

    const shadowSql = store.statements.find((statement) => statement.includes('shadow_source_totals'));
    expect(shadowSql).toContain('"operation"."deletedat" is null');
    expect(shadowSql).toContain('"operation"."hiddenfromoperations" = $');
    expect(shadowSql).toContain('join filtered_business_operations');
    expect(shadowSql).toContain('sum(projected.request_count)');
  });

  it.each([
    {
      label: 'request count',
      comparison: { projectionRequestCount: '3' },
      measure: 'request_count',
    },
    {
      label: 'token total',
      comparison: { projectionTokenTotal: '31' },
      measure: 'token_total',
    },
    {
      label: 'cost total',
      comparison: { projectionCostTotal: '1.3000000000' },
      measure: 'cost_total',
    },
  ] as const)('attributes only the exact $label mismatch', async ({ comparison, measure }) => {
    const store = new ShadowStore({
      sourceRequestCount: '2',
      sourceTokenTotal: '30',
      sourceCostTotal: '1.2000000000',
      projectionRequestCount: '2',
      projectionTokenTotal: '30',
      projectionCostTotal: '1.2000000000',
      ...comparison,
    });
    const metrics = new RecordingMetrics();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await createBusinessOperationQueryService(store, { metrics })
      .getDashboardSnapshot(input, authorization, { shadowRead: true });

    expect(warn).toHaveBeenCalledWith(
      'Business Operations shadow comparison mismatch',
      expect.objectContaining({ mismatchMeasures: [measure] }),
    );
    expect(metrics.events.filter((event) => (
      event.name === 'business_operations_snapshot_mismatch_total'
    ))).toEqual([
      expect.objectContaining({ value: 1, labels: { measure, preset: 'today' } }),
    ]);
  });

  it('treats equivalent decimal scales as equal and skips the shadow query when disabled', async () => {
    const matchingStore = new ShadowStore({
      sourceRequestCount: '2',
      sourceTokenTotal: '30',
      sourceCostTotal: '1.2',
      projectionRequestCount: '02',
      projectionTokenTotal: '030',
      projectionCostTotal: '1.2000000000',
    });
    const metrics = new RecordingMetrics();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = createBusinessOperationQueryService(matchingStore, { metrics });

    await service.getDashboardSnapshot(input, authorization, { shadowRead: true });
    expect(warn).not.toHaveBeenCalledWith(
      'Business Operations shadow comparison mismatch',
      expect.anything(),
    );
    expect(metrics.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'business_operations_snapshot_mismatch_total' }),
    ]));

    const disabledStore = new ShadowStore({});
    await createBusinessOperationQueryService(disabledStore)
      .getDashboardSnapshot(input, authorization);
    expect(disabledStore.statements.some((statement) => (
      statement.includes('shadow_source_totals')
    ))).toBe(false);
  });
});
