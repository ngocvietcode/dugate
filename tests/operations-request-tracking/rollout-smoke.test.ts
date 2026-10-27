import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest, NextResponse } from 'next/server';

const mockRequireCapability = jest.fn();
const mockGetAssignedProfileIds = jest.fn();
const mockGetDashboardSnapshot = jest.fn();
const mockGetBusinessOperationDetail = jest.fn();
const mockGetRolloutConfig = jest.fn();
const mockShouldRunShadowRead = jest.fn();

jest.mock('@/lib/auth-guard', () => ({
  requireCapability: (...args: unknown[]) => mockRequireCapability(...args),
  getAssignedProfileIds: (...args: unknown[]) => mockGetAssignedProfileIds(...args),
}));

jest.mock('@/lib/operations/business-query', () => {
  const actual = jest.requireActual('@/lib/operations/business-query');
  return {
    ...actual,
    getBusinessOperationsDashboardSnapshot: (...args: unknown[]) => (
      mockGetDashboardSnapshot(...args)
    ),
    getBusinessOperationDetail: (...args: unknown[]) => mockGetBusinessOperationDetail(...args),
  };
});

jest.mock('@/lib/operations/rollout', () => {
  const actual = jest.requireActual('@/lib/operations/rollout');
  return {
    ...actual,
    getBusinessOperationsRolloutConfig: (...args: unknown[]) => mockGetRolloutConfig(...args),
    shouldRunBusinessOperationsShadowRead: (...args: unknown[]) => mockShouldRunShadowRead(...args),
  };
});

import DashboardStats from '@/app/operations/components/DashboardStats';
import BusinessBreakdownGrid from '@/app/operations/components/BusinessBreakdownGrid';
import BusinessOperationDetail from '@/app/operations/components/BusinessOperationDetail';
import type {
  BusinessOperationBreakdownCard,
  BusinessOperationDetailResponse,
  BusinessOperationsDashboardResponse,
} from '@/app/operations/types';
import { BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS } from '@/app/operations/types';
import { GET as getBusinessDashboard } from '@/app/api/internal/business-operations/route';
import { GET as getBusinessDetail } from '@/app/api/internal/business-operations/[token]/requests/route';
import { GET as getLegacyOperations } from '@/app/api/internal/operations/route';
import { GET as getLegacyRequestDetail } from '@/app/api/internal/operations/[id]/route';
import { GET as exportLegacyCsv } from '@/app/api/internal/operations/export-csv/route';
import { POST as exportLegacyJson } from '@/app/api/internal/operations/export-json/route';
import { POST as exportLegacyHtml } from '@/app/api/internal/operations/export-html/route';
import {
  BUSINESS_DASHBOARD_ENV,
  resolveBusinessOperationsRolloutConfig,
  selectOperationsDashboardVariant,
} from '@/lib/operations/rollout';
import {
  createBusinessOperationDetailProjection,
  projectBusinessOperations,
  type OperationRequestProjectionSource,
} from '@/lib/operations/projection';
import { SETTING_DEFAULTS } from '@/lib/settings';

const QUERY_TIMESTAMP = '2026-08-19T09:00:00.000Z';
const ASSIGNED_PROFILE = 'profile-assigned';

const summary = {
  totalCases: 2,
  tokensProcessed: 450,
  totalCostUsd: '2.5000000000',
  logicSuccessRate: 100,
  aiExtractionRate: 50,
  p95DurationSeconds: 45,
  unpricedRequestCount: 0,
  costIncomplete: false,
};

const breakdownCard: BusinessOperationBreakdownCard = {
  profileScope: { id: ASSIGNED_PROFILE, name: 'Assigned Profile' },
  operationType: 'extract:invoice',
  businessOperationCount: 2,
  succeededCount: 2,
  failedCount: 0,
  successPercentage: 100,
  requestCount: 3,
  inputTokens: 300,
  outputTokens: 150,
  costUsd: '2.5000000000',
  averageTokensPerBusinessOperation: 225,
  averageDurationSeconds: 30,
  maxDurationSeconds: 45,
  maxTokenCount: 300,
  maxDurationOperationIdentifier: 'CASE-42',
  maxTokenOperationIdentifier: 'CASE-42',
  maxDurationOperationToken: 'signed-case-42',
  maxTokenOperationToken: 'signed-case-42',
  unpricedRequestCount: 0,
  costIncomplete: false,
};

const dashboardSnapshot: BusinessOperationsDashboardResponse = {
  queryTimestamp: QUERY_TIMESTAMP,
  calendarTimezone: 'Asia/Ho_Chi_Minh',
  resolvedWindow: {
    start: '2026-08-18T17:00:00.000Z',
    end: QUERY_TIMESTAMP,
    startInclusive: true,
    endInclusive: true,
    preset: 'today',
  },
  appliedFilter: {
    range: 'today',
    profile: ASSIGNED_PROFILE,
    operationType: 'ALL',
    status: 'ALL',
    search: null,
    page: 1,
    sort: 'recent',
  },
  summary,
  breakdownCards: [breakdownCard],
  trend: { bucket: 'hour', points: [] },
  list: { items: [], page: 1, pageSize: 50, total: 2, totalPages: 1 },
};

const detailResponse: BusinessOperationDetailResponse = {
  queryTimestamp: QUERY_TIMESTAMP,
  operation: {
    token: 'signed-case-42',
    operationIdentifier: 'CASE-42',
    normalizedReference: 'CASE-42',
    profileScope: { id: ASSIGNED_PROFILE, name: 'Assigned Profile' },
    operationTypes: ['extract:invoice', 'validate:invoice'],
    businessStatus: 'SUCCEEDED',
    invalidData: false,
    requestCount: 2,
    startTime: '2026-08-19T01:00:00.000Z',
    updatedTime: '2026-08-19T01:02:00.000Z',
    totalTokens: 350,
    totalCostUsd: '2.0000000000',
    unpricedRequestCount: 0,
    missingData: false,
    endTime: '2026-08-19T01:02:00.000Z',
    durationSeconds: 120,
  },
  requests: {
    items: [
      {
        id: 'request/one 42?#',
        operationType: 'extract:invoice',
        state: 'SUCCEEDED',
        startedAt: '2026-08-19T01:00:00.000Z',
        completedAt: '2026-08-19T01:01:00.000Z',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: '1.0000000000',
        errorCode: null,
        errorMessage: null,
        missingData: false,
        unpricedCost: false,
      },
      {
        id: 'request-two',
        operationType: 'validate:invoice',
        state: 'SUCCEEDED',
        startedAt: '2026-08-19T01:01:00.000Z',
        completedAt: '2026-08-19T01:02:00.000Z',
        inputTokens: 150,
        outputTokens: 50,
        costUsd: '1.0000000000',
        errorCode: null,
        errorMessage: null,
        missingData: false,
        unpricedCost: false,
      },
    ],
    page: 1,
    pageSize: 100,
    total: 2,
    totalPages: 1,
  },
};

function sourceRequest(
  id: string,
  overrides: Partial<OperationRequestProjectionSource> = {},
): OperationRequestProjectionSource {
  return {
    id,
    apiKeyId: ASSIGNED_PROFILE,
    clientReference: 'CASE-42',
    endpointSlug: 'extract:invoice',
    state: 'SUCCEEDED',
    createdAt: new Date('2026-08-19T01:00:00.000Z'),
    updatedAt: new Date('2026-08-19T01:01:00.000Z'),
    completedAt: new Date('2026-08-19T01:01:00.000Z'),
    deletedAt: null,
    hiddenFromOperations: false,
    ...overrides,
  };
}

function jsonRequest(path: string, method: 'POST' = 'POST', body: unknown = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function enabledConfig() {
  return resolveBusinessOperationsRolloutConfig(SETTING_DEFAULTS, {
    [BUSINESS_DASHBOARD_ENV]: 'true',
  });
}

function disabledConfig() {
  return resolveBusinessOperationsRolloutConfig(SETTING_DEFAULTS, {
    [BUSINESS_DASHBOARD_ENV]: 'false',
  });
}

describe('automated Operations rollout smoke suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCapability.mockResolvedValue({
      session: { user: { id: 'operator-1', username: 'operator', role: 'OPS' } },
    });
    mockGetAssignedProfileIds.mockResolvedValue([ASSIGNED_PROFILE]);
    mockGetRolloutConfig.mockResolvedValue({
      dashboardEnabled: true,
      shadowReadEnabled: false,
      shadowSampleRate: 0,
    });
    mockShouldRunShadowRead.mockReturnValue(false);
    mockGetDashboardSnapshot.mockResolvedValue(dashboardSnapshot);
    mockGetBusinessOperationDetail.mockResolvedValue(detailResponse);
  });

  it('smokes the enabled Business dashboard from authorized grouping through its reference contract', async () => {
    expect(selectOperationsDashboardVariant(enabledConfig())).toBe('business');

    const sourceRows = [
      sourceRequest('request-one', { clientReference: '  CASE-42  ' }),
      sourceRequest('request-two', {
        clientReference: 'CASE-42',
        endpointSlug: 'validate:invoice',
        createdAt: new Date('2026-08-19T01:01:00.000Z'),
      }),
      sourceRequest('standalone-request', { clientReference: '   ' }),
      sourceRequest('not-assigned', {
        apiKeyId: 'profile-private',
        clientReference: 'CASE-42',
      }),
    ];
    const authorizedRows = sourceRows.filter((row) => (
      row.apiKeyId === null || row.apiKeyId === ASSIGNED_PROFILE
    ));
    const operations = projectBusinessOperations(authorizedRows);
    const referenced = operations.find((operation) => operation.operationIdentifier === 'CASE-42');
    const standalone = operations.find(
      (operation) => operation.operationIdentifier === 'standalone-request',
    );

    expect(operations).toHaveLength(2);
    expect(referenced).toMatchObject({
      normalizedReference: 'CASE-42',
      requestCount: 2,
      profileScope: { kind: 'profile', apiKeyId: ASSIGNED_PROFILE },
    });
    expect(referenced?.requests.map((request) => request.requestId)).toEqual([
      'request-one',
      'request-two',
    ]);
    expect(standalone).toMatchObject({
      normalizedReference: null,
      operationIdentifier: 'standalone-request',
      requestCount: 1,
    });
    expect(createBusinessOperationDetailProjection(referenced!).requests).toHaveLength(2);

    const response = await getBusinessDashboard(new NextRequest(
      `http://localhost/api/internal/business-operations?range=today&profile=${ASSIGNED_PROFILE}`,
      { headers: { 'x-request-id': 'rollout-smoke-dashboard' } },
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(dashboardSnapshot);
    expect(mockRequireCapability).toHaveBeenCalledWith('operations:read');
    expect(mockGetAssignedProfileIds).toHaveBeenCalledWith('operations:read');
    expect(mockGetDashboardSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'today', profile: ASSIGNED_PROFILE }),
      expect.objectContaining({
        canReadOperations: true,
        allowedProfileIds: [ASSIGNED_PROFILE],
      }),
      { shadowRead: false },
    );

    expect(BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS).toEqual([
      { value: 'today', label: 'Hôm nay' },
      { value: 'this_month', label: 'Tháng này' },
      { value: 'last_month', label: 'Tháng trước' },
      { value: 'three_month_trend', label: 'Xu hướng 3 tháng' },
    ]);

    const kpiHtml = renderToStaticMarkup(createElement(DashboardStats, { summary }));
    expect((kpiHtml.match(/<article/g) ?? [])).toHaveLength(5);
    for (const label of [
      'Total Cases',
      'Tokens Processed',
      'Total Cost USD',
      'Logic Success Rate',
      'AI Extraction Rate',
    ]) {
      expect(kpiHtml).toContain(label);
    }

    const breakdownHtml = renderToStaticMarkup(createElement(BusinessBreakdownGrid, {
      cards: [breakdownCard],
    }));
    expect(breakdownHtml).toMatch(/Cases<\/span><\/div><p[^>]*>2<\/p>/);
    expect(breakdownHtml).toMatch(/Requests<\/span><\/div><p[^>]*>3<\/p>/);
  });

  it('re-authorizes Business detail and navigates each constituent to its exact request detail', async () => {
    expect(selectOperationsDashboardVariant(enabledConfig())).toBe('business');

    const response = await getBusinessDetail(
      new NextRequest(
        'http://localhost/api/internal/business-operations/signed-case-42/requests?page=1',
        { headers: { 'x-request-id': 'rollout-smoke-detail' } },
      ),
      { params: Promise.resolve({ token: 'signed-case-42' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(detailResponse);
    expect(mockRequireCapability).toHaveBeenCalledWith('operations:read');
    expect(mockGetAssignedProfileIds).toHaveBeenCalledWith('operations:read');
    expect(mockGetBusinessOperationDetail).toHaveBeenCalledWith(
      'signed-case-42',
      1,
      expect.objectContaining({
        canReadOperations: true,
        allowedProfileIds: [ASSIGNED_PROFILE],
      }),
    );

    const detailHtml = renderToStaticMarkup(createElement(BusinessOperationDetail, {
      token: 'signed-case-42',
      timeZone: 'UTC',
      response: detailResponse,
      onPageChange: () => undefined,
    }));
    expect(detailHtml).toContain(
      `href="/operations/${encodeURIComponent(detailResponse.requests.items[0].id)}"`,
    );
    expect(detailHtml).toContain('href="/operations/request-two"');
    expect((detailHtml.match(/href="\/operations\//g) ?? [])).toHaveLength(2);
  });

  it('keeps legacy request routes and the CSV export callable when rollback selects legacy', async () => {
    expect(selectOperationsDashboardVariant(disabledConfig())).toBe('legacy');
    expect(typeof getLegacyOperations).toBe('function');
    expect(typeof getLegacyRequestDetail).toBe('function');
    expect(typeof exportLegacyCsv).toBe('function');
    expect(typeof exportLegacyJson).toBe('function');
    expect(typeof exportLegacyHtml).toBe('function');

    const listResponse = await getLegacyOperations(new NextRequest(
      'http://localhost/api/internal/operations?state=NOT_A_STATE',
    ));
    expect(listResponse.status).toBe(400);
    await expect(listResponse.json()).resolves.toMatchObject({ error: expect.any(String) });

    mockRequireCapability.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const detailResponseBoundary = await getLegacyRequestDetail(
      new NextRequest('http://localhost/api/internal/operations/request-one'),
      { params: Promise.resolve({ id: 'request-one' }) },
    );
    expect(detailResponseBoundary.status).toBe(403);

    const csvResponse = await exportLegacyCsv(new NextRequest(
      'http://localhost/api/internal/operations/export-csv?state=NOT_A_STATE',
    ));
    expect(csvResponse.status).toBe(400);
    await expect(csvResponse.json()).resolves.toMatchObject({ error: expect.any(String) });

    // JSON / HTML exports shipped customer results and were removed (giai đoạn 2):
    // the routes stay callable but answer 410 Gone. CSV (metadata) remains.
    for (const [handler, path] of [
      [exportLegacyJson, '/api/internal/operations/export-json'],
      [exportLegacyHtml, '/api/internal/operations/export-html'],
    ] as const) {
      const exportResponse = await handler(jsonRequest(path, 'POST', { operationIds: ['request-one'] }));
      expect(exportResponse.status).toBe(410);
      await expect(exportResponse.json()).resolves.toMatchObject({ error: expect.any(String) });
    }

    expect(mockRequireCapability).toHaveBeenCalledWith('operations:read');
    expect(mockRequireCapability).toHaveBeenCalledWith('operations:export');
  });
});
