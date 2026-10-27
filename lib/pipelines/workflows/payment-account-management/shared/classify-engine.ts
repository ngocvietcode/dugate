// lib/pipelines/workflows/payment-account-management/shared/classify-engine.ts
// Shared classification engine for payment-account-management modes (open / update / ...).
//   1. classifyAccountFiles   — file-type gate (must have a PDF or image).
//   2. classifyDocumentTypes  — per-document LLM classification → {code,title,...}.
// The document taxonomy is passed in, so this engine is mode-agnostic.

import crypto from 'crypto';

import {
  type WorkflowContext,
  enqueueSubStep,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';
import { getStorageBackend } from '@/lib/storage';

import {
  classifyFiles,
  type ClassifiedFiles,
  type PamFileData,
} from './file-classify';
import { type DocumentType, fillTitle } from './documents';
import {
  buildClassifyPrompt,
  buildSplitClassifySystemPrompt,
  renderSplitPrompt,
  type SplitMessage,
} from './prompts/doc-prompts';
import { getPageCount } from './page-count';
import { clamp01, removeVietnameseDiacritics } from './utils';

// Max attempts for the split classifier's validate-and-retry loop.
const SPLIT_MAX_ATTEMPTS = 3;

// Connector slug for the AI classification step (same one disbursement uses).
const CLASSIFY_CONNECTOR = 'ext-classifier';

// ─── Classification types ──────────────────────────────────────────────────────

/**
 * Final classification result for ONE document (returned to the client).
 * - code:             the matched document type (e.g. "MB02"), or "unknown"
 * - title:            display name, with any <slot> placeholders already filled
 * - confidence: how sure the LLM is, 0..1
 * - reason:           short Vietnamese sentence explaining why this code was chosen
 */
export interface DocClassification {
  code: string;
  title: string;
  confidence: number;
  reason: string;
}

/**
 * Raw shape the classifier LLM returns for one document (internal only).
 * `fields` holds the values used to fill the title's <slot> placeholders
 * (e.g. { ho_ten: "Nguyễn Văn A", so_giay_to: "038..." }); empty {} for
 * static titles that have no placeholders.
 */
export interface LlmClassifyResponse {
  code: string;
  confidence: number;
  reason: string;
  fields: Record<string, unknown>;
}

/** One document's file_id paired with its classification result. */
export interface DocClassifyItem {
  file_id: string | null;
  /** Original uploaded filename, so callers can map results to files[] uploads
   *  (which have a server-assigned tmp file_id, not a caller-supplied one). */
  name: string;
  classification: DocClassification;
}

/**
 * One detected sub-document inside a mixed-scan file (feature: enable_document_splitting).
 * Same fields as DocClassification plus the explicit list of pages this document
 * occupies. Pages are 1-based and may be NON-CONTIGUOUS (e.g. [1, 4] for a 2-sided
 * ID card whose sides landed on non-adjacent pages).
 */
export interface DocSegment extends DocClassification {
  pages: number[];
}

/** One file's file_id paired with the segments detected inside it. */
export interface DocSegmentItem {
  file_id: string | null;
  name: string;
  segments: DocSegment[];
  /** Set only when the segments came from a repaired/fallback result (e.g. the
   *  LLM never returned a valid page partition after all retries). */
  warning?: string;
}

/**
 * The classification-stage output record for ONE document — the SAME shape for
 * both modes:
 *   - No-split: file_id/name are the real uploaded file's; no `source`.
 *   - Split:    each detected sub-document becomes its own record with a GENERATED
 *               file_id ("seg_<uuid>") and a derived `name`, plus a `source` block
 *               pointing back to the parent scan file and the pages it came from.
 * A split file therefore yields several records that all share the same
 * `source.file_id` (the parent).
 */
export interface ClassifiedDoc {
  file_id: string | null;
  name: string;
  classification: DocClassification;
  /** Present only for split segments — provenance to the parent scan file. */
  source?: { file_id: string | null; name: string; pages: number[] };
  /** Present only when a split file's page partition was auto-repaired after retries. */
  warning?: string;
}

/**
 * Build a segment's display name as "<codeAcronym>-<normalized title>".
 * codeAcronym: a multi-part code (has "_" or "-") collapses to the first letter
 * of each part, uppercased (can_cuoc_cong_dan → CCCD); a single-part code is kept
 * as-is (MB02, passport). The title is de-accented, lowercased, and non-alphanumeric
 * runs become single hyphens. Name is cosmetic — file_id is the real unique key.
 *
 * When there is no real title — the fallback "unknown" segment uses title "N/A" —
 * the name is just the code (e.g. "unknown"), not "unknown-n-a".
 */
function makeSegmentName(code: string, title: string): string {
  const acronym = /[_-]/.test(code)
    ? code.split(/[_-]/).map((part) => part.charAt(0).toUpperCase()).join('')
    : code;

  // Treat "N/A" / empty as "no title" so fallback names stay clean.
  const hasTitle = title.trim() !== '' && title.trim().toUpperCase() !== 'N/A';
  const slug = hasTitle
    ? removeVietnameseDiacritics(title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics → one hyphen
        .replace(/^-+|-+$/g, '')     // trim leading/trailing hyphens
    : '';

  return slug ? `${acronym}-${slug}` : acronym;
}

// ─── File-type gate ────────────────────────────────────────────────────────────

/**
 * Classify incoming files and enforce the account-document combo:
 * at least one PDF or image (the application form).
 * Throws INVALID_INPUT (Vietnamese) so failWorkflow surfaces it to the client.
 */
export function classifyAccountFiles(files: PamFileData[]): ClassifiedFiles {
  const classified = classifyFiles(files ?? []);

  const documentCount = classified.pdfs.length + classified.images.length;
  if (documentCount === 0) {
    throw new Error(
      'INVALID_INPUT: Cần ít nhất 1 file PDF hoặc ảnh (đơn/tài liệu). ' +
        'Không tìm thấy tài liệu hợp lệ nào.',
    );
  }

  return classified;
}

// ─── Document-type classification (LLM) ────────────────────────────────────────

/**
 * Turn a raw LLM response into a final DocClassification:
 * validate the code, then build the title from its template + extracted fields.
 * Falls back to a safe "unknown" result if the response is malformed.
 */
function toClassification(
  raw: unknown,
  docByCode: Map<string, DocumentType>,
): DocClassification {
  const r = (raw ?? {}) as Partial<LlmClassifyResponse>;
  const code = typeof r.code === 'string' ? r.code : 'unknown';

  // Look up the title template for this code. Unknown/invalid code → "N/A" title.
  const doc = docByCode.get(code);
  const fields = (r.fields && typeof r.fields === 'object' ? r.fields : {}) as Record<string, unknown>;
  const title = doc ? fillTitle(doc.title, fields) : 'N/A';

  return {
    code: doc ? code : 'unknown',
    title,
    // Clamp confidence into 0..1; default to 0 if the LLM omitted it.
    confidence: clamp01(Number(r.confidence)),
    reason: typeof r.reason === 'string' ? r.reason : '',
  };
}

/**
 * Classify each document with one LLM call against the given taxonomy.
 *
 * Runs all documents in parallel (Promise.all) because they are independent —
 * this keeps a large dossier fast. Each call is isolated: if one document fails,
 * it becomes an "unknown" result with the error reason instead of aborting the
 * whole batch. Results are keyed by file_id (the unique per-document key).
 */
export async function classifyDocumentTypes(
  ctx: WorkflowContext,
  docs: Array<PamFileData & { file_id?: string; s3Key?: string }>,
  documents: DocumentType[],
): Promise<DocClassifyItem[]> {
  const { logger } = ctx;

  // Code → document type, so we can find the title template.
  const docByCode = new Map(documents.map((d) => [d.code, d]));

  // Resolve the storage backend once so we can check each file exists before
  // spending an LLM call on it.
  const backend = await getStorageBackend();

  return Promise.all(
    docs.map(async (doc): Promise<DocClassifyItem> => {
      const fileId = doc.file_id ?? null;
      const singleFileJson = JSON.stringify([doc]);

      // Guard: the file must actually exist in storage before we classify it.
      // The engine resolves a file by `s3Key ?? path`, so we check the same key.
      // If it is missing (e.g. CSP download failed / file was cleaned up), skip
      // the LLM call and return an error result instead of wasting a request.
      const storageKey = doc.s3Key ?? doc.path;
      const fileExists = storageKey
        ? await backend.exists(storageKey).catch(() => false)
        : false;
      if (!fileExists) {
        const reason = `File không tồn tại trong storage (key=${storageKey ?? 'none'}).`;
        logger.error(`[PAM:classify] Skip classify for "${doc.name}": ${reason}`);
        return {
          file_id: fileId,
          name: doc.name,
          classification: { code: 'unknown', title: 'N/A', confidence: 0, reason },
        };
      }

      try {
        const promptVars = buildClassifyPrompt(documents, doc.name, ctx.promptOverrides.classify);
        const result = await enqueueSubStep(
          ctx,
          CLASSIFY_CONNECTOR,
          promptVars,
          singleFileJson,
          ctx.modelOverrides.classify,
          ctx.reasoningEffortOverrides.classify,
        );

        // parseDeep unwraps any ```json fences / double-escaped JSON from the AI.
        const parsed = parseDeep(result.content);
        return { file_id: fileId, name: doc.name, classification: toClassification(parsed, docByCode) };
      } catch (err) {
        // One document failing must not stop the rest — record it as unknown.
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[PAM:classify] Classify failed for "${doc.name}": ${msg}`);
        return {
          file_id: fileId,
          name: doc.name,
          classification: { code: 'unknown', title: 'N/A', confidence: 0, reason: msg },
        };
      }
    }),
  );
}

// ─── Split-aware document-type classification (LLM) ──────────────────────────────

/**
 * Sanitize ONE segment's raw page list against the file's real page count.
 * - coerce to integers, drop non-positive / out-of-bounds pages, dedupe, sort.
 * - `pageCount == null` (unreadable file): keep positive integers as given, since
 *   we have no upper bound to validate against.
 * Never throws. Returns [] when nothing valid remains (caller decides what to do).
 */
function sanitizePages(raw: unknown, pageCount: number | null): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const p of raw) {
    const n = Math.trunc(Number(p));
    if (!Number.isFinite(n) || n < 1) continue;
    if (pageCount != null && n > pageCount) continue;
    seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Turn the sanitized segments into a page→segment partition:
 * every page is owned by EXACTLY ONE segment. When the LLM assigns a page to
 * two segments, the higher-confidence segment keeps it (ties: earlier segment).
 * Mutates each segment's `pages` in place; drops segments left with no pages.
 */
function dedupePagesAcrossSegments(segments: DocSegment[]): DocSegment[] {
  const owner = new Map<number, DocSegment>();
  // Process by descending confidence so the more certain segment wins a shared page.
  const ordered = [...segments].sort((a, b) => b.confidence - a.confidence);
  for (const seg of ordered) {
    const kept: number[] = [];
    for (const page of seg.pages) {
      if (!owner.has(page)) {
        owner.set(page, seg);
        kept.push(page);
      }
    }
    seg.pages = kept.sort((a, b) => a - b);
  }
  // Preserve the LLM's original ordering; drop now-empty segments.
  return segments.filter((s) => s.pages.length > 0);
}

/** Pull the raw segments array out of a parsed LLM response ({ segments: [...] }). */
function parseRawSegments(content: string): unknown[] {
  const parsed = parseDeep(content);
  return parsed && typeof parsed === 'object' && Array.isArray((parsed as { segments?: unknown }).segments)
    ? (parsed as { segments: unknown[] }).segments
    : [];
}

/**
 * Validate the LLM's raw segments against the file's REAL page count — this is the
 * guard that catches hallucinated pages (a page the PDF does not have), pages the
 * LLM assigned to two documents, and pages it forgot to assign. Returns a list of
 * human-readable problems (empty = valid). Used to decide whether to retry.
 *
 * Skipped when pageCount is null (unreadable file) — we have no ground truth to
 * check against, so we cannot say the answer is wrong.
 */
function validateSegments(rawSegments: unknown[], pageCount: number | null): string[] {
  const problems: string[] = [];
  if (rawSegments.length === 0) {
    problems.push('No documents were detected (the "segments" array was empty).');
    return problems;
  }
  if (pageCount == null) return problems; // no ground truth → cannot validate

  const bad: number[] = [];          // pages that do not exist in the file
  const seenCount = new Map<number, number>(); // page → how many segments claim it
  for (const raw of rawSegments) {
    const pages = Array.isArray((raw as { pages?: unknown })?.pages)
      ? (raw as { pages: unknown[] }).pages
      : [];
    for (const p of pages) {
      const n = Math.trunc(Number(p));
      if (!Number.isFinite(n) || n < 1 || n > pageCount) {
        bad.push(Number(p));
      } else {
        seenCount.set(n, (seenCount.get(n) ?? 0) + 1);
      }
    }
  }

  if (bad.length > 0) {
    problems.push(
      `These page numbers do not exist — the file has only ${pageCount} page(s) ` +
        `(1..${pageCount}): [${bad.join(', ')}].`,
    );
  }
  const duplicated = [...seenCount.entries()].filter(([, c]) => c > 1).map(([p]) => p);
  if (duplicated.length > 0) {
    problems.push(`These pages were assigned to more than one document: [${duplicated.sort((a, b) => a - b).join(', ')}]. Each page belongs to exactly one document.`);
  }
  const missing: number[] = [];
  for (let p = 1; p <= pageCount; p++) if (!seenCount.has(p)) missing.push(p);
  if (missing.length > 0) {
    problems.push(`These pages were not assigned to any document: [${missing.join(', ')}]. Every page must belong to exactly one document.`);
  }
  return problems;
}

/** Turn raw LLM segments into typed DocSegments (code-validate + title + sanitize). */
function buildSegments(
  rawSegments: unknown[],
  docByCode: Map<string, DocumentType>,
  pageCount: number | null,
): DocSegment[] {
  return rawSegments.map((raw) => {
    const cls = toClassification(raw, docByCode);
    const r = (raw ?? {}) as { pages?: unknown };
    return { ...cls, pages: sanitizePages(r.pages, pageCount) };
  });
}

/**
 * Repair-and-partition a set of segments so the result is always usable, even
 * after retries are exhausted: dedupe shared pages (a page → one segment) then
 * bucket any unassigned pages into a trailing "unknown" segment. Never drops a page.
 */
function repairPartition(
  segments: DocSegment[],
  pageCount: number | null,
): DocSegment[] {
  const partitioned = dedupePagesAcrossSegments(segments);
  if (pageCount != null) {
    const assigned = new Set(partitioned.flatMap((s) => s.pages));
    const leftover: number[] = [];
    for (let p = 1; p <= pageCount; p++) if (!assigned.has(p)) leftover.push(p);
    if (leftover.length > 0) {
      partitioned.push({
        code: 'unknown',
        title: 'N/A',
        confidence: 0,
        reason: `Trang chưa được gán cho tài liệu nào: ${leftover.join(', ')}.`,
        pages: leftover,
      });
    }
  }
  return partitioned;
}

/**
 * Classify each FILE into one-or-more page-ranged segments (feature:
 * enable_document_splitting). One LLM call per file returns all its sub-documents.
 *
 * VALIDATE-AND-RETRY (LangGraph-style messages state), per file:
 *   1. Guard: file must exist in storage (skip → single unknown segment).
 *   2. Read the real page count (page-count pre-pass) — the ground truth.
 *   3. messages = [ system prompt ]. Then up to SPLIT_MAX_ATTEMPTS times:
 *        a. render messages → ONE _prompt, call the LLM.
 *        b. validate the returned pages against the real page count.
 *        c. valid → build + return segments.
 *        d. invalid → append the LLM's answer + the specific error to messages,
 *           and retry (only the messages thread grows — one dynamic parameter).
 *   4. Retries exhausted → repair the last answer (dedupe + leftover bucket) and
 *      return it with a warning, so the workflow always continues.
 *
 * Runs all files in parallel, isolated: one file failing yields a single unknown
 * segment for that file, never aborting the batch. Keyed by file_id.
 */
export async function classifyDocumentSegments(
  ctx: WorkflowContext,
  docs: Array<PamFileData & { file_id?: string; s3Key?: string }>,
  documents: DocumentType[],
): Promise<ClassifiedDoc[]> {
  const { logger } = ctx;

  const docByCode = new Map(documents.map((d) => [d.code, d]));
  const backend = await getStorageBackend();

  // Each file may split into several documents, so every file yields an ARRAY of
  // ClassifiedDoc; we flatten them into one list at the end.
  const perFile = await Promise.all(
    docs.map(async (doc): Promise<ClassifiedDoc[]> => {
      const fileId = doc.file_id ?? null;

      // Turn this file's detected segments into first-class ClassifiedDoc records:
      // a generated seg_<uuid> id, a derived name, and a `source` block pointing
      // back to THIS file (the parent) and the pages the segment came from.
      const toEntries = (segments: DocSegment[], warning?: string): ClassifiedDoc[] =>
        segments.map((s) => ({
          file_id: `seg_${crypto.randomUUID()}`,
          name: makeSegmentName(s.code, s.title),
          classification: { code: s.code, title: s.title, confidence: s.confidence, reason: s.reason },
          source: { file_id: fileId, name: doc.name, pages: s.pages },
          ...(warning ? { warning } : {}),
        }));

      // Single "unknown" segment fallback — used on skip/parse failure. Uses the
      // known page range when available, else page 1, so a file is never dropped.
      const fallback = (reason: string, pageCount: number | null, warning?: string): ClassifiedDoc[] =>
        toEntries(
          [
            {
              code: 'unknown',
              title: 'N/A',
              confidence: 0,
              reason,
              pages: pageCount != null ? Array.from({ length: pageCount }, (_, i) => i + 1) : [1],
            },
          ],
          warning,
        );

      // 1. Guard: file must exist before we spend page-count + LLM work on it.
      const storageKey = doc.s3Key ?? doc.path;
      const fileExists = storageKey
        ? await backend.exists(storageKey).catch(() => false)
        : false;
      if (!fileExists) {
        const reason = `File không tồn tại trong storage (key=${storageKey ?? 'none'}).`;
        logger.error(`[PAM:split-classify] Skip for "${doc.name}": ${reason}`);
        return fallback(reason, null);
      }

      // 2. Page-count pre-pass: real bounds for the LLM + validation ground truth.
      const pageCount = await getPageCount(doc, ctx.operationId);

      const singleFileJson = JSON.stringify([doc]);
      // 3. messages thread — starts with the static system prompt. Only this grows
      //    across retries (the single dynamic parameter fed back to the LLM).
      const messages: SplitMessage[] = [
        { role: 'system', content: buildSplitClassifySystemPrompt(documents, doc.name, pageCount) },
      ];
      let lastRawSegments: unknown[] = [];

      for (let attempt = 1; attempt <= SPLIT_MAX_ATTEMPTS; attempt++) {
        try {
          const promptVars = renderSplitPrompt(messages, doc.name, ctx.promptOverrides.classify);
          const result = await enqueueSubStep(
            ctx,
            CLASSIFY_CONNECTOR,
            promptVars,
            singleFileJson,
            ctx.modelOverrides.classify,
            ctx.reasoningEffortOverrides.classify,
          );

          const content = result.content ?? '';
          const rawSegments = parseRawSegments(content);
          lastRawSegments = rawSegments;

          // 3b. GUARD: check the LLM's pages against the file's real page count.
          const problems = validateSegments(rawSegments, pageCount);
          if (problems.length === 0) {
            const segments = repairPartition(buildSegments(rawSegments, docByCode, pageCount), pageCount);
            if (segments.length === 0) {
              return fallback('Không có trang hợp lệ nào sau khi kiểm tra.', pageCount);
            }
            logger.info(`[PAM:split-classify] "${doc.name}" valid on attempt ${attempt} (${segments.length} segment(s)).`);
            return toEntries(segments);
          }

          // Invalid → append the answer + the specific error, then retry.
          logger.warn(`[PAM:split-classify] "${doc.name}" attempt ${attempt} invalid: ${problems.join(' ')}`);
          if (attempt < SPLIT_MAX_ATTEMPTS) {
            messages.push({ role: 'assistant', content });
            messages.push({ role: 'error', content: problems.join('\n') });
          }
        } catch (err) {
          // A transport/parse error on one attempt: record it as an error message
          // and retry (same as a validation failure) rather than aborting the file.
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[PAM:split-classify] "${doc.name}" attempt ${attempt} threw: ${msg}`);
          if (attempt < SPLIT_MAX_ATTEMPTS) {
            messages.push({ role: 'error', content: `The previous call failed: ${msg}. Return a valid JSON object.` });
          }
        }
      }

      // 4. Retries exhausted → repair the last answer so the file still yields
      //    usable segments, flagged with a warning.
      const warning = `Không nhận được kết quả tách hợp lệ sau ${SPLIT_MAX_ATTEMPTS} lần thử; đã tự động sửa.`;
      logger.error(`[PAM:split-classify] "${doc.name}": ${warning}`);
      const repaired = repairPartition(buildSegments(lastRawSegments, docByCode, pageCount), pageCount);
      if (repaired.length === 0) {
        return fallback(warning, pageCount, warning);
      }
      return toEntries(repaired, warning);
    }),
  );

  // Flatten: each file contributed an array of ClassifiedDoc (one per segment).
  return perFile.flat();
}
