// app/api/v1/operations/[id]/route.ts
// GET /api/v1/operations/{id} — Status + Result
// DELETE /api/v1/operations/{id} — Soft delete

import { NextRequest, NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { formatOperationResponse } from '@/lib/pipelines/format';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  new Logger({ service: 'operations_api' }).info(`GET /operations/${id} called`);
  const [op] = await db.select().from(operations).where(eq(operations.id, id)).limit(1);

  if (!op || op.deletedAt) {
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/not-found', title: 'Operation Not Found', status: 404, detail: `Operation '${id}' not found.`, requested_id: id },
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

  return NextResponse.json(formatOperationResponse(op));
}

export async function DELETE(
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

  await db.update(operations).set({ deletedAt: new Date() }).where(eq(operations.id, id));

  return new NextResponse(null, { status: 204 });
}
