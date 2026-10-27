// lib/pipelines/submit.ts
// Core submit logic: validate connectors, save files, create Operation,
// then enqueue job to BullMQ Worker (async) or wait for result (sync).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiKeys, externalApiConnections, operations, profileEndpoints } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { type PipelineStep } from '@/lib/pipelines/engine';
import { saveUploadedFile, sanitizeFilename, type SavedFile } from '@/lib/upload-helper';
import {
  downloadAllFileUrls,
  releaseDownloadedFileReferences,
  type FileUrlEntry,
  type FileUrlAuthConfig,
  type DownloadedFile,
} from '@/lib/file-url-downloader';
import { Logger } from '@/lib/logger';
import {
  SYNC_TIMEOUT_MS,
  type PipelineJobData,
} from '@/lib/queue/pipeline-queue';
import { resolveTargetQueue, selectWorkflowQueue, checkBackpressure, getOrCreateQueueEvents } from '@/lib/queue/worker-group-router';
import { BASE_TYPE_URI } from '@/lib/errors';
import {
  insertOperation,
  transitionOperationState,
} from '@/lib/operations/state-transition';

const logger = new Logger({ service: 'submit-pipeline' });

/** Số file upload lên storage đồng thời cho một lần nộp (mỗi file là một stream S3 + một lần ghi FileCache). */
const UPLOAD_CONCURRENCY = Math.max(1, parseInt(process.env.SUBMIT_UPLOAD_CONCURRENCY ?? '4', 10) || 4);

/**
 * Chạy `fn` cho từng phần tử với tối đa `limit` tác vụ đồng thời, giữ nguyên thứ tự kết quả. Sau lỗi đầu tiên không bắt đầu thêm
 * tác vụ mới (phần tử chưa chạy có kết quả `undefined`); tác vụ đang chạy vẫn được đợi để biết file nào đã lưu mà giải phóng.
 */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<Array<PromiseSettledResult<R> | undefined>> {
  const results: Array<PromiseSettledResult<R> | undefined> = new Array(items.length).fill(undefined);
  let next = 0;
  let failed = false;
  const run = async (): Promise<void> => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        failed = true;
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

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
  /** Pre-resolved ApiKey record (from runner) — avoids a redundant spending-limit query. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiKeyRecord?: any;
  /** Pre-resolved ProfileEndpoint (from runner) — avoids a redundant jobPriority query.
   *  `null` means "resolved, no profile"; `undefined` means "not provided → query". */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profileEndpoint?: any;
  userId?: string;
  executeSync?: boolean;
  correlationId?: string;
  /** Client reference extracted from request body per profile config (for ops search) */
  clientReference?: string | null;
  /** Override DISABLE_HISTORY env — set false to keep operation visible for polling */
  disableHistory?: boolean;
}

export type SubmitPipelineResult =
  | { ok: false; errorResponse: NextResponse }
  | { ok: true; operation: any; isIdempotent: boolean; /** Thời gian (ms) từng bước trước khi trả response; không chứa dữ liệu hồ sơ. */ timings?: Record<string, number> };

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
    apiKeyRecord,
    profileEndpoint: passedProfileEndpoint,
    userId,
    executeSync = false,
    correlationId,
    clientReference,
  } = params;

  // Đo từng bước (ms) để chỉ ra chỗ chậm của request nộp hồ sơ. Chỉ số liệu thời gian và số đếm, không có nội dung hồ sơ.
  const timings: Record<string, number> = {};
  let lap = Date.now();
  const lapMark = (name: string): void => { const now = Date.now(); timings[name] = now - lap; lap = now; };

  // ── 1. Basic pipeline validation ─────────────────────────────────────────
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: `${BASE_TYPE_URI}/empty-pipeline`, title: 'Empty Pipeline', status: 400, detail: 'Pipeline must have at least 1 step.' },
        { status: 400 },
      ),
    };
  }

  if (pipeline.length > 5) {
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: `${BASE_TYPE_URI}/pipeline-too-long`, title: 'Pipeline Too Long', status: 422, detail: `Pipeline has ${pipeline.length} steps. Maximum is 5.` },
        { status: 422 },
      ),
    };
  }

  // ── 2. Validate each connector in DB ─────────────────────────────────────
  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i];
    const [conn] = await db.select().from(externalApiConnections)
      .where(eq(externalApiConnections.slug, step.processor))
      .limit(1);

    if (!conn) {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { type: `${BASE_TYPE_URI}/connector-not-found`, title: 'Connector Not Found', status: 404, detail: `Connector '${step.processor}' in step ${i} does not exist.` },
          { status: 404 },
        ),
      };
    }

    if (conn.state !== 'ENABLED') {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { type: `${BASE_TYPE_URI}/connector-disabled`, title: 'Connector Disabled', status: 422, detail: `Connector '${step.processor}' is currently DISABLED.` },
          { status: 422 },
        ),
      };
    }
  }

  lapMark('connectors');

  // ── 3. Idempotency check ──────────────────────────────────────────────────
  if (idempotencyKey) {
    const [existing] = await db.select().from(operations).where(eq(operations.idempotencyKey, idempotencyKey)).limit(1);
    if (existing) {
      return { ok: true, operation: existing, isIdempotent: true };
    }
  }

  // ── 3b. Spending limit check ──────────────────────────────────────────────
  let profileName = 'Unknown Profile';
  if (apiKeyId) {
    // Reuse the ApiKey record resolved by the runner when available; only query as fallback
    // (e.g. for internal callers like the workflow engine that don't pre-resolve it).
    let key = apiKeyRecord !== undefined ? apiKeyRecord : null;
    if (!key) {
      const [fetched] = await db.select({ spendingLimit: apiKeys.spendingLimit, totalUsed: apiKeys.totalUsed, name: apiKeys.name })
        .from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1);
      key = fetched ?? null;
    }

    if (key) {
      profileName = key.name;
    }

    if (key && key.spendingLimit > 0 && key.totalUsed >= key.spendingLimit) {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          {
            type: `${BASE_TYPE_URI}/spending-limit-exceeded`,
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
    if (passedProfileEndpoint !== undefined) {
      // Reuse the ProfileEndpoint resolved by the runner (null = no profile → default priority)
      bullPriority = resolveBullPriority(passedProfileEndpoint?.jobPriority);
    } else {
      const [profileEndpoint] = await db.select({ jobPriority: profileEndpoints.jobPriority })
        .from(profileEndpoints)
        .where(and(eq(profileEndpoints.apiKeyId, apiKeyId), eq(profileEndpoints.endpointSlug, endpointSlug)))
        .limit(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bullPriority = resolveBullPriority((profileEndpoint as any)?.jobPriority);
    }
  }

  lapMark('profile_checks');

  // ── 5. Save uploaded files via storage backend ──────────────────────────
  const MAX_TOTAL_SIZE = parseInt(process.env.MAX_TOTAL_UPLOAD_SIZE ?? String(1024 * 1024 * 1024), 10); // 1GB default
  const operationId = crypto.randomUUID();
  const filesData: Array<DownloadedFile & { url?: string; isRemoteUrl?: boolean }> = [];
  let acquiredReferencesReleased = false;

  // Every saved/downloaded file with a fileCacheId owns one refCount increment.
  // Rollback must decrement those references, never delete the canonical storage key
  // directly because it may be shared by another operation.
  const releaseAcquiredFileReferences = async (): Promise<void> => {
    if (acquiredReferencesReleased) return;
    await releaseDownloadedFileReferences(filesData, { bestEffort: false });
    acquiredReferencesReleased = true;
  };

  // Once an Operation exists, retain it as the durable owner of its file references.
  // Mark a definitively unqueued submission terminal instead of hard-deleting the row;
  // cleanup can then recover/release its files even if an immediate DB action fails.
  const markUnqueuedOperationFailed = async (): Promise<void> => {
    try {
      await transitionOperationState({
        operationId,
        state: 'FAILED',
        changes: {
          failedAtStep: 0,
          errorCode: 'QUEUE_SUBMISSION_FAILED',
          errorMessage: 'Pipeline job could not be queued. Please retry with a new request.',
          stepsResultJson: JSON.stringify([]),
        },
      });
    } catch (rollbackErr: unknown) {
      const msg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      logger.error(`[submitPipelineJob] Failed to mark unqueued operation ${operationId} as FAILED: ${msg}`);
    }
  };

  // Upload song song (giới hạn UPLOAD_CONCURRENCY): trước đây từng file đợi file trước xong, mỗi file gồm cả upload S3 lẫn ghi FileCache,
  // nên request nộp hồ sơ nhiều file chậm tuyến tính theo số file. Thứ tự `filesData` vẫn theo thứ tự file gửi lên.
  const toSave = files ?? [];
  const uploads = await mapLimit(toSave, UPLOAD_CONCURRENCY, (file) => saveUploadedFile(file, operationId, undefined, allowedFileExtensions));
  let uploadErr: unknown;
  let uploadFailed = false;
  toSave.forEach((file, i) => {
    const outcome = uploads[i];
    if (outcome?.status === 'fulfilled') {
      const saved: SavedFile = outcome.value;
      filesData.push({
        name: sanitizeFilename(file.name),
        path: saved.path,
        mime: file.type || 'application/octet-stream',
        size: saved.size,
        fileCacheId: saved.fileCacheId,
        s3Key: saved.s3Key,
        md5: saved.md5,
      });
    } else if (outcome?.status === 'rejected' && !uploadFailed) {
      uploadFailed = true;
      uploadErr = outcome.reason;
    }
  });
  if (uploadFailed) {
    // Giải phóng cả file đã lưu thành công của lần nộp này. Khóa lưu trữ chuẩn có thể dùng chung nên không xoá trực tiếp.
    await releaseAcquiredFileReferences();
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
          type: `${BASE_TYPE_URI}/storage-error`,
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
  lapMark('upload_files');
  // Check total size of all uploaded files
  const totalUploadSize = filesData.reduce((sum, f) => sum + f.size, 0);
  if (totalUploadSize > MAX_TOTAL_SIZE) {
    await releaseAcquiredFileReferences();
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: `${BASE_TYPE_URI}/total-size-exceeded`, title: 'Total Upload Size Exceeded', status: 413, detail: `Total upload size ${(totalUploadSize / 1024 / 1024).toFixed(1)}MB exceeds maximum of ${(MAX_TOTAL_SIZE / 1024 / 1024).toFixed(0)}MB.` },
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
    const [firstConn] = await db.select().from(externalApiConnections)
      .where(eq(externalApiConnections.slug, pipeline[0].processor)).limit(1);
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
        // downloadAllFileUrls releases its own partial downloads. Release any direct
        // uploads acquired before that call as part of this submission rollback.
        await releaseAcquiredFileReferences();
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          errorResponse: NextResponse.json(
            { type: `${BASE_TYPE_URI}/file-url-download-failed`, title: 'File URL Download Failed', status: 422, detail: msg },
            { status: 422 },
          ),
        };
      }
    }
    // Async mode: deferred to worker (handled in jobData below)
  }

  lapMark('file_urls');

  // ── 6. Create Operation in DB ─────────────────────────────────────────────
  // When DISABLE_HISTORY=true, soft-delete immediately so it won't appear in history queries.
  // Note: disableHistory only applies when explicitly set via env or param.
  // Operations without apiKeyId are still visible (for operations monitoring).
  const disableHistory = params.disableHistory ?? (process.env.DISABLE_HISTORY === 'true');

  let operation: any;
  try {
    operation = await insertOperation({
      id:              operationId,
      apiKeyId:        apiKeyId || null,
      createdByUserId: userId || null,
      idempotencyKey:  idempotencyKey || null,
      correlationId:   correlationId || null,
      clientReference: clientReference || null,
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
    });
  } catch (createErr: unknown) {
    // Handle idempotency race: two concurrent requests with the same key may both pass the
    // findUnique check above, but the DB unique constraint ensures only one succeeds.
    // The loser gets a unique constraint violation — resolve it by returning the winner's record.
    const isUniqueViolation =
      createErr instanceof Error &&
      'code' in createErr &&
      (createErr as { code?: string }).code === '23505';

    if (isUniqueViolation && idempotencyKey) {
      const [existing] = await db.select().from(operations).where(eq(operations.idempotencyKey, idempotencyKey)).limit(1);
      if (existing) {
        await releaseAcquiredFileReferences();
        return { ok: true, operation: existing, isIdempotent: true };
      }
    }
    await releaseAcquiredFileReferences();
    throw createErr;
  }

  lapMark('create_operation');

  // ── 7. Enqueue to BullMQ Worker ────────────────────────────────────────────
  // Resolve target queue based on profile's workerGroup assignment
  let routeResult;
  try {
    routeResult = await resolveTargetQueue(apiKeyId);
  } catch (routeErr: unknown) {
    // DB connection failure during workerGroup lookup → 503
    await markUnqueuedOperationFailed();
    const msg = routeErr instanceof Error ? routeErr.message : String(routeErr);
    logger.error(`[submitPipelineJob] Failed to resolve target queue: ${msg}`);
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: `${BASE_TYPE_URI}/service-unavailable`, title: 'Service Unavailable', status: 503, detail: 'Unable to determine target queue. Please retry later.' },
        { status: 503, headers: { 'Retry-After': '5', 'X-Operation-ID': operationId, 'Operation-Location': `/api/v1/operations/${operationId}` } },
      ),
    };
  }

  lapMark('resolve_queue');
  const isWorkflowJob = endpointSlug?.startsWith('workflows:') ?? false;
  // Job workflow sang queue workflow riêng (WORKFLOW-SUSPEND-DESIGN phương án A); chưa có worker nghe thì về queue pipeline.
  const { queue, queueName } = isWorkflowJob ? await selectWorkflowQueue(routeResult) : routeResult;
  const jobName = apiKeyId ? `${queueName}:${endpointSlug ?? 'unknown'} [${profileName}]` : `${queueName}:${endpointSlug ?? 'unknown'}`;
  const jobData: PipelineJobData = {
    operationId,
    correlationId,
    type: isWorkflowJob ? 'workflow' : 'pipeline',
    profileName: apiKeyId ? profileName : undefined,
    // Deferred file_urls for async mode — worker will download before running pipeline
    // Skip if URLs are being forwarded (already stored in filesJson as isRemoteUrl)
    ...(hasPendingFileUrls && !executeSync && !forwardUrls ? {
      pendingFileUrls: fileUrls,
      pendingFileUrlAuthConfig: fileUrlAuthConfig,
      pendingAllowedFileExtensions: allowedFileExtensions,
    } : {}),
  };

  // Backpressure: reject new jobs when target queue is too deep. A Redis error here
  // means no enqueue was attempted, so the operation can be marked terminal safely.
  let isOverCapacity: boolean;
  try {
    isOverCapacity = await checkBackpressure(queue);
  } catch (backpressureErr: unknown) {
    await markUnqueuedOperationFailed();
    const msg = backpressureErr instanceof Error ? backpressureErr.message : String(backpressureErr);
    logger.error(`[submitPipelineJob] Failed to inspect queue ${queueName}: ${msg}`);
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: `${BASE_TYPE_URI}/service-unavailable`, title: 'Service Unavailable', status: 503, detail: 'Unable to inspect pipeline queue capacity. Please retry later.' },
        { status: 503, headers: { 'Retry-After': '5', 'X-Operation-ID': operationId, 'Operation-Location': `/api/v1/operations/${operationId}` } },
      ),
    };
  }
  lapMark('backpressure');
  if (isOverCapacity) {
    await markUnqueuedOperationFailed();
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: `${BASE_TYPE_URI}/queue-full`, title: 'Service Unavailable', status: 503, detail: 'Queue is at capacity. Please retry later.' },
        { status: 503, headers: { 'Retry-After': '30', 'X-Operation-ID': operationId, 'Operation-Location': `/api/v1/operations/${operationId}` } },
      ),
    };
  }

  // A synchronous request cannot make progress without a worker already subscribed to
  // the resolved queue. Fail fast instead of leaving an Operation stuck at
  // "Initializing pipeline..." until the HTTP sync timeout expires.
  if (executeSync) {
    let workerCount: number;
    try {
      workerCount = await queue.getWorkersCount();
    } catch (workerCheckErr: unknown) {
      await markUnqueuedOperationFailed();
      const msg = workerCheckErr instanceof Error ? workerCheckErr.message : String(workerCheckErr);
      logger.error(`[submitPipelineJob] Failed to check workers for queue ${queueName}: ${msg}`);
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { type: `${BASE_TYPE_URI}/service-unavailable`, title: 'Service Unavailable', status: 503, detail: 'Unable to verify pipeline worker availability. Please retry later.' },
          { status: 503, headers: { 'Retry-After': '5', 'X-Operation-ID': operationId, 'Operation-Location': `/api/v1/operations/${operationId}` } },
        ),
      };
    }

    if (workerCount === 0) {
      await markUnqueuedOperationFailed();
      logger.error(`[submitPipelineJob] No workers are subscribed to queue ${queueName}`);
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { type: `${BASE_TYPE_URI}/service-unavailable`, title: 'Service Unavailable', status: 503, detail: `No pipeline worker is available for queue '${queueName}'. Please retry later.` },
          { status: 503, headers: { 'Retry-After': '5', 'X-Operation-ID': operationId, 'Operation-Location': `/api/v1/operations/${operationId}` } },
        ),
      };
    }
  }

  // Use a deterministic BullMQ ID so retrying an ambiguous queue.add response cannot
  // create a duplicate job. If both add attempts fail, reconcile against Redis before
  // deciding whether the operation can be marked terminal or must remain pollable.
  const enqueueJob = async () => {
    const jobOptions = { priority: bullPriority, jobId: operationId };
    try {
      return { ok: true as const, job: await queue.add(jobName, jobData, jobOptions) };
    } catch (firstErr: unknown) {
      const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      logger.warn(`[submitPipelineJob] Initial enqueue response failed for ${operationId} on ${queueName}: ${firstMsg}`);
    }

    try {
      return { ok: true as const, job: await queue.add(jobName, jobData, jobOptions) };
    } catch (retryErr: unknown) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      try {
        const existingJob = await queue.getJob(operationId);
        if (existingJob?.data?.operationId === operationId) {
          logger.warn(`[submitPipelineJob] Reconciled accepted job ${operationId} on ${queueName} after enqueue errors`);
          return { ok: true as const, job: existingJob };
        }
        return { ok: false as const, definitivelyNotEnqueued: true, error: retryMsg };
      } catch (reconcileErr: unknown) {
        const reconcileMsg = reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr);
        return { ok: false as const, definitivelyNotEnqueued: false, error: `${retryMsg}; reconciliation failed: ${reconcileMsg}` };
      }
    }
  };

  const enqueueResult = await enqueueJob();
  lapMark('enqueue');
  if (!enqueueResult.ok) {
    if (enqueueResult.definitivelyNotEnqueued) {
      await markUnqueuedOperationFailed();
    }
    logger.error(
      `[submitPipelineJob] Failed to enqueue ${operationId} on ${queueName}` +
      (enqueueResult.definitivelyNotEnqueued ? '' : ' (acceptance status uncertain)') +
      `: ${enqueueResult.error}`,
    );
    return {
      ok: false,
      errorResponse: NextResponse.json(
        {
          type: `${BASE_TYPE_URI}/service-unavailable`,
          title: 'Service Unavailable',
          status: 503,
          detail: enqueueResult.definitivelyNotEnqueued
            ? 'Unable to enqueue pipeline job. The operation was marked as failed.'
            : 'Pipeline enqueue status is uncertain. Use the operation URL to check status before retrying.',
        },
        {
          status: 503,
          headers: {
            'Retry-After': '5',
            'X-Operation-ID': operationId,
            'Operation-Location': `/api/v1/operations/${operationId}`,
          },
        },
      ),
    };
  }

  if (executeSync) {
    // ── SYNC MODE: wait for Worker to finish ──
    // Does NOT run pipeline in Next.js process — Worker process handles it.
    // Uses Redis pub/sub via QueueEvents so Next.js event loop is NOT blocked.
    const queueEvents = getOrCreateQueueEvents(queueName);

    try {
      await enqueueResult.job.waitUntilFinished(queueEvents, SYNC_TIMEOUT_MS);
    } catch (waitErr: unknown) {
      // The Worker may have failed the job or it may still be processing after the
      // synchronous wait window. Reloading below determines the HTTP response mode.
      const msg = waitErr instanceof Error ? waitErr.message : String(waitErr);
      logger.warn(`[submitPipelineJob] Sync wait ended for ${operationId}: ${msg}`);
    }

    // Reload to get the latest state written by Worker. If it is not terminal, the
    // endpoint returns 202 + Operation-Location so the caller can continue polling.
    const [reloaded] = await db.select().from(operations).where(eq(operations.id, operationId)).limit(1);
    operation = reloaded ?? operation;
  }

  return { ok: true, operation, isIdempotent: false, timings };
}

