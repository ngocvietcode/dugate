// app/api/v1/operations/[id]/cancel/route.ts
// POST /api/v1/operations/{id}/cancel

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { formatOperationResponse } from '@/lib/pipelines/format';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [op] = await db.select().from(operations).where(eq(operations.id, id)).limit(1);

  if (!op || op.deletedAt) {
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/not-found', title: 'Not Found', status: 404 },
      { status: 404 }
    );
  }

  const apiKeyId = req.headers.get('x-api-key-id');
  if (apiKeyId && op.apiKeyId !== apiKeyId) {
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/forbidden', title: 'Forbidden', status: 403, detail: `Access denied.` },
      { status: 403 }
    );
  }

  if (op.done) {
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/already-done', title: 'Already Completed', status: 409, detail: 'Cannot cancel a completed operation.' },
      { status: 409 }
    );
  }

  const [updated] = await db.update(operations).set({ 
    done: true, 
    state: 'CANCELLED', 
    progressMessage: null 
  }).where(eq(operations.id, id)).returning();

  return NextResponse.json(formatOperationResponse(updated));
}
