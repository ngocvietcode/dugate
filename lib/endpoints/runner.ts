// lib/endpoints/runner.ts
// Universal endpoint dispatcher for all 6 API services.
// Delegates to: profile-resolver (profile loading + param merge), submit (job submission).

import { NextRequest, NextResponse } from 'next/server';
import { submitPipelineJob } from '@/lib/pipelines/submit';
import { formatOperationResponse } from '@/lib/pipelines/format';
import { SERVICE_REGISTRY } from './registry';
import { EXTRACT_PRESETS } from './presets';
import { Logger } from '@/lib/logger';
import { loadProfileEndpoint, mergeParameters, parseConnectionSteps } from './profile-resolver';
import crypto from 'crypto';

// ─── Error helper ─────────────────────────────────────────────────────────────

export function apiError(status: number, title: string, detail: string, type?: string): NextResponse {
  return NextResponse.json(
    {
      type: type ?? `https://dugate.vn/errors/${title.toLowerCase().replace(/\s+/g, '-')}`,
      title,
      status,
      detail,
    },
    { status },
  );
}

// ─── File normalization ───────────────────────────────────────────────────────

/**
 * Normalize file inputs: accepts both `file` (single) and `files[]` (multi).
 * Always returns an array for consistent downstream handling.
 */
export function normalizeFiles(form: FormData): File[] {
  const result: File[] = [];

  const multi = form.getAll('files[]') as File[];
  if (multi.length > 0) {
    result.push(...multi.filter((f) => f instanceof File && f.size > 0));
  }

  const source = form.get('source_file');
  if (source instanceof File && source.size > 0) result.push(source);

  const target = form.get('target_file');
  if (target instanceof File && target.size > 0) result.push(target);

  const single = form.get('file');
  if (single instanceof File && single.size > 0) result.push(single);

  return result;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runEndpoint(serviceSlug: string, req: NextRequest): Promise<NextResponse> {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const logger = new Logger({ correlationId, service: serviceSlug });
  const startedAt = Date.now();

  logger.info(`[REQUEST] Incoming /v1/${serviceSlug}`, {
    method: req.method,
    url: req.url,
    apiKeyId: req.headers.get('x-api-key-id') ?? undefined,
    userId: req.headers.get('x-user-id') ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
    idempotencyKey: req.headers.get('idempotency-key') ?? undefined,
    sync: new URL(req.url).searchParams.get('sync') === 'true',
  });

  try {
    // ── 1. Lookup service ───────────────────────────────────────────────────
    const service = SERVICE_REGISTRY[serviceSlug];
    if (!service) {
      return apiError(404, 'Service Not Found', `Service '${serviceSlug}' is not registered.`);
    }

    const form = await req.formData();
    const apiKeyId = req.headers.get('x-api-key-id') ?? undefined;
    const userId = req.headers.get('x-user-id') ?? undefined;

    // ── 2. Resolve sub-case ─────────────────────────────────────────────────
    const discriminatorValue = (form.get(service.discriminatorName) as string | null)?.trim();
    const subCase = service.subCases[discriminatorValue ?? ''] ?? service.subCases['_default'];

    if (!subCase) {
      const validValues = Object.keys(service.subCases).join(', ');
      return apiError(
        400,
        'Invalid Parameter',
        `'${service.discriminatorName}' must be one of: ${validValues}. Got: '${discriminatorValue ?? '(empty)'}'.`,
      );
    }

    // ── 3. Normalize files ──────────────────────────────────────────────────
    const files = normalizeFiles(form);

    logger.info(`[REQUEST_PARSED] ${service.displayName} / ${subCase.displayName}`, {
      endpointSlug: discriminatorValue && discriminatorValue !== '_default'
        ? `${serviceSlug}:${discriminatorValue}`
        : serviceSlug,
      fileCount: files.length,
      fileNames: files.map((f) => `${f.name} (${(f.size / 1024).toFixed(1)} KB)`),
      formKeys: Array.from(form.keys()).filter(
        (k) => !['files[]', 'file', 'source_file', 'target_file'].includes(k),
      ),
    });

    // ── 4. Build endpoint slug ──────────────────────────────────────────────
    const endpointSlug =
      discriminatorValue && discriminatorValue !== '_default'
        ? `${serviceSlug}:${discriminatorValue}`
        : serviceSlug;

    // ── 5. Load profile endpoint ────────────────────────────────────────────
    const profileEndpoint = await loadProfileEndpoint(apiKeyId, endpointSlug, serviceSlug);

    if (profileEndpoint && !profileEndpoint.enabled) {
      return apiError(
        403,
        'Endpoint Disabled',
        `The '${service.displayName} / ${subCase.displayName}' endpoint is disabled for this API key.`,
      );
    }

    // ── 6. Parse profile DB params ──────────────────────────────────────────
    let dbParams: Record<string, { value: unknown; isLocked?: boolean }> = {};
    if (profileEndpoint?.parameters) {
      try {
        dbParams = JSON.parse(profileEndpoint.parameters);
      } catch { /* skip invalid JSON */ }
    }

    // ── 7. Merge params + lock check ────────────────────────────────────────
    const mergeResult = mergeParameters(form, subCase.parameters, dbParams);
    if (!mergeResult.ok) return mergeResult.errorResponse;
    const mergedVars = mergeResult.vars;

    // ── 8. Inject extract presets ───────────────────────────────────────────
    if (serviceSlug === 'extract' && discriminatorValue) {
      const preset = EXTRACT_PRESETS[discriminatorValue];
      if (preset) {
        if (!mergedVars.fields) mergedVars.fields = preset.fields;
        if (preset.schema && !mergedVars.schema) mergedVars.schema = preset.schema;
      }
    }

    // ── 9. Build pipeline ───────────────────────────────────────────────────
    const connectionSteps = parseConnectionSteps(
      profileEndpoint?.connectionsOverride,
      subCase.connections,
      () => logger.info(`[PROFILE_ROUTING] Override (legacy format)`),
      () => logger.warn(`[PROFILE_ROUTING] Invalid connectionsOverride JSON, falling back to defaults`),
    );

    const pipeline = connectionSteps.map((step) => ({
      processor: step.slug,
      variables: { ...mergedVars },
      stepId: step.stepId,
      captureSession: step.captureSession,
      injectSession: step.injectSession,
    }));

    // ── 10. Submit job ──────────────────────────────────────────────────────
    const outputFormat = (form.get('output_format') as string | null) ?? 'json';
    const webhookUrl = form.get('webhook_url') as string | null;
    const idempotencyKey = req.headers.get('idempotency-key') ?? undefined;
    const executeSync = new URL(req.url).searchParams.get('sync') === 'true';

    const result = await submitPipelineJob({
      pipeline,
      files,
      endpointSlug,
      outputFormat,
      webhookUrl,
      idempotencyKey,
      apiKeyId,
      userId,
      executeSync,
      correlationId,
    });

    if (!result.ok) {
      const latencyMs = Date.now() - startedAt;
      logger.warn(`[RESPONSE] Pipeline rejected`, { latencyMs });
      return result.errorResponse;
    }

    const isSyncOrIdempotent = result.isIdempotent || executeSync;
    const httpStatus = isSyncOrIdempotent ? 200 : 202;
    const latencyMs = Date.now() - startedAt;

    logger.info(`[RESPONSE] ${httpStatus}`, {
      operationId: result.operation.id,
      httpStatus,
      latencyMs,
      fileCount: files.length,
      pipelineSteps: pipeline.length,
      outputFormat,
      isIdempotent: result.isIdempotent,
      executeSync,
    });

    return NextResponse.json(formatOperationResponse(result.operation), {
      status: httpStatus,
      headers: isSyncOrIdempotent
        ? {}
        : { 'Operation-Location': `/api/v1/operations/${result.operation.id}` },
    });

  } catch (error: unknown) {
    const latencyMs = Date.now() - startedAt;
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[RESPONSE] 500 Internal Error`, { latencyMs }, error);
    return apiError(500, 'Internal Error', msg, 'https://dugate.vn/errors/internal');
  }
}
