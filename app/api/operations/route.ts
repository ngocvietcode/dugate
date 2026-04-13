// app/api/operations/route.ts
// Internal: GET /api/operations — List operations for frontend History page

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { extractPipelineProcessors } from '@/lib/pipelines/validate';

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
    select: {
      id: true,
      done: true,
      state: true,
      currentStep: true,
      progressPercent: true,
      progressMessage: true,
      createdAt: true,
      updatedAt: true,
      pipelineJson: true,
    },
  });

  return NextResponse.json({
    operations: operations.map((op) => {
      const pipeline = extractPipelineProcessors(op.pipelineJson);

      return {
        name: `operations/${op.id}`,
        done: op.done,
        metadata: {
          state: op.state,
          pipeline,
          current_step: op.currentStep,
          progress_percent: op.progressPercent,
          progress_message: op.progressMessage,
          create_time: op.createdAt,
          update_time: op.updatedAt,
        },
      };
    }),
  });
}
