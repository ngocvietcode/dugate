import { NextRequest, NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';

const mockRequireCapability = jest.fn();
const mockGetAssignedProfileIds = jest.fn();
const mockGetBusinessOperationDetail = jest.fn();

jest.mock('@/lib/auth-guard', () => ({
  requireCapability: (...args: unknown[]) => mockRequireCapability(...args),
  getAssignedProfileIds: (...args: unknown[]) => mockGetAssignedProfileIds(...args),
}));

jest.mock('@/lib/operations/business-query', () => {
  const actual = jest.requireActual('@/lib/operations/business-query');
  return {
    ...actual,
    getBusinessOperationDetail: (...args: unknown[]) => mockGetBusinessOperationDetail(...args),
  };
});

import {
  BusinessQueryError,
  type BusinessOperationDetailResponse,
} from '@/lib/operations/business-query';
import {
  GET,
  dynamic,
} from '@/app/api/internal/business-operations/[token]/requests/route';

const detailResponse: BusinessOperationDetailResponse = {
  queryTimestamp: '2026-03-21T04:05:06.789Z',
  operation: {
    token: 'signed-token',
    operationIdentifier: 'CASE-42',
    normalizedReference: 'CASE-42',
    profileScope: { id: 'profile-a', name: 'Payroll' },
    operationTypes: ['extract', 'validate'],
    businessStatus: 'FAILED',
    invalidData: false,
    requestCount: 205,
    startTime: '2026-03-21T01:00:00.000Z',
    updatedTime: '2026-03-21T04:00:00.000Z',
    totalTokens: 3500,
    totalCostUsd: '12.3400000000',
    unpricedRequestCount: 1,
    missingData: true,
    endTime: '2026-03-21T03:00:00.000Z',
    durationSeconds: 7200,
  },
  requests: {
    items: [{
      id: 'request-101',
      operationType: 'validate',
      state: 'FAILED',
      startedAt: '2026-03-21T02:00:00.000Z',
      completedAt: '2026-03-21T02:01:00.000Z',
      inputTokens: 100,
      outputTokens: null,
      costUsd: '0.1250000000',
      errorCode: 'VALIDATION_FAILED',
      errorMessage: 'Invalid source structure',
      missingData: true,
      unpricedCost: false,
    }],
    page: 2,
    pageSize: 100,
    total: 205,
    totalPages: 3,
  },
};

function request(query = '', requestId = 'request-detail-1'): NextRequest {
  return new NextRequest(
    `http://localhost/api/internal/business-operations/signed-token/requests${query}`,
    { headers: { 'X-Request-Id': requestId } },
  );
}

function context(token = 'signed-token') {
  return { params: Promise.resolve({ token }) };
}

describe('GET /api/internal/business-operations/[token]/requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCapability.mockResolvedValue({
      session: {
        user: { id: 'operator-1', username: 'operator', role: 'OPS' },
      },
    });
    mockGetAssignedProfileIds.mockResolvedValue(['profile-a']);
    mockGetBusinessOperationDetail.mockResolvedValue(detailResponse);
  });

  it('is dynamic and re-checks capability plus current row scope for the requested page', async () => {
    const response = await GET(request('?page=2'), context());
    const body = await response.json();

    expect(dynamic).toBe('force-dynamic');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe('request-detail-1');
    expect(mockRequireCapability).toHaveBeenCalledWith('operations:read');
    expect(mockGetAssignedProfileIds).toHaveBeenCalledWith('operations:read');
    expect(mockGetBusinessOperationDetail).toHaveBeenCalledWith(
      'signed-token',
      2,
      {
        actorId: 'operator-1',
        actorRole: 'OPS',
        requestId: 'request-detail-1',
        canReadOperations: true,
        allowedProfileIds: ['profile-a'],
        canReadInternalScope: true,
      },
    );
    expect(body).toEqual(detailResponse);
  });

  it('defaults to page 1 and allowlists operational fields from operation and request rows', async () => {
    mockGetBusinessOperationDetail.mockResolvedValue({
      ...detailResponse,
      operation: {
        ...detailResponse.operation,
        output: { text: 'private-output' },
        outputContent: 'must-not-leak',
        document: { content: 'private-document' },
        documentContent: 'private-document-content',
        pipeline: { stages: ['private-pipeline'] },
        pipelineJson: [{ prompt: 'must-not-leak' }],
        prompt: 'private-prompt',
        prompts: ['private-prompts'],
        systemPrompt: 'private-system-prompt',
      },
      requests: {
        ...detailResponse.requests,
        page: 1,
        items: [{
          ...detailResponse.requests.items[0],
          files: [{ name: 'private-file' }],
          filesJson: [{ url: 'https://private.example' }],
          pipelineJson: [{ prompt: 'private-request-prompt' }],
          prompt: 'private-request-prompt',
          documentContent: 'private-request-document',
          outputContent: 'private-request-output',
          extractedData: { secret: true },
          progressLogJson: ['private-progress'],
        }],
      },
    } as unknown as BusinessOperationDetailResponse);

    const response = await GET(request(), context());
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(mockGetBusinessOperationDetail).toHaveBeenCalledWith(
      'signed-token',
      1,
      expect.any(Object),
    );
    expect(body.requests.pageSize).toBe(100);
    for (const forbiddenField of [
      'files',
      'filesJson',
      'pipeline',
      'pipelineJson',
      'prompt',
      'prompts',
      'systemPrompt',
      'document',
      'documentContent',
      'output',
      'outputContent',
      'extractedData',
      'progressLogJson',
    ]) {
      expect(serialized).not.toContain(`"${forbiddenField}":`);
    }
    for (const forbiddenValue of [
      'must-not-leak',
      'private-file',
      'private.example',
      'private-pipeline',
      'private-prompt',
      'private-prompts',
      'private-system-prompt',
      'private-document',
      'private-output',
      'private-progress',
    ]) {
      expect(serialized).not.toContain(forbiddenValue);
    }
  });

  it('uses the latest profile assignments and hides a group revoked after dashboard access', async () => {
    mockGetAssignedProfileIds.mockResolvedValue([]);
    mockGetBusinessOperationDetail.mockRejectedValue(
      new BusinessQueryError('PROFILE_SCOPE_FORBIDDEN', 'profile-a was revoked'),
    );

    const response = await GET(request('', 'assignment-revoked'), context());
    const body = await response.json();

    expect(mockGetBusinessOperationDetail).toHaveBeenCalledWith(
      'signed-token',
      1,
      expect.objectContaining({ allowedProfileIds: [] }),
    );
    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: {
        code: 'BUSINESS_OPERATION_NOT_FOUND',
        message: 'Business Operation not found.',
        retryable: false,
        requestId: 'assignment-revoked',
      },
    });
    expect(JSON.stringify(body)).not.toContain('profile-a');
    expect(JSON.stringify(body)).not.toContain('profile-a was revoked');
  });

  it.each([
    '?page=0',
    '?page=-1',
    '?page=1.5',
    '?page=9007199254740992',
    '?page=1&page=2',
  ])('rejects invalid page query %s before assignment lookup or detail work', async (query) => {
    const response = await GET(request(query), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_FILTER', retryable: false },
    });
    expect(mockGetAssignedProfileIds).not.toHaveBeenCalled();
    expect(mockGetBusinessOperationDetail).not.toHaveBeenCalled();
  });

  it.each([401, 403] as const)('normalizes a %i capability rejection and performs no scoped read', async (status) => {
    mockRequireCapability.mockResolvedValue(
      NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status }),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: status === 401 ? 'UNAUTHORIZED' : 'OPERATIONS_FORBIDDEN',
        requestId: 'request-detail-1',
      },
    });
    expect(mockGetAssignedProfileIds).not.toHaveBeenCalled();
    expect(mockGetBusinessOperationDetail).not.toHaveBeenCalled();
  });

  it('maps malformed signed tokens to the sanitized invalid-token problem', async () => {
    mockGetBusinessOperationDetail.mockRejectedValue(
      new BusinessQueryError('INVALID_OPERATION_TOKEN', 'tampered token details'),
    );

    const response = await GET(request(), context('tampered-token'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: 'INVALID_OPERATION_TOKEN',
      message: 'The Business Operation token is invalid.',
      retryable: false,
    });
    expect(JSON.stringify(body)).not.toContain('tampered token details');
  });

  it('makes an absent group and a revoked cross-scope group indistinguishable', async () => {
    const responses: unknown[] = [];
    for (const error of [
      new BusinessQueryError('BUSINESS_OPERATION_NOT_FOUND', 'operation does not exist'),
      new BusinessQueryError('PROFILE_SCOPE_FORBIDDEN', 'secret-profile-99'),
    ]) {
      mockGetBusinessOperationDetail.mockRejectedValueOnce(error);
      const response = await GET(request('', 'request-stable'), context());
      expect(response.status).toBe(404);
      responses.push(await response.json());
    }

    expect(responses[0]).toEqual(responses[1]);
    expect(responses[0]).toEqual({
      error: {
        code: 'BUSINESS_OPERATION_NOT_FOUND',
        message: 'Business Operation not found.',
        retryable: false,
        requestId: 'request-stable',
      },
    });
    expect(JSON.stringify(responses)).not.toContain('secret-profile-99');
  });

  it('sanitizes unexpected detail failures without returning partial data', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockGetBusinessOperationDetail.mockRejectedValue(
      new Error('SELECT outputContent FROM Operation WHERE profile = secret-profile'),
    );

    const response = await GET(request(), context());
    const body = await response.json();
    const serialized = JSON.stringify(body);
    const logged = JSON.stringify(errorLog.mock.calls);

    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({ code: 'DASHBOARD_QUERY_FAILED' });
    expect(serialized).not.toContain('SELECT');
    expect(serialized).not.toContain('outputContent');
    expect(serialized).not.toContain('secret-profile');
    expect(logged).not.toContain('SELECT');
    expect(logged).not.toContain('outputContent');
    expect(logged).not.toContain('secret-profile');
    expect(errorLog).toHaveBeenCalledWith(
      'Business Operations API request failed',
      expect.objectContaining({
        routeKind: 'detail',
        requestId: 'request-detail-1',
        failureCode: 'DASHBOARD_QUERY_FAILED',
        outcome: 'failure',
      }),
    );
    expect(body).not.toHaveProperty('operation');
    expect(body).not.toHaveProperty('requests');
  });
});
