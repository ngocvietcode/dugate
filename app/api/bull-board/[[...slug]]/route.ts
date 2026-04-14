// app/api/bull-board/[[...slug]]/route.ts
// BullMQ Dashboard — Admin only (NextAuth session guard).
// Access at: /api/bull-board
//
// Uses @bull-board/hono adapter to seamlessly integrate with Next.js App Router Web Standard Request/Response.

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { HonoAdapter } from '@bull-board/hono';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/rbac';
import { getPipelineQueue } from '@/lib/queue/pipeline-queue';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

// Prevent Next.js from statically pre-rendering this route at build time
export const dynamic = 'force-dynamic';

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
let isInitialized = false;
const serverAdapter = new HonoAdapter(serveStatic);
serverAdapter.setBasePath('/api/bull-board');

function initBoard() {
  if (!isInitialized) {
    createBullBoard({
      queues: [new BullMQAdapter(getPipelineQueue())],
      serverAdapter,
    });
    // Mount bull board onto hono at the specific path
    app.route('/api/bull-board', serverAdapter.registerPlugin());
    isInitialized = true;
  }
}

const handler = (req: Request) => {
  initBoard();
  return app.fetch(req);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
