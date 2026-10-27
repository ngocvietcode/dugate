// app/api/operations/[id]/route.ts
// Legacy Operations endpoint. GET is a status-only view (no in-repo caller);
// DELETE is used by components/ConversionHistory.tsx.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { formatOperationResponse } from '@/lib/pipelines/format';
import { getAssignedProfileIds, requireAdmin, requireCapability } from '@/lib/auth-guard';
import { updateOperationMembership } from '@/lib/operations/state-transition';
import { isHiddenFromOperations } from '@/lib/operations/operational-metadata';

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCapability('operations:read');
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const [operation] = await db.select().from(operations).where(eq(operations.id, id)).limit(1);
  if (!operation || isHiddenFromOperations(operation)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const profileIds = await getAssignedProfileIds('operations:read');
  if (profileIds !== null && operation.apiKeyId && !profileIds.includes(operation.apiKeyId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(toStatusOnlyResponse(formatOperationResponse(operation, { compact: true })));
}

/**
 * This legacy route has no in-repo GET caller (the UI uses
 * /api/internal/operations/[id]; integrators use /api/v1/operations/[id]).
 * It is kept for unknown out-of-repo consumers, but only as a status view:
 * customer content (output, extracted data, per-step previews/artifacts) is
 * removed. `lib/pipelines/format.ts` is deliberately not changed because the
 * customer API (/api/v1) shares it.
 */
const STEP_CONTENT_FIELDS = ['extracted_data', 'content_preview', 'pipeline_state_snapshot'] as const;

function toStatusOnlyResponse(formatted: ReturnType<typeof formatOperationResponse>) {
  const metadata = formatted.metadata as Record<string, unknown>;
  if (Array.isArray(metadata.pipeline_steps)) {
    metadata.pipeline_steps = (metadata.pipeline_steps as Array<Record<string, unknown>>).map((step) => {
      const statusOnly = { ...step };
      for (const field of STEP_CONTENT_FIELDS) delete statusOnly[field];
      return statusOnly;
    });
  }
  delete metadata.progress_details;

  const result = formatted.result as Record<string, unknown> | undefined;
  if (result) {
    delete result.content;
    delete result.extracted_data;
    delete result.pipeline_steps;
  }
  return formatted;
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Soft-deleting an historical record is not an OPS capability. Retain the
  // ADMIN-only boundary until an explicitly audited retention action exists.
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const [operation] = await db.select().from(operations).where(eq(operations.id, id)).limit(1);
  if (!operation || operation.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await updateOperationMembership({
    operationId: id,
    changes: { deletedAt: new Date() },
  });
  return new NextResponse(null, { status: 204 });
}
