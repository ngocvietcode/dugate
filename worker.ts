// worker.ts
// Standalone BullMQ Worker process — runs the Pipeline Engine independently
// from the Next.js application. Started via: node worker.js
//
// In Docker: override CMD with ["node", "worker.js"]
// In dev:    npx tsx worker.ts
//
// Two workers run here:
//   - pipeline worker        — handles top-level pipeline jobs and workflow orchestration
//   - workflow-steps worker  — handles sub-step jobs spawned by workflows
//     (separate queue prevents deadlock when parent holds a pipeline slot)

// Note: env vars are injected by docker-compose in production.
// In development, Next.js loads .env.local automatically, so we must load it here too to avoid path mismatches.
import './env-init';



import v8 from 'v8';
import { Worker, Job } from 'bullmq';
import { createRedisConnection } from './lib/queue/redis';
import { runPipeline } from './lib/pipelines/engine';
import { runWorkflow } from './lib/pipelines/workflow-engine';
import {
  PIPELINE_QUEUE_NAME,
  WORKFLOW_STEPS_QUEUE_NAME,
  type PipelineJobData,
} from './lib/queue/pipeline-queue';

// ─── Config ───────────────────────────────────────────────────────────────────

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
// Sub-step worker gets more slots since each sub-step is a short-lived pipeline job
const subStepConcurrency = parseInt(process.env.SUBSTEP_WORKER_CONCURRENCY || String(concurrency * 2), 10);
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

console.log(`[Worker] Starting BullMQ Workers`);
console.log(`[Worker] pipeline queue: ${PIPELINE_QUEUE_NAME} (concurrency ${concurrency})`);
console.log(`[Worker] workflow-steps queue: ${WORKFLOW_STEPS_QUEUE_NAME} (concurrency ${subStepConcurrency})`);
console.log(`[Worker] Redis: ${redisUrl}`);

// ─── Job processor ────────────────────────────────────────────────────────────

async function processJob(job: Job<PipelineJobData>) {
  const { operationId, correlationId, type } = job.data;
  console.log(`[Worker] Processing job ${job.id} (${job.name}) → operationId=${operationId}`);

  // Use explicit type field; fall back to job name inspection for legacy jobs
  const isWorkflow = type === 'workflow' || job.name.includes('workflows:');
  if (isWorkflow) {
    await runWorkflow(operationId, correlationId, job);
  } else {
    await runPipeline(operationId, correlationId, job);
  }

  console.log(`[Worker] Finished job ${job.id} → operationId=${operationId}`);
}

// ─── Pipeline Worker ──────────────────────────────────────────────────────────

const pipelineWorker = new Worker<PipelineJobData>(
  PIPELINE_QUEUE_NAME,
  processJob,
  {
    connection: createRedisConnection(),
    concurrency,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
);

// ─── Workflow Steps Worker ────────────────────────────────────────────────────

const stepsWorker = new Worker<PipelineJobData>(
  WORKFLOW_STEPS_QUEUE_NAME,
  processJob,
  {
    connection: createRedisConnection(),
    concurrency: subStepConcurrency,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
);

// ─── Event handlers ───────────────────────────────────────────────────────────

function attachEvents(worker: Worker, name: string) {
  worker.on('completed', (job: Job) => {
    console.log(`[Worker:${name}] ✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 3;
    console.error(`[Worker:${name}] ❌ Job ${job?.id} failed (attempt ${attempts}/${maxAttempts}): ${err.message}`);

    // DLQ alert: log structured error after all retries exhausted
    if (attempts >= maxAttempts) {
      console.error(`[Worker:${name}] 🚨 DLQ: Job ${job?.id} exhausted all retries — operationId=${job?.data?.operationId}`, {
        jobId: job?.id,
        jobName: job?.name,
        operationId: job?.data?.operationId,
        error: err.message,
        stack: err.stack,
      });
    }
  });

  worker.on('stalled', (jobId: string) => {
    console.warn(`[Worker:${name}] ⚠️  Job ${jobId} stalled — will be re-queued`);
  });

  worker.on('error', (err: Error) => {
    console.error(`[Worker:${name}] Worker error:`, err.message);
  });
}

attachEvents(pipelineWorker, 'pipeline');
attachEvents(stepsWorker, 'workflow-steps');

// ─── Memory monitoring ────────────────────────────────────────────────────────

const MEMORY_THRESHOLD = parseFloat(process.env.WORKER_MEMORY_THRESHOLD || '0.90');
let paused = false;

setInterval(() => {
  const { heapUsed } = process.memoryUsage();
  const heapLimit = v8.getHeapStatistics().heap_size_limit;
  const ratio = heapUsed / heapLimit;
  if (ratio > MEMORY_THRESHOLD && !paused) {
    console.warn(`[Worker] ⚠️  Heap at ${(ratio * 100).toFixed(1)}% — pausing workers to allow GC`);
    pipelineWorker.pause();
    stepsWorker.pause();
    paused = true;
  } else if (ratio <= MEMORY_THRESHOLD * 0.85 && paused) {
    console.log(`[Worker] ✅ Heap recovered to ${(ratio * 100).toFixed(1)}% — resuming workers`);
    pipelineWorker.resume();
    stepsWorker.resume();
    paused = false;
  }
}, 10_000);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  console.log(`[Worker] ${signal} received — closing workers gracefully...`);
  await Promise.all([pipelineWorker.close(), stepsWorker.close()]);
  console.log(`[Worker] Shutdown complete.`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
