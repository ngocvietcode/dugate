// lib/pipelines/submit.ts
// Core submit logic: validate connectors, save files, create Operation,
// then enqueue job to BullMQ Worker (async) or wait for result (sync).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { type PipelineStep } from '@/lib/pipelines/engine';
import { saveUploadedFile } from '@/lib/upload-helper';
import { downloadAllFileUrls, type FileUrlEntry, type FileUrlAuthConfig, type DownloadedFile } from '@/lib/file-url-downloader';
import { getStorageBackend } from '@/lib/storage';
import { Logger } from '@/lib/logger';
import {
  getPipelineQueue,
  getPipelineQueueEvents,
  SYNC_TIMEOUT_MS,
  type PipelineJobData,
} from '@/lib/queue/pipeline-queue';

const logger = new Logger({ service: 'submit-pipeline' });

// ─── Priority helpers ─────────────────────────────────────────────────────────

/** Map ProfileEndpoint.jobPriority string → BullMQ priority number (lower = higher priority) */
function resolveBullPriority(jobPriority?: string | null): number {
  switch (jobPriority) {
    case 'HIGH':   return 1;
    case 'LOW':    return 20;
    default:       return 10; // MEDIUM or undefined
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubmitPipelineParams {
  pipeline: PipelineStep[];
  files?: File[];             // Optional: 1 or many files (some endpoints work text-only)
  fileUrls?: FileUrlEntry[];  // Optional: remote file URLs to download and process
  fileUrlAuthConfig?: FileUrlAuthConfig; // Optional: auth config for downloading file URLs
  allowedFileExtensions?: string; // Optional: overridden allowed file extensions from profile
  endpointSlug?: string;      // "extract:invoice", "analyze:fact-check", etc.
  outputFormat?: string;
  webhookUrl?: string | null;
  idempotencyKey?: string;
  apiKeyId?: string;
  userId?: string;
  executeSync?: boolean;
  correlationId?: string;
  /** Override DISABLE_HISTORY env — set false to keep operation visible for polling */
  disableHistory?: boolean;
}

export type SubmitPipelineResult =
  | { ok: false; errorResponse: NextResponse }
  | { ok: true; operation: any; isIdempotent: boolean };

// ─── Core submit function ─────────────────────────────────────────────────────

export async function submitPipelineJob(
  params: SubmitPipelineParams,
): Promise<SubmitPipelineResult> {
  const {
    pipeline,
    files,
    fileUrls,
    fileUrlAuthConfig,
    allowedFileExtensions,
    endpointSlug,
    outputFormat = 'json',
    webhookUrl,
    idempotencyKey,
    apiKeyId,
    userId,
    executeSync = false,
    correlationId,
  } = params;

  // ── 1. Basic pipeline validation ─────────────────────────────────────────
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: 'https://dugate.vn/errors/empty-pipeline', title: 'Empty Pipeline', status: 400, detail: 'Pipeline must have at least 1 step.' },
        { status: 400 },
      ),
    };
  }

  if (pipeline.length > 5) {
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: 'https://dugate.vn/errors/pipeline-too-long', title: 'Pipeline Too Long', status: 422, detail: `Pipeline has ${pipeline.length} steps. Maximum is 5.` },
        { status: 422 },
      ),
    };
  }

  // ── 2. Validate each connector in DB ─────────────────────────────────────
  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i];
    const conn = await prisma.externalApiConnection.findUnique({
      where: { slug: step.processor },
    });

    if (!conn) {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { type: 'https://dugate.vn/errors/connector-not-found', title: 'Connector Not Found', status: 404, detail: `Connector '${step.processor}' in step ${i} does not exist.` },
          { status: 404 },
        ),
      };
    }

    if (conn.state !== 'ENABLED') {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { type: 'https://dugate.vn/errors/connector-disabled', title: 'Connector Disabled', status: 422, detail: `Connector '${step.processor}' is currently DISABLED.` },
          { status: 422 },
        ),
      };
    }
  }

  // ── 3. Idempotency check ──────────────────────────────────────────────────
  if (idempotencyKey) {
    const existing = await prisma.operation.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return { ok: true, operation: existing, isIdempotent: true };
    }
  }

  // ── 3b. Spending limit check ──────────────────────────────────────────────
  if (apiKeyId) {
    const key = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { spendingLimit: true, totalUsed: true },
    });
    if (key && key.spendingLimit > 0 && key.totalUsed >= key.spendingLimit) {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          {
            type: 'https://dugate.vn/errors/spending-limit-exceeded',
            title: 'Payment Required',
            status: 402,
            detail: `API key spending limit of $${key.spendingLimit.toFixed(2)} USD has been reached.`,
          },
          { status: 402 },
        ),
      };
    }
  }

  // ── 4. Resolve BullMQ job priority from ProfileEndpoint ──────────────────
  let bullPriority = 10; // default MEDIUM
  if (apiKeyId && endpointSlug) {
    const profileEndpoint = await prisma.profileEndpoint.findUnique({
      where: { apiKeyId_endpointSlug: { apiKeyId, endpointSlug } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: { jobPriority: true } as any,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bullPriority = resolveBullPriority((profileEndpoint as any)?.jobPriority);
  }

  // ── 4. Save uploaded files via storage backend ──────────────────────────
  const MAX_TOTAL_SIZE = parseInt(process.env.MAX_TOTAL_UPLOAD_SIZE ?? String(1024 * 1024 * 1024), 10); // 1GB default
  const operationId = crypto.randomUUID();
  const filesData: Array<DownloadedFile & { url?: string; isRemoteUrl?: boolean }> = [];
  const backend = await getStorageBackend();

  for (const file of (files ?? [])) {
    let saved;
    try {
      saved = await saveUploadedFile(file, operationId, undefined, allowedFileExtensions);
    } catch (uploadErr: unknown) {
      const uploadMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
      const errName = uploadErr instanceof Error ? (uploadErr as any).name ?? '' : '';
      const httpStatus = (uploadErr as any)?.$metadata?.httpStatusCode;
      const isStorageConfig =
        uploadMsg.includes('NoSuchBucket') ||
        uploadMsg.includes('does not exist') ||
        uploadMsg.includes('Access Denied') ||
        errName === 'NoSuchBucket' ||
        httpStatus === 404 ||
        httpStatus === 403;
      return {
        ok: false,
        errorResponse: NextResponse.json(
          {
            type: 'https://dugate.vn/errors/storage-error',
            title: 'Storage Error',
            status: isStorageConfig ? 503 : 500,
            detail: isStorageConfig
              ? `Storage backend is misconfigured or unavailable: ${uploadMsg}`
              : `Failed to save uploaded file: ${uploadMsg}`,
          },
          { status: isStorageConfig ? 503 : 500 },
        ),
      };
    }
    filesData.push({
      name: file.name,
      path: saved.path,
      mime: file.type || 'application/octet-stream',
      size: saved.size,
      fileCacheId: saved.fileCacheId,
      s3Key: saved.s3Key,
      md5: saved.md5,
    });
  }

  // Check total size of all uploaded files
  const totalUploadSize = filesData.reduce((sum, f) => sum + f.size, 0);
  if (totalUploadSize > MAX_TOTAL_SIZE) {
    for (const f of filesData) {
      await backend.delete(f.s3Key ?? f.path).catch(() => {});
    }
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: 'https://dugate.vn/errors/total-size-exceeded', title: 'Total Upload Size Exceeded', status: 413, detail: `Total upload size ${(totalUploadSize / 1024 / 1024).toFixed(1)}MB exceeds maximum of ${(MAX_TOTAL_SIZE / 1024 / 1024).toFixed(0)}MB.` },
        { status: 413 },
      ),
    };
  }

  // ── 4b. Handle file_urls ───────────────────────────────────────────────
  const hasPendingFileUrls = fileUrls && fileUrls.length > 0;

  // Check if first pipeline step's connector supports URL forwarding
  // (fileUrlFieldName set → forward URLs to connector, skip download/cache)
  let forwardUrls = false;
  if (hasPendingFileUrls && pipeline.length > 0) {
    const firstConn = await prisma.externalApiConnection.findUnique({
      where: { slug: pipeline[0].processor },
    });
    if (firstConn?.fileUrlFieldName) {
      forwardUrls = true;
      // Store URLs as remote references — no download needed
      for (const entry of fileUrls) {
        filesData.push({
          name: entry.filename?.trim() || entry.url,
          path: '',
          mime: entry.mime_type?.trim() || '',
          size: 0,
          url: entry.url,
          isRemoteUrl: true,
        });
      }
    }
  }

  // Download file_urls if not forwarding
  if (hasPendingFileUrls && !forwardUrls) {
    if (executeSync) {
      // Sync mode: download now (client is waiting anyway)
      try {
        const downloaded = await downloadAllFileUrls(fileUrls, operationId, fileUrlAuthConfig, allowedFileExtensions);
        filesData.push(...downloaded);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          errorResponse: NextResponse.json(
            { type: 'https://dugate.vn/errors/file-url-download-failed', title: 'File URL Download Failed', status: 422, detail: msg },
            { status: 422 },
          ),
        };
      }
    }
    // Async mode: deferred to worker (handled in jobData below)
  }

  // ── 6. Create Operation in DB ─────────────────────────────────────────────
  // When DISABLE_HISTORY=true, soft-delete immediately so it won't appear in history queries
  const disableHistory = params.disableHistory ?? (process.env.DISABLE_HISTORY === 'true');

  let operation: any;
  try {
    operation = await prisma.operation.create({
      data: {
        id:              operationId,
        apiKeyId:        apiKeyId || null,
        createdByUserId: userId || null,
        idempotencyKey:  idempotencyKey || null,
        endpointSlug:    endpointSlug || null,
        pipelineJson:    JSON.stringify(pipeline),
        filesJson:       filesData.length > 0 ? JSON.stringify(filesData) : null,
        outputFormat,
        webhookUrl:      webhookUrl ?? null,
        state:           'RUNNING',
        done:            false,
        progressPercent: 0,
        progressMessage: 'Initializing pipeline...',
        deletedAt:       disableHistory ? new Date() : null,
      },
    });
  } catch (createErr: unknown) {
    // Handle idempotency race: two concurrent requests with the same key may both pass the
    // findUnique check above, but the DB unique constraint ensures only one succeeds.
    // The loser gets a unique constraint violation — resolve it by returning the winner's record.
    const isUniqueViolation =
      createErr instanceof Error &&
      'code' in createErr &&
      (createErr as { code?: string }).code === 'P2002';

    if (isUniqueViolation && idempotencyKey) {
      const existing = await prisma.operation.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return { ok: true, operation: existing, isIdempotent: true };
      }
    }
    throw createErr;
  }

  // ── 7. Enqueue to BullMQ Worker ────────────────────────────────────────────
  const queue = getPipelineQueue();
  const jobName = `pipeline:${endpointSlug ?? 'unknown'}`;
  const isWorkflowJob = endpointSlug?.startsWith('workflows:') ?? false;
  const jobData: PipelineJobData = {
    operationId,
    correlationId,
    type: isWorkflowJob ? 'workflow' : 'pipeline',
    // Deferred file_urls for async mode — worker will download before running pipeline
    // Skip if URLs are being forwarded (already stored in filesJson as isRemoteUrl)
    ...(hasPendingFileUrls && !executeSync && !forwardUrls ? {
      pendingFileUrls: fileUrls,
      pendingFileUrlAuthConfig: fileUrlAuthConfig,
      pendingAllowedFileExtensions: allowedFileExtensions,
    } : {}),
  };

  // Backpressure: reject new jobs when queue is too deep to avoid unbounded growth
  const MAX_QUEUE_DEPTH = parseInt(process.env.MAX_QUEUE_DEPTH || '500', 10);
  const counts = await queue.getJobCounts('waiting', 'delayed');
  const queueDepth = (counts.waiting ?? 0) + (counts.delayed ?? 0);
  if (queueDepth > MAX_QUEUE_DEPTH) {
    // Clean up the operation we just created
    await prisma.operation.delete({ where: { id: operationId } });
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: 'https://dugate.vn/errors/queue-full', title: 'Service Unavailable', status: 503, detail: 'Queue is at capacity. Please retry later.' },
        { status: 503, headers: { 'Retry-After': '30' } },
      ),
    };
  }

  if (executeSync) {
    // ── SYNC MODE: enqueue then wait for Worker to finish ──
    // Does NOT run pipeline in Next.js process — Worker process handles it.
    // Uses Redis pub/sub via QueueEvents so Next.js event loop is NOT blocked.
    const job = await queue.add(jobName, jobData, { priority: bullPriority });
    const queueEvents = getPipelineQueueEvents();

    try {
      await job.waitUntilFinished(queueEvents, SYNC_TIMEOUT_MS);
    } catch {
      // Timeout or job failed — Worker has already updated operation state in DB
      logger.warn(`[submitPipelineJob] Sync wait timed out or failed for ${operationId}`);
    }

    // Reload to get the latest state written by Worker
    operation = (await prisma.operation.findUnique({ where: { id: operationId } }))!;

  } else {
    // ── ASYNC MODE: enqueue and return 202 immediately ──
    await queue.add(jobName, jobData, { priority: bullPriority });
  }

  return { ok: true, operation, isIdempotent: false };
}

