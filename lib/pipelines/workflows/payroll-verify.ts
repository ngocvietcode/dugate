// lib/pipelines/workflows/payroll-verify.ts
// Workflow: Đối chiếu Bảng lương (Payroll Verify)
//
// DAG:
//   Step 0: Classify files (PDF vs Excel)           [code-only]
//   Step 1A: Excel Branch (parse + AI header)       [parallel]
//   Step 1B: PDF Branch (split → OCR × N → merge)   [parallel]
//   Step 2: Compare Engine (rule-based)             [code-only]
//   Step 3: Complete workflow                        [lifecycle]
//
// Functions:
//   - classifyFiles          (Step 0)
//   - splitPdf               (Step 1B.1)
//   - mergeOcrResults        (Step 1B.3)
//   - processPdfBranch       (Step 1B)
//   - processExcelBranch     (Step 1A)
//   - runPayrollVerify       (Main entry point)

import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
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
  type PayrollJSON,
  type PayrollRecord,
  type ThongTinChung,
  type CompareConfig,
  type OcrSchemaHint,
  buildPageOcrPrompt,
  buildExcelHeaderPrompt,
  DEFAULT_COMPARE_CONFIG,
  createEmptyThongTinChung,
  ALL_TTC_FIELDS,
  ALL_RECORD_FIELDS,
  COUNTER_TTC_FIELDS,
} from './prompts/payroll-verify-prompts';

import { parsePayrollExcel, getExcelColumnHeaders, type ExcelParseResult } from './payroll-verify-excel';
import { comparePayrollData, buildDynamicCompareConfig, type SectionColumns } from './payroll-verify-compare';
import { parseMoneyValue } from './payroll-money';
import { getStorageBackend } from '@/lib/storage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileData {
  name: string;
  path: string;
  mime: string;
  size: number;
}

// ─── File Resolution ──────────────────────────────────────────────────────────

/**
 * Read a file buffer from storage backend.
 * Handles both local filesystem paths and S3 keys transparently.
 */
async function readFileBuffer(filePath: string, operationId: string): Promise<Buffer> {
  const backend = await getStorageBackend();
  const tmpDir = path.join(os.tmpdir(), 'dugate', operationId);
  const localPath = await backend.downloadToTempFile(filePath, tmpDir);
  return fsPromises.readFile(localPath);
}

// ─── File Classification ──────────────────────────────────────────────────────

const PDF_EXTENSIONS = ['.pdf'];
const EXCEL_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

const PDF_MIMES = [
  'application/pdf',
];
const EXCEL_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
];

/**
 * Step 0: Classify files by extension and MIME type into PDFs and Excel.
 * Accepts: 1+ PDF files + exactly 1 Excel file.
 * Throws with INVALID_INPUT if the combination is invalid.
 */
export function classifyFiles(
  filesData: Array<{ name: string; path: string; mime: string; size: number }>,
): { pdfFiles: FileData[]; excelFile: FileData } {
  if (!filesData || filesData.length < 2) {
    throw new Error('INVALID_INPUT: Cần ít nhất 1 file PDF và 1 file Excel. Nhận được ít hơn 2 file.');
  }

  const pdfFiles: FileData[] = [];
  let excelFile: FileData | null = null;

  for (const file of filesData) {
    const ext = getExtension(file.name);
    const mime = (file.mime || '').toLowerCase();

    const isPdfExt = PDF_EXTENSIONS.includes(ext);
    const isExcelExt = EXCEL_EXTENSIONS.includes(ext);
    const isPdfMime = PDF_MIMES.includes(mime);
    const isExcelMime = EXCEL_MIMES.includes(mime);

    if (isPdfExt || isPdfMime) {
      pdfFiles.push(file);
    } else if (isExcelExt || isExcelMime) {
      if (excelFile) {
        throw new Error('INVALID_INPUT: Nhận được nhiều hơn 1 file Excel. Cần 1+ file PDF và đúng 1 file Excel.');
      }
      excelFile = file;
    } else {
      throw new Error(
        `INVALID_INPUT: File "${file.name}" không phải PDF hoặc Excel. Extension: ${ext}, MIME: ${mime}`,
      );
    }
  }

  if (pdfFiles.length === 0) {
    throw new Error('INVALID_INPUT: Không tìm thấy file PDF. Cần ít nhất 1 file PDF và 1 file Excel.');
  }
  if (!excelFile) {
    throw new Error('INVALID_INPUT: Không tìm thấy file Excel. Cần ít nhất 1 file PDF và 1 file Excel.');
  }

  return { pdfFiles, excelFile };
}

/** Extract lowercase file extension including the dot. */
function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0) return '';
  return fileName.slice(idx).toLowerCase();
}

// ─── PDF Splitting ────────────────────────────────────────────────────────────

/**
 * Split a multi-page PDF into individual single-page PDF buffers using pdf-lib.
 * Throws PDF_EMPTY for 0 pages, PDF_SPLIT_FAILED on errors.
 */
export async function splitPdf(pdfBuffer: Buffer): Promise<Buffer[]> {
  let srcDoc: PDFDocument;
  try {
    srcDoc = await PDFDocument.load(pdfBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF_SPLIT_FAILED: Không thể đọc file PDF: ${msg}`);
  }

  const pageCount = srcDoc.getPageCount();
  if (pageCount === 0) {
    throw new Error('PDF_EMPTY: File PDF không có trang nào.');
  }

  try {
    const pageBuffers: Buffer[] = [];
    for (let i = 0; i < pageCount; i++) {
      const newDoc = await PDFDocument.create();
      const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
      newDoc.addPage(copiedPage);
      const pdfBytes = await newDoc.save();
      pageBuffers.push(Buffer.from(pdfBytes));
    }
    return pageBuffers;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF_SPLIT_FAILED: Lỗi khi tách trang PDF: ${msg}`);
  }
}

// ─── OCR Merge ────────────────────────────────────────────────────────────────

/**
 * Merge OCR results from all pages into a single Payroll_JSON.
 * Sorts by page index, concatenates lists, re-indexes stt sequentially from 1,
 * and updates thong_ke_tong_quan counts.
 */
export function mergeOcrResults(
  pageResults: Array<{ pageIndex: number; data: PayrollJSON }>,
): PayrollJSON {
  // Sort by page index ascending
  const sorted = [...pageResults].sort((a, b) => a.pageIndex - b.pageIndex);

  // Merge thong_tin_chung from ALL pages:
  // Thông tin chung nằm rải rác — header ở trang đầu, footer/ký duyệt ở trang cuối,
  // tổng số món ở dòng cuối bảng. Lấy giá trị non-null từ mọi page, ưu tiên page sớm nhất.
  const mergedTtc: Record<string, unknown> = { ...createEmptyThongTinChung() };
  for (const page of sorted) {
    const ttc = page.data.thong_tin_chung;
    if (!ttc) continue;
    for (const [key, value] of Object.entries(ttc)) {
      // Chỉ ghi đè nếu field hiện tại chưa có giá trị (null/0/"") và page này có
      const currentVal = mergedTtc[key];
      const isEmpty = currentVal === null || currentVal === undefined || currentVal === '' || currentVal === 0;
      if (isEmpty && value !== null && value !== undefined && value !== '' && value !== 0) {
        mergedTtc[key] = value;
      }
    }
  }
  const thongTinChung = mergedTtc as unknown as ThongTinChung;

  // Concatenate lists from all pages — giữ nguyên STT gốc và data gốc từ AI
  const vpbankList = sorted.flatMap((p) => p.data.danh_sach_trong_vpbank || []);
  const nonVpbankList = sorted.flatMap((p) => p.data.danh_sach_ngoai_vpbank || []);

  // Counts: giữ giá trị từ PDF OCR (số ghi trên tài liệu gốc), KHÔNG tự đếm lại
  // Chỉ override nếu tất cả pages đều trả 0 (AI không đọc được)
  if (thongTinChung.tong_so_nhan_vien === 0 && (vpbankList.length + nonVpbankList.length) > 0) {
    thongTinChung.tong_so_nhan_vien = vpbankList.length + nonVpbankList.length;
    thongTinChung.so_nhan_vien_vpbank = vpbankList.length;
    thongTinChung.so_nhan_vien_ngan_hang_khac = nonVpbankList.length;
  }

  return {
    thong_tin_chung: thongTinChung,
    danh_sach_trong_vpbank: vpbankList,
    danh_sach_ngoai_vpbank: nonVpbankList,
  };
}

// ─── PDF Branch ───────────────────────────────────────────────────────────────

interface PageOcrResult {
  pageIndex: number;
  status: 'success' | 'error';
  data?: PayrollJSON;
  error?: string;
  failReason?: 'system_error' | 'ai_refused' | 'invalid_response' | null;
}

/**
 * OCR a single PDF page with retry logic.
 * Extracted as helper to support sequential page-1-first strategy.
 */
async function ocrSinglePage(
  ctx: WorkflowContext,
  pageBuffer: Buffer,
  pdfName: string,
  pageIndex: number,
  totalPages: number,
  schema?: OcrSchemaHint,
): Promise<PageOcrResult> {
  const { logger } = ctx;
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 3000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const backend = await getStorageBackend();
      const pageKey = `${ctx.operationId}/pages/page_${pageIndex + 1}.pdf`;
      const pageStream = Readable.from(pageBuffer);
      await backend.upload(pageKey, pageStream, { contentType: 'application/pdf' });

      const pageFileData = [{
        name: `${pdfName}_page_${pageIndex + 1}.pdf`,
        path: pageKey,
        mime: 'application/pdf',
        size: pageBuffer.length,
      }];
      const filesJson = JSON.stringify(pageFileData);

      const promptVars = buildPageOcrPrompt(
        pageIndex,
        totalPages,
        ctx.promptOverrides.ocr,
        schema,
      );

      // (Start announced in bulk before Promise.all — no per-page start message needed)

      const result = await enqueueSubStep(ctx, 'ext-doc-layout', promptVars, filesJson, ctx.modelOverrides.ocr, ctx.reasoningEffortOverrides.ocr);

      logger.info(
        `[PAYROLL-VERIFY] Page ${pageIndex + 1}/${totalPages} OCR (attempt ${attempt}): ${(result.content || '').length} chars`,
      );

      const parsed = parseDeep(result.content) as PayrollJSON;

      // Check if response is a non-JSON message (AI returned text instead of JSON)
      const isValidPayrollJson = parsed
        && typeof parsed === 'object'
        && ('thong_tin_chung' in parsed || 'danh_sach_trong_vpbank' in parsed || 'danh_sach_ngoai_vpbank' in parsed);

      const contentStr = (result.content || '').toLowerCase();
      if (contentStr.includes('xin lỗi') || contentStr.includes('không thể') || contentStr.includes('i cannot') || contentStr.includes('i\'m sorry')) {
        if (attempt < MAX_ATTEMPTS) {
          logger.warn(`[PAYROLL-VERIFY] Page ${pageIndex + 1} AI refused (attempt ${attempt}), retrying in ${RETRY_DELAY_MS}ms...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        logger.warn(`[PAYROLL-VERIFY] Page ${pageIndex + 1} AI refused after ${MAX_ATTEMPTS} attempts, treating as empty page`);
        return { pageIndex, status: 'success', failReason: 'ai_refused' as const, data: { thong_tin_chung: createEmptyThongTinChung(), danh_sach_trong_vpbank: [], danh_sach_ngoai_vpbank: [] } };
      }

      if (!isValidPayrollJson) {
        if (attempt < MAX_ATTEMPTS) {
          logger.warn(`[PAYROLL-VERIFY] Page ${pageIndex + 1} response is not valid Payroll JSON (attempt ${attempt}), retrying in ${RETRY_DELAY_MS}ms... Raw: ${(result.content || '').substring(0, 150)}`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        logger.warn(`[PAYROLL-VERIFY] Page ${pageIndex + 1} non-JSON response after ${MAX_ATTEMPTS} attempts, treating as empty page. Raw: ${(result.content || '').substring(0, 200)}`);
        return { pageIndex, status: 'success', failReason: 'invalid_response' as const, data: { thong_tin_chung: createEmptyThongTinChung(), danh_sach_trong_vpbank: [], danh_sach_ngoai_vpbank: [] } };
      }

      return {
        pageIndex,
        status: 'success',
        data: {
          thong_tin_chung: parsed.thong_tin_chung || createEmptyThongTinChung(),
          danh_sach_trong_vpbank: parsed.danh_sach_trong_vpbank || [],
          danh_sach_ngoai_vpbank: parsed.danh_sach_ngoai_vpbank || [],
        },
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        logger.warn(`[PAYROLL-VERIFY] Page ${pageIndex + 1} system error (attempt ${attempt}): ${errMsg.substring(0, 100)}, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      logger.error(`[PAYROLL-VERIFY] Page ${pageIndex + 1}/${totalPages} OCR failed after ${MAX_ATTEMPTS} attempts: ${errMsg}`);
      return { pageIndex, status: 'success', failReason: 'system_error' as const, data: { thong_tin_chung: createEmptyThongTinChung(), danh_sach_trong_vpbank: [], danh_sach_ngoai_vpbank: [] } };
    }
  }

  return { pageIndex, status: 'success', data: { thong_tin_chung: createEmptyThongTinChung(), danh_sach_trong_vpbank: [], danh_sach_ngoai_vpbank: [] } };
}

// ─── Quick Per-page Compare (for OCR quality gate) ────────────────────────────

/**
 * Normalize an account number for matching: trim whitespace, strip leading zeros,
 * remove common separators (dots, commas, spaces, dashes) that OCR may insert.
 * Returns '(empty)' for null/undefined/blank to avoid false matches.
 */
function normalizeAccount(acc: string | null | undefined): string {
  // Remove everything except digits
  const digitsOnly = (acc ?? '').replace(/[^0-9]/g, '');
  // Strip leading zeros
  const trimmed = digitsOnly.replace(/^0+/, '');
  return trimmed || '(empty)';
}

/**
 * Quick compare OCR page results against Excel records by so_tai_khoan + so_tien.
 * A row is "matched" only when BOTH STK exists in Excel AND the amount matches.
 * This prevents false-positive passes when OCR reads correct STK but wrong amounts.
 */
function quickComparePageWithExcel(
  pageData: PayrollJSON,
  allExcelRecords: PayrollRecord[],
): { totalOcrRows: number; matchedRows: number; mismatchRate: number; unmatchedSample: string[] } {
  const ocrRows = [
    ...(pageData.danh_sach_trong_vpbank || []),
    ...(pageData.danh_sach_ngoai_vpbank || []),
  ];
  if (ocrRows.length === 0) return { totalOcrRows: 0, matchedRows: 0, mismatchRate: 0, unmatchedSample: [] };

  // Build lookup: normalized STK → set of parsed amount values (one STK may appear multiple times).
  // Amounts are parsed with the locale-aware parser so "133.855.000" / "133.855.000,00"
  // resolve to the same numeric value and match within tolerance.
  const AMOUNT_EPSILON = 0.5;
  const excelLookup = new Map<string, number[]>();
  for (const r of allExcelRecords) {
    const stk = normalizeAccount(r.so_tai_khoan);
    const amt = parseMoneyValue(r.so_tien, 'vn');
    if (amt == null) continue;
    if (!excelLookup.has(stk)) excelLookup.set(stk, []);
    excelLookup.get(stk)!.push(amt);
  }

  let matched = 0;
  const unmatched: string[] = [];
  for (const row of ocrRows) {
    const stk = normalizeAccount(row.so_tai_khoan);
    const amt = parseMoneyValue(row.so_tien, 'vn');
    const excelAmounts = excelLookup.get(stk);
    // Match = STK exists AND amount matches within tolerance (or amount empty/zero on OCR side)
    const amountMatches =
      amt == null || amt === 0 ||
      (excelAmounts != null && excelAmounts.some((e) => Math.abs(e - amt) <= AMOUNT_EPSILON));
    if (excelAmounts && amountMatches) {
      matched++;
    } else {
      if (unmatched.length < 5) unmatched.push(`${row.so_tai_khoan || '?'}:${row.so_tien || '?'}`);
    }
  }

  const mismatchRate = 1 - (matched / ocrRows.length);
  return { totalOcrRows: ocrRows.length, matchedRows: matched, mismatchRate, unmatchedSample: unmatched };
}

/** Normalize amount for comparison: remove separators, keep digits only. */
function normalizeAmount(amt: string | number | null | undefined): string {
  if (amt === null || amt === undefined) return '';
  return String(amt).replace(/[^0-9]/g, '');
}

/**
 * Fill ngan_hang = bank on records where it is currently null/empty.
 * Used to apply a default beneficiary bank (e.g. VPBANK for Hà Nội police units).
 * Mutates the records in place. No-op if bank is falsy.
 *
 * NOTE: This is a display/auto-fill convenience only — it is driven by the
 * `default_beneficiary_bank` flag from the Excel header AI, NOT by comparison.
 */
/**
 * Canonicalize money fields on an OCR-extracted PayrollJSON so decimals are
 * preserved and any malformed formatting (e.g. "1.000.128.500.21") is recovered
 * via parseMoney. Mirrors the Excel-side handling for cross-source consistency.
 * - record so_tien → exact numeric value (locale-aware, no rounding)
 * - thong_tin_chung.tong_so_tien_bang_so → plain numeric string
 * Values that cannot be parsed are left untouched so a genuine mismatch stays visible.
 */
export function canonicalizeMoneyFields(data: PayrollJSON): void {
  const lists = [data.danh_sach_trong_vpbank, data.danh_sach_ngoai_vpbank];
  for (const list of lists) {
    for (const r of list ?? []) {
      const v = parseMoneyValue(r.so_tien, 'vn');
      if (v != null) r.so_tien = v;
    }
  }
  const ttc = data.thong_tin_chung;
  if (ttc && ttc.tong_so_tien_bang_so != null) {
    const v = parseMoneyValue(ttc.tong_so_tien_bang_so, 'vn');
    if (v != null) ttc.tong_so_tien_bang_so = String(v);
  }
}

function fillDefaultBank(data: PayrollJSON, bank: string | null | undefined): void {
  if (!bank) return;
  const lists = [data.danh_sach_trong_vpbank, data.danh_sach_ngoai_vpbank];
  for (const list of lists) {
    for (const r of list ?? []) {
      if (r.ngan_hang === null || r.ngan_hang === undefined || String(r.ngan_hang).trim() === '') {
        r.ngan_hang = bank;
      }
    }
  }
}

/**
 * Sync loai_tien on EVERY Excel record from thong_tin_chung.loai_tien
 * (the AI-cleaned value).
 *
 * Excel branch ONLY. loai_tien has a single value for the whole document
 * (it's not a genuinely per-row field), and the Excel code-parser
 * (payroll-verify-excel.ts) no longer extracts this field at the record
 * level because it was prone to slicing errors when "Loại tiền" and "Tổng
 * số tiền bằng chữ" sit on the same Excel row (the old detectLoaiTien bug).
 * The only reliable source is thong_tin_chung.loai_tien (AI first, code
 * fallback), so it's applied to every record here.
 *
 * NOT applied to the PDF branch: PDF record.loai_tien is OCR data extracted
 * independently per row, and must be kept as-is so it can be compared
 * against Excel in Step 2 — overwriting it would defeat the purpose of that
 * comparison.
 */
export function syncRecordCurrencyFromHeader(data: PayrollJSON): void {
  const loaiTien = data.thong_tin_chung?.loai_tien ?? null;
  const lists = [data.danh_sach_trong_vpbank, data.danh_sach_ngoai_vpbank];
  for (const list of lists) {
    for (const r of list ?? []) {
      r.loai_tien = loaiTien;
    }
  }
}

// ─── Schema Derivation (from Excel) ───────────────────────────────────────────

/**
 * Build numbered column mapping from Excel header columns.
 * Maps: position (1-indexed) → rawName (Excel header text) → fieldName (system field).
 */
export function buildColumnMapping(
  columnHeaders: string[],
): Array<{ position: number; rawName: string; fieldName: string }> {
  // Use the meta info about column detection from the parse result
  // The column headers are in positional order from Excel
  // Map known column keywords to field names
  const fieldKeywords: Array<{ keywords: string[]; field: string }> = [
    { keywords: ['stt', 'tt', 'số tt', 'no.', 'no'], field: 'stt' },
    { keywords: ['họ và tên', 'họ tên', 'tên bên thụ hưởng', 'tên tài khoản người nhận'], field: 'ho_ten' },
    { keywords: ['số tài khoản', 'tài khoản người hưởng lương', 'stk', 'số tk'], field: 'so_tai_khoan' },
    { keywords: ['tên ngân hàng', 'ngân hàng', 'tên nh'], field: 'ngan_hang' },
    { keywords: ['tên chi nhánh', 'chi nhánh ngân hàng'], field: 'ten_chi_nhanh' },
    { keywords: ['tỉnh/ thành phố', 'tỉnh/tp', 'tỉnh/thành phố'], field: 'tinh_tp' },
    { keywords: ['ghi chú'], field: 'ghi_chu' },
    { keywords: ['số tiền bằng chữ', 'bằng chữ'], field: 'so_tien_bang_chu' },
    { keywords: ['địa chỉ'], field: 'dia_chi' },
    { keywords: ['nội dung thanh toán chi tiết', 'nội dung chuyển tiền', 'nội dung'], field: 'noi_dung_thanh_toan_chi_tiet' },
    // so_tien MUST be after so_tien_bang_chu to avoid matching "số tiền bằng chữ" → so_tien
    { keywords: ['số tiền bằng số', 'số tiền thanh toán lương', 'số tiền thanh toán', 'số tiền', 'tổng tiền'], field: 'so_tien' },
  ];

  const mapping: Array<{ position: number; rawName: string; fieldName: string }> = [];

  for (let i = 0; i < columnHeaders.length; i++) {
    const rawName = columnHeaders[i];
    const lower = rawName.toLowerCase();

    let matchedField = '';
    for (const { keywords, field } of fieldKeywords) {
      if (keywords.some(k => lower.includes(k))) {
        matchedField = field;
        break;
      }
    }

    if (matchedField) {
      mapping.push({ position: i + 1, rawName, fieldName: matchedField });
    }
  }

  return mapping;
}

/**
 * Derive OCR schema hint from the Excel parse result.
 *
 * - FULL mode: filter TTC fields that have data in excelData, return all record fields with data,
 *   include numbered column mapping.
 * - MINIMAL mode: return empty arrays (= use fixed 13+5 fields).
 */
function deriveOcrSchemaFromExcel(
  excelData: PayrollJSON | undefined,
  columnHeaders: string[],
  columnMapping: Array<{ position: number; rawName: string; fieldName: string }>,
  mode: 'full' | 'minimal',
): OcrSchemaHint {
  if (mode === 'minimal') {
    return {
      columnHeaders,
      columnMapping: [],
      thongTinChungFields: [],
      recordFields: [],
    };
  }

  // FULL mode: determine which TTC fields have data in Excel result
  const ttcWithData: string[] = [];
  if (excelData?.thong_tin_chung) {
    const ttc = excelData.thong_tin_chung as unknown as Record<string, unknown>;
    for (const field of ALL_TTC_FIELDS) {
      // Skip counter fields (code-injected, always have data)
      if (COUNTER_TTC_FIELDS.has(field)) continue;
      const val = ttc[field];
      if (val !== null && val !== undefined && val !== '' && val !== 0) {
        ttcWithData.push(field);
      }
    }
  }

  // FULL mode: determine which record fields have data in Excel result
  const allRecords = [
    ...(excelData?.danh_sach_trong_vpbank || []),
    ...(excelData?.danh_sach_ngoai_vpbank || []),
  ];
  const recWithData: string[] = [];
  for (const field of ALL_RECORD_FIELDS) {
    // Always include core fields
    if (['stt', 'ho_ten', 'so_tai_khoan', 'so_tien'].includes(field)) {
      recWithData.push(field);
      continue;
    }
    // Check if any record has data for this field
    const hasData = allRecords.some(r => {
      const val = (r as unknown as Record<string, unknown>)[field];
      return val !== null && val !== undefined && val !== '';
    });
    if (hasData) recWithData.push(field);
  }

  return {
    columnHeaders,
    columnMapping,
    thongTinChungFields: ttcWithData,
    recordFields: recWithData,
  };
}



export interface PdfPageInfo {
  page: number;
  pdf_name: string;
  status: 'success' | 'empty' | 'error';
  records_extracted: number;
  reason?: string;
}

export interface PdfProcessingInfo {
  total_pages: number;
  success_pages: number;
  empty_pages: number;
  error_pages: number;
  pages: PdfPageInfo[];
}

interface PdfBranchResult {
  data: PayrollJSON;
  processing_info: PdfProcessingInfo;
}

/**
 * Step 1B: PDF Branch — for each PDF: split → OCR per page → merge all results.
 * Supports multiple PDF files (IDP splits large PDFs into smaller chunks due to 10MB limit).
 * Uses per-page error isolation: failed pages are recorded but don't abort.
 */
async function processPdfBranch(
  ctx: WorkflowContext,
  pdfFiles: FileData[],
  allExcelRecords: PayrollRecord[],
  schema?: OcrSchemaHint,
): Promise<PdfBranchResult> {
  const { logger } = ctx;

  // Collect all page buffers from all PDF files (single-page each)
  const singlePageBuffers: { buffer: Buffer; pdfName: string; originalPageIdx: number }[] = [];

  for (const pdfFile of pdfFiles) {
    const pdfBuffer = await readFileBuffer(pdfFile.path, ctx.operationId);
    const pageBuffers = await splitPdf(pdfBuffer);
    logger.info(`[PAYROLL-VERIFY] PDF "${pdfFile.name}" split into ${pageBuffers.length} page(s)`);
    for (let i = 0; i < pageBuffers.length; i++) {
      singlePageBuffers.push({ buffer: pageBuffers[i], pdfName: pdfFile.name, originalPageIdx: singlePageBuffers.length });
    }
  }

  const totalOriginalPages = singlePageBuffers.length;

  // Group pages into chunks (configurable via pipelineVars.pages_per_chunk, default 1 = single page per OCR call)
  const pagesPerChunk = Math.max(1, Number(ctx.pipelineVars.pages_per_chunk) || 1);
  const allPageBuffers: { buffer: Buffer; pdfName: string; pageIndex: number; pageRange: string }[] = [];

  for (let i = 0; i < singlePageBuffers.length; i += pagesPerChunk) {
    const chunkPages = singlePageBuffers.slice(i, i + pagesPerChunk);
    if (chunkPages.length === 1) {
      // Single page — no merge needed
      allPageBuffers.push({
        buffer: chunkPages[0].buffer,
        pdfName: chunkPages[0].pdfName,
        pageIndex: allPageBuffers.length,
        pageRange: `p.${chunkPages[0].originalPageIdx + 1}`,
      });
    } else {
      // Merge multiple pages into one PDF chunk
      const mergedDoc = await PDFDocument.create();
      for (const page of chunkPages) {
        const srcDoc = await PDFDocument.load(page.buffer);
        const [copiedPage] = await mergedDoc.copyPages(srcDoc, [0]);
        mergedDoc.addPage(copiedPage);
      }
      const mergedBuffer = Buffer.from(await mergedDoc.save());
      const firstPage = chunkPages[0].originalPageIdx + 1;
      const lastPage = chunkPages[chunkPages.length - 1].originalPageIdx + 1;
      allPageBuffers.push({
        buffer: mergedBuffer,
        pdfName: chunkPages[0].pdfName,
        pageIndex: allPageBuffers.length,
        pageRange: `p.${firstPage}-${lastPage}`,
      });
    }
  }

  const totalChunks = allPageBuffers.length;
  logger.info(`[PAYROLL-VERIFY] Total ${totalOriginalPages} pages → ${totalChunks} chunk(s) (${pagesPerChunk} page/chunk)`);

  // OCR all chunks in parallel — each chunk independently extracts + reports detected_columns
  // Track per-chunk progress for UI monitoring
  // After each chunk OCR: quick-compare vs Excel by so_tai_khoan. If >30% mismatch → retry up to 2 times.
  const MISMATCH_THRESHOLD = 0.3;
  const MAX_MISMATCH_RETRIES = Math.max(0, Number(ctx.pipelineVars.max_ocr_retries) || 3);
  let completedPages = 0;

  // Announce all chunk starts BEFORE launching (single write, no race condition)
  const startList = allPageBuffers.map(p => `  • chunk ${p.pageIndex + 1}/${totalChunks} (${p.pdfName} ${p.pageRange})`).join('\n');
  await updateProgress(ctx, 10, `Bắt đầu OCR ${totalChunks} chunk (${pagesPerChunk} trang/chunk, stagger 5s):\n${startList}`);

  // Stagger chunk OCR launches by 5s intervals to avoid overwhelming the API
  const STAGGER_DELAY_MS = 5000;
  const pageResults: PageOcrResult[] = await Promise.all(
    allPageBuffers.map(async ({ buffer: pageBuffer, pdfName, pageIndex, pageRange }): Promise<PageOcrResult> => {
      // Wait pageIndex * 5s before starting this chunk's OCR
      if (pageIndex > 0) {
        await new Promise(r => setTimeout(r, pageIndex * STAGGER_DELAY_MS));
      }
      await updateProgress(ctx, Math.round(10 + (pageIndex / totalChunks) * 45),
        `OCR ${pageRange}/${totalOriginalPages} → ${pdfName}_page_${pageIndex + 1}.pdf - bắt đầu`);

      let result = await ocrSinglePage(ctx, pageBuffer, pdfName, pageIndex, totalChunks, schema);

      // Quick compare quality gate: retry if too many OCR rows don't match Excel
      if (result.data && allExcelRecords.length > 0) {
        let qc = quickComparePageWithExcel(result.data, allExcelRecords);

        let retryCount = 0;
        while (qc.totalOcrRows > 0 && qc.mismatchRate > MISMATCH_THRESHOLD && retryCount < MAX_MISMATCH_RETRIES) {
          retryCount++;
          await updateProgress(
            ctx,
            Math.round(10 + (pageIndex / totalChunks) * 45),
            `⚠️ p.${pageIndex + 1}/${totalChunks} (${pdfName}) mismatch=${(qc.mismatchRate * 100).toFixed(0)}% (${qc.matchedRows}/${qc.totalOcrRows} STK matched) → retry #${retryCount}/${MAX_MISMATCH_RETRIES}...\n   STK không khớp (mẫu): ${qc.unmatchedSample.join(', ')}`,
          );
          logger.warn(
            `[PAYROLL-VERIFY] p.${pageIndex + 1}/${totalChunks} (${pdfName}) mismatchRate=${(qc.mismatchRate * 100).toFixed(0)}% → retry #${retryCount}`,
          );
          const retryResult = await ocrSinglePage(ctx, pageBuffer, pdfName, pageIndex, totalChunks, schema);
          if (retryResult.data) {
            // Luôn dùng kết quả retry mới nhất, chỉ check mismatch rate
            result = retryResult;
            qc = quickComparePageWithExcel(retryResult.data, allExcelRecords);
            await updateProgress(ctx, Math.round(10 + (pageIndex / totalChunks) * 45),
              `🔄 p.${pageIndex + 1}/${totalChunks} (${pdfName}) retry #${retryCount}: mismatch=${(qc.mismatchRate * 100).toFixed(0)}% (${qc.matchedRows}/${qc.totalOcrRows} STK matched)`);
            logger.info(`[PAYROLL-VERIFY] p.${pageIndex + 1} retry #${retryCount}: mismatch=${(qc.mismatchRate * 100).toFixed(0)}%`);
          } else {
            break; // Retry returned no data — stop
          }
        }

        if (qc.totalOcrRows > 0 && qc.mismatchRate <= MISMATCH_THRESHOLD) {
          await updateProgress(ctx, Math.round(10 + (pageIndex / totalChunks) * 45),
            `✅ p.${pageIndex + 1}/${totalChunks} (${pdfName}) check OK: ${qc.matchedRows}/${qc.totalOcrRows} STK matched (mismatch=${(qc.mismatchRate * 100).toFixed(0)}%)`);
        } else if (qc.totalOcrRows > 0 && qc.mismatchRate > MISMATCH_THRESHOLD) {
          // Hết retry budget mà vẫn không đạt ngưỡng — cảnh báo rõ ràng
          await updateProgress(ctx, Math.round(10 + (pageIndex / totalChunks) * 45),
            `❌ p.${pageIndex + 1}/${totalChunks} (${pdfName}) vẫn mismatch=${(qc.mismatchRate * 100).toFixed(0)}% sau ${MAX_MISMATCH_RETRIES} retry. Kết quả page này có thể SAI.\n   STK không khớp (mẫu): ${qc.unmatchedSample.join(', ')}`);
          logger.error(`[PAYROLL-VERIFY] p.${pageIndex + 1} FAILED quality gate: mismatch=${(qc.mismatchRate * 100).toFixed(0)}% after ${MAX_MISMATCH_RETRIES} retries. Page data unreliable.`);
        }
      }

      completedPages++;
      const pct = Math.round(10 + (completedPages / totalChunks) * 45);
      const pageFileName = `${pdfName}_page_${pageIndex + 1}.pdf`;
      await updateProgress(ctx, pct, `OCR p.${pageIndex + 1}/${totalChunks} hoàn tất → ${pageFileName} [${completedPages}/${totalChunks} done]`);
      return result;
    }),
  );

  // All pages are now 'success' (Option B: even failed pages return empty data after retry)
  // Merge all results
  const successResults = pageResults.filter(
    (r): r is PageOcrResult & { status: 'success'; data: PayrollJSON } =>
      r.status === 'success' && r.data != null,
  );

  logger.info(
    `[PAYROLL-VERIFY] PDF OCR completed: ${successResults.length}/${totalChunks} page(s) processed`,
  );

  // Clean up temporary page files from storage
  try {
    const backend = await getStorageBackend();
    const pageKeys = allPageBuffers.map((_, i) => `${ctx.operationId}/pages/page_${i + 1}.pdf`);
    await backend.deleteMany(pageKeys);
  } catch (cleanupErr) {
    logger.warn(`[PAYROLL-VERIFY] Failed to clean up page files (non-fatal)`, undefined, cleanupErr);
  }

  // Build page processing info
  const pagesInfo: PdfPageInfo[] = pageResults.map((r, idx) => {
    const recordCount = (r.data?.danh_sach_trong_vpbank?.length ?? 0) + (r.data?.danh_sach_ngoai_vpbank?.length ?? 0);
    const hasThongTinChung = r.data?.thong_tin_chung
      ? Object.values(r.data.thong_tin_chung).some(v => v !== null && v !== 0 && v !== '')
      : false;
    const hasData = recordCount > 0 || hasThongTinChung;

    // Determine status and reason
    let status: 'success' | 'empty' | 'error';
    let reason: string | undefined;

    if (r.failReason === 'system_error') {
      status = 'error';
      reason = 'CAIP lỗi hệ thống (timeout/HTTP 500) sau 2 lần retry';
    } else if (r.failReason === 'ai_refused') {
      status = 'error';
      reason = 'AI từ chối xử lý (safety filter)';
    } else if (r.failReason === 'invalid_response') {
      status = 'error';
      reason = 'AI trả response không phải JSON hợp lệ';
    } else if (!hasData) {
      status = 'empty';
      reason = 'AI đọc thành công nhưng không tìm thấy dữ liệu trên trang này';
    } else {
      status = 'success';
    }

    return {
      page: idx + 1,
      pdf_name: allPageBuffers[idx]?.pdfName ?? '',
      status,
      records_extracted: recordCount,
      ...(reason ? { reason } : {}),
    };
  });

  const processingInfo: PdfProcessingInfo = {
    total_pages: totalChunks,
    success_pages: pagesInfo.filter(p => p.status === 'success').length,
    empty_pages: pagesInfo.filter(p => p.status === 'empty').length,
    error_pages: pagesInfo.filter(p => p.status === 'error').length,
    pages: pagesInfo,
  };

  logger.info(
    `[PAYROLL-VERIFY] PDF processing: ${processingInfo.success_pages}/${totalChunks} pages with data, ${processingInfo.empty_pages} empty`,
  );

  // Merge successful page results
  const mergedData = mergeOcrResults(successResults);
  return { data: mergedData, processing_info: processingInfo };
}

// ─── Excel Branch ─────────────────────────────────────────────────────────────

/**
 * Step 1A: Excel Branch — AI extract header + merge with code-parsed data.
 * Accepts a pre-parsed ExcelParseResult (parsed before Promise.all to provide
 * allExcelRecords for the PDF quick-compare quality gate).
 */
async function processExcelBranch(
  ctx: WorkflowContext,
  parseResult: ExcelParseResult,
): Promise<{ data: PayrollJSON; defaultBeneficiaryBank: string | null }> {
  const { logger } = ctx;

  logger.info(
    `[PAYROLL-VERIFY] Excel parsed: ${parseResult.vpbankList.length} VPBank + ${parseResult.nonVpbankList.length} non-VPBank records, generalInfo=${parseResult.generalInfo.length} chars`,
  );

  // 3. Use code-parsed header (deterministic, no AI dependency)
  const codeParsedHeader = parseResult.parsedHeader;
  logger.info(
    `[PAYROLL-VERIFY] Excel header parsed by code: ten_don_vi_chuyen_tien=${codeParsedHeader.ten_don_vi_de_nghi ? 'YES' : 'null'}, so_tk=${codeParsedHeader.so_tai_khoan_trich_no ? 'YES' : 'null'}, tong_tien=${codeParsedHeader.tong_so_tien_bang_so ? 'YES' : 'null'}`,
  );

  // 4. AI extraction for header (primary source)
  // Send generalInfo as a .txt file to avoid internal parser intercept (.xlsx would be parsed natively)
  // and ensure the connector receives document content via the file field.
  // If AI throws an error (connector down, timeout, HTTP error) → workflow FAILS immediately.
  // Code fallback only applies when AI returns successfully but content is empty/unparseable.
  let aiThongTinChung: Partial<ThongTinChung> = {};
  let aiHeaderFailed = false;

  const promptVars = buildExcelHeaderPrompt(
    parseResult.generalInfo,
    ctx.promptOverrides.extract,
  );

  // No file needed — generalInfo text is already embedded in the prompt.
  // This works for both AIHub (JSON body) and CAIP (multipart) providers.
  await updateProgress(ctx, 56, 'Excel: đang trích xuất thông tin chung (AI)...');
  const aiResult = await enqueueSubStep(ctx, 'ext-data-extractor', promptVars, null, ctx.modelOverrides.extract, ctx.reasoningEffortOverrides.extract);

  logger.info(
    `[PAYROLL-VERIFY] Excel AI header extraction: ${(aiResult.content || '').length} chars`,
  );

  const parsed = parseDeep(aiResult.content) as Record<string, unknown>;
  if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
    aiThongTinChung = parsed as Partial<ThongTinChung>;
  } else {
    // AI returned successfully but content is empty/unparseable → use code fallback
    aiHeaderFailed = true;
    logger.warn(
      `[PAYROLL-VERIFY] Excel AI header returned empty/unparseable content, using code fallback. Raw: ${(aiResult.content || '').substring(0, 200)}`,
    );
  }

  // Capture the default beneficiary bank flag (auto-fill only — NOT a compared field).
  // Set by the AI when the paying unit is e.g. a Hà Nội police unit that pays via VPBank.
  const rawDefaultBank = (parsed as Record<string, unknown>)?.default_beneficiary_bank;
  const defaultBeneficiaryBank =
    typeof rawDefaultBank === 'string' && rawDefaultBank.trim() !== ''
      ? rawDefaultBank.trim().toUpperCase()
      : null;
  if (defaultBeneficiaryBank) {
    logger.info(`[PAYROLL-VERIFY] default_beneficiary_bank = ${defaultBeneficiaryBank} (auto-fill ngan_hang for empty rows)`);
  }
  // Remove the control field from the parsed AI object so it does NOT leak into
  // thong_tin_chung (which is spread from `ai` below). It is metadata only.
  if (parsed && typeof parsed === 'object') {
    delete (parsed as Record<string, unknown>).default_beneficiary_bank;
  }

  // 5. Merge: AI header (primary) + code-parsed header (fallback for missing fields)
  const vpbankCount = parseResult.vpbankList.length;
  const nonVpbankCount = parseResult.nonVpbankList.length;

  // AI may return flat or nested format. Merge all into flat ThongTinChung.
  const ai = (aiThongTinChung || {}) as Record<string, unknown>;

  // Determine extraction source for monitoring
  const aiWorked = !aiHeaderFailed && Object.keys(ai).length > 0;
  const headerSource = aiWorked ? 'ai' : 'code_fallback';
  logger.info(`[PAYROLL-VERIFY] Excel header source: ${headerSource}`);

  // Start with empty, overlay AI values, then code fallback for remaining nulls
  const mergedThongTinChung: ThongTinChung = {
    ...createEmptyThongTinChung(),
    // AI values (primary) — spread all AI-returned fields
    ...(aiWorked ? ai as Partial<ThongTinChung> : {}),
    // Code fallback values (only fill if AI didn't provide)
    ma_kh_cif: (ai.ma_kh_cif as string) ?? codeParsedHeader.ma_kh_cif ?? null,
    dia_chi: (ai.dia_chi as string) ?? codeParsedHeader.dia_chi_don_vi_de_nghi ?? null,
    dien_thoai: (ai.dien_thoai as string) ?? codeParsedHeader.so_dien_thoai ?? null,
    so_tai_khoan_trich_no: (ai.so_tai_khoan_trich_no as string) ?? codeParsedHeader.so_tai_khoan_trich_no ?? null,
    loai_tien: (ai.loai_tien as string) ?? codeParsedHeader.loai_tien ?? null,
    tong_so_tien_bang_so: (ai.tong_so_tien_bang_so as string) ?? codeParsedHeader.tong_so_tien_bang_so ?? null,
    tong_so_tien_bang_chu: (ai.tong_so_tien_bang_chu as string) ?? codeParsedHeader.tong_so_tien_bang_chu ?? null,
    ngay_lenh_chi: (ai.ngay_lenh_chi as string) ?? codeParsedHeader.ngay_lenh_chi ?? null,
    noi_dung_thanh_toan: (ai.noi_dung_thanh_toan as string) ?? codeParsedHeader.noi_dung_thanh_toan ?? null,
    // Additional code fallback fields
    so_chung_tu: (ai.so_chung_tu as string) ?? codeParsedHeader.so_chung_tu ?? null,
    ngay_lap: (ai.ngay_lap as string) ?? codeParsedHeader.ngay_lap ?? null,
    chi_nhanh_vpbank: (ai.chi_nhanh_vpbank as string) ?? codeParsedHeader.chi_nhanh_vpbank ?? null,
    ma_bieu_mau: (ai.ma_bieu_mau as string) ?? codeParsedHeader.ma_bieu_mau ?? null,
    dia_diem_lap: (ai.dia_diem_lap as string) ?? codeParsedHeader.dia_diem_lap ?? null,
    fax: (ai.fax as string) ?? codeParsedHeader.fax ?? null,
    cmnd_cccd: (ai.cmnd_cccd as string) ?? codeParsedHeader.cmnd_cccd ?? null,
    ten_chu_tai_khoan: (ai.ten_chu_tai_khoan as string) ?? codeParsedHeader.ten_chu_tai_khoan ?? null,
    mo_tai: (ai.mo_tai as string) ?? codeParsedHeader.mo_tai ?? null,
    muc_dich: (ai.muc_dich as string) ?? codeParsedHeader.muc_dich ?? null,
    danh_sach_chi_luong_so: (ai.danh_sach_chi_luong_so as string) ?? codeParsedHeader.danh_sach_chi_luong_so ?? null,
    noi_dung_chuyen_tien: (ai.noi_dung_chuyen_tien as string) ?? codeParsedHeader.noi_dung_chuyen_tien ?? null,
    ten_don_vi_chuyen_tien: (ai.ten_don_vi_chuyen_tien as string) ?? codeParsedHeader.ten_don_vi_chuyen_tien ?? codeParsedHeader.ten_don_vi_de_nghi ?? null,
    tai_khoan_trung_gian: (ai.tai_khoan_trung_gian as string) ?? codeParsedHeader.tai_khoan_trung_gian ?? null,
    ngay_nhan_tien_tk_trung_gian: (ai.ngay_nhan_tien_tk_trung_gian as string) ?? codeParsedHeader.ngay_nhan_tien_tk_trung_gian ?? null,
    ngay_chuyen_tien: (ai.ngay_chuyen_tien as string) ?? codeParsedHeader.ngay_chuyen_tien ?? null,
    // New BU fields
    don_vi_chuyen_tien_tai_khoan_treo: (ai.don_vi_chuyen_tien_tai_khoan_treo as string) ?? codeParsedHeader.don_vi_chuyen_tien_tai_khoan_treo ?? null,
    thoi_gian: (ai.thoi_gian as string) ?? codeParsedHeader.thoi_gian ?? null,
    tong_cong_don_vi: (ai.tong_cong_don_vi as number) ?? codeParsedHeader.tong_cong_don_vi ?? null,
    don_vi_tinh: (ai.don_vi_tinh as string) ?? codeParsedHeader.don_vi_tinh ?? null,
    // Counts always from code (accurate)
    tong_so_nhan_vien: vpbankCount + nonVpbankCount,
    so_nhan_vien_vpbank: vpbankCount,
    so_nhan_vien_ngan_hang_khac: nonVpbankCount,
  };

  // Canonicalize the numeric total to a consistent plain-number string.
  // The AI may return malformed formatting (e.g. "1.000.128.500.21" for
  // 1000128500.21 by applying dot-thousands over the decimal too). parseMoney
  // recovers the correct value; String() gives a consistent, exact form.
  if (mergedThongTinChung.tong_so_tien_bang_so != null) {
    const canonical = parseMoneyValue(mergedThongTinChung.tong_so_tien_bang_so, 'vn');
    if (canonical != null) {
      mergedThongTinChung.tong_so_tien_bang_so = String(canonical);
    }
  }

  const excelResult: PayrollJSON = {
    thong_tin_chung: mergedThongTinChung,
    danh_sach_trong_vpbank: parseResult.vpbankList,
    danh_sach_ngoai_vpbank: parseResult.nonVpbankList,
  };

  // Apply default beneficiary bank fill to Excel records (empty ngan_hang → default bank).
  fillDefaultBank(excelResult, defaultBeneficiaryBank);

  // Sync loai_tien on every record from thong_tin_chung.loai_tien (AI-cleaned value).
  syncRecordCurrencyFromHeader(excelResult);

  return { data: excelResult, defaultBeneficiaryBank };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Entry point registered in WORKFLOW_REGISTRY.
 * Orchestrates: classify → parallel branches (PDF + Excel) → compare → complete.
 *
 * Progress percentages:
 *   0-5%   : File classification
 *   5-60%  : Parallel PDF + Excel processing
 *   60-85% : Compare engine
 *   85-100%: Finalization
 */
export async function runPayrollVerify(ctx: WorkflowContext): Promise<void> {
  const { logger } = ctx;
  const resumeFromStep = ctx.currentStep;

  let pdfFiles: FileData[] | undefined;
  let excelFile: FileData | undefined;
  let pdfResult: PayrollJSON | undefined;
  let excelResult: PayrollJSON | undefined;
  let pdfProcessingInfo: PdfProcessingInfo | undefined;
  let detectedRecordFields: string[] = [];
  // Columns each Excel section's own header actually resolved. Drives per-section
  // compare fields so a column present in only one table is not compared against
  // the other. Persisted with step 1 so a resumed run keeps it.
  let sectionColumns: SectionColumns = {};
  let defaultBeneficiaryBank: string | null = null;

  try {
    // ── Step 0: Classify files ────────────────────────────────────────────
    if (resumeFromStep <= 0) {
      await updateProgress(ctx, 2, 'Bước 0: Phân loại file...');

      const classified = classifyFiles(ctx.filesData);
      pdfFiles = classified.pdfFiles;
      excelFile = classified.excelFile;

      ctx.stepsResult.push({
        step: 0,
        stepName: 'Phân loại file',
        processor: 'code',
        content_preview: { pdf_count: pdfFiles.length, pdf_names: pdfFiles.map(f => f.name), excel: excelFile.name },
      });

      await updateProgress(ctx, 5, 'Bước 0 hoàn tất. Bắt đầu xử lý song song PDF + Excel.');
    }

    // Restore file references if resuming
    if (!pdfFiles || !excelFile) {
      const classified = classifyFiles(ctx.filesData);
      pdfFiles = classified.pdfFiles;
      excelFile = classified.excelFile;
    }

    // ── Step 1: Parallel branches (PDF + Excel) ──────────────────────────
    if (resumeFromStep <= 1) {
      await updateProgress(ctx, 8, 'Bước 1A: Đọc và phân tích file Excel...');

      // Parse Excel upfront (code-only, fast ~50ms) to provide allExcelRecords
      // for the PDF per-page quality gate (quick compare by so_tai_khoan).
      const excelBuffer = await readFileBuffer(excelFile.path, ctx.operationId);
      const excelParseResult = parsePayrollExcel(excelBuffer);
      const allExcelRecords = [...excelParseResult.vpbankList, ...excelParseResult.nonVpbankList];

      // Union the mapped columns of every block of the same kind — a template may
      // split one logical section across several tables.
      const columnsOfKind = (kind: 'vpbank' | 'ngan_hang_khac'): string[] => {
        const set = new Set<string>();
        for (const b of excelParseResult.meta.blocks) {
          if (b.kind === kind) for (const f of b.mappedFields) set.add(f);
        }
        return [...set];
      };
      sectionColumns = {
        trong_vpbank: columnsOfKind('vpbank'),
        ngoai_vpbank: columnsOfKind('ngan_hang_khac'),
      };
      logger.info(
        `[PAYROLL-VERIFY] Excel section columns — trong_vpbank: [${sectionColumns.trong_vpbank?.join(', ')}], ` +
        `ngoai_vpbank: [${sectionColumns.ngoai_vpbank?.join(', ')}]`,
      );

      // Read raw column headers from Excel — used for positional hint when PDF page has no header row.
      // Only column NAMES are passed to OCR prompt (never actual data values).
      const excelHeaders = getExcelColumnHeaders(excelBuffer) || [];

      // Step 1A: Excel AI header extraction — MUST complete before OCR starts
      // so we have the column headers for the OCR positional hint.
      const excelBranch = await processExcelBranch(ctx, excelParseResult);
      const excelRes = excelBranch.data;
      defaultBeneficiaryBank = excelBranch.defaultBeneficiaryBank;
      await updateProgress(ctx, 12, 'Bước 1A hoàn tất. Đang chuẩn bị schema cho OCR PDF...');

      // Determine schema_mode: "minimal" (default, keep current behavior) or "full"
      const schemaMode = (ctx.pipelineVars.schema_mode as string) === 'full' ? 'full' : 'minimal';

      // Build numbered column mapping from Excel headers
      const columnMapping = buildColumnMapping(excelHeaders);
      detectedRecordFields = columnMapping.map(m => m.fieldName);

      // Derive OCR schema based on mode:
      // - full: dynamic fields from Excel data + numbered column mapping
      // - minimal: empty arrays = use fixed 13+5 fields (current behavior)
      const ocrSchema = deriveOcrSchemaFromExcel(excelRes, excelHeaders, columnMapping, schemaMode);
      logger.info(
        `[PAYROLL-VERIFY] OCR schema (${schemaMode}): ${ocrSchema.thongTinChungFields.length} TTC + ${ocrSchema.recordFields.length} record fields. Column mapping: ${ocrSchema.columnMapping.length} entries.`,
      );

      // Step 1B: PDF OCR (staggered parallel) — pass derived schema as the ONLY context hint.
      const pdfRes = await processPdfBranch(ctx, pdfFiles, allExcelRecords, ocrSchema);

      pdfResult = pdfRes.data;
      pdfProcessingInfo = pdfRes.processing_info;

      // Canonicalize OCR money fields so decimals are preserved and any malformed
      // formatting (e.g. "1.000.128.500.21") is recovered — symmetric with Excel.
      canonicalizeMoneyFields(pdfResult);

      // Apply default beneficiary bank fill to PDF records too (symmetric with Excel).
      fillDefaultBank(pdfResult, defaultBeneficiaryBank);
      excelResult = excelRes;

      // Validate: Excel must have at least 1 record (empty template = invalid input)
      const excelTotalRecords = excelResult.danh_sach_trong_vpbank.length + excelResult.danh_sach_ngoai_vpbank.length;
      if (excelTotalRecords === 0) {
        throw new Error(
          `EXCEL_EMPTY_DATA: File Excel không chứa bản ghi nhân viên nào. ` +
          `Vui lòng kiểm tra lại file Excel đã gửi (có thể là file template trống).`
        );
      }

      // Note: PDF may have 0 records (AI limitation or all pages empty) — this is OK (Option B).
      // Compare will show all Excel records as "missing_in_pdf" → REVIEW_REQUIRED.

      ctx.stepsResult.push({
        step: 1,
        stepName: 'Xử lý PDF + Excel',
        processor: 'ext-doc-layout / ext-data-extractor',
        content_preview: {
          pdf_processing: pdfProcessingInfo,
          pdf_vpbank: pdfResult.danh_sach_trong_vpbank.length,
          pdf_non_vpbank: pdfResult.danh_sach_ngoai_vpbank.length,
          excel_vpbank: excelResult.danh_sach_trong_vpbank.length,
          excel_non_vpbank: excelResult.danh_sach_ngoai_vpbank.length,
        },
        extracted_data: { excelResult, pdfResult, pdfProcessingInfo, detectedRecordFields, sectionColumns },
      });

      await updateProgress(ctx, 60, 'Bước 1 hoàn tất. Bắt đầu đối chiếu.');
    }

    // ── Step 2: Compare ──────────────────────────────────────────────────
    if (resumeFromStep <= 2) {
      await updateProgress(ctx, 65, 'Bước 2: Đối chiếu...');

      // Restore branch results from stepsResult if resuming past step 1
      if (!excelResult || !pdfResult) {
        const step1 = ctx.stepsResult.find((s) => s.step === 1);
        if (step1?.extracted_data) {
          const data = step1.extracted_data as { excelResult?: PayrollJSON; pdfResult?: PayrollJSON; detectedRecordFields?: string[]; sectionColumns?: SectionColumns };
          excelResult = data.excelResult;
          pdfResult = data.pdfResult;
          if (data.detectedRecordFields) detectedRecordFields = data.detectedRecordFields;
          // Older checkpoints predate this field; recordFieldsForSection falls
          // back to inferring from the records when it is absent.
          if (data.sectionColumns) sectionColumns = data.sectionColumns;
        }
        if (!excelResult || !pdfResult) {
          throw new Error('Cannot resume step 2: missing branch results from step 1. Please re-run the workflow.');
        }
      }

      // Use client-provided compare_config, or build dynamic from schema_mode, or fall back to default
      const schemaModeFinal = (ctx.pipelineVars.schema_mode as string) === 'full' ? 'full' : 'minimal';
      const config = (ctx.pipelineVars.compare_config as CompareConfig)
        || (schemaModeFinal === 'full' ? buildDynamicCompareConfig(excelResult!, sectionColumns) : DEFAULT_COMPARE_CONFIG);

      // Source A = Excel (ground truth), Source B = PDF (OCR)
      const compareResult = comparePayrollData(excelResult!, pdfResult!, config);

      logger.info(
        `[PAYROLL-VERIFY] Compare result: ${compareResult.final_decision} (header=${compareResult.summary.header_status}, detail=${compareResult.summary.detail_status})`,
      );

      ctx.stepsResult.push({
        step: 2,
        stepName: 'Đối chiếu',
        processor: 'code',
        content_preview: {
          final_decision: compareResult.final_decision,
          compare_status: compareResult.compare_status,
          summary: compareResult.summary,
        },
        extracted_data: compareResult,
      });

      await updateProgress(ctx, 85, 'Bước 2 hoàn tất.');

      // ── Step 3: Complete workflow ────────────────────────────────────────
      await updateProgress(ctx, 90, 'Bước 3: Hoàn tất...');

      await completeWorkflow(ctx, JSON.stringify(compareResult.summary), {
        request_id: ctx.pipelineVars.request_id || ctx.operationId,
        skill_code: 'payroll-batch-validation',
        status: 'SUCCESS',
        result: {
          document_processed: (pdfFiles?.length ?? 0) + 1, // N PDFs + 1 Excel
          excel_rows: (excelResult!.danh_sach_trong_vpbank?.length ?? 0) + (excelResult!.danh_sach_ngoai_vpbank?.length ?? 0),
          validation_status: 'COMPLETED',
          final_decision: compareResult.final_decision,
          pdf_processing_info: pdfProcessingInfo,
          excel_extraction: excelResult,
          // Fields detected from Excel column headers (for frontend column visibility)
          detected_record_fields: detectedRecordFields,
          // Default beneficiary bank used to auto-fill empty ngan_hang (metadata only, not compared)
          default_beneficiary_bank: defaultBeneficiaryBank,
          comparison_result: {
            summary: compareResult.summary,
            header_compare: compareResult.header_compare,
            detail_results: compareResult.detail_results,
          },
        },
      }, {
        logicResult: compareResult.compare_status === 'pass' ? 'PASS' : 'FAIL',
        extractionResult: 'SUCCESS',
      });
    }
  } catch (error) {
    await failWorkflow(ctx, error);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export { processPdfBranch };
export type { FileData };
