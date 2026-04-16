// app/api/v1/operations/[id]/resume/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations, profileEndpoints } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getPipelineQueue } from '@/lib/queue/pipeline-queue';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'resume-operation' });

function resolveBullPriority(jobPriority?: string | null): number {
  switch (jobPriority) {
    case 'HIGH':   return 1;
    case 'LOW':    return 20;
    default:       return 10; // MEDIUM or undefined
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const operationId = params.id;
    const body = await req.json();

    const [operation] = await db.select().from(operations).where(eq(operations.id, operationId)).limit(1);

    if (!operation) {
      return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
    }

    if (operation.state !== 'WAITING_USER_INPUT') {
      return NextResponse.json({ error: `Operation is in state ${operation.state}, cannot resume. Must be WAITING_USER_INPUT.` }, { status: 400 });
    }

    // Update stepsResult if human edit data is provided.
    // Note: Check body.step !== undefined (not just `body.step`) to handle step index 0 correctly.
    let stepsResult = operation.stepsResultJson ? JSON.parse(operation.stepsResultJson) : [];
    if (body.step !== undefined && body.step !== null && 'extracted_data' in body) {
      // Find the specific step to update
      const stepIndex = stepsResult.findIndex((s: any) => s.step === body.step);
      if (stepIndex >= 0) {
        stepsResult[stepIndex].extracted_data = body.extracted_data;
        // Optionally mark that it was human-edited
        stepsResult[stepIndex].is_human_edited = true;
      }
    }

    // Determine Queue Priority
    let bullPriority = 10;
    if (operation.apiKeyId && operation.endpointSlug) {
      const [profileEndpoint] = await db.select({ jobPriority: profileEndpoints.jobPriority }).from(profileEndpoints).where(
        and(eq(profileEndpoints.apiKeyId, operation.apiKeyId), eq(profileEndpoints.endpointSlug, operation.endpointSlug))
      ).limit(1);
      // @ts-ignore
      bullPriority = resolveBullPriority(profileEndpoint?.jobPriority);
    }

    // Set state back to RUNNING and update
    await db.update(operations).set({
      state: 'RUNNING',
      progressMessage: 'Đang tiếp tục luồng xử lý do người dùng xác nhận...',
      stepsResultJson: JSON.stringify(stepsResult)
    }).where(eq(operations.id, operationId));

    // Enqueue back to the worker
    const queue = getPipelineQueue();
    const jobName = `pipeline:${operation.endpointSlug ?? 'unknown'}`;
    const correlationId = crypto.randomUUID();
    
    await queue.add(jobName, { operationId, correlationId }, { priority: bullPriority });
    logger.info(`Resumed operation ${operationId} and enqueued to BullMQ.`);

    return NextResponse.json({ success: true, message: 'Resumed successfully' });
  } catch (err: any) {
    logger.error(`Failed to resume operation`, undefined, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
