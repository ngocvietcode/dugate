// lib/pipelines/engine.ts
// Core Pipeline Engine — runs a chain of ExternalApiConnection steps sequentially.
// v2: Local processors removed. All processing done via External API connectors.

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { db } from '@/lib/db';
import { operations, apiKeys, externalApiConnections, externalApiOverrides } from '@/lib/db/schema';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { runExternalApiProcessor } from '@/lib/pipelines/processors/external-api';
import { assertSafeUrl, isUrlOriginAllowed, sanitizeUrlForLogging, ssrfSafeFetch } from '@/lib/pipelines/processors/http-client';
import { Logger } from '@/lib/logger';
import { resolveCallbackDeliveryConfig, sendProfileCallback } from '@/lib/delivery/webhook-sender';
import { describeSentBody } from '@/lib/delivery/failed-payload-meta';
import { buildEncryptTransform, type BuildTransformVars } from '@/lib/crypto/build-transform';
import type { Job } from 'bullmq';
import { isPipelineStep } from '@/lib/pipelines/validate';
import { getStorageBackend } from '@/lib/storage';
import { LocalStorageBackend } from '@/lib/storage/local-backend';
import type { CostSource } from '@/lib/pricing';
import {
  canonicalPipelineResults,
  summarizeOperationUsage,
  type UsageMeasurement,
} from '@/lib/operations/operational-metadata';
import { transitionOperationState } from '@/lib/operations/state-transition';
import { ensureContentRetentionScheduled } from '@/lib/operations/content-retention';

export interface PipelineStep {
  processor: string;  // ExternalApiConnection slug
  variables?: Record<string, unknown>;
  /** Stable GUID phân biệt step khi pipeline có nhiều connector cùng slug.
   *  Sinh 1 lần khi admin thêm step, không đổi khi reorder. */
  stepId?: string;
  /** Endpoint-level: dot-path đọc session_id từ response của step này */
  captureSession?: string | null;
  /** Endpoint-level: tên form field inject session_id vào request của step này */
  injectSession?: string | null;
}

export interface ProcessorContext {
  operationId: string;
  stepIndex: number;
  totalSteps: number;
  // Input — all uploaded files
  filePaths: string[];    // Absolute paths to uploaded files on disk (or temp files from S3)
  fileNames: string[];    // Original file names
  // Remote file URLs — forwarded to connector instead of downloading
  remoteFileUrls?: string[];
  // Chained input from previous step
  inputText?: string;
  // Processor config
  processorSlug: string;
  variables: Record<string, unknown>;
  outputFormat: string;
  // Logging
  correlationId?: string;
  logger: Logger;
  /** Shared mutable state across all steps — dùng để truyền session_id,
   *  upload_id, hoặc bất kỳ token nào do external connector sinh ra. */
  pipelineState: Record<string, string>;
  /** Endpoint-level override: dot-path đọc session_id từ response (cao hơn connector-level config) */
  captureSession?: string | null;
  /** Endpoint-level override: tên form field inject session_id vào request (cao hơn connector-level config) */
  injectSession?: string | null;
}

export interface ProcessorResult {
  content?: string;           // Text/JSON output
  extractedData?: unknown;    // Structured JSON
  outputFilePath?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  pagesProcessed: number;
  modelUsed: string;
  costUsd: number | null;
  /** Where costUsd came from: provider-reported, local estimate, unpriced (needs config), or none. */
  costSource?: CostSource;
}

/**
 * Send a webhook notification with up to 3 attempts (exponential backoff).
 * Validates URL against SSRF before sending.
 * Returns true if delivered, false if all attempts failed.
 */
async function sendWebhook(url: string, payload: object, logger: Logger): Promise<boolean> {
  let targetUrl: string;
  try {
    targetUrl = await assertSafeUrl(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[WEBHOOK] Blocked unsafe webhook URL: ${msg}`);
    return false;
  }

  if (!isUrlOriginAllowed(targetUrl, process.env.ALLOWED_WEBHOOK_ORIGINS ?? '')) {
    logger.warn(`[WEBHOOK] Blocked non-allowlisted webhook origin: ${sanitizeUrlForLogging(targetUrl)}`);
    return false;
  }

  const safeUrl = sanitizeUrlForLogging(targetUrl);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await ssrfSafeFetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      await res.text().catch(() => '');
      if (res.ok) return true;
      logger.warn(`Webhook attempt ${attempt}/3 returned HTTP ${res.status} for ${safeUrl}`);
    } catch (err) {
      // The exception object goes to the internal log only. Dropping it entirely
      // left webhook failures with no diagnosable cause at all.
      logger.warn(`Webhook attempt ${attempt}/3 failed for ${safeUrl}`, undefined, err);
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  return false;
}

interface CoreCallbackDispatch {
  operation: {
    apiKeyId: string | null;
    endpointSlug: string | null;
    webhookUrl: string | null;
    /** Merged pipeline vars (JSON). Source of the per-Profile encryption_* config. */
    pipelineJson?: string | null;
  };
  operationId: string;
  state: 'SUCCEEDED' | 'FAILED';
  logger: Logger;
  extractedData?: unknown;
  outputContent?: string | null;
  errorMessage?: string | null;
  errorCode?: string | null;
  earlyFailure?: boolean;
}

/**
 * Read the merged pipeline variables persisted on the operation. These carry the
 * per-Profile encryption_* config (same source the poll/download path reads).
 */
function readCorePipelineVars(pipelineJson: string | null | undefined): BuildTransformVars {
  if (!pipelineJson) return {};
  try {
    const pipeline = JSON.parse(pipelineJson);
    const vars = pipeline?.[0]?.variables;
    return vars && typeof vars === 'object' ? (vars as BuildTransformVars) : {};
  } catch {
    return {};
  }
}

/** Chooses the opt-in Profile transport without changing the legacy sender. */
async function dispatchCoreWebhook(input: CoreCallbackDispatch): Promise<void> {
  if (!input.operation.webhookUrl) return;

  const config = await resolveCallbackDeliveryConfig(input.operation.apiKeyId);
  if (config.active) {
    // Apply the same per-Profile spec-style encryption used by the workflow
    // webhook and the poll/download responses. When encryption_enabled is off,
    // buildEncryptTransform returns undefined and the callback stays plaintext
    // (unchanged behaviour). strictPaths is enabled only on SUCCEEDED, where a
    // business result exists for selective field-paths to match; FAILED/PAUSED
    // payloads carry no result, so strict matching would wrongly reject them.
    const encryptVars = readCorePipelineVars(input.operation.pipelineJson);
    let encryptTransform;
    try {
      encryptTransform = buildEncryptTransform(encryptVars, undefined, {
        strictPaths: input.state === 'SUCCEEDED',
      });
    } catch (error: unknown) {
      // Misconfigured encryption (e.g. selective mode with no fields). Fail
      // closed: do NOT send a plaintext callback. Record the delivery failure
      // so it is visible, mirroring the poll/download encryption-error contract.
      const msg = error instanceof Error ? error.message : String(error);
      input.logger.error(`[WEBHOOK] Callback encryption misconfigured for ${input.operationId}: ${msg}`);
      await db.update(operations).set({
        webhookSentAt: null,
      }).where(eq(operations.id, input.operationId));
      return;
    }

    await sendProfileCallback({
      operationId: input.operationId,
      webhookUrl: input.operation.webhookUrl,
      config,
      logger: input.logger,
      encryptTransform,
      payloadInput: {
        mode: null,
        engine: 'core',
        operationId: input.operationId,
        state: input.state,
        extractedData: input.extractedData,
        outputContent: input.outputContent,
        errorMessage: input.errorMessage,
        errorCode: input.errorCode,
        endpointSlug: input.operation.endpointSlug,
      },
    });
    return;
  }

  // Core's two early failures intentionally have no legacy callback path.
  if (input.earlyFailure) return;

  const payload = input.state === 'SUCCEEDED'
    ? { operation_id: input.operationId, state: 'SUCCEEDED', done: true }
    : { operation_id: input.operationId, state: 'FAILED', error: input.errorMessage ?? '' };
  const delivered = await sendWebhook(input.operation.webhookUrl, payload, input.logger);
  if (delivered) {
    await db.update(operations).set({ webhookSentAt: new Date() }).where(eq(operations.id, input.operationId));
  } else {
    input.logger.error(
      `Webhook delivery failed after 3 attempts for ${input.operationId}`,
      describeSentBody(JSON.stringify(payload)),
    );
  }
}

/**
 * Main pipeline runner. Called async after Operation is created.
 */
export async function runPipeline(operationId: string, correlationId?: string, job?: Job<any>): Promise<void> {
  // Arms the hourly content-retention run in the worker process (idempotent).
  ensureContentRetentionScheduled();
  const logger = new Logger({ correlationId, operationId }, job);

  const [operation] = await db.select().from(operations).where(eq(operations.id, operationId)).limit(1);
  if (!operation) {
    logger.error(`Operation ${operationId} not found`);
    return;
  }

  let pipeline: PipelineStep[] = [];
  let filesData: Array<{ name: string; path: string; mime: string; size: number; s3Key?: string; fileCacheId?: string; isRemoteUrl?: boolean; url?: string }> = [];
  try {
    const parsedPipeline = JSON.parse(operation.pipelineJson) as unknown;
    if (!Array.isArray(parsedPipeline)) {
      throw new Error('INVALID_PIPELINE_STRUCTURE');
    }
    if (!parsedPipeline.every(isPipelineStep)) {
      throw new Error('INVALID_PIPELINE_STRUCTURE');
    }
    pipeline = parsedPipeline as PipelineStep[];

    const parsedFiles = operation.filesJson ? JSON.parse(operation.filesJson) as unknown : [];
    if (!Array.isArray(parsedFiles)) {
      throw new Error('INVALID_FILES_STRUCTURE');
    }
    filesData = parsedFiles as typeof filesData;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    const clientErrorMessage =
      msg === 'INVALID_PIPELINE_STRUCTURE'
        ? 'Invalid pipeline structure.'
        : msg === 'INVALID_FILES_STRUCTURE'
          ? 'Invalid files structure.'
          : 'Invalid pipeline payload.';
    logger.error(`[PIPELINE_FAILED] Invalid operation JSON for ${operationId}: ${msg}`, undefined, error);
    await transitionOperationState({
      operationId,
      state: 'FAILED',
      changes: {
        failedAtStep: 0,
        errorCode: 'PIPELINE_INVALID_JSON',
        errorMessage: clientErrorMessage,
        stepsResultJson: JSON.stringify([]),
      },
    });
    await dispatchCoreWebhook({
      operation,
      operationId,
      state: 'FAILED',
      logger,
      errorMessage: clientErrorMessage,
      errorCode: 'PIPELINE_INVALID_JSON',
      earlyFailure: true,
    });
    return;
  }

  // ── Download pending file_urls (deferred from async submit) ──────────────
  const jobData = job?.data as import('@/lib/queue/pipeline-queue').PipelineJobData | undefined;
  if (jobData?.pendingFileUrls && jobData.pendingFileUrls.length > 0) {
    try {
      const { downloadAllFileUrls } = await import('@/lib/file-url-downloader');
      logger.info(`[PIPELINE] Downloading ${jobData.pendingFileUrls.length} pending file URLs`);
      await db.update(operations).set({
        progressMessage: `Downloading ${jobData.pendingFileUrls.length} file(s) from URLs...`
      }).where(eq(operations.id, operationId));
      const downloaded = await downloadAllFileUrls(
        jobData.pendingFileUrls,
        operationId,
        jobData.pendingFileUrlAuthConfig,
        jobData.pendingAllowedFileExtensions,
      );
      filesData.push(...downloaded);
      // Persist updated filesJson so checkpoint/resume picks them up
      await db.update(operations).set({
        filesJson: JSON.stringify(filesData)
      }).where(eq(operations.id, operationId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[PIPELINE_FAILED] File URL download failed: ${msg}`, undefined, err);
      await transitionOperationState({
        operationId,
        state: 'FAILED',
        changes: {
          failedAtStep: 0,
          errorCode: 'FILE_URL_DOWNLOAD_FAILED',
          errorMessage: msg,
          stepsResultJson: JSON.stringify([]),
        },
      });
      await dispatchCoreWebhook({
        operation,
        operationId,
        state: 'FAILED',
        logger,
        errorMessage: msg,
        errorCode: 'FILE_URL_DOWNLOAD_FAILED',
        earlyFailure: true,
      });
      return;
    }
  }

  // ── Resolve files: S3 → temp file, local → as-is, remote URLs → separate list ──
  const backend = await getStorageBackend();
  const isLocal = backend instanceof LocalStorageBackend;
  const tmpDir = path.join(os.tmpdir(), 'dugate', operationId);
  const filePaths: string[] = [];
  const fileNames: string[] = [];
  const remoteFileUrls: string[] = [];

  // Separate remote URLs from files that need resolving
  const filesToResolve: Array<{ key: string; name: string }> = [];
  for (const f of filesData) {
    if (f.isRemoteUrl && f.url) {
      remoteFileUrls.push(f.url);
      continue;
    }
    const key = f.s3Key ?? f.path;
    if (!key) continue;
    filesToResolve.push({ key, name: f.name });
  }

  // Download files in parallel (bounded by 5) for S3 backend
  const MAX_PARALLEL_DOWNLOADS = 5;
  for (let i = 0; i < filesToResolve.length; i += MAX_PARALLEL_DOWNLOADS) {
    const batch = filesToResolve.slice(i, i + MAX_PARALLEL_DOWNLOADS);
    const results = await Promise.all(
      batch.map(async ({ key, name }) => {
        const resolved = await backend.downloadToTempFile(key, tmpDir);
        return { path: resolved.replace(/\\/g, '/'), name };
      }),
    );
    for (const r of results) {
      filePaths.push(r.path);
      fileNames.push(r.name);
    }
  }

  const stepsResult: Array<{
    step: number;
    processor: string;
    output_format: string;
    content_preview?: string | null;
    extracted_data?: unknown;
    pipeline_state_snapshot?: Record<string, string>;
  }> = [];

  let currentText: string | undefined;
  // Shared mutable state — sống trong 1 pipeline run, truyền session_id giữa các step
  const pipelineState: Record<string, string> = {};

  // ─── Checkpoint/Resume ───────────────────────────────────────────────────────
  // Nếu đây là BullMQ retry, currentStep trong DB sẽ > 0 → resume từ đó
  // tránh gọi lại external API đã thành công ở lần chạy trước (tiết kiệm chi phí)
  const resumeFromStep = operation.currentStep ?? 0;

  if (resumeFromStep > 0 && operation.stepsResultJson) {
    try {
      const completedSteps = JSON.parse(operation.stepsResultJson) as typeof stepsResult;
      // Pre-populate stepsResult với các step đã hoàn thành
      stepsResult.push(...completedSteps.slice(0, resumeFromStep));
      // Restore chained text từ output của step cuối đã hoàn thành
      const lastCompleted = completedSteps[resumeFromStep - 1];
      if (lastCompleted?.content_preview) {
        currentText = lastCompleted.content_preview;
      }
      // Restore pipelineState (session tokens) từ snapshot
      if (lastCompleted?.pipeline_state_snapshot) {
        Object.assign(pipelineState, lastCompleted.pipeline_state_snapshot);
      }
      logger.info(`[CHECKPOINT] Resuming from step ${resumeFromStep}/${pipeline.length} (skipping ${resumeFromStep} completed steps)`);
    } catch {
      logger.warn(`[CHECKPOINT] Failed to parse stepsResultJson, restarting from step 0`);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  let totalPages = 0;
  let lastModelUsed = '';
  const usageBreakdown: Array<{
    processor: string;
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
    cost_source?: CostSource;
  }> = [];
  const usageMeasurements: UsageMeasurement[] = [];

  // Chi phí đã cộng vào ApiKey.totalUsed trong lần chạy này. Chỉ cộng phần chưa tính (delta)
  // nên gọi lặp (vd. exception sau SUCCEEDED rồi rơi vào catch) không bao giờ tính 2 lần.
  let billedCostUsd = 0;
  const chargeIncurredCost = async (totalCostUsd: number): Promise<void> => {
    const delta = totalCostUsd - billedCostUsd;
    if (!operation.apiKeyId || !Number.isFinite(delta) || !(delta > 0)) return;
    await db.update(apiKeys).set({
      totalUsed: sql`${apiKeys.totalUsed} + ${delta}`
    }).where(eq(apiKeys.id, operation.apiKeyId));
    billedCostUsd += delta;
  };

  // ── Pre-load all connections & overrides (avoid N+1 queries in the loop) ────
  const processorSlugs = pipeline.map((s) => s.processor);
  const allConnections = processorSlugs.length > 0 
    ? await db.select().from(externalApiConnections).where(inArray(externalApiConnections.slug, processorSlugs))
    : [];
  const connectionMap = new Map(allConnections.map((c) => [c.slug, c]));

  const allOverrides = operation.apiKeyId && operation.endpointSlug
    ? await db.select().from(externalApiOverrides).where(and(
          eq(externalApiOverrides.apiKeyId, operation.apiKeyId),
          eq(externalApiOverrides.endpointSlug, operation.endpointSlug)
        ))
    : [];
  // Key: `${connectionId}:${stepId}`
  const overrideMap = new Map(allOverrides.map((o) => [`${o.connectionId}:${o.stepId}`, o]));
  // ─────────────────────────────────────────────────────────────────────────────

  try {
    for (let i = resumeFromStep; i < pipeline.length; i++) {
      const step = pipeline[i];

      const progressPercent = Math.round((i / pipeline.length) * 100);
      const progressMessage = `Đang xử lý bước ${i + 1}/${pipeline.length}: ${step.processor}...`;

      // Update progress in DB
      await db.update(operations).set({
        currentStep: i,
        progressPercent,
        progressMessage,
      }).where(eq(operations.id, operationId));

      // Update progress in BullMQ
      if (job) {
        await job.updateProgress(progressPercent);
      }

      const variables = step.variables ?? {};

      // Inject chained text from previous step
      if (currentText) {
        variables['input_content'] = currentText;
      }

      // Look up pre-loaded ExternalApiConnection
      const connection = connectionMap.get(step.processor);
      if (!connection) {
        throw new Error(`ExternalApiConnection '${step.processor}' not found in database.`);
      }
      if (connection.state !== 'ENABLED') {
        throw new Error(`ExternalApiConnection '${connection.slug}' is DISABLED.`);
      }

      // Look up pre-loaded per-client, per-endpoint, per-step prompt override
      const resolvedStepId = step.stepId ?? '_default';
      const extOverride = overrideMap.get(`${connection.id}:${resolvedStepId}`) ?? null;

      if (extOverride) {
        logger.info(`Applied ExtApiOverride for '${connection.slug}' step='${resolvedStepId}' (key: ${operation.apiKeyId})`);
      }

      const ctx: ProcessorContext = {
        operationId,
        stepIndex: i,
        totalSteps: pipeline.length,
        filePaths: i === 0 ? filePaths : [],   // Only first step gets original files
        fileNames: i === 0 ? fileNames : [],
        remoteFileUrls: i === 0 ? remoteFileUrls : [],
        inputText: currentText,
        processorSlug: connection.slug,
        variables,
        outputFormat: operation.outputFormat,
        correlationId,
        logger,
        pipelineState,  // Cùng 1 object reference → step sau thấy ngay giá trị step trước ghi
        // Endpoint-level session override (priority over connector-level DB config)
        captureSession: step.captureSession,
        injectSession: step.injectSession,
      };

      logger.info(`[STEP_STARTED] Starting processor ${connection.slug}`);
      const result = await runExternalApiProcessor(ctx, connection, extOverride);
      logger.info(`[STEP_COMPLETED] Processor ${connection.slug} done in ${(result.costUsd ?? 0) > 0 ? result.costUsd + '$' : ''}`, {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });

      // Record step result (include pipeline_state_snapshot để restore khi retry)
      stepsResult.push({
        step: i,
        processor: ctx.processorSlug,
        output_format: operation.outputFormat,
        content_preview: result.content ? result.content.substring(0, 500) : null,
        extracted_data: result.extractedData,
        pipeline_state_snapshot: Object.keys(pipelineState).length > 0 ? { ...pipelineState } : undefined,
      });

      // Keep nullable source measurements intact in the breakdown. Numeric totals are
      // normalized only when constructing the Operation aggregate below.
      usageMeasurements.push({
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        costSource: result.costSource,
      });
      totalPages += result.pagesProcessed;
      lastModelUsed = result.modelUsed;
      usageBreakdown.push({
        processor: ctx.processorSlug,
        model: result.modelUsed,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: result.costUsd,
        cost_source: result.costSource,
      });

      // Pass output to next step
      currentText = result.content ?? (result.extractedData ? JSON.stringify(result.extractedData) : undefined);

      // Save intermediate progress
      await db.update(operations).set({
        stepsResultJson: JSON.stringify(stepsResult)
      }).where(eq(operations.id, operationId));
    }

    // Pipeline completed successfully
    const lastStep = stepsResult[stepsResult.length - 1];
    const usage = summarizeOperationUsage(usageMeasurements);
    const canonicalResults = canonicalPipelineResults(operation.endpointSlug, true);
    await transitionOperationState({
      operationId,
      state: 'SUCCEEDED',
      changes: {
        progressPercent: 100,
        progressMessage: null,
        currentStep: pipeline.length - 1,
        outputContent: currentText,
        extractedData: lastStep?.extracted_data ? JSON.stringify(lastStep.extracted_data) : null,
        stepsResultJson: JSON.stringify(stepsResult),
        totalInputTokens: usage.totalInputTokens,
        totalOutputTokens: usage.totalOutputTokens,
        inputTokensMissing: usage.inputTokensMissing,
        outputTokensMissing: usage.outputTokensMissing,
        pagesProcessed: totalPages,
        modelUsed: lastModelUsed,
        totalCostUsd: usage.totalCostUsd,
        costMissing: usage.costMissing,
        hasUnpricedCost: usage.hasUnpricedCost,
        logicResult: canonicalResults.logicResult,
        extractionResult: canonicalResults.extractionResult,
        usageBreakdown: JSON.stringify(usageBreakdown),
      },
    });

    // Update ApiKey.totalUsed for billing/spending limit enforcement
    await chargeIncurredCost(usage.totalCostUsd);

    if (job) {
      await job.updateProgress(100);
    }

    // Webhook notification selects the Profile transport only when configured.
    await dispatchCoreWebhook({
      operation,
      operationId,
      state: 'SUCCEEDED',
      logger,
      extractedData: lastStep?.extracted_data,
      outputContent: currentText,
    });

    logger.info(`[PIPELINE_COMPLETED] Operation ${operationId} completed.`, {
      pagesProcessed: totalPages,
      inputTokens: usage.totalInputTokens,
      outputTokens: usage.totalOutputTokens,
      costUsd: usage.totalCostUsd,
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const usage = summarizeOperationUsage(usageMeasurements);
    const canonicalResults = canonicalPipelineResults(operation.endpointSlug, false);
    logger.error(`[PIPELINE_FAILED] Operation ${operationId} failed at step ${stepsResult.length}`, undefined, error);

    await transitionOperationState({
      operationId,
      state: 'FAILED',
      changes: {
        failedAtStep: stepsResult.length,
        errorCode: 'PIPELINE_ERROR',
        errorMessage: msg,
        stepsResultJson: JSON.stringify(stepsResult),
        totalInputTokens: usage.totalInputTokens,
        totalOutputTokens: usage.totalOutputTokens,
        inputTokensMissing: usage.inputTokensMissing,
        outputTokensMissing: usage.outputTokensMissing,
        totalCostUsd: usage.totalCostUsd,
        costMissing: usage.costMissing,
        hasUnpricedCost: usage.hasUnpricedCost,
        logicResult: canonicalResults.logicResult,
        extractionResult: canonicalResults.extractionResult,
        usageBreakdown: JSON.stringify(usageBreakdown),
      },
    });

    // FAILED cũng tính chi phí đã phát sinh (chỉ phần đã biết). Lỗi billing không được
    // throw: BullMQ sẽ retry và chạy lại các step đã trả tiền.
    if (usage.costMissing || usage.hasUnpricedCost) {
      logger.warn(`[BILLING] ${operationId} failed with unknown/unpriced cost; charging known part only`, {
        knownCostUsd: usage.totalCostUsd,
        costMissing: usage.costMissing,
        hasUnpricedCost: usage.hasUnpricedCost,
      });
    }
    try {
      await chargeIncurredCost(usage.totalCostUsd);
    } catch (billingError: unknown) {
      logger.error(`[BILLING] Failed to charge ${usage.totalCostUsd} USD for ${operationId}`, undefined, billingError);
    }

    await dispatchCoreWebhook({
      operation,
      operationId,
      state: 'FAILED',
      logger,
      errorMessage: msg,
      errorCode: 'PIPELINE_ERROR',
    });
  } finally {
    // Clean up temp files downloaded from S3 (no-op if tmpDir was never created)
    if (!isLocal) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
