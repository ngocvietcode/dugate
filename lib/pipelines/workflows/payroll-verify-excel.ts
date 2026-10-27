// lib/pipelines/workflows/payroll-verify-excel.ts
// Excel parser for the Payroll Verify workflow.
//
// Supports 6 template types:
//   1. MB01 Đề nghị TT lương kiêm UNC (has VPBank markers)
//   2. CAHN Danh sách chi lương (flat list, no general info)
//   3. Nộp tiền mặt (MB07 — same structure as T4, has VPBank markers)
//   4. Đề nghị chi lương qua TK trung gian (markers: "Nhận lương qua TK tại VPBank")
//   5. MB01 Chuyển tiền theo lô (has VPBank markers, same as template 1)
//   6. MB01 Chuyển tiền theo DS / DS đính kèm (has VPBank markers or flat list)
//
// Strategy:
//   - Single-sheet only (multi-sheet → error)
//   - Detect VPBank section markers → if found, use marker-based parsing (templates 1/4/5/6)
//   - If no markers → flat-list parsing with dynamic column detection (template 2/6-DS)
//   - General info = text above table → send to AI. If no text above → null fields.

import * as xlsx from 'xlsx';
import type { PayrollRecord } from './prompts/payroll-verify-prompts';
import { removeVietnameseAccents } from './payroll-verify-compare';
import { parseMoneyValue } from './payroll-money';

// ─── Section Marker Constants ─────────────────────────────────────────────────

// VPBank section start markers — normalized without accents for robust matching.
// matchesAnyMarker normalizes both row text and markers before comparing (uses .includes()).
// Derived from 6 BU templates. Must be specific enough to avoid "mở tại VPBank" false positive.
const VPBANK_SECTION_MARKERS = [
  'tai khoan thanh toan tai vpbank',       // T1: "tài khoản thanh toán tại VPBank"
  'tai khoan tai vpbank',                   // T1/T5/T6: "tài khoản tại VPBank"
  'tai khoan mo tai vpbank',                // T4: "tài khoản mở tại VPBank" (section title, not "mở tại VPBank theo...")
  'thu huong co tai khoan tai vpbank',      // T5/T6: "thụ hưởng có tài khoản tại VPBank"
  'nhan luong qua tk tai vpbank',           // T4: "nhận lương qua TK tại VPBank"
];

// Non-VPBank section start markers (normalized without accents for robust matching)
const NON_VPBANK_SECTION_MARKERS = [
  'ngan hang khac',                          // All templates: "Ngân hàng khác"
];

// End markers for sections (normalized — no accents, since we normalize rowText before testing)
const SECTION_END_MARKERS = /tong so mon chuyen|tong cong|tong so tien|tong tien|cong:/;

// ─── Result Interface ─────────────────────────────────────────────────────────

/**
 * Per-table diagnostic info. One entry per data table found on the sheet.
 * Lets callers see HOW each table was read, not just what came out.
 */
export interface BlockMeta {
  kind: 'vpbank' | 'ngan_hang_khac';
  /** First and last row index of the data rows (0-based, inclusive). */
  rowRange: [number, number];
  /** Row index the header was read from, or null if none was found. */
  headerRowIndex: number | null;
  /** 'own' = header found above this table. 'positional' = fallback guess (low confidence). */
  headerSource: 'own' | 'positional';
  /** Record fields that got a column mapped from the header. */
  mappedFields: string[];
  recordCount: number;
  /** Rows whose bank cell disagrees with the section label. */
  conflicts: string[];
}

export interface ExcelParseResult {
  generalInfo: string;
  vpbankList: PayrollRecord[];
  nonVpbankList: PayrollRecord[];
  parsedHeader: ParsedHeader;
  meta: {
    sheetName: string;
    parseMode: 'markers' | 'flat-list';
    headerRowIndex: number | null;
    vpbankRecordCount: number;
    nonVpbankRecordCount: number;
    /** One entry per detected table. */
    blocks: BlockMeta[];
  };
}

/** Structured header info parsed from generalInfo text by code (fallback for AI). */
export interface ParsedHeader {
  ten_don_vi_de_nghi: string | null;
  ma_kh_cif: string | null;
  dia_chi_don_vi_de_nghi: string | null;
  so_dien_thoai: string | null;
  so_tai_khoan_trich_no: string | null;
  ngan_hang_chi_ho: string;
  /** Null when the document states no currency — never defaulted to "VND". */
  loai_tien: string | null;
  tong_so_tien_bang_so: string | null;
  tong_so_tien_bang_chu: string | null;
  ngay_lenh_chi: string | null;
  noi_dung_thanh_toan: string | null;
  // Additional fields
  so_chung_tu: string | null;
  ngay_lap: string | null;
  chi_nhanh_vpbank: string | null;
  ma_bieu_mau: string | null;
  dia_diem_lap: string | null;
  fax: string | null;
  cmnd_cccd: string | null;
  ten_chu_tai_khoan: string | null;
  mo_tai: string | null;
  muc_dich: string | null;
  danh_sach_chi_luong_so: string | null;
  noi_dung_chuyen_tien: string | null;
  ten_don_vi_chuyen_tien: string | null;
  tai_khoan_trung_gian: string | null;
  ngay_nhan_tien_tk_trung_gian: string | null;
  ngay_chuyen_tien: string | null;
  // New BU fields
  don_vi_chuyen_tien_tai_khoan_treo: string | null;
  thoi_gian: string | null;
  tong_cong_don_vi: number | null;
  don_vi_tinh: string | null;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/** Safely convert a cell value to a trimmed string. */
function safeStr(val: unknown): string {
  if (val == null) return '';
  return String(val).trim();
}

/** Join all non-empty cell values in a row into a single text line. */
function rowToText(row: unknown[]): string {
  return row
    .map((cell) => safeStr(cell))
    .filter((s) => s.length > 0)
    .join(' ');
}

/** Get normalized text of entire row for marker matching (lowercase + no accents). */
function rowToLower(row: unknown[]): string {
  if (!row) return '';
  const raw = row.map((c) => safeStr(c).toLowerCase()).join(' ');
  return removeVietnameseAccents(raw);
}

/** Try to parse a value as an integer STT (row number). Returns null if not valid. */
function parseStt(val: unknown): number | null {
  if (val == null) return null;
  const s = String(val).trim().replace(/\./g, '');
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

/**
 * Safely convert a cell value to integer (for so_tien field).
 * Handles Vietnamese number formats: "133.855.000", "133,855,000".
 */
export function toIntSafe(val: unknown): number {
  if (val == null) return 0;
  let s = String(val).trim();
  if (s === '') return 0;
  s = s.replace(/,/g, '').replace(/\s/g, '');
  if (/^\d+(\.\d+)?$/.test(s)) {
    try { return Math.round(parseFloat(s)); } catch { return 0; }
  }
  const withoutDots = s.replace(/\./g, '');
  if (/^\d+$/.test(withoutDots)) return parseInt(withoutDots, 10);
  return 0;
}

/**
 * Locale-aware money parser for the so_tien / amount fields.
 *
 * By default returns the EXACT parsed value (no rounding) so the extracted
 * result reflects the real Excel value (e.g. 25369005.6 stays 25369005.6).
 * Pass round=true to round to whole VND — used only when comparing.
 *
 * Parses BEFORE any rounding so Vietnamese single-group amounts are not
 * misread as decimals (e.g. "133.855" → 133855, not 134; "5.000" → 5000).
 *
 * Unlike toIntSafe (kept for backward compatibility), this is locale-aware.
 */
export function toMoney(val: unknown, round = false): number {
  const m = parseMoneyValue(val, 'vn');
  if (m == null) return 0;
  return round ? Math.round(m) : m;
}

/** Check if a row text matches any of the given markers (accent-insensitive). */
function matchesAnyMarker(rowText: string, markers: string[]): boolean {
  // Normalize: remove Vietnamese accents + lowercase for robust matching
  // This handles "ngân hàng khác", "ngan hang khac", "Ngân hang Khác" etc.
  const normalized = removeVietnameseAccents(rowText);
  return markers.some((m) => normalized.includes(m));
}

// ─── STT Header Detection ─────────────────────────────────────────────────────

const STT_PATTERNS = ['stt', 'tt', 'số tt', 'no.', 'no'];

/** Find the first header row (cell[0] matches STT pattern). */
export function findHeaderRow(rows: unknown[][]): number | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const firstCell = safeStr(row[0]).toLowerCase().trim();
    if (STT_PATTERNS.includes(firstCell)) return i;
  }
  return null;
}

/**
 * Quick utility: read Excel buffer and return the raw header row text (column names as-is).
 * Used to provide column hints for PDF OCR prompt.
 * Returns null if header row cannot be found.
 */
export function getExcelColumnHeaders(buffer: Buffer): string[] | null {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return null;
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
  const headerIdx = findHeaderRow(rows);
  if (headerIdx === null) return null;
  const headerRow = rows[headerIdx];
  // Return non-empty cell values as column names
  return headerRow
    .map((cell) => (cell != null ? String(cell).trim() : ''))
    .filter((s) => s.length > 0);
}

// ─── Dynamic Column Detection ─────────────────────────────────────────────────

interface ColumnMap {
  sttCol: number;
  hoTenCol: number;
  soTaiKhoanCol: number;
  soTienCol: number;
  nganHangCol: number | null;
  // New optional columns
  diaChiCol: number | null;
  tenChiNhanhCol: number | null;
  tinhTpCol: number | null;
  ghiChuCol: number | null;
  soTienBangChuCol: number | null;
  noiDungCol: number | null;
}

/**
 * Normalize a header cell for keyword matching: lowercase, strip accents,
 * collapse whitespace/newlines to single spaces.
 *
 * Needed because real templates write the same column many ways:
 * "Tỉnh/ Thành phố", "Tỉnh,  Thành Phố", "Tỉnh/\nThành phố", "Tinh/ Thanh pho".
 * Keywords below are written WITHOUT accents since both sides get normalized.
 */
function normHeader(s: string): string {
  return removeVietnameseAccents(s.toLowerCase()).replace(/\s+/g, ' ').trim();
}

const NAME_KEYWORDS = ['họ và tên', 'họ tên', 'tên bên thụ hưởng', 'họ và tên người hưởng lương', 'tên tài khoản  người nhận', 'tên tài khoản người nhận'];
const ACCOUNT_KEYWORDS = ['số tài khoản', 'tài khoản người hưởng lương', 'số tài khoản bên thụ hưởng', 'số tài khoản người nhận', 'số tk', 'stk', 'số tài khoản (vpbank)', 'số tài khoản (vpbank)'];
const AMOUNT_KEYWORDS = ['số tiền bằng số', 'số tiền thanh toán lương', 'số tiền thanh toán', 'số tiền', 'tổng tiền'];
const ADDRESS_KEYWORDS = ['địa chỉ', 'dia chi'];
const BRANCH_KEYWORDS = ['tên chi nhánh', 'chi nhánh ngân hàng', 'chi nhánh', 'tên chi nhánh ngân hàng hưởng'];
// Province is matched by pattern, not literal, because separators vary widely:
// "Tỉnh/ Thành phố", "Tỉnh, Thành phố", "Tỉnh - TP", "Tỉnh/TP ngân hàng hưởng".
// Tested against normHeader() output (no accents, single spaces).
const PROVINCE_PATTERN = /\btinh\b\s*[\/,\-]?\s*(thanh pho|tp)\b|^tinh$/;
const NOTE_KEYWORDS = ['ghi chú'];
const AMOUNT_TEXT_KEYWORDS = ['số tiền bằng chữ', 'bằng chữ'];
const CONTENT_KEYWORDS = ['nội dung thanh toán chi tiết', 'nội dung thanh toán chi tiết (nếu có)', 'nội dung chuyển tiền', 'nội dung'];
const BANK_KEYWORDS = ['tên ngân hàng', 'ngân hàng', 'tên nh', 'tên ngân hàng người hưởng lương'];

/**
 * Detect column positions from the header row text.
 * If firstDataRow provided, skip columns where data is NULL (merged cell artifacts).
 */
function detectColumns(headerRow: unknown[], firstDataRow?: unknown[]): ColumnMap {
  // Keep the raw lowercase form for the accented keyword lists, plus a
  // normalized form (no accents, collapsed spaces) for pattern matching.
  const cells = headerRow.map((c) => safeStr(c).toLowerCase());
  const normCells = headerRow.map((c) => normHeader(safeStr(c)));

  let sttCol = 0;
  let hoTenCol = -1;
  let soTaiKhoanCol = -1;
  let soTienCol = -1;
  let nganHangCol: number | null = null;
  let diaChiCol: number | null = null;
  let tenChiNhanhCol: number | null = null;
  let tinhTpCol: number | null = null;
  let ghiChuCol: number | null = null;
  let soTienBangChuCol: number | null = null;
  let noiDungCol: number | null = null;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell) continue;

    // Core columns: skip if first data row is NULL (likely merged cell artifact)
    // Only apply this guard to core columns (ho_ten, so_tai_khoan, so_tien) since they MUST have data.
    const firstRowEmpty = firstDataRow && (firstDataRow[i] == null || String(firstDataRow[i]).trim() === '');

    // Core columns (with merged-cell guard)
    if (!firstRowEmpty) {
      if (hoTenCol === -1 && NAME_KEYWORDS.some((k) => cell.includes(k)) && !cell.includes('tài khoản')) hoTenCol = i;
      if (soTaiKhoanCol === -1 && ACCOUNT_KEYWORDS.some((k) => cell.includes(k))) soTaiKhoanCol = i;
      if (soTienCol === -1 && AMOUNT_KEYWORDS.some((k) => cell.includes(k)) && !cell.includes('bằng chữ') && !cell.includes('nội dung')) soTienCol = i;
    }

    // Optional columns: detect by header keyword regardless of first row data.
    // These fields may be null in row 1 but have data in other rows.
    if (nganHangCol === null && BANK_KEYWORDS.some((k) => cell.includes(k)) && !cell.includes('mở tại') && !cell.includes('số tiền') && !cell.includes('chi nhánh')) nganHangCol = i;
    if (diaChiCol === null && ADDRESS_KEYWORDS.some((k) => cell.includes(k)) && !cell.includes('đơn vị')) diaChiCol = i;
    if (tenChiNhanhCol === null && BRANCH_KEYWORDS.some((k) => cell.includes(k))) tenChiNhanhCol = i;
    if (tinhTpCol === null && PROVINCE_PATTERN.test(normCells[i])) tinhTpCol = i;
    if (ghiChuCol === null && NOTE_KEYWORDS.some((k) => cell.includes(k))) ghiChuCol = i;
    if (soTienBangChuCol === null && AMOUNT_TEXT_KEYWORDS.some((k) => cell.includes(k)) && !AMOUNT_KEYWORDS.some((k) => cell.includes(k))) soTienBangChuCol = i;
    if (noiDungCol === null && CONTENT_KEYWORDS.some((k) => cell.includes(k)) && !cell.includes('số tiền')) noiDungCol = i;
  }

  // Ensure nganHangCol doesn't conflict with other detected columns
  if (nganHangCol !== null && (nganHangCol === hoTenCol || nganHangCol === soTaiKhoanCol || nganHangCol === soTienCol)) {
    nganHangCol = null;
  }

  // Fallback to positional defaults if detection failed
  if (hoTenCol === -1) hoTenCol = 1;
  if (soTaiKhoanCol === -1) soTaiKhoanCol = hoTenCol + 1;
  if (soTienCol === -1) soTienCol = soTaiKhoanCol + 1;

  return { sttCol, hoTenCol, soTaiKhoanCol, soTienCol, nganHangCol, diaChiCol, tenChiNhanhCol, tinhTpCol, ghiChuCol, soTienBangChuCol, noiDungCol };
}

// ─── Record Extraction ────────────────────────────────────────────────────────

/**
 * Extract records from data rows using the detected column map.
 * Filters out invalid rows (empty, no digits in account, stt <= 0).
 * Reads cell values as-is — no fallback/default injection.
 */
function extractRecords(
  dataRows: unknown[][],
  colMap: ColumnMap,
  accountType: 'vpbank' | 'ngan_hang_khac',
): PayrollRecord[] {
  const records: PayrollRecord[] = [];

  for (const row of dataRows) {
    if (!row) continue;

    const sttVal = parseStt(row[colMap.sttCol]);
    if (sttVal === null || sttVal <= 0) continue;

    const hoTen = safeStr(row[colMap.hoTenCol]);
    const soTaiKhoan = safeStr(row[colMap.soTaiKhoanCol]);

    if (hoTen.length <= 1 || soTaiKhoan.length <= 1) continue;
    if (!/\d/.test(soTaiKhoan)) continue;

    const soTien = toMoney(row[colMap.soTienCol]);
    const nganHang = colMap.nganHangCol !== null ? safeStr(row[colMap.nganHangCol]) : null;

    records.push({
      stt: sttVal,
      ho_ten: hoTen,
      so_tai_khoan: soTaiKhoan,
      so_tien: soTien,
      loai_tai_khoan: accountType,
      so_tien_bang_chu: colMap.soTienBangChuCol !== null ? safeStr(row[colMap.soTienBangChuCol]) || null : null,
      dia_chi: colMap.diaChiCol !== null ? safeStr(row[colMap.diaChiCol]) || null : null,
      ngan_hang: nganHang || null,
      ten_chi_nhanh: colMap.tenChiNhanhCol !== null ? safeStr(row[colMap.tenChiNhanhCol]) || null : null,
      tinh_tp: colMap.tinhTpCol !== null ? safeStr(row[colMap.tinhTpCol]) || null : null,
      ghi_chu: colMap.ghiChuCol !== null ? safeStr(row[colMap.ghiChuCol]) || null : null,
      noi_dung_thanh_toan_chi_tiet: colMap.noiDungCol !== null ? safeStr(row[colMap.noiDungCol]) || null : null,
      // loai_tien is not detected per block here — in many templates the
      // "Loại tiền" label sits on the same row as "Tổng số tiền bằng chữ",
      // which caused row-based slicing to swallow the amount-in-words text.
      // The cleaned value (via AI) from thong_tin_chung.loai_tien is applied
      // to every record in processExcelBranch (payroll-verify.ts), so it's
      // left null here.
      loai_tien: null,
    });
  }

  return records;
}

// ─── Table Block Detection ────────────────────────────────────────────────────
//
// Instead of anchoring on "find the VPBank marker, then look after it", we find
// data tables STRUCTURALLY: runs of consecutive rows that look like records.
// Section labels, subtotals, footnotes and blank rows are all just "not a data
// row", so they can never split or hijack a table. Works for any number of
// tables in any order.

/**
 * A run this long is always a table. Shorter runs are only accepted when a
 * header row sits just above them (see keepBlock) — that is what separates a
 * genuine 1-2 person section from footer noise like "1 | Tổng số món | 495".
 */
const MIN_BLOCK_ROWS = 3;
/** How far above a short block to look for a header row. */
const SHORT_BLOCK_HEADER_LOOKBACK = 3;
/** Consecutive non-data rows that close an open block. */
const BLOCK_GAP_TOLERANCE = 2;

interface TableBlock {
  start: number;      // first data row index
  end: number;        // last data row index
  lastStt: number;
}

/**
 * Does this row look like a payroll record?
 * Needs an STT, an account-like number, a positive amount, and some text.
 * This shape check is what rejects footer rows like "1 | Tổng số món | 495".
 */
function isDataRow(row: unknown[] | undefined): boolean {
  if (!row) return false;
  const stt = parseStt(row[0]);
  if (stt === null || stt <= 0) return false;

  let hasAccount = false;
  let hasAmount = false;
  let hasText = false;
  for (let i = 1; i < row.length; i++) {
    const s = safeStr(row[i]);
    if (!s) continue;
    if (/^\d[\d\s.\-]{4,}$/.test(s)) hasAccount = true;
    if (toMoney(row[i]) > 0) hasAmount = true;
    if (/[a-zA-ZÀ-ỹ]{3,}/.test(s)) hasText = true;
  }
  return hasAccount && hasAmount && hasText;
}

/**
 * Find all data tables on the sheet.
 * A block ends when STT resets/stops increasing (a new table started) or when
 * enough consecutive non-data rows appear.
 */
function findTableBlocks(rows: unknown[][]): TableBlock[] {
  const blocks: TableBlock[] = [];
  let cur: TableBlock | null = null;
  let gap = 0;

  for (let i = 0; i < rows.length; i++) {
    if (isDataRow(rows[i])) {
      const stt = parseStt(rows[i][0])!;
      // STT going backwards (or repeating) means a different table began.
      if (cur && stt <= cur.lastStt) {
        blocks.push(cur);
        cur = null;
      }
      if (!cur) cur = { start: i, end: i, lastStt: stt };
      else {
        cur.end = i;
        cur.lastStt = stt;
      }
      gap = 0;
    } else if (cur) {
      gap++;
      if (gap >= BLOCK_GAP_TOLERANCE) {
        blocks.push(cur);
        cur = null;
      }
    }
  }
  if (cur) blocks.push(cur);

  // A short run counts as a real table only if a header row sits just above it.
  // Footer summaries ("1 | Tổng số món | 495") have no header, so they drop out.
  const hasHeaderAbove = (block: TableBlock): boolean => {
    const floor = Math.max(0, block.start - SHORT_BLOCK_HEADER_LOOKBACK);
    for (let i = block.start - 1; i >= floor; i--) {
      const row = rows[i];
      if (!row) continue;
      if (STT_PATTERNS.includes(safeStr(row[0]).toLowerCase().trim())) return true;
    }
    return false;
  };

  return blocks.filter(
    (b) => b.end - b.start + 1 >= MIN_BLOCK_ROWS || hasHeaderAbove(b),
  );
}

/**
 * Build a block's header by joining every row between the header row and the
 * first data row, cell by cell.
 *
 * This is what recovers labels split across two rows — either by a vertical
 * merge, or (as in the real BU template) by a hard line break in an unmerged
 * cell: "Tỉnh/" + "Thành phố" → "Tỉnh/ Thành phố", "Ghi" + "chú" → "Ghi chú".
 *
 * Searches upward without a fixed row cap, stopping at the previous block so we
 * never steal another table's header.
 */
function resolveBlockHeader(
  rows: unknown[][],
  block: TableBlock,
  prevBlockEnd: number,
): { headerRowIndex: number | null; cells: unknown[] | null } {
  let headerIdx: number | null = null;
  for (let i = block.start - 1; i > prevBlockEnd; i--) {
    const row = rows[i];
    if (!row) continue;
    if (STT_PATTERNS.includes(safeStr(row[0]).toLowerCase().trim())) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === null) return { headerRowIndex: null, cells: null };

  // Join the header row with the rows below it, but only while they look like
  // header CONTINUATIONS ("Thành phố", "chú"). Section titles and note lines can
  // also sit between the header and the data; joining those would pollute the
  // column labels (e.g. a "Ghi chú: ..." note landing on the STT column).
  const span: unknown[][] = [rows[headerIdx] ?? []];
  for (let i = headerIdx + 1; i < block.start; i++) {
    const row = rows[i];
    if (!row) continue;
    if (!isHeaderContinuation(row)) break;
    span.push(row);
  }

  const width = Math.max(...span.map((r) => (r ?? []).length), 0);
  const cells: unknown[] = [];
  for (let c = 0; c < width; c++) {
    const parts: string[] = [];
    for (const row of span) {
      const v = safeStr(row?.[c]);
      if (v) parts.push(v);
    }
    cells[c] = parts.join(' ') || null;
  }
  return { headerRowIndex: headerIdx, cells };
}

/**
 * Is this row the tail of a wrapped header rather than prose?
 *
 * Header fragments are short and sit in a few columns ("Thành phố", "chú").
 * A section title or note is one long sentence in a single cell, so we reject
 * rows that carry a long run of text.
 */
function isHeaderContinuation(row: unknown[]): boolean {
  const values = row.map((c) => safeStr(c)).filter((s) => s !== '');
  if (values.length === 0) return false;
  // Any sentence-length cell means this is a note/title line, not a header tail.
  return values.every((v) => v.length <= 30);
}

/** Fraction of items satisfying a predicate (0 when the list is empty). */
function fractionOf<T>(items: T[], pred: (item: T) => boolean): number {
  if (!items.length) return 0;
  return items.filter(pred).length / items.length;
}

/**
 * Score how well a column map fits a block's actual data.
 * Core columns must hold plausible values; an optional column that is mapped
 * but empty on every sampled row counts AGAINST the map — that is the signal
 * that a header borrowed from another table does not belong here.
 */
function scoreColumnMap(colMap: ColumnMap, sample: unknown[][]): number {
  if (!sample.length) return 0;
  let score = 0;
  score += fractionOf(sample, (r) => /\d/.test(safeStr(r[colMap.soTaiKhoanCol]))) * 3;
  score += fractionOf(sample, (r) => toMoney(r[colMap.soTienCol]) > 0) * 3;
  score += fractionOf(sample, (r) => {
    const v = safeStr(r[colMap.hoTenCol]);
    return v.length > 3 && !/^\d+$/.test(v);
  }) * 3;

  for (const col of [colMap.nganHangCol, colMap.tenChiNhanhCol, colMap.tinhTpCol, colMap.ghiChuCol]) {
    if (col === null) continue;
    const filled = fractionOf(sample, (r) => safeStr(r[col]) !== '');
    score += filled > 0 ? filled : -0.5;
  }
  return score;
}

/** Column map used when no header could be resolved — core columns by position. */
const POSITIONAL_COLMAP: ColumnMap = {
  sttCol: 0, hoTenCol: 1, soTaiKhoanCol: 2, soTienCol: 3,
  nganHangCol: null, diaChiCol: null, tenChiNhanhCol: null, tinhTpCol: null,
  ghiChuCol: null, soTienBangChuCol: null, noiDungCol: null,
};

/** Minimum score for a column map to be trusted for a block. */
const MIN_COLMAP_SCORE = 4;

/** Names of the record fields a column map resolves (for diagnostics). */
function mappedFieldNames(colMap: ColumnMap): string[] {
  const named: Array<[string, number | null]> = [
    ['ho_ten', colMap.hoTenCol], ['so_tai_khoan', colMap.soTaiKhoanCol],
    ['so_tien', colMap.soTienCol], ['ngan_hang', colMap.nganHangCol],
    ['dia_chi', colMap.diaChiCol], ['ten_chi_nhanh', colMap.tenChiNhanhCol],
    ['tinh_tp', colMap.tinhTpCol], ['ghi_chu', colMap.ghiChuCol],
    ['so_tien_bang_chu', colMap.soTienBangChuCol], ['noi_dung_thanh_toan_chi_tiet', colMap.noiDungCol],
  ];
  return named.filter(([, col]) => col !== null && col >= 0).map(([name]) => name);
}

// ─── Block Classification ─────────────────────────────────────────────────────

// Section headings are matched as HEADINGS, not bare substrings, so that a
// footnote like "khách hàng ngân hàng khác vui lòng xem mục 2" cannot be
// mistaken for a section start. Tested against normHeader() output.
// Allows an optional leading number/roman numeral: "2.", "II.", "b)".
const HEADING_PREFIX = String.raw`^\s*(?:[ivx]+|\d+|[a-d])?\s*[.)\-]?\s*`;
const NON_VPBANK_HEADING = new RegExp(HEADING_PREFIX + String.raw`[^.]{0,60}?ngan hang khac`);
const VPBANK_HEADING = new RegExp(HEADING_PREFIX + String.raw`[^.]{0,60}?(tai khoan|thu huong|nhan luong)[^.]{0,30}?tai vpbank`);

/**
 * Decide whether a block is the VPBank list or the other-bank list.
 *
 * Two independent signals:
 *   - label: the nearest heading text above the block
 *   - data:  what the block's own bank column says
 *
 * Data wins when they disagree, because the bank cell is per-row ground truth
 * while a heading is a human annotation that goes stale when rows are pasted
 * between sections. Disagreements are reported in meta.blocks[].conflicts.
 */
function classifyBlock(
  rows: unknown[][],
  block: TableBlock,
  colMap: ColumnMap,
  searchFloor: number,
): { kind: 'vpbank' | 'ngan_hang_khac'; conflicts: string[] } {
  // Label evidence: scan upward for the nearest heading.
  let labelKind: 'vpbank' | 'ngan_hang_khac' | null = null;
  for (let i = block.start - 1; i > searchFloor; i--) {
    const row = rows[i];
    if (!row) continue;
    const text = normHeader(rowToText(row));
    if (!text) continue;
    if (NON_VPBANK_HEADING.test(text)) { labelKind = 'ngan_hang_khac'; break; }
    if (VPBANK_HEADING.test(text)) { labelKind = 'vpbank'; break; }
  }

  // Data evidence: the bank column, when the template has one.
  const dataRows = rows.slice(block.start, block.end + 1);
  let dataKind: 'vpbank' | 'ngan_hang_khac' | null = null;
  const conflicts: string[] = [];
  if (colMap.nganHangCol !== null) {
    const banks = dataRows
      .map((r) => safeStr(r[colMap.nganHangCol!]).toLowerCase())
      .filter((b) => b !== '');
    if (banks.length) {
      const vpbShare = fractionOf(banks, (b) => b.includes('vpbank') || b.includes('vp bank'));
      dataKind = vpbShare >= 0.5 ? 'vpbank' : 'ngan_hang_khac';
      // Report individual rows that disagree with the block's own majority.
      dataRows.forEach((r, idx) => {
        const bank = safeStr(r[colMap.nganHangCol!]).toLowerCase();
        if (!bank) return;
        const isVpb = bank.includes('vpbank') || bank.includes('vp bank');
        if ((dataKind === 'vpbank') !== isVpb) {
          conflicts.push(`row ${block.start + idx}: bank="${safeStr(r[colMap.nganHangCol!])}"`);
        }
      });
    }
  }

  if (labelKind && dataKind && labelKind !== dataKind) {
    conflicts.unshift(`section label says ${labelKind} but bank column says ${dataKind}`);
  }
  // Data first, then label, then default to VPBank (single-list templates).
  return { kind: dataKind ?? labelKind ?? 'vpbank', conflicts };
}

// ─── Block-Based Parsing ──────────────────────────────────────────────────────

/**
 * Parse every table on the sheet: detect blocks, resolve each block's header
 * independently, classify it, and extract its records.
 *
 * Replaces the old "find VPBank marker then look after it" approach, which
 * could only ever express two tables in one fixed order.
 */
function parseByBlocks(rows: unknown[][]): {
  vpbankList: PayrollRecord[];
  nonVpbankList: PayrollRecord[];
  blocks: BlockMeta[];
} {
  const blocks = findTableBlocks(rows);
  const vpbankList: PayrollRecord[] = [];
  const nonVpbankList: PayrollRecord[] = [];
  const blockMeta: BlockMeta[] = [];

  // Column maps of blocks already parsed — candidates to borrow from when a
  // block has no header of its own.
  const resolvedMaps: ColumnMap[] = [];
  let prevEnd = -1;

  for (const block of blocks) {
    const dataRows = rows.slice(block.start, block.end + 1);
    const sample = dataRows.slice(0, 10);

    const { headerRowIndex, cells } = resolveBlockHeader(rows, block, prevEnd);

    let colMap = POSITIONAL_COLMAP;
    let headerSource: 'own' | 'positional' = 'positional';

    if (cells) {
      const own = detectColumns(cells, dataRows[0]);
      if (scoreColumnMap(own, sample) >= MIN_COLMAP_SCORE) {
        colMap = own;
        headerSource = 'own';
      }
    }

    // No usable header of its own: borrow a sibling's, but ONLY if it actually
    // fits this block's data. A borrowed map whose extra columns are empty here
    // scores below threshold and is rejected, so we never silently misalign
    // tables that genuinely have different columns.
    if (headerSource === 'positional') {
      let best: ColumnMap | null = null;
      let bestScore = MIN_COLMAP_SCORE;
      for (const candidate of resolvedMaps) {
        const s = scoreColumnMap(candidate, sample);
        if (s > bestScore) { bestScore = s; best = candidate; }
      }
      if (best) colMap = best;
    }

    const { kind, conflicts } = classifyBlock(rows, block, colMap, prevEnd);
    const records = extractRecords(dataRows, colMap, kind);

    // When the table has a bank column, trust it PER ROW. A flat single-table
    // template (no section headings) mixes VPBank and other-bank people in one
    // block, so a single verdict for the whole block would be wrong for half of
    // them. Rows with an empty bank cell keep the block's classification.
    if (colMap.nganHangCol !== null) {
      for (const record of records) {
        const bank = (record.ngan_hang || '').toLowerCase();
        const rowKind = bank === ''
          ? kind
          : (bank.includes('vpbank') || bank.includes('vp bank') ? 'vpbank' : 'ngan_hang_khac');
        record.loai_tai_khoan = rowKind;
        (rowKind === 'vpbank' ? vpbankList : nonVpbankList).push(record);
      }
    } else {
      (kind === 'vpbank' ? vpbankList : nonVpbankList).push(...records);
    }

    blockMeta.push({
      kind,
      rowRange: [block.start, block.end],
      headerRowIndex,
      headerSource,
      mappedFields: mappedFieldNames(colMap),
      recordCount: records.length,
      conflicts,
    });

    if (headerSource === 'own') resolvedMaps.push(colMap);
    prevEnd = block.end;
  }

  return { vpbankList, nonVpbankList, blocks: blockMeta };
}

// ─── General Info Extraction ──────────────────────────────────────────────────

/**
 * Extract ALL text outside the data table(s) for AI header extraction.
 *
 * Rule: Bóc tách riêng phần bảng (data rows) để đọc bằng rule-based parser.
 *       TOÀN BỘ text còn lại (trên + dưới + giữa sections) đưa cho AI đọc.
 *
 * "Outside" = everything that is NOT a data row (STT = valid integer > 0).
 * This includes: header text, section markers, sub-headers, footer/signatures,
 * bank processing info, approval sections, etc.
 */
function extractGeneralInfo(rows: unknown[][], headerRowIndex: number | null, vpbMarkerIdx: number | null): string {
  // Strategy: collect ALL rows that are NOT data rows within the table region.
  // A "data row" is one where cell[0] is a valid positive integer (STT).

  // Determine table boundaries
  const tableStartIdx = vpbMarkerIdx ?? headerRowIndex ?? rows.length;

  // Find table end: last row with valid STT or section end marker
  let tableEndIdx = tableStartIdx;
  if (tableStartIdx < rows.length) {
    // Scan forward to find where data ends
    let lastDataOrMarkerIdx = tableStartIdx;
    for (let i = tableStartIdx; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const rowText = rowToLower(row);
      // Still in table region if: has STT, is a section marker, is a sub-header, or end marker
      const stt = parseStt(row[0]);
      const isDataRow = stt !== null && stt > 0;
      const isSectionMarker = matchesAnyMarker(rowText, VPBANK_SECTION_MARKERS) || matchesAnyMarker(rowText, NON_VPBANK_SECTION_MARKERS);
      const isEndMarker = SECTION_END_MARKERS.test(rowText);
      const isSubHeader = STT_PATTERNS.includes(safeStr(row[0]).toLowerCase().trim());

      if (isDataRow || isSectionMarker || isEndMarker || isSubHeader) {
        lastDataOrMarkerIdx = i;
      } else if (i > lastDataOrMarkerIdx + 3) {
        // More than 3 consecutive non-table rows → we've left the table region
        break;
      }
    }
    tableEndIdx = lastDataOrMarkerIdx + 1;
  }

  const outsideText: string[] = [];

  // Part 1: ALL text ABOVE the table start
  for (let i = 0; i < tableStartIdx; i++) {
    const row = rows[i];
    if (!row) continue;
    const txt = rowToText(row);
    if (txt) outsideText.push(txt);
  }

  // Part 2: Non-data rows WITHIN the table region (section markers, sub-headers, end markers)
  // These contain useful info like "Tổng số món chuyển: 5", section labels, etc.
  for (let i = tableStartIdx; i < tableEndIdx; i++) {
    const row = rows[i];
    if (!row) continue;
    const stt = parseStt(row[0]);
    const isDataRow = stt !== null && stt > 0;
    if (!isDataRow) {
      const txt = rowToText(row);
      if (txt) outsideText.push(txt);
    }
  }

  // Part 3: ALL text BELOW the table end (signatures, bank processing, approval)
  for (let i = tableEndIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const txt = rowToText(row);
    if (txt) outsideText.push(txt);
  }

  return outsideText.join('\n').trim();
}

// ─── Header Parser (Code-based fallback) ──────────────────────────────────────

/**
 * Parse structured header info from generalInfo text using regex patterns.
 * Used as fallback when AI extraction fails or returns empty.
 */
export function parseHeaderFromText(generalInfo: string): ParsedHeader {
  if (!generalInfo) {
    return {
      ten_don_vi_de_nghi: null, ma_kh_cif: null, dia_chi_don_vi_de_nghi: null,
      so_dien_thoai: null, so_tai_khoan_trich_no: null, ngan_hang_chi_ho: 'VPBANK',
      // No currency default: an empty document states no currency.
      loai_tien: null, tong_so_tien_bang_so: null, tong_so_tien_bang_chu: null,
      ngay_lenh_chi: null, noi_dung_thanh_toan: null,
      so_chung_tu: null, ngay_lap: null, chi_nhanh_vpbank: null, ma_bieu_mau: null,
      dia_diem_lap: null, fax: null, cmnd_cccd: null, ten_chu_tai_khoan: null,
      mo_tai: null, muc_dich: null, danh_sach_chi_luong_so: null,
      noi_dung_chuyen_tien: null, ten_don_vi_chuyen_tien: null,
      tai_khoan_trung_gian: null, ngay_nhan_tien_tk_trung_gian: null, ngay_chuyen_tien: null,
      don_vi_chuyen_tien_tai_khoan_treo: null, thoi_gian: null, tong_cong_don_vi: null, don_vi_tinh: null,
    };
  }

  const fullText = generalInfo;

  function findValue(patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
      const match = fullText.match(pattern);
      if (match && match[1]?.trim()) return match[1].trim();
    }
    return null;
  }

  const tenDonVi = findValue([
    /(?:tên\s+doanh\s+nghiệp|tên\s+đơn\s+vị|tên\s+công\s+ty|tên\s+cá\s+nhân|tên\s+khách\s+hàng)\*?\s*:\s*(.+?)(?:\s+mã\s+kh|\s*$)/im,
    /(?:tên\s+doanh\s+nghiệp|tên\s+đơn\s+vị|tên\s+công\s+ty|tên\s+cá\s+nhân|tên\s+khách\s+hàng)\*?\s*:\s*(.+)/im,
  ]);

  const maCif = findValue([/mã\s+kh\s*\(?cif\)?\s*:\s*(\S+)/im, /cif\s*:\s*(\S+)/im]);
  const diaChi = findValue([/địa\s+chỉ\*?\s*:\s*(.+)/im]);
  const soDienThoai = findValue([/(?:điện\s+thoại|đt|sđt)\s*(?:liên\s+lạc)?\s*:\s*([\d\s\-\.]+)/im]);
  const soTaiKhoan = findValue([/tài\s+khoản\s+trích[^:]*:\s*([\d\s]+)/im, /số\s+tài\s+khoản\s+trích[^:]*:\s*([\d\s]+)/im]);
  // Capture to end of line, not \w+ — \w excludes Vietnamese letters, so
  // "Loại tiền: Việt nam đồng" used to yield "Vi". The label is kept EXACTLY as
  // written (see detectLoaiTien): the compare engine normalizes case/accents on
  // both sides, so folding it to a code here would only hide the real text.
  // No "VND" default either — a document that states no currency must read as
  // null, not as a value it never contained.
  const loaiTien = findValue([/loại\s+tiền\s*:?\s*(.+)$/im]);
  const tongTienBangSo = findValue([/bằng\s+số\s*:\s*([\d\.,]+)\s*(?:vnđ|vnd|đồng)?/im, /tổng\s+(?:số\s+)?tiền[^:]*\(bằng\s+số\)\s*:\s*([\d\.,]+)/im]);
  const tongTienBangChu = findValue([/bằng\s+chữ\s*:\s*(.+)/im]);
  const ngayLenhChi = findValue([/ngày\s+(?:lệnh\s+chi|có\s+giá\s+trị)[^:]*:\s*.*?(\d{1,2}\/\d{1,2}\/\d{4})/im, /(\d{1,2}\/\d{1,2}\/\d{4})/m]);
  const noiDungThanhToan = findValue([/nội\s+dung\s+thanh\s+toán\*?\s*:\s*(.+)/im]);

  // Additional fields
  const soChungTu = findValue([/số\s+chứng\s+từ\s*:\s*(\S+)/im, /số\s*:\s*(\S+)/im]);
  const ngayLap = findValue([/ngày\s+lập\s*:\s*.*?(\d{1,2}\/\d{1,2}\/\d{4})/im]);
  const chiNhanhVpbank = findValue([/chi\s+nhánh\s*:\s*(.+)/im, /vpbank\s+chi\s+nhánh\s*(.+)/im]);
  const maBieuMau = findValue([/mã\s+biểu\s+mẫu\s*:\s*(\S+)/im, /biểu\s+mẫu\s*:\s*(\S+)/im]);
  const diaDiemLap = findValue([/(?:tại|nơi\s+lập)\s*:\s*(.+)/im]);
  const fax = findValue([/fax\s*:\s*([\d\s\-\.]+)/im]);
  const cmndCccd = findValue([/(?:cmnd|cccd|cmtnd|căn\s+cước)\s*(?:số)?\s*:\s*(\S+)/im]);
  const tenChuTaiKhoan = findValue([/(?:chủ\s+tài\s+khoản|tên\s+chủ\s+tk)\s*:\s*(.+)/im]);
  const moTai = findValue([/mở\s+tại\s*:\s*(.+)/im]);
  const mucDich = findValue([/mục\s+đích\s*:\s*(.+)/im]);
  const danhSachChiLuongSo = findValue([/danh\s+sách\s+chi\s+lương\s+số\s*:\s*(\S+)/im]);
  const noiDungChuyenTien = findValue([/nội\s+dung\s+chuyển\s+tiền\s*:\s*(.+)/im]);
  const tenDonViChuyenTien = findValue([/(?:đơn\s+vị|tên\s+đơn\s+vị)\s+chuyển\s+tiền\s*:\s*(.+)/im]);
  const taiKhoanTrungGian = findValue([/tài\s+khoản\s+trung\s+gian\s*:\s*([\d\s]+)/im]);
  const ngayNhanTienTkTrungGian = findValue([/ngày\s+nhận\s+tiền\s+(?:tk\s+)?trung\s+gian\s*:\s*.*?(\d{1,2}\/\d{1,2}\/\d{4})/im]);
  const ngayChuyenTien = findValue([/ngày\s+chuyển\s+tiền\s*:\s*.*?(\d{1,2}\/\d{1,2}\/\d{4})/im]);

  // New BU fields
  const donViChuyenTienTaiKhoanTreo = findValue([/đơn\s+vị\s+chuyển\s+tiền\s*:\s*(.+)/im]);
  const thoiGian = findValue([/thời\s+gian\s*:\s*(.+)/im]);
  const tongCongDonVi = findValue([/tổng\s+cộng\s*:\s*([\d\.,]+)/im]);
  const donViTinh = findValue([/đơn\s+vị\s+tính\s*:\s*(.+)/im]);

  return {
    ten_don_vi_de_nghi: tenDonVi ? tenDonVi.toUpperCase() : null,
    ma_kh_cif: maCif || null,
    dia_chi_don_vi_de_nghi: diaChi || null,
    so_dien_thoai: soDienThoai?.replace(/[\s\-\.]/g, '') || null,
    so_tai_khoan_trich_no: soTaiKhoan?.replace(/\s/g, '') || null,
    ngan_hang_chi_ho: 'VPBANK',
    loai_tien: loaiTien,
    tong_so_tien_bang_so: tongTienBangSo || null,
    tong_so_tien_bang_chu: tongTienBangChu || null,
    ngay_lenh_chi: ngayLenhChi || null,
    noi_dung_thanh_toan: noiDungThanhToan || null,
    so_chung_tu: soChungTu || null,
    ngay_lap: ngayLap || null,
    chi_nhanh_vpbank: chiNhanhVpbank || null,
    ma_bieu_mau: maBieuMau || null,
    dia_diem_lap: diaDiemLap || null,
    fax: fax?.replace(/[\s\-\.]/g, '') || null,
    cmnd_cccd: cmndCccd || null,
    ten_chu_tai_khoan: tenChuTaiKhoan || null,
    mo_tai: moTai || null,
    muc_dich: mucDich || null,
    danh_sach_chi_luong_so: danhSachChiLuongSo || null,
    noi_dung_chuyen_tien: noiDungChuyenTien || null,
    ten_don_vi_chuyen_tien: tenDonViChuyenTien || null,
    tai_khoan_trung_gian: taiKhoanTrungGian?.replace(/\s/g, '') || null,
    ngay_nhan_tien_tk_trung_gian: ngayNhanTienTkTrungGian || null,
    ngay_chuyen_tien: ngayChuyenTien || null,
    don_vi_chuyen_tien_tai_khoan_treo: donViChuyenTienTaiKhoanTreo || null,
    thoi_gian: thoiGian || null,
    tong_cong_don_vi: tongCongDonVi ? toMoney(tongCongDonVi) : null,
    don_vi_tinh: donViTinh || null,
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Parse a payroll Excel file into structured data.
 *
 * Algorithm:
 * 1. Validate single-sheet
 * 2. Scan for VPBank section markers
 * 3. If markers found → marker-based parsing (split VPBank / non-VPBank)
 * 4. If no markers → find STT header → flat-list parsing
 * 5. Extract generalInfo text from rows above table
 * 6. Parse header from generalInfo (code fallback)
 */
export function parsePayrollExcel(buffer: Buffer): ExcelParseResult {
  const workbook = xlsx.read(buffer, { type: 'buffer' });

  // Strict: only accept single-sheet files
  if (workbook.SheetNames.length > 1) {
    throw new Error(
      `EXCEL_PARSE_FAILED: File Excel có ${workbook.SheetNames.length} sheets (${workbook.SheetNames.join(', ')}). ` +
      `Hệ thống chỉ chấp nhận file 1 sheet duy nhất. ` +
      `Vui lòng gửi file đúng format hoặc tách sheet trước khi gửi.`
    );
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  // blankrows:true keeps the spacer rows that separate two tables — findTableBlocks
  // uses those gaps (together with STT resets) to tell one table from the next.
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: true,
    defval: null,
  }) as unknown[][];

  // Step 2: Find every data table structurally, then read and classify each one.
  const { vpbankList, nonVpbankList, blocks } = parseByBlocks(rows);

  if (blocks.length === 0) {
    throw new Error(
      `EXCEL_PARSE_FAILED: Không tìm thấy bảng dữ liệu nào trong sheet "${sheetName}". ` +
      `File không đúng format bảng lương.`
    );
  }

  // Kept for backward compatibility with existing callers/logs.
  const headerRowIndex = findHeaderRow(rows);
  const vpbMarkerIdx = blocks.findIndex((b) => b.kind === 'vpbank') !== -1
    ? blocks.find((b) => b.kind === 'vpbank')!.headerRowIndex
    : null;
  const parseMode: 'markers' | 'flat-list' = blocks.length > 1 ? 'markers' : 'flat-list';

  // Step 3: Extract general info (text outside the tables)
  const generalInfo = extractGeneralInfo(rows, headerRowIndex, vpbMarkerIdx);

  // Step 4: Code-based header parsing (fallback)
  const parsedHeader = parseHeaderFromText(generalInfo);

  return {
    generalInfo,
    vpbankList,
    nonVpbankList,
    parsedHeader,
    meta: {
      sheetName,
      parseMode,
      headerRowIndex,
      vpbankRecordCount: vpbankList.length,
      nonVpbankRecordCount: nonVpbankList.length,
      blocks,
    },
  };
}


// ─── Backward Compatibility Export ────────────────────────────────────────────

/**
 * Legacy function for backward compatibility with existing tests.
 * Combines findHeaderRow + extractGeneralInfo + table end detection.
 */
export function findHeaderAndOutsideText(
  rows: unknown[][],
): {
  found: boolean;
  headerRowIndex: number | null;
  tableEndIndex: number | null;
  generalInfo: string;
} {
  // Legacy behavior: only match "stt" (not "tt") for backward compat with tests
  let headerRowIndex: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const firstCell = safeStr(row[0]).toLowerCase().trim();
    if (firstCell === 'stt' || firstCell === 'số tt' || firstCell === 'no.' || firstCell === 'no') {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === null) {
    return { found: false, headerRowIndex: null, tableEndIndex: null, generalInfo: '' };
  }

  // Find table end using invalidStreak (legacy behavior for tests)
  let tableEndIndex = rows.length;
  let invalidStreak = 0;
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const firstCellVal = row && row.length > 0 ? row[0] : null;
    const sttVal = parseStt(firstCellVal);
    if (sttVal === null) {
      invalidStreak++;
      if (invalidStreak >= 2) { tableEndIndex = i - 1; break; }
    } else {
      invalidStreak = 0;
    }
  }

  // Extract general_info text
  const outsideText: string[] = [];
  for (let i = 0; i < headerRowIndex; i++) {
    const row = rows[i];
    if (!row) continue;
    const txt = rowToText(row);
    if (txt) outsideText.push(txt);
  }
  for (let i = tableEndIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const txt = rowToText(row);
    if (txt) outsideText.push(txt);
  }

  return {
    found: true,
    headerRowIndex,
    tableEndIndex,
    generalInfo: outsideText.join('\n').trim(),
  };
}
