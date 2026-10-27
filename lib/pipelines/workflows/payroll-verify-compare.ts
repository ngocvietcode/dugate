// lib/pipelines/workflows/payroll-verify-compare.ts
// Rule-based compare engine for the Payroll Verify workflow.
// Port of CompareJSON.js to TypeScript with full type safety.
//
// This module contains normalization functions and value comparison utilities.
// Header/detail comparison functions will be added in a subsequent task.

import type {
  CompareConfig,
  CompareMode,
  CompareOptions,
  CompareResult,
  CompareSummary,
  DetailFieldRule,
  DetailRule,
  DetailRowResult,
  DetailSectionResult,
  ExtraRow,
  HeaderFieldResult,
  HeaderRule,
  MissingRow,
  PayrollJSON,
  PayrollRecord,
  SideBySideField,
} from './prompts/payroll-verify-prompts';

import {
  ALL_TTC_FIELDS,
  ALL_RECORD_FIELDS,
  COUNTER_TTC_FIELDS,
  pickCompareModeV2,
} from './prompts/payroll-verify-prompts';

import { parseMoneyValue } from './payroll-money';

// ─── PayrollRecord Field Keys (for side_by_side generation) ───────────────────

const PAYROLL_RECORD_FIELDS: string[] = [
  'stt', 'ho_ten', 'so_tai_khoan', 'so_tien', 'loai_tai_khoan', 'ngan_hang',
];

// ─── Row Display Formatter ────────────────────────────────────────────────────

/**
 * Display column order for formatRecordLine.
 * Only columns with a non-null/non-empty value are rendered; others show "—".
 */
const DISPLAY_COLUMNS: Array<keyof PayrollRecord> = [
  'stt',
  'ho_ten',
  'so_tai_khoan',
  'so_tien',
  'so_tien_bang_chu',
  'dia_chi',
  'ngan_hang',
  'ten_chi_nhanh',
  'tinh_tp',
  'ghi_chu',
];

/** Vietnamese display label for each field used in the reason parenthetical. */
const FIELD_COMMENT_LABEL: Record<string, string> = {
  ho_ten:               'sai lệch họ tên',
  so_tai_khoan:         'sai lệch số tài khoản',
  so_tien:              'sai lệch số tiền',
  ngan_hang:            'sai lệch ngân hàng',
  ten_chi_nhanh:        'sai lệch chi nhánh',
  tinh_tp:              'sai lệch tỉnh/TP',
  dia_chi:              'sai lệch địa chỉ',
  so_tien_bang_chu:     'sai lệch số tiền bằng chữ',
  ghi_chu:              'sai lệch ghi chú',
  noi_dung_thanh_toan_chi_tiet: 'sai lệch nội dung thanh toán',
  loai_tien:            'sai lệch loại tiền',
};

/**
 * Format a PayrollRecord as a single human-readable display line.
 * Renders dynamic columns — only those present in DISPLAY_COLUMNS.
 * Fields that are null/empty/"0" are shown as "—".
 * so_tien is formatted with thousand separators (e.g. 50000000 → "50,000,000").
 *
 * Example output:
 *   STT 29  NGUYEN THỊ THUY  2505205472617  50,000,000  —  —  TECHCOMBANK  Hiệp Hòa  Bắc Ninh
 */
function formatRecordLine(row: PayrollRecord): string {
  const EMPTY = '—';
  const parts: string[] = [];

  for (const field of DISPLAY_COLUMNS) {
    const val = (row as unknown as Record<string, unknown>)[field];

    if (field === 'stt') {
      parts.push(`STT ${val ?? EMPTY}`);
      continue;
    }

    if (val === null || val === undefined || val === '' || val === 0) {
      parts.push(EMPTY);
      continue;
    }

    if (field === 'so_tien') {
      // Format number with thousand separators
      const n = typeof val === 'number' ? val : Number(String(val).replace(/[^0-9]/g, ''));
      parts.push(isNaN(n) ? String(val) : n.toLocaleString('vi-VN'));
      continue;
    }

    parts.push(String(val));
  }

  return parts.join('  ');
}

/**
 * Build a human-readable row_reason string combining the display line and reason.
 * Only called for failing rows — pass rows keep row_reason = ''.
 *
 * Example output (mismatch):
 *   STT 29  NGUYEN THỊ THUY  2505205472617  50,000,000  —  —  TECHCOMBANK  Hiệp Hòa  Bắc Ninh
 *   ( sai lệch họ tên / sai lệch ngân hàng )
 *
 * Example output (missing):
 *   STT 29  NGUYEN THỊ THUY  2505205472617  50,000,000  —  —  —  —  —
 *   ( không tìm thấy trên PDF )
 */
function buildRowReason(row: PayrollRecord, reasons: string[]): string {
  const displayLine = formatRecordLine(row);
  const reasonText = `( ${reasons.join(' / ')} )`;
  return `${displayLine}\n${reasonText}`;
}

// ─── Greek/Cyrillic → Latin Homoglyph Map ─────────────────────────────────────
// AI OCR sometimes returns visually-identical Greek or Cyrillic characters
// instead of Latin. This map normalizes them before comparison.

const HOMOGLYPH_MAP: Record<string, string> = {
  // Greek uppercase → Latin
  '\u0391': 'A', // Α → A
  '\u0392': 'B', // Β → B
  '\u0395': 'E', // Ε → E
  '\u0396': 'Z', // Ζ → Z
  '\u0397': 'H', // Η → H
  '\u0399': 'I', // Ι → I
  '\u039A': 'K', // Κ → K
  '\u039C': 'M', // Μ → M
  '\u039D': 'N', // Ν → N
  '\u039F': 'O', // Ο → O
  '\u03A1': 'P', // Ρ → P
  '\u03A4': 'T', // Τ → T
  '\u03A5': 'Y', // Υ → Y
  '\u03A7': 'X', // Χ → X
  // Greek lowercase → Latin
  '\u03BF': 'o', // ο → o
  '\u03B1': 'a', // α → a (close enough in some fonts)
  // Cyrillic uppercase → Latin
  '\u0410': 'A', // А → A
  '\u0412': 'B', // В → B (visually = B in many fonts)
  '\u0415': 'E', // Е → E
  '\u041A': 'K', // К → K
  '\u041C': 'M', // М → M
  '\u041D': 'H', // Н → H
  '\u041E': 'O', // О → O
  '\u0420': 'P', // Р → P
  '\u0421': 'C', // С → C
  '\u0422': 'T', // Т → T
  '\u0423': 'Y', // У → Y (close)
  '\u0425': 'X', // Х → X
  // Cyrillic lowercase → Latin
  '\u0430': 'a', // а → a
  '\u0435': 'e', // е → e
  '\u043E': 'o', // о → o
  '\u0440': 'p', // р → p
  '\u0441': 'c', // с → c
  '\u0445': 'x', // х → x
};

/**
 * Replace Greek/Cyrillic homoglyphs with their Latin equivalents.
 * This handles AI OCR errors where visually-identical characters
 * from different Unicode blocks are returned (e.g., Greek Β instead of Latin B).
 */
export function normalizeHomoglyphs(text: string): string {
  if (!text) return '';
  let result = '';
  for (const ch of text) {
    result += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return result;
}

// ─── Vietnamese Accent Map ────────────────────────────────────────────────────

const VIETNAMESE_ACCENT_MAP: Record<string, string> = {
  'à': 'a', 'á': 'a', 'ạ': 'a', 'ả': 'a', 'ã': 'a',
  'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ậ': 'a', 'ẩ': 'a', 'ẫ': 'a',
  'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ặ': 'a', 'ẳ': 'a', 'ẵ': 'a',
  'è': 'e', 'é': 'e', 'ẹ': 'e', 'ẻ': 'e', 'ẽ': 'e',
  'ê': 'e', 'ề': 'e', 'ế': 'e', 'ệ': 'e', 'ể': 'e', 'ễ': 'e',
  'ì': 'i', 'í': 'i', 'ị': 'i', 'ỉ': 'i', 'ĩ': 'i',
  'ò': 'o', 'ó': 'o', 'ọ': 'o', 'ỏ': 'o', 'õ': 'o',
  'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ộ': 'o', 'ổ': 'o', 'ỗ': 'o',
  'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ợ': 'o', 'ở': 'o', 'ỡ': 'o',
  'ù': 'u', 'ú': 'u', 'ụ': 'u', 'ủ': 'u', 'ũ': 'u',
  'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ự': 'u', 'ử': 'u', 'ữ': 'u',
  'ỳ': 'y', 'ý': 'y', 'ỵ': 'y', 'ỷ': 'y', 'ỹ': 'y',
  'đ': 'd',
};

// ─── Normalization Functions ──────────────────────────────────────────────────

/**
 * Remove Vietnamese diacritical marks from a string.
 * Maps all accented characters to ASCII equivalents.
 * e.g., "NGUYỄN VĂN A" → "NGUYEN VAN A"
 */
export function removeVietnameseAccents(text: string): string {
  if (text == null) return '';
  let s = String(text).toLowerCase();
  for (const k of Object.keys(VIETNAMESE_ACCENT_MAP)) {
    s = s.replaceAll(k, VIETNAMESE_ACCENT_MAP[k]);
  }
  return s;
}

/**
 * Normalize a string value based on compare mode and options.
 * Modes: 'string_exact', 'string_normalized', 'vietnamese_name_normalized'
 */
export function normalizeString(
  value: unknown,
  options: CompareOptions,
  mode: CompareMode,
): string {
  let s = value == null ? '' : String(value);

  if (value == null && options.treat_null_as_empty) {
    s = '';
  }

  // Always normalize homoglyphs first (Greek/Cyrillic → Latin)
  // This handles AI OCR confusion where Β(Greek) is returned instead of B(Latin)
  s = normalizeHomoglyphs(s);

  if (options.trim_string) {
    s = s.trim();
  }

  if (options.collapse_whitespace) {
    s = s.replace(/\s+/g, ' ');
  }

  // string_normalized_compact: strip ALL whitespace after collapse
  // Used for bank names where "VP BANK" should match "VPBANK"
  if (mode === 'string_normalized_compact') {
    s = s.replace(/\s+/g, '');
  }

  if (mode === 'vietnamese_name_normalized' || options.remove_vietnamese_accents) {
    s = removeVietnameseAccents(s);
  }

  if (
    options.case_insensitive ||
    mode === 'string_normalized' ||
    mode === 'string_normalized_compact' ||
    mode === 'vietnamese_name_normalized'
  ) {
    s = s.toUpperCase();
  }

  return s;
}

/**
 * Normalize a numeric value: remove separators (dots, commas, spaces), parse.
 * "133.855.000" → "133855000"
 */
export function normalizeNumber(
  value: unknown,
  options: CompareOptions,
): string | number {
  let s = value == null ? '' : String(value);

  if (value == null && options.treat_null_as_empty) {
    s = '';
  }

  if (options.trim_string) {
    s = s.trim();
  }

  // Remove all whitespace
  s = s.replace(/\s+/g, '');

  // Remove thousand separators (dots and commas)
  s = s.replace(/[.,]/g, '');

  const n = Number(s);
  if (Number.isNaN(n)) {
    return s;
  }

  return options.number_parse_float ? n : s;
}

/**
 * Normalize a money value to a canonical numeric string using the locale-aware
 * parser (no lossy rounding, decimal/thousands resolved deterministically).
 * Returns '' when the value cannot be parsed. Used for display/report fields of
 * the 'money_normalized' compare mode. Additive — normalizeNumber is unchanged.
 */
export function normalizeMoney(value: unknown, locale: 'vn' | 'us' = 'vn'): string {
  const v = parseMoneyValue(value, locale);
  return v == null ? '' : String(v);
}

/**
 * Resolve a dot-notation path on an object.
 * e.g., getByPath(obj, "thong_tin_chung.ten_don_vi_chuyen_tien") → value
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce(
    (acc: unknown, key: string) => (acc as Record<string, unknown>)?.[key],
    obj,
  );
}

/**
 * Compare two values using the specified mode and options.
 * Returns normalized values and pass/fail result.
 */
export function compareValues(
  a: unknown,
  b: unknown,
  mode: CompareMode,
  options: CompareOptions,
): { normalizedA: string; normalizedB: string; result: 'pass' | 'fail' } {
  let normalizedA: string | number;
  let normalizedB: string | number;

  switch (mode) {
    case 'number_normalized':
      normalizedA = normalizeNumber(a, options);
      normalizedB = normalizeNumber(b, options);
      break;

    case 'money_normalized': {
      // Locale-aware parse, then STRICT numeric comparison — NO rounding.
      // Any real difference in money is flagged (e.g. exact 25369005.6 vs 25369006
      // → fail → must be reviewed). Parsing still resolves format/locale so
      // "133.855.000" / "133.855.000,00" / 133855000 are recognised as equal.
      // amount_tolerance defaults to 0 (exact); only IEEE float noise is absorbed.
      const locale = options.amount_locale ?? 'vn';
      const eps = options.amount_tolerance ?? 0;
      const av = parseMoneyValue(a, locale);
      const bv = parseMoneyValue(b, locale);
      const normA = normalizeMoney(a, locale);
      const normB = normalizeMoney(b, locale);
      const result: 'pass' | 'fail' =
        av != null && bv != null
          ? (Math.abs(av - bv) <= eps ? 'pass' : 'fail')
          : (normA === normB ? 'pass' : 'fail');
      return { normalizedA: normA, normalizedB: normB, result };
    }

    case 'string_exact':
      normalizedA = a == null ? '' : String(a);
      normalizedB = b == null ? '' : String(b);
      break;

    case 'string_normalized':
    case 'string_normalized_compact':
    case 'vietnamese_name_normalized':
    default:
      normalizedA = normalizeString(a, options, mode);
      normalizedB = normalizeString(b, options, mode);
      break;
  }

  const result = String(normalizedA) === String(normalizedB) ? 'pass' : 'fail';

  return {
    normalizedA: String(normalizedA),
    normalizedB: String(normalizedB),
    result,
  };
}

// ─── Header Comparison ────────────────────────────────────────────────────────

/**
 * Compare header fields between two sources using header_rules.
 * Each rule specifies a dot-notation path into both sources and a compare mode.
 */
function compareHeader(
  sourceA: PayrollJSON,
  sourceB: PayrollJSON,
  headerRules: HeaderRule[],
  options: CompareOptions,
): { headerCompare: HeaderFieldResult[]; headerStatus: 'pass' | 'fail' } {
  const headerCompare: HeaderFieldResult[] = [];

  for (const rule of headerRules ?? []) {
    const a = getByPath(sourceA, rule.source_a_path);
    const b = getByPath(sourceB, rule.source_b_path);

    const rs = compareValues(a, b, rule.compare_mode, options);

    headerCompare.push({
      field_code: rule.field_code,
      compare_mode: rule.compare_mode,
      excel_value: a,
      pdf_value: b,
      normalized_excel_value: rs.normalizedA,
      normalized_pdf_value: rs.normalizedB,
      result: rs.result,
      reason: rs.result === 'pass' ? '' : `Trường "${rule.field_code}" không khớp`,
    });
  }

  const headerStatus = headerCompare.some((x) => x.result === 'fail') ? 'fail' : 'pass';

  return { headerCompare, headerStatus };
}

// ─── Detail Section Comparison ────────────────────────────────────────────────

/**
 * Compare a single detail section (e.g., trong_vpbank or ngoai_vpbank).
 * Matches rows by match_key, compares fields, detects missing/extra rows.
 */
function compareDetailSection(
  sourceA: PayrollJSON,
  sourceB: PayrollJSON,
  detailRule: DetailRule,
  options: CompareOptions,
): DetailSectionResult {
  const sectionCode = detailRule.section_code || 'unknown_section';

  const listA = getByPath(sourceA, detailRule.source_a_list_path);
  const listB = getByPath(sourceB, detailRule.source_b_list_path);

  if (!Array.isArray(listA) || !Array.isArray(listB)) {
    throw new Error(
      `detail_rules[${sectionCode}] list path không trỏ tới array hợp lệ`,
    );
  }

  const keyName = detailRule.match_key;
  const mapB = new Map<string, PayrollRecord>();
  const keysA = new Set<string>();
  const detailCompare: DetailRowResult[] = [];
  const missingRows: MissingRow[] = [];
  const extraRows: ExtraRow[] = [];

  // Build lookup map for source B (first occurrence wins on duplicate keys)
  for (const rowB of listB) {
    const rawKey = (rowB as Record<string, unknown>)?.[keyName];
    const key = rawKey == null ? '' : String(rawKey);
    if (!mapB.has(key)) {
      mapB.set(key, rowB as PayrollRecord);
    }
  }

  // Compare A → B
  for (const rowA of listA) {
    const rawKey = (rowA as Record<string, unknown>)?.[keyName];
    const key = rawKey == null ? '' : String(rawKey);
    keysA.add(key);

    if (!mapB.has(key)) {
      // Build side_by_side for missing row (pdf values all null)
      const sideBySide: SideBySideField[] = PAYROLL_RECORD_FIELDS.map((fc) => {
        const excelVal = (rowA as Record<string, unknown>)?.[fc];
        const comparedField = detailRule.compare_fields?.find((f) => f.source_a_field === fc);
        return {
          field_code: fc,
          excel_value: excelVal,
          pdf_value: null,
          is_compared: !!comparedField,
          result: 'skipped' as const,
        };
      });

      missingRows.push({
        match_key: key,
        excel_row: rowA as PayrollRecord,
        reason: 'missing_in_pdf',
      });

      detailCompare.push({
        match_key: key,
        found_in_pdf: false,
        excel_row: rowA as PayrollRecord,
        pdf_row: null,
        field_results: [],
        side_by_side: sideBySide,
        row_result: 'fail',
        row_reason: buildRowReason(rowA as PayrollRecord, ['không tìm thấy trên PDF']),
      });

      continue;
    }

    const rowB = mapB.get(key)!;
    const fieldResults: HeaderFieldResult[] = [];

    for (const field of detailRule.compare_fields ?? []) {
      const a = (rowA as Record<string, unknown>)?.[field.source_a_field];
      const b = (rowB as unknown as Record<string, unknown>)?.[field.source_b_field];

      const rs = compareValues(a, b, field.compare_mode, options);

      fieldResults.push({
        field_code: field.field_code,
        compare_mode: field.compare_mode,
        excel_value: a,
        pdf_value: b,
        normalized_excel_value: rs.normalizedA,
        normalized_pdf_value: rs.normalizedB,
        result: rs.result,
        reason: rs.result === 'pass' ? '' : `Trường "${field.field_code}" không khớp`,
      });
    }

    const rowResult = fieldResults.some((x) => x.result === 'fail') ? 'fail' : 'pass';
    const failedFields = fieldResults.filter((x) => x.result === 'fail').map((x) => x.field_code);

    // Build side_by_side: all PayrollRecord fields with compare result
    const fieldResultMap = new Map(fieldResults.map((fr) => [fr.field_code, fr]));
    const sideBySide: SideBySideField[] = PAYROLL_RECORD_FIELDS.map((fc) => {
      const excelVal = (rowA as Record<string, unknown>)?.[fc];
      const pdfVal = (rowB as unknown as Record<string, unknown>)?.[fc];
      const fr = fieldResultMap.get(fc);
      return {
        field_code: fc,
        excel_value: excelVal,
        pdf_value: pdfVal,
        is_compared: !!fr,
        result: fr ? fr.result : 'skipped' as const,
      };
    });

    detailCompare.push({
      match_key: key,
      found_in_pdf: true,
      excel_row: rowA as PayrollRecord,
      pdf_row: rowB,
      field_results: fieldResults,
      side_by_side: sideBySide,
      row_result: rowResult,
      row_reason: rowResult === 'pass'
        ? ''
        : buildRowReason(
            rowA as PayrollRecord,
            failedFields.map(f => FIELD_COMMENT_LABEL[f] ?? `sai lệch ${f}`),
          ),
    });
  }

  // Detect extra rows in B not matched by any A key
  if (detailRule.include_unmatched_from_b) {
    for (const rowB of listB) {
      const rawKey = (rowB as Record<string, unknown>)?.[keyName];
      const key = rawKey == null ? '' : String(rawKey);
      if (!keysA.has(key)) {
        extraRows.push({
          match_key: key,
          pdf_row: rowB as PayrollRecord,
          reason: 'extra_in_pdf',
        });
      }
    }
  }

  const totalSourceARows = listA.length;
  const matchedRows = detailCompare.filter((x) => x.row_result === 'pass').length;
  const mismatchedRows = detailCompare.filter((x) => x.row_result === 'fail').length;

  const detailStatus =
    mismatchedRows > 0 || missingRows.length > 0 || extraRows.length > 0
      ? 'fail'
      : 'pass';

  return {
    section_code: sectionCode,
    match_key: keyName,
    detail_status: detailStatus,
    detail_compare: detailCompare,
    missing_rows: missingRows,
    extra_rows: extraRows,
    summary: {
      total_excel_rows: totalSourceARows,
      matched_rows: matchedRows,
      mismatched_rows: mismatchedRows,
      missing_in_pdf: missingRows.length,
      extra_in_pdf: extraRows.length,
    },
  };
}

// ─── All Detail Sections ──────────────────────────────────────────────────────

/**
 * Compare all detail sections and aggregate results.
 */
function compareAllDetailSections(
  sourceA: PayrollJSON,
  sourceB: PayrollJSON,
  detailRules: DetailRule[],
  options: CompareOptions,
): { detailResults: DetailSectionResult[]; detailStatus: 'pass' | 'fail' } {
  const results: DetailSectionResult[] = [];

  for (const detailRule of detailRules ?? []) {
    results.push(compareDetailSection(sourceA, sourceB, detailRule, options));
  }

  const detailStatus = results.some((x) => x.detail_status === 'fail') ? 'fail' : 'pass';

  return { detailResults: results, detailStatus };
}

// ─── Summary Builder ──────────────────────────────────────────────────────────

/**
 * Build final summary from header and detail results.
 * Aggregates counts across all detail sections.
 */
function buildSummary(
  headerResult: { headerStatus: 'pass' | 'fail'; headerCompare: HeaderFieldResult[] },
  allDetailResults: { detailResults: DetailSectionResult[]; detailStatus: 'pass' | 'fail' },
): CompareSummary {
  const detailResults = allDetailResults.detailResults;

  const totalSourceARows = detailResults.reduce(
    (sum, x) => sum + (x.summary?.total_excel_rows ?? 0),
    0,
  );
  const matchedRows = detailResults.reduce(
    (sum, x) => sum + (x.summary?.matched_rows ?? 0),
    0,
  );
  const mismatchedRows = detailResults.reduce(
    (sum, x) => sum + (x.summary?.mismatched_rows ?? 0),
    0,
  );
  const missingInSourceB = detailResults.reduce(
    (sum, x) => sum + (x.summary?.missing_in_pdf ?? 0),
    0,
  );
  const extraInSourceB = detailResults.reduce(
    (sum, x) => sum + (x.summary?.extra_in_pdf ?? 0),
    0,
  );

  // Tổng hợp: header fields + detail fields gộp lại
  const headerMatched = headerResult.headerCompare.filter(h => h.result === 'pass').length;
  const headerMismatched = headerResult.headerCompare.filter(h => h.result === 'fail').length;
  const totalComparePoints = headerResult.headerCompare.length + matchedRows + mismatchedRows;
  const totalMatched = headerMatched + matchedRows;
  const totalMismatched = headerMismatched + mismatchedRows;

  return {
    overall_status:
      headerResult.headerStatus === 'fail' || allDetailResults.detailStatus === 'fail'
        ? 'fail'
        : 'pass',
    // Tổng (header + detail gộp)
    total_compare_points: totalComparePoints,
    total_matched: totalMatched,
    total_mismatched: totalMismatched,
    // Header riêng
    header_status: headerResult.headerStatus,
    header_total: headerResult.headerCompare.length,
    header_matched: headerMatched,
    header_mismatched: headerMismatched,
    // Detail riêng
    detail_status: allDetailResults.detailStatus,
    total_excel_rows: totalSourceARows,
    matched_rows: matchedRows,
    mismatched_rows: mismatchedRows,
    missing_in_pdf: missingInSourceB,
    extra_in_pdf: extraInSourceB,
  };
}

// ─── Dynamic Compare Config Builder ───────────────────────────────────────────

/**
 * Which record fields a section's compare rule should cover.
 *
 * PREFERRED SOURCE: `mappedFields` from the Excel parser's BlockMeta — the list
 * of columns that section's OWN header actually resolved. This is the honest
 * answer to "does this table have this column?", and it adapts by itself when a
 * customer adds a column to one table next month.
 *
 * FALLBACK (no BlockMeta — e.g. a resumed run from before this was persisted):
 * infer from the records themselves. Weaker, because a column that exists but
 * happens to be blank in every row looks identical to a column that is absent.
 */
function recordFieldsForSection(
  records: PayrollRecord[],
  mappedFields: string[] | undefined,
): string[] {
  if (mappedFields && mappedFields.length > 0) {
    // ALL_RECORD_FIELDS drives the order; mappedFields decides membership.
    return ALL_RECORD_FIELDS.filter((f) => mappedFields.includes(f));
  }
  return ALL_RECORD_FIELDS.filter((f) =>
    records.some((r) => {
      const v = (r as unknown as Record<string, unknown>)[f];
      return v !== null && v !== undefined && v !== '';
    }),
  );
}

/** Turn a field-name list into detail compare rules. */
function toCompareFields(fields: string[]): DetailFieldRule[] {
  return fields
    // stt is the match key, not a compared value.
    .filter((f) => f !== 'stt')
    .map((f) => ({
      field_code: f,
      source_a_field: f,
      source_b_field: f,
      compare_mode: pickCompareModeV2(f),
    }));
}

/**
 * Per-section column info from the Excel parser, keyed by section. Optional so
 * existing callers (and resumed runs) keep working without it.
 */
export interface SectionColumns {
  /** `mappedFields` of the vpbank block(s). */
  trong_vpbank?: string[];
  /** `mappedFields` of the ngan_hang_khac block(s). */
  ngoai_vpbank?: string[];
}

/**
 * Build a dynamic CompareConfig from actual Excel data.
 * Full mode: compare ALL fields that have data (skip counters + skip null-only fields).
 *
 * This generates header_rules for TTC fields with data and detail compare_fields
 * for record fields with data — using pickCompareMode for automatic mode selection.
 *
 * `sectionColumns` scopes each section's compare fields to the columns THAT
 * table actually has. Without it, a column present in only one of the two tables
 * (e.g. `tinh_tp` on the non-VPBank list) would be compared against the other
 * table too, where Excel legitimately holds null — failing every row.
 */
export function buildDynamicCompareConfig(
  excelData: PayrollJSON,
  sectionColumns?: SectionColumns,
): CompareConfig {
  const ttc = (excelData.thong_tin_chung || {}) as unknown as Record<string, unknown>;
  const vpbankRecords = excelData.danh_sach_trong_vpbank || [];
  const nonVpbankRecords = excelData.danh_sach_ngoai_vpbank || [];

  // Header rules: ALL_TTC_FIELDS → skip counters + skip null-only → create HeaderRule
  const headerRules: HeaderRule[] = [];
  for (const field of ALL_TTC_FIELDS) {
    // Skip counter fields (code-injected, always = list length)
    if (COUNTER_TTC_FIELDS.has(field)) continue;
    // Skip fields with no data in Excel
    const val = ttc[field];
    if (val === null || val === undefined || val === '' || val === 0) continue;

    headerRules.push({
      field_code: field,
      source_a_path: `thong_tin_chung.${field}`,
      source_b_path: `thong_tin_chung.${field}`,
      compare_mode: pickCompareModeV2(field),
    });
  }

  // Detail rules: each section gets ONLY the columns that section's own table
  // has. Deriving one shared list from both tables would compare a column that
  // exists in just one of them against the other, where Excel holds null.
  const vpbankCompareFields = toCompareFields(
    recordFieldsForSection(vpbankRecords, sectionColumns?.trong_vpbank),
  );
  const nonVpbankCompareFields = toCompareFields(
    recordFieldsForSection(nonVpbankRecords, sectionColumns?.ngoai_vpbank),
  );

  return {
    header_rules: headerRules,
    detail_rules: [
      {
        section_code: 'trong_vpbank',
        source_a_list_path: 'danh_sach_trong_vpbank',
        source_b_list_path: 'danh_sach_trong_vpbank',
        match_key: 'stt',
        include_unmatched_from_b: true,
        compare_fields: vpbankCompareFields,
      },
      {
        section_code: 'ngoai_vpbank',
        source_a_list_path: 'danh_sach_ngoai_vpbank',
        source_b_list_path: 'danh_sach_ngoai_vpbank',
        match_key: 'stt',
        include_unmatched_from_b: true,
        compare_fields: nonVpbankCompareFields,
      },
    ],
    options: {
      trim_string: true,
      case_insensitive: true,
      remove_vietnamese_accents: true,
      collapse_whitespace: true,
      number_remove_commas: true,
      treat_null_as_empty: true,
      amount_tolerance: 0,
      amount_locale: 'vn',
    },
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Main entry point: compare two Payroll_JSON objects using the given config.
 * Produces a CompareResult with final verdict (APPROVED / REVIEW_REQUIRED).
 *
 * Handles invalid input (non-array list paths) by returning an error result
 * with code COMPARE_ERROR instead of throwing.
 */
export function comparePayrollData(
  sourceA: PayrollJSON,
  sourceB: PayrollJSON,
  config: CompareConfig,
): CompareResult {
  try {
    const options = config.options;

    const headerResult = compareHeader(sourceA, sourceB, config.header_rules, options);
    const allDetailResults = compareAllDetailSections(
      sourceA,
      sourceB,
      config.detail_rules,
      options,
    );
    const summary = buildSummary(
      { headerStatus: headerResult.headerStatus, headerCompare: headerResult.headerCompare },
      allDetailResults,
    );

    return {
      ok: true,
      compare_status: summary.overall_status,
      final_decision: summary.overall_status === 'pass' ? 'APPROVED' : 'REVIEW_REQUIRED',
      summary,
      header_compare: headerResult.headerCompare,
      detail_results: allDetailResults.detailResults,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected compare error';

    // Return an error result with empty but valid summary
    return {
      ok: false,
      compare_status: 'fail',
      final_decision: 'REVIEW_REQUIRED',
      summary: {
        overall_status: 'fail',
        total_compare_points: 0,
        total_matched: 0,
        total_mismatched: 0,
        header_status: 'fail',
        header_total: 0,
        header_matched: 0,
        header_mismatched: 0,
        detail_status: 'fail',
        total_excel_rows: 0,
        matched_rows: 0,
        mismatched_rows: 0,
        missing_in_pdf: 0,
        extra_in_pdf: 0,
      },
      header_compare: [],
      detail_results: [],
      error: { code: 'COMPARE_ERROR', message },
    };
  }
}
