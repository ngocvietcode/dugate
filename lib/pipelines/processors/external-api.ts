// lib/pipelines/processors/external-api.ts
// External API Processor — forward files trực tiếp đến external AI service via multipart/form-data.
// v2: Supports forwarding multiple files (files[]) in one request.

import fs from 'fs/promises';
import type { ProcessorContext, ProcessorResult } from '@/lib/pipelines/engine';
import type { ExternalApiConnection, ExternalApiOverride } from '@prisma/client';
import type { Logger } from '@/lib/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve giá trị theo dot-path trong JSON object.
 * VD: resolveDotPath({ data: { response: "hello" } }, "data.response") => "hello"
 */
function resolveDotPath(obj: unknown, dotPath: string): unknown {
  if (!dotPath || obj === null || obj === undefined) return obj;
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Interpolate {{variable}} placeholders trong template string.
 * VD: "Xin chào {{name}}" với { name: "An" } => "Xin chào An"
 */
function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }
  return result;
}

function logCurlCommand(url: string, method: string, headers: Record<string, string>, formData: FormData, logger: Logger) {
  let curl = `curl -X ${method} "${url}" \\\n`;
  for (const [k, v] of Object.entries(headers)) {
    // Hide auth secrets in logs to be safe, but keep the header
    const val = k.toLowerCase().includes('auth') || k.toLowerCase().includes('key') ? '***HIDDEN***' : v;
    curl += `  -H "${k}: ${val}" \\\n`;
  }
  
  // Try to iterate over FormData if supported
  try {
    for (const [key, value] of (formData as any).entries()) {
      if (typeof value === 'object' && value !== null && 'size' in value) {
        curl += `  -F "${key}=@/path/to/file" \\\n`;
      } else {
        const cleanVal = String(value).replace(/"/g, '\\"').replace(/\n/g, ' ');
        // Truncate long strings for clean logs
        const displayVal = cleanVal.length > 200 ? cleanVal.substring(0, 200) + '...' : cleanVal;
        curl += `  -F "${key}=${displayVal}" \\\n`;
      }
    }
  } catch(e) {}
  
  // Trim last backslash
  curl = curl.trim().replace(/\\$/, '');
  logger.debug(`[cURL COMMAND]\n${curl}`);
}


// ─── Core Processor ───────────────────────────────────────────────────────────

/**
 * Gọi external AI service via multipart/form-data HTTP request.
 * - Forward tất cả files gốc trực tiếp (không extract text trước)
 * - Prompt có thể được override bởi client profile
 * - Static form fields luôn cố định theo config admin
 */
export async function runExternalApiProcessor(
  ctx: ProcessorContext,
  connection: ExternalApiConnection,
  override?: ExternalApiOverride | null,
): Promise<ProcessorResult> {
  const startedAt = Date.now();

  // ── 1. Resolve prompt (override → default) ─────────────────────────────────
  const rawPrompt = override?.promptOverride?.trim()
    ? override.promptOverride
    : connection.defaultPrompt;

  // Interpolate {{variable}} từ pipeline variables
  const resolvedPrompt = interpolateVariables(rawPrompt, ctx.variables);

  ctx.logger.info(`Formatting prompt for ${connection.slug}`, { promptLength: resolvedPrompt.length });

  // ── 2. Build multipart/form-data ───────────────────────────────────────────
  const formData = new FormData();

  // 2a. Prompt field
  formData.append(connection.promptFieldName, resolvedPrompt);

  // 2b. Static form fields (admin-configured, cố định)
  if (connection.staticFormFields) {
    try {
      const staticFields = JSON.parse(connection.staticFormFields) as Array<{ key: string; value: string }>;
      for (const field of staticFields) {
        formData.append(field.key, field.value);
      }
    } catch {
      ctx.logger.warn(`staticFormFields JSON invalid for '${connection.slug}', skipping`);
    }
  }

  // 2c. Forward all files (multi-file support)
  if (ctx.filePaths.length > 0) {
    for (let i = 0; i < ctx.filePaths.length; i++) {
      const filePath = ctx.filePaths[i];
      const fileName = ctx.fileNames[i] ?? `file_${i}`;
      try {
        const fileBuffer = await fs.readFile(filePath);
        const blob = new Blob([fileBuffer]);
        formData.append(connection.fileFieldName, blob, fileName);
        ctx.logger.info(`Attaching file[${i}]: ${fileName} (${fileBuffer.length} bytes)`);
      } catch (e) {
        ctx.logger.warn(`Could not read file '${filePath}'`, undefined, e);
      }
    }
  } else if (ctx.inputText) {
    // Chain step: inject previous step output as text variable
    formData.append('input_content', ctx.inputText);
  }

  // ── 3. Build request headers ────────────────────────────────────────────────
  const headers: Record<string, string> = {
    'accept': 'application/json',
  };

  if (connection.authType === 'API_KEY_HEADER') {
    headers[connection.authKeyHeader] = connection.authSecret;
  } else if (connection.authType === 'BEARER') {
    headers['Authorization'] = `Bearer ${connection.authSecret}`;
  }

  if (connection.extraHeaders) {
    try {
      const extra = JSON.parse(connection.extraHeaders) as Record<string, string>;
      Object.assign(headers, extra);
    } catch {
      ctx.logger.warn(`extraHeaders JSON invalid for '${connection.slug}', skipping`);
    }
  }

  // ── 4. HTTP Request với timeout ────────────────────────────────────────────
  const controller = new AbortController();
  const timeoutMs = connection.timeoutSec * 1000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let responseJson: unknown;
  try {
    logCurlCommand(connection.endpointUrl, connection.httpMethod, headers, formData, ctx.logger);
    ctx.logger.info(`POST → ${connection.endpointUrl}`);
    const response = await fetch(connection.endpointUrl, {
      method: connection.httpMethod,
      headers,
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(no body)');
      ctx.logger.error(`HTTP ${response.status} Error Response: ${errorBody.substring(0, 1000)}`);
      throw new Error(`External API returned HTTP ${response.status}: ${errorBody.substring(0, 500)}`);
    }

    responseJson = await response.json();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`External API timeout after ${connection.timeoutSec}s (${connection.slug})`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`Network/Fetch Error for '${connection.slug}' (URL: ${connection.endpointUrl})`, undefined, err);
    // Rethrow a more descriptive error so it gets logged in pipeline engine
    throw new Error(`Connection Error to ${connection.slug}: ${msg}`);
  } finally {
    clearTimeout(timeoutHandle);
  }

  // ── 5. Parse response với dot-path ────────────────────────────────────────
  const contentPath = connection.responseContentPath ?? 'content';
  const rawContent = resolveDotPath(responseJson, contentPath);

  let content: string;
  if (typeof rawContent === 'string') {
    content = rawContent;
  } else if (rawContent !== null && rawContent !== undefined) {
    content = JSON.stringify(rawContent);
  } else {
    ctx.logger.warn(`Path '${contentPath}' not found in response for '${connection.slug}'. Returning full JSON.`);
    content = JSON.stringify(responseJson);
  }

  const latencyMs = Date.now() - startedAt;
  ctx.logger.info(`Successfully completed API call to ${connection.slug}`, { latencyMs, outputChars: content.length });

  return {
    content,
    extractedData: undefined,
    outputFilePath: undefined,
    inputTokens: 0,
    outputTokens: 0,
    pagesProcessed: 0,
    modelUsed: `ext:${connection.slug}`,
    costUsd: 0,
  };
}
