import {
  groupBusinessOperationRequests,
  normalizeReference,
  profileScopeFromApiKeyId,
  type BusinessIdentity,
  type BusinessOperationIdentitySource,
  type ProfileScope,
} from './business-key';
import {
  aggregateCurrentStatus,
  resolveDisplayedStatus,
  type BusinessStatus,
  type ValidBusinessStatus,
} from './status';

export interface OperationRequestProjectionSource extends BusinessOperationIdentitySource {
  endpointSlug: string | null;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
  hiddenFromOperations: boolean;
}

/**
 * Request-level fields used by grouping, filtering, and time projections.
 * The source row remains available so later aggregate helpers can consume
 * canonical measurements without rebuilding group membership.
 */
export interface RequestProjection<
  TSource extends OperationRequestProjectionSource = OperationRequestProjectionSource,
> {
  requestId: string;
  businessGroupKey: string;
  profileScope: ProfileScope;
  normalizedReference: string | null;
  operationType: string | null;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  source: TSource;
}

export interface BusinessOperationProjection<
  TSource extends OperationRequestProjectionSource = OperationRequestProjectionSource,
> {
  businessGroupKey: string;
  identity: BusinessIdentity;
  operationIdentifier: string;
  normalizedReference: string | null;
  profileScope: ProfileScope;
  operationTypes: string[];
  businessStatus: BusinessStatus;
  invalidData: boolean;
  requestCount: number;
  startTime: Date;
  updatedTime: Date;
  endTime: Date | null;
  durationSeconds: number | null;
  requests: RequestProjection<TSource>[];
}

export type BusinessOperationListProjection = Omit<
  BusinessOperationProjection,
  'endTime' | 'durationSeconds' | 'requests'
>;

export interface BusinessOperationDetailProjection<
  TSource extends OperationRequestProjectionSource = OperationRequestProjectionSource,
> extends BusinessOperationListProjection {
  endTime: Date | null;
  durationSeconds: number | null;
  requests: RequestProjection<TSource>[];
}

export interface BusinessOperationTimeWindow {
  start: Date;
  end: Date;
  startInclusive: boolean;
  endInclusive: boolean;
}

export interface BusinessOperationFilter {
  timeWindow: BusinessOperationTimeWindow;
  profileScope: ProfileScope | 'ALL';
  operationType: string | 'ALL';
  businessStatus: BusinessStatus | 'ALL';
}

export interface ProjectBusinessOperationsOptions {
  lastValidStatusByBusinessGroupKey?: ReadonlyMap<string, ValidBusinessStatus>;
}

/** Soft-deleted and internal-hidden rows never participate in grouping. */
export function isEligibleOperationRequest(
  request: OperationRequestProjectionSource,
): boolean {
  return request.deletedAt === null && !request.hiddenFromOperations;
}

/**
 * Builds a deterministic request/business partition from currently eligible
 * source rows. Constituents are sorted by source creation time and request ID;
 * groups and operation types use binary ordering.
 */
export function projectBusinessOperations<
  TSource extends OperationRequestProjectionSource,
>(
  sourceRequests: readonly TSource[],
  options: ProjectBusinessOperationsOptions = {},
): BusinessOperationProjection<TSource>[] {
  const eligibleRequests = sourceRequests.filter(isEligibleOperationRequest);
  const groups = groupBusinessOperationRequests(eligibleRequests);
  const lastValidStatuses = options.lastValidStatusByBusinessGroupKey;

  return groups.map((group) => {
    const requests = group.requests
      .map((request) => createRequestProjection(request, group.businessGroupKey))
      .sort(compareRequestProjections);
    const states = requests.map((request) => request.state);
    const currentStatus = aggregateCurrentStatus(states);
    const displayedStatus = resolveDisplayedStatus(
      states,
      lastValidStatuses?.get(group.businessGroupKey) ?? null,
    );
    const startTime = minRequestDate(requests, 'createdAt');
    const updatedTime = maxRequestDate(requests, 'updatedAt');
    const endTime = currentStatus === 'SUCCEEDED' || currentStatus === 'FAILED'
      ? maxTerminalCompletionDate(requests)
      : null;

    return {
      businessGroupKey: group.businessGroupKey,
      identity: group.identity,
      operationIdentifier: group.operationIdentifier,
      normalizedReference: group.identity.kind === 'referenced'
        ? group.identity.normalizedReference
        : null,
      profileScope: requests[0].profileScope,
      operationTypes: uniqueOperationTypes(requests),
      businessStatus: displayedStatus.status,
      invalidData: displayedStatus.invalidData,
      requestCount: requests.length,
      startTime,
      updatedTime,
      endTime,
      durationSeconds: endTime === null
        ? null
        : (endTime.getTime() - startTime.getTime()) / 1_000,
      requests,
    };
  });
}

/**
 * Applies dashboard predicates as a logical intersection on already-complete
 * business groups. An operation-type match selects the group; it never removes
 * constituents of other types from that group.
 */
export function filterBusinessOperations<
  TSource extends OperationRequestProjectionSource,
>(
  operations: readonly BusinessOperationProjection<TSource>[],
  filter: BusinessOperationFilter,
): BusinessOperationProjection<TSource>[] {
  validateTimeWindow(filter.timeWindow);

  return operations.filter((operation) => (
    isWithinTimeWindow(operation.startTime, filter.timeWindow)
      && matchesProfileScope(operation.profileScope, filter.profileScope)
      && (filter.operationType === 'ALL'
        || operation.operationTypes.includes(filter.operationType))
      && (filter.businessStatus === 'ALL'
        || operation.businessStatus === filter.businessStatus)
  ));
}

export function createBusinessOperationListProjection<
  TSource extends OperationRequestProjectionSource,
>(operation: BusinessOperationProjection<TSource>): BusinessOperationListProjection {
  return {
    businessGroupKey: operation.businessGroupKey,
    identity: operation.identity,
    operationIdentifier: operation.operationIdentifier,
    normalizedReference: operation.normalizedReference,
    profileScope: operation.profileScope,
    operationTypes: [...operation.operationTypes],
    businessStatus: operation.businessStatus,
    invalidData: operation.invalidData,
    requestCount: operation.requestCount,
    startTime: new Date(operation.startTime),
    updatedTime: new Date(operation.updatedTime),
  };
}

export function createBusinessOperationDetailProjection<
  TSource extends OperationRequestProjectionSource,
>(operation: BusinessOperationProjection<TSource>): BusinessOperationDetailProjection<TSource> {
  return {
    ...createBusinessOperationListProjection(operation),
    endTime: operation.endTime ? new Date(operation.endTime) : null,
    durationSeconds: operation.durationSeconds,
    requests: operation.requests.map(cloneRequestProjection),
  };
}

function createRequestProjection<TSource extends OperationRequestProjectionSource>(
  source: TSource,
  businessGroupKey: string,
): RequestProjection<TSource> {
  return {
    requestId: source.id,
    businessGroupKey,
    profileScope: profileScopeFromApiKeyId(source.apiKeyId),
    normalizedReference: normalizeReference(source.clientReference),
    operationType: source.endpointSlug,
    state: source.state,
    createdAt: cloneValidDate(source.createdAt, `${source.id}.createdAt`),
    updatedAt: cloneValidDate(source.updatedAt, `${source.id}.updatedAt`),
    completedAt: source.completedAt === null
      ? null
      : cloneValidDate(source.completedAt, `${source.id}.completedAt`),
    source,
  };
}

function cloneRequestProjection<TSource extends OperationRequestProjectionSource>(
  request: RequestProjection<TSource>,
): RequestProjection<TSource> {
  return {
    ...request,
    profileScope: request.profileScope.kind === 'internal'
      ? { kind: 'internal' }
      : { kind: 'profile', apiKeyId: request.profileScope.apiKeyId },
    createdAt: new Date(request.createdAt),
    updatedAt: new Date(request.updatedAt),
    completedAt: request.completedAt ? new Date(request.completedAt) : null,
  };
}

function uniqueOperationTypes(
  requests: readonly RequestProjection[],
): string[] {
  return [...new Set(
    requests
      .map((request) => request.operationType)
      .filter((value): value is string => value !== null),
  )].sort(compareBinary);
}

function compareRequestProjections(
  left: RequestProjection,
  right: RequestProjection,
): number {
  const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
  return byCreatedAt !== 0 ? byCreatedAt : compareBinary(left.requestId, right.requestId);
}

function minRequestDate(
  requests: readonly RequestProjection[],
  field: 'createdAt' | 'updatedAt',
): Date {
  return new Date(Math.min(...requests.map((request) => request[field].getTime())));
}

function maxRequestDate(
  requests: readonly RequestProjection[],
  field: 'createdAt' | 'updatedAt',
): Date {
  return new Date(Math.max(...requests.map((request) => request[field].getTime())));
}

function maxTerminalCompletionDate(
  requests: readonly RequestProjection[],
): Date {
  // completedAt is canonical. updatedAt is a defensive fallback for legacy
  // terminal rows that predate terminal timestamp persistence.
  return new Date(Math.max(...requests.map((request) => (
    request.completedAt ?? request.updatedAt
  ).getTime())));
}

function matchesProfileScope(
  actual: ProfileScope,
  selected: ProfileScope | 'ALL',
): boolean {
  if (selected === 'ALL') return true;
  if (actual.kind !== selected.kind) return false;
  return actual.kind === 'internal'
    || actual.apiKeyId === (selected as Extract<ProfileScope, { kind: 'profile' }>).apiKeyId;
}

function isWithinTimeWindow(
  value: Date,
  window: BusinessOperationTimeWindow,
): boolean {
  const timestamp = value.getTime();
  const afterStart = window.startInclusive
    ? timestamp >= window.start.getTime()
    : timestamp > window.start.getTime();
  const beforeEnd = window.endInclusive
    ? timestamp <= window.end.getTime()
    : timestamp < window.end.getTime();
  return afterStart && beforeEnd;
}

function validateTimeWindow(window: BusinessOperationTimeWindow): void {
  const start = cloneValidDate(window.start, 'timeWindow.start');
  const end = cloneValidDate(window.end, 'timeWindow.end');
  if (start.getTime() > end.getTime()) {
    throw new RangeError('Business Operation time window start must not be after end');
  }
}

function cloneValidDate(value: Date, label: string): Date {
  const timestamp = value.getTime();
  if (Number.isNaN(timestamp)) {
    throw new RangeError(`${label} must be a valid Date`);
  }
  return new Date(timestamp);
}

function compareBinary(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
