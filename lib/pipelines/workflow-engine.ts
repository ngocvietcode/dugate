// lib/pipelines/workflow-engine.ts
// Shared infrastructure for code-driven workflow orchestration.
// Each workflow is a separate file in lib/pipelines/workflows/*.ts
// This file provides: types, helpers (enqueueSubStep, updateProgress), and the router.

import { prisma } from '@/lib/prisma';
import { Logger } from '@/lib/logger';
import {
  getWorkflowStepsQueue,
  getWorkflowStepsQueueEvents,
  type PipelineJobData,
} from '@/lib/queue/pipeline-queue';
import type { Job } from 'bullmq';
import type { Operation } from '@prisma/client';

// Re-export for workflow files
export { prisma, Logger };
export type { Job };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStepResult {
  step: number;
  stepName: string;
  processor: string;
  sub_operation_id?: string;
  content_preview?: unknown;    // Can be string, object, or null
  extracted_data?: unknown;
  sub_results?: unknown[];
}

export interface SubStepResult {
  operation: Operation;
  content: string | null;
  extractedData: unknown;
}

export interface WorkflowContext {
  operationId: string;
  correlationId?: string;
  job?: Job;
  logger: Logger;
  filesJson: string | null;
  filesData: Array<{ name: string; path: string; mime: string; size: number }>;
  pipelineVars: Record<string, unknown>;
  stepsResult: WorkflowStepResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  /** Webhook URL from the parent operation (if any) */
  webhookUrl: string | null;
  /** API key ID of the requesting client (used for prompt override lookup) */
  apiKeyId: string | null;
  /** Per-step prompt overrides loaded from ProfileEndpoint (key = step name, value = prompt text) */
  promptOverrides: Record<string, string>;
  /** Checkpoint: current step index (used for resume) */
  currentStep: number;
}

// ─── Helpers (exported for workflow files) ─────────────────────────────────────

/**
 * Recursively parse all nested JSON strings in a value into native objects.
 * Eliminates the "double-escaped JSON" problem from AI connector responses.
 * Safe to use on strings, objects, and arrays.
 */
export const parseDeep = (val: unknown): unknown => {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return parseDeep(parsed); // Recursive call to unpack multiple layers
      } catch {
        return val;
      }
    }
    return val;
  }

  if (val && typeof val === 'object') {
    if (Array.isArray(val)) {
      return val.map(parseDeep);
    }
    const out: Record<string, unknown> = {};
    for (const key in val as Record<string, unknown>) {
      out[key] = parseDeep((val as Record<string, unknown>)[key]);
    }
    return out;
  }

  return val;
};

/**
 * Enqueue a sub-step as a proper BullMQ job.
 * Creates a child Operation → enqueue → wait for Worker to finish.
 * Returns the completed child Operation data.
 */
export async function enqueueSubStep(
  ctx: WorkflowContext,
  processorSlug: string,
  variables: Record<string, unknown>,
  filesJson: string | null,
): Promise<SubStepResult> {
  const subOpId = crypto.randomUUID();

  await prisma.operation.create({
    data: {
      id: subOpId,
      endpointSlug: processorSlug,
      pipelineJson: JSON.stringify([{ processor: processorSlug, variables }]),
      filesJson: filesJson,
      outputFormat: 'json',
      state: 'RUNNING',
      done: false,
      progressPercent: 0,
      progressMessage: `Sub-step: ${processorSlug}`,
      deletedAt: new Date(), // hidden from user history
    },
  });

  ctx.logger.info(`[WORKFLOW] Enqueued sub-step: ${processorSlug} → subOpId=${subOpId}`);

  // Use the dedicated workflow-steps queue to avoid deadlock:
  // The parent workflow job occupies a slot on the pipeline queue.
  // Sub-steps go to a separate queue with its own worker pool so they
  // are never blocked waiting for the parent to release its slot.
  const queue = getWorkflowStepsQueue();
  const jobData: PipelineJobData = { operationId: subOpId, correlationId: ctx.correlationId, type: 'pipeline' };
  const job = await queue.add(`pipeline:${processorSlug}`, jobData, { priority: 5 });

  const queueEvents = getWorkflowStepsQueueEvents();
  const SUB_STEP_TIMEOUT = 120_000;
  try {
    await job.waitUntilFinished(queueEvents, SUB_STEP_TIMEOUT);
  } catch (err: unknown) {
    // Reload to check if it actually completed despite timeout
    const checkOp = await prisma.operation.findUnique({ where: { id: subOpId } });
    if (!checkOp || !checkOp.done) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Sub-step ${processorSlug} timed out after ${SUB_STEP_TIMEOUT / 1000}s: ${errMsg}`);
    }
    // If done, continue normally — the timeout was a pub/sub race condition
  }

  const subOp = await prisma.operation.findUnique({ where: { id: subOpId } });
  if (!subOp) throw new Error(`Sub-operation ${subOpId} not found after completion`);
  if (subOp.state === 'FAILED') throw new Error(`Sub-step ${processorSlug} failed: ${subOp.errorMessage}`);

  let extractedData: unknown = null;
  if (subOp.extractedData) {
    try {
      extractedData = JSON.parse(subOp.extractedData);
    } catch (err) {
      ctx.logger.warn(`[WORKFLOW] Failed to parse extractedData for sub-step ${processorSlug}`, undefined, err);
    }
  }

  // Track usage
  ctx.totalInputTokens += subOp.totalInputTokens || 0;
  ctx.totalOutputTokens += subOp.totalOutputTokens || 0;
  ctx.totalCost += subOp.totalCostUsd || 0;

  return { operation: subOp, content: subOp.outputContent, extractedData };
}

/** Update progress on the PARENT operation + BullMQ job */
export async function updateProgress(ctx: WorkflowContext, percent: number, message: string) {
  await prisma.operation.update({
    where: { id: ctx.operationId },
    data: {
      progressPercent: percent,
      progressMessage: message,
      stepsResultJson: JSON.stringify(ctx.stepsResult),
    },
  });
  if (ctx.job) await ctx.job.updateProgress(percent);
}

/** Mark parent operation as SUCCEEDED + send webhook if configured */
export async function completeWorkflow(ctx: WorkflowContext, outputContent: string | null, extractedData: unknown) {
  await prisma.operation.update({
    where: { id: ctx.operationId },
    data: {
      done: true,
      state: 'SUCCEEDED',
      progressPercent: 100,
      progressMessage: null,
      currentStep: ctx.stepsResult.length - 1,
      outputContent,
      extractedData: extractedData ? JSON.stringify(extractedData) : null,
      stepsResultJson: JSON.stringify(ctx.stepsResult),
      totalInputTokens: ctx.totalInputTokens,
      totalOutputTokens: ctx.totalOutputTokens,
      totalCostUsd: ctx.totalCost,
      modelUsed: null, // Determined by individual connector configs
    },
  });
  if (ctx.job) await ctx.job.updateProgress(100);
  ctx.logger.info(`[WORKFLOW] Completed for ${ctx.operationId}`);

  // Update ApiKey.totalUsed for billing/spending limit enforcement
  if (ctx.apiKeyId && ctx.totalCost > 0) {
    await prisma.apiKey.update({
      where: { id: ctx.apiKeyId },
      data: { totalUsed: { increment: ctx.totalCost } },
    });
  }

  // Send webhook notification (parity with engine.ts)
  await sendWebhook(ctx, 'SUCCEEDED');
}

/** Mark parent operation as WAITING_USER_INPUT (Paused for Human-in-the-Loop) */
export async function pauseWorkflow(ctx: WorkflowContext, message: string, currentStep: number) {
  await prisma.operation.update({
    where: { id: ctx.operationId },
    data: {
      done: false,
      state: 'WAITING_USER_INPUT',
      progressMessage: message,
      currentStep, // Save Checkpoint index to resume from there
      stepsResultJson: JSON.stringify(ctx.stepsResult),
      
      // Track usage accumulated so far
      totalInputTokens: ctx.totalInputTokens,
      totalOutputTokens: ctx.totalOutputTokens,
      totalCostUsd: ctx.totalCost,
    },
  });
  // Note: We don't set progressPercent to 100 here since it's waiting
  ctx.logger.info(`[WORKFLOW] Paused at step ${currentStep} for ${ctx.operationId}: ${message}`);

  // Send a webhook indicating PAUSED state if configured
  await sendWebhook(ctx, 'PAUSED' as any, message);
}

/** Mark parent operation as FAILED + send webhook if configured */
export async function failWorkflow(ctx: WorkflowContext, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  ctx.logger.error(`[WORKFLOW] Failed at step ${ctx.stepsResult.length}: ${msg}`, undefined, error);

  await prisma.operation.update({
    where: { id: ctx.operationId },
    data: {
      done: true,
      state: 'FAILED',
      failedAtStep: ctx.stepsResult.length,
      errorCode: 'WORKFLOW_ERROR',
      errorMessage: msg,
      stepsResultJson: JSON.stringify(ctx.stepsResult),
      totalInputTokens: ctx.totalInputTokens,
      totalOutputTokens: ctx.totalOutputTokens,
      totalCostUsd: ctx.totalCost,
    },
  });

  // Send webhook notification (parity with engine.ts)
  await sendWebhook(ctx, 'FAILED', msg);
}

/** Send webhook notification for workflow completion/failure */
async function sendWebhook(ctx: WorkflowContext, state: 'SUCCEEDED' | 'FAILED', errorMessage?: string) {
  if (!ctx.webhookUrl) return;

  const payload: Record<string, unknown> = {
    operation_id: ctx.operationId,
    state,
    done: state === 'SUCCEEDED' || state === 'FAILED', // PAUSED is not done
  };
  if (errorMessage) payload.error = errorMessage;

  try {
    await fetch(ctx.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await prisma.operation.update({
      where: { id: ctx.operationId },
      data: { webhookSentAt: new Date() },
    });
    ctx.logger.info(`[WORKFLOW] Webhook sent to ${ctx.webhookUrl}`);
  } catch (err) {
    ctx.logger.warn(`[WORKFLOW] Webhook failed for ${ctx.operationId}`, undefined, err);
  }
}

// ─── Context Factory ──────────────────────────────────────────────────────────

/** Build a WorkflowContext from an operationId (called by router) */
export async function createWorkflowContext(
  operationId: string,
  correlationId?: string,
  job?: Job,
): Promise<WorkflowContext | null> {
  const logger = new Logger({ correlationId, operationId }, job);

  const operation = await prisma.operation.findUnique({ where: { id: operationId } });
  if (!operation) {
    logger.error(`Operation ${operationId} not found`);
    return null;
  }

  let filesData: Array<{ name: string; path: string; mime: string; size: number }> = [];
  if (operation.filesJson) {
    try {
      filesData = JSON.parse(operation.filesJson);
      // Failsafe: normalize all backslashes to forward slashes in paths from DB
      filesData = filesData.map(f => ({ ...f, path: f.path?.replace(/\\/g, '/') }));
    } catch (err) {
      logger.warn(`[WORKFLOW] Failed to parse filesJson for ${operationId}, proceeding with empty files`, undefined, err);
    }
  }

  const pipelineVars: Record<string, unknown> = {};
  try {
    const pipeline = JSON.parse(operation.pipelineJson);
    if (pipeline[0]?.variables) Object.assign(pipelineVars, pipeline[0].variables);
  } catch (err) {
    logger.warn(`[WORKFLOW] Failed to parse pipelineJson for ${operationId}, proceeding with empty variables`, undefined, err);
  }

  // Load workflow prompt overrides from ProfileEndpoint (if apiKeyId present)
  let promptOverrides: Record<string, string> = {};
  if (operation.apiKeyId && operation.endpointSlug) {
    try {
      const profileEndpoint = await prisma.profileEndpoint.findUnique({
        where: {
          apiKeyId_endpointSlug: {
            apiKeyId: operation.apiKeyId,
            endpointSlug: operation.endpointSlug,
          },
        },
      });
      if (profileEndpoint?.parameters) {
        const params = JSON.parse(profileEndpoint.parameters);
        if (params._workflowPrompts?.value && typeof params._workflowPrompts.value === 'object') {
          // Format: { value: { classify: "override text", extract: "override text", ... }, isLocked: false }
          promptOverrides = params._workflowPrompts.value;
          logger.info(`[WORKFLOW] Loaded ${Object.keys(promptOverrides).length} prompt override(s) for apiKey=${operation.apiKeyId}`);
        }
      }
    } catch (err) {
      logger.warn(`[WORKFLOW] Failed to load prompt overrides for ${operationId}`, undefined, err);
    }
  }

  return {
    operationId,
    correlationId,
    job,
    logger,
    filesJson: operation.filesJson,
    filesData,
    pipelineVars,
    stepsResult: operation.stepsResultJson ? JSON.parse(operation.stepsResultJson) : [],
    totalInputTokens: operation.totalInputTokens || 0,
    totalOutputTokens: operation.totalOutputTokens || 0,
    totalCost: operation.totalCostUsd || 0,
    webhookUrl: operation.webhookUrl,
    apiKeyId: operation.apiKeyId,
    promptOverrides,
    currentStep: operation.currentStep,
  };
}

// ─── Workflow Router ──────────────────────────────────────────────────────────
// Import and register workflow functions here.

import { runDisbursement } from '@/lib/pipelines/workflows/disbursement';

const WORKFLOW_REGISTRY: Record<string, (ctx: WorkflowContext) => Promise<void>> = {
  disbursement: runDisbursement,
  // Future: appraisal: runAppraisal,
  // Future: collateral: runCollateral,
};

/**
 * Entry point called by worker.ts.
 * Routes to the appropriate workflow function based on endpointSlug.
 */
export async function runWorkflow(
  operationId: string,
  correlationId?: string,
  job?: Job,
): Promise<void> {
  const ctx = await createWorkflowContext(operationId, correlationId, job);
  if (!ctx) return;

  // Extract workflow name from job name: "pipeline:workflows:disbursement" → "disbursement"
  const jobName = job?.name || '';
  const workflowName = jobName.replace('pipeline:workflows:', '');

  const handler = WORKFLOW_REGISTRY[workflowName];
  if (!handler) {
    ctx.logger.error(`[WORKFLOW] Unknown workflow: '${workflowName}'`);
    await failWorkflow(ctx, new Error(`Unknown workflow: '${workflowName}'`));
    return;
  }

  try {
    await handler(ctx);
  } catch (error) {
    await failWorkflow(ctx, error);
  }
}
