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
  const multi = form.getAll('files[]') as File[];
  if (multi.length > 0) return multi.filter((f) => f instanceof File && f.size > 0);
  const single = form.get('file');
  if (single instanceof File && single.size > 0) return [single];
  return [];
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runEndpoint(
  serviceSlug: string,
  req: NextRequest,
): Promise<NextResponse> {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const logger = new Logger({ correlationId, service: serviceSlug });
  logger.info(`[API_REQUEST_STARTED] Incoming request to /v1/${serviceSlug}`);

  try {
    // ── 1. Lookup service definition ────────────────────────────────────────
    const service = SERVICE_REGISTRY[serviceSlug];
    if (!service) {
      return apiError(404, 'Service Not Found', `Service '${serviceSlug}' is not registered.`);
    }

    const form = await req.formData();
    const apiKeyId = req.headers.get('x-api-key-id') ?? undefined;

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

    // ── 3. Normalize files ───────────────────────────────────────────────────
    const files = normalizeFiles(form);
    if (files.length === 0) {
      return apiError(400, 'Missing File', "At least one file is required. Use 'file' or 'files[]'.");
    }

    // ── 4. Block profileOnlyParams from client ───────────────────────────────
    for (const p of Object.keys(subCase.profileOnlyParams)) {
      if (form.has(p)) {
        return apiError(
          400,
          'Forbidden Field',
          `The '${p}' field cannot be set by the client. It is configured per API key by the administrator.`,
        );
      }
    }

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

    // ── 7. Merge params: default < client < profile ──────────────────────────
    const defaultParams: Record<string, unknown> = profileEndpoint?.defaultParams
      ? JSON.parse(profileEndpoint.defaultParams)
      : {};
    const profileParams: Record<string, unknown> = profileEndpoint?.profileParams
      ? JSON.parse(profileEndpoint.profileParams)
      : {};

    // Collect allowed client params
    const clientParams: Record<string, unknown> = {};
    for (const p of Object.keys(subCase.clientParams)) {
      if (form.has(p)) {
        clientParams[p] = form.get(p) as string;
      }
    }

    // Start with defaults, override with client, then force profile
    const mergedVars: Record<string, unknown> = {
      ...defaultParams,
      ...clientParams,
      ...profileParams,
    };

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

    // ── 9. Build pipeline ────────────────────────────────────────────────────
    const pipeline = subCase.connections.map((connSlug) => ({
      processor: connSlug,
      variables: mergedVars,
    }));

    // ── 10. Submit job ───────────────────────────────────────────────────────
    const outputFormat = (form.get('output_format') as string | null) ?? 'json';
    const webhookUrl = form.get('webhook_url') as string | null;
    const idempotencyKey = req.headers.get('idempotency-key') ?? undefined;

    const executeSync = req.nextUrl.searchParams.get('sync') === 'true';

    const result = await submitPipelineJob({
      pipeline,
      files,
      endpointSlug,
      outputFormat,
      webhookUrl,
      idempotencyKey,
      apiKeyId,
      executeSync,
      correlationId,
    });

    if (!result.ok) {
      logger.warn(`Pipeline submission rejected: ${JSON.stringify(result.errorResponse)}`);
      return result.errorResponse;
    }

    const isSyncOrIdempotent = result.isIdempotent || executeSync;
    
    logger.info(`[API_REQUEST_COMPLETED] Endpoint completed successfully`);

    return NextResponse.json(formatOperationResponse(result.operation), {
      status: isSyncOrIdempotent ? 200 : 202,
      headers: isSyncOrIdempotent
        ? {}
        : { 'Operation-Location': `/api/v1/operations/${result.operation.id}` },
    });


  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[runEndpoint:${serviceSlug}] failed`, undefined, error);
    return apiError(500, 'Internal Error', msg, 'https://dugate.vn/errors/internal');
  }
}
