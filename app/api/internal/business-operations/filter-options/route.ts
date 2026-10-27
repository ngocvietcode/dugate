import { NextRequest, NextResponse } from 'next/server';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import {
  apiProblemResponse,
  authGuardProblemResponse,
  getOrCreateApiRequestId,
  toApiProblem,
} from '@/lib/operations/api-contract';
import {
  getBusinessOperationFilterOptions,
  type BusinessQueryAuthorizationContext,
} from '@/lib/operations/business-query';
import {
  profileScopeCount,
  recordBusinessOperationsRoute,
} from '@/lib/operations/telemetry';

export const dynamic = 'force-dynamic';

/** Return only current, authorized Profile and operation-type filter metadata. */
export async function GET(request: NextRequest) {
  const requestId = getOrCreateApiRequestId(request.headers.get('x-request-id'));
  const startedAt = Date.now();
  let actorId: string | undefined;
  let actorRole: string | undefined;
  let scopeCount: number | 'all' | undefined;

  try {
    const guard = await requireCapability('operations:read');
    if (guard instanceof NextResponse) {
      const code = guard.status === 401 ? 'UNAUTHORIZED' : 'OPERATIONS_FORBIDDEN';
      recordBusinessOperationsRoute({
        kind: 'filter_options',
        requestId,
        durationMs: Date.now() - startedAt,
        outcome: 'failure',
        failureCode: code,
        retryable: false,
      });
      return authGuardProblemResponse(guard.status as 401 | 403, requestId);
    }

    actorId = guard.session.user.id;
    actorRole = guard.session.user.role;
    const allowedProfileIds = await getAssignedProfileIds('operations:read');
    scopeCount = profileScopeCount(allowedProfileIds);
    const authorization: BusinessQueryAuthorizationContext = {
      actorId,
      actorRole,
      requestId,
      canReadOperations: true,
      allowedProfileIds,
      // Internal operations remain visible under the existing Operations read
      // policy; the query service still applies eligibility and row scoping.
      canReadInternalScope: true,
    };
    const options = await getBusinessOperationFilterOptions(authorization);

    recordBusinessOperationsRoute({
      kind: 'filter_options',
      requestId,
      actorId,
      actorRole,
      profileScopeCount: scopeCount,
      durationMs: Date.now() - startedAt,
      resultCount: options.profiles.length + options.operationTypes.length,
      outcome: 'success',
    });
    return NextResponse.json(options, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    });
  } catch (error: unknown) {
    const problem = toApiProblem(error, requestId);
    recordBusinessOperationsRoute({
      kind: 'filter_options',
      requestId,
      actorId,
      actorRole,
      profileScopeCount: scopeCount,
      durationMs: Date.now() - startedAt,
      outcome: problem.body.error.code === 'DASHBOARD_TIMEOUT' ? 'timeout' : 'failure',
      failureCode: problem.body.error.code,
      retryable: problem.body.error.retryable,
    });
    return apiProblemResponse(error, requestId);
  }
}
