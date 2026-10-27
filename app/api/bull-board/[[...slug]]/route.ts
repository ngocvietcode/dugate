// app/api/bull-board/[[...slug]]/route.ts
// BullMQ Dashboard — Admin only (NextAuth session guard).
// Access at: /api/bull-board
//
// Uses @bull-board/hono adapter to seamlessly integrate with Next.js App Router Web Standard Request/Response.
//
// Registers the default "pipeline" / "workflow-steps" queues PLUS every
// worker-group queue ("pipeline.<group>" / "workflow-steps.<group>"). Jobs
// submitted by external API keys assigned to a worker group are routed to
// these group queues, so they must be registered here to be visible.

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { HonoAdapter } from '@bull-board/hono';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/rbac';
import { getPipelineQueue, getWorkflowStepsQueue, OWNED_QUEUE_BASES, WORKFLOW_QUEUE_NAME } from '@/lib/queue/pipeline-queue';
import { getOrCreateQueue } from '@/lib/queue/worker-group-router';
import { db } from '@/lib/db';
import { workerGroups } from '@/lib/db/schema';
import { Logger } from '@/lib/logger';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { BullMQAdapter as BullMQAdapterType } from '@bull-board/api/bullMQAdapter';

// Prevent Next.js from statically pre-rendering this route at build time
export const dynamic = 'force-dynamic';

const logger = new Logger({ service: 'bull-board' });

const app = new Hono();

// NextAuth guard middleware
app.use('*', async (c, next) => {
  const session = await getServerSession(authOptions);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  if (!isAdmin(session.user.role)) {
    return c.json({ error: 'Forbidden — Admin only' }, 403);
  }
  await next();
});

// Lazy initialize Bull-board only when the endpoint is hit,
// protecting against build-time execution Redis connection errors
const serverAdapter = new HonoAdapter(serveStatic);
serverAdapter.setBasePath('/api/bull-board');

let board: ReturnType<typeof createBullBoard> | null = null;
let routeMounted = false;

/**
 * Build the full set of queue adapters: default queues + every worker-group
 * queue. Queried fresh so newly created worker groups appear without a restart.
 */
async function resolveQueueAdapters(): Promise<BullMQAdapterType[]> {
  const adapters: BullMQAdapterType[] = [
    new BullMQAdapter(getPipelineQueue()),
    new BullMQAdapter(getWorkflowStepsQueue()),
    new BullMQAdapter(getOrCreateQueue(WORKFLOW_QUEUE_NAME)),
  ];

  try {
    const groups = await db.select({ name: workerGroups.name }).from(workerGroups);
    for (const { name } of groups) {
      if (!name) continue;
      for (const base of OWNED_QUEUE_BASES) adapters.push(new BullMQAdapter(getOrCreateQueue(`${base}.${name}`)));
    }
  } catch (err) {
    // DB unavailable → still expose the default queues rather than failing.
    logger.warn('Failed to load worker groups for Bull Board; showing default queues only', {}, err);
  }

  return adapters;
}

async function initOrRefreshBoard() {
  const adapters = await resolveQueueAdapters();

  if (!board) {
    board = createBullBoard({ queues: adapters, serverAdapter });
  } else {
    // Refresh so newly created/removed worker-group queues stay in sync.
    board.replaceQueues(adapters);
  }

  if (!routeMounted) {
    app.route('/api/bull-board', serverAdapter.registerPlugin());
    routeMounted = true;
  }
}

const handler = async (req: Request) => {
  await initOrRefreshBoard();
  return app.fetch(req);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
