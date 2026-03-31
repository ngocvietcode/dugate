// lib/endpoints/runner.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { submitPipelineJob } from '@/lib/pipelines/submit';
import { formatOperationResponse } from '@/lib/pipelines/format';
import { ENDPOINT_REGISTRY } from './registry';

/**
 * The generic runner that handles all endpoint executions.
 * It enforces profile parameters, applies default parameters,
 * handles file extraction (single/two files), and builds the execution pipeline.
 */
export async function runEndpoint(
  endpointSlug: string,
  req: NextRequest,
): Promise<NextResponse> {
  try {
    const def = ENDPOINT_REGISTRY[endpointSlug];
    if (!def) {
      return NextResponse.json(
        {
          type: 'https://dugate.vn/errors/not-found',
          title: 'Endpoint Not Found',
          status: 404,
          detail: `Endpoint '${endpointSlug}' is not registered in the system.`,
        },
        { status: 404 }
      );
    }

    const form = await req.formData();
    const apiKeyId = req.headers.get('x-api-key-id') ?? undefined;

    // ── 1. Block profile-only params from client ─────────────────────────────
    for (const p of def.profileOnlyParams) {
      if (form.has(p)) {
        return NextResponse.json(
          {
            type: 'https://dugate.vn/errors/forbidden-field',
            title: 'Forbidden Field',
            status: 400,
            detail: `The "${p}" field cannot be set by the client. It is configured per API key profile by the administrator.`,
          },
          { status: 400 }
        );
      }
    }

    // ── 2. Load ProfileEndpoint from DB ─────────────────────────────────────
    let profileEndpoint = null;
    if (apiKeyId) {
      profileEndpoint = await prisma.profileEndpoint.findUnique({
        where: {
          apiKeyId_endpointSlug: { apiKeyId, endpointSlug },
        },
      });

      if (profileEndpoint && !profileEndpoint.enabled) {
        return NextResponse.json(
          {
            type: 'https://dugate.vn/errors/forbidden',
            title: 'Endpoint Disabled',
            status: 403,
            detail: `The endpoint '${def.displayName}' is explicitly disabled for this API key profile.`,
          },
          { status: 403 }
        );
      }
    }

    // ── 3. Merge Parameters (Priority: Profile > Default > Client) ───────────
    const profileParams = profileEndpoint?.profileParams ? JSON.parse(profileEndpoint.profileParams) : {};
    const defaultParams = profileEndpoint?.defaultParams ? JSON.parse(profileEndpoint.defaultParams) : {};

    // Extract allowed client params (only those that are defined in clientParams)
    const clientParams: Record<string, unknown> = {};
    for (const p of def.clientParams) {
      if (form.has(p)) {
        clientParams[p] = form.get(p) as string;
      }
    }

    const mergedVars = {
      ...defaultParams, // Lowest priority: admin defaults
      ...clientParams,  // Medium priority: explicit client overrides
      ...profileParams, // Highest priority: admin forced constraints (profile-only)
    };

    // ── 4. Build Pipeline ───────────────────────────────────────────────────
    const pipeline = def.connections.map(connSlug => ({
      processor: connSlug,
      variables: mergedVars,
    }));

    // ── 5. File Validation & Job Submission ─────────────────────────────────
    let file: File | null = null;
    let sourceFile: File | null = null;
    let targetFile: File | null = null;

    if (def.inputMode === 'two_files') {
      sourceFile = form.get('source_file') as File | null;
      targetFile = form.get('target_file') as File | null;
      if (!sourceFile || !targetFile) {
        return NextResponse.json(
          {
            type: 'https://dugate.vn/errors/missing-files',
            title: 'Missing Files',
            status: 400,
            detail: `This endpoint requires 'source_file' and 'target_file' as form data.`,
          },
          { status: 400 }
        );
      }
    } else if (def.inputMode === 'single_file') {
      file = form.get('file') as File | null;
      if (!file) {
        return NextResponse.json(
          {
            type: 'https://dugate.vn/errors/missing-file',
            title: 'Missing File',
            status: 400,
            detail: `A 'file' parameter is required for this pipeline.`,
          },
          { status: 400 }
        );
      }
    }

    let outputFormat = (form.get('output_format') as string | null) || def.defaultOutputFormat || 'json';
    
    // Override outputFormat to json if this endpoint is not transform related
    // Most extraction generation workloads return json.
    if (!form.has('output_format') && !def.defaultOutputFormat && def.slug !== 'transform') {
       outputFormat = 'json';
    }

    const result = await submitPipelineJob({
      pipeline,
      file,
      sourceFile,
      targetFile,
      outputFormat,
      webhookUrl: form.get('webhook_url') as string | null,
      idempotencyKey: req.headers.get('idempotency-key') ?? undefined,
      apiKeyId,
    });

    if (!result.ok) {
      return result.errorResponse;
    }

    return NextResponse.json(formatOperationResponse(result.operation), {
      status: result.isIdempotent ? 200 : 202,
      headers: result.isIdempotent
        ? {}
        : { 'Operation-Location': `/api/v1/operations/${result.operation.id}` },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[runEndpoint ${endpointSlug}] Error:`, msg);
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/internal', title: 'Internal Error', status: 500, detail: msg },
      { status: 500 }
    );
  }
}
