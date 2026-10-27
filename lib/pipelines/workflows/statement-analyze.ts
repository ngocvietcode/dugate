// lib/pipelines/workflows/statement-analyze.ts
// Workflow: Phân tích Sao kê Ngân hàng (Statement Analyze)
//
// DAG:
//   Step 0: Classify + gom file PDF                         [code-only]
//   Step 1: Split → OCR theo batch → merge                  [LLM vision]
//   Step 2: Tính toán phân tích số dư                      [TypeScript]
//   Step 3: Enrichment/sanitization + entity resolution     [TypeScript]
//   Step 4: Revenue rules + selective LLM (confidence < 85) [hybrid]
//   Step 5: Fraud/anomaly detection                         [TypeScript libraries]
//
// Đầu vào : 1+ file PDF sao kê (cùng 1 tài khoản).
// Đầu ra  : StatementAnalysisResult + artifacts enrichment/revenue/fraud additive.
//
// Mô phỏng cấu trúc PDF branch của payroll-verify.

import { Readable } from 'stream';
import { PDFDocument } from 'pdf-lib';

import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  completeWorkflow,
  failWorkflow,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';

import {
  type StatementJSON,
  type StatementPageJSON,
  type StatementTransaction,
  type StatementAccountInfo,
  buildStatementPageOcrPrompt,
  buildStatementBatchOcrPrompt,
  buildRevenueAdjudicationPrompt,
  createEmptyAccountInfo,
  createEmptyPage,
} from './prompts/statement-analyze-prompts';

import { analyzeStatement } from './statement-analyze-calc';
import {
  enrichStatementTransactions,
  normalizeRevenueByRules,
  getRevenueReviewCandidates,
  applyRevenueAdjudication,
  detectFraudAndAnomalies,
  applyFraudExclusionsToRevenue,
  revenueAdjudicationSchema,
  type RevenueAdjudicationDecision,
  type RevenueNormalizationResult,
} from './statement-analyze-intelligence';
import { getStorageBackend } from '@/lib/storage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileData {
  name: string;
  path: string;
  mime: string;
  size: number;
}

const PDF_EXTENSIONS = ['.pdf'];
const PDF_MIMES = ['application/pdf'];

// ─── File resolution ────────────────────────────────────────────────────────────

async function readFileBuffer(filePath: string): Promise<Buffer> {
  const backend = await getStorageBackend();
  const stream = await backend.download(filePath);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx < 0 ? '' : fileName.slice(idx).toLowerCase();
}

/** Step 0: chỉ chấp nhận file PDF. Trả về danh sách PDF hợp lệ. */
export function classifyStatementFiles(
  filesData: Array<{ name: string; path: string; mime: string; size: number }>,
): FileData[] {
  if (!filesData || filesData.length === 0) {
    throw new Error('INVALID_INPUT: Không có file nào. Cần ít nhất 1 file PDF sao kê.');
  }
  const pdfFiles: FileData[] = [];
  for (const file of filesData) {
    const ext = getExtension(file.name);
    const mime = (file.mime || '').toLowerCase();
    if (PDF_EXTENSIONS.includes(ext) || PDF_MIMES.includes(mime)) {
      pdfFiles.push(file);
    } else {
      throw new Error(`INVALID_INPUT: File "${file.name}" không phải PDF. Chỉ nhận sao kê PDF.`);
    }
  }
  return pdfFiles;
}

// ─── PDF splitting ────────────────────────────────────────────────────────────────

export async function splitPdf(pdfBuffer: Buffer): Promise<Buffer[]> {
  let srcDoc: PDFDocument;
  try {
    srcDoc = await PDFDocument.load(pdfBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF_SPLIT_FAILED: Không thể đọc file PDF: ${msg}`);
  }

  const pageCount = srcDoc.getPageCount();
  if (pageCount === 0) throw new Error('PDF_EMPTY: File PDF không có trang nào.');

  try {
    const buffers: Buffer[] = [];
    for (let i = 0; i < pageCount; i++) {
      const newDoc = await PDFDocument.create();
      const [copied] = await newDoc.copyPages(srcDoc, [i]);
      newDoc.addPage(copied);
      buffers.push(Buffer.from(await newDoc.save()));
    }
    return buffers;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF_SPLIT_FAILED: Lỗi khi tách trang PDF: ${msg}`);
  }
}

// ─── Per-page OCR ────────────────────────────────────────────────────────────────

interface PageOcrResult {
  pageIndex: number;
  status: 'success' | 'empty' | 'error';
  data: StatementPageJSON;
  reason?: string;
}

function isValidPageJson(parsed: unknown): parsed is StatementPageJSON {
  return !!parsed && typeof parsed === 'object' &&
    ('transactions' in parsed || 'account_info' in parsed);
}

/**
 * Fallback khi parseDeep thất bại: AI đôi khi kèm lời dẫn/markdown quanh JSON.
 * Cắt phần từ dấu "{" đầu tiên tới "}" cuối cùng rồi thử parse lại.
 */
function extractJsonObject(content: string | null | undefined): StatementPageJSON | null {
  if (!content) return null;
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(content.slice(first, last + 1));
    return isValidPageJson(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function ocrSinglePage(
  ctx: WorkflowContext,
  pageBuffer: Buffer,
  pdfName: string,
  pageIndex: number,
  totalPages: number,
): Promise<PageOcrResult> {
  const { logger } = ctx;
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 3000;
  const empty = (): StatementPageJSON => ({
    account_info: createEmptyAccountInfo(),
    opening_balance: null,
    closing_balance: null,
    transactions: [],
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const backend = await getStorageBackend();
      const pageKey = `${ctx.operationId}/pages/page_${pageIndex + 1}.pdf`;
      await backend.upload(pageKey, Readable.from(pageBuffer), { contentType: 'application/pdf' });

      const pageFileData = [{
        name: `${pdfName}_page_${pageIndex + 1}.pdf`,
        path: pageKey,
        mime: 'application/pdf',
        size: pageBuffer.length,
      }];

      const promptVars = buildStatementPageOcrPrompt(
        pageIndex, totalPages, ctx.promptOverrides.ocr, resolveExtraInstruction(ctx.pipelineVars),
      );
      const result = await enqueueSubStep(
        ctx, 'ext-doc-layout', promptVars, JSON.stringify(pageFileData), ctx.modelOverrides.ocr,
        ctx.reasoningEffortOverrides.ocr,
      );

      logger.info(`[STATEMENT] Page ${pageIndex + 1}/${totalPages} OCR (attempt ${attempt}): ${(result.content || '').length} chars`);

      const contentStr = (result.content || '').toLowerCase();
      if (contentStr.includes('xin lỗi') || contentStr.includes('không thể') ||
          contentStr.includes('i cannot') || contentStr.includes("i'm sorry")) {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        return { pageIndex, status: 'error', reason: 'AI từ chối xử lý (safety filter)', data: empty() };
      }

      let parsed = parseDeep(result.content);
      if (!isValidPageJson(parsed)) {
        // Fallback: thử cắt JSON ra khỏi phần text thừa (lời dẫn/markdown) trước khi bỏ cuộc.
        const salvaged = extractJsonObject(result.content);
        if (salvaged) {
          logger.warn(`[STATEMENT] Page ${pageIndex + 1}: salvaged JSON from noisy AI response.`);
          parsed = salvaged;
        }
      }
      if (!isValidPageJson(parsed)) {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        return { pageIndex, status: 'error', reason: 'AI trả response không phải JSON hợp lệ', data: empty() };
      }

      const data: StatementPageJSON = {
        account_info: { ...createEmptyAccountInfo(), ...(parsed.account_info || {}) },
        opening_balance: parsed.opening_balance ?? null,
        closing_balance: parsed.closing_balance ?? null,
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      };
      const status: PageOcrResult['status'] = data.transactions.length > 0 ? 'success' : 'empty';
      return { pageIndex, status, data, reason: status === 'empty' ? 'Trang không có giao dịch' : undefined };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        logger.warn(`[STATEMENT] Page ${pageIndex + 1} error (attempt ${attempt}): ${errMsg.substring(0, 100)}, retrying...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      logger.error(`[STATEMENT] Page ${pageIndex + 1}/${totalPages} OCR failed: ${errMsg}`);
      return { pageIndex, status: 'error', reason: `Lỗi hệ thống: ${errMsg.substring(0, 120)}`, data: empty() };
    }
  }
  return { pageIndex, status: 'error', reason: 'unknown', data: empty() };
}

// ─── Merge ────────────────────────────────────────────────────────────────────────

/**
 * Gộp kết quả OCR từ tất cả trang → StatementJSON.
 * - account_info: lấy giá trị non-null đầu tiên theo thứ tự trang.
 * - opening_balance: từ trang đầu có ghi; closing_balance: từ trang cuối có ghi.
 * - transactions: nối theo thứ tự trang (giữ nguyên thứ tự dòng để tính balance-chain).
 */
export function mergeStatementPages(
  pageResults: Array<{ pageIndex: number; data: StatementPageJSON }>,
): StatementJSON {
  const sorted = [...pageResults].sort((a, b) => a.pageIndex - b.pageIndex);

  const info: StatementAccountInfo = createEmptyAccountInfo();
  for (const p of sorted) {
    const ai = p.data.account_info;
    if (!ai) continue;
    for (const key of Object.keys(info) as Array<keyof StatementAccountInfo>) {
      const cur = info[key];
      const isEmpty = cur === null || cur === undefined || cur === '';
      const val = ai[key];
      if (isEmpty && val !== null && val !== undefined && val !== '') {
        // @ts-expect-error – gán theo key động, cùng shape.
        info[key] = val;
      }
    }
  }

  let openingBalance: string | null = null;
  for (const p of sorted) {
    if (p.data.opening_balance != null && String(p.data.opening_balance).trim() !== '') {
      openingBalance = p.data.opening_balance;
      break;
    }
  }
  let closingBalance: string | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].data.closing_balance != null && String(sorted[i].data.closing_balance).trim() !== '') {
      closingBalance = sorted[i].data.closing_balance;
      break;
    }
  }

  const transactions: StatementTransaction[] = sorted.flatMap((p) => p.data.transactions || []);

  // Gộp ghi chú OCR (trang bị bỏ qua...) theo thứ tự trang.
  const ocrNotes: string[] = sorted.flatMap((p) =>
    (p.data.ocr_notes || []).map((n) => String(n).trim()).filter((n) => n !== ''),
  );

  // total_pages_label: ưu tiên nhãn "Trang x/N" đọc được; fallback = số trang xử lý.
  if (info.total_pages_label == null) {
    info.total_pages_label = sorted.length;
  }

  return {
    account_info: info,
    opening_balance: openingBalance,
    closing_balance: closingBalance,
    ocr_notes: ocrNotes.length > 0 ? ocrNotes : null,
    transactions,
  };
}

// ─── PDF branch (batched OCR) ──────────────────────────────────────────────────

interface PageInfo {
  /** Số trang (1-based) hoặc dải trang của lô, vd "1–5". */
  page: number | string;
  pdf_name: string;
  status: 'success' | 'empty' | 'error';
  transactions_extracted: number;
  reason?: string;
}

interface ProcessingInfo {
  total_pages: number;
  success_pages: number;
  empty_pages: number;
  error_pages: number;
  /** Số lô OCR đã gửi tới model. */
  total_batches: number;
  /** Số trang tối đa mỗi lô (cấu hình). */
  pages_per_batch: number;
  pages: PageInfo[];
}

interface BatchUnit {
  buffer: Buffer;      // PDF gồm các trang startPage..endPage
  pdfName: string;
  startPage: number;   // global 1-based
  endPage: number;     // global 1-based, inclusive
  pageCount: number;
}

interface BatchOcrResult {
  pdfName: string;
  startPage: number;
  endPage: number;
  pageCount: number;
  status: 'success' | 'empty' | 'error';
  data: StatementPageJSON;
  reason?: string;
}

const DEFAULT_PAGES_PER_BATCH = 3;
const MAX_PAGES_PER_BATCH = 25;

/** Đọc pages_per_batch từ pipelineVars, kẹp [1, MAX], mặc định 5. */
function resolvePagesPerBatch(pipelineVars: Record<string, unknown>): number {
  const raw = pipelineVars?.pages_per_batch;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGES_PER_BATCH;
  return Math.min(Math.floor(n), MAX_PAGES_PER_BATCH);
}

const MAX_EXTRA_INSTRUCTION_LEN = 2000;

/** Đọc chỉ thị bổ sung của người dùng từ pipelineVars (cắt bớt nếu quá dài). */
function resolveExtraInstruction(pipelineVars: Record<string, unknown>): string | undefined {
  const raw = pipelineVars?.extra_instruction;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_EXTRA_INSTRUCTION_LEN);
}

/** Tách 1 PDF nguồn thành các PDF con, mỗi PDF ≤ pagesPerBatch trang. */
async function splitPdfIntoBatches(
  pdfBuffer: Buffer,
  pagesPerBatch: number,
): Promise<Array<{ buffer: Buffer; pageCount: number }>> {
  let srcDoc: PDFDocument;
  try {
    srcDoc = await PDFDocument.load(pdfBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF_SPLIT_FAILED: Không thể đọc file PDF: ${msg}`);
  }
  const pageCount = srcDoc.getPageCount();
  if (pageCount === 0) throw new Error('PDF_EMPTY: File PDF không có trang nào.');

  const out: Array<{ buffer: Buffer; pageCount: number }> = [];
  try {
    for (let start = 0; start < pageCount; start += pagesPerBatch) {
      const end = Math.min(start + pagesPerBatch, pageCount);
      const indices: number[] = [];
      for (let i = start; i < end; i++) indices.push(i);
      const newDoc = await PDFDocument.create();
      const copied = await newDoc.copyPages(srcDoc, indices);
      copied.forEach((p) => newDoc.addPage(p));
      out.push({ buffer: Buffer.from(await newDoc.save()), pageCount: end - start });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF_SPLIT_FAILED: Lỗi khi tách lô trang PDF: ${msg}`);
  }
  return out;
}

/** Xoá 1 file tạm trên storage (non-fatal). */
async function cleanupKey(ctx: WorkflowContext, key: string): Promise<void> {
  try {
    const backend = await getStorageBackend();
    await backend.deleteMany([key]);
  } catch (err) {
    ctx.logger.warn(`[STATEMENT] Cleanup temp file failed (non-fatal): ${key}`, undefined, err);
  }
}

/** OCR một LÔ nhiều trang trong 1 call. Parse lỗi sau retry → fallback OCR từng trang. */
async function ocrBatch(
  ctx: WorkflowContext,
  batch: BatchUnit,
  totalPages: number,
): Promise<BatchOcrResult> {
  const { logger } = ctx;
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 3000;
  const label = batch.startPage === batch.endPage
    ? `trang ${batch.startPage}`
    : `trang ${batch.startPage}–${batch.endPage}`;
  const batchKey = `${ctx.operationId}/batches/batch_${batch.startPage}_${batch.endPage}.pdf`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const backend = await getStorageBackend();
      await backend.upload(batchKey, Readable.from(batch.buffer), { contentType: 'application/pdf' });

      const fileData = [{
        name: `${batch.pdfName}_p${batch.startPage}-${batch.endPage}.pdf`,
        path: batchKey,
        mime: 'application/pdf',
        size: batch.buffer.length,
      }];
      const promptVars = buildStatementBatchOcrPrompt(
        batch.startPage, batch.endPage, totalPages, ctx.promptOverrides.ocr, resolveExtraInstruction(ctx.pipelineVars),
      );
      const result = await enqueueSubStep(
        ctx, 'ext-doc-layout', promptVars, JSON.stringify(fileData), ctx.modelOverrides.ocr,
        ctx.reasoningEffortOverrides.ocr,
      );

      logger.info(`[STATEMENT] Batch ${label} OCR (attempt ${attempt}): ${(result.content || '').length} chars`);

      const contentStr = (result.content || '').toLowerCase();
      const refused = contentStr.includes('xin lỗi') || contentStr.includes('không thể') ||
        contentStr.includes('i cannot') || contentStr.includes("i'm sorry");

      let parsed = parseDeep(result.content);
      if (!isValidPageJson(parsed)) {
        const salvaged = extractJsonObject(result.content);
        if (salvaged) {
          logger.warn(`[STATEMENT] Batch ${label}: salvaged JSON from noisy AI response.`);
          parsed = salvaged;
        }
      }

      if (refused || !isValidPageJson(parsed)) {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        logger.warn(`[STATEMENT] Batch ${label}: parse thất bại sau ${MAX_ATTEMPTS} lần → fallback OCR từng trang.`);
        await cleanupKey(ctx, batchKey);
        return ocrBatchFallbackPerPage(ctx, batch, totalPages);
      }

      const data: StatementPageJSON = {
        account_info: { ...createEmptyAccountInfo(), ...(parsed.account_info || {}) },
        opening_balance: parsed.opening_balance ?? null,
        closing_balance: parsed.closing_balance ?? null,
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      };
      await cleanupKey(ctx, batchKey);
      const status: BatchOcrResult['status'] = data.transactions.length > 0 ? 'success' : 'empty';
      return {
        pdfName: batch.pdfName,
        startPage: batch.startPage,
        endPage: batch.endPage,
        pageCount: batch.pageCount,
        status,
        data,
        reason: status === 'empty' ? 'Lô không có giao dịch' : undefined,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        logger.warn(`[STATEMENT] Batch ${label} error (attempt ${attempt}): ${errMsg.substring(0, 100)}, retrying...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      logger.error(`[STATEMENT] Batch ${label} OCR failed: ${errMsg} → fallback OCR từng trang.`);
      await cleanupKey(ctx, batchKey);
      return ocrBatchFallbackPerPage(ctx, batch, totalPages);
    }
  }
  await cleanupKey(ctx, batchKey);
  return ocrBatchFallbackPerPage(ctx, batch, totalPages);
}

/** Fallback: tách lô thành từng trang, OCR riêng từng trang rồi gộp lại. */
async function ocrBatchFallbackPerPage(
  ctx: WorkflowContext,
  batch: BatchUnit,
  totalPages: number,
): Promise<BatchOcrResult> {
  const { logger } = ctx;
  let pages: Buffer[];
  try {
    pages = await splitPdf(batch.buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[STATEMENT] Fallback split lô ${batch.startPage}-${batch.endPage} lỗi: ${msg}`);
    return {
      pdfName: batch.pdfName, startPage: batch.startPage, endPage: batch.endPage, pageCount: batch.pageCount,
      status: 'error', data: createEmptyPage(), reason: `Fallback tách trang lỗi: ${msg.substring(0, 100)}`,
    };
  }

  const results: PageOcrResult[] = [];
  for (let i = 0; i < pages.length; i++) {
    const globalPageIndex = batch.startPage - 1 + i;
    results.push(await ocrSinglePage(ctx, pages[i], batch.pdfName, globalPageIndex, totalPages));
    await cleanupKey(ctx, `${ctx.operationId}/pages/page_${globalPageIndex + 1}.pdf`);
  }

  const combined = mergeStatementPages(results.map((r) => ({ pageIndex: r.pageIndex, data: r.data })));
  const anyError = results.some((r) => r.status === 'error');
  const status: BatchOcrResult['status'] =
    combined.transactions.length > 0 ? 'success' : (anyError ? 'error' : 'empty');

  return {
    pdfName: batch.pdfName,
    startPage: batch.startPage,
    endPage: batch.endPage,
    pageCount: batch.pageCount,
    status,
    data: combined,
    reason: 'Đã fallback OCR từng trang' + (anyError ? ' (có trang lỗi)' : ''),
  };
}

async function processPdfBranch(
  ctx: WorkflowContext,
  pdfFiles: FileData[],
): Promise<{ data: StatementJSON; processing_info: ProcessingInfo }> {
  const { logger } = ctx;
  const pagesPerBatch = resolvePagesPerBatch(ctx.pipelineVars);

  // Xây danh sách lô từ mọi PDF (giữ thứ tự file → trang). Lô KHÔNG vắt qua nhiều file.
  const batches: BatchUnit[] = [];
  let pagesSeen = 0;
  for (const pdfFile of pdfFiles) {
    const buf = await readFileBuffer(pdfFile.path);
    const fileBatches = await splitPdfIntoBatches(buf, pagesPerBatch);
    for (const fb of fileBatches) {
      const startPage = pagesSeen + 1;
      const endPage = pagesSeen + fb.pageCount;
      batches.push({ buffer: fb.buffer, pdfName: pdfFile.name, startPage, endPage, pageCount: fb.pageCount });
      pagesSeen += fb.pageCount;
    }
    logger.info(`[STATEMENT] PDF "${pdfFile.name}" → ${fileBatches.length} lô (≤ ${pagesPerBatch} trang/lô)`);
  }

  const totalPages = pagesSeen;
  const totalBatches = batches.length;
  const STAGGER_DELAY_MS = 3000;
  let completed = 0;

  await updateProgress(ctx, 10,
    `Bắt đầu OCR ${totalPages} trang theo ${totalBatches} lô (≤ ${pagesPerBatch} trang/lô, stagger 3s).`);

  const batchResults: BatchOcrResult[] = await Promise.all(
    batches.map(async (batch, bi): Promise<BatchOcrResult> => {
      if (bi > 0) await new Promise((r) => setTimeout(r, bi * STAGGER_DELAY_MS));
      const label = batch.startPage === batch.endPage
        ? `trang ${batch.startPage}`
        : `trang ${batch.startPage}–${batch.endPage}`;
      await updateProgress(ctx, Math.round(10 + (bi / totalBatches) * 55),
        `OCR lô ${bi + 1}/${totalBatches} (${label}) — bắt đầu`);

      const res = await ocrBatch(ctx, batch, totalPages);

      completed++;
      await updateProgress(ctx, Math.round(10 + (completed / totalBatches) * 55),
        `OCR lô ${bi + 1}/${totalBatches} (${label}) xong (${res.status}, ${res.data.transactions.length} GD) [${completed}/${totalBatches}]`);
      return res;
    }),
  );

  // Merge theo thứ tự lô (startPage tăng dần, các lô không chồng lấn).
  const merged = mergeStatementPages(batchResults.map((b) => ({ pageIndex: b.startPage, data: b.data })));

  // mergeStatementPages fallback total_pages_label = số phần tử merge (giờ là số LÔ).
  // Nếu model không đọc được nhãn "Trang x/N" ở bất kỳ lô nào → ép về số TRANG thật.
  const anyPageLabel = batchResults.some((b) => b.data.account_info.total_pages_label != null);
  if (!anyPageLabel) {
    merged.account_info.total_pages_label = totalPages;
  }

  const pages: PageInfo[] = batchResults.map((b) => ({
    page: b.startPage === b.endPage ? b.startPage : `${b.startPage}–${b.endPage}`,
    pdf_name: b.pdfName,
    status: b.status,
    transactions_extracted: b.data.transactions.length,
    ...(b.reason ? { reason: b.reason } : {}),
  }));

  const sumPagesByStatus = (st: BatchOcrResult['status']) =>
    batchResults.filter((b) => b.status === st).reduce((s, b) => s + b.pageCount, 0);

  const processing_info: ProcessingInfo = {
    total_pages: totalPages,
    success_pages: sumPagesByStatus('success'),
    empty_pages: sumPagesByStatus('empty'),
    error_pages: sumPagesByStatus('error'),
    total_batches: totalBatches,
    pages_per_batch: pagesPerBatch,
    pages,
  };

  return { data: merged, processing_info };
}

// ─── Selective LLM revenue adjudication ───────────────────────────────────────

const REVENUE_LLM_BATCH_SIZE = 50;

async function adjudicateAmbiguousRevenue(
  ctx: WorkflowContext,
  revenue: RevenueNormalizationResult,
  transactions: StatementTransaction[],
  enrichment: ReturnType<typeof enrichStatementTransactions>,
): Promise<RevenueNormalizationResult> {
  const candidates = getRevenueReviewCandidates(revenue, transactions, enrichment);
  if (candidates.length === 0) return revenue;

  const decisions: RevenueAdjudicationDecision[] = [];
  let failed = 0;
  for (let start = 0; start < candidates.length; start += REVENUE_LLM_BATCH_SIZE) {
    const batch = candidates.slice(start, start + REVENUE_LLM_BATCH_SIZE);
    const allowedIds = new Set(batch.map((item) => String(item.transaction_id)));
    try {
      const result = await enqueueSubStep(
        ctx,
        'ext-content-gen',
        buildRevenueAdjudicationPrompt(batch, ctx.promptOverrides.revenue_adjudication),
        null,
        ctx.modelOverrides.revenue_adjudication,
        ctx.reasoningEffortOverrides.revenue_adjudication,
      );
      const parsed = revenueAdjudicationSchema.safeParse(parseDeep(result.content));
      if (!parsed.success) {
        failed += batch.length;
        ctx.logger.warn(`[STATEMENT] Revenue adjudication batch ${start / REVENUE_LLM_BATCH_SIZE + 1}: invalid JSON schema.`);
        continue;
      }
      const valid = parsed.data.decisions.filter((item) => allowedIds.has(item.transaction_id));
      decisions.push(...valid);
      failed += batch.length - new Set(valid.map((item) => item.transaction_id)).size;
    } catch (error) {
      failed += batch.length;
      ctx.logger.warn('[STATEMENT] Revenue adjudication failed; preserving rule-engine labels.', undefined, error);
    }
  }

  return applyRevenueAdjudication(revenue, transactions, decisions, candidates.length, failed);
}

// ─── Main entry point ───────────────────────────────────────────────────────────────

/**
 * Entry point đăng ký trong WORKFLOW_REGISTRY ('statement-analyze').
 * Orchestrate: classify → PDF OCR → calc → complete.
 */
export async function runStatementAnalyze(ctx: WorkflowContext): Promise<void> {
  const { logger } = ctx;
  const resumeFromStep = ctx.currentStep;

  let pdfFiles: FileData[] | undefined;
  let merged: StatementJSON | undefined;
  let processingInfo: ProcessingInfo | undefined;

  try {
    // ── Step 0: Classify ──
    if (resumeFromStep <= 0) {
      await updateProgress(ctx, 2, 'Bước 0: Phân loại file...');
      pdfFiles = classifyStatementFiles(ctx.filesData);
      ctx.stepsResult.push({
        step: 0,
        stepName: 'Phân loại file',
        processor: 'code',
        content_preview: { pdf_count: pdfFiles.length, pdf_names: pdfFiles.map((f) => f.name) },
      });
      await updateProgress(ctx, 5, `Bước 0 hoàn tất. ${pdfFiles.length} file PDF. Bắt đầu OCR.`);
    }
    if (!pdfFiles) pdfFiles = classifyStatementFiles(ctx.filesData);

    // ── Step 1: PDF OCR ──
    if (resumeFromStep <= 1) {
      const branch = await processPdfBranch(ctx, pdfFiles);
      merged = branch.data;
      processingInfo = branch.processing_info;

      if (merged.transactions.length === 0) {
        throw new Error('STATEMENT_EMPTY_DATA: Không trích xuất được giao dịch nào từ sao kê. Kiểm tra lại chất lượng file PDF.');
      }

      ctx.stepsResult.push({
        step: 1,
        stepName: 'OCR Sao kê (theo trang)',
        processor: 'ext-doc-layout',
        content_preview: {
          processing_info: processingInfo,
          transactions: merged.transactions.length,
          account_no: merged.account_info.account_no,
        },
        extracted_data: { merged, processingInfo },
      });
      await updateProgress(ctx, 70, 'Bước 1 hoàn tất. Bắt đầu tính toán.');
    }

    // ── Step 2: Calc ──
    if (resumeFromStep <= 2) {
      await updateProgress(ctx, 75, 'Tính toán số dư nền trước khi chuẩn hóa dữ liệu...');

      if (!merged || !processingInfo) {
        const step1 = ctx.stepsResult.find((s) => s.step === 1);
        const data = step1?.extracted_data as { merged?: StatementJSON; processingInfo?: ProcessingInfo } | undefined;
        merged = data?.merged;
        processingInfo = data?.processingInfo;
        if (!merged || !processingInfo) {
          throw new Error('Cannot resume step 2: missing OCR results from step 1. Please re-run.');
        }
      }

      const pageParseRatio = processingInfo.total_pages > 0
        ? (processingInfo.success_pages + processingInfo.empty_pages) / processingInfo.total_pages
        : 1;

      const baseAnalysis = analyzeStatement(merged, pageParseRatio);

      logger.info(`[STATEMENT] Analysis: ${baseAnalysis.total_transactions} GD, chu kỳ ${baseAnalysis.selected_window.start_month}–${baseAnalysis.selected_window.end_month}, OCR ratio=${baseAnalysis.ocr_success_ratio}`);

      ctx.stepsResult.push({
        step: 2,
        stage_key: 'balance_analysis',
        artifact_version: '1.0.0',
        status: 'SUCCESS',
        stepName: 'Phân tích số dư',
        processor: 'code',
        content_preview: {
          ocr_success_ratio: baseAnalysis.ocr_success_ratio,
          selected_window: baseAnalysis.selected_window,
          total_transactions: baseAnalysis.total_transactions,
        },
        extracted_data: baseAnalysis,
      });

      await updateProgress(ctx, 82, 'Bước 2: Chuẩn hóa dữ liệu và gom nhóm đối tác...');
      const enrichment = enrichStatementTransactions(baseAnalysis.data_raw, baseAnalysis.customer_name);
      ctx.stepsResult.push({
        step: 3,
        stage_key: 'statement_enrichment',
        artifact_version: enrichment.version,
        status: 'SUCCESS',
        stepName: 'Chuẩn hóa & làm giàu dữ liệu',
        processor: 'typescript',
        content_preview: enrichment.metrics,
        extracted_data: enrichment,
      });

      await updateProgress(ctx, 87, 'Bước 3: Chuẩn hóa doanh thu bằng rule engine...');
      let revenue = normalizeRevenueByRules(baseAnalysis.data_raw, enrichment);
      const reviewCount = getRevenueReviewCandidates(revenue, baseAnalysis.data_raw, enrichment).length;
      if (reviewCount > 0) {
        await updateProgress(ctx, 89, `Bước 3: Gửi ${reviewCount} giao dịch vùng xám sang LLM để phân xử...`);
        revenue = await adjudicateAmbiguousRevenue(ctx, revenue, baseAnalysis.data_raw, enrichment);
      }
      ctx.stepsResult.push({
        step: 4,
        stage_key: 'revenue_normalization',
        artifact_version: revenue.version,
        status: revenue.pending_review_transaction_ids.length > 0 ? 'WAITING_REVIEW' : 'SUCCESS',
        stepName: 'Chuẩn hóa doanh thu/thu nhập',
        processor: reviewCount > 0 ? 'typescript+ext-content-gen' : 'typescript',
        content_preview: {
          summary: revenue.summary,
          llm_adjudication: revenue.llm_adjudication,
          pending_review: revenue.pending_review_transaction_ids.length,
        },
        extracted_data: revenue,
      });

      await updateProgress(ctx, 95, 'Bước 4: Phát hiện gian lận và bất thường bằng TypeScript...');
      const fraud = detectFraudAndAnomalies(baseAnalysis, enrichment, revenue);
      revenue = applyFraudExclusionsToRevenue(revenue, baseAnalysis.data_raw, fraud);
      const analysis = {
        ...baseAnalysis,
        enrichment,
        revenue_normalization: revenue,
        fraud_detection: fraud,
      };
      ctx.stepsResult.push({
        step: 5,
        stage_key: 'fraud_anomaly_detection',
        artifact_version: fraud.version,
        status: 'SUCCESS',
        stepName: 'Phát hiện gian lận & bất thường',
        processor: 'typescript',
        content_preview: {
          findings: fraud.findings.length,
          exclusions: fraud.exclusions,
          metrics: fraud.metrics,
        },
        extracted_data: fraud,
      });
      await updateProgress(ctx, 98, 'Bước 4 hoàn tất. Đang lưu kết quả...');

      await completeWorkflow(ctx, JSON.stringify({
        ocr_success_ratio: analysis.ocr_success_ratio,
        account_no: analysis.account_no,
        total_transactions: analysis.total_transactions,
        normalized_business_revenue: revenue.summary.normalized_business_revenue_after_fraud,
        fraud_findings: fraud.findings.length,
      }), {
        request_id: ctx.pipelineVars.request_id || ctx.operationId,
        skill_code: 'bank-statement-analysis',
        status: 'SUCCESS',
        result: {
          document_processed: pdfFiles.length,
          pdf_processing_info: processingInfo,
          analysis,
        },
      });
    }
  } catch (error) {
    await failWorkflow(ctx, error);
  }
}

export type { FileData, ProcessingInfo, PageInfo };
