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
import {
  SUBSTEP_WORKER_CONCURRENCY,
  WORKER_CONCURRENCY,
  WORKFLOW_CONCURRENCY,
  WORKER_MEMORY_THRESHOLD,
} from './lib/config';
import { Logger } from './lib/logger';
import { ensureQueueCleanupScheduled, stopQueueCleanupScheduled } from './lib/queue-cleanup-scheduler';
import { createRedisConnection } from './lib/queue/redis';
import { runPipeline } from './lib/pipelines/engine';
import { runWorkflow } from './lib/pipelines/workflow-engine';
import { type PipelineJobData } from './lib/queue/pipeline-queue';
import { validateWorkerQueueEnv } from './lib/queue/worker-group-validation';
import { validateSegmentPackRegistry } from './lib/pipelines/workflows/loan-appraisal/segment-packs/registry';
import { markDlqOperationFailed } from './lib/worker-dlq';

export { markDlqOperationFailed } from './lib/worker-dlq';

// ─── System logger ────────────────────────────────────────────────────────────
// Everything logged in this file is operational METADATA — queue name, job id,
// operationId, heap %, shutdown signals — never business content (plan §1.4).
// So it is classified as full CONTENT via `.raw()`, which keeps startup banners
// and stack traces intact and untruncated.
//
// `.raw()` does NOT relax SECRET redaction: the Redis URL password and any
// credential reflected in `err.stack` still go through the SECRET layer. There is
// also no `job` attached here, so nothing from this file reaches Redis `:logs`.
const log = new Logger({ service: 'worker' }).raw();

// ─── Queue Resolution ─────────────────────────────────────────────────────────

const workerQueueResult = validateWorkerQueueEnv(process.env.WORKER_QUEUE);

if (!workerQueueResult.valid) {
  log.error(`[Worker] ❌ ${workerQueueResult.error}`);
  process.exit(1);
}

const PIPELINE_QUEUE = workerQueueResult.pipelineQueue;
const STEPS_QUEUE = workerQueueResult.stepsQueue;
const WORKFLOW_QUEUE = workerQueueResult.workflowQueue;

// Sản phẩm vay nào trong loan_products.json cũng phải có segment pack (D-100): lỗi cấu hình dừng worker ngay
// thay vì để từng hồ sơ của sản phẩm đó FAILED lúc chạy.
const segmentPackErrors = validateSegmentPackRegistry();
if (segmentPackErrors.length > 0) {
  log.error(`[Worker] ❌ Segment pack registry: ${segmentPackErrors.join(' | ')}`);
  process.exit(1);
}

// ─── Config ───────────────────────────────────────────────────────────────────

// Read from lib/config.ts rather than process.env directly: the constants were
// already defined there but every consumer re-parsed the env, which made
// lib/config.ts a half-dead abstraction (03-AMENDMENTS-QUEUE-PLAN §11 / B6).
// Values and fallbacks are identical — SUBSTEP_WORKER_CONCURRENCY already defaults
// to WORKER_CONCURRENCY * 2 in config.ts.
const concurrency = WORKER_CONCURRENCY;
// Sub-step worker gets more slots since each sub-step is a short-lived pipeline job
const subStepConcurrency = SUBSTEP_WORKER_CONCURRENCY;
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

log.info(`[Worker] Starting BullMQ Workers`);
log.info(`[Worker] pipeline queue: ${PIPELINE_QUEUE} (concurrency ${concurrency})`);
log.info(`[Worker] workflow-steps queue: ${STEPS_QUEUE} (concurrency ${subStepConcurrency})`);
log.info(`[Worker] workflow queue: ${WORKFLOW_QUEUE} (concurrency ${WORKFLOW_CONCURRENCY})`);
// Log-only copy: mask any credentials embedded in the Redis URL.
// Do NOT reassign `redisUrl` — the real connection is made by createRedisConnection(),
// which reads process.env.REDIS_URL itself (lib/queue/redis.ts).
//
// `[^/?#]*` is greedy but cannot leave the authority section, so it collapses
// everything up to the LAST '@' before the path/query. That matters for passwords
// containing a literal '@' (`redis://user:p@ssw0rd@host` → `redis://***@host`);
// a plain `[^@]*@` would stop at the first '@' and leak the rest of the password.
// Confining it to the authority also means a URL with no credentials is left
// byte-for-byte intact, even if a '@' appears later in a query string.
//
// Kept even though Logger's SECRET layer now applies the same URL-credential
// masking (lib/log-sanitize.ts URL_CREDENTIALS_PATTERN): defence in depth, and it
// still protects this value if it is ever passed somewhere other than the Logger.
const safeRedisUrl = redisUrl.replace(/^(rediss?:\/\/)[^/?#]*@/i, '$1***@');
log.info(`[Worker] Redis: ${safeRedisUrl}`);

// ─── Job processor ────────────────────────────────────────────────────────────

async function processJob(job: Job<PipelineJobData>) {
  const { operationId, correlationId, type, profileName } = job.data;
  const profileStr = profileName ? ` [Profile: ${profileName}]` : '';
  log.info(`[Worker] Processing job ${job.id} (${job.name})${profileStr} → operationId=${operationId}`);

  // Use explicit type field; fall back to job name inspection for legacy jobs
  const isWorkflow = type === 'workflow' || job.name.includes('workflows:');
  if (isWorkflow) {
    await runWorkflow(operationId, correlationId, job);
  } else {
    await runPipeline(operationId, correlationId, job);
  }

  log.info(`[Worker] Finished job ${job.id} → operationId=${operationId}`);
}

// ─── Pipeline Worker ──────────────────────────────────────────────────────────

const pipelineWorker = new Worker<PipelineJobData>(
  PIPELINE_QUEUE,
  processJob,
  {
    connection: createRedisConnection(),
    concurrency,
    stalledInterval: 30_000,
    maxStalledCount: 2,
    // NOTE: `keepLogs` is NOT a WorkerOptions field in BullMQ 5.x. Job.log() reads
    // `job.opts.keepLogs`, so the log cap is set in the queues' defaultJobOptions
    // via getQueueRetentionOptions() (lib/config.ts). See 01-HOTFIX-LOG-LEAK.md §4 T5.
  },
);

// ─── Workflow Steps Worker ────────────────────────────────────────────────────

const stepsWorker = new Worker<PipelineJobData>(
  STEPS_QUEUE,
  processJob,
  {
    connection: createRedisConnection(),
    concurrency: subStepConcurrency,
    stalledInterval: 30_000,
    maxStalledCount: 2,
    // See the note on pipelineWorker above — keepLogs lives in job options.
  },
);

// ─── Workflow Worker ──────────────────────────────────────────────────────────
// Job workflow (cha) phần lớn thời gian chỉ chờ sub-step trên STEPS_QUEUE, nên có slot riêng để hồ sơ lớn không chiếm
// slot của job pipeline (docs/WORKFLOW-SUSPEND-DESIGN.md phương án A). Trần thật là bộ nhớ: bộ giám sát heap bên dưới
// dừng cả worker này.

const workflowWorker = new Worker<PipelineJobData>(
  WORKFLOW_QUEUE,
  processJob,
  {
    connection: createRedisConnection(),
    concurrency: WORKFLOW_CONCURRENCY,
    stalledInterval: 30_000,
    maxStalledCount: 2,
    // See the note on pipelineWorker above — keepLogs lives in job options.
  },
);

// ─── Event handlers ───────────────────────────────────────────────────────────

function attachEvents(worker: Worker, name: string) {
  worker.on('completed', (job: Job) => {
    log.info(`[Worker:${name}] ✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 3;
    log.error(`[Worker:${name}] ❌ Job ${job?.id} failed (attempt ${attempts}/${maxAttempts}): ${err.message}`);

    // DLQ alert: log structured error after all retries exhausted
    if (attempts >= maxAttempts) {
      log.error(
        `[Worker:${name}] 🚨 DLQ: Job ${job?.id} exhausted all retries — operationId=${job?.data?.operationId}`,
        {
          jobId: job?.id,
          jobName: job?.name,
          operationId: job?.data?.operationId,
        },
        err,
      );
      void markDlqOperationFailed(job?.data?.operationId, err.message).catch((persistenceError) => {
        log.error(
          `[Worker:${name}] Failed to persist DLQ state for operationId=${job?.data?.operationId}`,
          undefined,
          persistenceError,
        );
      });
    }
  });

  worker.on('stalled', (jobId: string) => {
    log.warn(`[Worker:${name}] ⚠️  Job ${jobId} stalled — will be re-queued`);
  });

  worker.on('error', (err: Error) => {
    log.error(`[Worker:${name}] Worker error: ${err.message}`, undefined, err);
  });
}

attachEvents(pipelineWorker, 'pipeline');
attachEvents(stepsWorker, 'workflow-steps');
attachEvents(workflowWorker, 'workflow');

// ─── Memory monitoring ────────────────────────────────────────────────────────

const MEMORY_THRESHOLD = WORKER_MEMORY_THRESHOLD;
let paused = false;

setInterval(() => {
  const { heapUsed } = process.memoryUsage();
  const heapLimit = v8.getHeapStatistics().heap_size_limit;
  const ratio = heapUsed / heapLimit;
  if (ratio > MEMORY_THRESHOLD && !paused) {
    log.warn(`[Worker] ⚠️  Heap at ${(ratio * 100).toFixed(1)}% — pausing workers to allow GC`);
    pipelineWorker.pause();
    stepsWorker.pause();
    workflowWorker.pause();
    paused = true;
  } else if (ratio <= MEMORY_THRESHOLD * 0.85 && paused) {
    log.info(`[Worker] ✅ Heap recovered to ${(ratio * 100).toFixed(1)}% — resuming workers`);
    pipelineWorker.resume();
    stepsWorker.resume();
    workflowWorker.resume();
    paused = false;
  }
}, 10_000);

// ─── Queue backlog cleanup scheduler ──────────────────────────────────────────
// Registered here at MODULE SCOPE, not in app/layout.tsx. layout.tsx calls its
// schedulers from inside the RootLayout function body, so they only start once a page
// is server-rendered — and DUGate is an API gateway whose traffic never goes through
// RootLayout. See lib/queue-cleanup-scheduler.ts and 03-AMENDMENTS-QUEUE-PLAN §5 (A4).
//
// Several worker replicas will each arm a scheduler; the Redis lock inside
// cleanExpiredJobs() ensures only one actually scans.
//
// The child logger inherits this file's `.raw()` system-log classification and
// carries NO job — nothing it writes can land in a job's Redis `:logs` list.
ensureQueueCleanupScheduled(log.child({ service: 'queue-cleanup' }));

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  log.info(`[Worker] ${signal} received — closing workers gracefully...`);
  stopQueueCleanupScheduled();
  await Promise.all([pipelineWorker.close(), stepsWorker.close(), workflowWorker.close()]);
  log.info(`[Worker] Shutdown complete.`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
