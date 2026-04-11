// worker.ts
// Standalone BullMQ Worker process — runs the Pipeline Engine independently
// from the Next.js application. Started via: node worker.js
//
// In Docker: override CMD with ["node", "worker.js"]
// In dev:    npx tsx worker.ts

import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { runPipeline } from './lib/pipelines/engine';
import { PIPELINE_QUEUE_NAME, type PipelineJobData } from './lib/queue/pipeline-queue';

// ─── Redis connection ──────────────────────────────────────────────────────────

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// ─── Worker config ────────────────────────────────────────────────────────────

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

console.log(`[Worker] Starting BullMQ Worker`);
console.log(`[Worker] Queue: ${PIPELINE_QUEUE_NAME}`);
console.log(`[Worker] Concurrency: ${concurrency}`);
console.log(`[Worker] Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);

// ─── Worker ───────────────────────────────────────────────────────────────────

const worker = new Worker<PipelineJobData>(
  PIPELINE_QUEUE_NAME,
  async (job: Job<PipelineJobData>) => {
    const { operationId, correlationId } = job.data;
    console.log(`[Worker] Processing job ${job.id} → operationId=${operationId}`);

    await runPipeline(operationId, correlationId, job);

    console.log(`[Worker] Finished job ${job.id} → operationId=${operationId}`);
  },
  {
    connection,
    concurrency,
    // Stalled job detection: if worker crashes mid-job, re-queue after 30s
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
);

// ─── Event handlers ───────────────────────────────────────────────────────────

worker.on('completed', (job: Job) => {
  console.log(`[Worker] ✅ Job ${job.id} completed`);
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[Worker] ❌ Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}): ${err.message}`);
});

worker.on('stalled', (jobId: string) => {
  console.warn(`[Worker] ⚠️  Job ${jobId} stalled — will be re-queued`);
});

worker.on('error', (err: Error) => {
  console.error(`[Worker] Worker error:`, err.message);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  console.log(`[Worker] ${signal} received — closing worker gracefully...`);
  await worker.close();
  await connection.quit();
  console.log(`[Worker] Shutdown complete.`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
