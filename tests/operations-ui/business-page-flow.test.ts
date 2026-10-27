import * as React from 'react';
import {
  isValidElement,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionContextValue } from 'next-auth/react';
import type { BusinessOperationsDashboardViewProps } from '../../app/operations/components/BusinessOperationsDashboardView';
import type {
  BusinessOperationDetailResponse,
  BusinessOperationsDashboardResponse,
  BusinessOperationsFilterState,
} from '../../app/operations/types';

let mockLastDashboardViewProps: BusinessOperationsDashboardViewProps | null = null;

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));
jest.mock('../../app/operations/hooks/useBusinessOperationsDashboard', () => {
  const actual = jest.requireActual<typeof import('../../app/operations/hooks/useBusinessOperationsDashboard')>(
    '../../app/operations/hooks/useBusinessOperationsDashboard',
  );
  return { ...actual, useBusinessOperationsDashboard: jest.fn() };
});
jest.mock('../../app/operations/hooks/useBusinessOperationResources', () => {
  const actual = jest.requireActual<typeof import('../../app/operations/hooks/useBusinessOperationResources')>(
    '../../app/operations/hooks/useBusinessOperationResources',
  );
  return {
    ...actual,
    useBusinessOperationFilterOptions: jest.fn(),
    useBusinessOperationDetail: jest.fn(),
  };
});
jest.mock('../../app/operations/components/BusinessOperationsDashboardView', () => {
  const actual = jest.requireActual<typeof import('../../app/operations/components/BusinessOperationsDashboardView')>(
    '../../app/operations/components/BusinessOperationsDashboardView',
  );
  const react = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    ...actual,
    default: (props: BusinessOperationsDashboardViewProps) => {
      mockLastDashboardViewProps = props;
      return react.createElement(actual.default, props);
    },
  };
});

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import OperationsPage from '../../app/operations/BusinessOperationsPage';
import { BusinessOperationFilters } from '../../app/operations/components/OperationFilters';
import {
  DEFAULT_BUSINESS_OPERATIONS_FILTER,
  useBusinessOperationsDashboard,
  type BusinessDashboardRequestError,
  type UseBusinessOperationsDashboardReturn,
} from '../../app/operations/hooks/useBusinessOperationsDashboard';
import {
  useBusinessOperationDetail,
  useBusinessOperationFilterOptions,
  type UseBusinessOperationDetailReturn,
} from '../../app/operations/hooks/useBusinessOperationResources';

const mockUseSession = jest.mocked(useSession);
const mockUseRouter = jest.mocked(useRouter);
const mockUseSearchParams = jest.mocked(useSearchParams);
const mockUseDashboard = jest.mocked(useBusinessOperationsDashboard);
const mockUseFilterOptions = jest.mocked(useBusinessOperationFilterOptions);
const mockUseDetail = jest.mocked(useBusinessOperationDetail);

const PROFILE_ID = 'profile-payroll';
const OPERATION_TYPE = 'workflows:payroll';
const FILTER_OPTIONS = {
  profiles: [{ id: PROFILE_ID, name: 'Payroll Profile' }],
  operationTypes: [OPERATION_TYPE, 'extract:invoice'],
};

function makeFilter(
  overrides: Partial<BusinessOperationsFilterState> = {},
): BusinessOperationsFilterState {
  return {
    ...DEFAULT_BUSINESS_OPERATIONS_FILTER,
    ...overrides,
  };
}

function makeSnapshot(
  marker: string,
  filter: BusinessOperationsFilterState = DEFAULT_BUSINESS_OPERATIONS_FILTER,
): BusinessOperationsDashboardResponse {
  const normalizedMarker = marker.toUpperCase();
  const operationIdentifier = `CASE-${normalizedMarker}`;
  const timestampMinute = marker === 'old' ? '00' : marker === 'new' ? '05' : '10';
  return {
    queryTimestamp: `2026-08-19T09:${timestampMinute}:00.000Z`,
    calendarTimezone: 'Asia/Ho_Chi_Minh',
    resolvedWindow: {
      start: '2026-08-18T17:00:00.000Z',
      end: `2026-08-19T09:${timestampMinute}:00.000Z`,
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
      totalCases: marker === 'new' ? 29 : 17,
      tokensProcessed: marker === 'new' ? 2900 : 1700,
      totalCostUsd: marker === 'new' ? '29.0000000000' : '17.0000000000',
      logicSuccessRate: marker === 'new' ? 92 : 81,
      aiExtractionRate: marker === 'new' ? 96 : 84,
      p95DurationSeconds: 12,
      unpricedRequestCount: 0,
      costIncomplete: false,
    },
    breakdownCards: [{
      profileScope: { id: PROFILE_ID, name: `Profile ${normalizedMarker}` },
      operationType: `${OPERATION_TYPE}:${marker}`,
      businessOperationCount: 1,
      succeededCount: filter.status === 'FAILED' ? 0 : 1,
      failedCount: filter.status === 'FAILED' ? 1 : 0,
      successPercentage: filter.status === 'FAILED' ? 0 : 100,
      requestCount: 2,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: '1.2500000000',
      averageTokensPerBusinessOperation: 150,
      averageDurationSeconds: 12,
      maxDurationSeconds: 12,
      maxTokenCount: 150,
      maxDurationOperationIdentifier: operationIdentifier,
      maxTokenOperationIdentifier: operationIdentifier,
      maxDurationOperationToken: `token-${marker}`,
      maxTokenOperationToken: `token-${marker}`,
      unpricedRequestCount: 0,
      costIncomplete: false,
    }],
    trend: {
      bucket: filter.range === 'today' ? 'hour' : 'day',
      points: [{
        unit: filter.range === 'today' ? 'hour' : 'day',
        localKey: filter.range === 'today' ? '2026-08-19T08:00' : '2026-08-19',
        occurrence: 0,
        start: '2026-08-19T01:00:00.000Z',
        end: '2026-08-19T02:00:00.000Z',
        startInclusive: true,
        endInclusive: false,
        clippedStart: false,
        clippedEnd: false,
        counts: filter.status === 'FAILED'
          ? { IN_PROGRESS: 0, SUCCEEDED: 0, FAILED: 1 }
          : { IN_PROGRESS: 0, SUCCEEDED: 1, FAILED: 0 },
        total: 1,
      }],
    },
    list: {
      items: [{
        token: `token-${marker}`,
        operationIdentifier,
        normalizedReference: operationIdentifier,
        profileScope: { id: PROFILE_ID, name: `Profile ${normalizedMarker}` },
        operationTypes: [OPERATION_TYPE],
        businessStatus: filter.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
        invalidData: false,
        requestCount: 2,
        startTime: '2026-08-19T01:15:00.000Z',
        updatedTime: '2026-08-19T01:16:00.000Z',
        endTime: '2026-08-19T01:16:00.000Z',
        durationSeconds: 60,
        totalTokens: marker === 'new' ? 2900 : 1700,
        totalCostUsd: marker === 'new' ? '29.0000000000' : '17.0000000000',
        unpricedRequestCount: 0,
        missingData: false,
      }],
      page: filter.page,
      pageSize: 50,
      total: 1,
      totalPages: 1,
    },
  };
}

function makeDashboardHook(
  data: BusinessOperationsDashboardResponse,
  overrides: Partial<UseBusinessOperationsDashboardReturn> = {},
): UseBusinessOperationsDashboardReturn {
  const draftFilter = makeFilter({
    range: data.appliedFilter.range,
    profile: data.appliedFilter.profile,
    operationType: data.appliedFilter.operationType,
    status: data.appliedFilter.status,
    query: data.appliedFilter.search?.query ?? '',
    searchMode: data.appliedFilter.search?.mode ?? 'exact',
    page: data.appliedFilter.page,
  });
  return {
    data,
    phase: 'ready',
    draftFilter,
    appliedFilter: data.appliedFilter,
    loading: false,
    isInitialLoading: false,
    isRefreshing: false,
    isLoadingNewFilter: false,
    error: null,
    staleWarning: null,
    setDraftFilter: jest.fn<void, [SetStateAction<BusinessOperationsFilterState>]>() as UseBusinessOperationsDashboardReturn['setDraftFilter'],
    updateDraftFilter: jest.fn(),
    applyDraftFilter: jest.fn(async () => undefined),
    refresh: jest.fn(async () => undefined),
    retry: jest.fn(async () => undefined),
    ...overrides,
  };
}

function makeDetailResponse(marker: string, page = 1): BusinessOperationDetailResponse {
  const snapshot = makeSnapshot(marker);
  return {
    queryTimestamp: snapshot.queryTimestamp,
    operation: {
      ...snapshot.list.items[0],
      endTime: '2026-08-19T01:16:00.000Z',
      durationSeconds: 60,
    },
    requests: {
      items: [{
        id: `REQUEST-${marker.toUpperCase()}`,
        operationType: OPERATION_TYPE,
        state: 'SUCCEEDED',
        startedAt: '2026-08-19T01:15:00.000Z',
        completedAt: '2026-08-19T01:16:00.000Z',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: '1.2500000000',
        errorCode: null,
        errorMessage: null,
        missingData: false,
        unpricedCost: false,
      }],
      page,
      pageSize: 100,
      total: 101,
      totalPages: 2,
    },
  };
}

function makeDetailHook(
  overrides: Partial<UseBusinessOperationDetailReturn> = {},
): UseBusinessOperationDetailReturn {
  return {
    token: null,
    page: 1,
    response: null,
    loading: false,
    error: null,
    open: jest.fn(),
    close: jest.fn(),
    changePage: jest.fn(),
    retry: jest.fn(),
    ...overrides,
  };
}

function renderPage(): string {
  mockLastDashboardViewProps = null;
  const html = renderToStaticMarkup(React.createElement(OperationsPage));
  expect(mockLastDashboardViewProps).not.toBeNull();
  return html;
}

function getCapturedViewProps(): BusinessOperationsDashboardViewProps {
  if (mockLastDashboardViewProps === null) throw new Error('Dashboard view was not rendered');
  return mockLastDashboardViewProps;
}

type HostElement = ReactElement<Record<string, unknown>, string>;

function findHostElements(node: ReactNode, type: string): HostElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findHostElements(child, type));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  const descendants = findHostElements(element.props.children as ReactNode, type);
  return typeof element.type === 'string' && element.type === type
    ? [element as HostElement, ...descendants]
    : descendants;
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (!isValidElement(node)) return '';
  return nodeText((node as ReactElement<Record<string, unknown>>).props.children as ReactNode);
}

/** Calls the real filter submit handler while preserving the Node-only Jest environment. */
function submitCapturedFilter(
  draftFilter: BusinessOperationsFilterState,
  intent: 'filters' | 'search',
): void {
  const props = getCapturedViewProps();
  const internals = (React as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      ReactCurrentDispatcher: { current: unknown };
    };
  }).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const previousDispatcher = internals.ReactCurrentDispatcher.current;
  internals.ReactCurrentDispatcher.current = {
    useState: <T,>(initial: T | (() => T)): [T, (value: SetStateAction<T>) => void] => [
      typeof initial === 'function' ? (initial as () => T)() : initial,
      jest.fn(),
    ],
  };
  try {
    const tree = BusinessOperationFilters({
      draftFilter,
      appliedFilter: props.appliedFilter!,
      calendarTimezone: props.data!.calendarTimezone,
      profiles: props.filterOptions.profiles,
      operationTypes: props.filterOptions.operationTypes,
      onDraftChange: props.onDraftChange,
      onRequestApply: props.onRequestApply,
    });
    if (intent === 'search') {
      const form = findHostElements(tree, 'form')[0];
      (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
        preventDefault: jest.fn(),
      });
      return;
    }
    const applyButton = findHostElements(tree, 'button').find(
      (button) => nodeText(button.props.children as ReactNode) === 'Áp dụng bộ lọc',
    );
    (applyButton?.props.onClick as (() => void) | undefined)?.();
  } finally {
    internals.ReactCurrentDispatcher.current = previousDispatcher;
  }
}

const staleError: BusinessDashboardRequestError = {
  message: 'Refresh failed',
  status: 503,
  code: 'DASHBOARD_UNAVAILABLE',
  retryable: true,
  timedOut: false,
};

describe('Operations page-level business dashboard flows', () => {
  const routerReplace = jest.fn();
  const routerPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockLastDashboardViewProps = null;
    mockUseSession.mockReturnValue({
      data: { user: { name: 'Operations User' }, expires: '2099-01-01T00:00:00.000Z' },
      status: 'authenticated',
      update: jest.fn(),
    } as unknown as SessionContextValue);
    mockUseRouter.mockReturnValue({
      replace: routerReplace,
      push: routerPush,
    } as never);
    mockUseSearchParams.mockReturnValue(new URLSearchParams() as never);
    mockUseFilterOptions.mockReturnValue({
      data: FILTER_OPTIONS,
      loading: false,
      error: null,
      retry: jest.fn(),
    });
    mockUseDetail.mockReturnValue(makeDetailHook());
  });

  it('applies the full filter intersection and renders the reference-image section order', () => {
    const intersectedFilter = makeFilter({
      range: 'last_month',
      profile: PROFILE_ID,
      operationType: OPERATION_TYPE,
      status: 'FAILED',
      query: 'CASE-MATCH',
      searchMode: 'exact',
    });
    const snapshot = makeSnapshot('match', intersectedFilter);
    const dashboard = makeDashboardHook(snapshot);
    mockUseSearchParams.mockReturnValue(new URLSearchParams({
      range: 'last_month',
      profile: PROFILE_ID,
      operation_type: OPERATION_TYPE,
      status: 'FAILED',
      q: 'CASE-MATCH',
      search_mode: 'exact',
      page: '1',
    }) as never);
    mockUseDashboard.mockReturnValue(dashboard);

    const html = renderPage();
    const props = getCapturedViewProps();
    const presetIndex = html.indexOf('Hôm nay');
    const kpiIndex = html.indexOf('Total Cases');
    const breakdownIndex = html.indexOf('Hiệu quả theo profile và operation');
    const trendIndex = html.indexOf('Xu hướng nghiệp vụ');
    const listIndex = html.indexOf('Danh sách Business Operations');

    expect(mockUseDashboard).toHaveBeenCalledWith({ initialFilter: intersectedFilter });
    expect(props.appliedFilter).toEqual(snapshot.appliedFilter);
    expect(html).toContain('CASE-MATCH');
    expect(html).toContain('Profile MATCH');
    expect((html.match(/data-applied=/g) ?? [])).toHaveLength(4);
    expect((html.match(/<article/g) ?? [])).toHaveLength(6); // five KPI cards + breakdown
    expect(presetIndex).toBeLessThan(kpiIndex);
    expect(kpiIndex).toBeLessThan(breakdownIndex);
    expect(breakdownIndex).toBeLessThan(trendIndex);
    expect(trendIndex).toBeLessThan(listIndex);
  });

  it('does not call the dashboard API for invalid search or forbidden profile and preserves the committed snapshot', () => {
    const snapshot = makeSnapshot('old');
    const dashboard = makeDashboardHook(snapshot);
    mockUseDashboard.mockReturnValue(dashboard);

    const before = renderPage();
    submitCapturedFilter(makeFilter({ query: '   ' }), 'search');
    submitCapturedFilter(makeFilter({ profile: 'profile-forbidden' }), 'filters');
    const after = renderPage();

    expect(dashboard.applyDraftFilter).not.toHaveBeenCalled();
    expect(dashboard.setDraftFilter).not.toHaveBeenCalled();
    expect(before).toContain('CASE-OLD');
    expect(after).toContain('CASE-OLD');
    expect(after).toContain(snapshot.queryTimestamp);
    expect(after).not.toContain('profile-forbidden');
  });

  it('submits intersected filters and drills trend into the list while retaining profile and operation type', () => {
    const filter = makeFilter({
      profile: PROFILE_ID,
      operationType: OPERATION_TYPE,
      query: 'CASE-OLD',
      searchMode: 'contains',
    });
    const dashboard = makeDashboardHook(makeSnapshot('old', filter));
    const detail = makeDetailHook({ token: 'token-old' });
    mockUseDashboard.mockReturnValue(dashboard);
    mockUseDetail.mockReturnValue(detail);
    renderPage();

    const props = getCapturedViewProps();
    const intersection = makeFilter({
      range: 'this_month',
      profile: PROFILE_ID,
      operationType: OPERATION_TYPE,
      status: 'SUCCEEDED',
    });
    props.onRequestApply(intersection);
    expect(detail.close).toHaveBeenCalledTimes(1);
    expect(dashboard.setDraftFilter).toHaveBeenCalledWith(intersection);
    expect(dashboard.applyDraftFilter).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    props.onTrendDrillDown({
      status: 'FAILED',
      start: '2026-08-19T01:00:00.000Z',
      end: '2026-08-19T02:00:00.000Z',
      startInclusive: true,
      endInclusive: false,
      localKey: '2026-08-19T08:00',
      occurrence: 0,
    });

    expect(detail.close).toHaveBeenCalledTimes(1);
    expect(dashboard.setDraftFilter).toHaveBeenCalledWith({
      range: 'today',
      profile: PROFILE_ID,
      operationType: OPERATION_TYPE,
      status: 'FAILED',
      query: 'CASE-OLD',
      searchMode: 'contains',
      page: 1,
    });
    expect(dashboard.applyDraftFilter).toHaveBeenCalledTimes(1);
  });

  it('replaces every visible dashboard section and timestamp from one complete snapshot', () => {
    const oldSnapshot = makeSnapshot('old');
    const newSnapshot = makeSnapshot('new');
    mockUseDashboard.mockReturnValue(makeDashboardHook(oldSnapshot));
    const oldHtml = renderPage();

    mockUseDashboard.mockReturnValue(makeDashboardHook(newSnapshot));
    const newHtml = renderPage();

    expect(oldHtml).toContain('CASE-OLD');
    expect(oldHtml).toContain('Profile OLD');
    expect(oldHtml).toContain('1,700');
    expect(oldHtml).toContain(oldSnapshot.queryTimestamp);
    expect(newHtml).toContain('CASE-NEW');
    expect(newHtml).toContain('Profile NEW');
    expect(newHtml).toContain('2,900');
    expect(newHtml).toContain(newSnapshot.queryTimestamp);
    expect(newHtml).not.toContain('CASE-OLD');
    expect(newHtml).not.toContain('Profile OLD');
    expect(newHtml).not.toContain('1,700');
    expect(newHtml).not.toContain(oldSnapshot.queryTimestamp);
  });

  it('retains the prior whole snapshot and query timestamp when refresh fails', () => {
    const priorSnapshot = makeSnapshot('old');
    const dashboard = makeDashboardHook(priorSnapshot, {
      phase: 'stale-ready',
      staleWarning: staleError,
    });
    mockUseDashboard.mockReturnValue(dashboard);

    const html = renderPage();
    getCapturedViewProps().onRefresh();

    expect(dashboard.refresh).toHaveBeenCalledTimes(1);
    expect(html).toContain('Dữ liệu chưa được làm mới');
    expect(html).toContain('Refresh failed');
    expect(html).toContain('CASE-OLD');
    expect(html).toContain('Profile OLD');
    expect(html).toContain('1,700');
    expect(html).toContain(priorSnapshot.queryTimestamp);
    expect(html).not.toContain('CASE-NEW');
  });

  it('isolates business detail by selected token and page across loading, failure, and success', () => {
    const dashboard = makeDashboardHook(makeSnapshot('old'));
    const detailA = makeDetailHook({
      token: 'token-old',
      response: makeDetailResponse('old'),
    });
    mockUseDashboard.mockReturnValue(dashboard);
    mockUseDetail.mockReturnValue(detailA);

    const detailAHtml = renderPage();
    const detailAProps = getCapturedViewProps();
    detailAProps.onDetailPageChange(2);
    detailAProps.onOpenDetail('token-new');
    expect(detailA.changePage).toHaveBeenCalledWith(2);
    expect(detailA.open).toHaveBeenCalledWith('token-new');
    expect(detailAHtml).toContain('REQUEST-OLD');

    const detailBLoading = makeDetailHook({
      token: 'token-new',
      page: 2,
      response: makeDetailResponse('old'),
      loading: true,
    });
    mockUseDetail.mockReturnValue(detailBLoading);
    const loadingHtml = renderPage();
    expect(loadingHtml).toContain('Đang tải request thành phần');
    expect(loadingHtml).not.toContain('REQUEST-OLD');

    mockUseDetail.mockReturnValue(makeDetailHook({
      token: 'token-new',
      page: 2,
      response: makeDetailResponse('old'),
      error: 'Detail forbidden',
    }));
    const failedHtml = renderPage();
    expect(failedHtml).toContain('Detail forbidden');
    expect(failedHtml).toContain('Thử lại');
    expect(failedHtml).not.toContain('REQUEST-OLD');

    mockUseDetail.mockReturnValue(makeDetailHook({
      token: 'token-new',
      page: 2,
      response: makeDetailResponse('new', 2),
    }));
    const detailBHtml = renderPage();
    expect(detailBHtml).toContain('REQUEST-NEW');
    expect(detailBHtml).toContain('Trang 2/2');
    expect(detailBHtml).not.toContain('REQUEST-OLD');
  });
});
