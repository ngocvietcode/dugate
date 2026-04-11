// lib/pipelines/submit.ts
// Core submit logic: validate connectors, save files, create Operation,
// then enqueue job to BullMQ Worker (async) or wait for result (sync).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { type PipelineStep } from '@/lib/pipelines/engine';
import { saveUploadedFile } from '@/lib/upload-helper';
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
  endpointSlug?: string;      // "extract:invoice", "analyze:fact-check", etc.
  outputFormat?: string;
  webhookUrl?: string | null;
  idempotencyKey?: string;
  apiKeyId?: string;
  userId?: string;
  executeSync?: boolean;
  correlationId?: string;
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

  // ── 4. Save uploaded files to disk (skip if no files) ──────────────────
  const operationId = crypto.randomUUID();
  const filesData: Array<{ name: string; path: string; mime: string; size: number }> = [];

  for (const file of (files ?? [])) {
    const saved = await saveUploadedFile(file, operationId);
    filesData.push({
      name: file.name,
      path: saved.path,
      mime: file.type || 'application/octet-stream',
      size: file.size,
    });
  }

  // ── 6. Create Operation in DB ─────────────────────────────────────────────
  // When DISABLE_HISTORY=true, soft-delete immediately so it won't appear in history queries
  const disableHistory = process.env.DISABLE_HISTORY === 'true';

  let operation = await prisma.operation.create({
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

  // ── 7. Enqueue to BullMQ Worker ────────────────────────────────────────────
  const queue = getPipelineQueue();
  const jobName = `pipeline:${endpointSlug ?? 'unknown'}`;
  const jobData: PipelineJobData = { operationId, correlationId };

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

