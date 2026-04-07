// app/api/v1/operations/[id]/cancel/route.ts
// POST /api/v1/operations/{id}/cancel

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { formatOperationResponse } from '@/lib/pipelines/format';

export async function POST(
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

  const updated = await prisma.operation.update({
    where: { id },
    data: { done: true, state: 'CANCELLED', progressMessage: null },
  });

  return NextResponse.json(formatOperationResponse(updated));
}
