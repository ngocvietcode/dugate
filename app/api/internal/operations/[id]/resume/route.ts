// app/api/internal/operations/[id]/resume/route.ts
// POST /api/internal/operations/{id}/resume — Resume operation with session-based auth + RBAC
// Implements resume logic directly (same as v1 resume) to avoid auth header issues.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations, profileEndpoints } from '@/lib/db/schema';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { eq, and } from 'drizzle-orm';
import { getPipelineQueue } from '@/lib/queue/pipeline-queue';
import { transitionOperationState } from '@/lib/operations/state-transition';
import { auditOperationAction } from '@/lib/audit/operation-audit';
import { isHiddenFromOperations } from '@/lib/operations/operational-metadata';

function resolveBullPriority(jobPriority?: string | null): number {
  switch (jobPriority) {
    case 'HIGH':   return 1;
    case 'LOW':    return 20;
    default:       return 10; // MEDIUM or undefined
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const guard = await requireCapability('operations:resume');
    if (guard instanceof NextResponse) return guard;

    const { id } = await params;
    const body = await req.json();

    // 3. Fetch operation
    const [op] = await db
      .select()
      .from(operations)
      .where(eq(operations.id, id))
      .limit(1);

    if (!op || isHiddenFromOperations(op)) {
      return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
    }

    // Resume is more restrictive than reading: an assigned-only operator
    // cannot resume an unscoped operation.
    const profileIds = await getAssignedProfileIds('operations:resume');
    if (profileIds !== null && (!op.apiKeyId || !profileIds.includes(op.apiKeyId))) {
      return NextResponse.json(
        { error: 'Forbidden — Profile not assigned to this user' },
        { status: 403 },
      );
    }

    // 5. Check state is WAITING_USER_INPUT
    if (op.state !== 'WAITING_USER_INPUT') {
      return NextResponse.json(
        { error: `Operation is in state ${op.state}, cannot resume. Must be WAITING_USER_INPUT.` },
        { status: 400 },
      );
    }

    // 6. Update stepsResult if human edit data is provided
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stepsResult: any[] = op.stepsResultJson ? JSON.parse(op.stepsResultJson) : [];
    let humanEditedStep: number | null = null;
    if (body.step !== undefined && body.step !== null && 'extracted_data' in body) {
      const stepIndex = stepsResult.findIndex((s: any) => s.step === body.step);
      if (stepIndex >= 0) {
        stepsResult[stepIndex].extracted_data = body.extracted_data;
        stepsResult[stepIndex].is_human_edited = true;
        humanEditedStep = stepsResult[stepIndex].step;
      }
    }

    // 7. Determine queue priority
    let bullPriority = 10;
    if (op.apiKeyId && op.endpointSlug) {
      const [pe] = await db
        .select({ jobPriority: profileEndpoints.jobPriority })
        .from(profileEndpoints)
        .where(
          and(
            eq(profileEndpoints.apiKeyId, op.apiKeyId),
            eq(profileEndpoints.endpointSlug, op.endpointSlug),
          ),
        )
        .limit(1);
      bullPriority = resolveBullPriority(pe?.jobPriority);
    }

    // 8. Resume and refresh the Business Operation snapshot atomically.
    await transitionOperationState({
      operationId: id,
      state: 'RUNNING',
      changes: {
        progressMessage: 'Đang tiếp tục luồng xử lý do người dùng xác nhận...',
        stepsResultJson: JSON.stringify(stepsResult),
      },
    });

    // 9. Enqueue back to BullMQ worker
    const queue = getPipelineQueue();
    const jobName = `pipeline:${op.endpointSlug ?? 'unknown'}`;
    const correlationId = crypto.randomUUID();

    await queue.add(jobName, { operationId: id, correlationId }, { priority: bullPriority });

    // Accountability for a human decision that can change extracted customer data
    // before it continues to the webhook. Records THAT/WHERE it was edited, never
    // the edited values themselves.
    await auditOperationAction({
      action: 'RESUME',
      req,
      session: guard.session,
      operationId: id,
      entityName: op.endpointSlug ?? undefined,
      detail: {
        humanEdited: humanEditedStep !== null,
        step: humanEditedStep,
        apiKeyId: op.apiKeyId,
      },
    });

    return NextResponse.json({ success: true, message: 'Resumed successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
