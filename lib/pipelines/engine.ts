// lib/pipelines/engine.ts
// Core Pipeline Engine — runs a chain of ExternalApiConnection steps sequentially.
// v2: Local processors removed. All processing done via External API connectors.

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '@/lib/prisma';
import { runExternalApiProcessor } from '@/lib/pipelines/processors/external-api';
import { Logger } from '@/lib/logger';
import type { Job } from 'bullmq';
import { isPipelineStep } from '@/lib/pipelines/validate';
import { getStorageBackend } from '@/lib/storage';
import { LocalStorageBackend } from '@/lib/storage/local-backend';

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
  inputTokens: number;
  outputTokens: number;
  pagesProcessed: number;
  modelUsed: string;
  costUsd: number;
}

/**
 * Send a webhook notification with up to 3 attempts (exponential backoff).
 * Returns true if delivered, false if all attempts failed.
 */
async function sendWebhook(url: string, payload: object, logger: Logger): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return true;
      logger.warn(`Webhook attempt ${attempt}/3 returned HTTP ${res.status} for ${url}`);
    } catch (e) {
      logger.warn(`Webhook attempt ${attempt}/3 failed for ${url}`, undefined, e);
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  return false;
}

/**
 * Main pipeline runner. Called async after Operation is created.
 */
export async function runPipeline(operationId: string, correlationId?: string, job?: Job<any>): Promise<void> {
  const logger = new Logger({ correlationId, operationId }, job);

  const operation = await prisma.operation.findUnique({ where: { id: operationId } });
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
    await prisma.operation.update({
      where: { id: operationId },
      data: {
        done: true,
        state: 'FAILED',
        failedAtStep: 0,
        errorCode: 'PIPELINE_INVALID_JSON',
        errorMessage: clientErrorMessage,
        stepsResultJson: JSON.stringify([]),
      },
    });
    return;
  }

  // ── Download pending file_urls (deferred from async submit) ──────────────
  const jobData = job?.data as import('@/lib/queue/pipeline-queue').PipelineJobData | undefined;
  if (jobData?.pendingFileUrls && jobData.pendingFileUrls.length > 0) {
    try {
      const { downloadAllFileUrls } = await import('@/lib/file-url-downloader');
      logger.info(`[PIPELINE] Downloading ${jobData.pendingFileUrls.length} pending file URLs`);
      await prisma.operation.update({
        where: { id: operationId },
        data: { progressMessage: `Downloading ${jobData.pendingFileUrls.length} file(s) from URLs...` },
      });
      const downloaded = await downloadAllFileUrls(
        jobData.pendingFileUrls,
        operationId,
        jobData.pendingFileUrlAuthConfig,
        jobData.pendingAllowedFileExtensions,
      );
      filesData.push(...downloaded);
      // Persist updated filesJson so checkpoint/resume picks them up
      await prisma.operation.update({
        where: { id: operationId },
        data: { filesJson: JSON.stringify(filesData) },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[PIPELINE_FAILED] File URL download failed: ${msg}`, undefined, err);
      await prisma.operation.update({
        where: { id: operationId },
        data: {
          done: true,
          state: 'FAILED',
          failedAtStep: 0,
          errorCode: 'FILE_URL_DOWNLOAD_FAILED',
          errorMessage: msg,
          stepsResultJson: JSON.stringify([]),
        },
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

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let totalPages = 0;
  let lastModelUsed = '';
  const usageBreakdown: Array<{
    processor: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }> = [];

  // ── Pre-load all connections & overrides (avoid N+1 queries in the loop) ────
  const processorSlugs = pipeline.map((s) => s.processor);
  const allConnections = await prisma.externalApiConnection.findMany({
    where: { slug: { in: processorSlugs } },
  });
  const connectionMap = new Map(allConnections.map((c) => [c.slug, c]));

  const allOverrides = operation.apiKeyId && operation.endpointSlug
    ? await prisma.externalApiOverride.findMany({
        where: {
          apiKeyId: operation.apiKeyId,
          endpointSlug: operation.endpointSlug,
        },
      })
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
      await prisma.operation.update({
        where: { id: operationId },
        data: {
          currentStep: i,
          progressPercent,
          progressMessage,
        },
      });

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
      logger.info(`[STEP_COMPLETED] Processor ${connection.slug} done in ${result.costUsd > 0 ? result.costUsd + '$' : ''}`, {
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

      // Track usage
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
      totalCost += result.costUsd;
      totalPages += result.pagesProcessed;
      lastModelUsed = result.modelUsed;
      usageBreakdown.push({
        processor: ctx.processorSlug,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: result.costUsd,
      });

      // Pass output to next step
      currentText = result.content ?? (result.extractedData ? JSON.stringify(result.extractedData) : undefined);

      // Save intermediate progress
      await prisma.operation.update({
        where: { id: operationId },
        data: { stepsResultJson: JSON.stringify(stepsResult) },
      });
    }

    // Pipeline completed successfully
    const lastStep = stepsResult[stepsResult.length - 1];
    await prisma.operation.update({
      where: { id: operationId },
      data: {
        done: true,
        state: 'SUCCEEDED',
        progressPercent: 100,
        progressMessage: null,
        currentStep: pipeline.length - 1,
        outputContent: currentText,
        extractedData: lastStep?.extracted_data ? JSON.stringify(lastStep.extracted_data) : null,
        stepsResultJson: JSON.stringify(stepsResult),
        totalInputTokens,
        totalOutputTokens,
        pagesProcessed: totalPages,
        modelUsed: lastModelUsed,
        totalCostUsd: totalCost,
        usageBreakdown: JSON.stringify(usageBreakdown),
      },
    });

    // Update ApiKey.totalUsed for billing/spending limit enforcement
    if (operation.apiKeyId && totalCost > 0) {
      await prisma.apiKey.update({
        where: { id: operation.apiKeyId },
        data: { totalUsed: { increment: totalCost } },
      });
    }

    if (job) {
      await job.updateProgress(100);
    }

    // Webhook notification (with retry)
    if (operation.webhookUrl) {
      const delivered = await sendWebhook(
        operation.webhookUrl,
        { operation_id: operationId, state: 'SUCCEEDED', done: true },
        logger,
      );
      if (delivered) {
        await prisma.operation.update({
          where: { id: operationId },
          data: { webhookSentAt: new Date() },
        });
      } else {
        logger.error(`Webhook delivery failed after 3 attempts for ${operationId}`);
      }
    }

    logger.info(`[PIPELINE_COMPLETED] Operation ${operationId} completed.`, {
      pagesProcessed: totalPages,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCost,
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[PIPELINE_FAILED] Operation ${operationId} failed at step ${stepsResult.length}`, undefined, error);

    await prisma.operation.update({
      where: { id: operationId },
      data: {
        done: true,
        state: 'FAILED',
        failedAtStep: stepsResult.length,
        errorCode: 'PIPELINE_ERROR',
        errorMessage: msg,
        stepsResultJson: JSON.stringify(stepsResult),
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd: totalCost,
        usageBreakdown: JSON.stringify(usageBreakdown),
      },
    });

    if (operation.webhookUrl) {
      const delivered = await sendWebhook(
        operation.webhookUrl,
        { operation_id: operationId, state: 'FAILED', error: msg },
        logger,
      );
      if (delivered) {
        await prisma.operation.update({
          where: { id: operationId },
          data: { webhookSentAt: new Date() },
        });
      } else {
        logger.error(`Failure webhook delivery failed after 3 attempts for ${operationId}`);
      }
    }
  } finally {
    // Clean up temp files downloaded from S3 (no-op if tmpDir was never created)
    if (!isLocal) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
