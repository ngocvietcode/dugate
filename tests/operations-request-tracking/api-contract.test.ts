import {
  ApiProblemError,
  apiProblemResponse,
  authGuardProblemResponse,
  getOrCreateApiRequestId,
  parseAuthorizedBusinessOperationsDashboardQuery,
  parseBusinessOperationsDashboardQuery,
  toApiProblem,
} from '@/lib/operations/api-contract';
import {
  BusinessQueryError,
  type BusinessQueryAuthorizationContext,
} from '@/lib/operations/business-query';

function authorization(
  overrides: Partial<BusinessQueryAuthorizationContext> = {},
): BusinessQueryAuthorizationContext {
  return {
    actorId: 'operator-1',
    canReadOperations: true,
    allowedProfileIds: ['profile-a'],
    canReadInternalScope: true,
    ...overrides,
  };
}

describe('Business Operations API query parsing', () => {
  it('applies stable defaults without turning an absent search into a query', () => {
    expect(parseBusinessOperationsDashboardQuery(new URLSearchParams())).toEqual({
      sort: 'recent',
      range: 'today',
      profile: 'ALL',
      operationType: 'ALL',
      status: 'ALL',
      query: null,
      searchMode: null,
      page: 1,
    });
  });

  it('parses, trims, and maps all public query parameter names', () => {
    const params = new URLSearchParams({
      sort: 'recent',
      range: 'last_month',
      profile: ' profile-a ',
      operation_type: ' workflows:payroll ',
      status: 'N/A',
      q: ' Case-42 ',
      search_mode: 'contains',
      page: '3',
    });

    expect(parseBusinessOperationsDashboardQuery(params)).toEqual({
      sort: 'recent',
      range: 'last_month',
      profile: 'profile-a',
      operationType: 'workflows:payroll',
      status: 'N/A',
      query: 'Case-42',
      searchMode: 'contains',
      page: 3,
    });
  });

  it.each([
    ['range=rolling_week', 'INVALID_FILTER'],
    ['profile=+++', 'INVALID_FILTER'],
    ['operation_type=', 'INVALID_FILTER'],
    ['status=UNKNOWN', 'INVALID_FILTER'],
    ['search_mode=prefix&q=case', 'INVALID_FILTER'],
    ['page=0', 'INVALID_FILTER'],
    ['page=1.5', 'INVALID_FILTER'],
    ['q=+++', 'INVALID_SEARCH'],
    [`q=${'x'.repeat(257)}`, 'INVALID_SEARCH'],
    ['q=a&q=b', 'INVALID_SEARCH'],
  ])('rejects invalid query "%s" as %s', (query, expectedCode) => {
    expect(() => parseBusinessOperationsDashboardQuery(new URLSearchParams(query)))
      .toThrow(expect.objectContaining({ code: expectedCode }));
  });

  it('rejects invalid search and forbidden profile before an aggregate callback can run', () => {
    const aggregateQuery = jest.fn();
    const execute = (
      params: URLSearchParams,
      auth: BusinessQueryAuthorizationContext,
    ) => {
      const input = parseAuthorizedBusinessOperationsDashboardQuery(params, auth);
      aggregateQuery(input);
    };

    expect(() => execute(new URLSearchParams({ q: '   ' }), authorization()))
      .toThrow(expect.objectContaining({ code: 'INVALID_SEARCH' }));
    expect(() => execute(
      new URLSearchParams({ profile: 'profile-private' }),
      authorization(),
    )).toThrow(expect.objectContaining({ code: 'PROFILE_SCOPE_FORBIDDEN' }));
    expect(aggregateQuery).not.toHaveBeenCalled();
  });

  it('accepts assigned, global, and permitted internal scopes', () => {
    expect(parseAuthorizedBusinessOperationsDashboardQuery(
      new URLSearchParams({ profile: 'profile-a' }),
      authorization(),
    ).profile).toBe('profile-a');
    expect(parseAuthorizedBusinessOperationsDashboardQuery(
      new URLSearchParams({ profile: 'profile-any' }),
      authorization({ allowedProfileIds: null }),
    ).profile).toBe('profile-any');
    expect(parseAuthorizedBusinessOperationsDashboardQuery(
      new URLSearchParams({ profile: '__internal__' }),
      authorization(),
    ).profile).toBe('__internal__');
  });
});

describe('Business Operations API problem contract', () => {
  it.each([
    ['INVALID_FILTER', 400, false],
    ['INVALID_SEARCH', 400, false],
    ['INVALID_OPERATION_TOKEN', 400, false],
    ['UNAUTHORIZED', 401, false],
    ['OPERATIONS_FORBIDDEN', 403, false],
    ['PROFILE_SCOPE_FORBIDDEN', 403, false],
    ['BUSINESS_OPERATION_NOT_FOUND', 404, false],
    ['DASHBOARD_QUERY_FAILED', 500, false],
    ['DASHBOARD_UNAVAILABLE', 503, true],
    ['DASHBOARD_TIMEOUT', 504, true],
  ] as const)('maps %s to HTTP %i with retryable=%s', (code, status, retryable) => {
    expect(toApiProblem(new ApiProblemError(code), 'request-fixed')).toEqual({
      status,
      body: {
        error: {
          code,
          message: expect.any(String),
          retryable,
          requestId: 'request-fixed',
        },
      },
    });
  });

  it('maps query, timeout, and availability errors without using source messages', () => {
    expect(toApiProblem(
      new BusinessQueryError('PROFILE_SCOPE_FORBIDDEN', 'secret-profile-99'),
      'request-1',
    )).toMatchObject({
      status: 403,
      body: { error: { code: 'PROFILE_SCOPE_FORBIDDEN' } },
    });
    expect(toApiProblem({ code: '57014', message: 'canceling SQL statement' }, 'request-2'))
      .toMatchObject({ status: 504, body: { error: { code: 'DASHBOARD_TIMEOUT' } } });
    expect(toApiProblem({ name: 'AbortError', message: 'client timeout' }, 'request-abort'))
      .toMatchObject({ status: 504, body: { error: { code: 'DASHBOARD_TIMEOUT' } } });
    expect(toApiProblem({
      message: 'wrapper',
      cause: { code: 'ECONNREFUSED', message: 'database host db.internal' },
    }, 'request-3')).toMatchObject({
      status: 503,
      body: { error: { code: 'DASHBOARD_UNAVAILABLE' } },
    });
  });

  it('returns a sanitized no-store response with a matching request ID', async () => {
    const sourceError = new Error(
      'SELECT * FROM secret_table WHERE profile_id = unauthorized-profile-7',
    );
    sourceError.stack = 'sensitive-stack-trace';

    const response = apiProblemResponse(sourceError, 'request-safe-7');
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe('request-safe-7');
    expect(body).toEqual({
      error: {
        code: 'DASHBOARD_QUERY_FAILED',
        message: 'The Business Operations query failed.',
        retryable: false,
        requestId: 'request-safe-7',
      },
    });
    expect(serialized).not.toContain('SELECT');
    expect(serialized).not.toContain('secret_table');
    expect(serialized).not.toContain('unauthorized-profile-7');
    expect(serialized).not.toContain('sensitive-stack-trace');
  });

  it('normalizes legacy auth statuses and accepts only bounded request IDs', async () => {
    const unauthorized = authGuardProblemResponse(401, 'request-auth');
    const forbidden = authGuardProblemResponse(403, 'request-authz');

    await expect(unauthorized.json()).resolves.toMatchObject({
      error: { code: 'UNAUTHORIZED', requestId: 'request-auth' },
    });
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: 'OPERATIONS_FORBIDDEN', requestId: 'request-authz' },
    });
    expect(getOrCreateApiRequestId(' client-request:42 ')).toBe('client-request:42');
    expect(getOrCreateApiRequestId('unsafe request id with spaces'))
      .toMatch(/^[0-9a-f-]{36}$/);
  });
});
