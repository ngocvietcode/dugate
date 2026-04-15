// lib/pipelines/processors/external-api.ts
// External API Processor — forwards files to an external AI service via multipart/form-data.
// Delegates to: prompt-resolver, http-client, response-parser.

import fsPromises from 'fs/promises';
import path from 'path';
import type { ProcessorContext, ProcessorResult } from '@/lib/pipelines/engine';
import { ParserFactory } from '@/lib/parsers/factory';
import type { ExternalApiConnection, ExternalApiOverride } from '@prisma/client';
import { resolvePrompt } from './prompt-resolver';
import { extractContent, resolveDotPath } from './response-parser';
import { logCurlCommand, assertSafeUrl, fetchWithTimeout } from './http-client';
import { calculateCostUsd } from '@/lib/config';

/**
 * Call an external AI service via multipart/form-data.
 * - Forwards all files directly (no pre-extraction)
 * - Prompt resolved from code > profile override > connector default
 * - Static form fields are always fixed per admin config
 */
export async function runExternalApiProcessor(
  ctx: ProcessorContext,
  connection: ExternalApiConnection,
  override?: ExternalApiOverride | null,
): Promise<ProcessorResult> {
  const startedAt = Date.now();

  // ── 1. Resolve prompt ─────────────────────────────────────────────────────
  const resolvedPrompt = resolvePrompt(ctx.variables, connection, override);
  ctx.logger.info(`Formatting prompt for ${connection.slug}`, {
    promptLength: resolvedPrompt.length,
    source: ctx.variables._prompt ? 'code' : override?.promptOverride ? 'profile' : 'default',
  });

  // ── 1.5 Try internal parsers first (XLSX, DOCX) ──────────────────────────
  if (ctx.filePaths.length === 1) {
    const filePath = ctx.filePaths[0];
    const fileName = ctx.fileNames[0] ?? path.basename(filePath);
    const parser = ParserFactory.getParserForFile('', fileName);

    if (parser) {
      try {
        ctx.logger.info(`[InternalParser] Attempting to parse natively: ${fileName}`);
        const fileBuffer = await fsPromises.readFile(filePath);
        const result = await parser.parse(fileBuffer, fileName);
        ctx.logger.info(`[InternalParser] Successfully parsed ${fileName} natively.`);
        return {
          content: result.markdown,
          extractedData: undefined,
          outputFilePath: undefined,
          inputTokens: 0,
          outputTokens: 0,
          pagesProcessed: result.metadata?.pageCount || 1,
          modelUsed: `internal:${parser.constructor.name}`,
          costUsd: 0,
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg === 'SCANNED_PDF_DETECTED') {
          ctx.logger.info(`[InternalParser] Scanned PDF detected, falling back to External API.`);
        } else {
          ctx.logger.warn(`[InternalParser] Native parse failed: ${errMsg}. Falling back to External API.`);
        }
      }
    }
  }

  // ── 2. Build multipart form ───────────────────────────────────────────────
  const formData = new FormData();
  formData.append(connection.promptFieldName, resolvedPrompt);

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

  if (ctx.filePaths.length > 0) {
    for (let i = 0; i < ctx.filePaths.length; i++) {
      const filePath = ctx.filePaths[i];
      const fileName = ctx.fileNames[i] ?? `file_${i}`;
      try {
        const stat = await fsPromises.stat(filePath);
        const { openAsBlob } = await import('fs');
        const fileBlob = await openAsBlob(filePath);
        formData.append(connection.fileFieldName, fileBlob, fileName);
        ctx.logger.info(`Attaching file[${i}]: ${fileName} (${stat.size} bytes)`);
      } catch (e) {
        ctx.logger.error(`Could not read file '${filePath}'`, undefined, e);
        throw new Error(`Failed to attach file '${fileName}': file not found or unreadable`);
      }
    }
  } else if (ctx.inputText) {
    formData.append('input_content', ctx.inputText);
  }

  // Forward remote file URLs to connector (instead of downloading + attaching as blob)
  if (ctx.remoteFileUrls?.length && connection.fileUrlFieldName) {
    for (const url of ctx.remoteFileUrls) {
      formData.append(connection.fileUrlFieldName, url);
    }
    ctx.logger.info(`[URL_FORWARD] Forwarding ${ctx.remoteFileUrls.length} URL(s) via field "${connection.fileUrlFieldName}"`);
  }

  // Session injection
  const injectSessionField = ctx.injectSession !== undefined
    ? ctx.injectSession
    : connection.sessionIdFieldName;
  if (injectSessionField && ctx.pipelineState['session_id']) {
    formData.append(injectSessionField, ctx.pipelineState['session_id']);
    ctx.logger.info(`[SESSION] Injecting session_id as field "${injectSessionField}"`);
  }

  // ── 3. Build request headers ─────────────────────────────────────────────
  const headers: Record<string, string> = { accept: 'application/json' };

  if (connection.authType === 'API_KEY_HEADER') {
    headers[connection.authKeyHeader] = connection.authSecret;
  } else if (connection.authType === 'BEARER') {
    headers['Authorization'] = `Bearer ${connection.authSecret}`;
  }

  if (connection.extraHeaders) {
    try {
      Object.assign(headers, JSON.parse(connection.extraHeaders) as Record<string, string>);
    } catch {
      ctx.logger.warn(`extraHeaders JSON invalid for '${connection.slug}', skipping`);
    }
  }

  // ── 4. Validate URL (SSRF protection) + execute HTTP call ─────────────────
  let targetUrl: string;
  try {
    targetUrl = await assertSafeUrl(connection.endpointUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`[SSRF] Blocked unsafe URL for '${connection.slug}': ${msg}`);
    throw new Error(`External API URL rejected: ${msg}`);
  }

  logCurlCommand(targetUrl, connection.httpMethod, headers, formData, ctx.logger);
  ctx.logger.info(`${connection.httpMethod} → ${targetUrl}`);

  let responseJson: unknown;
  try {
    responseJson = await fetchWithTimeout(
      targetUrl,
      connection.httpMethod,
      headers,
      formData,
      connection.timeoutSec * 1000,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`Request failed for '${connection.slug}'`, undefined, err);
    throw new Error(`Connection Error to ${connection.slug}: ${msg}`);
  }

  // ── 5. Extract content from response ─────────────────────────────────────
  const contentPath = connection.responseContentPath ?? 'content';
  const content = extractContent(responseJson, contentPath, (p) => {
    ctx.logger.warn(`Path '${p}' not found in response for '${connection.slug}'. Returning full JSON.`);
  });

  const latencyMs = Date.now() - startedAt;
  ctx.logger.info(`Completed API call to ${connection.slug}`, { latencyMs, outputChars: content.length });

  // Capture session_id from response
  const captureSessionPath = ctx.captureSession !== undefined
    ? ctx.captureSession
    : connection.sessionIdResponsePath;
  if (captureSessionPath) {
    const sid = resolveDotPath(responseJson, captureSessionPath);
    if (typeof sid === 'string' && sid) {
      ctx.pipelineState['session_id'] = sid;
      ctx.logger.info(`[SESSION] Captured session_id from path "${captureSessionPath}"`);
    } else {
      ctx.logger.warn(`[SESSION] captureSession path="${captureSessionPath}" not found or not a string`);
    }
  }

  // Extract token usage from standard API response shapes (Gemini / OpenAI compatible)
  const responseObj = responseJson as Record<string, unknown>;
  let inputTokens = 0;
  let outputTokens = 0;

  // Gemini: usageMetadata.promptTokenCount / candidatesTokenCount
  const geminiUsage = responseObj?.usageMetadata as Record<string, number> | undefined;
  if (geminiUsage?.promptTokenCount) {
    inputTokens = geminiUsage.promptTokenCount ?? 0;
    outputTokens = geminiUsage.candidatesTokenCount ?? 0;
  }

  // OpenAI: usage.prompt_tokens / completion_tokens
  const openaiUsage = responseObj?.usage as Record<string, number> | undefined;
  if (openaiUsage?.prompt_tokens) {
    inputTokens = openaiUsage.prompt_tokens ?? 0;
    outputTokens = openaiUsage.completion_tokens ?? 0;
  }

  const modelUsed = `ext:${connection.slug}`;
  const costUsd = calculateCostUsd(modelUsed, inputTokens, outputTokens);

  if (inputTokens > 0) {
    ctx.logger.info(`[USAGE] tokens: in=${inputTokens} out=${outputTokens} cost=$${costUsd.toFixed(6)}`);
  }

  return {
    content,
    extractedData: undefined,
    outputFilePath: undefined,
    inputTokens,
    outputTokens,
    pagesProcessed: 0,
    modelUsed,
    costUsd,
  };
}
