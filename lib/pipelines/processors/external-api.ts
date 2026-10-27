// lib/pipelines/processors/external-api.ts
// External API Processor — forwards files to an external AI service via multipart/form-data.
// Delegates to: prompt-resolver, http-client, response-parser.

import fsPromises from 'fs/promises';
import path from 'path';
import type { ProcessorContext, ProcessorResult } from '@/lib/pipelines/engine';
import { ParserFactory } from '@/lib/parsers/factory';
import type { ExternalApiConnection, ExternalApiOverride } from '@/lib/db/schema';
import {
  resolvePrompt,
  interpolateVariables,
  resolveModel,
  applyModelOverride,
  MODEL_FIELD_KEY,
  resolveReasoningEffort,
  applyReasoningEffortOverride,
  REASONING_EFFORT_FIELD_KEY,
} from './prompt-resolver';
import { extractContent, resolveDotPath } from './response-parser';
import {
  logCurlCommand,
  sanitizeUrlForLogging,
  assertSafeUrl,
  fetchWithTimeout,
  fetchJsonWithTimeout,
  ExternalApiHttpError,
} from './http-client';
import { estimateCost, type CostSource } from '@/lib/pricing';
import { resolveConnectionSecret } from '@/lib/secrets/resolve';
import {
  isAiHubMode,
  buildJsonBody,
  injectMultimodalFiles,
  resolveContentPath,
  stripMarkdownCodeFence,
  setJsonBodyField,
} from '@/lib/endpoints/json-body-helper';

/**
 * Turn a connector transport failure into the error the pipeline reports.
 *
 * Two classes, deliberately worded differently so an operator knows where to look:
 *   - 4xx → the request itself was rejected: model name, prompt shape, payload or
 *     credential is wrong. This is a CONFIGURATION problem, not a network problem.
 *     Reporting it as "Connection Error" is what previously made an invalid Model
 *     Override look like an unreachable connector.
 *   - everything else (5xx, DNS, timeout, socket) → genuine connection/provider
 *     failure, message unchanged for backwards compatibility.
 *
 * The provider's own explanation is already redacted + truncated by http-client,
 * so it is safe to surface. Internal logs additionally record the raw body length.
 */
function wrapConnectorError(ctx: ProcessorContext, slug: string, err: unknown): Error {
  if (err instanceof ExternalApiHttpError) {
    // The 4xx-vs-5xx distinction is recorded in the INTERNAL log only.
    //
    // It deliberately does NOT change the thrown message shape: that string is
    // matched downstream by classifyWorkflowFailure, which derives the webhook
    // fields `error` / `error_code` / `retryable` consumed by the integrating IDP.
    // Re-labelling a 4xx (e.g. "Configuration Error at ...") would silently flip
    // the retry decision of a live integration — including for transient 429/408
    // throttles — so the classification stays out of the message.
    const configHint = err.status >= 400 && err.status < 500
      ? 'client-side/configuration fault (model, prompt, payload or credential)'
      : 'provider-side or transport fault';
    ctx.logger.error(`Request failed for '${slug}' — HTTP ${err.status} (${configHint})`, {
      httpStatus: err.status,
      httpStatusClass: err.status >= 400 && err.status < 500 ? '4xx' : `${Math.floor(err.status / 100)}xx`,
      providerBodyChars: err.bodyLength,
      providerBodyExcerpt: err.bodyExcerpt || '(empty body)',
    }, err);
  } else {
    ctx.logger.error(`Request failed for '${slug}'`, undefined, err);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`Connection Error to ${slug}: ${msg}`);
}

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

  // ── AIHub branch ──────────────────────────────────────────────────────────
  // Activated ONLY by the Mode_Marker ("X-Connection-Mode": "AIHUB") in
  // extraHeaders. When absent, the entire multipart branch below runs unchanged.
  if (isAiHubMode(connection.extraHeaders)) {
    return runAiHubBranch(ctx, connection, override ?? null, startedAt);
  }

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
          costSource: 'none' as CostSource, // native parse, no AI call — legitimately $0
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

  // Resolve model + reasoning_effort overrides (profile/workflow) — null = use connector default
  const modelOverride = resolveModel(ctx.variables, override);
  const reasoningEffortOverride = resolveReasoningEffort(ctx.variables, override);

  if (connection.staticFormFields) {
    try {
      const staticFields = JSON.parse(connection.staticFormFields) as Array<{ key: string; value: string }>;
      let effectiveStatic = applyModelOverride(staticFields, modelOverride);
      effectiveStatic = applyReasoningEffortOverride(effectiveStatic, reasoningEffortOverride);
      if (modelOverride) {
        ctx.logger.info(`[Multipart] Model override configured for ${connection.slug}`, {
          source: typeof ctx.variables._model === 'string' ? 'workflow' : 'profile',
        });
      }
      if (reasoningEffortOverride) {
        ctx.logger.info(`[Multipart] reasoning_effort override configured for ${connection.slug}`, {
          source: typeof ctx.variables._reasoning_effort === 'string' ? 'workflow' : 'profile',
        });
      }
      for (const field of effectiveStatic) {
        formData.append(field.key, field.value);
      }
    } catch {
      ctx.logger.warn(`staticFormFields JSON invalid for '${connection.slug}', skipping`);
    }
  } else {
    // No static fields configured, but an override may still exist → send it.
    if (modelOverride) {
      formData.append(MODEL_FIELD_KEY, modelOverride);
      ctx.logger.info(`[Multipart] Model override configured for ${connection.slug}`);
    }
    if (reasoningEffortOverride) {
      formData.append(REASONING_EFFORT_FIELD_KEY, reasoningEffortOverride);
      ctx.logger.info(`[Multipart] reasoning_effort override configured for ${connection.slug}`);
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

  // Resolve the outbound auth value — Vault ref when set, else the legacy stored field (dual-read).
  const authSecret = await resolveConnectionSecret(connection);
  if (connection.authType === 'API_KEY_HEADER') {
    headers[connection.authKeyHeader] = authSecret;
  } else if (connection.authType === 'BEARER') {
    headers['Authorization'] = `Bearer ${authSecret}`;
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

  const safeTargetUrl = sanitizeUrlForLogging(targetUrl);
  logCurlCommand(targetUrl, connection.httpMethod, headers, formData, ctx.logger);
  ctx.logger.info(`${connection.httpMethod} → ${safeTargetUrl}`);
  ctx.logger.info(`[Multipart] Request configured`, {
    endpoint: safeTargetUrl,
    promptLength: resolvedPrompt.length,
    timeoutSec: connection.timeoutSec,
    fileCount: ctx.filePaths.length,
  });
  // Nội dung prompt đầy đủ vào Bull Board (chỉ khi LOG_JOB_LLM_IO=true).
  ctx.logger.jobLlmIo(`[Multipart] PROMPT → ${connection.slug}`, resolvedPrompt, { chars: resolvedPrompt.length, fileCount: ctx.filePaths.length });

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
    throw wrapConnectorError(ctx, connection.slug, err);
  }

  // ── 5. Extract content from response ─────────────────────────────────────
  const contentPath = connection.responseContentPath ?? 'content';
  const content = extractContent(responseJson, contentPath, (p) => {
    ctx.logger.warn(`Path '${p}' not found in response for '${connection.slug}'. Returning full JSON.`);
  });

  const latencyMs = Date.now() - startedAt;
  ctx.logger.info(`Completed API call to ${connection.slug}`, { latencyMs, outputChars: content.length });
  // Nội dung output đầy đủ vào Bull Board (chỉ khi LOG_JOB_LLM_IO=true).
  ctx.logger.jobLlmIo(`[Multipart] OUTPUT ← ${connection.slug}`, content, { chars: content.length, latencyMs });

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

  // Extract token usage from response — supports multiple provider formats
  const usage = extractTokenUsage(responseJson as Record<string, unknown>);
  const { inputTokens, outputTokens, reportedCostUsd } = usage;

  // Resolve actual model name from response (if available)
  const responseObj = responseJson as Record<string, unknown>;
  const responseModel = typeof responseObj?.model === 'string' ? responseObj.model : null;
  const modelUsed = responseModel ? `ext:${responseModel}` : `ext:${connection.slug}`;

  // Cost resolution:
  //   provider-reported (CAIP) → authoritative, never recompute
  //   else estimate from configured pricing (may be 'unpriced' if model has no price)
  let costUsd: number | null;
  let costSource: CostSource;
  if (reportedCostUsd !== null) {
    costUsd = reportedCostUsd;
    costSource = 'provider';
  } else if (inputTokens === null && outputTokens === null) {
    costUsd = null;
    costSource = 'none';
  } else {
    const est = await estimateCost(modelUsed, inputTokens ?? 0, outputTokens ?? 0);
    costUsd = est.cost;
    costSource = est.source;
  }

  if ((inputTokens ?? 0) > 0 || reportedCostUsd !== null) {
    ctx.logger.info(`[USAGE] tokens: in=${inputTokens} out=${outputTokens} cost=$${costUsd} source=${costSource} model=${modelUsed}`);
  }
  if (costSource === 'unpriced') {
    ctx.logger.warn(`[USAGE] UNPRICED model "${modelUsed}" (in=${inputTokens} out=${outputTokens}) — cấu hình giá tại Settings > Bảng giá Model.`);
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
    costSource,
  };
}

// ─── Token-usage extraction (shared by both branches) ────────────────────────
interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  reportedCostUsd: number | null; // set only when the provider returns an authoritative cost
}

function readUsageNumber(source: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

/**
 * Extract token usage + provider-reported cost from a response, supporting:
 *  - CAIP / Agent Studio: total_cost_summary (authoritative cost) + events[].token_cost fallback
 *  - Gemini direct: usageMetadata.promptTokenCount / candidatesTokenCount
 *  - OpenAI-compatible: usage.prompt_tokens / completion_tokens (+ input_tokens/output_tokens alias)
 *
 * Missing fields remain null. In particular, an explicit zero is never confused
 * with a provider that omitted usage entirely.
 */
export function extractTokenUsage(responseObj: Record<string, unknown>): TokenUsage {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let reportedCostUsd: number | null = null;

  // Priority 1: CAIP — detect by presence of total_cost_summary (NOT by token truthiness)
  const caip = responseObj?.total_cost_summary as Record<string, unknown> | undefined;
  if (caip && typeof caip === 'object') {
    inputTokens = readUsageNumber(caip, 'total_prompt_tokens');
    outputTokens = readUsageNumber(caip, 'total_completion_tokens');
    reportedCostUsd = readUsageNumber(caip, 'total_cost_usd');
  }

  // Priority 1b: CAIP events fallback — sum ONE cost per event, no double counting.
  if (reportedCostUsd === null && Array.isArray(responseObj?.events)) {
    let sum = 0;
    let found = false;
    for (const ev of responseObj.events as Array<Record<string, unknown>>) {
      const evtc = ev?.token_cost as Record<string, unknown> | undefined;
      const eventCost = evtc ? readUsageNumber(evtc, 'cost_usd') : null;
      if (eventCost !== null) {
        sum += eventCost;
        found = true;
        continue;
      }
      const parts = Array.isArray(ev?.parts) ? (ev.parts as Array<Record<string, unknown>>) : [];
      for (const p of parts) {
        const tc = p?.token_cost as Record<string, unknown> | undefined;
        const partCost = tc ? readUsageNumber(tc, 'cost_usd') : null;
        if (partCost !== null) {
          sum += partCost;
          found = true;
        }
      }
    }
    if (found) reportedCostUsd = sum;
  }

  // Priority 2: Gemini direct — usageMetadata
  if (inputTokens === null && outputTokens === null) {
    const gemini = responseObj?.usageMetadata as Record<string, unknown> | undefined;
    if (gemini && typeof gemini === 'object') {
      inputTokens = readUsageNumber(gemini, 'promptTokenCount');
      outputTokens = readUsageNumber(gemini, 'candidatesTokenCount');
    }
  }

  // Priority 3: OpenAI-compatible usage aliases
  if (inputTokens === null && outputTokens === null) {
    const usage = responseObj?.usage as Record<string, unknown> | undefined;
    if (usage && typeof usage === 'object') {
      inputTokens = readUsageNumber(usage, 'prompt_tokens', 'input_tokens');
      outputTokens = readUsageNumber(usage, 'completion_tokens', 'output_tokens');
    }
  }

  return { inputTokens, outputTokens, reportedCostUsd };
}

// ─── AIHub branch ───────────────────────────────────────────────────────────
// Mirrors the Test_Handler AIHub logic. Activated only when the Mode_Marker
// ("X-Connection-Mode": "AIHUB") is present in extraHeaders. Builds a JSON
// chat-completion body from the stored template (connection.defaultPrompt) +
// static fields (connection.staticFormFields), injects any attached files as
// multimodal image_url base64 parts, and sends application/json to the endpoint.

interface AiHubStaticField {
  key: string;
  value: string;
}

function parseAiHubStaticFields(
  raw: string | null,
  onMalformed: () => void,
): AiHubStaticField[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      onMalformed();
      return [];
    }
    return parsed.filter((item): item is AiHubStaticField =>
      !!item && typeof item === 'object'
      && typeof (item as AiHubStaticField).key === 'string'
      && typeof (item as AiHubStaticField).value === 'string',
    );
  } catch {
    onMalformed();
    return [];
  }
}

/**
 * Read file paths from disk into File objects, preserving names from fileNames.
 * injectMultimodalFiles relies on file.arrayBuffer() and file.name.
 */
async function readFilesAsFileObjects(
  filePaths: string[],
  fileNames: string[],
): Promise<File[]> {
  const files: File[] = [];
  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const fileName = fileNames[i] ?? path.basename(filePath) ?? `file_${i}`;
    const buffer = await fsPromises.readFile(filePath);
    files.push(new File([new Uint8Array(buffer)], fileName));
  }
  return files;
}

/**
 * Execute an AIHub (OpenAI-compatible chat completions, application/json) call.
 * - JSON body built from connection.defaultPrompt template + static fields
 * - The dynamic prompt placeholder (promptFieldName) is excluded from static
 *   fields so the resolved prompt wins for that placeholder
 * - Attached files are injected as multimodal image_url base64 content parts
 */
async function runAiHubBranch(
  ctx: ProcessorContext,
  connection: ExternalApiConnection,
  override: ExternalApiOverride | null,
  startedAt: number,
): Promise<ProcessorResult> {
  // ── 1. Build JSON body from stored template + static fields ───────────────
  // Exclude the dynamic placeholder (promptFieldName) from static replacement so
  // buildJsonBody injects the resolved prompt (not the stored default) for it.
  // Apply any profile/workflow model override to the `model` static field first,
  // so the {{model}} placeholder in the template resolves to the overridden value.
  const modelOverride = resolveModel(ctx.variables, override);
  const reasoningEffortOverride = resolveReasoningEffort(ctx.variables, override);
  let allStatic = applyModelOverride(
    parseAiHubStaticFields(
      connection.staticFormFields,
      () => ctx.logger.warn(`staticFormFields JSON invalid for '${connection.slug}', skipping`),
    ),
    modelOverride,
  );
  allStatic = applyReasoningEffortOverride(allStatic, reasoningEffortOverride);
  // Interpolate {{variable}} placeholders (e.g. {{fields}}, {{schema}}) INSIDE the
  // static field values — most importantly `system_prompt`. Previously only the
  // user message (user_prompt) was interpolated with pipeline variables, so a
  // {{fields}} placeholder placed in system_prompt was sent to the model verbatim
  // and the per-type field list never reached the AI. Interpolating every static
  // value keeps system_prompt/user_prompt consistent; fields that never carry a
  // placeholder (model / max_tokens / temperature / reasoning_effort) are unaffected.
  const staticForTemplate = allStatic
    .filter((f) => f.key !== connection.promptFieldName)
    .map((f) => ({ ...f, value: interpolateVariables(f.value, ctx.variables) }));
  if (modelOverride) {
    ctx.logger.info(`[AIHub] Model override configured for ${connection.slug}`, {
      source: typeof ctx.variables._model === 'string' ? 'workflow' : 'profile',
    });
  }
  if (reasoningEffortOverride) {
    ctx.logger.info(`[AIHub] reasoning_effort override configured for ${connection.slug}`, {
      source: typeof ctx.variables._reasoning_effort === 'string' ? 'workflow' : 'profile',
    });
  }
  // Effective reasoning_effort (connector default, possibly overridden). Used to
  // guarantee the field lands in the JSON body even when the stored template has
  // no {{reasoning_effort}} placeholder (e.g. connector configured without it).
  const effectiveReasoningEffort =
    allStatic.find((f) => f.key === REASONING_EFFORT_FIELD_KEY)?.value ?? '';

  // For AIHub, `defaultPrompt` stores the JSON Chat_Completion_Body template, NOT
  // a user message — so the standard resolvePrompt's fallback to `defaultPrompt`
  // is meaningless here. Re-resolve the user message with the AIHub-correct
  // priority: code-injected _prompt > profile override > user_prompt static field.
  const userPromptDefault =
    allStatic.find((f) => f.key === connection.promptFieldName)?.value ?? '';
  const codePrompt =
    typeof ctx.variables._prompt === 'string' ? ctx.variables._prompt : null;
  const overrideRaw =
    typeof override?.promptOverride === 'string' && override.promptOverride.trim()
      ? override.promptOverride
      : null;
  const userMessageRaw = codePrompt ?? overrideRaw ?? userPromptDefault;
  const userMessage = interpolateVariables(userMessageRaw, ctx.variables);
  ctx.logger.info(`[AIHub] Prompt resolved`, {
    source: codePrompt ? 'code' : overrideRaw ? 'profile' : 'default',
    length: userMessage.length,
  });
  // Nội dung prompt đầy đủ vào Bull Board (chỉ khi LOG_JOB_LLM_IO=true).
  ctx.logger.jobLlmIo(`[AIHub] PROMPT → ${connection.slug}`, userMessage, {
    chars: userMessage.length,
    model: modelOverride ?? allStatic.find((f) => f.key === 'model')?.value ?? null,
    reasoningEffort: effectiveReasoningEffort || null,
  });
  ctx.logger.info(`[AIHub] Request configured`, {
    endpoint: sanitizeUrlForLogging(connection.endpointUrl),
    hasModel: !!allStatic.find(f => f.key === 'model')?.value,
    timeoutSec: connection.timeoutSec,
  });

  let jsonBody = buildJsonBody(
    connection.defaultPrompt,
    connection.promptFieldName,
    userMessage,
    staticForTemplate,
  );

  // Ensure reasoning_effort lands in the body even when the stored template has
  // no {{reasoning_effort}} placeholder. Idempotent when the template already
  // carries the (same) value; a profile override wins because it is applied last.
  if (effectiveReasoningEffort) {
    jsonBody = setJsonBodyField(jsonBody, REASONING_EFFORT_FIELD_KEY, effectiveReasoningEffort);
  }

  // ── 2. Inject attached files as multimodal image_url base64 parts ─────────
  if (ctx.filePaths.length > 0) {
    const files = await readFilesAsFileObjects(ctx.filePaths, ctx.fileNames);
    jsonBody = await injectMultimodalFiles(jsonBody, files);
    ctx.logger.info(`[AIHub] Injected ${files.length} file(s) as multimodal content`);
  }

  // ── 3. Build request headers: auth + Content-Type: application/json ───────
  const headers: Record<string, string> = { accept: 'application/json' };

  // Resolve the outbound auth value — Vault ref when set, else the legacy stored field (dual-read).
  const authSecret = await resolveConnectionSecret(connection);
  if (connection.authType === 'API_KEY_HEADER') {
    headers[connection.authKeyHeader] = authSecret;
  } else if (connection.authType === 'BEARER') {
    headers['Authorization'] = `Bearer ${authSecret}`;
  }
  // authType === 'NONE' → no auth header

  if (connection.extraHeaders) {
    try {
      Object.assign(headers, JSON.parse(connection.extraHeaders) as Record<string, string>);
    } catch {
      ctx.logger.warn(`extraHeaders JSON invalid for '${connection.slug}', skipping`);
    }
  }

  // Force JSON content type regardless of any stored header casing.
  const ctKey = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type');
  if (ctKey) delete headers[ctKey];
  headers['Content-Type'] = 'application/json';

  // ── 4. Validate URL (SSRF protection) + execute HTTP call ─────────────────
  let targetUrl: string;
  try {
    targetUrl = await assertSafeUrl(connection.endpointUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`[SSRF] Blocked unsafe URL for '${connection.slug}': ${msg}`);
    throw new Error(`External API URL rejected: ${msg}`);
  }

  logCurlCommand(targetUrl, connection.httpMethod, headers, jsonBody, ctx.logger);
  ctx.logger.info(`${connection.httpMethod} → ${sanitizeUrlForLogging(targetUrl)} (AIHub)`);

  let responseJson: unknown;
  try {
    responseJson = await fetchJsonWithTimeout(
      targetUrl,
      connection.httpMethod,
      headers,
      jsonBody,
      connection.timeoutSec * 1000,
    );
  } catch (err: unknown) {
    throw wrapConnectorError(ctx, connection.slug, err);
  }

  // ── 5. Extract content via dot-path (array-index aware) ───────────────────
  const contentPath = connection.responseContentPath ?? 'choices.0.message.content';
  const resolved = resolveContentPath(responseJson, contentPath);
  if (resolved === null) {
    ctx.logger.warn(
      `Path '${contentPath}' not found in response for '${connection.slug}'. Returning full JSON.`,
    );
  }
  const content =
    resolved === null
      ? typeof responseJson === 'object' && responseJson !== null
        ? JSON.stringify(responseJson, null, 2)
        : String(responseJson)
      : stripMarkdownCodeFence(String(resolved));

  const latencyMs = Date.now() - startedAt;
  ctx.logger.info(`Completed AIHub call to ${connection.slug}`, {
    latencyMs,
    outputChars: content.length,
  });
  // Nội dung output đầy đủ vào Bull Board (chỉ khi LOG_JOB_LLM_IO=true).
  ctx.logger.jobLlmIo(`[AIHub] OUTPUT ← ${connection.slug}`, content, { chars: content.length, latencyMs });

  // ── 6. Extract token usage (AIHub is OpenAI-compatible; helper also handles aliases)
  const responseObj = responseJson as Record<string, unknown>;
  const { inputTokens, outputTokens, reportedCostUsd } = extractTokenUsage(responseObj);

  // Extract actual model name from response (e.g. "gemini-2.5-flash", "gpt-4o")
  const responseModel = typeof responseObj?.model === 'string' ? responseObj.model : null;
  const modelUsed = responseModel ? `ext:${responseModel}` : `ext:${connection.slug}`;

  // AIHub returns tokens only → estimate from configured pricing. If AIHub ever
  // starts returning a cost, extractTokenUsage would surface it as reportedCostUsd.
  let costUsd: number | null;
  let costSource: CostSource;
  if (reportedCostUsd !== null) {
    costUsd = reportedCostUsd;
    costSource = 'provider';
  } else if (inputTokens === null && outputTokens === null) {
    costUsd = null;
    costSource = 'none';
  } else {
    const est = await estimateCost(modelUsed, inputTokens ?? 0, outputTokens ?? 0);
    costUsd = est.cost;
    costSource = est.source;
  }

  if ((inputTokens ?? 0) > 0) {
    ctx.logger.info(`[USAGE] tokens: in=${inputTokens} out=${outputTokens} cost=$${costUsd} source=${costSource} model=${modelUsed}`);
  }
  if (costSource === 'unpriced') {
    ctx.logger.warn(`[USAGE] UNPRICED model "${modelUsed}" (AIHub, in=${inputTokens} out=${outputTokens}) — cấu hình giá tại Settings > Bảng giá Model.`);
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
    costSource,
  };
}
