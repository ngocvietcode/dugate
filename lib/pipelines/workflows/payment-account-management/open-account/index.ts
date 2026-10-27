// lib/pipelines/workflows/payment-account-management/open-account/index.ts
// Runner for mode = "open" (mở tài khoản). Stage-driven:
//   metadata.stage ∈ { classification, extraction, e2e } (default e2e)
//
// CONTRACT: file_id is the UNIQUE per-document key. Callers may supply it via
// file_urls[].file_id; when absent we assign a stable temp id ("tmp_<uuid>") and
// persist it, so EVERY document has a file_id. Any mapping (extract results,
// cross-references) MUST key off file_id — never name/path/index.

import crypto from 'crypto';
import { eq } from 'drizzle-orm';

import { type WorkflowContext, updateProgress } from '@/lib/pipelines/workflow-engine';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { getStorageBackend } from '@/lib/storage';

import type { PamMetadata } from '../shared/types';
import { ACCOUNT_DOCUMENTS } from '../shared/documents';
import { ACCOUNT_EXTRACT_SCHEMAS } from '../shared/extract-schemas';
import { classifyAccountFiles, classifyDocumentTypes, classifyDocumentSegments } from '../shared/classify-engine';
import { extractDocuments } from '../shared/extract-engine';
import { cropSegment } from '../shared/crop';
// validate.ts (verifyOpenAccount) is kept for when per-document validation is
// re-enabled; it is intentionally not wired into any stage right now.

type OpenAccountStage = 'classification' | 'extraction' | 'e2e';
const STAGES = ['classification', 'extraction', 'e2e'] as const;

/**
 * Ensure every file in ctx.filesData has a file_id: keep the caller-supplied one,
 * else assign a stable temp id ("tmp_<uuid>"). Persists filesJson if any id was
 * generated so temp ids survive checkpoint/resume.
 */
async function ensureFileIds(ctx: WorkflowContext): Promise<void> {
  let mutated = false;
  for (const f of ctx.filesData) {
    if (!f.file_id) {
      f.file_id = `tmp_${crypto.randomUUID()}`;
      mutated = true;
    }
  }
  if (mutated) {
    ctx.filesJson = JSON.stringify(ctx.filesData);
    await db.update(operations)
      .set({ filesJson: ctx.filesJson })
      .where(eq(operations.id, ctx.operationId));
  }
}

export async function runOpenAccount(
  ctx: WorkflowContext,
  metadata: PamMetadata,
): Promise<unknown> {
  const { logger } = ctx;

  const rawStage = metadata.stage ?? 'e2e';
  if (!STAGES.includes(rawStage as OpenAccountStage)) {
    throw new Error(
      `INVALID_INPUT: "metadata.stage" phải ∈ ${JSON.stringify(STAGES)}. Nhận được: ${JSON.stringify(rawStage)}.`,
    );
  }
  const stage = rawStage as OpenAccountStage;
  logger.info(`[PAM:open-account] stage=${stage}`);

  // ── classify (shared by classification / extraction / e2e) ──────────────────
  // Ensure every doc has a file_id before anything keys off it.
  await ensureFileIds(ctx);

  await updateProgress(ctx, 20, 'Phân loại tài liệu...');
  const classified = classifyAccountFiles(ctx.filesData);

  // Documents to process = the pdf + image buckets. Select them from the original
  // ctx.filesData by file_id — the UNIQUE per-document key (see contract at top of
  // this file). ensureFileIds() above guarantees every file has a file_id.
  const docIds = new Set(
    [...classified.pdfs, ...classified.images].map((f) => f.file_id),
  );
  const docs = ctx.filesData.filter((f) => docIds.has(f.file_id));

  // Profile flag: when true, a single uploaded file may hold several concatenated
  // documents; the classifier detects each one and the pages it occupies. Admin
  // sets this per-Profile (registry: enable_document_splitting, defaultLocked).
  const splitEnabled = ctx.pipelineVars.enable_document_splitting === true;

  // ── SPLIT PATH: one file → many page-ranged segments ────────────────────────
  // When splitting is on we handle ALL stages here (classification / extraction /
  // e2e) and never fall through to the whole-file path below.
  if (splitEnabled) {
    await updateProgress(ctx, 40, `Nhận diện & tách tài liệu (${docs.length} file)...`);
    const segments = await classifyDocumentSegments(ctx, docs, ACCOUNT_DOCUMENTS);

    const summary = {
      pdfs: classified.pdfs.length,
      images: classified.images.length,
      excels: classified.excels.length,
      others: classified.others.length,
    };

    // classification stage: just the detected segments (no extraction).
    if (stage === 'classification') {
      await updateProgress(ctx, 90, 'Hoàn tất phân loại (đã tách tài liệu).');
      return { stage, split: true, documents: segments, summary };
    }

    // extraction / e2e: crop each segment into its own file, then extract it.
    // Parent files are keyed by file_id so we can find each segment's source file.
    const parentById = new Map(docs.map((f) => [f.file_id, f]));
    await updateProgress(ctx, 55, `Cắt & trích xuất ${segments.length} tài liệu...`);

    const cropKeys: string[] = [];
    try {
      // Crop each segment (parallel). Segments whose crop fails become null and
      // are reported as an extraction error instead of being sent to the LLM.
      const cropped = await Promise.all(
        segments.map(async (seg) => {
          const parent = seg.source ? parentById.get(seg.source.file_id ?? undefined) : undefined;
          const pages = seg.source?.pages ?? [];
          const file = parent ? await cropSegment(ctx, parent, pages, seg.file_id ?? 'seg') : null;
          // Track crop keys we created (PDF crops live under "<opId>/crops/"), so we
          // can delete them in `finally`. Image segments reuse the parent → skip.
          if (file && file.path?.includes('/crops/')) cropKeys.push(file.path);
          return { seg, file };
        }),
      );

      // Build the extract inputs from successful crops; carry the segment's code.
      const docsToExtract = cropped
        .filter((c) => c.file)
        .map((c) => ({
          ...(c.file as NonNullable<typeof c.file>),
          file_id: c.seg.file_id ?? undefined,
          code: c.seg.classification.code,
          classificationTitle: c.seg.classification.title,
        }));

      const extracted = await extractDocuments(ctx, docsToExtract, ACCOUNT_EXTRACT_SCHEMAS);
      const extractedById = new Map(extracted.map((e) => [e.file_id, e]));

      // Map back to the per-document shape: each segment keeps its classification +
      // source provenance, plus its extracted fields (or a crop/extract error).
      const documents = segments.map((seg) => {
        const ex = extractedById.get(seg.file_id ?? null);
        const cropFailed = !cropped.find((c) => c.seg === seg)?.file;
        return {
          file_id: seg.file_id,
          name: seg.name,
          classification: seg.classification,
          ...(seg.source ? { source: seg.source } : {}),
          extracted: ex?.extracted ?? null,
          ...(cropFailed
            ? { error: 'Không cắt được tài liệu con từ file gốc.' }
            : ex?.error
              ? { error: ex.error }
              : {}),
          ...(seg.warning ? { warning: seg.warning } : {}),
        };
      });

      // Envelope matches the non-split extract/e2e ({ stage, documents }) plus the
      // `split` discriminator. `summary` is intentionally omitted here — like the
      // non-split path, it belongs only to the classification stage.
      await updateProgress(ctx, 90, `Hoàn tất ${stage} (đã tách tài liệu).`);
      return { stage, split: true, documents };
    } finally {
      // Crops are throwaway intermediates — delete them whether extraction
      // succeeded or threw. Non-fatal: the 7-day storage sweep is the backstop.
      if (cropKeys.length > 0) {
        try {
          const backend = await getStorageBackend();
          await backend.deleteMany(cropKeys);
        } catch (cleanupErr) {
          logger.warn('[PAM:open-account] Dọn file crop thất bại (không nghiêm trọng)', undefined, cleanupErr);
        }
      }
    }
  }

  // ── classify: needed by classification, extraction, and e2e stages ──────────
  // Extraction picks a schema per document code, so every path classifies first.
  await updateProgress(ctx, 40, `Nhận diện loại tài liệu (${docs.length} tài liệu)...`);
  const classifications = await classifyDocumentTypes(ctx, docs, ACCOUNT_DOCUMENTS);

  if (stage === 'classification') {
    await updateProgress(ctx, 90, 'Hoàn tất phân loại.');
    return {
      stage,
      // Per-document classifications are the main payload; counts are a summary.
      documents: classifications,
      summary: {
        pdfs: classified.pdfs.length,
        images: classified.images.length,
        excels: classified.excels.length,
        others: classified.others.length,
      },
    };
  }

  // ── extract (extraction / e2e) ──────────────────────────────────────────────
  // Pair each document with its classification (full result), keyed by file_id.
  const classByFileId = new Map(classifications.map((c) => [c.file_id, c.classification]));
  const docsToExtract = docs.map((f) => {
    const cls = classByFileId.get(f.file_id ?? null);
    return {
      ...f,
      code: cls?.code ?? 'unknown',
      classificationTitle: cls?.title,
    };
  });

  await updateProgress(ctx, 55, `Trích xuất ${docsToExtract.length} tài liệu...`);
  const extracted = await extractDocuments(ctx, docsToExtract, ACCOUNT_EXTRACT_SCHEMAS);

  if (stage === 'extraction') {
    await updateProgress(ctx, 90, 'Hoàn tất trích xuất.');
    // Same per-file shape as the classification stage: each document carries its
    // full `classification` object alongside the extracted fields.
    const documents = extracted.map((item) => ({
      file_id: item.file_id,
      name: item.name,
      classification: classByFileId.get(item.file_id ?? null) ?? null,
      extracted: item.extracted,
      ...(item.error ? { error: item.error } : {}),
    }));
    return { stage, documents };
  }

  // ── e2e: classify + extract each document, keyed by file_id ─────────────────
  // NOTE: validation is temporarily disabled — e2e = classification + extraction.
  // TODO: re-enable per-document validation once the open-account rules are finalized.
  await updateProgress(ctx, 75, 'Trích xuất & tổng hợp dữ liệu (e2e)...');
  const documents = extracted.map((item) => ({
    file_id: item.file_id,
    name: item.name,
    classification: classByFileId.get(item.file_id ?? null) ?? null,
    extracted: item.extracted,
    // validation: verifyOpenAccount(item.extracted), // TODO: re-enable validation later
    ...(item.error ? { error: item.error } : {}),
  }));
  await updateProgress(ctx, 90, 'Hoàn tất e2e.');
  return { stage, documents };
}
