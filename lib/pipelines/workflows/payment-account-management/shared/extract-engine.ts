// lib/pipelines/workflows/payment-account-management/shared/extract-engine.ts
// Shared extraction engine for payment-account-management modes (open / update / ...).
//
// Each document was already classified into a `code`. Here we look up that code's
// schema, ask the AI to read its fields from the file, then merge in any hard-coded
// fixed fields. Runs one document per LLM call, in parallel, with per-document
// error isolation. Results are keyed by file_id (the unique per-document key).
// The schema registry is passed in, so this engine is mode-agnostic.

import {
  type WorkflowContext,
  enqueueSubStep,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';
import { getStorageBackend } from '@/lib/storage';

import type { PamFileData } from './file-classify';
import {
  buildFixedFields,
  fieldTypeOf,
  getExtractSchema,
  isMultiCallSchema,
  validateGroupKeyUniqueness,
  type ExtractSchema,
  type ExtractSchemaRegistry,
  type FieldSpec,
  type MultiCallExtractSchema,
} from './schemas';
import {
  parseFieldConfidence,
  validateExtractedTypes,
  formatTypeViolations,
  EXTRACT_TYPE_MISMATCH_ERROR_PREFIX,
} from './utils';
import {
  buildExtractSystemPrompt,
  buildExtractSystemPromptForGroup,
  renderExtractPrompt,
  type ExtractRetryMessage,
} from './prompts/doc-prompts';

// Connector slug for the AI extraction step (same one disbursement uses).
const EXTRACT_CONNECTOR = 'ext-data-extractor';

// ── Extract retry policy ────────────────────────────────────────────────────
// Applies to every extraction call — single-call schemas (MB01, DKKD, IDs, …)
// AND per-group calls of a MultiCallExtractSchema (MB02). Retry uses the same
// LangGraph messages-thread pattern as the split classifier (see
// classify-engine.ts::classifyDocumentSegments) so both retry loops share one
// mental model.

/** Max attempts per extract call before we surface it as failed. */
const MAX_EXTRACT_ATTEMPTS = 3;
/** Fixed backoff (ms) between failed extract-call attempts. */
const EXTRACT_RETRY_BACKOFF_MS = 500;

/**
 * Parse an LLM extraction response into a plain JSON object.
 *
 * Accepts `string | null` to match the shape of `enqueueSubStep(...).content`.
 * `parseDeep` unwraps ```json fences and double-escaped JSON; anything that is
 * not a non-null object (null, array, primitive) is a retry-worthy failure and
 * throws EXTRACT_PARSE_FAILED so the retry loop can catch it. Distinct from
 * the single-call path, which silently falls back to `{}` — for a multi-call
 * schema we would rather try again than pretend the group returned no data.
 */
function parseExtractedObject(raw: string | null): Record<string, unknown> {
  if (raw === null || raw.trim() === '') {
    throw new Error('EXTRACT_PARSE_FAILED: LLM returned empty content');
  }
  const parsed = parseDeep(raw);
  if (parsed === null || parsed === undefined) {
    throw new Error('EXTRACT_PARSE_FAILED: LLM returned null/undefined');
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    const kind = Array.isArray(parsed) ? 'array' : typeof parsed;
    throw new Error(`EXTRACT_PARSE_FAILED: LLM returned a non-object (${kind})`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Post-process pass applied to the confidence-wrapped field map produced by
 * `runExtractCallWithRetry`.  For every declared field whose type is `object`
 * or `object[]` AND that is absent / null in `wrapped`, replace the null with
 * an all-null stub so downstream consumers always see the expected key shape:
 *
 *   object[]  → [{ key1: null, key2: null, ... }]   (one-element array)
 *   object    → { key1: null, key2: null, ... }      (plain object)
 *
 * Only fields that declare `recordLabels` are processed — without recordLabels
 * there is no canonical set of sub-keys to fill.
 *
 * Exported for unit testing; not part of the public API surface.
 */
export function fillObjectFieldStubs(
  wrapped: Record<string, unknown>,
  aiFields: readonly FieldSpec[],
): void {
  for (const f of aiFields) {
    const fType = fieldTypeOf(f);
    if (fType !== 'object[]' && fType !== 'object') continue;
    if (wrapped[f.key] !== null && wrapped[f.key] !== undefined) continue;
    if (!f.recordLabels) continue;
    const stub = Object.fromEntries(
      Object.keys(f.recordLabels).map((k) => [k, null]),
    );
    wrapped[f.key] = fType === 'object[]' ? [stub] : stub;
  }
}

/**
 * Run ONE extract call with up to MAX_EXTRACT_ATTEMPTS retries, driven by a
 * LangGraph-style messages thread that grows on each failure.
 *
 * Message thread flow, per attempt:
 *   1. messages starts as `[{ role: 'system', content: systemPrompt }]`.
 *   2. renderExtractPrompt collapses the thread into ONE `_prompt` string.
 *   3. enqueueSubStep sends it, waits for the LLM.
 *   4a. Success → parseExtractedObject validates the shape → return wrapped fields.
 *   4b. Failure → append the LLM's raw reply (if available) as an "assistant"
 *       message and the error text as an "error" message, sleep, retry.
 *
 * Retry is triggered by:
 *  - any exception from enqueueSubStep (transient LLM 5xx / timeout / network),
 *  - parseExtractedObject throwing (LLM returned non-JSON or non-object output).
 *
 * On success we keep only the keys DECLARED in aiFields (any extra key the LLM
 * invented is silently dropped — defense in depth against one call's answer
 * colliding with a peer call's declared keys, e.g. across groups of a multi-
 * call schema).
 *
 * On exhaustion we return a failure envelope; the caller decides how to surface
 * it (single-call → doc's extracted becomes null with an error; multi-call →
 * that group's declared keys become null and its error joins the doc envelope).
 *
 * `logTag` is a short human-readable label used only in log lines, e.g.
 * `"extraction"` for a whole-doc single call or `` `group "${g.name}"` `` for a
 * per-group multi-call.
 */
async function runExtractCallWithRetry(
  ctx: WorkflowContext,
  doc: DocToExtract,
  systemPrompt: string,
  aiFields: FieldSpec[],
  logTag: string,
): Promise<
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const singleFileJson = JSON.stringify([doc]);
  const allowed = new Set(aiFields.map((f) => f.key));
  // Declared type per key — drives the shape parseFieldConfidence produces
  // (notably string[], which is wrapped as one field-level value).
  const typeByKey = new Map(aiFields.map((f) => [f.key, fieldTypeOf(f)]));
  const messages: ExtractRetryMessage[] = [
    { role: 'system', content: systemPrompt },
  ];
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_EXTRACT_ATTEMPTS; attempt++) {
    let lastContent: string | null = null;
    try {
      const promptVars = renderExtractPrompt(
        messages,
        doc.name,
        ctx.promptOverrides.extract,
      );
      const result = await enqueueSubStep(
        ctx,
        EXTRACT_CONNECTOR,
        promptVars,
        singleFileJson,
        ctx.modelOverrides.extract,
        ctx.reasoningEffortOverrides.extract,
      );
      lastContent = result.content;

      // Throws on empty / null / non-object output → caught below → retried.
      const parsed = parseExtractedObject(lastContent);

      // Shape check every declared field BEFORE confidence-parsing so a type
      // mismatch surfaces as a retryable error (with the offending fields named)
      // rather than silently producing garbage-shaped output. The retry-loop
      // catch below feeds the violations back to the LLM with a targeted fix
      // prompt. On the FINAL attempt we skip validation and accept whatever
      // came back — parseFieldConfidence has fallback recoveries (e.g. a
      // `string[]` returned as `;`-separated string is split into an array),
      // and a partially-shaped extraction beats losing the whole group.
      if (attempt < MAX_EXTRACT_ATTEMPTS) {
        const violations = validateExtractedTypes(parsed, aiFields);
        if (violations.length > 0) {
          throw new Error(
            EXTRACT_TYPE_MISMATCH_ERROR_PREFIX + formatTypeViolations(violations),
          );
        }
      } else {
        const violations = validateExtractedTypes(parsed, aiFields);
        if (violations.length > 0) {
          ctx.logger.warn(
            `[PAM:extract] ${logTag} (doc="${doc.name}") accepted final answer with ${violations.length} type mismatch(es) after ${MAX_EXTRACT_ATTEMPTS} attempts: ${formatTypeViolations(violations)}`,
          );
        }
      }

      const wrapped: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(parsed)) {
        if (!allowed.has(key)) continue;
        try {
          wrapped[key] = parseFieldConfidence(val, typeByKey.get(key));
        } catch {
          wrapped[key] = { value: val, confidence: null };
        }
      }

      // Post-process: ensure object / object[] fields that came back as null
      // (or were omitted entirely) always have the full key structure present.
      fillObjectFieldStubs(wrapped, aiFields);

      return { ok: true, fields: wrapped };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      ctx.logger.warn(
        `[PAM:extract] ${logTag} (doc="${doc.name}") attempt ${attempt}/${MAX_EXTRACT_ATTEMPTS} failed: ${lastError}`,
      );
      if (attempt < MAX_EXTRACT_ATTEMPTS) {
        // Feed the previous answer back so the LLM can self-correct. On a pure
        // transport failure (enqueueSubStep threw), we have no assistant text —
        // skip the assistant message and let the error alone drive the retry.
        if (lastContent && lastContent.trim() !== '') {
          messages.push({ role: 'assistant', content: lastContent });
        }
        // A type-mismatch failure gets a specifically tailored correction
        // prompt naming the offending fields; every other error (parse fail,
        // transport 5xx) uses the generic "return bare JSON" retry text.
        const isTypeMismatch = lastError.startsWith(EXTRACT_TYPE_MISMATCH_ERROR_PREFIX);
        const violationsList = isTypeMismatch
          ? lastError.slice(EXTRACT_TYPE_MISMATCH_ERROR_PREFIX.length)
          : '';
        messages.push({
          role: 'error',
          content: isTypeMismatch
            ? `The previous response had TYPE MISMATCHES on these fields: ${violationsList}. ` +
              `For EACH listed field, return the JSON type declared in the FIELDS TO EXTRACT list ` +
              `(shown as "(type=X)" above the description) and mirrored in the OUTPUT SHAPE skeleton. ` +
              `Array-typed fields MUST be JSON arrays — never strings, never ";"-joined values. ` +
              `Object-typed fields MUST be JSON objects. Boolean fields MUST be true / false. ` +
              `When there is no data for the field on the document, use null (not "", not [], not {}). ` +
              `Fix ONLY the listed fields and keep every other field EXACTLY as you returned it. ` +
              `Return ONE bare JSON object with the corrected keys, no markdown, no explanation.`
            : `The previous call failed: ${lastError}. ` +
              `Return ONE bare JSON object with the required keys, no markdown, no explanation.`,
        });
        await new Promise((r) => setTimeout(r, EXTRACT_RETRY_BACKOFF_MS));
      }
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Multi-call extraction — one LLM call per group, in parallel, each with its
 * own retry loop. Merges the group outputs into a single wrapped-field object
 * (keys are globally unique across groups, enforced by
 * validateGroupKeyUniqueness at the call site).
 *
 * A group that exhausts its retries does NOT abort the whole document —
 * its declared keys land as `null` and its error is returned separately for
 * the outer function to surface on the DocExtraction envelope.
 */
async function extractDocumentMultiCall(
  ctx: WorkflowContext,
  doc: DocToExtract,
  code: string,
  schema: MultiCallExtractSchema,
): Promise<{ extracted: Record<string, unknown>; groupErrors: string[] }> {
  const groupCount = schema.groups.length;
  const groupResults = await Promise.all(
    schema.groups.map((g, i) => {
      const systemPrompt = buildExtractSystemPromptForGroup(
        code, doc.name, g, i, groupCount,
      );
      return runExtractCallWithRetry(
        ctx, doc, systemPrompt, g.aiFields, `group "${g.name}"`,
      );
    }),
  );

  const extracted: Record<string, unknown> = {};
  const groupErrors: string[] = [];
  for (let i = 0; i < groupResults.length; i++) {
    const r = groupResults[i];
    const g = schema.groups[i];
    if (r.ok) {
      Object.assign(extracted, r.fields);
    } else {
      groupErrors.push(`[${g.name}] ${r.error}`);
      for (const f of g.aiFields) extracted[f.key] = null;
    }
  }
  return { extracted, groupErrors };
}

/** A document to extract: a file plus the code it was classified as. */
export type DocToExtract = PamFileData & {
  file_id?: string;
  s3Key?: string;
  code: string;
  // Title from the classification step (e.g. "Nguyễn Văn A - 038..."). When set,
  // it overrides the schema's fixed title; otherwise the fixed title is used.
  classificationTitle?: string;
};

/**
 * Extraction result for ONE document.
 * - code:      the document type this was extracted as
 * - extracted: the field values, each wrapped as { value, confidence } (null when
 *              the code is unsupported or the file could not be read)
 * - error:     a short reason when extraction was skipped/failed (optional)
 */
export interface DocExtraction {
  file_id: string | null;
  /** Original uploaded filename, so callers can map results to files[] uploads
   *  (which have a server-assigned tmp file_id, not a caller-supplied one). */
  name: string;
  code: string;
  // Each top-level scalar field is wrapped as { value, confidence }; array/object
  // fields are plain containers whose leaves are wrapped (see parseFieldConfidence).
  // Value type is `unknown` to allow both shapes.
  extracted: Record<string, unknown> | null;
  error?: string;
}

/**
 * Extract fields from each document using its code's schema (from the given registry).
 *
 * For every document:
 *   1. Look up the schema for its code. No schema yet → skip (return null).
 *   2. Guard: the file must exist in storage, else skip (no wasted LLM call).
 *   3. Dispatch on schema shape — both branches use runExtractCallWithRetry,
 *      the same MAX_EXTRACT_ATTEMPTS messages-thread retry loop:
 *      - MultiCallExtractSchema → one LLM call per group in parallel; on any
 *        group's retry exhaustion its declared keys land as null with an error.
 *      - Single-call ExtractSchema → one LLM call for the whole document; on
 *        retry exhaustion the doc lands as extracted: null with an error.
 *   4. Merge in the schema's fixed fields (hard-coded, not read from the file)
 *      and override `title` with the classification title when available.
 *
 * A failure on one document does not stop the others. On a multi-call schema,
 * a failure on one GROUP does not stop the other groups.
 */
export async function extractDocuments(
  ctx: WorkflowContext,
  docs: DocToExtract[],
  schemaRegistry: ExtractSchemaRegistry,
): Promise<DocExtraction[]> {
  const { logger } = ctx;

  // Resolve the storage backend once (shared by the file-exists guard below).
  const backend = await getStorageBackend();

  return Promise.all(
    docs.map(async (doc): Promise<DocExtraction> => {
      const fileId = doc.file_id ?? null;
      const { code } = doc;

      // 1. Find the schema for this document type.
      const schema = getExtractSchema(schemaRegistry, code);
      if (!schema) {
        const error = `Chưa hỗ trợ trích xuất cho loại "${code}".`;
        logger.info(`[PAM:extract] Skip extract for "${doc.name}": ${error}`);
        return { file_id: fileId, name: doc.name, code, extracted: null, error };
      }

      // 2. Guard: the file must exist in storage before we spend an LLM call.
      //    The engine resolves a file by `s3Key ?? path`, so we check the same key.
      const storageKey = doc.s3Key ?? doc.path;
      const fileExists = storageKey
        ? await backend.exists(storageKey).catch(() => false)
        : false;
      if (!fileExists) {
        const error = `File không tồn tại trong storage (key=${storageKey ?? 'none'}).`;
        logger.error(`[PAM:extract] Skip extract for "${doc.name}": ${error}`);
        return { file_id: fileId, name: doc.name, code, extracted: null, error };
      }

      // 3. Multi-call fork — one LLM call per group in parallel, each with the
      //    same messages-thread retry loop as the single-call branch below.
      //    Reachable only for MultiCallExtractSchema; single-call codes fall
      //    through. The isMultiCallSchema guard narrows `schema` to ExtractSchema
      //    for the fallthrough branch.
      if (isMultiCallSchema(schema)) {
        try {
          validateGroupKeyUniqueness(schema); // catches authoring mistakes early
          const { extracted, groupErrors } =
            await extractDocumentMultiCall(ctx, doc, code, schema);

          // Merge fixed fields + classification title — identical to the single-
          // call path so downstream consumers cannot tell the two apart.
          for (const [key, value] of Object.entries(buildFixedFields(schema))) {
            extracted[key] = { value, confidence: 1 };
          }
          const classificationTitle = doc.classificationTitle?.trim();
          if (classificationTitle) {
            extracted.title = { value: classificationTitle, confidence: 1 };
          }

          return {
            file_id: fileId,
            name: doc.name,
            code,
            extracted,
            ...(groupErrors.length > 0
              ? {
                  error:
                    `Trích xuất một số nhóm thất bại sau ${MAX_EXTRACT_ATTEMPTS} lần thử: ` +
                    groupErrors.join('; '),
                }
              : {}),
          };
        } catch (err) {
          // Only reached for setup errors (e.g. validateGroupKeyUniqueness
          // throwing on a bad schema). Group-call failures inside
          // extractDocumentMultiCall are already caught by the retry loop and
          // reported via groupErrors, so they cannot land here.
          const error = err instanceof Error ? err.message : String(err);
          logger.error(`[PAM:extract] Multi-call extract crashed for "${doc.name}": ${error}`);
          return { file_id: fileId, name: doc.name, code, extracted: null, error };
        }
      }

      // 4. Single-call path — one LLM call per document, with the SAME messages-
      //    thread retry loop as the multi-call groups. Applies to every code that
      //    uses a single-call ExtractSchema: MB01, DKKD, IDs, WebCA, phieu_thu_phi,
      //    quyet_dinh_bo_nhiem_ktt, etc. (schema is narrowed to ExtractSchema
      //    below by the preceding isMultiCallSchema guard.)
      const singleCallSchema = schema as ExtractSchema;
      const systemPrompt = buildExtractSystemPrompt(code, doc.name, singleCallSchema);
      const result = await runExtractCallWithRetry(
        ctx,
        doc,
        systemPrompt,
        singleCallSchema.aiFields,
        'extraction',
      );

      if (!result.ok) {
        const error =
          `Trích xuất thất bại sau ${MAX_EXTRACT_ATTEMPTS} lần thử: ${result.error}`;
        logger.error(`[PAM:extract] "${doc.name}": ${error}`);
        return { file_id: fileId, name: doc.name, code, extracted: null, error };
      }

      const extracted: Record<string, unknown> = { ...result.fields };

      // Merge in the schema's hard-coded fixed fields. These are code-injected
      // constants (not AI-read) → certain, confidence 1. They overwrite AI fields.
      for (const [key, value] of Object.entries(buildFixedFields(singleCallSchema))) {
        extracted[key] = { value, confidence: 1 };
      }

      // Prefer the classification title when available; otherwise keep the
      // schema's fixed default title. Title is code-set → confidence 1.
      const classificationTitle = doc.classificationTitle?.trim();
      if (classificationTitle) {
        extracted.title = { value: classificationTitle, confidence: 1 };
      }

      return { file_id: fileId, name: doc.name, code, extracted };
    }),
  );
}
