import { NextRequest, NextResponse } from 'next/server';
import * as businessQuery from '@/lib/operations/business-query';

const mockRequireCapability = jest.fn();
const mockGetAssignedProfileIds = jest.fn();
const mockGetRolloutConfig = jest.fn();
const mockShouldRunShadowRead = jest.fn();

jest.mock('@/lib/auth-guard', () => ({
  requireCapability: mockRequireCapability,
  getAssignedProfileIds: mockGetAssignedProfileIds,
}));

jest.mock('@/lib/operations/rollout', () => ({
  getBusinessOperationsRolloutConfig: mockGetRolloutConfig,
  shouldRunBusinessOperationsShadowRead: mockShouldRunShadowRead,
}));

import {
  GET as getDashboard,
  dynamic as dashboardDynamic,
} from '@/app/api/internal/business-operations/route';
import {
  GET as getFilterOptions,
  dynamic as filterOptionsDynamic,
} from '@/app/api/internal/business-operations/filter-options/route';

function request(path: string, requestId = 'route-test-request'): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: { 'x-request-id': requestId },
  });
}

const dashboardSnapshot: businessQuery.BusinessOperationsDashboardResponse = {
  queryTimestamp: '2026-08-17T08:00:00.000Z',
  calendarTimezone: 'Asia/Ho_Chi_Minh',
  resolvedWindow: {
    start: '2026-08-16T17:00:00.000Z',
    end: '2026-08-17T08:00:00.000Z',
    startInclusive: true,
    endInclusive: true,
    preset: 'today',
  },
  appliedFilter: {
    range: 'today',
    profile: 'profile-a',
    operationType: 'ALL',
    status: 'ALL',
    search: null,
    page: 1,
    sort: 'recent',
  },
  summary: {
    totalCases: 1,
    tokensProcessed: 30,
    totalCostUsd: '1.2500000000',
    logicSuccessRate: 100,
    aiExtractionRate: null,
    p95DurationSeconds: null,
    unpricedRequestCount: 0,
    costIncomplete: false,
  },
  breakdownCards: [],
  trend: { bucket: 'hour', points: [] },
  list: { items: [], page: 1, pageSize: 50, total: 1, totalPages: 1 },
};

const filterOptions: businessQuery.BusinessOperationFilterOptions = {
  profiles: [{ id: 'profile-a', name: 'Profile A' }],
  operationTypes: ['workflows:payroll'],
  hasInternalScope: true,
};

describe('Business Operations internal routes', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRequireCapability.mockResolvedValue({
      session: { user: { id: 'operator-1', username: 'ops', role: 'OPS' } },
    });
    mockGetAssignedProfileIds.mockResolvedValue(['profile-a']);
    mockGetRolloutConfig.mockResolvedValue({
      dashboardEnabled: true,
      shadowReadEnabled: false,
      shadowSampleRate: 0.1,
    });
    mockShouldRunShadowRead.mockReturnValue(false);
  });

  it('marks both routes force-dynamic', () => {
    expect(dashboardDynamic).toBe('force-dynamic');
    expect(filterOptionsDynamic).toBe('force-dynamic');
  });

  it('returns the exact dashboard service contract using parsed filters and current scope', async () => {
    const getSnapshot = jest.spyOn(businessQuery, 'getBusinessOperationsDashboardSnapshot')
      .mockResolvedValue(dashboardSnapshot);

    const response = await getDashboard(request(
      '/api/internal/business-operations?profile=profile-a&range=today',
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(dashboardSnapshot);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe('route-test-request');
    expect(mockRequireCapability).toHaveBeenCalledWith('operations:read');
    expect(mockGetAssignedProfileIds).toHaveBeenCalledWith('operations:read');
    expect(getSnapshot).toHaveBeenCalledWith(
      {
        range: 'today',
        profile: 'profile-a',
        operationType: 'ALL',
        status: 'ALL',
        query: null,
        searchMode: null,
        page: 1,
      },
      {
        actorId: 'operator-1',
        actorRole: 'OPS',
        requestId: 'route-test-request',
        canReadOperations: true,
        allowedProfileIds: ['profile-a'],
        canReadInternalScope: true,
      },
      { shadowRead: false },
    );
  });

  it('passes the deterministic sampling decision to the selected shadow implementation', async () => {
    const rollout = {
      dashboardEnabled: true,
      shadowReadEnabled: true,
      shadowSampleRate: 0.25,
    };
    mockGetRolloutConfig.mockResolvedValue(rollout);
    mockShouldRunShadowRead.mockReturnValue(true);
    const getSnapshot = jest.spyOn(businessQuery, 'getBusinessOperationsDashboardSnapshot')
      .mockResolvedValue(dashboardSnapshot);

    const response = await getDashboard(request(
      '/api/internal/business-operations?profile=profile-a&range=today',
      'sampled-shadow-request',
    ));

    expect(response.status).toBe(200);
    expect(mockShouldRunShadowRead).toHaveBeenCalledWith(
      rollout,
      'sampled-shadow-request:profile=profile-a&range=today',
    );
    expect(getSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'today', profile: 'profile-a' }),
      expect.objectContaining({ requestId: 'sampled-shadow-request' }),
      { shadowRead: true },
    );
  });

  it.each([
    {
      label: 'an assigned profile',
      assignedProfileIds: ['profile-a'],
      selectedProfile: 'profile-a',
    },
    {
      label: 'any profile under global access',
      assignedProfileIds: null,
      selectedProfile: 'profile-global',
    },
    {
      label: 'the internal scope with no profile assignments',
      assignedProfileIds: [],
      selectedProfile: '__internal__',
    },
  ])('passes the current authorization context for $label', async ({
    assignedProfileIds,
    selectedProfile,
  }) => {
    mockGetAssignedProfileIds.mockResolvedValue(assignedProfileIds);
    const getSnapshot = jest.spyOn(businessQuery, 'getBusinessOperationsDashboardSnapshot')
      .mockResolvedValue({
        ...dashboardSnapshot,
        appliedFilter: { ...dashboardSnapshot.appliedFilter, profile: selectedProfile },
      });

    const response = await getDashboard(request(
      `/api/internal/business-operations?profile=${encodeURIComponent(selectedProfile)}`,
    ));

    expect(response.status).toBe(200);
    expect(getSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ profile: selectedProfile }),
      expect.objectContaining({
        allowedProfileIds: assignedProfileIds,
        canReadInternalScope: true,
      }),
      { shadowRead: false },
    );
  });

  it('rejects a profile outside the current assignment before calling the service', async () => {
    const getSnapshot = jest.spyOn(businessQuery, 'getBusinessOperationsDashboardSnapshot');

    const response = await getDashboard(request(
      '/api/internal/business-operations?profile=profile-private',
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'PROFILE_SCOPE_FORBIDDEN',
        retryable: false,
        requestId: 'route-test-request',
      },
    });
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('re-checks capability on every request and stops all scoped work after revocation', async () => {
    const getSnapshot = jest.spyOn(businessQuery, 'getBusinessOperationsDashboardSnapshot')
      .mockResolvedValue(dashboardSnapshot);

    const beforeRevoke = await getDashboard(request('/api/internal/business-operations'));
    expect(beforeRevoke.status).toBe(200);

    mockRequireCapability.mockResolvedValue(
      NextResponse.json({ error: 'revoked' }, { status: 403 }),
    );
    const afterRevoke = await getDashboard(request('/api/internal/business-operations'));

    expect(afterRevoke.status).toBe(403);
    await expect(afterRevoke.json()).resolves.toMatchObject({
      error: { code: 'OPERATIONS_FORBIDDEN' },
    });
    expect(mockRequireCapability).toHaveBeenCalledTimes(2);
    expect(mockGetAssignedProfileIds).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'OPERATIONS_FORBIDDEN'],
  ] as const)('normalizes a legacy %i guard response into %s', async (status, code) => {
    mockRequireCapability.mockResolvedValue(
      NextResponse.json({ error: 'legacy auth body' }, { status }),
    );
    const getSnapshot = jest.spyOn(businessQuery, 'getBusinessOperationsDashboardSnapshot');

    const response = await getDashboard(request('/api/internal/business-operations'));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      error: { code, requestId: 'route-test-request' },
    });
    expect(mockGetAssignedProfileIds).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('maps database timeout failures to a retryable 504 without partial dashboard sections', async () => {
    jest.spyOn(businessQuery, 'getBusinessOperationsDashboardSnapshot').mockRejectedValue({
      code: '57014',
      message: 'canceling statement with private SQL and partial aggregates',
    });

    const response = await getDashboard(request('/api/internal/business-operations'));
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body).toEqual({
      error: {
        code: 'DASHBOARD_TIMEOUT',
        message: 'The Business Operations query timed out.',
        retryable: true,
        requestId: 'route-test-request',
      },
    });
    expect(body).not.toHaveProperty('summary');
    expect(body).not.toHaveProperty('breakdownCards');
    expect(body).not.toHaveProperty('trend');
    expect(body).not.toHaveProperty('list');
    expect(JSON.stringify(body)).not.toContain('private SQL');
    expect(JSON.stringify(body)).not.toContain('partial aggregates');
  });

  it.each([
    ['assigned profiles', ['profile-a', 'profile-b']],
    ['all profiles', null],
    ['internal only', []],
  ] as const)('returns filter options for %s without wrapping the service payload', async (_label, scope) => {
    mockGetAssignedProfileIds.mockResolvedValue(scope);
    const getOptions = jest.spyOn(businessQuery, 'getBusinessOperationFilterOptions')
      .mockResolvedValue(filterOptions);

    const response = await getFilterOptions(request(
      '/api/internal/business-operations/filter-options',
      'filter-options-request',
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(filterOptions);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe('filter-options-request');
    expect(getOptions).toHaveBeenCalledWith({
      actorId: 'operator-1',
      actorRole: 'OPS',
      requestId: 'filter-options-request',
      canReadOperations: true,
      allowedProfileIds: scope,
      canReadInternalScope: true,
    });
  });

  it('sanitizes query-service failures instead of exposing their source message', async () => {
    jest.spyOn(businessQuery, 'getBusinessOperationFilterOptions')
      .mockRejectedValue(new Error('SELECT secret_payload FROM private_table'));

    const response = await getFilterOptions(request(
      '/api/internal/business-operations/filter-options',
    ));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: {
        code: 'DASHBOARD_QUERY_FAILED',
        retryable: false,
        requestId: 'route-test-request',
      },
    });
    expect(JSON.stringify(body)).not.toContain('secret_payload');
    expect(JSON.stringify(body)).not.toContain('private_table');
  });
});
