import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db';
import {
  apiKeys,
  appSettings,
  businessOperationStatusSnapshots,
  operations,
} from '@/lib/db/schema';
import { Logger } from '@/lib/logger';
import {
  businessGroupKeyForIdentity,
  decodeBusinessOperationToken,
  encodeBusinessOperationToken,
  type BusinessIdentity,
} from './business-key';
import {
  DEFAULT_OPS_CALENDAR_TIMEZONE,
  isValidIanaTimezone,
} from '@/lib/settings';
import {
  buildCalendarBuckets,
  CALENDAR_PRESETS,
  resolveTimeWindow,
  type CalendarPreset,
  type ResolvedTimeWindow,
} from './time-window';
import type { BusinessStatus } from './status';
import {
  BUSINESS_OPERATIONS_SLOW_QUERY_MS,
  businessOperationsLogger,
  businessOperationsMetrics,
  emitBusinessOperationsMetric,
  fingerprintBusinessValue,
  profileScopeCount,
  safeBusinessOperationsFailure,
  type BusinessOperationsMetricsEmitter,
  type BusinessOperationsQueryKind,
} from './telemetry';

export const INTERNAL_PROFILE_SCOPE = '__internal__' as const;
export const ALL_FILTER_VALUE = 'ALL' as const;
export const BUSINESS_QUERY_STATEMENT_TIMEOUT_MS = 29_000 as const;

export const BUSINESS_QUERY_TRANSACTION_CONFIG = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
} as const satisfies PgTransactionConfig;

export const BUSINESS_QUERY_SEARCH_MODES = ['exact', 'contains'] as const;
export type BusinessQuerySearchMode = (typeof BUSINESS_QUERY_SEARCH_MODES)[number];
export const BUSINESS_QUERY_LIST_SORTS = ['recent', 'duration', 'tokens', 'cost'] as const;
export type BusinessQueryListSort = 'recent' | 'duration' | 'tokens' | 'cost';
export type BusinessQueryStatusFilter = BusinessStatus | typeof ALL_FILTER_VALUE;

/**
 * Route-independent dashboard input. HTTP parsing remains at the API boundary;
 * this service validates again before opening a database transaction.
 */
export interface BusinessOperationsQueryInput {
  range: CalendarPreset;
  profile: string;
  operationType: string;
  status: BusinessQueryStatusFilter;
  query?: string | null;
  searchMode?: BusinessQuerySearchMode | null;
  page?: number;
  sort?: BusinessQueryListSort | null;
}

export interface ValidatedBusinessOperationsQueryInput {
  range: CalendarPreset;
  profile: string;
  operationType: string;
  status: BusinessQueryStatusFilter;
  search: {
    query: string;
    mode: BusinessQuerySearchMode;
  } | null;
  page: number;
  sort: BusinessQueryListSort;
}

export interface BusinessOperationsDashboardSummary {
  totalCases: number;
  tokensProcessed: number;
  totalCostUsd: string;
  logicSuccessRate: number | null;
  aiExtractionRate: number | null;
  p95DurationSeconds: number | null;
  unpricedRequestCount: number;
  costIncomplete: boolean;
}

export interface BusinessOperationsDashboardBreakdownCard {
  profileScope: { id: string | null; name: string };
  operationType: string;
  businessOperationCount: number;
  succeededCount: number;
  failedCount: number;
  /** Percentage of all represented business operations that succeeded. */
  successPercentage: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  averageTokensPerBusinessOperation: number;
  averageDurationSeconds: number | null;
  maxDurationOperationIdentifier: string | null;
  maxTokenOperationIdentifier: string;
  maxDurationOperationToken: string | null;
  maxTokenOperationToken: string | null;
  maxDurationSeconds: number | null;
  maxTokenCount: number;
  unpricedRequestCount: number;
  costIncomplete: boolean;
}

export interface BusinessOperationsDashboardTrendPoint {
  unit: 'hour' | 'day';
  localKey: string;
  occurrence: number;
  start: string;
  end: string;
  startInclusive: true;
  endInclusive: boolean;
  clippedStart: boolean;
  clippedEnd: boolean;
  counts: Record<'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED', number>;
  total: number;
}

export interface BusinessOperationsDashboardListItem {
  token: string;
  operationIdentifier: string;
  normalizedReference: string | null;
  profileScope: { id: string | null; name: string };
  operationTypes: string[];
  businessStatus: BusinessStatus;
  invalidData: boolean;
  requestCount: number;
  startTime: string;
  updatedTime: string;
  endTime: string | null;
  totalTokens: number;
  totalCostUsd: string;
  durationSeconds: number | null;
  unpricedRequestCount: number;
  missingData: boolean;
}

export interface ConstituentRequestItem {
  id: string;
  operationType: string | null;
  state: string;
  startedAt: string;
  completedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  missingData: boolean;
  unpricedCost: boolean;
}

export interface BusinessOperationDetailResponse {
  queryTimestamp: string;
  operation: BusinessOperationsDashboardListItem & {
    endTime: string | null;
    durationSeconds: number | null;
  };
  requests: {
    items: ConstituentRequestItem[];
    page: number;
    pageSize: 100;
    total: number;
    totalPages: number;
  };
}

export interface BusinessOperationFilterOptions {
  profiles: Array<{ id: string; name: string }>;
  operationTypes: string[];
  hasInternalScope: boolean;
}

export interface BusinessOperationsDashboardResponse {
  queryTimestamp: string;
  calendarTimezone: string;
  resolvedWindow: {
    start: string;
    end: string;
    startInclusive: true;
    endInclusive: boolean;
    preset: CalendarPreset;
  };
  appliedFilter: ValidatedBusinessOperationsQueryInput;
  summary: BusinessOperationsDashboardSummary;
  breakdownCards: BusinessOperationsDashboardBreakdownCard[];
  trend: {
    bucket: 'hour' | 'day';
    points: BusinessOperationsDashboardTrendPoint[];
  };
  list: {
    items: BusinessOperationsDashboardListItem[];
    page: number;
    pageSize: 50;
    total: number;
    totalPages: number;
  };
}

/**
 * Authorization is captured by the caller after its session/capability lookup.
 * `allowedProfileIds=null` means all profile-backed scopes. Internal scope is an
 * explicit policy bit because it is not a Profile assignment.
 */
export interface BusinessQueryAuthorizationContext {
  actorId: string;
  actorRole?: string;
  requestId?: string;
  canReadOperations: boolean;
  allowedProfileIds: readonly string[] | null;
  canReadInternalScope: boolean;
}

export interface AuthorizedRequestProjectionRow {
  request_id: string;
  business_group_key: string;
  profile_scope_id: string | null;
  normalized_reference: string | null;
  operation_type: string | null;
  state: string;
  logic_result: string | null;
  extraction_result: string | null;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: string;
  input_tokens_missing: boolean;
  output_tokens_missing: boolean;
  cost_missing: boolean;
  has_unpriced_cost: boolean;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface BusinessQueryExecutor {
  execute<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: SQL,
  ): Promise<TRow[]>;
}

export interface BusinessQueryStore {
  transaction<T>(
    callback: (transaction: BusinessQueryExecutor) => Promise<T>,
    config: PgTransactionConfig,
  ): Promise<T>;
}

export interface BusinessQuerySnapshotContext {
  transaction: BusinessQueryExecutor;
  queryTimestamp: Date;
  calendarTimezone: string;
  resolvedWindow: ResolvedTimeWindow;
  appliedFilter: ValidatedBusinessOperationsQueryInput;
  authorization: BusinessQueryAuthorizationContext;
  /**
   * SQL fragment named `authorized_requests`. Every grouping, search, summary,
   * list, and detail query must derive from this CTE so unauthorized/excluded
   * source rows can never affect grouping or disclose existence.
   */
  authorizedRequestsCte: SQL;
}

export type BusinessQueryErrorCode =
  | 'OPERATIONS_FORBIDDEN'
  | 'PROFILE_SCOPE_FORBIDDEN'
  | 'INVALID_FILTER'
  | 'INVALID_SEARCH'
  | 'INVALID_OPERATION_TOKEN'
  | 'BUSINESS_OPERATION_NOT_FOUND'
  | 'SNAPSHOT_METADATA_INVALID';

export class BusinessQueryError extends Error {
  constructor(
    readonly code: BusinessQueryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessQueryError';
  }
}

export interface BusinessOperationQueryService {
  withSnapshot<T>(
    input: BusinessOperationsQueryInput,
    authorization: BusinessQueryAuthorizationContext,
    callback: (context: BusinessQuerySnapshotContext) => Promise<T>,
  ): Promise<T>;
  getDashboardSnapshot(
    input: BusinessOperationsQueryInput,
    authorization: BusinessQueryAuthorizationContext,
    options?: BusinessDashboardExecutionOptions,
  ): Promise<BusinessOperationsDashboardResponse>;
  getBusinessOperationDetail(
    tokenOrIdentity: string | BusinessIdentity,
    page: number,
    authorization: BusinessQueryAuthorizationContext,
  ): Promise<BusinessOperationDetailResponse>;
  getFilterOptions(
    authorization: BusinessQueryAuthorizationContext,
  ): Promise<BusinessOperationFilterOptions>;
}

interface SnapshotMetadataRow extends Record<string, unknown> {
  queryTimestamp: Date | string;
  calendarTimezone: string | null;
}

interface RawDashboardListItem extends Omit<BusinessOperationsDashboardListItem, 'token'> {
  profileScopeId: string | null;
  standaloneRequestId: string;
}

interface RawExtremumOperation {
  identifier: string;
  normalizedReference: string | null;
  profileScopeId: string | null;
  standaloneRequestId: string;
}

function extremumIdentity(op: RawExtremumOperation): BusinessIdentity {
  return op.normalizedReference === null
    ? { kind: 'standalone', requestId: op.standaloneRequestId }
    : {
      kind: 'referenced',
      scope: op.profileScopeId === null
        ? { kind: 'internal' }
        : { kind: 'profile', apiKeyId: op.profileScopeId },
      normalizedReference: op.normalizedReference,
    };
}

interface RawDashboardBreakdownCard extends Omit<
  BusinessOperationsDashboardBreakdownCard,
  | 'maxDurationOperationIdentifier'
  | 'maxTokenOperationIdentifier'
  | 'maxDurationOperationToken'
  | 'maxTokenOperationToken'
> {
  maxDurationOperation: RawExtremumOperation | null;
  maxTokenOperation: RawExtremumOperation | null;
}

interface BusinessQueryTelemetryCounters {
  resultCount: number;
  scannedRequestCount: number;
  unknownStateCount: number;
  missingMeasurementCount: number;
  unpricedRequestCount: number;
  orphanSnapshotCount: number;
}

interface DashboardSnapshotRow extends Record<string, unknown> {
  summary: BusinessOperationsDashboardSummary;
  breakdownCards: RawDashboardBreakdownCard[];
  trendPoints: BusinessOperationsDashboardTrendPoint[];
  listItems: RawDashboardListItem[];
  listTotal: number | string;
  scannedRequestCount?: number | string;
  unknownStateCount?: number | string;
  missingMeasurementCount?: number | string;
  telemetryUnpricedRequestCount?: number | string;
  orphanSnapshotCount?: number | string;
}

interface DashboardSnapshotExecution {
  response: BusinessOperationsDashboardResponse;
  counters: BusinessQueryTelemetryCounters;
}

interface RawBusinessOperationDetailItem
  extends Omit<
    BusinessOperationDetailResponse['operation'],
    'token' | 'startTime' | 'updatedTime' | 'endTime'
  > {
  startTime: string | Date;
  updatedTime: string | Date;
  endTime: string | Date | null;
}

interface RawConstituentRequestItem
  extends Omit<ConstituentRequestItem, 'startedAt' | 'completedAt'> {
  startedAt: string | Date;
  completedAt: string | Date | null;
}

interface BusinessOperationDetailSnapshotRow extends Record<string, unknown> {
  queryTimestamp: Date | string;
  operation: RawBusinessOperationDetailItem | null;
  requestItems: RawConstituentRequestItem[];
  requestTotal: number | string;
  unknownStateCount?: number | string;
  missingMeasurementCount?: number | string;
  telemetryUnpricedRequestCount?: number | string;
  orphanSnapshotCount?: number | string;
}

interface BusinessOperationFilterOptionsRow extends Record<string, unknown> {
  profiles: Array<{ id: string; name: string }>;
  operationTypes: string[];
  hasInternalScope: boolean;
  scannedRequestCount?: number | string;
  unknownStateCount?: number | string;
  missingMeasurementCount?: number | string;
  telemetryUnpricedRequestCount?: number | string;
  orphanSnapshotCount?: number | string;
}

export interface BusinessQueryObservability {
  metrics?: BusinessOperationsMetricsEmitter;
  now?: () => number;
}

export interface BusinessDashboardExecutionOptions {
  /** Run an internal reconciliation query; its rows never enter the response. */
  shadowRead?: boolean;
}

export type BusinessShadowMismatchMeasure = 'request_count' | 'token_total' | 'cost_total';

interface BusinessShadowComparisonRow extends Record<string, unknown> {
  sourceRequestCount: number | string;
  sourceTokenTotal: number | string;
  sourceCostTotal: string;
  projectionRequestCount: number | string;
  projectionTokenTotal: number | string;
  projectionCostTotal: string;
}

const logger = new Logger({ service: 'business-operations-query' });
const VALID_STATUS_FILTERS: readonly BusinessQueryStatusFilter[] = [
  ALL_FILTER_VALUE,
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED',
  'N/A',
];

const drizzleBusinessQueryStore: BusinessQueryStore = {
  async transaction<T>(
    callback: (transaction: BusinessQueryExecutor) => Promise<T>,
    config: PgTransactionConfig,
  ): Promise<T> {
    return db.transaction(async (transaction) => callback({
      async execute<TRow extends Record<string, unknown>>(statement: SQL): Promise<TRow[]> {
        return transaction.execute(statement) as unknown as Promise<TRow[]>;
      },
    }), config);
  },
};

/**
 * Validates and normalizes all filters without touching the database. Profile
 * authorization is intentionally separate and is also performed before a
 * transaction starts.
 */
export function validateBusinessOperationsQueryInput(
  input: BusinessOperationsQueryInput,
): ValidatedBusinessOperationsQueryInput {
  if (!CALENDAR_PRESETS.includes(input.range)) {
    throw new BusinessQueryError('INVALID_FILTER', 'Unsupported calendar range');
  }
  if (!VALID_STATUS_FILTERS.includes(input.status)) {
    throw new BusinessQueryError('INVALID_FILTER', 'Unsupported business status');
  }

  const profile = normalizeRequiredFilter(input.profile, 'profile');
  const operationType = normalizeRequiredFilter(input.operationType, 'operationType');
  const page = input.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new BusinessQueryError('INVALID_FILTER', 'Page must be a positive integer');
  }

  const sort = input.sort ?? 'recent';
  if (!BUSINESS_QUERY_LIST_SORTS.includes(sort)) {
    throw new BusinessQueryError('INVALID_FILTER', 'Unsupported list sort');
  }

  const rawQuery = input.query;
  let search: ValidatedBusinessOperationsQueryInput['search'] = null;
  if (rawQuery !== undefined && rawQuery !== null) {
    const query = rawQuery.trim();
    const queryLength = Array.from(query).length;
    if (queryLength === 0 || queryLength > 256) {
      throw new BusinessQueryError(
        'INVALID_SEARCH',
        queryLength === 0 ? 'Search query must not be blank' : 'Search query exceeds 256 characters',
      );
    }

    const mode = input.searchMode ?? 'exact';
    if (!BUSINESS_QUERY_SEARCH_MODES.includes(mode)) {
      throw new BusinessQueryError('INVALID_FILTER', 'Unsupported search mode');
    }
    search = { query, mode };
  } else if (input.searchMode !== undefined && input.searchMode !== null) {
    if (!BUSINESS_QUERY_SEARCH_MODES.includes(input.searchMode)) {
      throw new BusinessQueryError('INVALID_FILTER', 'Unsupported search mode');
    }
  }

  return {
    range: input.range,
    profile,
    operationType,
    status: input.status,
    search,
    page,
    sort,
  };
}

/** Fail closed on capability and selected profile before any aggregate query. */
export function validateBusinessQueryAuthorization(
  input: ValidatedBusinessOperationsQueryInput,
  authorization: BusinessQueryAuthorizationContext,
): BusinessQueryAuthorizationContext {
  const validatedAuthorization = validateBusinessQueryAuthorizationScope(authorization);
  const { allowedProfileIds } = validatedAuthorization;

  if (input.profile === INTERNAL_PROFILE_SCOPE && !validatedAuthorization.canReadInternalScope) {
    throw new BusinessQueryError(
      'PROFILE_SCOPE_FORBIDDEN',
      'Internal Operations scope is not available to this actor',
    );
  }

  if (
    input.profile !== ALL_FILTER_VALUE
    && input.profile !== INTERNAL_PROFILE_SCOPE
    && allowedProfileIds !== null
    && !allowedProfileIds.includes(input.profile)
  ) {
    throw new BusinessQueryError(
      'PROFILE_SCOPE_FORBIDDEN',
      'Selected Profile is not assigned to this actor',
    );
  }

  return validatedAuthorization;
}

/** Normalizes the row-level scope used by dashboard, detail, and metadata reads. */
export function validateBusinessQueryAuthorizationScope(
  authorization: BusinessQueryAuthorizationContext,
): BusinessQueryAuthorizationContext {
  if (!authorization.canReadOperations) {
    throw new BusinessQueryError('OPERATIONS_FORBIDDEN', 'Operations read access is required');
  }

  const actorId = authorization.actorId.trim();
  if (!actorId) {
    throw new BusinessQueryError('OPERATIONS_FORBIDDEN', 'Authenticated actor is required');
  }

  const allowedProfileIds = authorization.allowedProfileIds === null
    ? null
    : [...new Set(authorization.allowedProfileIds.map((id) => id.trim()))];
  if (allowedProfileIds?.some((id) => id.length === 0)) {
    throw new BusinessQueryError('OPERATIONS_FORBIDDEN', 'Authorization profile scope is invalid');
  }

  return {
    actorId,
    ...(authorization.actorRole ? { actorRole: authorization.actorRole.trim() } : {}),
    ...(authorization.requestId ? { requestId: authorization.requestId } : {}),
    canReadOperations: true,
    allowedProfileIds,
    canReadInternalScope: authorization.canReadInternalScope,
  };
}

/**
 * Builds the common pre-grouping boundary. It deliberately selects no document,
 * pipeline, prompt, output, extracted-content, progress-log, or webhook fields.
 */
export function buildAuthorizedRequestsCte(
  authorization: BusinessQueryAuthorizationContext,
): SQL {
  if (!authorization.canReadOperations) {
    throw new BusinessQueryError('OPERATIONS_FORBIDDEN', 'Operations read access is required');
  }

  const profilePredicate = buildAuthorizedProfilePredicate(authorization);
  const eligibleAndAuthorized = and(
    isNull(operations.deletedAt),
    eq(operations.hiddenFromOperations, false),
    profilePredicate,
  );

  return sql`authorized_requests AS MATERIALIZED (
    SELECT
      ${operations.id} AS request_id,
      ${operations.businessGroupKey} AS business_group_key,
      ${operations.apiKeyId} AS profile_scope_id,
      NULLIF(BTRIM(${operations.clientReference}), '') AS normalized_reference,
      ${operations.endpointSlug} AS operation_type,
      ${operations.state} AS state,
      ${operations.logicResult} AS logic_result,
      ${operations.extractionResult} AS extraction_result,
      ${operations.totalInputTokens} AS input_tokens,
      ${operations.totalOutputTokens} AS output_tokens,
      ${operations.totalCostUsd} AS total_cost_usd,
      ${operations.inputTokensMissing} AS input_tokens_missing,
      ${operations.outputTokensMissing} AS output_tokens_missing,
      ${operations.costMissing} AS cost_missing,
      ${operations.hasUnpricedCost} AS has_unpriced_cost,
      ${operations.createdAt} AS created_at,
      ${operations.updatedAt} AS updated_at,
      ${operations.completedAt} AS completed_at
    FROM ${operations}
    WHERE ${eligibleAndAuthorized}
  )`;
}

/**
 * Detail-only variant of the authorization boundary. The two error fields are
 * required operational metadata; source documents, pipelines, prompts, and
 * generated output remain outside the projection.
 */
export function buildAuthorizedDetailRequestsCte(
  authorization: BusinessQueryAuthorizationContext,
): SQL {
  if (!authorization.canReadOperations) {
    throw new BusinessQueryError('OPERATIONS_FORBIDDEN', 'Operations read access is required');
  }

  const eligibleAndAuthorized = and(
    isNull(operations.deletedAt),
    eq(operations.hiddenFromOperations, false),
    buildAuthorizedProfilePredicate(authorization),
  );

  return sql`authorized_requests AS MATERIALIZED (
    SELECT
      ${operations.id} AS request_id,
      ${operations.businessGroupKey} AS business_group_key,
      ${operations.apiKeyId} AS profile_scope_id,
      NULLIF(BTRIM(${operations.clientReference}), '') AS normalized_reference,
      ${operations.endpointSlug} AS operation_type,
      ${operations.state} AS state,
      ${operations.totalInputTokens} AS input_tokens,
      ${operations.totalOutputTokens} AS output_tokens,
      ${operations.totalCostUsd} AS total_cost_usd,
      ${operations.inputTokensMissing} AS input_tokens_missing,
      ${operations.outputTokensMissing} AS output_tokens_missing,
      ${operations.costMissing} AS cost_missing,
      ${operations.hasUnpricedCost} AS has_unpriced_cost,
      ${operations.errorCode} AS error_code,
      ${operations.errorMessage} AS error_message,
      ${operations.createdAt} AS created_at,
      ${operations.updatedAt} AS updated_at,
      ${operations.completedAt} AS completed_at
    FROM ${operations}
    WHERE ${eligibleAndAuthorized}
  )`;
}

export function createBusinessOperationQueryService(
  store: BusinessQueryStore = drizzleBusinessQueryStore,
  observability: BusinessQueryObservability = {},
): BusinessOperationQueryService {
  const metrics = observability.metrics ?? businessOperationsMetrics;
  const now = observability.now ?? Date.now;

  const service: BusinessOperationQueryService = {
    async withSnapshot<T>(
      input: BusinessOperationsQueryInput,
      authorization: BusinessQueryAuthorizationContext,
      callback: (context: BusinessQuerySnapshotContext) => Promise<T>,
    ): Promise<T> {
      // Capability, filter, search, and selected-profile failures short-circuit
      // before opening a transaction or executing an aggregate query.
      if (!authorization.canReadOperations) {
        throw new BusinessQueryError('OPERATIONS_FORBIDDEN', 'Operations read access is required');
      }
      const appliedFilter = validateBusinessOperationsQueryInput(input);
      const validatedAuthorization = validateBusinessQueryAuthorization(
        appliedFilter,
        authorization,
      );
      const authorizedRequestsCte = buildAuthorizedRequestsCte(validatedAuthorization);

      return store.transaction(async (transaction) => {
        await transaction.execute(
          sql.raw(`SET LOCAL statement_timeout = '${BUSINESS_QUERY_STATEMENT_TIMEOUT_MS}ms'`),
        );

        const metadataRows = await transaction.execute<SnapshotMetadataRow>(sql`
          SELECT
            transaction_timestamp() AS "queryTimestamp",
            COALESCE(
              (
                SELECT ${appSettings.value}
                FROM ${appSettings}
                WHERE ${appSettings.key} = 'ops_calendar_timezone'
                LIMIT 1
              ),
              ${DEFAULT_OPS_CALENDAR_TIMEZONE}
            ) AS "calendarTimezone"
        `);
        const metadata = parseSnapshotMetadata(metadataRows);
        const resolvedWindow = resolveTimeWindow(
          appliedFilter.range,
          metadata.queryTimestamp,
          metadata.calendarTimezone,
        );

        return callback({
          transaction,
          queryTimestamp: metadata.queryTimestamp,
          calendarTimezone: metadata.calendarTimezone,
          resolvedWindow,
          appliedFilter,
          authorization: validatedAuthorization,
          authorizedRequestsCte,
        });
      }, BUSINESS_QUERY_TRANSACTION_CONFIG);
    },

    async getDashboardSnapshot(
      input: BusinessOperationsQueryInput,
      authorization: BusinessQueryAuthorizationContext,
      options: BusinessDashboardExecutionOptions = {},
    ): Promise<BusinessOperationsDashboardResponse> {
      const startedAt = now();
      try {
        const execution = await service.withSnapshot(
          input,
          authorization,
          async (context) => {
            const dashboardExecution = await executeDashboardSnapshotQuery(context);
            if (options.shadowRead) {
              await executeBusinessOperationsShadowComparison(context, metrics);
            }
            return dashboardExecution;
          },
        );
        recordBusinessQuerySuccess({
          kind: 'dashboard',
          authorization,
          durationMs: elapsedMilliseconds(startedAt, now()),
          preset: input.range,
          timezone: execution.response.calendarTimezone,
          queryTimestamp: execution.response.queryTimestamp,
          page: execution.response.list.page,
          searchHash: input.query ? fingerprintBusinessValue(input.query.trim()) : undefined,
          counters: execution.counters,
          metrics,
        });
        return execution.response;
      } catch (error) {
        recordBusinessQueryFailure(
          'dashboard',
          authorization,
          elapsedMilliseconds(startedAt, now()),
          error,
          metrics,
          { preset: input.range, page: input.page ?? 1 },
        );
        throw error;
      }
    },

    async getBusinessOperationDetail(
      tokenOrIdentity: string | BusinessIdentity,
      page: number,
      authorization: BusinessQueryAuthorizationContext,
    ): Promise<BusinessOperationDetailResponse> {
      const startedAt = now();
      try {
        const identity = resolveBusinessOperationIdentity(tokenOrIdentity);
        const validatedPage = validateDetailPage(page);
        const validatedAuthorization = validateBusinessQueryAuthorizationScope(authorization);
        const authorizedRequestsCte = buildAuthorizedDetailRequestsCte(validatedAuthorization);

        const execution = await store.transaction(async (transaction) => {
          await setBusinessQueryStatementTimeout(transaction);
          const rows = await transaction.execute<BusinessOperationDetailSnapshotRow>(
            buildBusinessOperationDetailStatement(
              authorizedRequestsCte,
              identity,
              validatedPage,
            ),
          );
          const response = mapBusinessOperationDetailResponse(rows, identity, validatedPage);
          return {
            response,
            counters: detailTelemetryCounters(rows[0], response),
          };
        }, BUSINESS_QUERY_TRANSACTION_CONFIG);

        recordBusinessQuerySuccess({
          kind: 'detail',
          authorization: validatedAuthorization,
          durationMs: elapsedMilliseconds(startedAt, now()),
          queryTimestamp: execution.response.queryTimestamp,
          page: validatedPage,
          referenceHash: identity.kind === 'referenced'
            ? fingerprintBusinessValue(identity.normalizedReference)
            : undefined,
          counters: execution.counters,
          metrics,
        });
        return execution.response;
      } catch (error) {
        recordBusinessQueryFailure(
          'detail',
          authorization,
          elapsedMilliseconds(startedAt, now()),
          error,
          metrics,
          { page },
        );
        throw error;
      }
    },

    async getFilterOptions(
      authorization: BusinessQueryAuthorizationContext,
    ): Promise<BusinessOperationFilterOptions> {
      const startedAt = now();
      try {
        const validatedAuthorization = validateBusinessQueryAuthorizationScope(authorization);
        const authorizedRequestsCte = buildAuthorizedRequestsCte(validatedAuthorization);

        const execution = await store.transaction(async (transaction) => {
          await setBusinessQueryStatementTimeout(transaction);
          const rows = await transaction.execute<BusinessOperationFilterOptionsRow>(
            buildBusinessOperationFilterOptionsStatement(
              authorizedRequestsCte,
              validatedAuthorization,
            ),
          );
          const response = mapBusinessOperationFilterOptions(rows);
          return {
            response,
            counters: filterTelemetryCounters(rows[0], response),
          };
        }, BUSINESS_QUERY_TRANSACTION_CONFIG);

        recordBusinessQuerySuccess({
          kind: 'filter_options',
          authorization: validatedAuthorization,
          durationMs: elapsedMilliseconds(startedAt, now()),
          counters: execution.counters,
          metrics,
        });
        return execution.response;
      } catch (error) {
        recordBusinessQueryFailure(
          'filter_options',
          authorization,
          elapsedMilliseconds(startedAt, now()),
          error,
          metrics,
        );
        throw error;
      }
    },
  };

  return service;
}

const defaultBusinessOperationQueryService = createBusinessOperationQueryService();

export function withBusinessOperationsSnapshot<T>(
  input: BusinessOperationsQueryInput,
  authorization: BusinessQueryAuthorizationContext,
  callback: (context: BusinessQuerySnapshotContext) => Promise<T>,
): Promise<T> {
  return defaultBusinessOperationQueryService.withSnapshot(input, authorization, callback);
}

function buildAuthorizedProfilePredicate(
  authorization: BusinessQueryAuthorizationContext,
): SQL {
  const predicates: SQL[] = [];

  if (authorization.allowedProfileIds === null) {
    predicates.push(isNotNull(operations.apiKeyId));
  } else if (authorization.allowedProfileIds.length > 0) {
    predicates.push(inArray(operations.apiKeyId, [...authorization.allowedProfileIds]));
  }

  if (authorization.canReadInternalScope) {
    predicates.push(isNull(operations.apiKeyId));
  }

  if (predicates.length === 0) return sql`false`;
  if (predicates.length === 1) return predicates[0];
  return or(...predicates) ?? sql`false`;
}

function normalizeRequiredFilter(value: string, label: string): string {
  if (typeof value !== 'string') {
    throw new BusinessQueryError('INVALID_FILTER', `${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > 256) {
    throw new BusinessQueryError(
      'INVALID_FILTER',
      `${label} must contain between 1 and 256 characters`,
    );
  }
  return normalized;
}

function parseSnapshotMetadata(rows: readonly SnapshotMetadataRow[]): {
  queryTimestamp: Date;
  calendarTimezone: string;
} {
  const row = rows[0];
  if (!row) {
    throw new BusinessQueryError(
      'SNAPSHOT_METADATA_INVALID',
      'Database snapshot metadata was not returned',
    );
  }

  const queryTimestamp = row.queryTimestamp instanceof Date
    ? new Date(row.queryTimestamp)
    : new Date(row.queryTimestamp);
  if (Number.isNaN(queryTimestamp.getTime())) {
    throw new BusinessQueryError(
      'SNAPSHOT_METADATA_INVALID',
      'Database query timestamp is invalid',
    );
  }

  const configuredTimezone = row.calendarTimezone?.trim() ?? '';
  if (isValidIanaTimezone(configuredTimezone)) {
    return { queryTimestamp, calendarTimezone: configuredTimezone };
  }

  logger.error('Invalid Operations calendar timezone; using safe default', {
    settingKey: 'ops_calendar_timezone',
    fallbackTimezone: DEFAULT_OPS_CALENDAR_TIMEZONE,
  });
  return {
    queryTimestamp,
    calendarTimezone: DEFAULT_OPS_CALENDAR_TIMEZONE,
  };
}

/**
 * Builds a current-row detail snapshot for exactly one signed Business Identity.
 * Authorization and eligibility are already enforced by `authorized_requests`;
 * identity matching is applied afterwards so inaccessible groups look absent.
 */
export function buildBusinessOperationDetailStatement(
  authorizedRequestsCte: SQL,
  identity: BusinessIdentity,
  page: number,
): SQL {
  const identityPredicate = buildBusinessIdentityPredicate(identity);
  const offset = (page - 1) * 100;

  return sql`
    WITH
    ${authorizedRequestsCte},
    matched_requests AS MATERIALIZED (
      SELECT *
      FROM authorized_requests
      WHERE ${identityPredicate}
    ),
    grouped_operation AS MATERIALIZED (
      SELECT
        business_group_key,
        MAX(profile_scope_id) AS profile_scope_id,
        MAX(normalized_reference) AS normalized_reference,
        COALESCE(
          MAX(normalized_reference),
          MIN(request_id COLLATE "C")
        ) AS operation_identifier,
        ARRAY_AGG(
          DISTINCT operation_type COLLATE "C"
          ORDER BY operation_type COLLATE "C"
        ) FILTER (WHERE operation_type IS NOT NULL) AS operation_types,
        COUNT(*)::integer AS request_count,
        MIN(created_at) AS operation_start_time,
        MAX(updated_at) AS operation_updated_time,
        MAX(COALESCE(completed_at, updated_at)) AS terminal_completed_time,
        COALESCE(SUM(COALESCE(input_tokens, 0)), 0)::bigint AS input_tokens,
        COALESCE(SUM(COALESCE(output_tokens, 0)), 0)::bigint AS output_tokens,
        COALESCE(SUM(total_cost_usd) FILTER (
          WHERE NOT has_unpriced_cost AND NOT cost_missing
        ), 0::numeric) AS total_cost_usd,
        COUNT(*) FILTER (WHERE has_unpriced_cost)::integer AS unpriced_request_count,
        COUNT(*) FILTER (WHERE
          input_tokens_missing OR output_tokens_missing OR cost_missing
        )::integer AS missing_request_count,
        COUNT(*) FILTER (WHERE state NOT IN (
          'RUNNING', 'PENDING', 'WAITING_USER_INPUT',
          'SUCCEEDED', 'FAILED', 'CANCELLED'
        ))::integer AS unknown_state_count,
        COUNT(*) FILTER (WHERE state IN (
          'RUNNING', 'PENDING', 'WAITING_USER_INPUT'
        ))::integer AS active_state_count,
        COUNT(*) FILTER (WHERE state = 'SUCCEEDED')::integer AS succeeded_state_count,
        COUNT(*) FILTER (WHERE state IN ('FAILED', 'CANCELLED'))::integer
          AS unsuccessful_state_count
      FROM matched_requests
      GROUP BY business_group_key
    ),
    detail_operation AS MATERIALIZED (
      SELECT
        grouped.*,
        COALESCE(profile."displayName", profile."name", 'Internal')
          AS profile_scope_name,
        (unknown_state_count > 0) AS invalid_data,
        CASE
          WHEN unknown_state_count > 0 THEN
            COALESCE(${businessOperationStatusSnapshots.lastValidStatus}, 'N/A')
          WHEN active_state_count > 0 THEN 'IN_PROGRESS'
          WHEN succeeded_state_count = request_count THEN 'SUCCEEDED'
          WHEN unsuccessful_state_count > 0
            AND succeeded_state_count + unsuccessful_state_count = request_count
            THEN 'FAILED'
          ELSE 'N/A'
        END AS business_status,
        CASE
          WHEN unknown_state_count = 0
            AND active_state_count = 0
            AND succeeded_state_count + unsuccessful_state_count = request_count
          THEN terminal_completed_time
          ELSE NULL
        END AS operation_end_time,
        CASE
          WHEN unknown_state_count = 0
            AND active_state_count = 0
            AND succeeded_state_count + unsuccessful_state_count = request_count
          THEN EXTRACT(EPOCH FROM (
            terminal_completed_time - operation_start_time
          ))::numeric
          ELSE NULL
        END AS duration_seconds
      FROM grouped_operation grouped
      LEFT JOIN ${businessOperationStatusSnapshots}
        ON ${businessOperationStatusSnapshots.businessGroupKey}
          = grouped.business_group_key
      LEFT JOIN ${apiKeys} profile ON profile."id" = grouped.profile_scope_id
    ),
    ordered_requests AS MATERIALIZED (
      SELECT *
      FROM matched_requests
      ORDER BY created_at ASC, request_id COLLATE "C" ASC
      LIMIT 100 OFFSET ${offset}
    )
    SELECT
      transaction_timestamp() AS "queryTimestamp",
      (
        SELECT JSONB_BUILD_OBJECT(
          'operationIdentifier', detail.operation_identifier,
          'normalizedReference', detail.normalized_reference,
          'profileScope', JSONB_BUILD_OBJECT(
            'id', detail.profile_scope_id,
            'name', detail.profile_scope_name
          ),
          'operationTypes', COALESCE(detail.operation_types, ARRAY[]::text[]),
          'businessStatus', detail.business_status,
          'invalidData', detail.invalid_data,
          'requestCount', detail.request_count,
          'startTime', detail.operation_start_time,
          'updatedTime', detail.operation_updated_time,
          'totalTokens', detail.input_tokens + detail.output_tokens,
          'totalCostUsd', detail.total_cost_usd::text,
          'unpricedRequestCount', detail.unpriced_request_count,
          'missingData', detail.missing_request_count > 0,
          'endTime', detail.operation_end_time,
          'durationSeconds', detail.duration_seconds
        )
        FROM detail_operation detail
      ) AS "operation",
      COALESCE((
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'id', request.request_id,
            'operationType', request.operation_type,
            'state', request.state,
            'startedAt', request.created_at,
            'completedAt', request.completed_at,
            'inputTokens', CASE
              WHEN request.input_tokens_missing THEN NULL
              ELSE request.input_tokens
            END,
            'outputTokens', CASE
              WHEN request.output_tokens_missing THEN NULL
              ELSE request.output_tokens
            END,
            'costUsd', CASE
              WHEN request.cost_missing THEN NULL
              ELSE request.total_cost_usd::text
            END,
            'errorCode', request.error_code,
            'errorMessage', request.error_message,
            'missingData', request.input_tokens_missing
              OR request.output_tokens_missing OR request.cost_missing,
            'unpricedCost', request.has_unpriced_cost
          ) ORDER BY request.created_at ASC, request.request_id COLLATE "C" ASC
        )
        FROM ordered_requests request
      ), '[]'::jsonb) AS "requestItems",
      (SELECT COUNT(*) FROM matched_requests) AS "requestTotal",
      (SELECT COUNT(*) FROM matched_requests WHERE state NOT IN (
        'RUNNING', 'PENDING', 'WAITING_USER_INPUT',
        'SUCCEEDED', 'FAILED', 'CANCELLED'
      )) AS "unknownStateCount",
      (SELECT COUNT(*) FROM matched_requests WHERE
        input_tokens_missing OR output_tokens_missing OR cost_missing
      ) AS "missingMeasurementCount",
      (SELECT COUNT(*) FROM matched_requests WHERE has_unpriced_cost)
        AS "telemetryUnpricedRequestCount",
      (SELECT COUNT(*)
        FROM ${businessOperationStatusSnapshots} snapshot
        WHERE NOT EXISTS (
          SELECT 1
          FROM ${operations} source_operation
          WHERE source_operation."businessGroupKey" = snapshot."businessGroupKey"
            AND source_operation."deletedAt" IS NULL
            AND source_operation."hiddenFromOperations" = false
        )) AS "orphanSnapshotCount"
  `;
}

/** Metadata query intentionally selects only display IDs/names and operation types. */
export function buildBusinessOperationFilterOptionsStatement(
  authorizedRequestsCte: SQL,
  authorization: BusinessQueryAuthorizationContext,
): SQL {
  const profilePredicate = authorization.allowedProfileIds === null
    ? sql`true`
    : authorization.allowedProfileIds.length === 0
      ? sql`false`
      : inArray(apiKeys.id, [...authorization.allowedProfileIds]);

  return sql`
    WITH
    ${authorizedRequestsCte},
    represented_operation_types AS MATERIALIZED (
      SELECT DISTINCT operation_type
      FROM authorized_requests
      WHERE operation_type IS NOT NULL
    )
    SELECT
      COALESCE((
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'id', ${apiKeys.id},
            'name', COALESCE(${apiKeys.displayName}, ${apiKeys.name})
          ) ORDER BY
            COALESCE(${apiKeys.displayName}, ${apiKeys.name}) COLLATE "C" ASC,
            ${apiKeys.id} COLLATE "C" ASC
        )
        FROM ${apiKeys}
        WHERE ${profilePredicate}
      ), '[]'::jsonb) AS "profiles",
      COALESCE((
        SELECT JSONB_AGG(
          represented.operation_type
          ORDER BY represented.operation_type COLLATE "C" ASC
        )
        FROM represented_operation_types represented
      ), '[]'::jsonb) AS "operationTypes",
      ${authorization.canReadInternalScope}::boolean AS "hasInternalScope",
      (SELECT COUNT(*) FROM authorized_requests) AS "scannedRequestCount",
      (SELECT COUNT(*) FROM authorized_requests WHERE state NOT IN (
        'RUNNING', 'PENDING', 'WAITING_USER_INPUT',
        'SUCCEEDED', 'FAILED', 'CANCELLED'
      )) AS "unknownStateCount",
      (SELECT COUNT(*) FROM authorized_requests WHERE
        input_tokens_missing OR output_tokens_missing OR cost_missing
      ) AS "missingMeasurementCount",
      (SELECT COUNT(*) FROM authorized_requests WHERE has_unpriced_cost)
        AS "telemetryUnpricedRequestCount",
      (SELECT COUNT(*)
        FROM ${businessOperationStatusSnapshots} snapshot
        WHERE NOT EXISTS (
          SELECT 1
          FROM ${operations} source_operation
          WHERE source_operation."businessGroupKey" = snapshot."businessGroupKey"
            AND source_operation."deletedAt" IS NULL
            AND source_operation."hiddenFromOperations" = false
        )) AS "orphanSnapshotCount"
  `;
}


/**
 * Compares source request totals with the independently summed business
 * projection for the same authorized filter and database snapshot. Shadow
 * rows are consumed internally and can never be returned by the route.
 */
async function executeBusinessOperationsShadowComparison(
  context: BusinessQuerySnapshotContext,
  metrics: BusinessOperationsMetricsEmitter,
): Promise<void> {
  try {
    const rows = await context.transaction.execute<BusinessShadowComparisonRow>(
      buildBusinessOperationsShadowComparisonStatement(context),
    );
    const row = rows[0];
    if (!row) {
      throw new BusinessQueryError(
        'SNAPSHOT_METADATA_INVALID',
        'Shadow comparison query did not return a result',
      );
    }

    const mismatches: BusinessShadowMismatchMeasure[] = [];
    if (normalizeNonNegativeIntegerText(row.sourceRequestCount, 'shadow source request count')
      !== normalizeNonNegativeIntegerText(
        row.projectionRequestCount,
        'shadow projection request count',
      )) {
      mismatches.push('request_count');
    }
    if (normalizeNonNegativeIntegerText(row.sourceTokenTotal, 'shadow source token total')
      !== normalizeNonNegativeIntegerText(row.projectionTokenTotal, 'shadow projection token total')) {
      mismatches.push('token_total');
    }
    if (normalizeFixedDecimal(row.sourceCostTotal)
      !== normalizeFixedDecimal(row.projectionCostTotal)) {
      mismatches.push('cost_total');
    }

    if (mismatches.length === 0) return;

    businessOperationsLogger.child({
      requestId: context.authorization.requestId,
      service: 'business-operations-dashboard',
    }).warn('Business Operations shadow comparison mismatch', {
      requestId: context.authorization.requestId,
      actorId: context.authorization.actorId,
      actorRole: context.authorization.actorRole,
      profileScopeCount: profileScopeCount(context.authorization.allowedProfileIds),
      preset: context.appliedFilter.range,
      mismatchMeasures: mismatches,
    });

    for (const measure of mismatches) {
      emitBusinessOperationsMetric(
        metrics,
        'business_operations_snapshot_mismatch_total',
        1,
        { measure, preset: context.appliedFilter.range },
      );
    }
  } catch (error) {
    businessOperationsLogger.child({
      requestId: context.authorization.requestId,
      service: 'business-operations-dashboard',
    }).warn('Business Operations shadow comparison failed', {
      requestId: context.authorization.requestId,
      preset: context.appliedFilter.range,
      ...safeBusinessOperationsFailure(error),
    });
  }
}

/**
 * Executes all dashboard sections through one SQL statement. The statement owns
 * one authorized request CTE, one grouped/status projection, and one filtered
 * business-operation set so KPI, card, trend, and list values cannot drift.
 */
async function executeDashboardSnapshotQuery(
  context: BusinessQuerySnapshotContext,
): Promise<DashboardSnapshotExecution> {
  const rows = await context.transaction.execute<DashboardSnapshotRow>(
    buildDashboardSnapshotStatement(context),
  );
  const row = rows[0];
  if (!row) {
    throw new BusinessQueryError(
      'SNAPSHOT_METADATA_INVALID',
      'Dashboard snapshot query did not return a result',
    );
  }

  const total = parseNonNegativeInteger(row.listTotal, 'dashboard list total');
  const rawItems = Array.isArray(row.listItems) ? row.listItems : [];
  const items = rawItems.map(mapDashboardListItem);
  const breakdownCards = (Array.isArray(row.breakdownCards) ? row.breakdownCards : [])
    .map((card) => ({
      profileScope: {
        id: card.profileScope.id,
        name: card.profileScope.name,
      },
      operationType: card.operationType,
      businessOperationCount: card.businessOperationCount,
      succeededCount: card.succeededCount,
      failedCount: card.failedCount,
      successPercentage: card.successPercentage,
      requestCount: card.requestCount,
      inputTokens: card.inputTokens,
      outputTokens: card.outputTokens,
      costUsd: normalizeFixedDecimal(card.costUsd),
      averageTokensPerBusinessOperation: card.averageTokensPerBusinessOperation,
      averageDurationSeconds: card.averageDurationSeconds,
      maxDurationOperationIdentifier: card.maxDurationOperation?.identifier ?? null,
      maxTokenOperationIdentifier: card.maxTokenOperation?.identifier ?? '',
      maxDurationOperationToken: card.maxDurationOperation
        ? encodeBusinessOperationToken(extremumIdentity(card.maxDurationOperation))
        : null,
      maxTokenOperationToken: card.maxTokenOperation
        ? encodeBusinessOperationToken(extremumIdentity(card.maxTokenOperation))
        : null,
      maxDurationSeconds: card.maxDurationSeconds ?? null,
      maxTokenCount: card.maxTokenCount,
      unpricedRequestCount: card.unpricedRequestCount,
      costIncomplete: card.costIncomplete,
    }));

  const response: BusinessOperationsDashboardResponse = {
    queryTimestamp: context.queryTimestamp.toISOString(),
    calendarTimezone: context.calendarTimezone,
    resolvedWindow: {
      start: context.resolvedWindow.start.toISOString(),
      end: context.resolvedWindow.end.toISOString(),
      startInclusive: true,
      endInclusive: context.resolvedWindow.endInclusive,
      preset: context.resolvedWindow.preset,
    },
    appliedFilter: context.appliedFilter,
    summary: {
      totalCases: row.summary.totalCases,
      tokensProcessed: row.summary.tokensProcessed,
      totalCostUsd: normalizeFixedDecimal(row.summary.totalCostUsd),
      logicSuccessRate: row.summary.logicSuccessRate,
      aiExtractionRate: row.summary.aiExtractionRate,
      p95DurationSeconds: row.summary.p95DurationSeconds,
      unpricedRequestCount: row.summary.unpricedRequestCount,
      costIncomplete: row.summary.costIncomplete,
    },
    breakdownCards,
    trend: {
      bucket: context.resolvedWindow.bucket,
      points: (Array.isArray(row.trendPoints) ? row.trendPoints : []).map((point) => ({
        unit: point.unit,
        localKey: point.localKey,
        occurrence: point.occurrence,
        start: normalizeIsoTimestamp(point.start),
        end: normalizeIsoTimestamp(point.end),
        startInclusive: true,
        endInclusive: point.endInclusive,
        clippedStart: point.clippedStart,
        clippedEnd: point.clippedEnd,
        counts: {
          IN_PROGRESS: point.counts.IN_PROGRESS,
          SUCCEEDED: point.counts.SUCCEEDED,
          FAILED: point.counts.FAILED,
        },
        total: point.total,
      })),
    },
    list: {
      items,
      page: context.appliedFilter.page,
      pageSize: 50,
      total,
      totalPages: Math.ceil(total / 50),
    },
  };

  return {
    response,
    counters: {
      resultCount: total,
      scannedRequestCount: parseOptionalNonNegativeInteger(
        row.scannedRequestCount,
        'dashboard scanned request count',
      ),
      unknownStateCount: parseOptionalNonNegativeInteger(
        row.unknownStateCount,
        'dashboard unknown state count',
      ),
      missingMeasurementCount: parseOptionalNonNegativeInteger(
        row.missingMeasurementCount,
        'dashboard missing measurement count',
      ),
      unpricedRequestCount: parseOptionalNonNegativeInteger(
        row.telemetryUnpricedRequestCount,
        'dashboard unpriced request count',
      ),
      orphanSnapshotCount: parseOptionalNonNegativeInteger(
        row.orphanSnapshotCount,
        'dashboard orphan snapshot count',
      ),
    },
  };
}

/**
 * Reusable grouped/status/filtered projection shared by every dashboard section.
 * The caller must declare `authorized_requests` before this fragment.
 */
export function buildBusinessOperationsProjectionCtes(
  context: BusinessQuerySnapshotContext,
): SQL {
  const windowStartIso = context.resolvedWindow.start.toISOString();
  const windowEndIso = context.resolvedWindow.end.toISOString();
  const filterPredicates: SQL[] = [
    sql`operation_start_time >= ${windowStartIso}::timestamptz`,
    context.resolvedWindow.endInclusive
      ? sql`operation_start_time <= ${windowEndIso}::timestamptz`
      : sql`operation_start_time < ${windowEndIso}::timestamptz`,
  ];

  if (context.appliedFilter.profile === INTERNAL_PROFILE_SCOPE) {
    filterPredicates.push(sql`profile_scope_id IS NULL`);
  } else if (context.appliedFilter.profile !== ALL_FILTER_VALUE) {
    filterPredicates.push(sql`profile_scope_id = ${context.appliedFilter.profile}`);
  }

  if (context.appliedFilter.operationType !== ALL_FILTER_VALUE) {
    filterPredicates.push(sql`EXISTS (
      SELECT 1
      FROM authorized_requests type_request
      WHERE type_request.business_group_key = status_projection.business_group_key
        AND type_request.operation_type = ${context.appliedFilter.operationType}
    )`);
  }

  if (context.appliedFilter.status !== ALL_FILTER_VALUE) {
    filterPredicates.push(sql`business_status = ${context.appliedFilter.status}`);
  }

  const search = context.appliedFilter.search;
  if (search?.mode === 'contains') {
    filterPredicates.push(sql`POSITION(
      LOWER(${search.query}) IN LOWER(COALESCE(normalized_reference, ''))
    ) > 0`);
  } else if (search?.mode === 'exact') {
    filterPredicates.push(sql`(
      normalized_reference = ${search.query}
      OR EXISTS (
        SELECT 1
        FROM authorized_requests search_request
        WHERE search_request.business_group_key = status_projection.business_group_key
          AND search_request.request_id = ${search.query}
      )
    )`);
  }

  return sql`
    grouped_operations AS MATERIALIZED (
      SELECT
        business_group_key,
        MAX(profile_scope_id) AS profile_scope_id,
        MAX(normalized_reference) AS normalized_reference,
        COALESCE(
          MAX(normalized_reference),
          MIN(request_id COLLATE "C")
        ) AS operation_identifier,
        MIN(request_id COLLATE "C") AS standalone_request_id,
        ARRAY_AGG(
          DISTINCT operation_type COLLATE "C"
          ORDER BY operation_type COLLATE "C"
        ) FILTER (WHERE operation_type IS NOT NULL) AS operation_types,
        COUNT(*)::integer AS request_count,
        MIN(created_at) AS operation_start_time,
        MAX(updated_at) AS operation_updated_time,
        MAX(COALESCE(completed_at, updated_at)) AS terminal_completed_time,
        COALESCE(SUM(COALESCE(input_tokens, 0)), 0)::bigint AS input_tokens,
        COALESCE(SUM(COALESCE(output_tokens, 0)), 0)::bigint AS output_tokens,
        COALESCE(SUM(total_cost_usd) FILTER (
          WHERE NOT has_unpriced_cost AND NOT cost_missing
        ), 0::numeric) AS total_cost_usd,
        COUNT(*) FILTER (WHERE has_unpriced_cost)::integer AS unpriced_request_count,
        COUNT(*) FILTER (WHERE
          input_tokens_missing OR output_tokens_missing OR cost_missing
        )::integer AS missing_request_count,
        COUNT(*) FILTER (WHERE state NOT IN (
          'RUNNING', 'PENDING', 'WAITING_USER_INPUT',
          'SUCCEEDED', 'FAILED', 'CANCELLED'
        ))::integer AS unknown_state_count,
        COUNT(*) FILTER (WHERE state IN (
          'RUNNING', 'PENDING', 'WAITING_USER_INPUT'
        ))::integer AS active_state_count,
        COUNT(*) FILTER (WHERE state = 'SUCCEEDED')::integer AS succeeded_state_count,
        COUNT(*) FILTER (WHERE state IN ('FAILED', 'CANCELLED'))::integer
          AS unsuccessful_state_count,
        COUNT(*) FILTER (WHERE logic_result IN ('PASS', 'FAIL'))::integer
          AS logic_result_count,
        BOOL_AND(logic_result = 'PASS') FILTER (
          WHERE logic_result IN ('PASS', 'FAIL')
        ) AS logic_successful,
        COUNT(*) FILTER (WHERE extraction_result IN ('SUCCESS', 'FAIL'))::integer
          AS extraction_result_count,
        BOOL_AND(extraction_result = 'SUCCESS') FILTER (
          WHERE extraction_result IN ('SUCCESS', 'FAIL')
        ) AS extraction_successful
      FROM authorized_requests
      GROUP BY business_group_key
    ),
    status_projection AS MATERIALIZED (
      SELECT
        grouped_operations.*,
        (unknown_state_count > 0) AS invalid_data,
        CASE
          WHEN unknown_state_count > 0 THEN
            COALESCE(${businessOperationStatusSnapshots.lastValidStatus}, 'N/A')
          WHEN active_state_count > 0 THEN 'IN_PROGRESS'
          WHEN succeeded_state_count = request_count THEN 'SUCCEEDED'
          WHEN unsuccessful_state_count > 0
            AND succeeded_state_count + unsuccessful_state_count = request_count
            THEN 'FAILED'
          ELSE 'N/A'
        END AS business_status,
        CASE
          WHEN unknown_state_count = 0
            AND active_state_count = 0
            AND succeeded_state_count + unsuccessful_state_count = request_count
          THEN terminal_completed_time
          ELSE NULL
        END AS operation_end_time,
        CASE
          WHEN unknown_state_count = 0
            AND active_state_count = 0
            AND succeeded_state_count + unsuccessful_state_count = request_count
          THEN EXTRACT(EPOCH FROM (
            terminal_completed_time - operation_start_time
          ))::numeric
          ELSE NULL
        END AS duration_seconds
      FROM grouped_operations
      LEFT JOIN ${businessOperationStatusSnapshots}
        ON ${businessOperationStatusSnapshots.businessGroupKey}
          = grouped_operations.business_group_key
    ),
    filtered_business_operations AS MATERIALIZED (
      SELECT *
      FROM status_projection
      WHERE ${sql.join(filterPredicates, sql` AND `)}
    )
  `;
}

/**
 * Reconciles the same filtered groups via two independent aggregate paths:
 * current eligible source requests and the grouped business projection.
 */
export function buildBusinessOperationsShadowComparisonStatement(
  context: BusinessQuerySnapshotContext,
): SQL {
  const projectionCtes = buildBusinessOperationsProjectionCtes(context);

  return sql`
    WITH
    ${context.authorizedRequestsCte},
    ${projectionCtes},
    shadow_source_totals AS (
      SELECT
        COUNT(*)::bigint AS request_count,
        COALESCE(SUM(
          COALESCE(source.input_tokens, 0)::bigint
            + COALESCE(source.output_tokens, 0)::bigint
        ), 0::bigint) AS token_total,
        COALESCE(SUM(source.total_cost_usd) FILTER (
          WHERE NOT source.has_unpriced_cost AND NOT source.cost_missing
        ), 0::numeric) AS cost_total
      FROM authorized_requests source
      JOIN filtered_business_operations filtered
        ON filtered.business_group_key = source.business_group_key
    ),
    shadow_projection_totals AS (
      SELECT
        COALESCE(SUM(projected.request_count), 0)::bigint AS request_count,
        COALESCE(SUM(
          projected.input_tokens + projected.output_tokens
        ), 0::bigint) AS token_total,
        COALESCE(SUM(projected.total_cost_usd), 0::numeric) AS cost_total
      FROM filtered_business_operations projected
    )
    SELECT
      source.request_count::text AS "sourceRequestCount",
      source.token_total::text AS "sourceTokenTotal",
      source.cost_total::text AS "sourceCostTotal",
      projected.request_count::text AS "projectionRequestCount",
      projected.token_total::text AS "projectionTokenTotal",
      projected.cost_total::text AS "projectionCostTotal"
    FROM shadow_source_totals source
    CROSS JOIN shadow_projection_totals projected
  `;
}

function businessListOrderClause(sort: BusinessQueryListSort, alias: string): SQL {
  const p = alias ? `${alias}.` : '';
  const tiebreak = sql`${sql.raw(`${p}operation_updated_time`)} DESC, ${sql.raw(`${p}operation_identifier`)} COLLATE "C" ASC, ${sql.raw(`${p}business_group_key`)} COLLATE "C" ASC`;
  const recency = sql.raw(`COALESCE(${p}operation_end_time, ${p}operation_updated_time)`);
  switch (sort) {
    case 'duration':
      return sql`${sql.raw(`${p}duration_seconds`)} DESC NULLS LAST, ${tiebreak}`;
    case 'tokens':
      return sql`(${sql.raw(`${p}input_tokens`)} + ${sql.raw(`${p}output_tokens`)}) DESC, ${tiebreak}`;
    case 'cost':
      return sql`${sql.raw(`${p}total_cost_usd`)} DESC, ${tiebreak}`;
    case 'recent':
    default:
      return sql`${recency} DESC, ${sql.raw(`${p}operation_identifier`)} COLLATE "C" ASC, ${sql.raw(`${p}business_group_key`)} COLLATE "C" ASC`;
  }
}

/** Exported for focused SQL contract tests and query-plan inspection. */
export function buildDashboardSnapshotStatement(
  context: BusinessQuerySnapshotContext,
): SQL {
  const projectionCtes = buildBusinessOperationsProjectionCtes(context);
  const buckets = buildDashboardBucketValues(context.resolvedWindow);
  const offset = (context.appliedFilter.page - 1) * 50;

  return sql`
    WITH
    ${context.authorizedRequestsCte},
    ${projectionCtes},
    card_operation_metrics AS MATERIALIZED (
      SELECT
        filtered.business_group_key,
        filtered.profile_scope_id,
        request.operation_type,
        filtered.operation_identifier,
        filtered.normalized_reference,
        filtered.standalone_request_id,
        filtered.business_status,
        filtered.duration_seconds,
        COUNT(*)::integer AS request_count,
        COALESCE(SUM(COALESCE(request.input_tokens, 0)), 0)::bigint AS input_tokens,
        COALESCE(SUM(COALESCE(request.output_tokens, 0)), 0)::bigint AS output_tokens,
        COALESCE(SUM(request.total_cost_usd) FILTER (
          WHERE NOT request.has_unpriced_cost AND NOT request.cost_missing
        ), 0::numeric) AS total_cost_usd,
        COUNT(*) FILTER (WHERE request.has_unpriced_cost)::integer
          AS unpriced_request_count
      FROM filtered_business_operations filtered
      JOIN authorized_requests request
        ON request.business_group_key = filtered.business_group_key
      WHERE request.operation_type IS NOT NULL
      GROUP BY
        filtered.business_group_key,
        filtered.profile_scope_id,
        request.operation_type,
        filtered.operation_identifier,
        filtered.normalized_reference,
        filtered.standalone_request_id,
        filtered.business_status,
        filtered.duration_seconds
    ),
    card_aggregates AS MATERIALIZED (
      SELECT
        card.profile_scope_id,
        card.operation_type,
        COUNT(*)::integer AS business_operation_count,
        COUNT(*) FILTER (WHERE card.business_status = 'SUCCEEDED')::integer
          AS succeeded_count,
        COUNT(*) FILTER (WHERE card.business_status = 'FAILED')::integer
          AS failed_count,
        ROUND(
          COUNT(*) FILTER (WHERE card.business_status = 'SUCCEEDED')::numeric
            * 100 / NULLIF(COUNT(*), 0),
          2
        ) AS success_percentage,
        SUM(card.request_count)::bigint AS request_count,
        SUM(card.input_tokens)::bigint AS input_tokens,
        SUM(card.output_tokens)::bigint AS output_tokens,
        SUM(card.total_cost_usd) AS total_cost_usd,
        ROUND(
          SUM(card.input_tokens + card.output_tokens)::numeric
            / NULLIF(COUNT(*), 0),
          1
        ) AS average_tokens,
        ROUND(AVG(card.duration_seconds) FILTER (
          WHERE card.business_status IN ('SUCCEEDED', 'FAILED')
            AND card.duration_seconds IS NOT NULL
        ), 1) AS average_duration_seconds,
        (ARRAY_AGG(
          JSONB_BUILD_OBJECT(
            'identifier', card.operation_identifier,
            'normalizedReference', card.normalized_reference,
            'profileScopeId', card.profile_scope_id,
            'standaloneRequestId', card.standalone_request_id
          )
          ORDER BY card.duration_seconds DESC NULLS LAST,
            card.operation_identifier COLLATE "C" ASC
        ) FILTER (
          WHERE card.business_status IN ('SUCCEEDED', 'FAILED')
            AND card.duration_seconds IS NOT NULL
        ))[1] AS max_duration_operation,
        (ARRAY_AGG(
          JSONB_BUILD_OBJECT(
            'identifier', card.operation_identifier,
            'normalizedReference', card.normalized_reference,
            'profileScopeId', card.profile_scope_id,
            'standaloneRequestId', card.standalone_request_id
          )
          ORDER BY (card.input_tokens + card.output_tokens) DESC,
            card.operation_identifier COLLATE "C" ASC
        ))[1] AS max_token_operation,
        MAX(card.duration_seconds) FILTER (
          WHERE card.business_status IN ('SUCCEEDED', 'FAILED')
            AND card.duration_seconds IS NOT NULL
        ) AS max_duration_seconds,
        MAX(card.input_tokens + card.output_tokens)::bigint AS max_token_count,
        SUM(card.unpriced_request_count)::bigint AS unpriced_request_count
      FROM card_operation_metrics card
      GROUP BY card.profile_scope_id, card.operation_type
    ),
    trend_buckets(
      unit, local_key, occurrence, bucket_start, bucket_end,
      end_inclusive, clipped_start, clipped_end
    ) AS (
      VALUES ${buckets}
    ),
    trend_aggregates AS MATERIALIZED (
      SELECT
        bucket.unit,
        bucket.local_key,
        bucket.occurrence,
        bucket.bucket_start,
        bucket.bucket_end,
        bucket.end_inclusive,
        bucket.clipped_start,
        bucket.clipped_end,
        COUNT(filtered.business_group_key) FILTER (
          WHERE filtered.business_status = 'IN_PROGRESS'
        )::integer AS in_progress_count,
        COUNT(filtered.business_group_key) FILTER (
          WHERE filtered.business_status = 'SUCCEEDED'
        )::integer AS succeeded_count,
        COUNT(filtered.business_group_key) FILTER (
          WHERE filtered.business_status = 'FAILED'
        )::integer AS failed_count
      FROM trend_buckets bucket
      LEFT JOIN filtered_business_operations filtered
        ON filtered.operation_start_time >= bucket.bucket_start
        AND CASE WHEN bucket.end_inclusive
          THEN filtered.operation_start_time <= bucket.bucket_end
          ELSE filtered.operation_start_time < bucket.bucket_end
        END
      GROUP BY
        bucket.unit, bucket.local_key, bucket.occurrence,
        bucket.bucket_start, bucket.bucket_end, bucket.end_inclusive,
        bucket.clipped_start, bucket.clipped_end
    ),
    ordered_list AS MATERIALIZED (
      SELECT
        filtered.*,
        COALESCE(profile."displayName", profile."name", 'Internal')
          AS profile_scope_name
      FROM filtered_business_operations filtered
      LEFT JOIN ${apiKeys} profile ON profile."id" = filtered.profile_scope_id
      ORDER BY ${businessListOrderClause(context.appliedFilter.sort, 'filtered')}
      LIMIT 50 OFFSET ${offset}
    )
    SELECT
      (
        SELECT JSONB_BUILD_OBJECT(
          'totalCases', COUNT(*)::integer,
          'tokensProcessed', COALESCE(SUM(input_tokens + output_tokens), 0)::bigint,
          'totalCostUsd', COALESCE(SUM(total_cost_usd), 0::numeric)::text,
          'logicSuccessRate', ROUND(
            COUNT(*) FILTER (
              WHERE logic_result_count > 0 AND logic_successful
            )::numeric * 100
              / NULLIF(COUNT(*) FILTER (WHERE logic_result_count > 0), 0),
            2
          ),
          'aiExtractionRate', ROUND(
            COUNT(*) FILTER (
              WHERE extraction_result_count > 0 AND extraction_successful
            )::numeric * 100
              / NULLIF(COUNT(*) FILTER (WHERE extraction_result_count > 0), 0),
            2
          ),
          'p95DurationSeconds', ROUND(
            (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_seconds)
              FILTER (WHERE duration_seconds IS NOT NULL
                AND business_status IN ('SUCCEEDED', 'FAILED')))::numeric,
            1
          ),
          'unpricedRequestCount',
            COALESCE(SUM(unpriced_request_count), 0)::bigint,
          'costIncomplete', COALESCE(SUM(unpriced_request_count), 0) > 0
        )
        FROM filtered_business_operations
      ) AS "summary",
      COALESCE((
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'profileScope', JSONB_BUILD_OBJECT(
              'id', card.profile_scope_id,
              'name', COALESCE(
                profile."displayName",
                profile."name",
                'Internal'
              )
            ),
            'operationType', card.operation_type,
            'businessOperationCount', card.business_operation_count,
            'succeededCount', card.succeeded_count,
            'failedCount', card.failed_count,
            'successPercentage', card.success_percentage,
            'requestCount', card.request_count,
            'inputTokens', card.input_tokens,
            'outputTokens', card.output_tokens,
            'costUsd', card.total_cost_usd::text,
            'averageTokensPerBusinessOperation', card.average_tokens,
            'averageDurationSeconds', card.average_duration_seconds,
            'maxDurationOperation', card.max_duration_operation,
            'maxTokenOperation', card.max_token_operation,
            'maxDurationSeconds', card.max_duration_seconds,
            'maxTokenCount', card.max_token_count,
            'unpricedRequestCount', card.unpriced_request_count,
            'costIncomplete', card.unpriced_request_count > 0
          ) ORDER BY
            COALESCE(card.profile_scope_id, ${INTERNAL_PROFILE_SCOPE}) COLLATE "C",
            card.operation_type COLLATE "C"
        )
        FROM card_aggregates card
        LEFT JOIN ${apiKeys} profile ON profile."id" = card.profile_scope_id
      ), '[]'::jsonb) AS "breakdownCards",
      COALESCE((
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'unit', trend.unit,
            'localKey', trend.local_key,
            'occurrence', trend.occurrence,
            'start', trend.bucket_start,
            'end', trend.bucket_end,
            'startInclusive', true,
            'endInclusive', trend.end_inclusive,
            'clippedStart', trend.clipped_start,
            'clippedEnd', trend.clipped_end,
            'counts', JSONB_BUILD_OBJECT(
              'IN_PROGRESS', trend.in_progress_count,
              'SUCCEEDED', trend.succeeded_count,
              'FAILED', trend.failed_count
            ),
            'total', trend.in_progress_count + trend.succeeded_count + trend.failed_count
          ) ORDER BY trend.bucket_start ASC, trend.occurrence ASC
        )
        FROM trend_aggregates trend
      ), '[]'::jsonb) AS "trendPoints",
      COALESCE((
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'operationIdentifier', listed.operation_identifier,
            'normalizedReference', listed.normalized_reference,
            'profileScope', JSONB_BUILD_OBJECT(
              'id', listed.profile_scope_id,
              'name', listed.profile_scope_name
            ),
            'profileScopeId', listed.profile_scope_id,
            'standaloneRequestId', listed.standalone_request_id,
            'operationTypes', COALESCE(listed.operation_types, ARRAY[]::text[]),
            'businessStatus', listed.business_status,
            'invalidData', listed.invalid_data,
            'requestCount', listed.request_count,
            'startTime', listed.operation_start_time,
            'updatedTime', listed.operation_updated_time,
            'endTime', listed.operation_end_time,
            'totalTokens', listed.input_tokens + listed.output_tokens,
            'totalCostUsd', listed.total_cost_usd::text,
            'durationSeconds', listed.duration_seconds,
            'unpricedRequestCount', listed.unpriced_request_count,
            'missingData', listed.missing_request_count > 0
          ) ORDER BY ${businessListOrderClause(context.appliedFilter.sort, 'listed')}
        )
        FROM ordered_list listed
      ), '[]'::jsonb) AS "listItems",
      (SELECT COUNT(*) FROM filtered_business_operations) AS "listTotal",
      (SELECT COUNT(*) FROM authorized_requests) AS "scannedRequestCount",
      (SELECT COUNT(*) FROM filtered_business_operations WHERE invalid_data)
        AS "unknownStateCount",
      (SELECT COALESCE(SUM(missing_request_count), 0)
        FROM filtered_business_operations) AS "missingMeasurementCount",
      (SELECT COALESCE(SUM(unpriced_request_count), 0)
        FROM filtered_business_operations) AS "telemetryUnpricedRequestCount",
      (SELECT COUNT(*)
        FROM ${businessOperationStatusSnapshots} snapshot
        WHERE NOT EXISTS (
          SELECT 1
          FROM ${operations} source_operation
          WHERE source_operation."businessGroupKey" = snapshot."businessGroupKey"
            AND source_operation."deletedAt" IS NULL
            AND source_operation."hiddenFromOperations" = false
        )) AS "orphanSnapshotCount"
  `;
}

function buildDashboardBucketValues(window: ResolvedTimeWindow): SQL {
  const buckets = buildCalendarBuckets(window);
  if (buckets.length === 0) {
    throw new BusinessQueryError(
      'SNAPSHOT_METADATA_INVALID',
      'Resolved calendar window did not produce any trend bucket',
    );
  }

  return sql.join(buckets.map((bucket) => sql`(
    ${bucket.unit}::text,
    ${bucket.localKey}::text,
    ${bucket.occurrence}::integer,
    ${bucket.start.toISOString()}::timestamptz,
    ${bucket.end.toISOString()}::timestamptz,
    ${bucket.endInclusive}::boolean,
    ${bucket.clippedStart}::boolean,
    ${bucket.clippedEnd}::boolean
  )`), sql`, `);
}

function mapDashboardListItem(raw: RawDashboardListItem): BusinessOperationsDashboardListItem {
  const identity: BusinessIdentity = raw.normalizedReference === null
    ? { kind: 'standalone', requestId: raw.standaloneRequestId }
    : {
      kind: 'referenced',
      scope: raw.profileScopeId === null
        ? { kind: 'internal' }
        : { kind: 'profile', apiKeyId: raw.profileScopeId },
      normalizedReference: raw.normalizedReference,
    };

  return {
    token: encodeBusinessOperationToken(identity),
    operationIdentifier: raw.operationIdentifier,
    normalizedReference: raw.normalizedReference,
    profileScope: {
      id: raw.profileScope.id,
      name: raw.profileScope.name,
    },
    operationTypes: raw.operationTypes,
    businessStatus: raw.businessStatus,
    invalidData: raw.invalidData,
    requestCount: raw.requestCount,
    startTime: normalizeIsoTimestamp(raw.startTime),
    updatedTime: normalizeIsoTimestamp(raw.updatedTime),
    endTime: raw.endTime == null ? null : normalizeIsoTimestamp(raw.endTime),
    totalTokens: raw.totalTokens,
    totalCostUsd: normalizeFixedDecimal(raw.totalCostUsd),
    durationSeconds: raw.durationSeconds ?? null,
    unpricedRequestCount: raw.unpricedRequestCount,
    missingData: raw.missingData,
  };
}

function resolveBusinessOperationIdentity(
  tokenOrIdentity: string | BusinessIdentity,
): BusinessIdentity {
  if (typeof tokenOrIdentity !== 'string') {
    // The key helper performs strict shape/normalization validation.
    businessGroupKeyForIdentity(tokenOrIdentity);
    return tokenOrIdentity;
  }

  const decoded = decodeBusinessOperationToken(tokenOrIdentity);
  if (decoded.kind === 'invalid') {
    throw new BusinessQueryError(
      'INVALID_OPERATION_TOKEN',
      'Business Operation token is invalid',
    );
  }
  return decoded;
}

function validateDetailPage(page: number): number {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new BusinessQueryError('INVALID_FILTER', 'Page must be a positive integer');
  }
  return page;
}

function buildBusinessIdentityPredicate(identity: BusinessIdentity): SQL {
  const businessGroupKey = businessGroupKeyForIdentity(identity);
  if (identity.kind === 'standalone') {
    return sql`business_group_key = ${businessGroupKey}
      AND request_id = ${identity.requestId}
      AND normalized_reference IS NULL`;
  }

  if (identity.scope.kind === 'internal') {
    return sql`business_group_key = ${businessGroupKey}
      AND profile_scope_id IS NULL
      AND normalized_reference = ${identity.normalizedReference}`;
  }

  return sql`business_group_key = ${businessGroupKey}
    AND profile_scope_id = ${identity.scope.apiKeyId}
    AND normalized_reference = ${identity.normalizedReference}`;
}

async function setBusinessQueryStatementTimeout(
  transaction: BusinessQueryExecutor,
): Promise<void> {
  await transaction.execute(
    sql.raw(`SET LOCAL statement_timeout = '${BUSINESS_QUERY_STATEMENT_TIMEOUT_MS}ms'`),
  );
}

function mapBusinessOperationDetailResponse(
  rows: readonly BusinessOperationDetailSnapshotRow[],
  identity: BusinessIdentity,
  page: number,
): BusinessOperationDetailResponse {
  const row = rows[0];
  if (!row?.operation) {
    throw new BusinessQueryError(
      'BUSINESS_OPERATION_NOT_FOUND',
      'Business Operation was not found',
    );
  }

  const total = parseNonNegativeInteger(row.requestTotal, 'constituent request total');
  const operation = row.operation;
  const rawRequests = Array.isArray(row.requestItems) ? row.requestItems : [];

  return {
    queryTimestamp: normalizeIsoTimestamp(row.queryTimestamp),
    operation: {
      ...operation,
      token: encodeBusinessOperationToken(identity),
      startTime: normalizeIsoTimestamp(operation.startTime),
      updatedTime: normalizeIsoTimestamp(operation.updatedTime),
      endTime: operation.endTime === null
        ? null
        : normalizeIsoTimestamp(operation.endTime),
      totalCostUsd: normalizeFixedDecimal(operation.totalCostUsd),
    },
    requests: {
      items: rawRequests.map((request) => ({
        ...request,
        startedAt: normalizeIsoTimestamp(request.startedAt),
        completedAt: request.completedAt === null
          ? null
          : normalizeIsoTimestamp(request.completedAt),
        costUsd: request.costUsd === null
          ? null
          : normalizeFixedDecimal(request.costUsd),
      })),
      page,
      pageSize: 100,
      total,
      totalPages: Math.ceil(total / 100),
    },
  };
}

function mapBusinessOperationFilterOptions(
  rows: readonly BusinessOperationFilterOptionsRow[],
): BusinessOperationFilterOptions {
  const row = rows[0];
  if (!row) {
    throw new BusinessQueryError(
      'SNAPSHOT_METADATA_INVALID',
      'Business Operation filter options were not returned',
    );
  }

  return {
    profiles: Array.isArray(row.profiles) ? row.profiles : [],
    operationTypes: Array.isArray(row.operationTypes) ? row.operationTypes : [],
    hasInternalScope: row.hasInternalScope === true,
  };
}

function detailTelemetryCounters(
  row: BusinessOperationDetailSnapshotRow | undefined,
  response: BusinessOperationDetailResponse,
): BusinessQueryTelemetryCounters {
  return {
    resultCount: response.requests.total,
    scannedRequestCount: response.requests.total,
    unknownStateCount: parseOptionalNonNegativeInteger(
      row?.unknownStateCount,
      'detail unknown state count',
    ),
    missingMeasurementCount: parseOptionalNonNegativeInteger(
      row?.missingMeasurementCount,
      'detail missing measurement count',
    ),
    unpricedRequestCount: parseOptionalNonNegativeInteger(
      row?.telemetryUnpricedRequestCount,
      'detail unpriced request count',
    ),
    orphanSnapshotCount: parseOptionalNonNegativeInteger(
      row?.orphanSnapshotCount,
      'detail orphan snapshot count',
    ),
  };
}

function filterTelemetryCounters(
  row: BusinessOperationFilterOptionsRow | undefined,
  response: BusinessOperationFilterOptions,
): BusinessQueryTelemetryCounters {
  return {
    resultCount: response.profiles.length + response.operationTypes.length,
    scannedRequestCount: parseOptionalNonNegativeInteger(
      row?.scannedRequestCount,
      'filter scanned request count',
    ),
    unknownStateCount: parseOptionalNonNegativeInteger(
      row?.unknownStateCount,
      'filter unknown state count',
    ),
    missingMeasurementCount: parseOptionalNonNegativeInteger(
      row?.missingMeasurementCount,
      'filter missing measurement count',
    ),
    unpricedRequestCount: parseOptionalNonNegativeInteger(
      row?.telemetryUnpricedRequestCount,
      'filter unpriced request count',
    ),
    orphanSnapshotCount: parseOptionalNonNegativeInteger(
      row?.orphanSnapshotCount,
      'filter orphan snapshot count',
    ),
  };
}

interface BusinessQuerySuccessTelemetry {
  kind: BusinessOperationsQueryKind;
  authorization: BusinessQueryAuthorizationContext;
  durationMs: number;
  counters: BusinessQueryTelemetryCounters;
  metrics: BusinessOperationsMetricsEmitter;
  preset?: CalendarPreset;
  timezone?: string;
  queryTimestamp?: string;
  page?: number;
  searchHash?: string;
  referenceHash?: string;
}

function recordBusinessQuerySuccess(telemetry: BusinessQuerySuccessTelemetry): void {
  const labels = {
    queryKind: telemetry.kind,
    ...(telemetry.preset ? { preset: telemetry.preset } : {}),
  };
  const context = {
    queryKind: telemetry.kind,
    requestId: telemetry.authorization.requestId,
    actorId: telemetry.authorization.actorId,
    actorRole: telemetry.authorization.actorRole,
    profileScopeCount: profileScopeCount(telemetry.authorization.allowedProfileIds),
    preset: telemetry.preset,
    timezone: telemetry.timezone,
    queryTimestamp: telemetry.queryTimestamp,
    durationMs: telemetry.durationMs,
    page: telemetry.page,
    searchHash: telemetry.searchHash,
    referenceHash: telemetry.referenceHash,
    resultCount: telemetry.counters.resultCount,
    scannedRequestCount: telemetry.counters.scannedRequestCount,
    unknownStateCount: telemetry.counters.unknownStateCount,
    missingMeasurementCount: telemetry.counters.missingMeasurementCount,
    unpricedRequestCount: telemetry.counters.unpricedRequestCount,
    orphanSnapshotCount: telemetry.counters.orphanSnapshotCount,
    outcome: 'success',
  };
  const childLogger = businessOperationsLogger.child({
    requestId: telemetry.authorization.requestId,
    service: 'business-operations-dashboard',
  });

  if (telemetry.durationMs >= BUSINESS_OPERATIONS_SLOW_QUERY_MS) {
    childLogger.warn('Slow Business Operations query completed', context);
  } else {
    childLogger.info('Business Operations query completed', context);
  }

  emitBusinessOperationsMetric(
    telemetry.metrics,
    'business_operations_dashboard_duration_ms',
    telemetry.durationMs,
    labels,
  );
  emitBusinessOperationsMetric(
    telemetry.metrics,
    'business_operations_groups_returned',
    telemetry.counters.resultCount,
    labels,
  );
  emitBusinessOperationsMetric(
    telemetry.metrics,
    'business_operations_requests_scanned',
    telemetry.counters.scannedRequestCount,
    labels,
  );
  emitBusinessOperationsMetric(
    telemetry.metrics,
    'business_operations_unknown_state_total',
    telemetry.counters.unknownStateCount,
    labels,
  );
  emitBusinessOperationsMetric(
    telemetry.metrics,
    'business_operations_missing_measurements_total',
    telemetry.counters.missingMeasurementCount,
    labels,
  );
  emitBusinessOperationsMetric(
    telemetry.metrics,
    'business_operations_unpriced_requests_total',
    telemetry.counters.unpricedRequestCount,
    labels,
  );
  emitBusinessOperationsMetric(
    telemetry.metrics,
    'business_operations_orphan_snapshots_total',
    telemetry.counters.orphanSnapshotCount,
    labels,
  );
}

function recordBusinessQueryFailure(
  kind: BusinessOperationsQueryKind,
  authorization: BusinessQueryAuthorizationContext,
  durationMs: number,
  error: unknown,
  metrics: BusinessOperationsMetricsEmitter,
  context: { preset?: CalendarPreset; page?: number } = {},
): void {
  const safeFailure = safeBusinessOperationsFailure(error);
  businessOperationsLogger.child({
    requestId: authorization.requestId,
    service: 'business-operations-dashboard',
  }).error('Business Operations query failed', {
    queryKind: kind,
    requestId: authorization.requestId,
    actorId: authorization.actorId,
    actorRole: authorization.actorRole,
    profileScopeCount: profileScopeCount(authorization.allowedProfileIds),
    preset: context.preset,
    page: context.page,
    durationMs,
    ...safeFailure,
  });

  emitBusinessOperationsMetric(
    metrics,
    'business_operations_dashboard_duration_ms',
    durationMs,
    {
      queryKind: kind,
      outcome: safeFailure.timeout === true ? 'timeout' : 'failure',
      ...(context.preset ? { preset: context.preset } : {}),
    },
  );
}

function elapsedMilliseconds(startedAt: number, finishedAt: number): number {
  return Math.max(0, Math.round(finishedAt - startedAt));
}

function parseOptionalNonNegativeInteger(
  value: number | string | undefined,
  label: string,
): number {
  return value === undefined ? 0 : parseNonNegativeInteger(value, label);
}

function normalizeFixedDecimal(value: string): string {
  const text = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new BusinessQueryError('SNAPSHOT_METADATA_INVALID', 'Dashboard cost is not decimal');
  }
  const fraction = match[3] ?? '';
  if (fraction.length > 10) {
    throw new BusinessQueryError('SNAPSHOT_METADATA_INVALID', 'Dashboard cost scale exceeds 10');
  }
  return `${match[1]}${match[2]}.${fraction.padEnd(10, '0')}`;
}

function normalizeIsoTimestamp(value: string | Date): string {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BusinessQueryError(
      'SNAPSHOT_METADATA_INVALID',
      'Dashboard timestamp is invalid',
    );
  }
  return parsed.toISOString();
}

function normalizeNonNegativeIntegerText(value: number | string, label: string): string {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new BusinessQueryError('SNAPSHOT_METADATA_INVALID', `${label} is invalid`);
  }
  return BigInt(text).toString();
}

function parseNonNegativeInteger(value: number | string, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new BusinessQueryError('SNAPSHOT_METADATA_INVALID', `${label} is invalid`);
  }
  return parsed;
}

export function getBusinessOperationsDashboardSnapshot(
  input: BusinessOperationsQueryInput,
  authorization: BusinessQueryAuthorizationContext,
  options?: BusinessDashboardExecutionOptions,
): Promise<BusinessOperationsDashboardResponse> {
  return defaultBusinessOperationQueryService.getDashboardSnapshot(input, authorization, options);
}

export function getBusinessOperationDetail(
  tokenOrIdentity: string | BusinessIdentity,
  page: number,
  authorization: BusinessQueryAuthorizationContext,
): Promise<BusinessOperationDetailResponse> {
  return defaultBusinessOperationQueryService.getBusinessOperationDetail(
    tokenOrIdentity,
    page,
    authorization,
  );
}

export function getBusinessOperationFilterOptions(
  authorization: BusinessQueryAuthorizationContext,
): Promise<BusinessOperationFilterOptions> {
  return defaultBusinessOperationQueryService.getFilterOptions(authorization);
}
