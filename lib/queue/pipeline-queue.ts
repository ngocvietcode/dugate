// lib/queue/pipeline-queue.ts
// BullMQ Queue + QueueEvents singletons.
//
// Two queues:
//   - "pipeline"        — main pipeline jobs + top-level workflow jobs
//   - "workflow-steps"  — sub-steps spawned by workflow jobs
//
// Keeping them separate prevents the deadlock where a workflow job holds a
// pipeline worker slot while waiting for sub-steps that can never start because
// all slots are occupied.

import { Queue, QueueEvents } from 'bullmq';
import { createRedisConnection } from './redis';

export const PIPELINE_QUEUE_NAME = 'pipeline';
export const WORKFLOW_STEPS_QUEUE_NAME = 'workflow-steps';

/** Default timeout for executeSync mode (ms). Override via SYNC_TIMEOUT_MS env var. */
export const SYNC_TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT_MS || '30000', 10);

// ─── Pipeline Queue (main jobs) ───────────────────────────────────────────────

let queueInstance: Queue | null = null;

export function getPipelineQueue(): Queue {
  if (!queueInstance) {
    queueInstance = new Queue(PIPELINE_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 },  // Keep completed jobs for 1h (debug)
        removeOnFail: false,              // Retain failed jobs for DLQ inspection
      },
    });
  }
  return queueInstance;
}

let queueEventsInstance: QueueEvents | null = null;

export function getPipelineQueueEvents(): QueueEvents {
  if (!queueEventsInstance) {
    queueEventsInstance = new QueueEvents(PIPELINE_QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }
  return queueEventsInstance;
}

// ─── Workflow Steps Queue (sub-step jobs) ─────────────────────────────────────

let workflowStepsQueueInstance: Queue | null = null;

export function getWorkflowStepsQueue(): Queue {
  if (!workflowStepsQueueInstance) {
    workflowStepsQueueInstance = new Queue(WORKFLOW_STEPS_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: false,
      },
    });
  }
  return workflowStepsQueueInstance;
}

let workflowStepsQueueEventsInstance: QueueEvents | null = null;

export function getWorkflowStepsQueueEvents(): QueueEvents {
  if (!workflowStepsQueueEventsInstance) {
    workflowStepsQueueEventsInstance = new QueueEvents(WORKFLOW_STEPS_QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }
  return workflowStepsQueueEventsInstance;
}

// ─── Job Data Type ────────────────────────────────────────────────────────────

export interface PipelineJobData {
  operationId: string;
  correlationId?: string;
  /** Explicit job type — avoids fragile job.name string matching */
  type?: 'pipeline' | 'workflow';
}
