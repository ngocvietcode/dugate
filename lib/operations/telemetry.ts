import { createHash } from 'node:crypto';
import { Logger, type LogContext } from '@/lib/logger';

export const BUSINESS_OPERATIONS_SLOW_QUERY_MS = 5_000 as const;

export type BusinessOperationsQueryKind = 'dashboard' | 'detail' | 'filter_options';
export type BusinessOperationsMetricName =
  | 'business_operations_dashboard_requests_total'
  | 'business_operations_query_requests_total'
  | 'business_operations_dashboard_duration_ms'
  | 'business_operations_groups_returned'
  | 'business_operations_requests_scanned'
  | 'business_operations_unknown_state_total'
  | 'business_operations_unpriced_requests_total'
  | 'business_operations_missing_measurements_total'
  | 'business_operations_orphan_snapshots_total'
  | 'business_operations_snapshot_mismatch_total';

export interface BusinessOperationsMetric {
  name: BusinessOperationsMetricName;
  value: number;
  labels: Readonly<Record<string, string>>;
}

export interface BusinessOperationsMetricsEmitter {
  emit(metric: BusinessOperationsMetric): void;
}

const metricsLogger = new Logger({ service: 'business-operations-metrics' });

/**
 * Default process-local emission boundary. Infrastructure can replace this
 * interface with a StatsD/OpenTelemetry adapter without changing query code.
 */
export const businessOperationsMetrics: BusinessOperationsMetricsEmitter = {
  emit(metric) {
    if (process.env.NODE_ENV === 'test') return;
    metricsLogger.info('Business Operations operational metric', {
      metricName: metric.name,
      metricValue: metric.value,
      metricLabels: metric.labels,
    });
  },
};

export const businessOperationsLogger = new Logger({
  service: 'business-operations-dashboard',
});

/** One-way, bounded fingerprint for references/search terms in server logs. */
export function fingerprintBusinessValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

export function profileScopeCount(allowedProfileIds: readonly string[] | null): number | 'all' {
  return allowedProfileIds === null ? 'all' : new Set(allowedProfileIds).size;
}

export function emitBusinessOperationsMetric(
  emitter: BusinessOperationsMetricsEmitter,
  name: BusinessOperationsMetricName,
  value: number,
  labels: Readonly<Record<string, string>>,
): void {
  if (!Number.isFinite(value) || value < 0) return;
  emitter.emit({ name, value, labels: { ...labels } });
}

export function safeBusinessOperationsFailure(error: unknown): LogContext {
  const chain = readErrorChain(error);
  const timeout = chain.some(({ name, code }) => name === 'AbortError' || code === '57014');
  const businessCode = readStringProperty(error, 'code');
  const databaseCode = chain.map(({ code }) => code).find((code) => (
    typeof code === 'string' && /^[A-Z0-9]{2,16}$/.test(code)
  ));

  return {
    outcome: timeout ? 'timeout' : 'failure',
    timeout,
    failureCode: timeout ? 'DASHBOARD_TIMEOUT' : businessCode ?? 'DASHBOARD_QUERY_FAILED',
    ...(databaseCode ? { databaseErrorCode: databaseCode } : {}),
  };
}

function readStringProperty(value: unknown, property: string): string | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === 'string' && /^[A-Z0-9_]{2,64}$/.test(candidate)
    ? candidate
    : null;
}

function readErrorChain(error: unknown): Array<{ name?: unknown; code?: unknown }> {
  const chain: Array<{ name?: unknown; code?: unknown }> = [];
  const visited = new Set<unknown>();
  let current = error;

  while (current !== null && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { name?: unknown; code?: unknown; cause?: unknown };
    chain.push({ name: candidate.name, code: candidate.code });
    current = candidate.cause;
  }

  return chain;
}

export interface BusinessOperationsRouteTelemetry {
  kind: BusinessOperationsQueryKind;
  requestId: string;
  durationMs: number;
  outcome: 'success' | 'failure' | 'timeout';
  actorId?: string;
  actorRole?: string;
  profileScopeCount?: number | 'all';
  preset?: string;
  timezone?: string;
  page?: number;
  resultCount?: number;
  failureCode?: string;
  retryable?: boolean;
}

export function recordBusinessOperationsRoute(
  telemetry: BusinessOperationsRouteTelemetry,
  emitter: BusinessOperationsMetricsEmitter = businessOperationsMetrics,
): void {
  const context: LogContext = {
    routeKind: telemetry.kind,
    requestId: telemetry.requestId,
    actorId: telemetry.actorId,
    actorRole: telemetry.actorRole,
    profileScopeCount: telemetry.profileScopeCount,
    preset: telemetry.preset,
    timezone: telemetry.timezone,
    durationMs: Math.max(0, Math.round(telemetry.durationMs)),
    page: telemetry.page,
    resultCount: telemetry.resultCount,
    outcome: telemetry.outcome,
    failureCode: telemetry.failureCode,
    retryable: telemetry.retryable,
  };
  const routeLogger = businessOperationsLogger.child({
    requestId: telemetry.requestId,
    service: 'business-operations-dashboard',
  });

  if (telemetry.outcome === 'success') {
    routeLogger.info('Business Operations API request completed', context);
  } else {
    routeLogger.error('Business Operations API request failed', context);
  }

  emitBusinessOperationsMetric(
    emitter,
    telemetry.kind === 'dashboard'
      ? 'business_operations_dashboard_requests_total'
      : 'business_operations_query_requests_total',
    1,
    {
      queryKind: telemetry.kind,
      outcome: telemetry.outcome,
      ...(telemetry.preset ? { preset: telemetry.preset } : {}),
    },
  );
}
