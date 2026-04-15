// app/api/v1/workflows/route.ts
// Entrypoint for complex business workflows.
// Creates an Operation + enqueues a BullMQ job with name "workflow:{process}".
// The actual orchestration logic runs in the Worker process (workflow-engine.ts).

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { normalizeFiles, apiError } from '@/lib/endpoints/runner';
import { submitPipelineJob } from '@/lib/pipelines/submit';
import { SERVICE_REGISTRY } from '@/lib/endpoints/registry';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const form = await req.formData();
    const processName = (form.get('process') as string | null)?.trim();

    if (!processName) {
      return apiError(400, 'Missing Parameter', "Form field 'process' is required.");
    }

    const subCase = SERVICE_REGISTRY['workflows']?.subCases[processName];
    if (!subCase) {
      return apiError(404, 'Workflow Not Found', `Workflow '${processName}' is not registered.`);
    }

    const files = normalizeFiles(form);
    if (files.length === 0) {
      return apiError(400, 'Missing Files', 'Workflow requires at least 1 document.');
    }

    // Collect workflow-specific variables from form
    const variables: Record<string, unknown> = {};
    for (const key of Object.keys(subCase.parameters)) {
      const val = form.get(key) as string | null;
      if (val) variables[key] = val;
    }

    // Build a single-step pipeline placeholder (workflow-engine ignores this,
    // but submitPipelineJob requires at least 1 step for validation).
    const pipeline = [{ processor: 'ext-classifier', variables }];

    const endpointSlug = `workflows:${processName}`;

    let apiKeyId = form.get('apiKeyId') as string | null;

    if (apiKeyId) {
      // Validate that the provided API key ID actually exists to avoid foreign key constraint errors
      // Support 3 input formats:
      //   1. Internal UUID  → findUnique by id
      //   2. Raw key string (dg_xxx...) → SHA-256 hash then findUnique by keyHash
      let existingKey = await prisma.apiKey.findUnique({
        where: { id: apiKeyId },
      }).catch(() => null); // Catch UUID parse error if they pass a non-UUID string

      if (!existingKey) {
        // Hash the raw key string (same as auth-key/route.ts) before looking up
        const computedHash = crypto.createHash('sha256').update(apiKeyId).digest('hex');
        existingKey = await prisma.apiKey.findUnique({
          where: { keyHash: computedHash },
        }).catch(() => null);
      }

      if (!existingKey) {
        return apiError(400, 'Invalid Profile API Key', `The provided Profile API Key '${apiKeyId}' does not exist. Please use a valid API Key string or ID.`);
      }
      
      // Override apiKeyId with the actual UUID from db 
      apiKeyId = existingKey.id;
    }

    if (!apiKeyId) {
      // Fetch system admin API key to link the operation to the admin profile
      // This allows the demo UI to use prompt overrides configured under the admin profile
      const adminKey = await prisma.apiKey.findFirst({
        where: { role: 'ADMIN' },
        orderBy: { createdAt: 'asc' },
      });
      apiKeyId = adminKey?.id || null;
    }

    const result = await submitPipelineJob({
      pipeline,
      files,
      endpointSlug,
      correlationId,
      apiKeyId: apiKeyId || undefined,
      disableHistory: false, // Workflows MUST stay visible for GET polling
    });

    if (!result.ok) return result.errorResponse;

    return NextResponse.json(
      {
        name: `operations/${result.operation.id}`,
        done: false,
        metadata: {
          state: 'RUNNING',
          workflow: processName,
          progress_percent: 0,
          progress_message: 'Initializing workflow...',
        },
      },
      {
        status: 202,
        headers: {
          'Operation-Location': `/api/v1/operations/${result.operation.id}`,
        },
      },
    );
  } catch (err: any) {
    return apiError(500, 'Internal Workflow Error', err.message);
  }
}
