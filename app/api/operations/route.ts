// app/api/operations/route.ts
// Internal: GET /api/operations — List operations for frontend History page

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { formatOperationResponse } from '@/lib/pipelines/format';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const pageSize = Math.min(parseInt(params.get('page_size') ?? '50'), 100);
  const filter = params.get('filter');

  const where: Record<string, unknown> = { deletedAt: null };
  if (session.user.role !== 'ADMIN') {
    where.createdByUserId = session.user.id;
  }

  if (filter) {
    const parts = filter.split(',');
    for (const part of parts) {
      const [key, val] = part.trim().split('=');
      if (key === 'state') where.state = val;
    }
  }

  const operations = await prisma.operation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: pageSize,
  });

  return NextResponse.json({
    operations: operations.map(formatOperationResponse),
  });
}
