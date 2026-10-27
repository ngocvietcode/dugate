import { NextRequest, NextResponse } from 'next/server';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import {
  ApiProblemError,
  apiProblemResponse,
  authGuardProblemResponse,
  getOrCreateApiRequestId,
  parseBusinessOperationDetailPage,
  toApiProblem,
} from '@/lib/operations/api-contract';
import {
  BusinessQueryError,
  getBusinessOperationDetail,
  type BusinessOperationDetailResponse,
  type ConstituentRequestItem,
} from '@/lib/operations/business-query';
import {
  profileScopeCount,
  recordBusinessOperationsRoute,
} from '@/lib/operations/telemetry';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = getOrCreateApiRequestId(request.headers.get('x-request-id'));
  const startedAt = Date.now();
  let actorId: string | undefined;
  let actorRole: string | undefined;
  let scopeCount: number | 'all' | undefined;
  let page: number | undefined;

  try {
    const guard = await requireCapability('operations:read');
    if (guard instanceof NextResponse) {
      const code = guard.status === 401 ? 'UNAUTHORIZED' : 'OPERATIONS_FORBIDDEN';
      recordBusinessOperationsRoute({
        kind: 'detail',
        requestId,
        durationMs: Date.now() - startedAt,
        outcome: 'failure',
        failureCode: code,
        retryable: false,
      });
      return authGuardProblemResponse(guard.status === 401 ? 401 : 403, requestId);
    }

    actorId = guard.session.user.id;
    actorRole = guard.session.user.role;
    page = parseBusinessOperationDetailPage(request.nextUrl.searchParams);
    const allowedProfileIds = await getAssignedProfileIds('operations:read');
    scopeCount = profileScopeCount(allowedProfileIds);
    const { token } = await context.params;
    const detail = await getBusinessOperationDetail(token, page, {
      actorId,
      actorRole,
      requestId,
      canReadOperations: true,
      allowedProfileIds,
      // Existing Operations policy permits unscoped operational work after the
      // capability check; profile-backed rows remain assignment-scoped.
      canReadInternalScope: true,
    });
    const response = toOperationalDetailResponse(detail);

    recordBusinessOperationsRoute({
      kind: 'detail',
      requestId,
      actorId,
      actorRole,
      profileScopeCount: scopeCount,
      durationMs: Date.now() - startedAt,
      page,
      resultCount: response.requests.total,
      outcome: 'success',
    });
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    // The query service applies authorization before identity matching, so a
    // revoked/cross-scope token and an absent operation share the same 404.
    const publicError = error instanceof BusinessQueryError
      && error.code === 'PROFILE_SCOPE_FORBIDDEN'
      ? new ApiProblemError('BUSINESS_OPERATION_NOT_FOUND')
      : error;
    const problem = toApiProblem(publicError, requestId);
    recordBusinessOperationsRoute({
      kind: 'detail',
      requestId,
      actorId,
      actorRole,
      profileScopeCount: scopeCount,
      durationMs: Date.now() - startedAt,
      page,
      outcome: problem.body.error.code === 'DASHBOARD_TIMEOUT' ? 'timeout' : 'failure',
      failureCode: problem.body.error.code,
      retryable: problem.body.error.retryable,
    });
    return apiProblemResponse(publicError, requestId);
  }
}

/**
 * Keep this HTTP boundary allowlisted even if the query service grows internal
 * fields later. Document, prompt, pipeline, progress, webhook, and output
 * payloads must never enter the constituent-detail response.
 */
function toOperationalDetailResponse(
  detail: BusinessOperationDetailResponse,
): BusinessOperationDetailResponse {
  const operation = detail.operation;
  return {
    queryTimestamp: detail.queryTimestamp,
    operation: {
      token: operation.token,
      operationIdentifier: operation.operationIdentifier,
      normalizedReference: operation.normalizedReference,
      profileScope: {
        id: operation.profileScope.id,
        name: operation.profileScope.name,
      },
      operationTypes: operation.operationTypes,
      businessStatus: operation.businessStatus,
      invalidData: operation.invalidData,
      requestCount: operation.requestCount,
      startTime: operation.startTime,
      updatedTime: operation.updatedTime,
      totalTokens: operation.totalTokens,
      totalCostUsd: operation.totalCostUsd,
      unpricedRequestCount: operation.unpricedRequestCount,
      missingData: operation.missingData,
      endTime: operation.endTime,
      durationSeconds: operation.durationSeconds,
    },
    requests: {
      items: detail.requests.items.map(toOperationalRequestItem),
      page: detail.requests.page,
      pageSize: 100,
      total: detail.requests.total,
      totalPages: detail.requests.totalPages,
    },
  };
}

function toOperationalRequestItem(item: ConstituentRequestItem): ConstituentRequestItem {
  return {
    id: item.id,
    operationType: item.operationType,
    state: item.state,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    inputTokens: item.inputTokens,
    outputTokens: item.outputTokens,
    costUsd: item.costUsd,
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
    missingData: item.missingData,
    unpricedCost: item.unpricedCost,
  };
}
