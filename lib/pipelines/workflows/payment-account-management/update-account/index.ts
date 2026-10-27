// lib/pipelines/workflows/payment-account-management/update-account/index.ts
// Runner for mode = "update" (cập nhật tài khoản). Stage-driven:
//   metadata.stage ∈ { classification, extraction, e2e } (default e2e)
//
// Reuses the shared classification + extraction engines (same taxonomy/schemas as
// open-account); only validation differs per mode (see ./validate — stubbed for now,
// so e2e = classification + extraction, no validation yet).
//
// CONTRACT: file_id is the UNIQUE per-document key. Callers may supply it via
// file_urls[].file_id; when absent we assign a stable temp id ("tmp_<uuid>") and
// persist it, so EVERY document has a file_id. Any mapping MUST key off file_id.

import crypto from 'crypto';
import { eq } from 'drizzle-orm';

import { type WorkflowContext, updateProgress } from '@/lib/pipelines/workflow-engine';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';

import type { PamMetadata } from '../shared/types';
import { ACCOUNT_DOCUMENTS } from '../shared/documents';
import { ACCOUNT_EXTRACT_SCHEMAS } from '../shared/extract-schemas';
import { classifyAccountFiles, classifyDocumentTypes } from '../shared/classify-engine';
import { extractDocuments } from '../shared/extract-engine';
import { parseUpdateBankData } from './parse-bank-data';
import { verifyUpdateAccount } from './validate';

type UpdateAccountStage = 'classification' | 'extraction' | 'e2e';
const STAGES = ['classification', 'extraction', 'e2e'] as const;

// update-account requires the MB03 form ("Giấy đề nghị cập nhật thông tin và dịch vụ").
// After classification: if MB03 is absent → stop (no extract/validate). Only MB03 is
// extracted; other classified docs are ignored by extraction/e2e.
const REQUIRED_CODE = 'MB03';
const EXTRACT_ONLY_CODES = ['MB03'];

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

export async function runUpdateAccount(
  ctx: WorkflowContext,
  metadata: PamMetadata,
): Promise<unknown> {
  const { logger } = ctx;

  const rawStage = metadata.stage ?? 'e2e';
  if (!STAGES.includes(rawStage as UpdateAccountStage)) {
    throw new Error(
      `INVALID_INPUT: "metadata.stage" phải ∈ ${JSON.stringify(STAGES)}. Nhận được: ${JSON.stringify(rawStage)}.`,
    );
  }
  const stage = rawStage as UpdateAccountStage;
  logger.info(`[PAM:update-account] stage=${stage}`);

  // ── classify (shared by classification / extraction / e2e) ──────────────────
  // Ensure every doc has a file_id before anything keys off it.
  await ensureFileIds(ctx);

  await updateProgress(ctx, 20, 'Phân loại tài liệu...');
  const classified = classifyAccountFiles(ctx.filesData);

  // Documents to process = the pdf + image buckets, selected by file_id.
  const docIds = new Set(
    [...classified.pdfs, ...classified.images].map((f) => f.file_id),
  );
  const docs = ctx.filesData.filter((f) => docIds.has(f.file_id));

  await updateProgress(ctx, 40, `Nhận diện loại tài liệu (${docs.length} tài liệu)...`);
  const classifications = await classifyDocumentTypes(ctx, docs, ACCOUNT_DOCUMENTS);

  if (stage === 'classification') {
    await updateProgress(ctx, 90, 'Hoàn tất phân loại.');
    return {
      stage,
      documents: classifications,
      summary: {
        pdfs: classified.pdfs.length,
        images: classified.images.length,
        excels: classified.excels.length,
        others: classified.others.length,
      },
    };
  }

  const classByFileId = new Map(classifications.map((c) => [c.file_id, c.classification]));

  // ── Required-document gate (extraction / e2e only) ──────────────────────────
  // update-account needs the MB03 form. If none was classified as MB03, stop here
  // and report the requirement — do NOT extract or validate.
  const hasRequired = classifications.some((c) => c.classification.code === REQUIRED_CODE);
  if (!hasRequired) {
    logger.info(`[PAM:update-account] Required document ${REQUIRED_CODE} not found — skipping extraction.`);
    await updateProgress(ctx, 90, `Thiếu tài liệu bắt buộc ${REQUIRED_CODE}.`);
    return {
      stage,
      status: 'REQUIRED_DOCUMENT_MISSING',
      required_code: REQUIRED_CODE,
      message:
        `Tính năng cập nhật tài khoản yêu cầu tài liệu ${REQUIRED_CODE} ` +
        `(Giấy đề nghị cập nhật thông tin và dịch vụ). Không tìm thấy trong hồ sơ.`,
      documents: classifications, // what WAS found, for context
    };
  }

  // ── extract ONLY the required/allowed codes (e.g. MB03) ─────────────────────
  const docsToExtract = docs
    .filter((f) => EXTRACT_ONLY_CODES.includes(classByFileId.get(f.file_id ?? null)?.code ?? ''))
    .map((f) => {
      const cls = classByFileId.get(f.file_id ?? null);
      return {
        ...f,
        code: cls?.code ?? 'unknown',
        classificationTitle: cls?.title,
      };
    });

  await updateProgress(ctx, 55, `Trích xuất ${docsToExtract.length} tài liệu...`);
  const extracted = await extractDocuments(ctx, docsToExtract, ACCOUNT_EXTRACT_SCHEMAS);

  // ── extraction / e2e: same per-file shape ───────────────────────────────────
  await updateProgress(ctx, 75, 'Tổng hợp dữ liệu...');
  const documents = extracted.map((item) => ({
    file_id: item.file_id,
    name: item.name,
    classification: classByFileId.get(item.file_id ?? null) ?? null,
    extracted: item.extracted,
    ...(item.error ? { error: item.error } : {}),
  }));

  // extraction stage → return as-is (bank data is not relevant here).
  if (stage === 'extraction') {
    await updateProgress(ctx, 90, 'Hoàn tất trích xuất.');
    return { stage, documents };
  }

  // ── e2e: reconcile MB03 ↔ core-bank data (metadata.data) ────────────────────
  // metadata.data is the account data from the bank system, needed to reconcile
  // against the extracted MB03. It is a SOFT requirement: if missing we still
  // return classification + extraction, and flag `data_status: BANK_DATA_MISSING`
  // instead of running the compare.
  //
  // When present: parseUpdateBankData narrows it into UpdateAccountBankData
  // (throws INVALID_INPUT on wrong-shape declared fields — bubbles up to
  // failWorkflow), then verifyUpdateAccount runs the per-field compare against
  // every extracted MB03 document. Each MB03 document carries its own
  // `validation` block in the response.
  const hasBankData =
    metadata.data != null && typeof metadata.data === 'object' && !Array.isArray(metadata.data);

  if (!hasBankData) {
    await updateProgress(ctx, 90, 'Hoàn tất e2e (thiếu dữ liệu core bank).');
    return {
      stage,
      documents,
      data_status: 'BANK_DATA_MISSING',
      warning:
        'Dữ liệu tài khoản từ hệ thống ngân hàng (metadata.data) chưa được cung cấp — ' +
        'không thể đối chiếu với tài liệu trích xuất.',
    };
  }

  const bankData = parseUpdateBankData(metadata.data);

  // Run LLM verify per MB03 doc IN SERIES rather than Promise.all — the verify
  // connector shares BullMQ concurrency with extraction; parallel here would
  // just queue behind itself. Typically there's one MB03 anyway.
  // verifyUpdateAccount mutates doc.extracted in place (attaches per-leaf
  // `validation` arrays) and returns the doc-level envelope.
  await updateProgress(ctx, 80, `Đối chiếu MB03 với dữ liệu core bank...`);
  const documentsWithValidation = [];
  for (const doc of documents) {
    const validation = await verifyUpdateAccount(ctx, doc.extracted, bankData);
    documentsWithValidation.push({ ...doc, validation });
  }

  await updateProgress(ctx, 90, 'Hoàn tất e2e.');
  return {
    stage,
    documents: documentsWithValidation,
    bank_data: bankData,
  };
}
