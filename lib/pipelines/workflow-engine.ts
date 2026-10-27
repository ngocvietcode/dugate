// lib/pipelines/workflow-engine.ts
// Shared infrastructure for code-driven workflow orchestration.
// Each workflow is a separate file in lib/pipelines/workflows/*.ts
// This file provides: types, helpers (enqueueSubStep, updateProgress), and the router.

import { createHash } from 'crypto';

import { db } from '@/lib/db';
import { operations, profileEndpoints } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { resolveCallbackDeliveryConfig } from '@/lib/delivery/webhook-sender';
import { describeSentBody } from '@/lib/delivery/failed-payload-meta';
import { buildEncryptTransform } from '@/lib/crypto/build-transform';
import {
  getWorkflowStepsQueue,
  getWorkflowStepsQueueEvents,
  type PipelineJobData,
} from '@/lib/queue/pipeline-queue';
import { resolveTargetQueue, getOrCreateQueueEvents } from '@/lib/queue/worker-group-router';
import type { Job } from 'bullmq';
import type { Operation } from '@/lib/db/schema';
import type { CostSource } from '@/lib/pricing';
import {
  workflowChildVisibility,
  type CanonicalOperationalResults,
} from '@/lib/operations/operational-metadata';
import {
  insertOperation,
  transitionOperationState,
} from '@/lib/operations/state-transition';
import {
  ensureContentRetentionScheduled,
  purgeWorkflowSubSteps,
} from '@/lib/operations/content-retention';
import {
  assertSafeUrl,
  isUrlOriginAllowed,
  sanitizeUrlForLogging,
  ssrfSafeFetch,
  summarizeErrorBody,
} from '@/lib/pipelines/processors/http-client';

// Re-export for workflow files
export { db, Logger };
export type { Job };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStepResult {
  step: number;
  /** Stable business-stage identifier. Consumers should prefer this over array position. */
  stage_key?: string;
  /** Version of the stage artifact stored in extracted_data. */
  artifact_version?: string;
  /** Per-stage processing state; additive for backward compatibility. */
  status?: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'WAITING_REVIEW';
  stepName: string;
  processor: string;
  sub_operation_id?: string;
  content_preview?: unknown;    // Can be string, object, or null
  extracted_data?: unknown;
  sub_results?: unknown[];
  ocr_texts?: Record<string, string>;  // OCR full-text per file (Hybrid pipeline)
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
  filesData: Array<{ name: string; path: string; mime: string; size: number; file_id?: string }>;
  pipelineVars: Record<string, unknown>;
  stepsResult: WorkflowStepResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  inputTokensMissing?: boolean;
  outputTokensMissing?: boolean;
  costMissing?: boolean;
  hasUnpricedCost?: boolean;
  /** Rolled-up usage breakdown from each sub-operation (for cost transparency on the parent). */
  usageBreakdown: Array<{ processor: string; model: string; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; cost_source?: CostSource }>;
  /** Webhook URL from the parent operation (if any) */
  webhookUrl: string | null;
  /** API key ID of the requesting client (used for prompt override lookup) */
  apiKeyId: string | null;
  /** User ID of the requesting client */
  createdByUserId: string | null;
  /** Per-step prompt overrides loaded from ProfileEndpoint (key = step name, value = prompt text) */
  promptOverrides: Record<string, string>;
  /** Per-step model overrides loaded from ProfileEndpoint (key = step name, value = model name) */
  modelOverrides: Record<string, string>;
  /** Per-step reasoning_effort overrides loaded from ProfileEndpoint (key = step name, value = minimal|low|medium|high) */
  reasoningEffortOverrides: Record<string, string>;
  /** Checkpoint: current step index (used for resume) */
  currentStep: number;
  /** Extracted data from the last completed step — included in webhook payload */
  _lastExtractedData?: unknown;
  /**
   * Bản serialize của `stepsResult` đã ghi lên DB lần gần nhất (createWorkflowContext nạp, updateProgress cập nhật).
   * `updateProgress` chỉ ghi lại `stepsResultJson` khi chuỗi này đổi: trước đây mỗi lần cập nhật tiến độ ghi lại toàn bộ artifact
   * (~60 KB x 10 lần = ~400 KB mỗi lần chạy loan-appraisal) dù chỉ đổi phần trăm và một dòng thông báo.
   */
  _persistedStepsJson?: string;
  /**
   * D-102: id các sub-operation đã cộng usage vào ctx trong tiến trình này. Sub-step dùng lại (reuseKey) cộng usage của
   * row cũ đúng MỘT lần: tổng của cha chỉ được ghi ở điểm kết thúc (pause / complete / fail / cancel), nên lần chạy bị
   * gián đoạn chưa có usage của nó trong tổng nạp lại từ DB.
   */
  _accountedSubOps?: Set<string>;
  /** D-102: lời gọi cùng reuseKey đang chạy trong tiến trình này — gọi trùng song song dùng chung một promise. */
  _subStepInFlight?: Map<string, Promise<SubStepResult>>;
  /**
   * Optional workflow-owned business payload for the SUCCEEDED webhook. When set,
   * it replaces `extracted_data` in the callback body; the envelope
   * (operation_id, state, done, extracted_data) and the stored result are unchanged.
   */
  webhookExtractedData?: unknown;
  /** Endpoint slug of the parent operation, e.g. "workflows:payroll-verify" (used to scope per-workflow webhook behavior) */
  endpointSlug: string | null;
  /**
   * [AUTH MIGRATION] Profile-level callback auth config (encrypted + Vault-supported).
   * New canonical source for workflow callback authentication.
   * When present, sendWebhook uses this INSTEAD OF pipelineVars.csp_*.
   * Loaded from apiKeys.callbackAuthConfig via resolveCallbackDeliveryConfig.
   */
  callbackAuthConfig?: import('@/lib/auth-config/types').AuthConfig;
  /**
   * Optional webhook payload transform — called in sendWebhook just before dispatch.
   * Receives the plain payload object, returns { body, headers } to send.
   * DB always stores the plain payload regardless of this transform.
   * Set by individual workflows (e.g. PAM) that need custom encoding/encryption.
   */
  transformWebhookPayload?: (payload: object) => Promise<{ body: string; headers: Record<string, string> }>;
}

// ─── Helpers (exported for workflow files) ─────────────────────────────────────

/**
 * Recursively parse all nested JSON strings in a value into native objects.
 * Eliminates the "double-escaped JSON" problem from AI connector responses.
 * Safe to use on strings, objects, and arrays.
 */
export const parseDeep = (val: unknown): unknown => {
  if (typeof val === 'string') {
    let trimmed = val.trim();
    
    // Auto-strip markdown json wrappers (e.g., ```json\n...\n```)
    const match = trimmed.match(/```(?:json|javascript|js)?\s*([\s\S]*?)\s*```/i);
    if (match && match[1]) {
      trimmed = match[1].trim();
    }

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
export function boundSubStepTimeout(configuredTimeoutMs: number, maxWaitMs?: number): number {
  const configured = Math.max(1, Math.floor(configuredTimeoutMs));
  if (maxWaitMs === undefined || !Number.isFinite(maxWaitMs)) return configured;
  return Math.max(1, Math.min(configured, Math.floor(maxWaitMs)));
}

export interface SubStepOptions {
  /**
   * D-102 (ARCHITECTURE E3): khoá TẤT ĐỊNH của lời gọi — mọi thứ quyết định output (processor, prompt, nội dung file theo
   * hash, dải trang, model, reasoning). Có khoá ⇒ retry / resume của CÙNG operation cha dùng lại sub-step đã SUCCEEDED
   * thay vì gọi lại model. Không truyền ⇒ hành vi cũ (luôn gọi). Không bao giờ dùng lại giữa hai operation cha.
   */
  reuseKey?: string;
}

/** idempotencyKey của sub-step: gắn với operation cha, băm phần còn lại (không chứa prompt hay dữ liệu hồ sơ). */
export function subStepIdempotencyKey(parentOperationId: string, processorSlug: string, reuseKey: string): string {
  return `wfstep:${parentOperationId}:${createHash('sha256').update(`${processorSlug}\u0000${reuseKey}`, 'utf8').digest('hex')}`;
}

export async function enqueueSubStep(
  ctx: WorkflowContext,
  processorSlug: string,
  variables: Record<string, unknown>,
  filesJson: string | null,
  modelOverride?: string | null,
  reasoningEffortOverride?: string | null,
  maxWaitMs?: number,
  options?: SubStepOptions,
): Promise<SubStepResult> {
  if (!options?.reuseKey) {
    return executeSubStep(ctx, processorSlug, variables, filesJson, modelOverride, reasoningEffortOverride, maxWaitMs, null);
  }
  const key = subStepIdempotencyKey(ctx.operationId, processorSlug, options.reuseKey);
  const inFlight = (ctx._subStepInFlight ??= new Map());
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = (async () => {
    const previous = await reusableSubStep(key);
    if (previous) {
      ctx.logger.info(`[WORKFLOW] Reused sub-step ${processorSlug} → subOpId=${previous.id} (đã SUCCEEDED ở lần chạy trước)`);
      return toSubStepResult(ctx, previous, processorSlug);
    }
    return executeSubStep(ctx, processorSlug, variables, filesJson, modelOverride, reasoningEffortOverride, maxWaitMs, key);
  })();
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Sub-step đã SUCCEEDED với khoá này và còn nội dung → dùng lại. Row không dùng được (FAILED, còn RUNNING từ lần chạy
 * bị gián đoạn, đã xoá nội dung) thì NHẢ khoá để lần gọi mới giữ khoá; row cũ giữ nguyên để truy vết.
 */
async function reusableSubStep(key: string): Promise<Operation | null> {
  const [row] = await db.select().from(operations).where(eq(operations.idempotencyKey, key)).limit(1);
  if (!row) return null;
  if (row.done && row.state === 'SUCCEEDED' && !row.contentPurgedAt && row.outputContent !== null) return row;
  await db.update(operations).set({ idempotencyKey: null }).where(eq(operations.id, row.id));
  return null;
}

async function executeSubStep(
  ctx: WorkflowContext,
  processorSlug: string,
  variables: Record<string, unknown>,
  filesJson: string | null,
  modelOverride: string | null | undefined,
  reasoningEffortOverride: string | null | undefined,
  maxWaitMs: number | undefined,
  idempotencyKey: string | null,
): Promise<SubStepResult> {
  const subOpId = crypto.randomUUID();

  // Inject the per-step model / reasoning_effort overrides (if any) as the
  // `_model` / `_reasoning_effort` pipeline variables. The connector
  // (runExternalApiProcessor → resolveModel / resolveReasoningEffort) reads these
  // with the highest priority, mirroring how `_prompt` carries prompt overrides.
  const normalizedModel = typeof modelOverride === 'string' ? modelOverride.trim() : '';
  const normalizedReasoningEffort = typeof reasoningEffortOverride === 'string' ? reasoningEffortOverride.trim() : '';
  let effectiveVariables = variables;
  if (normalizedModel) {
    effectiveVariables = { ...effectiveVariables, _model: normalizedModel };
    ctx.logger.info(`[WORKFLOW] Model override configured for sub-step ${processorSlug}`);
  }
  if (normalizedReasoningEffort) {
    effectiveVariables = { ...effectiveVariables, _reasoning_effort: normalizedReasoningEffort };
    ctx.logger.info(`[WORKFLOW] reasoning_effort override configured for sub-step ${processorSlug}`);
  }

  const childRow = {
    id: subOpId,
    endpointSlug: processorSlug,
    apiKeyId: ctx.apiKeyId,
    createdByUserId: ctx.createdByUserId,
    // Link sub-step to its parent workflow run so the Operations detail can gather
    // every prompt sent during the run (shown in "Workflow Pipeline"). Applies to
    // ALL workflows since every AI step goes through enqueueSubStep.
    correlationId: ctx.correlationId ?? null,
    pipelineJson: JSON.stringify([{ processor: processorSlug, variables: effectiveVariables }]),
    filesJson: filesJson,
    outputFormat: 'json',
    state: 'RUNNING',
    done: false,
    progressPercent: 0,
    progressMessage: `Sub-step: ${processorSlug}`,
    ...workflowChildVisibility(),
  };
  try {
    await insertOperation({ ...childRow, idempotencyKey });
  } catch (err) {
    const unique = err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505';
    if (!unique || idempotencyKey === null) throw err;
    // Khoá vừa bị tiến trình khác giữ (hiếm): gọi như không có khoá thay vì chờ, kết quả vẫn đúng.
    ctx.logger.warn(`[WORKFLOW] idempotencyKey của sub-step ${processorSlug} đang được giữ; gọi không dùng lại.`);
    await insertOperation(childRow);
  }

  ctx.logger.info(`[WORKFLOW] Enqueued sub-step: ${processorSlug} → subOpId=${subOpId}`);

  // Use the dedicated workflow-steps queue to avoid deadlock:
  // The parent workflow job occupies a slot on the pipeline queue.
  // Sub-steps go to a separate queue with its own worker pool so they
  // are never blocked waiting for the parent to release its slot.
  // Route to the correct worker group's steps queue based on the profile's assignment.
  let stepsQueue;
  let stepsQueueEvents;
  try {
    const routeResult = await resolveTargetQueue(ctx.apiKeyId ?? undefined);
    stepsQueue = routeResult.stepsQueue;
    stepsQueueEvents = getOrCreateQueueEvents(routeResult.stepsQueueName);
  } catch {
    // Fallback to default steps queue if routing fails
    stepsQueue = getWorkflowStepsQueue();
    stepsQueueEvents = getWorkflowStepsQueueEvents();
  }
  const jobData: PipelineJobData = { operationId: subOpId, correlationId: ctx.correlationId, type: 'pipeline' };
  const job = await stepsQueue.add(`pipeline:${processorSlug}`, jobData, { priority: 5 });

  const queueEvents = stepsQueueEvents;

  // Resolve the connector's configured HTTP timeout from DB so the BullMQ
  // wait window always exceeds the actual HTTP call (no false timeouts).
  // Add 30s overhead buffer for queue scheduling + file download + response parsing.
  const QUEUE_OVERHEAD_MS = 30_000;
  const DEFAULT_CONNECTOR_TIMEOUT_MS = 300_000; // fallback: 300s
  let connectorTimeoutMs = DEFAULT_CONNECTOR_TIMEOUT_MS;
  try {
    const { externalApiConnections } = await import('@/lib/db/schema');
    const [conn] = await db.select({ timeoutSec: externalApiConnections.timeoutSec })
      .from(externalApiConnections)
      .where(eq(externalApiConnections.slug, processorSlug))
      .limit(1);
    if (conn?.timeoutSec) {
      connectorTimeoutMs = conn.timeoutSec * 1000;
    }
  } catch {
    // Non-fatal: fall back to default
  }
  const SUB_STEP_TIMEOUT = boundSubStepTimeout(connectorTimeoutMs + QUEUE_OVERHEAD_MS, maxWaitMs);
  ctx.logger.info(`[WORKFLOW] Sub-step timeout: ${SUB_STEP_TIMEOUT / 1000}s (connector=${connectorTimeoutMs / 1000}s, workflow remaining cap=${maxWaitMs ?? 'none'}ms)`);

  // Wait for sub-step completion using hybrid approach:
  // 1. Try BullMQ waitUntilFinished (fast path — event-driven)
  // 2. If that times out, poll DB as fallback (handles missed pub/sub events)
  const POLL_INTERVAL_MS = 3_000; // Check DB every 3s as fallback
  const startWait = Date.now();

  const waitForCompletion = async (): Promise<void> => {
    // Race between BullMQ event and DB polling
    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      // Path 1: BullMQ event-driven (fast path)
      job.waitUntilFinished(queueEvents, SUB_STEP_TIMEOUT)
        .then(() => {
          if (!resolved) { resolved = true; resolve(); }
        })
        .catch((err) => {
          // Don't reject yet — the DB poll might have already resolved it
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });

      // Path 2: DB polling fallback (handles missed events)
      const pollTimer = setInterval(async () => {
        if (resolved) { clearInterval(pollTimer); return; }
        try {
          const [checkOp] = await db.select({ done: operations.done })
            .from(operations)
            .where(eq(operations.id, subOpId))
            .limit(1);
          if (checkOp?.done) {
            clearInterval(pollTimer);
            if (!resolved) {
              resolved = true;
              ctx.logger.info(`[WORKFLOW] Sub-step ${processorSlug} completed (detected via DB poll after ${((Date.now() - startWait) / 1000).toFixed(1)}s)`);
              resolve();
            }
          }
        } catch {
          // Non-fatal poll error, will retry next interval
        }
      }, POLL_INTERVAL_MS);

      // Cleanup timer on timeout
      setTimeout(() => {
        clearInterval(pollTimer);
      }, SUB_STEP_TIMEOUT + 1000);
    });
  };

  try {
    await waitForCompletion();
  } catch (err: unknown) {
    // Final DB check — the job may have completed between the timeout and now
    const [checkOp] = await db.select().from(operations).where(eq(operations.id, subOpId)).limit(1);
    if (!checkOp || !checkOp.done) {
      const elapsed = ((Date.now() - startWait) / 1000).toFixed(1);
      const errMsg = err instanceof Error ? err.message : String(err);
      const timeoutMessage = `Sub-step ${processorSlug} timed out after ${elapsed}s: ${errMsg}`;

      // BullMQ can remove waiting/delayed jobs but not an active job. If removal
      // succeeds, persist a terminal state so the hidden operation is not left
      // RUNNING forever. Active connectors require a future AbortSignal contract.
      let removedBeforeExecution = false;
      try {
        await job.remove();
        removedBeforeExecution = true;
      } catch {
        // Active job: processor owns completion; parent still stops waiting.
      }
      if (removedBeforeExecution) {
        await transitionOperationState({
          operationId: subOpId,
          state: 'FAILED',
          changes: {
            errorCode: 'WORKFLOW_TIMEOUT',
            errorMessage: timeoutMessage,
          },
          onlyIf: { state: 'RUNNING', done: false },
        });
      }
      throw new Error(timeoutMessage);
    }
    // If done, continue normally — the timeout was a pub/sub race condition
    ctx.logger.info(`[WORKFLOW] Sub-step ${processorSlug} completed despite BullMQ timeout (pub/sub race condition)`);
  }

  const [subOp] = await db.select().from(operations).where(eq(operations.id, subOpId)).limit(1);
  if (!subOp) throw new Error(`Sub-operation ${subOpId} not found after completion`);
  if (subOp.state === 'FAILED') throw new Error(`Sub-step ${processorSlug} failed: ${subOp.errorMessage}`);
  return toSubStepResult(ctx, subOp, processorSlug);
}

/** Đọc output của sub-operation đã xong và cộng usage vào ctx đúng một lần cho mỗi sub-operation (D-102). */
function toSubStepResult(ctx: WorkflowContext, subOp: Operation, processorSlug: string): SubStepResult {
  let extractedData: unknown = null;
  if (subOp.extractedData) {
    try {
      extractedData = JSON.parse(subOp.extractedData);
    } catch (err) {
      ctx.logger.warn(`[WORKFLOW] Failed to parse extractedData for sub-step ${processorSlug}`, undefined, err);
    }
  }

  // Một sub-operation chỉ cộng usage một lần mỗi tiến trình (gọi trùng song song / dùng lại nhiều lần).
  const accounted = (ctx._accountedSubOps ??= new Set());
  if (!accounted.has(subOp.id)) {
    accounted.add(subOp.id);
    // Track usage. The child keeps nullable-source flags; the parent rolls those
    // flags up while normalizing only its aggregate totals.
    ctx.totalInputTokens += subOp.totalInputTokens ?? 0;
    ctx.totalOutputTokens += subOp.totalOutputTokens ?? 0;
    ctx.totalCost += subOp.totalCostUsd ?? 0;
    ctx.inputTokensMissing ||= subOp.inputTokensMissing;
    ctx.outputTokensMissing ||= subOp.outputTokensMissing;
    ctx.costMissing ||= subOp.costMissing;
    ctx.hasUnpricedCost ||= subOp.hasUnpricedCost;

    // Roll up the sub-operation's per-processor usage breakdown onto the parent,
    // so a business workflow keeps full cost transparency (incl. cost_source).
    if (subOp.usageBreakdown) {
      try {
        const subBreakdown = JSON.parse(subOp.usageBreakdown) as WorkflowContext['usageBreakdown'];
        if (Array.isArray(subBreakdown)) {
          for (const item of subBreakdown) {
            ctx.usageBreakdown.push({
              processor: `${processorSlug}:${item.processor ?? ''}`.replace(/:$/, ''),
              model: item.model,
              input_tokens: item.input_tokens ?? null,
              output_tokens: item.output_tokens ?? null,
              cost_usd: item.cost_usd ?? null,
              cost_source: item.cost_source,
            });
          }
        }
      } catch {
        ctx.logger.warn(`[WORKFLOW] Không parse được usageBreakdown của sub-step ${processorSlug}`);
      }
    }
  }

  return { operation: subOp, content: subOp.outputContent, extractedData };
}

/** Keeps durable progress history bounded so long-running workflows remain observable. */
export function appendProgressLog(rawLog: string | null | undefined, percent: number, message: string, now: Date = new Date()): string {
  let entries: Array<{ t: string; percent: number; message: string }> = [];
  try {
    const parsed: unknown = rawLog ? JSON.parse(rawLog) : [];
    if (Array.isArray(parsed)) {
      entries = parsed.filter((entry): entry is { t: string; percent: number; message: string } => (
        !!entry && typeof entry === 'object' && typeof entry.t === 'string'
          && typeof entry.percent === 'number' && typeof entry.message === 'string'
      ));
    }
  } catch {
    // Corrupt legacy history must not prevent the current operation from progressing.
  }
  entries.push({ t: now.toISOString(), percent, message });
  return JSON.stringify(entries.slice(-50));
}

/** Update progress on the PARENT operation + BullMQ job.
 * progressMessage is overwritten each call (latest status only in DB).
 * Client-side accumulates messages for running log display.
 */
export async function updateProgress(ctx: WorkflowContext, percent: number, message: string) {
  const [operation] = await db.select({ progressLogJson: operations.progressLogJson })
    .from(operations)
    .where(eq(operations.id, ctx.operationId))
    .limit(1);
  // Chỉ ghi `stepsResultJson` khi artifact đổi kể từ lần ghi trước; còn lại chỉ ghi phần trăm / thông báo / lịch sử (vài trăm byte).
  const stepsJson = JSON.stringify(ctx.stepsResult);
  const stepsChanged = stepsJson !== ctx._persistedStepsJson;
  await db.update(operations).set({
    progressPercent: percent,
    progressMessage: message,
    progressLogJson: appendProgressLog(operation?.progressLogJson, percent, message),
    currentStep: ctx.currentStep,
    ...(stepsChanged ? { stepsResultJson: stepsJson } : {}),
    // Không ghi đè operation đã CANCELLED (H4).
  }).where(and(eq(operations.id, ctx.operationId), sql`${operations.state} <> 'CANCELLED'`));
  if (stepsChanged) ctx._persistedStepsJson = stepsJson;
  if (ctx.job) await ctx.job.updateProgress(percent);
}

/** Sentinel: operation was cancelled by the user. Treated as a clean stop, never as FAILED. */
export class WorkflowCancelledError extends Error {
  constructor(readonly operationId: string) {
    super(`Operation ${operationId} was cancelled`);
    this.name = 'WorkflowCancelledError';
  }
}

/** Reads the current state from DB (cancel route writes CANCELLED from another process). */
export async function isOperationCancelled(ctx: WorkflowContext): Promise<boolean> {
  const [operation] = await db.select({ state: operations.state })
    .from(operations)
    .where(eq(operations.id, ctx.operationId))
    .limit(1);
  return operation?.state === 'CANCELLED';
}

/** Throws WorkflowCancelledError when the operation is CANCELLED; call before starting new work. */
export async function assertNotCancelled(ctx: WorkflowContext): Promise<void> {
  if (await isOperationCancelled(ctx)) throw new WorkflowCancelledError(ctx.operationId);
}

export async function updateWorkflowProgressDetails(
  ctx: WorkflowContext,
  progressDetails: object,
): Promise<void> {
  await db.update(operations).set({
    // `extractedData` remains the final workflow result on completion. While running it carries
    // only this additive, internal polling snapshot and is never sent to a webhook.
    extractedData: JSON.stringify({ progress_details: progressDetails }),
  }).where(eq(operations.id, ctx.operationId));
}

/**
 * Op bị huỷ: ghi usage đã phát sinh (ctx) lên row CANCELLED. Sub-op đã tự cộng apiKeys.totalUsed trong
 * runPipeline nên KHÔNG cộng totalUsed lần nữa ở đây. Giá trị tuyệt đối (SET) + điều kiện state nên idempotent.
 * Lỗi DB chỉ log, không throw (tránh BullMQ retry / biến CANCELLED thành FAILED).
 */
export async function recordCancelledUsage(ctx: WorkflowContext): Promise<void> {
  try {
    await db.update(operations).set({
      stepsResultJson: JSON.stringify(ctx.stepsResult),
      totalInputTokens: ctx.totalInputTokens,
      totalOutputTokens: ctx.totalOutputTokens,
      totalCostUsd: ctx.totalCost,
      inputTokensMissing: ctx.inputTokensMissing ?? false,
      outputTokensMissing: ctx.outputTokensMissing ?? false,
      costMissing: ctx.costMissing ?? false,
      hasUnpricedCost: ctx.hasUnpricedCost ?? false,
      usageBreakdown: JSON.stringify(ctx.usageBreakdown),
    }).where(and(eq(operations.id, ctx.operationId), sql`${operations.state} = 'CANCELLED'`));
  } catch (err) {
    ctx.logger.warn(`[WORKFLOW] ${ctx.operationId} failed to record usage of cancelled op: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Mark parent operation as SUCCEEDED + send webhook if configured */
export async function completeWorkflow(
  ctx: WorkflowContext,
  outputContent: string | null,
  extractedData: unknown,
  canonicalResults: CanonicalOperationalResults = {},
  /**
   * Workflow có thể truyền hàm thu gọn artifact bước khi kết thúc (VD bỏ `extracted_data` đã trùng kết quả cuối). Chỉ áp cho bản LƯU khi
   * SUCCEEDED; `ctx.stepsResult` trong bộ nhớ không đổi. Resume chỉ chấp nhận WAITING_USER_INPUT nên checkpoint không còn được đọc lại.
   */
  compactSteps?: (steps: WorkflowStepResult[]) => WorkflowStepResult[],
) {
  const transitioned = await transitionOperationState({
    operationId: ctx.operationId,
    state: 'SUCCEEDED',
    // Atomic (row-locked) guard: a cancelled operation must stay CANCELLED.
    onlyIf: { stateNotIn: ['CANCELLED'] },
    changes: {
      progressPercent: 100,
      currentStep: ctx.stepsResult.length - 1,
      outputContent,
      extractedData: extractedData ? JSON.stringify(extractedData) : null,
      stepsResultJson: JSON.stringify(compactSteps ? compactSteps(ctx.stepsResult) : ctx.stepsResult),
      totalInputTokens: ctx.totalInputTokens,
      totalOutputTokens: ctx.totalOutputTokens,
      totalCostUsd: ctx.totalCost,
      inputTokensMissing: ctx.inputTokensMissing ?? false,
      outputTokensMissing: ctx.outputTokensMissing ?? false,
      costMissing: ctx.costMissing ?? false,
      hasUnpricedCost: ctx.hasUnpricedCost ?? false,
      logicResult: canonicalResults.logicResult ?? null,
      extractionResult: canonicalResults.extractionResult ?? null,
      usageBreakdown: JSON.stringify(ctx.usageBreakdown),
      modelUsed: null, // Determined by individual connector configs
    },
  });
  if (transitioned?.state === 'CANCELLED') {
    // Bị huỷ trong lúc chạy: giữ CANCELLED, không webhook SUCCEEDED, không tính totalUsed. Không throw để BullMQ không retry.
    ctx.logger.info(`[WORKFLOW] ${ctx.operationId} already CANCELLED, skipping SUCCEEDED`);
    await recordCancelledUsage(ctx);
    return;
  }
  // Bản đã thu gọn đã nằm trên DB; giữ nó cả trong bộ nhớ để các lần ghi `stepsResultJson` về sau (log webhook) không ghi đè lại bản đầy đủ.
  if (compactSteps) ctx.stepsResult = compactSteps(ctx.stepsResult);
  if (ctx.job) await ctx.job.updateProgress(100);
  ctx.logger.info(`[WORKFLOW] Completed for ${ctx.operationId}`);

  // ApiKey.totalUsed KHÔNG được cộng ở đây: ctx.totalCost chỉ là tổng chi phí các sub-op
  // (enqueueSubStep), và mỗi sub-op đã tự cộng totalUsed trong runPipeline (engine.ts). Cộng
  // thêm ở workflow cha sẽ tính đôi cùng một khoản chi phí. Workflow cha không sở hữu chi phí AI riêng.

  // Send webhook notification (parity with engine.ts)
  ctx._lastExtractedData = extractedData;
  await dispatchWorkflowWebhook(ctx, 'SUCCEEDED');
  await purgeFinishedSubSteps(ctx, extractedData);
}

/**
 * The run is final (runWorkflow never rethrows, so BullMQ does not retry it and
 * resume only applies to WAITING_USER_INPUT): the prompts and model output kept
 * on its sub-step Operations are never read again. Never throws.
 */
async function purgeFinishedSubSteps(ctx: WorkflowContext, extractedData?: unknown): Promise<void> {
  await purgeWorkflowSubSteps({
    parentOperationId: ctx.operationId,
    correlationIds: [ctx.correlationId],
    references: [ctx.stepsResult, extractedData],
    logger: ctx.logger,
  });
}

/**
 * Mark parent operation as WAITING_USER_INPUT (Paused for Human-in-the-Loop).
 * `extractedData` (tùy chọn): kết quả tạm của phần đã chạy, trả ra ở `result.extracted_data` khi poll (format.ts).
 */
export async function pauseWorkflow(ctx: WorkflowContext, message: string, currentStep: number, extractedData?: unknown) {
  await transitionOperationState({
    operationId: ctx.operationId,
    state: 'WAITING_USER_INPUT',
    changes: {
      progressMessage: message,
      currentStep, // Save Checkpoint index to resume from there
      stepsResultJson: JSON.stringify(ctx.stepsResult),
      ...(extractedData !== undefined ? { extractedData: JSON.stringify(extractedData) } : {}),

      // Track usage accumulated so far
      totalInputTokens: ctx.totalInputTokens,
      totalOutputTokens: ctx.totalOutputTokens,
      totalCostUsd: ctx.totalCost,
      inputTokensMissing: ctx.inputTokensMissing ?? false,
      outputTokensMissing: ctx.outputTokensMissing ?? false,
      costMissing: ctx.costMissing ?? false,
      hasUnpricedCost: ctx.hasUnpricedCost ?? false,
      usageBreakdown: JSON.stringify(ctx.usageBreakdown),
    },
  });
  // Note: We don't set progressPercent to 100 here since it's waiting
  ctx.logger.info(`[WORKFLOW] Paused at step ${currentStep} for ${ctx.operationId}: ${message}`);

  // Send a webhook indicating PAUSED state if configured
  await dispatchWorkflowWebhook(ctx, 'PAUSED', message);
}

interface PublicWorkflowFailure {
  /** Short classified headline sent on the webhook contract. */
  message: string;
  /** Headline + redacted cause, stored on the Operation so operators can act. */
  detailedMessage: string;
  errorCode: 'INPUT_INVALID' | 'CONNECTOR_ERROR' | 'SYSTEM_ERROR';
  retryable: boolean;
}

/**
 * Classification for the webhook contract.
 *
 * `message`, `errorCode` and `retryable` are byte-for-byte the values this
 * function has always produced — the integrating IDP reads `error_code` and
 * `retryable` to decide whether to re-submit a document, so no marker, no
 * headline and no retry flag may change here. Any new failure category would
 * alter that decision for a live integration and is therefore out of scope.
 *
 * `detailedMessage` is the ONLY addition: it is stored on the Operation so
 * operators can see the cause, and it is never put on the webhook.
 */
export function classifyWorkflowFailure(rawMessage: string): PublicWorkflowFailure {
  // The cause is our own error text (connector wrapper, input validators). It is
  // already redacted at the connector boundary, but run it through the shared
  // scrubber anyway so a credential echoed by an upstream can never land in a
  // stored, API-visible field.
  const cause = summarizeErrorBody(rawMessage);
  const withCause = (headline: string) => (cause ? `${headline} — ${cause}` : headline);

  if (rawMessage.startsWith('WORKFLOW_TIMEOUT:')) {
    const headline = 'Workflow exceeded its configured time budget.';
    return { message: headline, detailedMessage: withCause(headline), errorCode: 'CONNECTOR_ERROR', retryable: true };
  }

  const isInputError = ['INVALID_INPUT', 'EXCEL_PARSE_FAILED', 'EXCEL_EMPTY_DATA', 'PDF_SPLIT_FAILED', 'PDF_EMPTY']
    .some((marker) => rawMessage.includes(marker));
  if (isInputError) {
    const headline = 'Workflow input could not be processed.';
    return { message: headline, detailedMessage: withCause(headline), errorCode: 'INPUT_INVALID', retryable: false };
  }
  const isConnectionError = ['Connection Error', 'SSL connection', 'timed out', 'timeout']
    .some((marker) => rawMessage.toLowerCase().includes(marker.toLowerCase()));
  if (isConnectionError) {
    const headline = 'A downstream service could not complete the request.';
    return { message: headline, detailedMessage: withCause(headline), errorCode: 'CONNECTOR_ERROR', retryable: true };
  }
  const headline = 'Workflow processing failed due to an internal error.';
  return { message: headline, detailedMessage: withCause(headline), errorCode: 'SYSTEM_ERROR', retryable: true };
}

/** Mark parent operation as FAILED + send webhook if configured */
export async function failWorkflow(ctx: WorkflowContext, error: unknown) {
  if (error instanceof WorkflowCancelledError) {
    ctx.logger.info(`[WORKFLOW] ${ctx.operationId} cancelled, stopping without FAILED`);
    await recordCancelledUsage(ctx);
    return;
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  const publicFailure = classifyWorkflowFailure(rawMessage);
  ctx.logger.error(`[WORKFLOW] Failed at step ${ctx.stepsResult.length}: ${rawMessage}`, undefined, error);

  const transitioned = await transitionOperationState({
    operationId: ctx.operationId,
    state: 'FAILED',
    onlyIf: { stateNotIn: ['CANCELLED'] },
    changes: {
      // Financial-report track duy trì ctx.currentStep (stage); workflow khác không set nên
      // fallback về stepsResult.length để giữ đúng ngữ nghĩa "số bước đã chạy" như trước.
      failedAtStep: ctx.currentStep || ctx.stepsResult.length,
      errorCode: publicFailure.errorCode,
      // Store the classified headline WITH the redacted cause. Storing only the
      // headline made every workflow failure read "internal error" in the
      // Operations UI and in the Profile Test panel, while the non-workflow engine
      // (engine.ts) stored the real cause — same product, two different answers.
      errorMessage: publicFailure.detailedMessage,
      stepsResultJson: JSON.stringify(ctx.stepsResult),
      totalInputTokens: ctx.totalInputTokens,
      totalOutputTokens: ctx.totalOutputTokens,
      totalCostUsd: ctx.totalCost,
      inputTokensMissing: ctx.inputTokensMissing ?? false,
      outputTokensMissing: ctx.outputTokensMissing ?? false,
      costMissing: ctx.costMissing ?? false,
      hasUnpricedCost: ctx.hasUnpricedCost ?? false,
      usageBreakdown: JSON.stringify(ctx.usageBreakdown),
    },
  });
  if (transitioned?.state === 'CANCELLED') {
    ctx.logger.warn(`[WORKFLOW] ${ctx.operationId} already CANCELLED, skipping FAILED`);
    await recordCancelledUsage(ctx);
    return;
  }

  await dispatchWorkflowWebhook(ctx, 'FAILED', publicFailure);
  await purgeFinishedSubSteps(ctx);
}

/**
 * Chooses the callback auth source while preserving the workflow callback contract.
 *
 * AUTH MIGRATION GUIDE
 * --------------------
 * Workflows historically stored callback credentials in pipelineVars.csp_* fields.
 * Those values remain supported solely as a backward-compatible fallback.
 * Profile Integration Auth is now the canonical callback authentication source.
 * Its callbackAuthConfig is encrypted at rest and supports Vault secret references.
 * createWorkflowContext loads the Profile config once and carries it on the context.
 * sendWebhook first tries that context config only after the callback origin is allowed.
 * Bearer, header, CSP OAuth2, and OAuth2 client-credentials auth are applied there.
 * A missing, malformed, or unresolvable Profile config must never fail a workflow.
 * In that case, the legacy webhook_auth_token and csp_* path is attempted unchanged.
 * Profiles without callbackAuthConfig therefore retain their established behavior.
 * New workflows must configure callback auth in Profile Integration Config instead of
 * adding csp_token_url, csp_client_id, csp_client_secret, or ibm_client_id params.
 * Do not put DU secrets into request payloads, generated cURL examples, or logs.
 * Validate a migrated Profile callback before removing any legacy CSP parameter values.
 * Remove legacy values only after callback and file-download behavior is confirmed live.
 * The registry keeps deprecated legacy fields temporarily so existing Profiles continue.
 * When every consuming Profile has migrated, remove the deprecated registry fields.
 * At that point, remove the fallback below and the corresponding csp-token dependency.
 * Keep callback URL SSRF checks and origin allowlisting before resolving credentials.
 * Do not modify workflow implementation files for an auth migration; this engine owns it.
 */
async function dispatchWorkflowWebhook(
  ctx: WorkflowContext,
  state: 'SUCCEEDED' | 'FAILED' | 'PAUSED',
  failure?: PublicWorkflowFailure | string,
): Promise<void> {
  if (!ctx.webhookUrl) return;
  await sendWebhook(ctx, state, failure);
}

/** Send webhook notification for workflow completion/failure. */
async function sendWebhook(
  ctx: WorkflowContext,
  state: 'SUCCEEDED' | 'FAILED' | 'PAUSED',
  failure?: PublicWorkflowFailure | string,
) {
  if (!ctx.webhookUrl) return;

  let targetUrl: string;
  try {
    targetUrl = await assertSafeUrl(ctx.webhookUrl);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unsafe callback URL';
    ctx.logger.warn(`[WORKFLOW] Blocked webhook callback: ${message}`);
    return;
  }
  if (!isUrlOriginAllowed(targetUrl, process.env.ALLOWED_WEBHOOK_ORIGINS ?? '')) {
    ctx.logger.warn(`[WORKFLOW] Blocked webhook callback to non-allowlisted origin ${sanitizeUrlForLogging(targetUrl)}`);
    return;
  }

  const payload: Record<string, unknown> = {
    operation_id: ctx.operationId,
    state,
    done: state === 'SUCCEEDED' || state === 'FAILED',
  };
  // margin-deposit callback contract: echo the client-supplied x-correlation-id
  // back to the caller as transaction_id. When the client omitted the header,
  // the API route generated a UUID and stored it on the Operation; that same
  // value is still safe to return here as the request transaction identifier.
  // (Restored: dropped by an unrelated commit c0a38dbe, test kept expecting it.)
  if (ctx.endpointSlug === 'workflows:margin-deposit' && ctx.correlationId) {
    payload.transaction_id = ctx.correlationId;
  }
  if (typeof failure === 'string') {
    payload.error = failure;
  } else if (failure) {
    // payroll-verify only: send the detailed cause (e.g. "EXCEL_PARSE_FAILED: File
    // Excel có 3 sheets...") instead of the generic classified headline, so the IDP
    // can act on the callback without a follow-up GET /operations/{id}. error_code /
    // retryable stay untouched — this only changes the `error` text, and only for
    // this workflow, to avoid altering the frozen webhook contract other
    // integrations (disbursement, payment-account-management, etc.) rely on.
    payload.error = ctx.endpointSlug === 'workflows:payroll-verify' ? failure.detailedMessage : failure.message;
    payload.error_code = failure.errorCode;
    payload.retryable = failure.retryable;
  }

  // Include extractedData in webhook payload for SUCCEEDED (IDP needs compare results).
  // A workflow may supply a dedicated integration payload instead of the stored result.
  const succeededData = ctx.webhookExtractedData ?? ctx._lastExtractedData;
  if (state === 'SUCCEEDED' && succeededData) {
    payload.extracted_data = succeededData;
  }

  // ── Payload transform (encoding / encryption) ──
  // Priority:
  //   1. ctx.transformWebhookPayload  — workflow-owned transform (PAM legacy format).
  //   2. Profile encryption_enabled   — engine-wired spec-format encryption (any workflow,
  //      toggled entirely from the Profile UI; no per-workflow code required).
  //   3. else                          — plain JSON (unchanged legacy behaviour).
  let bodyToSend: string;
  const encryptionHeaders: Record<string, string> = {};

  // [SEC 29/09 LA-S1] A workflow-owned webhook payload (webhookExtractedData) has a
  // new shape; strict paths stop stale selective encryption_fields from leaking
  // those fields as plaintext while another configured path still matches.
  const activeTransform =
    ctx.transformWebhookPayload
    ?? buildEncryptTransform(ctx.pipelineVars as never, undefined, {
      strictPaths: ctx.webhookExtractedData !== undefined,
    });

  if (activeTransform) {
    try {
      const transformed = await activeTransform(payload);
      bodyToSend = transformed.body;
      Object.assign(encryptionHeaders, transformed.headers);
    } catch (err) {
      ctx.logger.error('[WORKFLOW] Webhook payload transform failed — aborting webhook dispatch', { encryption_failed: true, payload_keys: Object.keys(payload) }, err);
      throw new Error(`Webhook payload transform failed: ${(err as Error).message}`);
    }
  } else {
    bodyToSend = JSON.stringify(payload);
  }

  // Callback credentials are attached only to explicitly allowlisted origins.
  // A safe public URL alone is not sufficient authorization to receive secrets.
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...encryptionHeaders };
  const credentialOriginAllowed = isUrlOriginAllowed(targetUrl, process.env.ALLOWED_WEBHOOK_ORIGINS ?? '');
  const authToken = ctx.pipelineVars.webhook_auth_token as string | undefined;
  const cspTokenUrl = ctx.pipelineVars.csp_token_url as string | undefined;
  const cspClientId = ctx.pipelineVars.csp_client_id as string | undefined;
  const cspClientSecret = ctx.pipelineVars.csp_client_secret as string | undefined;
  const ibmClientId = ctx.pipelineVars.ibm_client_id as string | undefined;

  if (ibmClientId) headers['X-IBM-Client-Id'] = ibmClientId;

  if (credentialOriginAllowed && ctx.callbackAuthConfig) {
    try {
      const { resolveAuthConfigSecrets } = await import('@/lib/auth-config/resolve-secret');
      const { buildGatewayHeaders, buildSyncAuthHeaders } = await import('@/lib/auth-config/apply');
      const resolvedAuth = await resolveAuthConfigSecrets(
        ctx.callbackAuthConfig,
        (message) => ctx.logger.warn(`[WORKFLOW] ${message}`),
      );
      if (!resolvedAuth) {
        ctx.logger.warn('[WORKFLOW] Failed to resolve callbackAuthConfig; will fall back to pipelineVars.csp_*');
      } else {
        const gatewayHeaders = buildGatewayHeaders(resolvedAuth);
        Object.assign(headers, gatewayHeaders, buildSyncAuthHeaders(resolvedAuth));

        if ((resolvedAuth.type === 'oauth2_client_credentials' || resolvedAuth.type === 'csp_oauth2')
          && resolvedAuth.token_url && resolvedAuth.client_id && resolvedAuth.client_secret) {
          const { getOAuth2Token } = await import('@/lib/auth-config/oauth2-token');
          const token = await getOAuth2Token({
            token_url: resolvedAuth.token_url,
            client_id: resolvedAuth.client_id,
            client_secret: resolvedAuth.client_secret,
            token_body_format: resolvedAuth.token_body_format ?? (resolvedAuth.type === 'csp_oauth2' ? 'json' : undefined),
            token_auth_style: resolvedAuth.token_auth_style ?? 'body',
            scope: resolvedAuth.scope,
            audience: resolvedAuth.audience,
            token_response_path: resolvedAuth.token_response_path,
            ...(Object.keys(gatewayHeaders).length ? { token_extra_headers: gatewayHeaders } : {}),
          }, { errorPrefix: 'Workflow callback OAuth2 token' });
          headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch (err) {
      ctx.logger.warn('[WORKFLOW] Failed to prepare callbackAuthConfig; will fall back to pipelineVars.csp_*', undefined, err);
    }
  }

  if (credentialOriginAllowed && !headers.Authorization && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  } else if (credentialOriginAllowed && !headers.Authorization && cspTokenUrl && cspClientId && cspClientSecret) {
    try {
      const { getCspToken } = await import('@/lib/csp-token');
      const token = await getCspToken({ token_url: cspTokenUrl, client_id: cspClientId, client_secret: cspClientSecret, ibm_client_id: ibmClientId });
      headers.Authorization = `Bearer ${token}`;
    } catch (err) {
      ctx.logger.warn('[WORKFLOW] Failed to fetch CSP token for webhook auth', undefined, err);
    }
  } else if ((authToken || (cspTokenUrl && cspClientId && cspClientSecret)) && !credentialOriginAllowed) {
    ctx.logger.warn(`[WORKFLOW] Callback credentials withheld for non-allowlisted origin ${sanitizeUrlForLogging(targetUrl)}`);
  }

  // Retry up to 3 times with exponential backoff. Callback credentials,
  // query strings and response bodies never enter logs or operation history.
  let lastResponseStatus: number | null = null;
  let lastError: string | null = null;
  const safeWebhookUrl = sanitizeUrlForLogging(targetUrl);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await ssrfSafeFetch(targetUrl, {
        method: 'POST',
        headers,
        body: bodyToSend,
        signal: AbortSignal.timeout(10_000),
      });
      lastResponseStatus = res.status;
      await res.text().catch(() => '');
      if (res.ok) {
        ctx.stepsResult.push({
          step: ctx.stepsResult.length,
          stepName: 'Webhook Callback',
          processor: 'webhook',
          content_preview: {
            webhook_endpoint: safeWebhookUrl,
            http_status: res.status,
            attempt,
            payload_keys: Object.keys(payload),
          },
        });
        await db.update(operations).set({
          webhookSentAt: new Date(),
          webhookAttempts: attempt,
          webhookLastError: null,
          stepsResultJson: JSON.stringify(ctx.stepsResult),
        }).where(eq(operations.id, ctx.operationId));
        ctx.logger.info(`[WORKFLOW] Webhook sent to ${safeWebhookUrl} (attempt ${attempt}, HTTP ${res.status})`);
        return;
      }
      lastError = `HTTP ${res.status}`;
      ctx.logger.warn(`[WORKFLOW] Webhook attempt ${attempt}/3 returned HTTP ${res.status} for ${safeWebhookUrl}`);
    } catch (err) {
      lastError = summarizeErrorBody(err instanceof Error ? err.message : String(err));
      // Internal log only — without the exception a failed callback is undiagnosable.
      ctx.logger.warn(`[WORKFLOW] Webhook attempt ${attempt}/3 failed for ${ctx.operationId}`, undefined, err);
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  ctx.stepsResult.push({
    step: ctx.stepsResult.length,
    stepName: 'Webhook Callback (FAILED)',
    processor: 'webhook',
    content_preview: {
      webhook_endpoint: safeWebhookUrl,
      http_status: lastResponseStatus,
      attempts: 3,
    },
  });
  await db.update(operations).set({
    webhookAttempts: 3,
    webhookLastError: lastError ?? (lastResponseStatus === null ? 'Webhook delivery failed' : `HTTP ${lastResponseStatus}`),
    stepsResultJson: JSON.stringify(ctx.stepsResult),
  }).where(eq(operations.id, ctx.operationId));
  ctx.logger.error(
    `[WORKFLOW] Webhook delivery failed after 3 attempts for ${ctx.operationId}`,
    describeSentBody(bodyToSend, { last_error: lastError, http_status: lastResponseStatus }),
  );
}

// ─── Context Factory ──────────────────────────────────────────────────────────

/** Build a WorkflowContext from an operationId (called by router) */
export async function createWorkflowContext(
  operationId: string,
  correlationId?: string,
  job?: Job,
): Promise<WorkflowContext | null> {
  const logger = new Logger({ correlationId, operationId }, job);

  const [operation] = await db.select().from(operations).where(eq(operations.id, operationId)).limit(1);
  if (!operation) {
    logger.error(`Operation ${operationId} not found`);
    return null;
  }

  let filesData: Array<{ name: string; path: string; mime: string; size: number; file_id?: string }> = [];
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
  // Also merge Profile parameters into pipelineVars (for CSP credentials, compare_config, etc.)
  let promptOverrides: Record<string, string> = {};
  let modelOverrides: Record<string, string> = {};
  let reasoningEffortOverrides: Record<string, string> = {};
  if (operation.apiKeyId && operation.endpointSlug) {
    try {
      const [profileEndpoint] = await db.select().from(profileEndpoints)
        .where(and(eq(profileEndpoints.apiKeyId, operation.apiKeyId), eq(profileEndpoints.endpointSlug, operation.endpointSlug)))
        .limit(1);
      if (profileEndpoint?.parameters) {
        const params = JSON.parse(profileEndpoint.parameters);

        // Merge Profile parameter values into pipelineVars (Profile takes priority over request)
        // This allows Admin to configure CSP credentials (csp_token_url, csp_client_id, csp_client_secret)
        // once in the Profile UI, without IDP needing to send them in every request.
        for (const [key, paramObj] of Object.entries(params)) {
          if (key === '_workflowPrompts' || key === '_workflowModels' || key === '_workflowReasoningEfforts') continue; // handled separately below
          const val = (paramObj as { value?: unknown; isLocked?: boolean })?.value;
          if (val !== undefined && val !== null && (val !== '' || key === 'output_suppressed_report_types')) {
            // Profile value overrides request value (locked or not — Admin always wins)
            pipelineVars[key] = val;
          }
        }
        if (params._workflowPrompts?.value && typeof params._workflowPrompts.value === 'object') {
          // Format: { value: { classify: "override text", extract: "override text", ... }, isLocked: false }
          promptOverrides = params._workflowPrompts.value;
          logger.info(`[WORKFLOW] Loaded ${Object.keys(promptOverrides).length} prompt override(s) for apiKey=${operation.apiKeyId}`);
        }
        const rawWorkflowModels = params._workflowModels?.value;
        if (rawWorkflowModels && typeof rawWorkflowModels === 'object' && !Array.isArray(rawWorkflowModels)) {
          modelOverrides = Object.fromEntries(
            Object.entries(rawWorkflowModels)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim())
              .map(([step, model]) => [step, model.trim()]),
          );
          logger.info(`[WORKFLOW] Loaded ${Object.keys(modelOverrides).length} model override(s) for apiKey=${operation.apiKeyId}`);
        } else if (rawWorkflowModels !== undefined && rawWorkflowModels !== null) {
          logger.warn(`[WORKFLOW] Ignored malformed model overrides for apiKey=${operation.apiKeyId}`);
        }
        const rawWorkflowReasoningEfforts = params._workflowReasoningEfforts?.value;
        if (rawWorkflowReasoningEfforts && typeof rawWorkflowReasoningEfforts === 'object' && !Array.isArray(rawWorkflowReasoningEfforts)) {
          reasoningEffortOverrides = Object.fromEntries(
            Object.entries(rawWorkflowReasoningEfforts)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim())
              .map(([step, effort]) => [step, effort.trim()]),
          );
          logger.info(`[WORKFLOW] Loaded ${Object.keys(reasoningEffortOverrides).length} reasoning_effort override(s) for apiKey=${operation.apiKeyId}`);
        } else if (rawWorkflowReasoningEfforts !== undefined && rawWorkflowReasoningEfforts !== null) {
          logger.warn(`[WORKFLOW] Ignored malformed reasoning_effort overrides for apiKey=${operation.apiKeyId}`);
        }
      }
    } catch (err) {
      logger.warn(`[WORKFLOW] Failed to load prompt overrides for ${operationId}`, undefined, err);
    }
  }

  // [AUTH MIGRATION] Load Profile-level callback auth config (new canonical path).
  let callbackAuthConfig: import('@/lib/auth-config/types').AuthConfig | undefined;
  if (operation.apiKeyId) {
    try {
      const deliveryConfig = await resolveCallbackDeliveryConfig(operation.apiKeyId);
      if (deliveryConfig.authConfigured && deliveryConfig.authConfig) {
        callbackAuthConfig = deliveryConfig.authConfig;
        logger.info(`[WORKFLOW] Loaded callbackAuthConfig (type=${deliveryConfig.authConfig.type}) for apiKey=${operation.apiKeyId}`);
      } else if (deliveryConfig.authConfigured) {
        logger.warn('[WORKFLOW] Invalid callbackAuthConfig; will fall back to pipelineVars.csp_*');
      }
    } catch (err) {
      logger.warn('[WORKFLOW] Failed to load callbackAuthConfig; will fall back to pipelineVars.csp_*', undefined, err);
    }
  }

  return {
    operationId,
    // Resume (giai đoạn 2 của loan-appraisal…) sinh correlationId mới cho job; bước con phải mang correlationId
    // đã lưu của operation cha thì trang chi tiết (tìm theo correlationId của cha) mới thấy được.
    correlationId: operation.correlationId ?? correlationId,
    job,
    logger,
    filesJson: operation.filesJson,
    filesData,
    pipelineVars,
    stepsResult: operation.stepsResultJson ? JSON.parse(operation.stepsResultJson) : [],
    // Trạng thái đã có trên DB: lần updateProgress đầu không cần ghi lại nếu chưa có bước nào đổi.
    _persistedStepsJson: operation.stepsResultJson ? JSON.stringify(JSON.parse(operation.stepsResultJson)) : '[]',
    totalInputTokens: operation.totalInputTokens ?? 0,
    totalOutputTokens: operation.totalOutputTokens ?? 0,
    totalCost: operation.totalCostUsd ?? 0,
    inputTokensMissing: operation.inputTokensMissing,
    outputTokensMissing: operation.outputTokensMissing,
    costMissing: operation.costMissing,
    hasUnpricedCost: operation.hasUnpricedCost,
    usageBreakdown: parseUsageBreakdown(operation.usageBreakdown),
    webhookUrl: operation.webhookUrl,
    apiKeyId: operation.apiKeyId,
    createdByUserId: operation.createdByUserId,
    promptOverrides,
    modelOverrides,
    reasoningEffortOverrides,
    currentStep: operation.currentStep,
    endpointSlug: operation.endpointSlug,
    callbackAuthConfig,
  };
}

// ─── Workflow Router ──────────────────────────────────────────────────────────
// Import and register workflow functions here.

import { runDisbursement } from '@/lib/pipelines/workflows/disbursement';
import { runLcChecker } from '@/lib/pipelines/workflows/lc-checker';
import { runPayrollVerify } from '@/lib/pipelines/workflows/payroll-verify';
import { runStructureCompare } from '@/lib/pipelines/workflows/structure-compare';
import { runBrdAnalyze } from '@/lib/pipelines/workflows/brd-analyze';
import { runPaymentAccountManagement } from '@/lib/pipelines/workflows/payment-account-management';
import { runFinancialReportTranslation } from '@/lib/pipelines/workflows/financial-report-translation';
import { runStatementAnalyze } from '@/lib/pipelines/workflows/statement-analyze';
import { runTracingPortal } from '@/lib/pipelines/workflows/tracing-portal';
import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { runAccountOpening } from '@/lib/pipelines/workflows/account-opening';
import { runMarginDeposit } from '@/lib/pipelines/workflows/margin-deposit';

/** Safely parse a stored usageBreakdown JSON into the ctx accumulator shape. */
function parseUsageBreakdown(raw: string | null): WorkflowContext['usageBreakdown'] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const WORKFLOW_REGISTRY: Record<string, (ctx: WorkflowContext) => Promise<void>> = {
  disbursement: runDisbursement,
  'lc-checker': runLcChecker,
  'payroll-verify': runPayrollVerify,
  'structure-compare': runStructureCompare,
  'brd-analyze': runBrdAnalyze,
  'payment-account-management': runPaymentAccountManagement,
  'financial-report-translation': runFinancialReportTranslation,
  'statement-analyze': runStatementAnalyze,
  'tracing-portal': runTracingPortal,
  'loan-appraisal': runLoanAppraisal,
  'account-opening': runAccountOpening,
  'margin-deposit': runMarginDeposit,
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
  // Arms the hourly content-retention run in the worker process (idempotent).
  ensureContentRetentionScheduled();
  const ctx = await createWorkflowContext(operationId, correlationId, job);
  if (!ctx) return;

  // Đã bị huỷ trước khi worker nhận job (queue backlog) → không chạy gì cả.
  if (await isOperationCancelled(ctx)) {
    ctx.logger.info(`[WORKFLOW] ${operationId} already CANCELLED before start, skipping`);
    return;
  }

  // ── Download pending file_urls (deferred from async submit) ──────────────
  // Parity with engine.ts: workflow route may pass file_urls that need downloading
  // before the workflow handler can access them via ctx.filesData.
  const jobData = job?.data as import('@/lib/queue/pipeline-queue').PipelineJobData | undefined;
  if (jobData?.pendingFileUrls && jobData.pendingFileUrls.length > 0) {
    try {
      const { downloadAllFileUrls } = await import('@/lib/file-url-downloader');
      ctx.logger.info(`[WORKFLOW] Downloading ${jobData.pendingFileUrls.length} pending file URLs`);
      await updateProgress(ctx, 1, `Downloading ${jobData.pendingFileUrls.length} file(s) from URLs...`);
      const downloaded = await downloadAllFileUrls(
        jobData.pendingFileUrls,
        operationId,
        jobData.pendingFileUrlAuthConfig,
        jobData.pendingAllowedFileExtensions,
      );
      // Merge downloaded files into ctx.filesData
      for (const f of downloaded) {
        ctx.filesData.push({ name: f.name, path: f.path, mime: f.mime, size: f.size, file_id: f.file_id });
      }
      // Persist updated filesJson so checkpoint/resume picks them up
      await db.update(operations).set({
        filesJson: JSON.stringify(ctx.filesData),
      }).where(eq(operations.id, operationId));
      ctx.filesJson = JSON.stringify(ctx.filesData);
      ctx.logger.info(`[WORKFLOW] Downloaded ${downloaded.length} file(s), total filesData: ${ctx.filesData.length}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error(`[WORKFLOW] File URL download failed: ${msg}`, undefined, err);
      await failWorkflow(ctx, new Error(`FILE_URL_DOWNLOAD_FAILED: ${msg}`));
      return;
    }
  }

  // Extract workflow name from job name.
  // Handles both formats:
  //   - Default queue:       "pipeline:workflows:disbursement [Profile]"
  //   - Worker group queue:  "pipeline.general:workflows:payroll-verify [Profile]"
  // Strategy: find the "workflows:" segment and take the token immediately after it.
  const jobName = job?.name || '';
  const workflowsIdx = jobName.indexOf('workflows:');
  const workflowName = workflowsIdx !== -1
    ? jobName.slice(workflowsIdx + 'workflows:'.length).split(/[\s:]/)[0]
    : '';

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
