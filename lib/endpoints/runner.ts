// lib/endpoints/runner.ts
// Universal endpoint runner for all 6 API services.
// Handles: discriminator routing, multi-file normalization, preset injection,
//          ProfileEndpoint overrides, param merging, and pipeline submission.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { submitPipelineJob } from '@/lib/pipelines/submit';
import { formatOperationResponse } from '@/lib/pipelines/format';
import { SERVICE_REGISTRY } from './registry';
import { EXTRACT_PRESETS } from './presets';
import { Logger } from '@/lib/logger';
import crypto from 'crypto';

// ─── Error helper ────────────────────────────────────────────────────────────

function apiError(status: number, title: string, detail: string, type?: string): NextResponse {
  return NextResponse.json(
    {
      type: type ?? `https://dugate.vn/errors/${title.toLowerCase().replace(/\s+/g, '-')}`,
      title,
      status,
      detail,
    },
    { status }
  );
}

// ─── File normalization ───────────────────────────────────────────────────────

/**
 * Normalize file inputs: accepts both `file` (single) and `files[]` (multi).
 * Always returns an array for consistent downstream handling.
 */
function normalizeFiles(form: FormData): File[] {
  const result: File[] = [];

  // Lấy danh sách files[] (cho các endpoint nạp nhiều file)
  const multi = form.getAll('files[]') as File[];
  if (multi.length > 0) {
    result.push(...multi.filter((f) => f instanceof File && f.size > 0));
  }
  
  // Custom checks for endpoint compare
  const source = form.get('source_file');
  if (source instanceof File && source.size > 0) result.push(source);

  const target = form.get('target_file');
  if (target instanceof File && target.size > 0) result.push(target);

  // Fallback single file check
  const single = form.get('file');
  if (single instanceof File && single.size > 0) result.push(single);
  
  return result;
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runEndpoint(
  serviceSlug: string,
  req: NextRequest,
): Promise<NextResponse> {
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
    // ── 1. Lookup service definition ────────────────────────────────────────
    const service = SERVICE_REGISTRY[serviceSlug];
    if (!service) {
      return apiError(404, 'Service Not Found', `Service '${serviceSlug}' is not registered.`);
    }

    const form = await req.formData();
    const apiKeyId = req.headers.get('x-api-key-id') ?? undefined;
    const userId = req.headers.get('x-user-id') ?? undefined;

    // ── 2. Resolve sub-case via discriminator ────────────────────────────────
    const discriminatorValue = (form.get(service.discriminatorName) as string | null)?.trim();

    // For extract: all types route to _default; for others: must match a known sub-case
    let subCase = service.subCases[discriminatorValue ?? ''] ?? service.subCases['_default'];

    if (!subCase) {
      const validValues = Object.keys(service.subCases).join(', ');
      return apiError(
        400,
        'Invalid Parameter',
        `'${service.discriminatorName}' must be one of: ${validValues}. Got: '${discriminatorValue ?? '(empty)'}'.`,
      );
    }

    // ── 3. Normalize files (optional — endpoints may work without files) ─────
    const files = normalizeFiles(form);

    // ── 3b. Log request details after parsing form ───────────────────────────
    logger.info(`[REQUEST_PARSED] ${service.displayName} / ${subCase.displayName}`, {
      endpointSlug: discriminatorValue && discriminatorValue !== '_default'
        ? `${serviceSlug}:${discriminatorValue}`
        : serviceSlug,
      fileCount: files.length,
      fileNames: files.map(f => `${f.name} (${(f.size / 1024).toFixed(1)} KB)`),
      formKeys: Array.from(form.keys()).filter(k => !['files[]', 'file', 'source_file', 'target_file'].includes(k)),
    });

    // ── 4. (Deprecated) Block profileOnlyParams - moved to step 7 ────────────

    // ── 5. Build compound endpoint slug: "service:subcase" ──────────────────
    const endpointSlug = discriminatorValue && discriminatorValue !== '_default'
      ? `${serviceSlug}:${discriminatorValue}`
      : serviceSlug;

    // ── 6. Load ProfileEndpoint (try compound slug first, fallback to service) ──
    let profileEndpoint = null;
    if (apiKeyId) {
      profileEndpoint = await prisma.profileEndpoint.findUnique({
        where: { apiKeyId_endpointSlug: { apiKeyId, endpointSlug } },
      });

      // Fallback: check service-level profile (e.g. "extract" without subcase)
      if (!profileEndpoint && endpointSlug !== serviceSlug) {
        profileEndpoint = await prisma.profileEndpoint.findUnique({
          where: { apiKeyId_endpointSlug: { apiKeyId, endpointSlug: serviceSlug } },
        });
      }

      if (profileEndpoint && !profileEndpoint.enabled) {
        return apiError(
          403,
          'Endpoint Disabled',
          `The '${service.displayName} / ${subCase.displayName}' endpoint is disabled for this API key.`,
        );
      }
    }

    // ── 7. Merge params & Check locks ────────────────────────────────────────
    let dbParams: Record<string, { value: any, isLocked?: boolean }> = {};
    if (profileEndpoint?.parameters) {
      try {
        dbParams = JSON.parse(profileEndpoint.parameters);
      } catch (e) {
        // skip
      }
    }

    const mergedVars: Record<string, unknown> = {};

    // Load defaults from DB
    for (const [key, config] of Object.entries(dbParams)) {
      mergedVars[key] = config.value;
    }

    // Read client form input against registry parameters
    for (const [key, schema] of Object.entries(subCase.parameters)) {
      const isLocked = dbParams[key]?.isLocked ?? schema.defaultLocked ?? false;

      if (form.has(key)) {
         if (isLocked) {
            return apiError(
              400,
              'Forbidden Field',
              `The '${key}' field cannot be set by the client. It is locked by the administrator.`
            );
         }
         mergedVars[key] = form.get(key) as string;
      }
    }

    // ── 8. Inject preset fields for extract service ──────────────────────────
    if (serviceSlug === 'extract' && discriminatorValue) {
      const preset = EXTRACT_PRESETS[discriminatorValue];
      if (preset) {
        // Preset fields are the lowest priority — client can override with explicit `fields`
        if (!mergedVars.fields) {
          mergedVars.fields = preset.fields;
        }
        if (preset.schema && !mergedVars.schema) {
          mergedVars.schema = preset.schema;
        }
      }
    }

    // ── 9. Build pipeline (per-profile routing support) ────────────────────
    // connectionsOverride hỗ trợ 2 format:
    //   Format cũ: ["ext-slug-1", "ext-slug-2"]
    //   Format mới: [{"slug":"ext-slug-1","captureSession":"result.session_id"},...]
    interface ConnectionStep {
      slug: string;
      captureSession?: string | null;
      injectSession?: string | null;
    }

    let connectionSteps: ConnectionStep[];
    if (profileEndpoint?.connectionsOverride) {
      try {
        const raw = JSON.parse(profileEndpoint.connectionsOverride);
        if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
          // Backward compat: format cũ string[]
          connectionSteps = (raw as string[]).map((slug) => ({ slug }));
          logger.info(`[PROFILE_ROUTING] Override (legacy format): [${raw.join(', ')}]`);
        } else {
          // Format mới: ConnectionStep[]
          connectionSteps = raw as ConnectionStep[];
          logger.info(`[PROFILE_ROUTING] Override (step format): [${connectionSteps.map(s => s.slug).join(', ')}]`);
        }
      } catch {
        logger.warn(`[PROFILE_ROUTING] Invalid connectionsOverride JSON, falling back to defaults`);
        connectionSteps = subCase.connections.map((slug) => ({ slug }));
      }
    } else {
      connectionSteps = subCase.connections.map((slug) => ({ slug }));
    }

    const pipeline = connectionSteps.map((step) => ({
      processor: step.slug,
      variables: mergedVars,
      captureSession: step.captureSession,
      injectSession: step.injectSession,
    }));

    // ── 10. Submit job ───────────────────────────────────────────────────────
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
      logger.warn(`[RESPONSE] Pipeline rejected`, {
        latencyMs,
        error: JSON.stringify(result.errorResponse),
      });
      return result.errorResponse;
    }

    const isSyncOrIdempotent = result.isIdempotent || executeSync;
    const httpStatus = isSyncOrIdempotent ? 200 : 202;
    const latencyMs = Date.now() - startedAt;

    logger.info(`[RESPONSE] ${httpStatus} ${isSyncOrIdempotent ? (result.isIdempotent ? 'IDEMPOTENT_HIT' : 'SYNC') : 'ASYNC'}`, {
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
