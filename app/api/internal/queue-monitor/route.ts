// app/api/internal/queue-monitor/route.ts
// GET — Get job counts for all queues (default + worker group queues)

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workerGroups } from '@/lib/db/schema';
import { getOrCreateQueue } from '@/lib/queue/worker-group-router';
import { OWNED_QUEUE_BASES, type QueueBase } from '@/lib/queue/pipeline-queue';
import { requireCapability } from '@/lib/auth-guard';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'queue-monitor' });

interface QueueStats {
  name: string;
  type: QueueBase;
  group: string | null; // null = default queue
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

export async function GET() {
  const guard = await requireCapability('queue:view');
  if (guard instanceof NextResponse) return guard;

  try {
    // Get all worker groups from DB
    const groups = await db
      .select({ name: workerGroups.name })
      .from(workerGroups)
      .orderBy(workerGroups.name);

    // Build list of all queues to query
    const queueDefs: Array<{ name: string; type: QueueBase; group: string | null }> =
      OWNED_QUEUE_BASES.map((base) => ({ name: base, type: base, group: null }));

    for (const g of groups) {
      for (const base of OWNED_QUEUE_BASES) queueDefs.push({ name: `${base}.${g.name}`, type: base, group: g.name });
    }

    // Query Redis for job counts
    const stats: QueueStats[] = [];

    for (const def of queueDefs) {
      try {
        const queue = getOrCreateQueue(def.name);
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        stats.push({
          name: def.name,
          type: def.type,
          group: def.group,
          counts: {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
          },
        });
      } catch (queueErr: unknown) {
        // If Redis is down for a specific queue, include error state
        logger.warn(`[queue-monitor] Failed to get counts for queue "${def.name}"`, { error: String(queueErr) });
        stats.push({
          name: def.name,
          type: def.type,
          group: def.group,
          counts: { waiting: -1, active: -1, completed: -1, failed: -1, delayed: -1 },
        });
      }
    }

    return NextResponse.json({ queues: stats });
  } catch (error: unknown) {
    // If Redis is completely unavailable
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('connect')) {
      return NextResponse.json({
        error: 'Redis connection unavailable. Cannot retrieve queue statistics.',
      }, { status: 503 });
    }

    logger.error('[GET] Failed to get queue stats', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
