// app/api/internal/queue-monitor/[queueName]/jobs/route.ts
// GET — List jobs in a specific queue (paginated, max 50 per page)

import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateQueue } from '@/lib/queue/worker-group-router';
import { isValidWorkerGroupName } from '@/lib/queue/worker-group-validation';
import { OWNED_QUEUE_BASES } from '@/lib/queue/pipeline-queue';
import { requireCapability } from '@/lib/auth-guard';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'queue-monitor-jobs' });

type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
const VALID_STATES: JobState[] = ['waiting', 'active', 'completed', 'failed', 'delayed'];
const MAX_PAGE_SIZE = 50;

export async function GET(
  req: NextRequest,
  { params }: { params: { queueName: string } },
) {
  const guard = await requireCapability('queue:view');
  if (guard instanceof NextResponse) return guard;

  try {
    const { queueName } = params;
    const { searchParams } = new URL(req.url);

    const state = (searchParams.get('state') || 'waiting') as JobState;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));

    if (!VALID_STATES.includes(state)) {
      return NextResponse.json({
        error: `Invalid state. Must be one of: ${VALID_STATES.join(', ')}`,
      }, { status: 400 });
    }

    const decodedQueueName = decodeURIComponent(queueName);

    // Validate queue name format: only allow known queue patterns
    const isAllowed = OWNED_QUEUE_BASES.some((base) =>
      decodedQueueName === base ||
      (decodedQueueName.startsWith(`${base}.`) && isValidWorkerGroupName(decodedQueueName.slice(base.length + 1))));

    if (!isAllowed) {
      return NextResponse.json({
        error: `Invalid queue name. Must be one of ${OWNED_QUEUE_BASES.join(', ')}, optionally suffixed ".{group-name}".`,
      }, { status: 400 });
    }

    const queue = getOrCreateQueue(decodedQueueName);

    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;

    const jobs = await queue.getJobs([state], start, end);

    const jobList = jobs.map((job) => ({
      id: job.id,
      name: job.name,
      state,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      data: {
        operationId: job.data?.operationId,
        profileName: job.data?.profileName,
        type: job.data?.type,
      },
    }));

    return NextResponse.json({
      queue: decodedQueueName,
      state,
      page,
      pageSize,
      jobs: jobList,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('connect')) {
      return NextResponse.json({
        error: 'Redis connection unavailable.',
      }, { status: 503 });
    }

    logger.error('[GET] Failed to list jobs', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
