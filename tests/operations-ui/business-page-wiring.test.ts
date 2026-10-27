import { readFileSync } from 'fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

import BusinessOperationsDashboardView from '../../app/operations/components/BusinessOperationsDashboardView';
import {
  INITIAL_BUSINESS_OPERATION_DETAIL_STATE,
  businessOperationDetailReducer,
  parseBusinessOperationsPageFilter,
} from '../../app/operations/lib/business-page';
import {
  DEFAULT_BUSINESS_OPERATIONS_FILTER,
  clientFilterFromAppliedFilter,
  type BusinessDashboardRequestError,
} from '../../app/operations/hooks/useBusinessOperationsDashboard';
import type {
  BusinessOperationDetailResponse,
  BusinessOperationsDashboardResponse,
} from '../../app/operations/types';

const noOp = () => undefined;
const requestError: BusinessDashboardRequestError = {
  message: 'Dashboard unavailable',
  status: 503,
  code: 'DASHBOARD_UNAVAILABLE',
  retryable: true,
  timedOut: false,
};

const snapshot: BusinessOperationsDashboardResponse = {
  queryTimestamp: '2026-08-19T09:00:00.000Z',
  calendarTimezone: 'Asia/Ho_Chi_Minh',
  resolvedWindow: {
    start: '2026-08-18T17:00:00.000Z',
    end: '2026-08-19T09:00:00.000Z',
    startInclusive: true,
    endInclusive: true,
    preset: 'today',
  },
  appliedFilter: {
    range: 'today',
    profile: 'ALL',
    operationType: 'ALL',
    status: 'ALL',
    search: null,
    page: 1,
    sort: 'recent',
  },
  summary: {
    totalCases: 1,
    tokensProcessed: 150,
    totalCostUsd: '1.2500000000',
    logicSuccessRate: 100,
    aiExtractionRate: 100,
    p95DurationSeconds: 12,
    unpricedRequestCount: 0,
    costIncomplete: false,
  },
  breakdownCards: [{
    profileScope: { id: 'profile-a', name: 'Profile A' },
    operationType: 'extract:invoice',
    businessOperationCount: 1,
    succeededCount: 1,
    failedCount: 0,
    successPercentage: 100,
    requestCount: 2,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: '1.2500000000',
    averageTokensPerBusinessOperation: 150,
    averageDurationSeconds: 12,
    maxDurationSeconds: 12,
    maxTokenCount: 150,
    maxDurationOperationIdentifier: 'CASE-1',
    maxTokenOperationIdentifier: 'CASE-1',
    maxDurationOperationToken: 'signed-token-a',
    maxTokenOperationToken: 'signed-token-a',
    unpricedRequestCount: 0,
    costIncomplete: false,
  }],
  trend: {
    bucket: 'hour',
    points: [{
      unit: 'hour',
      localKey: '2026-08-19T08:00',
      occurrence: 0,
      start: '2026-08-19T01:00:00.000Z',
      end: '2026-08-19T02:00:00.000Z',
      startInclusive: true,
      endInclusive: false,
      clippedStart: false,
      clippedEnd: false,
      counts: { IN_PROGRESS: 0, SUCCEEDED: 1, FAILED: 0 },
      total: 1,
    }],
  },
  list: {
    items: [{
      token: 'signed-token-a',
      operationIdentifier: 'CASE-1',
      normalizedReference: 'CASE-1',
      profileScope: { id: 'profile-a', name: 'Profile A' },
      operationTypes: ['extract:invoice'],
      businessStatus: 'SUCCEEDED',
      invalidData: false,
      requestCount: 2,
      startTime: '2026-08-19T01:15:00.000Z',
      updatedTime: '2026-08-19T01:16:00.000Z',
      endTime: '2026-08-19T01:16:00.000Z',
      durationSeconds: 60,
      totalTokens: 150,
      totalCostUsd: '1.2500000000',
      unpricedRequestCount: 0,
      missingData: false,
    }],
    page: 1,
    pageSize: 50,
    total: 1,
    totalPages: 1,
  },
};

function renderView(overrides: Partial<Parameters<typeof BusinessOperationsDashboardView>[0]> = {}) {
  return renderToStaticMarkup(createElement(BusinessOperationsDashboardView, {
    data: snapshot,
    phase: 'ready',
    draftFilter: clientFilterFromAppliedFilter(snapshot.appliedFilter),
    appliedFilter: snapshot.appliedFilter,
    initialFilter: DEFAULT_BUSINESS_OPERATIONS_FILTER,
    error: null,
    staleWarning: null,
    filterOptions: {
      profiles: [{ id: 'profile-a', name: 'Profile A' }],
      operationTypes: ['extract:invoice'],
    },
    filterOptionsLoading: false,
    filterOptionsError: null,
    onRetryFilterOptions: noOp,
    onDraftChange: noOp,
    onRequestApply: noOp,
    onRetry: noOp,
    onRefresh: noOp,
    onTrendDrillDown: noOp,
    onListPageChange: noOp,
    onListSortChange: noOp,
    detailToken: null,
    detailResponse: null,
    detailLoading: false,
    detailError: null,
    onOpenDetail: noOp,
    onCloseDetail: noOp,
    onRetryDetail: noOp,
    onDetailPageChange: noOp,
    ...overrides,
  }));
}

describe('Operations business dashboard page wiring', () => {
  it('renders the committed snapshot in approved image order from presets through list', () => {
    const html = renderView();
    const presetIndex = html.indexOf('Hôm nay');
    const kpiIndex = html.indexOf('Total Cases');
    const breakdownIndex = html.indexOf('Hiệu quả theo profile và operation');
    const trendIndex = html.indexOf('Xu hướng nghiệp vụ');
    const listIndex = html.indexOf('Danh sách Business Operations');

    expect((html.match(/data-applied=/g) ?? [])).toHaveLength(4);
    expect((html.match(/<article/g) ?? [])).toHaveLength(6); // five KPI cards + one breakdown card
    expect(presetIndex).toBeLessThan(kpiIndex);
    expect(kpiIndex).toBeLessThan(breakdownIndex);
    expect(breakdownIndex).toBeLessThan(trendIndex);
    expect(trendIndex).toBeLessThan(listIndex);
    expect(html).toContain('CASE-1');
    expect(html).toContain('signed-token-a');
    expect(html).toContain('Snapshot:');
  });

  it('isolates initial errors and keeps stale snapshots visible with retry messaging', () => {
    const initialErrorHtml = renderView({
      data: null,
      phase: 'initial-error',
      appliedFilter: null,
      error: requestError,
    });
    const staleHtml = renderView({
      phase: 'stale-ready',
      staleWarning: { ...requestError, message: 'Refresh failed' },
    });

    expect(initialErrorHtml).toContain('Không thể tải dashboard Operations');
    expect(initialErrorHtml).toContain('Dashboard unavailable');
    expect(initialErrorHtml).toContain('Thử lại');
    expect(initialErrorHtml).not.toContain('CASE-1');
    expect(staleHtml).toContain('Dữ liệu chưa được làm mới');
    expect(staleHtml).toContain('Refresh failed');
    expect(staleHtml).toContain('CASE-1');
  });

  it('parses only supported URL filter values and normalizes invalid page state', () => {
    const parsed = parseBusinessOperationsPageFilter(new URLSearchParams({
      range: 'last_month',
      profile: 'profile-a',
      operation_type: 'extract:invoice',
      status: 'FAILED',
      q: 'CASE-1',
      search_mode: 'contains',
      page: '4',
    }));
    expect(parsed).toEqual({
      range: 'last_month',
      profile: 'profile-a',
      operationType: 'extract:invoice',
      status: 'FAILED',
      query: 'CASE-1',
      searchMode: 'contains',
      sort: 'recent',
      page: 4,
    });

    const invalid = parseBusinessOperationsPageFilter(new URLSearchParams({
      range: 'custom',
      status: 'RUNNING',
      search_mode: 'fuzzy',
      page: '-1',
    }));
    expect(invalid).toEqual(DEFAULT_BUSINESS_OPERATIONS_FILTER);
  });

  it('discards late or mismatched constituent responses and never reuses prior detail data', () => {
    const detailResponse: BusinessOperationDetailResponse = {
      queryTimestamp: snapshot.queryTimestamp,
      operation: {
        ...snapshot.list.items[0],
        endTime: '2026-08-19T01:16:00.000Z',
        durationSeconds: 60,
      },
      requests: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 1 },
    };
    const started = businessOperationDetailReducer(INITIAL_BUSINESS_OPERATION_DETAIL_STATE, {
      type: 'request-started',
      token: 'signed-token-a',
      page: 1,
      sequence: 2,
    });
    const late = businessOperationDetailReducer(started, {
      type: 'request-succeeded',
      token: 'signed-token-a',
      sequence: 1,
      response: detailResponse,
    });
    const nextSelection = businessOperationDetailReducer(started, {
      type: 'request-started',
      token: 'signed-token-b',
      page: 1,
      sequence: 3,
    });

    expect(late).toBe(started);
    expect(nextSelection).toMatchObject({
      token: 'signed-token-b',
      response: null,
      loading: true,
      activeSequence: 3,
    });
  });

  it('uses only atomic business dashboard resources and leaves legacy request routes/components intact', () => {
    const wrapperSource = readFileSync('app/operations/page.tsx', 'utf8');
    const businessSource = readFileSync('app/operations/BusinessOperationsPage.tsx', 'utf8');
    const legacySource = readFileSync('app/operations/LegacyOperationsPage.tsx', 'utf8');
    expect(wrapperSource).toContain('selectOperationsDashboardVariant');
    expect(wrapperSource).toContain('BusinessOperationsPage');
    expect(wrapperSource).toContain('LegacyOperationsPage');
    expect(businessSource).toContain('useBusinessOperationsDashboard');
    expect(businessSource).toContain('useBusinessOperationFilterOptions');
    expect(businessSource).toContain('useBusinessOperationDetail');
    expect(businessSource).not.toContain('useOperationsList');
    expect(businessSource).not.toContain('useBreakdown');
    expect(businessSource).not.toContain('useTimeseries');
    expect(businessSource).not.toContain('OverviewTab');
    expect(businessSource).not.toContain('RequestsTab');
    expect(businessSource).not.toContain('CostBreakdownTab');
    expect(businessSource).not.toContain('/api/internal/operations/stats');
    expect(legacySource).toContain('useOperationsList');
    expect(legacySource).toContain('OverviewTab');
    expect(legacySource).toContain('RequestsTab');
    expect(legacySource).toContain('CostBreakdownTab');
  });
});
