import {
  type BusinessOperationProjection,
  type OperationRequestProjectionSource,
  type RequestProjection,
} from './projection';
import { classifyRequestState, type BusinessStatus } from './status';
import {
  buildCalendarBuckets,
  type CalendarBucket,
  type ResolvedTimeWindow,
} from './time-window';

export const MAX_SEARCH_QUERY_CHARACTERS = 256;
export const BUSINESS_OPERATION_LIST_PAGE_SIZE = 50 as const;
export const CONSTITUENT_REQUEST_PAGE_SIZE = 100 as const;

export type BusinessOperationSearchMode = 'exact' | 'contains';
export type SearchValidationFailure = 'EMPTY' | 'TOO_LONG';

export type SearchValidationResult =
  | { valid: true; query: string }
  | { valid: false; reason: SearchValidationFailure };

export type BusinessOperationSearchResult<
  TSource extends OperationRequestProjectionSource,
> =
  | {
    valid: true;
    query: string;
    items: BusinessOperationProjection<TSource>[];
  }
  | {
    valid: false;
    reason: SearchValidationFailure;
  };

export interface FixedPage<T, TPageSize extends number> {
  items: T[];
  page: number;
  pageSize: TPageSize;
  total: number;
  totalPages: number;
}

export interface OperationalDetailSource extends OperationRequestProjectionSource {
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCostUsd: string | number | null;
  inputTokensMissing: boolean;
  outputTokensMissing: boolean;
  costMissing: boolean;
  hasUnpricedCost: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export type NullDisplayMetadata = 'VALUE' | 'MISSING' | 'PROCESSING';

/**
 * Explicitly allowlisted constituent shape. Source payload fields such as
 * filesJson, pipelineJson, extractedData, and outputContent cannot enter this
 * projection even when they are present on the source object.
 */
export interface ConstituentRequestDetailItem {
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
  nullDisplay: {
    operationType: NullDisplayMetadata;
    completedAt: NullDisplayMetadata;
    inputTokens: NullDisplayMetadata;
    outputTokens: NullDisplayMetadata;
    costUsd: NullDisplayMetadata;
    errorCode: NullDisplayMetadata;
    errorMessage: NullDisplayMetadata;
  };
}

export type TrendSeriesStatus = Exclude<BusinessStatus, 'N/A'>;

export interface BusinessOperationTrendPoint {
  unit: CalendarBucket['unit'];
  localKey: string;
  occurrence: number;
  start: Date;
  end: Date;
  startInclusive: true;
  endInclusive: boolean;
  clippedStart: boolean;
  clippedEnd: boolean;
  counts: Record<TrendSeriesStatus, number>;
  total: number;
}

export interface TrendDrillDownPredicate {
  start: Date;
  end: Date;
  startInclusive: true;
  endInclusive: boolean;
  businessStatus: TrendSeriesStatus;
}

/** Trims and validates a search by Unicode code points, not UTF-16 units. */
export function validateBusinessOperationSearchQuery(
  rawQuery: string,
): SearchValidationResult {
  const query = rawQuery.trim();
  if (query.length === 0) {
    return { valid: false, reason: 'EMPTY' };
  }
  if (Array.from(query).length > MAX_SEARCH_QUERY_CHARACTERS) {
    return { valid: false, reason: 'TOO_LONG' };
  }
  return { valid: true, query };
}

/**
 * Searches only the supplied (therefore already authorized) operation set.
 * Exact mode matches a normalized reference or an exact constituent request ID;
 * contains mode applies case-insensitive matching to normalized references only.
 */
export function searchBusinessOperations<
  TSource extends OperationRequestProjectionSource,
>(
  authorizedOperations: readonly BusinessOperationProjection<TSource>[],
  rawQuery: string,
  mode: BusinessOperationSearchMode,
): BusinessOperationSearchResult<TSource> {
  const validation = validateBusinessOperationSearchQuery(rawQuery);
  if (!validation.valid) {
    return validation;
  }

  const { query } = validation;
  const foldedQuery = query.toLowerCase();
  const items = authorizedOperations.filter((operation) => {
    if (mode === 'contains') {
      return operation.normalizedReference?.toLowerCase().includes(foldedQuery) ?? false;
    }

    return operation.normalizedReference === query
      || operation.requests.some((request) => request.requestId === query);
  });

  return { valid: true, query, items: [...items] };
}

/** Default list order: updated time descending, then binary identifier ascending. */
export function orderBusinessOperations<
  TSource extends OperationRequestProjectionSource,
>(
  operations: readonly BusinessOperationProjection<TSource>[],
): BusinessOperationProjection<TSource>[] {
  return [...operations].sort((left, right) => {
    const byUpdatedTime = right.updatedTime.getTime() - left.updatedTime.getTime();
    if (byUpdatedTime !== 0) return byUpdatedTime;

    const byIdentifier = compareBinary(
      left.operationIdentifier,
      right.operationIdentifier,
    );
    if (byIdentifier !== 0) return byIdentifier;

    // Identifiers can repeat across profile scopes. The grouping key provides a
    // stable final order without changing either mandated primary sort key.
    return compareBinary(left.businessGroupKey, right.businessGroupKey);
  });
}

export function createBusinessOperationListPage<
  TSource extends OperationRequestProjectionSource,
>(
  authorizedOperations: readonly BusinessOperationProjection<TSource>[],
  page: number,
): FixedPage<BusinessOperationProjection<TSource>, 50> {
  return paginateFixed(
    orderBusinessOperations(authorizedOperations),
    page,
    BUSINESS_OPERATION_LIST_PAGE_SIZE,
  );
}

export function mapConstituentRequestDetail<
  TSource extends OperationalDetailSource,
>(request: RequestProjection<TSource>): ConstituentRequestDetailItem {
  const source = request.source;
  const costUsd = serializeNullableDecimal(source.totalCostUsd);
  const active = classifyRequestState(request.state) === 'ACTIVE';
  const completedAtDisplay: NullDisplayMetadata = request.completedAt
    ? 'VALUE'
    : active
      ? 'PROCESSING'
      : 'MISSING';
  const missingData = source.inputTokensMissing
    || source.outputTokensMissing
    || source.costMissing
    || source.totalInputTokens === null
    || source.totalOutputTokens === null
    || source.totalCostUsd === null;

  return {
    id: request.requestId,
    operationType: request.operationType,
    state: request.state,
    startedAt: request.createdAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
    inputTokens: source.totalInputTokens,
    outputTokens: source.totalOutputTokens,
    costUsd,
    errorCode: source.errorCode,
    errorMessage: source.errorMessage,
    missingData,
    unpricedCost: source.hasUnpricedCost,
    nullDisplay: {
      operationType: displayForNullable(request.operationType),
      completedAt: completedAtDisplay,
      inputTokens: displayForNullable(source.totalInputTokens),
      outputTokens: displayForNullable(source.totalOutputTokens),
      costUsd: displayForNullable(costUsd),
      errorCode: displayForNullable(source.errorCode),
      errorMessage: displayForNullable(source.errorMessage),
    },
  };
}

/** Detail rows are sorted by createdAt ASC, request ID ASC and fixed at 100/page. */
export function createConstituentRequestDetailPage<
  TSource extends OperationalDetailSource,
>(
  authorizedOperation: BusinessOperationProjection<TSource>,
  page: number,
): FixedPage<ConstituentRequestDetailItem, 100> {
  const ordered = [...authorizedOperation.requests].sort((left, right) => {
    const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
    return byCreatedAt !== 0
      ? byCreatedAt
      : compareBinary(left.requestId, right.requestId);
  });

  return paginateFixed(
    ordered.map(mapConstituentRequestDetail),
    page,
    CONSTITUENT_REQUEST_PAGE_SIZE,
  );
}

/**
 * Produces every local calendar bucket, including zero buckets, and assigns each
 * valid-status operation exactly once according to Operation_Start_Time.
 */
export function buildBusinessOperationTrend<
  TSource extends OperationRequestProjectionSource,
>(
  filteredOperations: readonly BusinessOperationProjection<TSource>[],
  window: ResolvedTimeWindow,
): BusinessOperationTrendPoint[] {
  const buckets = buildCalendarBuckets(window);
  const points = buckets.map(createEmptyTrendPoint);

  for (const operation of filteredOperations) {
    if (!isTrendSeriesStatus(operation.businessStatus)) continue;

    const point = points.find((candidate) => isWithinInterval(
      operation.startTime,
      candidate,
    ));
    if (!point) continue;

    point.counts[operation.businessStatus] += 1;
    point.total += 1;
  }

  return points;
}

/**
 * Returns a composable bucket/status predicate. Apply it to the already-filtered
 * profile/type operation set so a chart drill-down preserves those predicates.
 */
export function createTrendDrillDownPredicate(
  point: BusinessOperationTrendPoint,
  businessStatus: TrendSeriesStatus,
): TrendDrillDownPredicate {
  return {
    start: new Date(point.start),
    end: new Date(point.end),
    startInclusive: true,
    endInclusive: point.endInclusive,
    businessStatus,
  };
}

export function matchesTrendDrillDown<
  TSource extends OperationRequestProjectionSource,
>(
  operation: BusinessOperationProjection<TSource>,
  predicate: TrendDrillDownPredicate,
): boolean {
  return operation.businessStatus === predicate.businessStatus
    && isWithinInterval(operation.startTime, predicate);
}

function createEmptyTrendPoint(bucket: CalendarBucket): BusinessOperationTrendPoint {
  return {
    unit: bucket.unit,
    localKey: bucket.localKey,
    occurrence: bucket.occurrence,
    start: new Date(bucket.start),
    end: new Date(bucket.end),
    startInclusive: true,
    endInclusive: bucket.endInclusive,
    clippedStart: bucket.clippedStart,
    clippedEnd: bucket.clippedEnd,
    counts: {
      IN_PROGRESS: 0,
      SUCCEEDED: 0,
      FAILED: 0,
    },
    total: 0,
  };
}

function isTrendSeriesStatus(status: BusinessStatus): status is TrendSeriesStatus {
  return status === 'IN_PROGRESS' || status === 'SUCCEEDED' || status === 'FAILED';
}

function isWithinInterval(
  value: Date,
  interval: {
    start: Date;
    end: Date;
    startInclusive: boolean;
    endInclusive: boolean;
  },
): boolean {
  const timestamp = value.getTime();
  const afterStart = interval.startInclusive
    ? timestamp >= interval.start.getTime()
    : timestamp > interval.start.getTime();
  const beforeEnd = interval.endInclusive
    ? timestamp <= interval.end.getTime()
    : timestamp < interval.end.getTime();
  return afterStart && beforeEnd;
}

function paginateFixed<T, TPageSize extends number>(
  orderedItems: readonly T[],
  page: number,
  pageSize: TPageSize,
): FixedPage<T, TPageSize> {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError('Page must be a positive safe integer');
  }

  const total = orderedItems.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  return {
    items: orderedItems.slice(offset, offset + pageSize),
    page,
    pageSize,
    total,
    totalPages,
  };
}

function serializeNullableDecimal(value: string | number | null): string | null {
  if (value === null) return null;

  const serialized = typeof value === 'number' ? String(value) : value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(serialized)) {
    throw new RangeError('Constituent request cost must be a finite decimal');
  }
  return serialized;
}

function displayForNullable(value: unknown): NullDisplayMetadata {
  return value === null ? 'MISSING' : 'VALUE';
}

function compareBinary(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
