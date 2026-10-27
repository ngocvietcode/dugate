import {
  BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS,
  type BusinessOperationSearchMode,
  type BusinessOperationTrendPoint,
  type BusinessOperationsDashboardFilter,
  type BusinessOperationsFilterState,
  type BusinessStatusFilter,
  type BusinessTrendStatus,
} from '../types';

export const ALL_BUSINESS_OPERATIONS_FILTER = 'ALL' as const;
export const INTERNAL_PROFILE_FILTER = '__internal__' as const;
export const MAX_BUSINESS_OPERATION_SEARCH_CHARACTERS = 256;

export const BUSINESS_OPERATION_SEARCH_MODE_OPTIONS: ReadonlyArray<{
  value: BusinessOperationSearchMode;
  label: string;
}> = [
  { value: 'exact', label: 'Chính xác (Reference / Request ID)' },
  { value: 'contains', label: 'Chứa chuỗi (chỉ Reference ID)' },
];

export function formatBusinessOperationsTimezoneLabel(calendarTimezone: string): string {
  return `Ranh giới lịch theo múi giờ máy chủ: ${calendarTimezone}`;
}

export interface BusinessOperationProfileFilterOption {
  id: string | null;
  name: string;
}

export interface BusinessOperationsFilterOptions {
  profiles: readonly BusinessOperationProfileFilterOption[];
  operationTypes: readonly string[];
}

export type BusinessOperationsFilterValidationError =
  | 'INVALID_RANGE'
  | 'FORBIDDEN_PROFILE'
  | 'INVALID_OPERATION_TYPE'
  | 'INVALID_STATUS'
  | 'INVALID_SEARCH_MODE'
  | 'EMPTY_SEARCH'
  | 'SEARCH_TOO_LONG';

export type BusinessOperationSearchValidation =
  | { valid: true; query: string }
  | { valid: false; reason: 'EMPTY_SEARCH' | 'SEARCH_TOO_LONG' };

export type BusinessOperationsFilterSubmission =
  | {
      accepted: true;
      draft: BusinessOperationsFilterState;
      requestFilter: BusinessOperationsDashboardFilter;
      nextUrl: URLSearchParams;
    }
  | {
      accepted: false;
      draft: BusinessOperationsFilterState;
      appliedFilter: BusinessOperationsDashboardFilter;
      error: BusinessOperationsFilterValidationError;
    };

export interface BusinessOperationsTrendDrillDownBucket {
  start: string;
  end: string;
  startInclusive: true;
  endInclusive: boolean;
  status: BusinessTrendStatus;
}

export interface BusinessOperationsTrendDrillDown {
  filter: BusinessOperationsDashboardFilter;
  bucket: BusinessOperationsTrendDrillDownBucket;
}

/** State shape reusable by the future dashboard hook without coupling this task to fetching. */
export interface BusinessOperationsAppliedState<TData> {
  draft: BusinessOperationsFilterState;
  appliedFilter: BusinessOperationsDashboardFilter;
  appliedUrl: string;
  lastSuccessfulData: TData;
  validationError: BusinessOperationsFilterValidationError | null;
}

const BUSINESS_STATUS_FILTERS: readonly BusinessStatusFilter[] = [
  'ALL',
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED',
  'N/A',
];

const BUSINESS_SEARCH_MODES: readonly BusinessOperationSearchMode[] =
  BUSINESS_OPERATION_SEARCH_MODE_OPTIONS.map((option) => option.value);

/** Search limits are measured in Unicode code points, matching server validation. */
export function validateBusinessOperationSearchInput(
  rawQuery: string,
): BusinessOperationSearchValidation {
  const query = rawQuery.trim();
  if (!query) return { valid: false, reason: 'EMPTY_SEARCH' };
  if (Array.from(query).length > MAX_BUSINESS_OPERATION_SEARCH_CHARACTERS) {
    return { valid: false, reason: 'SEARCH_TOO_LONG' };
  }
  return { valid: true, query };
}

export function businessOperationsDraftFromApplied(
  applied: BusinessOperationsDashboardFilter,
): BusinessOperationsFilterState {
  return {
    range: applied.range,
    profile: applied.profile,
    operationType: applied.operationType,
    status: applied.status,
    query: applied.search?.query ?? '',
    searchMode: applied.search?.mode ?? 'exact',
    sort: applied.sort,
    page: applied.page,
  };
}

/**
 * Validates a draft without mutating the server-confirmed filter or URL.
 * `search` requires a nonblank query; `filters` permits an empty query so users
 * can clear search while applying another filter.
 */
export function prepareBusinessOperationsFilterSubmission(
  draft: BusinessOperationsFilterState,
  appliedFilter: BusinessOperationsDashboardFilter,
  options: BusinessOperationsFilterOptions,
  intent: 'filters' | 'search' = 'filters',
): BusinessOperationsFilterSubmission {
  const ranges = BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS.map((option) => option.value);
  if (!ranges.includes(draft.range)) {
    return rejectSubmission(draft, appliedFilter, 'INVALID_RANGE');
  }

  const allowedProfiles = new Set<string>([
    ALL_BUSINESS_OPERATIONS_FILTER,
    ...options.profiles.map((profile) => profile.id ?? INTERNAL_PROFILE_FILTER),
  ]);
  if (!allowedProfiles.has(draft.profile)) {
    return rejectSubmission(draft, appliedFilter, 'FORBIDDEN_PROFILE');
  }

  if (
    draft.operationType !== ALL_BUSINESS_OPERATIONS_FILTER
    && !options.operationTypes.includes(draft.operationType)
  ) {
    return rejectSubmission(draft, appliedFilter, 'INVALID_OPERATION_TYPE');
  }

  if (!BUSINESS_STATUS_FILTERS.includes(draft.status)) {
    return rejectSubmission(draft, appliedFilter, 'INVALID_STATUS');
  }

  if (!BUSINESS_SEARCH_MODES.includes(draft.searchMode)) {
    return rejectSubmission(draft, appliedFilter, 'INVALID_SEARCH_MODE');
  }

  const rawQuery = draft.query;
  const hasQuery = rawQuery.trim().length > 0;
  if (intent === 'search' || hasQuery) {
    const search = validateBusinessOperationSearchInput(rawQuery);
    if (!search.valid) return rejectSubmission(draft, appliedFilter, search.reason);

    const canonicalDraft = { ...draft, query: search.query, page: 1 };
    const requestFilter: BusinessOperationsDashboardFilter = {
      range: canonicalDraft.range,
      profile: canonicalDraft.profile,
      operationType: canonicalDraft.operationType,
      status: canonicalDraft.status,
      search: { query: search.query, mode: canonicalDraft.searchMode },
      sort: canonicalDraft.sort,
      page: 1,
    };
    return {
      accepted: true,
      draft: canonicalDraft,
      requestFilter,
      nextUrl: serializeBusinessOperationsFilter(requestFilter),
    };
  }

  const canonicalDraft = { ...draft, query: '', page: 1 };
  const requestFilter: BusinessOperationsDashboardFilter = {
    range: canonicalDraft.range,
    profile: canonicalDraft.profile,
    operationType: canonicalDraft.operationType,
    status: canonicalDraft.status,
    search: null,
    sort: canonicalDraft.sort,
    page: 1,
  };
  return {
    accepted: true,
    draft: canonicalDraft,
    requestFilter,
    nextUrl: serializeBusinessOperationsFilter(requestFilter),
  };
}

export function serializeBusinessOperationsFilter(
  filter: BusinessOperationsDashboardFilter,
  drillDown?: BusinessOperationsTrendDrillDownBucket,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('range', filter.range);
  params.set('profile', filter.profile);
  params.set('operation_type', filter.operationType);
  params.set('status', filter.status);
  params.set('sort', filter.sort);
  params.set('page', String(filter.page));

  if (filter.search) {
    params.set('q', filter.search.query);
    params.set('search_mode', filter.search.mode);
  }
  if (drillDown) {
    params.set('bucket_start', drillDown.start);
    params.set('bucket_end', drillDown.end);
    params.set('bucket_end_inclusive', String(drillDown.endInclusive));
  }
  return params;
}

/**
 * Creates list drill-down state while preserving the applied profile/type (and
 * search/range), then adding the clicked calendar bucket and business status.
 */
export function createBusinessOperationsTrendDrillDown(
  appliedFilter: BusinessOperationsDashboardFilter,
  point: Pick<BusinessOperationTrendPoint, 'start' | 'end' | 'endInclusive'>,
  status: BusinessTrendStatus,
): BusinessOperationsTrendDrillDown {
  return {
    filter: {
      ...appliedFilter,
      status,
      page: 1,
    },
    bucket: {
      start: point.start,
      end: point.end,
      startInclusive: true,
      endInclusive: point.endInclusive,
      status,
    },
  };
}

/**
 * Failure path used by invalid client input and server 403 responses. Applied
 * URL/filter/data stay referentially unchanged; only the editable draft/error move.
 */
export function retainAppliedBusinessOperationsState<TData>(
  current: BusinessOperationsAppliedState<TData>,
  attemptedDraft: BusinessOperationsFilterState,
  error: BusinessOperationsFilterValidationError,
): BusinessOperationsAppliedState<TData> {
  return {
    ...current,
    draft: attemptedDraft,
    validationError: error,
  };
}

export function isBusinessOperationsDraftDirty(
  draft: BusinessOperationsFilterState,
  applied: BusinessOperationsDashboardFilter,
): boolean {
  const appliedDraft = businessOperationsDraftFromApplied(applied);
  return draft.range !== appliedDraft.range
    || draft.profile !== appliedDraft.profile
    || draft.operationType !== appliedDraft.operationType
    || draft.status !== appliedDraft.status
    || draft.query !== appliedDraft.query
    || draft.searchMode !== appliedDraft.searchMode
    || draft.sort !== appliedDraft.sort;
}

function rejectSubmission(
  draft: BusinessOperationsFilterState,
  appliedFilter: BusinessOperationsDashboardFilter,
  error: BusinessOperationsFilterValidationError,
): BusinessOperationsFilterSubmission {
  return { accepted: false, draft, appliedFilter, error };
}
