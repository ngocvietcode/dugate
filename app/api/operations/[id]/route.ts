// app/api/operations/[id]/route.ts
// Internal: GET /api/operations/{id} — Operation detail for frontend

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { formatOperationResponse } from '@/lib/pipelines/format';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canMutate } from '@/lib/rbac';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const [op] = await db.select().from(operations).where(eq(operations.id, id)).limit(1);

  if (!op || op.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (session.user.role !== 'ADMIN' && op.createdByUserId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }



  return NextResponse.json(formatOperationResponse(op));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const [op] = await db.select().from(operations).where(eq(operations.id, id)).limit(1);
  
  if (!op || op.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!canMutate(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden: read-only access' }, { status: 403 });
  }

  if (session.user.role !== 'ADMIN' && op.createdByUserId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.update(operations).set({ deletedAt: new Date() }).where(eq(operations.id, id));
  return new NextResponse(null, { status: 204 });
}
