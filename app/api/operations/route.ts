// app/api/operations/route.ts
// Internal: GET /api/operations — List operations for frontend History page

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq, isNull, and, desc, sql, SQL } from 'drizzle-orm';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { extractPipelineProcessors } from '@/lib/pipelines/validate';
import { visibleInOperationsCondition } from '@/lib/operations/operational-metadata';

export async function GET(req: NextRequest) {
  const guard = await requireCapability('operations:read');
  if (guard instanceof NextResponse) return guard;

  const params = req.nextUrl.searchParams;
  const pageSize = Math.min(parseInt(params.get('page_size') ?? '50'), 100);
  const filter = params.get('filter');

  const conditions: SQL[] = [visibleInOperationsCondition()];
  const profileIds = await getAssignedProfileIds('operations:read');
  if (profileIds !== null) {
    if (profileIds.length === 0) {
      conditions.push(isNull(operations.apiKeyId));
    } else {
      conditions.push(
        sql`(${operations.apiKeyId} IN (${sql.join(profileIds.map((id) => sql`${id}`), sql`, `)}) OR ${operations.apiKeyId} IS NULL)`,
      );
    }
  }

  if (filter) {
    const parts = filter.split(',');
    for (const part of parts) {
      const [key, val] = part.trim().split('=');
      if (key === 'state') conditions.push(eq(operations.state, val));
    }
  }

  const opsList = await db.select({
      id: operations.id,
      done: operations.done,
      state: operations.state,
      currentStep: operations.currentStep,
      progressPercent: operations.progressPercent,
      progressMessage: operations.progressMessage,
      createdAt: operations.createdAt,
      updatedAt: operations.updatedAt,
      pipelineJson: operations.pipelineJson,
  }).from(operations)
    .where(and(...conditions))
    .orderBy(desc(operations.createdAt))
    .limit(pageSize);

  return NextResponse.json({
    operations: opsList.map((op) => {
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
