// app/api/internal/ext-connections/[id]/test/route.ts
// POST — Test connection với optional file + custom prompt
// Trả về: HTTP status, latency, response preview, mapped content

import { NextRequest, NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { externalApiConnections } from '@/lib/db/schema';
import type { ExternalApiConnection } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import {
  isAiHubMode,
  buildJsonBody,
  injectMultimodalFiles,
  resolveContentPath,
  stripMarkdownCodeFence,
} from '@/lib/endpoints/json-body-helper';
import { resolveConnectionSecret } from '@/lib/secrets/resolve';
import { requireCapability } from '@/lib/auth-guard';

/**
 * Safe auth diagnostic for the Test Connection result — shows WHICH source the
 * key came from and a one-way fingerprint (never the value). Lets ops verify
 * Vault-vs-DB and whether a saved change actually took effect.
 */
function buildAuthDebug(
  conn: { vaultSecretPath?: string | null; authSecret: string; authKeyHeader: string; authType: string },
  resolved: string,
) {
  const source = conn.vaultSecretPath && conn.vaultSecretPath.trim()
    ? `vault:${conn.vaultSecretPath.trim()}`
    : (conn.authSecret ? 'db-authSecret' : 'none');
  const fingerprint = resolved
    ? crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 10)
    : 'EMPTY';
  const keyHeader = conn.authType === 'BEARER' ? 'Authorization' : conn.authKeyHeader;
  return { source, keyHeader, fingerprint, keyLength: resolved.length };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // This route resolves a connector secret, sends caller-supplied content
  // upstream, and returns diagnostic metadata. It therefore requires the
  // configurable connector-management capability; `/api/internal` bypasses
  // middleware, so this route must enforce its guard itself.
  const guard = await requireCapability('connector:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const { id } = await params;

    const [connection] = await db.select().from(externalApiConnections).where(eq(externalApiConnections.id, id)).limit(1);
    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connection không tồn tại' }, { status: 404 });
    }

    // Parse test payload
    const form = await req.formData();
    const testPrompt = (form.get('prompt') as string | null) ?? connection.defaultPrompt;
    const testFiles = form.getAll('files') as File[];

    // ── AIHub branch ─────────────────────────────────────────────────────────
    // Activated ONLY by the Mode_Marker in extraHeaders. Multipart branch below
    // is preserved 100% unchanged.
    if (isAiHubMode(connection.extraHeaders)) {
      return await runAiHubTest(connection, form, testFiles);
    }

    // Build headers
    const headers: Record<string, string> = {
      'accept': 'application/json',
    };
    // Resolve the outbound auth value — Vault ref when set, else the legacy stored field (dual-read).
    const authSecret = await resolveConnectionSecret(connection);
    const authDebug = buildAuthDebug(connection, authSecret);
    if (connection.authType === 'API_KEY_HEADER') {
      headers[connection.authKeyHeader] = authSecret;
    } else if (connection.authType === 'BEARER') {
      headers['Authorization'] = `Bearer ${authSecret}`;
    }
    if (connection.extraHeaders) {
      try {
        Object.assign(headers, JSON.parse(connection.extraHeaders));
      } catch { /* ignore */ }
    }

    // Remove explicitly set multipart/form-data Content-Type header so fetch can generate boundary
    const ctKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
    if (ctKey && headers[ctKey].toLowerCase().includes('multipart/form-data')) {
      delete headers[ctKey];
    }

    // Build form data
    const formData = new FormData();
    formData.append(connection.promptFieldName, testPrompt);

    // Static fields
    if (connection.staticFormFields) {
      try {
        const fields = JSON.parse(connection.staticFormFields) as Array<{ key: string; value: string }>;
        for (const field of fields) {
          formData.append(field.key, field.value);
        }
      } catch { /* ignore */ }
    }

    // Files (optional for test)
    if (testFiles && testFiles.length > 0) {
      for (const testFile of testFiles) {
        if (testFile.name) {
          const buf = await testFile.arrayBuffer();
          // Ensure file type is preserved to avoid application/octet-stream fallback
          formData.append(connection.fileFieldName, new Blob([buf], { type: testFile.type }), testFile.name);
        }
      }
    }

    // Execute request with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), connection.timeoutSec * 1000);
    const startedAt = Date.now();

    let httpStatus = 0;
    let responseBodyRaw = '';
    let mappedContent: unknown = null;
    let errorMessage: string | null = null;
    let errorStack: string | null = null;

    // Generate curl command — auth headers and field values are redacted
    const SAFE_HEADERS = new Set(['accept', 'content-type']);
    let curlCmd = `curl -X ${connection.httpMethod} '${connection.endpointUrl}' \\`;
    for (const k of Object.keys(headers)) {
      const displayVal = SAFE_HEADERS.has(k.toLowerCase()) ? headers[k] : '***';
      curlCmd += `\n  -H '${k}: ${displayVal}' \\`;
    }
    curlCmd += `\n  -F '${connection.promptFieldName}=${testPrompt.replace(/'/g, "'\\''")}'`;

    if (connection.staticFormFields) {
      try {
        const fields = JSON.parse(connection.staticFormFields) as Array<{ key: string; value: string }>;
        for (const field of fields) {
          curlCmd += ` \\\n  -F '${field.key}=***'`;
        }
      } catch { /* ignore */ }
    }

    if (testFiles && testFiles.length > 0) {
      for (const testFile of testFiles) {
        if (testFile.name) {
          curlCmd += ` \\\n  -F '${connection.fileFieldName}=@${testFile.name.replace(/'/g, "'\\''")}'`;
        }
      }
    }

    try {
      const isGetOrHead = connection.httpMethod === 'GET' || connection.httpMethod === 'HEAD';
      const response = await fetch(connection.endpointUrl, {
        method: connection.httpMethod,
        headers,
        body: isGetOrHead ? undefined : formData,
        signal: controller.signal,
      });

      httpStatus = response.status;
      responseBodyRaw = await response.text();

      if (response.ok) {
        try {
          const json = JSON.parse(responseBodyRaw);
          // Resolve dot-path
          const contentPath = connection.responseContentPath?.trim();
          if (!contentPath) {
             mappedContent = typeof json === 'object' && json !== null ? JSON.stringify(json, null, 2) : String(json);
          } else {
            let current: unknown = json;
            for (const part of contentPath.split('.')) {
              if (current === null || current === undefined) break;
              current = (current as Record<string, unknown>)[part];
            }
            mappedContent = typeof current === 'object' && current !== null
              ? JSON.stringify(current, null, 2)
              : (current !== undefined && current !== null ? String(current) : null);
          }
        } catch {
          mappedContent = responseBodyRaw;
        }
      } else {
        errorMessage = `HTTP ${response.status}`;
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        errorMessage = `Timeout sau ${connection.timeoutSec}s`;
        httpStatus = 0;
      } else {
        const e = err instanceof Error ? err : new Error(String(err));
        errorMessage = e.message;
        if ('cause' in e && e.cause) {
           errorMessage += ` (Cause: ${(e.cause as Error).message || String(e.cause)})`;
        }
        errorStack = e.stack ?? null;
      }
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - startedAt;

    return NextResponse.json({
      success: !errorMessage,
      httpStatus,
      latencyMs,
      responsePreview: responseBodyRaw,
      mappedContent,
      error: errorMessage,
      errorStack,
      authDebug,
      curlCmd: `# [auth-debug] source=${authDebug.source} header=${authDebug.keyHeader} fp=${authDebug.fingerprint} keyLen=${authDebug.keyLength}\n${curlCmd}`,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    new Logger({ service: 'ext_connections_api' }).error('ExtConnections Test error', undefined, error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── AIHub test branch ───────────────────────────────────────────────────────
// Mirrors the runtime External_API_Processor AIHub logic: builds a JSON
// chat-completion body from the stored template + static fields, injects any
// attached files as multimodal image_url parts, and sends application/json.
// Uses its own inline fetch + AbortController (does not depend on http-client).

interface StaticField { key: string; value: string }

function parseStaticFields(raw: string | null): StaticField[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as StaticField[];
    return [];
  } catch {
    return [];
  }
}

async function runAiHubTest(
  connection: ExternalApiConnection,
  form: FormData,
  testFiles: File[],
): Promise<NextResponse> {
  // ── 1. Resolve dynamic user prompt ──────────────────────────────────────
  // The dynamic prompt is injected into the {{promptFieldName}} placeholder.
  // When the tester does not supply a prompt, fall back to the stored
  // user_prompt static field value (the configured default).
  const allStatic = parseStaticFields(connection.staticFormFields);
  const rawPrompt = form.get('prompt') as string | null;
  const userPromptDefault =
    allStatic.find(f => f.key === connection.promptFieldName)?.value ?? '';
  const dynamicPrompt = rawPrompt ?? userPromptDefault;

  // Exclude the dynamic placeholder from static replacement so buildJsonBody
  // injects the resolved prompt (not the stored default) for that placeholder.
  const staticForTemplate = allStatic.filter(f => f.key !== connection.promptFieldName);

  // ── 2. Build JSON body (same helpers as runtime) ────────────────────────
  let jsonBody = buildJsonBody(
    connection.defaultPrompt,
    connection.promptFieldName,
    dynamicPrompt,
    staticForTemplate,
  );

  // ── 3. Inject attached files as multimodal image_url base64 parts ───────
  const files = (testFiles ?? []).filter(f => f && f.name);
  if (files.length > 0) {
    jsonBody = await injectMultimodalFiles(jsonBody, files);
  }

  // ── 4. Build headers: auth + application/json + extra headers ───────────
  const headers: Record<string, string> = { accept: 'application/json' };
  // Resolve the outbound auth value — Vault ref when set, else the legacy stored field (dual-read).
  const authSecret = await resolveConnectionSecret(connection);
  const authDebug = buildAuthDebug(connection, authSecret);
  if (connection.authType === 'API_KEY_HEADER') {
    headers[connection.authKeyHeader] = authSecret;
  } else if (connection.authType === 'BEARER') {
    headers['Authorization'] = `Bearer ${authSecret}`;
  }
  if (connection.extraHeaders) {
    try {
      Object.assign(headers, JSON.parse(connection.extraHeaders) as Record<string, string>);
    } catch { /* ignore malformed extraHeaders */ }
  }
  // Force JSON content type regardless of stored header casing.
  const existingCt = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
  if (existingCt) delete headers[existingCt];
  headers['Content-Type'] = 'application/json';

  // ── 5. Build illustrative curl command (auth + base64 redacted) ─────────
  const SAFE_HEADERS = new Set(['accept', 'content-type']);
  // Redact large base64 data URLs in the displayed body.
  const redactedBody = jsonBody.replace(
    /data:[^;"]*;base64,[A-Za-z0-9+/=]+/g,
    'data:...;base64,<REDACTED>',
  );
  let curlCmd = `curl -X ${connection.httpMethod} '${connection.endpointUrl}' \\`;
  for (const k of Object.keys(headers)) {
    const displayVal = SAFE_HEADERS.has(k.toLowerCase()) ? headers[k] : '***';
    curlCmd += `\n  -H '${k}: ${displayVal}' \\`;
  }
  curlCmd += `\n  -d '${redactedBody.replace(/'/g, "'\\''")}'`;

  // ── 6. Execute request with timeout (inline AbortController) ────────────
  const timeoutMs = connection.timeoutSec * 1000;
  console.log(`[ext-connections/test] AIHub request: timeoutSec=${connection.timeoutSec} (${timeoutMs}ms) endpoint=${connection.endpointUrl}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  let httpStatus = 0;
  let responseBodyRaw = '';
  let mappedContent: unknown = null;
  let errorMessage: string | null = null;
  let errorStack: string | null = null;

  try {
    const response = await fetch(connection.endpointUrl, {
      method: connection.httpMethod,
      headers,
      body: jsonBody,
      signal: controller.signal,
    });

    httpStatus = response.status;
    responseBodyRaw = await response.text();

    if (response.ok) {
      try {
        const json = JSON.parse(responseBodyRaw);
        const resolved = resolveContentPath(
          json,
          connection.responseContentPath?.trim() || 'choices.0.message.content',
        );
        mappedContent = resolved === null ? null : stripMarkdownCodeFence(String(resolved));
      } catch {
        mappedContent = responseBodyRaw;
      }
    } else {
      errorMessage = `HTTP ${response.status}`;
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      errorMessage = `Timeout sau ${connection.timeoutSec}s`;
      httpStatus = 0;
    } else {
      const e = err instanceof Error ? err : new Error(String(err));
      errorMessage = e.message;
      if ('cause' in e && e.cause) {
        errorMessage += ` (Cause: ${(e.cause as Error).message || String(e.cause)})`;
      }
      errorStack = e.stack ?? null;
    }
  } finally {
    clearTimeout(timeout);
  }

  const latencyMs = Date.now() - startedAt;

  return NextResponse.json({
    success: !errorMessage,
    httpStatus,
    latencyMs,
    responsePreview: responseBodyRaw,
    mappedContent,
    error: errorMessage,
    errorStack,
    authDebug,
    curlCmd: `# [auth-debug] source=${authDebug.source} header=${authDebug.keyHeader} fp=${authDebug.fingerprint} keyLen=${authDebug.keyLength}\n${curlCmd}`,
  });
}
