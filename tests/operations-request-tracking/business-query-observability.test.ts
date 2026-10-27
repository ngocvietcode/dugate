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
import {
  fingerprintBusinessValue,
  type BusinessOperationsMetric,
  type BusinessOperationsMetricsEmitter,
} from '@/lib/operations/telemetry';

const dialect = new PgDialect();
const QUERY_TIMESTAMP = new Date('2026-03-21T04:05:06.789Z');
const SENSITIVE_SEARCH = 'client-reference-PAYROLL-SECRET-42';
const SENSITIVE_ERROR = 'SELECT outputContent, errorMessage WHERE secret = payroll-document';

class ObservabilityStore implements BusinessQueryStore {
  constructor(
    private readonly dashboardRow: Record<string, unknown>,
    private readonly aggregateError?: Error,
  ) {}

  async transaction<T>(
    callback: (transaction: BusinessQueryExecutor) => Promise<T>,
    _config: PgTransactionConfig,
  ): Promise<T> {
    const executor: BusinessQueryExecutor = {
      execute: async <TRow extends Record<string, unknown>>(statement: SQL): Promise<TRow[]> => {
        const compiled = dialect.sqlToQuery(statement);
        if (compiled.sql.includes('transaction_timestamp()')) {
          return [{
            queryTimestamp: QUERY_TIMESTAMP,
            calendarTimezone: 'Asia/Ho_Chi_Minh',
          }] as unknown as TRow[];
        }
        if (compiled.sql.includes('card_operation_metrics AS MATERIALIZED')) {
          if (this.aggregateError) throw this.aggregateError;
          return [this.dashboardRow] as unknown as TRow[];
        }
        return [];
      },
    };
    return callback(executor);
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
  query: SENSITIVE_SEARCH,
  searchMode: 'contains',
  page: 3,
};

const authorization: BusinessQueryAuthorizationContext = {
  actorId: 'operator-observability',
  actorRole: 'OPS',
  requestId: 'observability-request-1',
  canReadOperations: true,
  allowedProfileIds: ['profile-a', 'profile-b'],
  canReadInternalScope: true,
};

const dashboardRow = {
  summary: {
    totalCases: 7,
    tokensProcessed: 100,
    totalCostUsd: '1.25',
    logicSuccessRate: 100,
    aiExtractionRate: null,
    unpricedRequestCount: 4,
    costIncomplete: true,
  },
  breakdownCards: [],
  trendPoints: [],
  listItems: [],
  listTotal: '7',
  scannedRequestCount: '31',
  unknownStateCount: '2',
  missingMeasurementCount: '3',
  telemetryUnpricedRequestCount: '4',
  orphanSnapshotCount: '5',
};

describe('Business Operations query observability', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs successful query context and emits complete non-sensitive operational metrics', async () => {
    const metrics = new RecordingMetrics();
    const info = jest.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const now = jest.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(321);

    await createBusinessOperationQueryService(
      new ObservabilityStore(dashboardRow),
      { metrics, now },
    ).getDashboardSnapshot(input, authorization);

    expect(info).toHaveBeenCalledWith(
      'Business Operations query completed',
      expect.objectContaining({
        queryKind: 'dashboard',
        requestId: 'observability-request-1',
        actorId: 'operator-observability',
        actorRole: 'OPS',
        profileScopeCount: 2,
        preset: 'today',
        timezone: 'Asia/Ho_Chi_Minh',
        durationMs: 221,
        page: 3,
        resultCount: 7,
        scannedRequestCount: 31,
        unknownStateCount: 2,
        missingMeasurementCount: 3,
        unpricedRequestCount: 4,
        orphanSnapshotCount: 5,
        searchHash: fingerprintBusinessValue(SENSITIVE_SEARCH),
        outcome: 'success',
      }),
    );
    expect(warn).not.toHaveBeenCalledWith(
      'Slow Business Operations query completed',
      expect.anything(),
    );
    expect(error).not.toHaveBeenCalled();
    expect(metrics.events.map(({ name, value, labels }) => ({ name, value, labels }))).toEqual([
      {
        name: 'business_operations_dashboard_duration_ms',
        value: 221,
        labels: { queryKind: 'dashboard', preset: 'today' },
      },
      {
        name: 'business_operations_groups_returned',
        value: 7,
        labels: { queryKind: 'dashboard', preset: 'today' },
      },
      {
        name: 'business_operations_requests_scanned',
        value: 31,
        labels: { queryKind: 'dashboard', preset: 'today' },
      },
      {
        name: 'business_operations_unknown_state_total',
        value: 2,
        labels: { queryKind: 'dashboard', preset: 'today' },
      },
      {
        name: 'business_operations_missing_measurements_total',
        value: 3,
        labels: { queryKind: 'dashboard', preset: 'today' },
      },
      {
        name: 'business_operations_unpriced_requests_total',
        value: 4,
        labels: { queryKind: 'dashboard', preset: 'today' },
      },
      {
        name: 'business_operations_orphan_snapshots_total',
        value: 5,
        labels: { queryKind: 'dashboard', preset: 'today' },
      },
    ]);

    const telemetryText = JSON.stringify({ logs: info.mock.calls, metrics: metrics.events });
    expect(telemetryText).not.toContain(SENSITIVE_SEARCH);
    expect(telemetryText).not.toContain('PAYROLL-SECRET');
    expect(telemetryText).not.toContain('clientReference');
    expect(telemetryText).not.toContain('outputContent');
  });

  it('logs a slow query with hashed search and emits only non-sensitive metric labels', async () => {
    const metrics = new RecordingMetrics();
    const info = jest.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const now = jest.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(5_201);

    await createBusinessOperationQueryService(
      new ObservabilityStore(dashboardRow),
      { metrics, now },
    ).getDashboardSnapshot(input, authorization);

    expect(info).not.toHaveBeenCalledWith(
      'Business Operations query completed',
      expect.anything(),
    );
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Slow Business Operations query completed',
      expect.objectContaining({
        requestId: 'observability-request-1',
        actorId: 'operator-observability',
        actorRole: 'OPS',
        profileScopeCount: 2,
        preset: 'today',
        timezone: 'Asia/Ho_Chi_Minh',
        durationMs: 5_101,
        page: 3,
        resultCount: 7,
        scannedRequestCount: 31,
        unknownStateCount: 2,
        missingMeasurementCount: 3,
        unpricedRequestCount: 4,
        orphanSnapshotCount: 5,
        searchHash: fingerprintBusinessValue(SENSITIVE_SEARCH),
        outcome: 'success',
      }),
    );

    const telemetryText = JSON.stringify({ logs: warn.mock.calls, metrics: metrics.events });
    expect(telemetryText).not.toContain(SENSITIVE_SEARCH);
    expect(telemetryText).not.toContain('PAYROLL-SECRET');
    for (const event of metrics.events) {
      expect(event.labels).toEqual({ queryKind: 'dashboard', preset: 'today' });
      expect(Object.keys(event.labels)).not.toEqual(expect.arrayContaining([
        'search',
        'reference',
        'requestId',
        'actorId',
        'profileId',
        'errorMessage',
      ]));
    }
  });

  it('records a sanitized non-timeout failure without source messages or payload labels', async () => {
    const metrics = new RecordingMetrics();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const failure = new Error(SENSITIVE_ERROR);
    const now = jest.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_500);

    await expect(createBusinessOperationQueryService(
      new ObservabilityStore(dashboardRow, failure),
      { metrics, now },
    ).getDashboardSnapshot(input, authorization)).rejects.toBe(failure);

    expect(errorLog).toHaveBeenCalledWith(
      'Business Operations query failed',
      expect.objectContaining({
        requestId: 'observability-request-1',
        outcome: 'failure',
        timeout: false,
        failureCode: 'DASHBOARD_QUERY_FAILED',
        durationMs: 500,
      }),
    );
    expect(metrics.events).toEqual([expect.objectContaining({
      name: 'business_operations_dashboard_duration_ms',
      value: 500,
      labels: { queryKind: 'dashboard', outcome: 'failure', preset: 'today' },
    })]);

    const telemetryText = JSON.stringify({ logs: errorLog.mock.calls, metrics: metrics.events });
    expect(telemetryText).not.toContain(SENSITIVE_ERROR);
    expect(telemetryText).not.toContain(SENSITIVE_SEARCH);
    expect(telemetryText).not.toContain('payroll-document');
    expect(telemetryText).not.toContain('outputContent');
    expect(telemetryText).not.toContain('errorMessage');
  });

  it('records timeout outcome without logging database messages or payload text', async () => {
    const metrics = new RecordingMetrics();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const timeout = Object.assign(new Error(SENSITIVE_ERROR), { code: '57014' });
    const now = jest.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(30_000);

    await expect(createBusinessOperationQueryService(
      new ObservabilityStore(dashboardRow, timeout),
      { metrics, now },
    ).getDashboardSnapshot(input, authorization)).rejects.toBe(timeout);

    expect(errorLog).toHaveBeenCalledWith(
      'Business Operations query failed',
      expect.objectContaining({
        requestId: 'observability-request-1',
        outcome: 'timeout',
        timeout: true,
        failureCode: 'DASHBOARD_TIMEOUT',
        databaseErrorCode: '57014',
        durationMs: 29_000,
      }),
    );
    const telemetryText = JSON.stringify({ logs: errorLog.mock.calls, metrics: metrics.events });
    expect(telemetryText).not.toContain(SENSITIVE_ERROR);
    expect(telemetryText).not.toContain('outputContent');
    expect(telemetryText).not.toContain('errorMessage');
    expect(metrics.events).toEqual([expect.objectContaining({
      name: 'business_operations_dashboard_duration_ms',
      value: 29_000,
      labels: { queryKind: 'dashboard', outcome: 'timeout', preset: 'today' },
    })]);
  });
});
