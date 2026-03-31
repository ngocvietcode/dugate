// lib/pipelines/processors/external-api.ts
// External API Processor — forward file trực tiếp đến external AI service via multipart/form-data

import path from 'path';
import fs from 'fs/promises';
import type { ProcessorContext, ProcessorResult } from '@/lib/pipelines/engine';
import type { ExternalApiConnection, ExternalApiOverride } from '@prisma/client';

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

// ─── Core Processor ───────────────────────────────────────────────────────────

/**
 * Gọi external AI service via multipart/form-data HTTP request.
 * - Forward file gốc trực tiếp (không extract text trước)
 * - Chỉ prompt có thể được override bởi client profile
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

  console.log(`[ExtAPI] Connection: ${connection.slug}, Prompt length: ${resolvedPrompt.length}`);

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
      console.warn(`[ExtAPI] staticFormFields JSON invalid for connection '${connection.slug}', skipping`);
    }
  }

  // 2c. File — forward file gốc trực tiếp đến external service
  if (ctx.inputFilePath && ctx.fileName) {
    const fileBuffer = await fs.readFile(ctx.inputFilePath);
    const blob = new Blob([fileBuffer]);
    formData.append(connection.fileFieldName, blob, ctx.fileName);
    console.log(`[ExtAPI] Attaching file: ${ctx.fileName} (${fileBuffer.length} bytes)`);
  }

  // ── 3. Build request headers ────────────────────────────────────────────────
  const headers: Record<string, string> = {
    'accept': 'application/json',
  };

  // Auth header
  if (connection.authType === 'API_KEY_HEADER') {
    headers[connection.authKeyHeader] = connection.authSecret;
  } else if (connection.authType === 'BEARER') {
    headers['Authorization'] = `Bearer ${connection.authSecret}`;
  }
  // authType === 'NONE' → không thêm auth header

  // Extra headers tùy chỉnh (ngoài auth)
  if (connection.extraHeaders) {
    try {
      const extra = JSON.parse(connection.extraHeaders) as Record<string, string>;
      Object.assign(headers, extra);
    } catch {
      console.warn(`[ExtAPI] extraHeaders JSON invalid for connection '${connection.slug}', skipping`);
    }
  }

  // ── 4. HTTP Request với timeout ────────────────────────────────────────────
  const controller = new AbortController();
  const timeoutMs = connection.timeoutSec * 1000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let responseJson: unknown;
  try {
    console.log(`[ExtAPI] POST → ${connection.endpointUrl}`);
    const response = await fetch(connection.endpointUrl, {
      method: connection.httpMethod,
      headers,
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(no body)');
      throw new Error(
        `External API returned HTTP ${response.status}: ${errorBody.substring(0, 500)}`
      );
    }

    responseJson = await response.json();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`External API timeout after ${connection.timeoutSec}s (${connection.slug})`);
    }
    throw err;
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
    // Fallback: trả về toàn bộ response dưới dạng JSON string
    console.warn(
      `[ExtAPI] Could not resolve path '${contentPath}' in response for '${connection.slug}'. Returning raw JSON.`
    );
    content = JSON.stringify(responseJson);
  }

  const latencyMs = Date.now() - startedAt;
  console.log(`[ExtAPI] ✅ ${connection.slug} completed in ${latencyMs}ms, content length: ${content.length}`);

  return {
    content,
    extractedData: undefined,   // External API kết quả trả về dạng text
    outputFilePath: undefined,
    inputTokens: 0,             // External API không report token usage
    outputTokens: 0,
    pagesProcessed: 0,
    modelUsed: `ext:${connection.slug}`,
    costUsd: 0,
  };
}
