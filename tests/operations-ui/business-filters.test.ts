import {
  BUSINESS_OPERATION_SEARCH_MODE_OPTIONS,
  businessOperationsDraftFromApplied,
  createBusinessOperationsTrendDrillDown,
  formatBusinessOperationsTimezoneLabel,
  isBusinessOperationsDraftDirty,
  prepareBusinessOperationsFilterSubmission,
  retainAppliedBusinessOperationsState,
  serializeBusinessOperationsFilter,
  validateBusinessOperationSearchInput,
} from '../../app/operations/lib/business-filters';
import {
  BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS,
  type BusinessOperationsDashboardFilter,
  type BusinessOperationsFilterState,
} from '../../app/operations/types';

const appliedFilter: BusinessOperationsDashboardFilter = {
  range: 'today',
  profile: 'profile-a',
  operationType: 'extract:invoice',
  status: 'ALL',
  search: null,
  sort: 'recent',
  page: 3,
};

const options = {
  profiles: [
    { id: 'profile-a', name: 'Invoice' },
    { id: null, name: 'Nội bộ' },
  ],
  operationTypes: ['extract:invoice', 'workflows:payroll'],
};

function makeDraft(
  overrides: Partial<BusinessOperationsFilterState> = {},
): BusinessOperationsFilterState {
  return {
    ...businessOperationsDraftFromApplied(appliedFilter),
    ...overrides,
  };
}

describe('Business Operations filter helpers', () => {
  it('validates trimmed Unicode search input from 1 through 256 code points', () => {
    expect(validateBusinessOperationSearchInput('  CASE-001  ')).toEqual({
      valid: true,
      query: 'CASE-001',
    });
    expect(validateBusinessOperationSearchInput('   ')).toEqual({
      valid: false,
      reason: 'EMPTY_SEARCH',
    });
    expect(validateBusinessOperationSearchInput('😀'.repeat(256))).toEqual({
      valid: true,
      query: '😀'.repeat(256),
    });
    expect(validateBusinessOperationSearchInput('😀'.repeat(257))).toEqual({
      valid: false,
      reason: 'SEARCH_TOO_LONG',
    });
  });

  it('builds exact reference/request-ID and contains-reference submissions', () => {
    const exact = prepareBusinessOperationsFilterSubmission(
      makeDraft({ query: '  request-123 ', searchMode: 'exact' }),
      appliedFilter,
      options,
      'search',
    );
    expect(exact.accepted).toBe(true);
    if (exact.accepted) {
      expect(exact.requestFilter.search).toEqual({ query: 'request-123', mode: 'exact' });
      expect(exact.requestFilter.page).toBe(1);
      expect(exact.nextUrl.get('q')).toBe('request-123');
      expect(exact.nextUrl.get('search_mode')).toBe('exact');
    }

    const contains = prepareBusinessOperationsFilterSubmission(
      makeDraft({ query: 'invoice', searchMode: 'contains' }),
      appliedFilter,
      options,
      'search',
    );
    expect(contains.accepted).toBe(true);
    if (contains.accepted) {
      expect(contains.requestFilter.search).toEqual({ query: 'invoice', mode: 'contains' });
    }
  });

  it('rejects blank search and unauthorized profile without changing the applied filter', () => {
    const blank = prepareBusinessOperationsFilterSubmission(
      makeDraft({ query: '  ' }),
      appliedFilter,
      options,
      'search',
    );
    expect(blank).toMatchObject({ accepted: false, error: 'EMPTY_SEARCH' });
    if (!blank.accepted) expect(blank.appliedFilter).toBe(appliedFilter);

    const forbiddenDraft = makeDraft({ profile: 'profile-forbidden' });
    const forbidden = prepareBusinessOperationsFilterSubmission(
      forbiddenDraft,
      appliedFilter,
      options,
    );
    expect(forbidden).toMatchObject({ accepted: false, error: 'FORBIDDEN_PROFILE' });
    if (!forbidden.accepted) expect(forbidden.appliedFilter).toBe(appliedFilter);
  });

  it('retains applied URL/filter/last data references after invalid or forbidden input', () => {
    const lastSuccessfulData = { queryTimestamp: '2026-08-19T09:30:00.000Z' };
    const current = {
      draft: makeDraft(),
      appliedFilter,
      appliedUrl: `?${serializeBusinessOperationsFilter(appliedFilter)}`,
      lastSuccessfulData,
      validationError: null,
    };
    const attemptedDraft = makeDraft({ profile: 'profile-forbidden' });
    const retained = retainAppliedBusinessOperationsState(
      current,
      attemptedDraft,
      'FORBIDDEN_PROFILE',
    );

    expect(retained.draft).toBe(attemptedDraft);
    expect(retained.appliedFilter).toBe(current.appliedFilter);
    expect(retained.appliedUrl).toBe(current.appliedUrl);
    expect(retained.lastSuccessfulData).toBe(current.lastSuccessfulData);
    expect(retained.validationError).toBe('FORBIDDEN_PROFILE');
  });

  it('allows only server-provided profile/type options and serializes their intersection', () => {
    const accepted = prepareBusinessOperationsFilterSubmission(
      makeDraft({
        range: 'last_month',
        profile: '__internal__',
        operationType: 'workflows:payroll',
        status: 'FAILED',
        query: '',
      }),
      appliedFilter,
      options,
    );
    expect(accepted.accepted).toBe(true);
    if (accepted.accepted) {
      expect(accepted.requestFilter).toMatchObject({
        range: 'last_month',
        profile: '__internal__',
        operationType: 'workflows:payroll',
        status: 'FAILED',
        search: null,
        page: 1,
      });
      expect(accepted.nextUrl.toString()).toContain('operation_type=workflows%3Apayroll');
    }
  });

  it('tracks draft changes independently from the last server-applied filter', () => {
    expect(isBusinessOperationsDraftDirty(makeDraft(), appliedFilter)).toBe(false);
    expect(isBusinessOperationsDraftDirty(makeDraft({ status: 'FAILED' }), appliedFilter)).toBe(true);
  });

  it('creates trend drill-down state preserving profile/type while adding bucket/status', () => {
    const searchedApplied: BusinessOperationsDashboardFilter = {
      ...appliedFilter,
      search: { query: 'CASE-1', mode: 'exact' },
    };
    const drillDown = createBusinessOperationsTrendDrillDown(
      searchedApplied,
      {
        start: '2026-08-19T01:00:00.000Z',
        end: '2026-08-19T02:00:00.000Z',
        endInclusive: false,
      },
      'FAILED',
    );

    expect(drillDown.filter).toMatchObject({
      range: searchedApplied.range,
      profile: 'profile-a',
      operationType: 'extract:invoice',
      status: 'FAILED',
      search: searchedApplied.search,
      page: 1,
    });
    expect(drillDown.bucket).toEqual({
      start: '2026-08-19T01:00:00.000Z',
      end: '2026-08-19T02:00:00.000Z',
      startInclusive: true,
      endInclusive: false,
      status: 'FAILED',
    });

    const params = serializeBusinessOperationsFilter(drillDown.filter, drillDown.bucket);
    expect(params.get('profile')).toBe('profile-a');
    expect(params.get('operation_type')).toBe('extract:invoice');
    expect(params.get('status')).toBe('FAILED');
    expect(params.get('bucket_start')).toBe(drillDown.bucket.start);
    expect(params.get('bucket_end_inclusive')).toBe('false');
  });
});

describe('Business Operations filter presentation model', () => {
  it('exposes exactly four server calendar presets and formats the server timezone label', () => {
    expect(BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS).toEqual([
      { value: 'today', label: 'Hôm nay' },
      { value: 'this_month', label: 'Tháng này' },
      { value: 'last_month', label: 'Tháng trước' },
      { value: 'three_month_trend', label: 'Xu hướng 3 tháng' },
    ]);
    expect(formatBusinessOperationsTimezoneLabel('Asia/Ho_Chi_Minh')).toBe(
      'Ranh giới lịch theo múi giờ máy chủ: Asia/Ho_Chi_Minh',
    );
  });

  it('exposes explicit exact/contains search semantics used by the filter control', () => {
    expect(BUSINESS_OPERATION_SEARCH_MODE_OPTIONS).toEqual([
      { value: 'exact', label: 'Chính xác (Reference / Request ID)' },
      { value: 'contains', label: 'Chứa chuỗi (chỉ Reference ID)' },
    ]);
  });
});
