// lib/pipelines/submit.ts
// Core submit logic: validate connectors, save files, create Operation, fire pipeline async.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runPipeline, type PipelineStep } from '@/lib/pipelines/engine';
import { saveUploadedFile } from '@/lib/upload-helper';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubmitPipelineParams {
  pipeline: PipelineStep[];
  files: File[];              // Universal: 1 or many files
  endpointSlug?: string;      // "extract:invoice", "analyze:fact-check", etc.
  outputFormat?: string;
  webhookUrl?: string | null;
  idempotencyKey?: string;
  apiKeyId?: string;
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

  // ── 4. Validate files ─────────────────────────────────────────────────────
  if (!files || files.length === 0) {
    return {
      ok: false,
      errorResponse: NextResponse.json(
        { type: 'https://dugate.vn/errors/missing-file', title: 'Missing File', status: 400, detail: 'At least one file is required.' },
        { status: 400 },
      ),
    };
  }

  // ── 5. Save uploaded files to disk ───────────────────────────────────────
  const operationId = crypto.randomUUID();
  const filesData: Array<{ name: string; path: string; mime: string; size: number }> = [];

  for (const file of files) {
    const saved = await saveUploadedFile(file, operationId);
    filesData.push({
      name: file.name,
      path: saved.path,
      mime: file.type || 'application/octet-stream',
      size: file.size,
    });
  }

  // ── 6. Create Operation in DB ─────────────────────────────────────────────
  let operation = await prisma.operation.create({
    data: {
      id:              operationId,
      apiKeyId:        apiKeyId ?? null,
      idempotencyKey:  idempotencyKey ?? null,
      endpointSlug:    endpointSlug ?? null,
      pipelineJson:    JSON.stringify(pipeline),
      filesJson:       JSON.stringify(filesData),
      outputFormat,
      webhookUrl:      webhookUrl ?? null,
      state:           'RUNNING',
      done:            false,
      progressPercent: 0,
      progressMessage: 'Initializing pipeline...',
    },
  });

  // ── 7. Execute (Sync or Async) ──────────────────────────────────────────────
  if (executeSync) {
    await runPipeline(operationId, correlationId);
    // Reload operation to get latest state after completion
    operation = (await prisma.operation.findUnique({ where: { id: operationId } }))!;
  } else {
    // Fire-and-forget
    runPipeline(operationId, correlationId).catch((err) => {
      console.error(`[submitPipelineJob] Pipeline error for ${operationId}:`, err);
    });
  }

  return { ok: true, operation, isIdempotent: false };
}

