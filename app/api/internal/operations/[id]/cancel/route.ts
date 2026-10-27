// app/api/internal/operations/[id]/cancel/route.ts
// POST /api/internal/operations/{id}/cancel — Cancel operation with session-based auth + RBAC
// Implements cancel logic directly (same as v1 cancel) to avoid auth header issues.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { transitionOperationState } from '@/lib/operations/state-transition';
import { auditOperationAction } from '@/lib/audit/operation-audit';
import { isHiddenFromOperations } from '@/lib/operations/operational-metadata';
import { eq } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCapability('operations:cancel');
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  // 3. Fetch operation
  const [op] = await db
    .select()
    .from(operations)
    .where(eq(operations.id, id))
    .limit(1);

  // Hidden workflow sub-steps are not independently cancellable: cancelling one
  // would leave its parent workflow running on an empty step result.
  if (!op || isHiddenFromOperations(op)) {
    return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
  }

  // Cancellation is more restrictive than reading: an assigned-only operator
  // cannot cancel an unscoped operation.
  const profileIds = await getAssignedProfileIds('operations:cancel');
  if (profileIds !== null && (!op.apiKeyId || !profileIds.includes(op.apiKeyId))) {
    return NextResponse.json(
      { error: 'Forbidden — Profile not assigned to this user' },
      { status: 403 },
    );
  }

  // 5. Check if already done → 409
  if (op.done) {
    return NextResponse.json(
      { error: 'Operation đã hoàn thành, không thể hủy' },
      { status: 409 },
    );
  }

  // 6. Cancel and refresh the Business Operation snapshot atomically.
  await transitionOperationState({
    operationId: id,
    state: 'CANCELLED',
    changes: { progressMessage: null },
  });

  await auditOperationAction({
    action: 'CANCEL',
    req,
    session: guard.session,
    operationId: id,
    entityName: op.endpointSlug ?? undefined,
    detail: { previousState: op.state, apiKeyId: op.apiKeyId },
  });

  return NextResponse.json({ success: true });
}
