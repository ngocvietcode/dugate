// app/api/v1/operations/[id]/cancel/route.ts
// POST /api/v1/operations/{id}/cancel

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { transitionOperationState } from '@/lib/operations/state-transition';
import { formatOperationResponse } from '@/lib/pipelines/format';
import { BASE_TYPE_URI } from '@/lib/errors';
import { resolveCallerIdentity } from '@/lib/auth-resolve-key';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [op] = await db.select().from(operations).where(eq(operations.id, id)).limit(1);

    if (!op || op.deletedAt) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/not-found`, title: 'Not Found', status: 404 },
        { status: 404 }
      );
    }

    const { apiKeyId, userId, userRole } = await resolveCallerIdentity(req);

    if (!apiKeyId && !userId) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/unauthorized`, title: 'Unauthorized', status: 401, detail: 'Authentication required.' },
        { status: 401 }
      );
    }

    if (apiKeyId && op.apiKeyId !== apiKeyId) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/forbidden`, title: 'Forbidden', status: 403, detail: `Access denied.` },
        { status: 403 }
      );
    }

    if (!apiKeyId && userId && userRole !== 'ADMIN' && op.createdByUserId !== userId) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/forbidden`, title: 'Forbidden', status: 403, detail: `Access denied.` },
        { status: 403 }
      );
    }

    if (op.done) {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/already-done`, title: 'Already Completed', status: 409, detail: 'Cannot cancel a completed operation.' },
        { status: 409 }
      );
    }

    const updated = await transitionOperationState({
      operationId: id,
      state: 'CANCELLED',
      changes: { progressMessage: null },
      // Atomic guard: a run that completed in the meantime must not flip to CANCELLED.
      onlyIf: { done: false },
    });

    if (updated.state !== 'CANCELLED') {
      return NextResponse.json(
        { type: `${BASE_TYPE_URI}/already-done`, title: 'Already Completed', status: 409, detail: 'Cannot cancel a completed operation.' },
        { status: 409 }
      );
    }

    return NextResponse.json(formatOperationResponse(updated));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { type: `${BASE_TYPE_URI}/internal`, title: 'Internal Server Error', status: 500, detail: msg },
      { status: 500 }
    );
  }
}
