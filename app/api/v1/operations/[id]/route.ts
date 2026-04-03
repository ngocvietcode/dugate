// app/api/v1/operations/[id]/route.ts
// GET /api/v1/operations/{id} — Status + Result
// DELETE /api/v1/operations/{id} — Soft delete

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { formatOperationResponse } from '@/lib/pipelines/format';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  console.log(`[API_OPERATIONS] GET /operations/${id} called`);
  const op = await prisma.operation.findUnique({ where: { id } });

  if (!op || op.deletedAt) {
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/not-found', title: 'Operation Not Found', status: 404, detail: `Operation '${id}' not found.`, requested_id: id },
      { status: 404 }
    );
  }

  return NextResponse.json(formatOperationResponse(op));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const op = await prisma.operation.findUnique({ where: { id } });

  if (!op || op.deletedAt) {
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/not-found', title: 'Not Found', status: 404 },
      { status: 404 }
    );
  }

  await prisma.operation.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return new NextResponse(null, { status: 204 });
}
