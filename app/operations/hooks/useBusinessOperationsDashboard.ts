'use client';

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  BusinessOperationsDashboardFilter,
  BusinessOperationsDashboardResponse,
  BusinessOperationsFilterState,
} from '../types';

export const BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS = 30_000;
export const BUSINESS_DASHBOARD_POLL_INTERVAL_MS = 60_000;

export const DEFAULT_BUSINESS_OPERATIONS_FILTER: BusinessOperationsFilterState = {
  range: 'today',
  profile: 'ALL',
  operationType: 'ALL',
  status: 'ALL',
  query: '',
  searchMode: 'exact',
  sort: 'recent',
  page: 1,
};

export type BusinessDashboardPhase =
  | 'initial-loading'
  | 'initial-error'
  | 'ready'
  | 'refreshing'
  | 'loading-new-filter'
  | 'stale-ready';

export type BusinessDashboardRequestIntent = 'initial' | 'refresh' | 'filter' | 'retry';

export interface BusinessDashboardRequestError {
  message: string;
  status: number | null;
  code: string | null;
  retryable: boolean;
  timedOut: boolean;
}

export interface BusinessOperationsDashboardState {
  phase: BusinessDashboardPhase;
  data: BusinessOperationsDashboardResponse | null;
  draftFilter: BusinessOperationsFilterState;
  appliedFilter: BusinessOperationsDashboardFilter | null;
  error: BusinessDashboardRequestError | null;
  staleWarning: BusinessDashboardRequestError | null;
  activeRequestSequence: number | null;
}

export type BusinessOperationsDashboardAction =
  | { type: 'draft-changed'; filter: BusinessOperationsFilterState }
  | {
      type: 'request-started';
      sequence: number;
      intent: BusinessDashboardRequestIntent;
    }
  | {
      type: 'request-succeeded';
      sequence: number;
      data: BusinessOperationsDashboardResponse;
    }
  | {
      type: 'request-failed';
      sequence: number;
      error: BusinessDashboardRequestError;
    };

export interface UseBusinessOperationsDashboardOptions {
  initialFilter?: BusinessOperationsFilterState;
}

export interface UseBusinessOperationsDashboardReturn {
  data: BusinessOperationsDashboardResponse | null;
  phase: BusinessDashboardPhase;
  draftFilter: BusinessOperationsFilterState;
  appliedFilter: BusinessOperationsDashboardFilter | null;
  loading: boolean;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isLoadingNewFilter: boolean;
  error: BusinessDashboardRequestError | null;
  staleWarning: BusinessDashboardRequestError | null;
  setDraftFilter: Dispatch<SetStateAction<BusinessOperationsFilterState>>;
  updateDraftFilter: (patch: Partial<BusinessOperationsFilterState>) => void;
  applyDraftFilter: () => Promise<void>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
}

interface ActiveRequest {
  sequence: number;
  controller: AbortController;
}

interface FailedRequest {
  filter: BusinessOperationsFilterState;
  intent: BusinessDashboardRequestIntent;
}

function cloneFilter(filter: BusinessOperationsFilterState): BusinessOperationsFilterState {
  return { ...filter };
}

export function createBusinessOperationsDashboardState(
  initialFilter: BusinessOperationsFilterState = DEFAULT_BUSINESS_OPERATIONS_FILTER,
): BusinessOperationsDashboardState {
  return {
    phase: 'initial-loading',
    data: null,
    draftFilter: cloneFilter(initialFilter),
    appliedFilter: null,
    error: null,
    staleWarning: null,
    activeRequestSequence: null,
  };
}

/**
 * Pure state transition boundary. Snapshot data and its server-applied filter are
 * committed together, while failures only change error metadata.
 */
export function businessOperationsDashboardReducer(
  state: BusinessOperationsDashboardState,
  action: BusinessOperationsDashboardAction,
): BusinessOperationsDashboardState {
  switch (action.type) {
    case 'draft-changed':
      return { ...state, draftFilter: cloneFilter(action.filter) };

    case 'request-started': {
      const phase: BusinessDashboardPhase = state.data === null
        ? 'initial-loading'
        : action.intent === 'filter'
          ? 'loading-new-filter'
          : 'refreshing';

      return {
        ...state,
        phase,
        error: null,
        staleWarning: null,
        activeRequestSequence: action.sequence,
      };
    }

    case 'request-succeeded':
      if (state.activeRequestSequence !== action.sequence) return state;
      return {
        ...state,
        phase: 'ready',
        data: action.data,
        appliedFilter: action.data.appliedFilter,
        error: null,
        staleWarning: null,
        activeRequestSequence: null,
      };

    case 'request-failed':
      if (state.activeRequestSequence !== action.sequence) return state;
      if (state.data === null) {
        return {
          ...state,
          phase: 'initial-error',
          data: null,
          appliedFilter: null,
          error: action.error,
          staleWarning: null,
          activeRequestSequence: null,
        };
      }
      return {
        ...state,
        phase: 'stale-ready',
        error: null,
        staleWarning: action.error,
        activeRequestSequence: null,
      };
  }
}

export function buildBusinessOperationsDashboardQuery(
  filter: BusinessOperationsFilterState,
): string {
  const params = new URLSearchParams();
  params.set('range', filter.range);
  params.set('profile', filter.profile);
  params.set('operation_type', filter.operationType);
  params.set('status', filter.status);
  params.set('sort', filter.sort);
  params.set('page', String(filter.page));

  const query = filter.query.trim();
  if (query.length > 0) {
    params.set('q', query);
    params.set('search_mode', filter.searchMode);
  }

  return params.toString();
}

export function clientFilterFromAppliedFilter(
  filter: BusinessOperationsDashboardFilter,
): BusinessOperationsFilterState {
  return {
    range: filter.range,
    profile: filter.profile,
    operationType: filter.operationType,
    status: filter.status,
    query: filter.search?.query ?? '',
    searchMode: filter.search?.mode ?? 'exact',
    sort: filter.sort,
    page: filter.page,
  };
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

function apiErrorFromBody(
  body: unknown,
  status: number,
): BusinessDashboardRequestError {
  const nestedError = typeof body === 'object' && body !== null && 'error' in body
    ? body.error
    : null;
  const problem = typeof nestedError === 'object' && nestedError !== null
    ? nestedError as Record<string, unknown>
    : null;
  const legacyMessage = typeof nestedError === 'string' ? nestedError : null;

  return {
    message: typeof problem?.message === 'string'
      ? problem.message
      : legacyMessage ?? `Không thể tải dashboard Operations (HTTP ${status})`,
    status,
    code: typeof problem?.code === 'string' ? problem.code : null,
    retryable: typeof problem?.retryable === 'boolean'
      ? problem.retryable
      : status >= 500,
    timedOut: status === 504,
  };
}

function requestErrorFromUnknown(error: unknown): BusinessDashboardRequestError {
  return {
    message: error instanceof Error
      ? error.message
      : 'Không thể tải dashboard Operations',
    status: null,
    code: null,
    retryable: true,
    timedOut: false,
  };
}

function timeoutError(): BusinessDashboardRequestError {
  return {
    message: 'Dashboard Operations không phản hồi trong 30 giây. Vui lòng thử lại.',
    status: 504,
    code: 'DASHBOARD_TIMEOUT',
    retryable: true,
    timedOut: true,
  };
}

export function useBusinessOperationsDashboard({
  initialFilter = DEFAULT_BUSINESS_OPERATIONS_FILTER,
}: UseBusinessOperationsDashboardOptions = {}): UseBusinessOperationsDashboardReturn {
  const initialFilterRef = useRef(cloneFilter(initialFilter));
  const [state, dispatch] = useReducer(
    businessOperationsDashboardReducer,
    initialFilterRef.current,
    createBusinessOperationsDashboardState,
  );

  const stateRef = useRef(state);
  const draftFilterRef = useRef(state.draftFilter);
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const requestSequenceRef = useRef(0);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSettledAtRef = useRef<number | null>(null);
  const hasSuccessfulDataRef = useRef(false);
  const successfulFilterRef = useRef<BusinessOperationsFilterState | null>(null);
  const failedRequestRef = useRef<FailedRequest | null>(null);
  const runRequestRef = useRef<(
    intent: BusinessDashboardRequestIntent,
    filter: BusinessOperationsFilterState,
  ) => Promise<void>>(async () => {});
  const scheduleNextPollRef = useRef<() => void>(() => {});

  stateRef.current = state;
  draftFilterRef.current = state.draftFilter;

  const clearPoll = useCallback(() => {
    if (pollTimeoutRef.current !== null) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const scheduleNextPoll = useCallback(() => {
    clearPoll();
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    if (successfulFilterRef.current?.range !== 'today') return;
    if (!hasSuccessfulDataRef.current || activeRequestRef.current !== null) return;

    const elapsed = lastSettledAtRef.current === null
      ? 0
      : Date.now() - lastSettledAtRef.current;
    const delay = Math.max(0, BUSINESS_DASHBOARD_POLL_INTERVAL_MS - elapsed);

    pollTimeoutRef.current = setTimeout(() => {
      pollTimeoutRef.current = null;
      const filter = successfulFilterRef.current;
      if (filter === null || activeRequestRef.current !== null) return;
      void runRequestRef.current('refresh', cloneFilter(filter));
    }, delay);
  }, [clearPoll]);
  scheduleNextPollRef.current = scheduleNextPoll;

  const runRequest = useCallback(async (
    intent: BusinessDashboardRequestIntent,
    requestedFilter: BusinessOperationsFilterState,
  ): Promise<void> => {
    const inFlight = activeRequestRef.current;
    if (inFlight !== null) {
      if (intent !== 'filter') return;
      inFlight.controller.abort();
    }

    clearPoll();
    const filter = cloneFilter(requestedFilter);
    const sequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    activeRequestRef.current = { sequence, controller };
    dispatch({ type: 'request-started', sequence, intent });

    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS);

    try {
      const query = buildBusinessOperationsDashboardQuery(filter);
      const response = await fetch(`/api/internal/business-operations?${query}`, {
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw apiErrorFromBody(body, response.status);
      if (requestSequenceRef.current !== sequence) return;

      const data = body as BusinessOperationsDashboardResponse;
      hasSuccessfulDataRef.current = true;
      successfulFilterRef.current = clientFilterFromAppliedFilter(data.appliedFilter);
      failedRequestRef.current = null;
      dispatch({ type: 'request-succeeded', sequence, data });
    } catch (error) {
      if (requestSequenceRef.current !== sequence) return;
      if (isAbortError(error) && !didTimeout) return;

      const requestError = didTimeout
        ? timeoutError()
        : typeof error === 'object'
          && error !== null
          && 'timedOut' in error
          ? error as BusinessDashboardRequestError
          : requestErrorFromUnknown(error);
      failedRequestRef.current = { filter, intent };
      dispatch({ type: 'request-failed', sequence, error: requestError });
    } finally {
      clearTimeout(timeout);
      if (requestSequenceRef.current === sequence) {
        activeRequestRef.current = null;
        lastSettledAtRef.current = Date.now();
        scheduleNextPollRef.current();
      }
    }
  }, [clearPoll]);
  runRequestRef.current = runRequest;

  useEffect(() => {
    void runRequestRef.current('initial', cloneFilter(initialFilterRef.current));
    return () => {
      clearPoll();
      requestSequenceRef.current += 1;
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
    };
  }, [clearPoll]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleNextPollRef.current();
      else clearPoll();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [clearPoll]);

  const setDraftFilter = useCallback<Dispatch<SetStateAction<BusinessOperationsFilterState>>>(
    (nextFilter) => {
      const next = typeof nextFilter === 'function'
        ? nextFilter(draftFilterRef.current)
        : nextFilter;
      const cloned = cloneFilter(next);
      draftFilterRef.current = cloned;
      dispatch({ type: 'draft-changed', filter: cloned });
    },
    [],
  );

  const updateDraftFilter = useCallback((patch: Partial<BusinessOperationsFilterState>) => {
    setDraftFilter((current) => ({ ...current, ...patch }));
  }, [setDraftFilter]);

  const applyDraftFilter = useCallback(async () => {
    await runRequestRef.current('filter', cloneFilter(draftFilterRef.current));
  }, []);

  const refresh = useCallback(async () => {
    const filter = successfulFilterRef.current ?? draftFilterRef.current;
    await runRequestRef.current(stateRef.current.data === null ? 'initial' : 'refresh', cloneFilter(filter));
  }, []);

  const retry = useCallback(async () => {
    const failed = failedRequestRef.current;
    if (failed !== null) {
      await runRequestRef.current(failed.intent, cloneFilter(failed.filter));
      return;
    }
    await refresh();
  }, [refresh]);

  const isInitialLoading = state.phase === 'initial-loading';
  const isRefreshing = state.phase === 'refreshing';
  const isLoadingNewFilter = state.phase === 'loading-new-filter';

  return {
    data: state.data,
    phase: state.phase,
    draftFilter: state.draftFilter,
    appliedFilter: state.appliedFilter,
    loading: isInitialLoading || isRefreshing || isLoadingNewFilter,
    isInitialLoading,
    isRefreshing,
    isLoadingNewFilter,
    error: state.error,
    staleWarning: state.staleWarning,
    setDraftFilter,
    updateDraftFilter,
    applyDraftFilter,
    refresh,
    retry,
  };
}
