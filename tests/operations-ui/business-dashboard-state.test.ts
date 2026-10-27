import {
  buildBusinessOperationsDashboardQuery,
  businessOperationsDashboardReducer,
  clientFilterFromAppliedFilter,
  createBusinessOperationsDashboardState,
  DEFAULT_BUSINESS_OPERATIONS_FILTER,
  type BusinessDashboardRequestError,
} from '../../app/operations/hooks/useBusinessOperationsDashboard';
import type {
  BusinessOperationsDashboardResponse,
  BusinessOperationsFilterState,
} from '../../app/operations/types';

const REQUEST_ERROR: BusinessDashboardRequestError = {
  message: 'Temporary failure',
  status: 503,
  code: 'DASHBOARD_UNAVAILABLE',
  retryable: true,
  timedOut: false,
};

function dashboardResponse(
  queryTimestamp: string,
  filter: BusinessOperationsFilterState = DEFAULT_BUSINESS_OPERATIONS_FILTER,
): BusinessOperationsDashboardResponse {
  return {
    queryTimestamp,
    calendarTimezone: 'Asia/Ho_Chi_Minh',
    resolvedWindow: {
      start: '2026-08-18T17:00:00.000Z',
      end: queryTimestamp,
      startInclusive: true,
      endInclusive: true,
      preset: filter.range,
    },
    appliedFilter: {
      range: filter.range,
      profile: filter.profile,
      operationType: filter.operationType,
      status: filter.status,
      search: filter.query.trim()
        ? { query: filter.query.trim(), mode: filter.searchMode }
        : null,
      page: filter.page,
      sort: filter.sort,
    },
    summary: {
      totalCases: 1,
      tokensProcessed: 100,
      totalCostUsd: '1.0000000000',
      logicSuccessRate: 100,
      aiExtractionRate: 100,
      p95DurationSeconds: null,
      unpricedRequestCount: 0,
      costIncomplete: false,
    },
    breakdownCards: [],
    trend: { bucket: filter.range === 'today' ? 'hour' : 'day', points: [] },
    list: { items: [], page: filter.page, pageSize: 50, total: 1, totalPages: 1 },
  };
}

describe('businessOperationsDashboardReducer', () => {
  it('represents an initial failure without partial data or an applied filter', () => {
    const initial = createBusinessOperationsDashboardState();
    const loading = businessOperationsDashboardReducer(initial, {
      type: 'request-started',
      sequence: 1,
      intent: 'initial',
    });
    const failed = businessOperationsDashboardReducer(loading, {
      type: 'request-failed',
      sequence: 1,
      error: REQUEST_ERROR,
    });

    expect(failed).toMatchObject({
      phase: 'initial-error',
      data: null,
      appliedFilter: null,
      error: REQUEST_ERROR,
      staleWarning: null,
      activeRequestSequence: null,
    });
  });

  it('commits the whole successful snapshot and server-applied filter in one transition', () => {
    const data = dashboardResponse('2026-08-19T09:30:00.000Z');
    const loading = businessOperationsDashboardReducer(
      createBusinessOperationsDashboardState(),
      { type: 'request-started', sequence: 7, intent: 'initial' },
    );
    const ready = businessOperationsDashboardReducer(loading, {
      type: 'request-succeeded',
      sequence: 7,
      data,
    });

    expect(ready.phase).toBe('ready');
    expect(ready.data).toBe(data);
    expect(ready.appliedFilter).toBe(data.appliedFilter);
    expect(ready.data?.queryTimestamp).toBe('2026-08-19T09:30:00.000Z');
    expect(ready.error).toBeNull();
    expect(ready.staleWarning).toBeNull();
  });

  it('keeps prior data, filter, and timestamp by identity when a new filter fails', () => {
    const priorData = dashboardResponse('2026-08-19T09:30:00.000Z');
    const initialLoading = businessOperationsDashboardReducer(
      createBusinessOperationsDashboardState(),
      { type: 'request-started', sequence: 1, intent: 'initial' },
    );
    const ready = businessOperationsDashboardReducer(initialLoading, {
      type: 'request-succeeded',
      sequence: 1,
      data: priorData,
    });
    const loadingFilter = businessOperationsDashboardReducer(ready, {
      type: 'request-started',
      sequence: 2,
      intent: 'filter',
    });
    const stale = businessOperationsDashboardReducer(loadingFilter, {
      type: 'request-failed',
      sequence: 2,
      error: REQUEST_ERROR,
    });

    expect(loadingFilter.phase).toBe('loading-new-filter');
    expect(stale.phase).toBe('stale-ready');
    expect(stale.data).toBe(priorData);
    expect(stale.appliedFilter).toBe(priorData.appliedFilter);
    expect(stale.data?.queryTimestamp).toBe(priorData.queryTimestamp);
    expect(stale.error).toBeNull();
    expect(stale.staleWarning).toBe(REQUEST_ERROR);
  });

  it('discards completion actions from superseded request sequences', () => {
    const state = businessOperationsDashboardReducer(
      createBusinessOperationsDashboardState(),
      { type: 'request-started', sequence: 2, intent: 'filter' },
    );
    const staleResponse = dashboardResponse('2026-08-19T09:00:00.000Z');

    expect(businessOperationsDashboardReducer(state, {
      type: 'request-succeeded',
      sequence: 1,
      data: staleResponse,
    })).toBe(state);
    expect(businessOperationsDashboardReducer(state, {
      type: 'request-failed',
      sequence: 1,
      error: REQUEST_ERROR,
    })).toBe(state);
  });

  it('keeps draft edits separate from the last server-applied filter', () => {
    const priorData = dashboardResponse('2026-08-19T09:30:00.000Z');
    const ready = businessOperationsDashboardReducer(
      businessOperationsDashboardReducer(
        createBusinessOperationsDashboardState(),
        { type: 'request-started', sequence: 1, intent: 'initial' },
      ),
      { type: 'request-succeeded', sequence: 1, data: priorData },
    );
    const draft = { ...DEFAULT_BUSINESS_OPERATIONS_FILTER, profile: 'profile-2', page: 3 };
    const edited = businessOperationsDashboardReducer(ready, {
      type: 'draft-changed',
      filter: draft,
    });

    expect(edited.draftFilter).toEqual(draft);
    expect(edited.appliedFilter).toBe(priorData.appliedFilter);
    expect(edited.data).toBe(priorData);
  });
});

describe('Business Operations dashboard query mapping', () => {
  it('sends one canonical dashboard query and trims an active search', () => {
    const query = buildBusinessOperationsDashboardQuery({
      range: 'this_month',
      profile: 'profile-1',
      operationType: 'payroll',
      status: 'FAILED',
      query: '  CASE-42  ',
      searchMode: 'contains',
      sort: 'recent',
      page: 4,
    });
    const params = new URLSearchParams(query);

    expect(Object.fromEntries(params.entries())).toEqual({
      sort: 'recent',
      range: 'this_month',
      profile: 'profile-1',
      operation_type: 'payroll',
      status: 'FAILED',
      page: '4',
      q: 'CASE-42',
      search_mode: 'contains',
    });
  });

  it('omits blank search parameters and restores draft shape from an applied filter', () => {
    const query = buildBusinessOperationsDashboardQuery({
      ...DEFAULT_BUSINESS_OPERATIONS_FILTER,
      query: '   ',
      searchMode: 'contains',
    });
    const params = new URLSearchParams(query);
    expect(params.has('q')).toBe(false);
    expect(params.has('search_mode')).toBe(false);

    expect(clientFilterFromAppliedFilter({
      range: 'last_month',
      profile: '__internal__',
      operationType: 'ALL',
      status: 'SUCCEEDED',
      search: { query: 'CASE-9', mode: 'exact' },
      sort: 'recent',
      page: 2,
    })).toEqual({
      range: 'last_month',
      profile: '__internal__',
      operationType: 'ALL',
      status: 'SUCCEEDED',
      query: 'CASE-9',
      searchMode: 'exact',
      sort: 'recent',
      page: 2,
    });
  });
});
