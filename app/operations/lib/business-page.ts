import {
  DEFAULT_BUSINESS_OPERATIONS_FILTER,
} from '../hooks/useBusinessOperationsDashboard';
import type {
  BusinessOperationDetailResponse,
  BusinessOperationSearchMode,
  BusinessOperationSort,
  BusinessOperationsFilterState,
  BusinessOperationsTimeRange,
  BusinessStatusFilter,
} from '../types';

const TIME_RANGES = new Set<BusinessOperationsTimeRange>([
  'today',
  'this_month',
  'last_month',
  'three_month_trend',
]);
const BUSINESS_STATUSES = new Set<BusinessStatusFilter>([
  'ALL',
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED',
  'N/A',
]);
const SEARCH_MODES = new Set<BusinessOperationSearchMode>(['exact', 'contains']);
const LIST_SORTS = new Set<BusinessOperationSort>(['recent', 'duration', 'tokens', 'cost']);

export function parseBusinessOperationsPageFilter(
  searchParams: Pick<URLSearchParams, 'get'>,
): BusinessOperationsFilterState {
  const range = searchParams.get('range') as BusinessOperationsTimeRange | null;
  const status = searchParams.get('status') as BusinessStatusFilter | null;
  const searchMode = searchParams.get('search_mode') as BusinessOperationSearchMode | null;
  const sort = searchParams.get('sort') as BusinessOperationSort | null;
  const rawPage = searchParams.get('page');
  const parsedPage = rawPage === null ? 1 : Number(rawPage);

  return {
    range: range !== null && TIME_RANGES.has(range)
      ? range
      : DEFAULT_BUSINESS_OPERATIONS_FILTER.range,
    profile: searchParams.get('profile')?.trim() || DEFAULT_BUSINESS_OPERATIONS_FILTER.profile,
    operationType: searchParams.get('operation_type')?.trim()
      || DEFAULT_BUSINESS_OPERATIONS_FILTER.operationType,
    status: status !== null && BUSINESS_STATUSES.has(status)
      ? status
      : DEFAULT_BUSINESS_OPERATIONS_FILTER.status,
    query: searchParams.get('q') ?? '',
    searchMode: searchMode !== null && SEARCH_MODES.has(searchMode)
      ? searchMode
      : DEFAULT_BUSINESS_OPERATIONS_FILTER.searchMode,
    sort: sort !== null && LIST_SORTS.has(sort)
      ? sort
      : DEFAULT_BUSINESS_OPERATIONS_FILTER.sort,
    page: Number.isSafeInteger(parsedPage) && parsedPage >= 1
      ? parsedPage
      : DEFAULT_BUSINESS_OPERATIONS_FILTER.page,
  };
}

export function apiProblemMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null || !('error' in body)) return fallback;
  const error = body.error;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

export interface BusinessOperationDetailState {
  token: string | null;
  page: number;
  response: BusinessOperationDetailResponse | null;
  loading: boolean;
  error: string | null;
  activeSequence: number | null;
}

export type BusinessOperationDetailAction =
  | { type: 'request-started'; token: string; page: number; sequence: number }
  | {
      type: 'request-succeeded';
      token: string;
      sequence: number;
      response: BusinessOperationDetailResponse;
    }
  | { type: 'request-failed'; token: string; sequence: number; error: string }
  | { type: 'closed' };

export const INITIAL_BUSINESS_OPERATION_DETAIL_STATE: BusinessOperationDetailState = {
  token: null,
  page: 1,
  response: null,
  loading: false,
  error: null,
  activeSequence: null,
};

/** Keeps a newly selected detail isolated from late responses for older tokens/pages. */
export function businessOperationDetailReducer(
  state: BusinessOperationDetailState,
  action: BusinessOperationDetailAction,
): BusinessOperationDetailState {
  switch (action.type) {
    case 'request-started':
      return {
        token: action.token,
        page: action.page,
        response: null,
        loading: true,
        error: null,
        activeSequence: action.sequence,
      };
    case 'request-succeeded':
      if (state.token !== action.token || state.activeSequence !== action.sequence) return state;
      return {
        ...state,
        response: action.response.operation.token === action.token ? action.response : null,
        loading: false,
        error: action.response.operation.token === action.token
          ? null
          : 'Dữ liệu chi tiết không khớp với Business Operation đang chọn.',
        activeSequence: null,
      };
    case 'request-failed':
      if (state.token !== action.token || state.activeSequence !== action.sequence) return state;
      return {
        ...state,
        response: null,
        loading: false,
        error: action.error,
        activeSequence: null,
      };
    case 'closed':
      return INITIAL_BUSINESS_OPERATION_DETAIL_STATE;
  }
}
