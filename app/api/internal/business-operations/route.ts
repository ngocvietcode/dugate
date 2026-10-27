import { NextRequest, NextResponse } from 'next/server';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import {
  apiProblemResponse,
  authGuardProblemResponse,
  getOrCreateApiRequestId,
  parseAuthorizedBusinessOperationsDashboardQuery,
  toApiProblem,
} from '@/lib/operations/api-contract';
import {
  getBusinessOperationsDashboardSnapshot,
  type BusinessQueryAuthorizationContext,
} from '@/lib/operations/business-query';
import {
  profileScopeCount,
  recordBusinessOperationsRoute,
} from '@/lib/operations/telemetry';
import {
  getBusinessOperationsRolloutConfig,
  shouldRunBusinessOperationsShadowRead,
} from '@/lib/operations/rollout';

export const dynamic = 'force-dynamic';

/**
 * Return one atomic Business Operations dashboard snapshot. Authorization is
 * resolved for every request and passed into the query service so profile and
 * internal-scope filtering happens before grouping, searching, or aggregation.
 */
export async function GET(request: NextRequest) {
  const requestId = getOrCreateApiRequestId(request.headers.get('x-request-id'));
  const startedAt = Date.now();
  let preset: string | undefined;
  let actorId: string | undefined;
  let actorRole: string | undefined;
  let scopeCount: number | 'all' | undefined;

  try {
    const guard = await requireCapability('operations:read');
    if (guard instanceof NextResponse) {
      const code = guard.status === 401 ? 'UNAUTHORIZED' : 'OPERATIONS_FORBIDDEN';
      recordBusinessOperationsRoute({
        kind: 'dashboard',
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
      // Preserve the current Operations policy: assigned-profile users can
      // also read unscoped/internal operations; global users can read both.
      canReadInternalScope: true,
    };
    const input = parseAuthorizedBusinessOperationsDashboardQuery(
      request.nextUrl.searchParams,
      authorization,
    );
    preset = input.range;
    const rollout = await getBusinessOperationsRolloutConfig();
    const shadowRead = shouldRunBusinessOperationsShadowRead(
      rollout,
      `${requestId}:${request.nextUrl.searchParams.toString()}`,
    );
    const snapshot = await getBusinessOperationsDashboardSnapshot(
      input,
      authorization,
      { shadowRead },
    );

    recordBusinessOperationsRoute({
      kind: 'dashboard',
      requestId,
      actorId,
      actorRole,
      profileScopeCount: scopeCount,
      preset: input.range,
      timezone: snapshot.calendarTimezone,
      durationMs: Date.now() - startedAt,
      page: snapshot.list.page,
      resultCount: snapshot.list.total,
      outcome: 'success',
    });
    return NextResponse.json(snapshot, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    });
  } catch (error: unknown) {
    const problem = toApiProblem(error, requestId);
    recordBusinessOperationsRoute({
      kind: 'dashboard',
      requestId,
      actorId,
      actorRole,
      profileScopeCount: scopeCount,
      preset,
      durationMs: Date.now() - startedAt,
      outcome: problem.body.error.code === 'DASHBOARD_TIMEOUT' ? 'timeout' : 'failure',
      failureCode: problem.body.error.code,
      retryable: problem.body.error.retryable,
    });
    return apiProblemResponse(error, requestId);
  }
}
