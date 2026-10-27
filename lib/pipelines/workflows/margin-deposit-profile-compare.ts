// lib/pipelines/workflows/margin-deposit-profile-compare.ts
// Rule-based compare engine for the Margin Deposit Profile workflow.
// UC-04 (legacy): Compare 4 copies of TTKQ/BBTL field-by-field, deterministic.
// `validation` mode's copy-check now uses parseCopyDiffResult() below instead —
// an AI-based full-document diff that catches differences outside the fixed
// field list. compareCopies() is kept, unused by validation, for backward
// reference during the transition (margin-deposit-mode-contracts spec).

import {
  EXTRACT_FIELDS_BY_CODE,
  ARRAY_FIELDS_BY_CODE,
  ARRAY_MEMBER_FIELDS,
  type ExtractFieldResult,
  type ScalarField,
} from './prompts/margin-deposit-profile-prompts';
import { parseDeep } from '@/lib/pipelines/workflow-engine';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CopyMismatch {
  field: string;
  copy_a: string;
  copy_b: string;
  page_a: string;
  page_b: string;
}

export interface CopyCompareResult {
  doc_code: 'thoa_thuan_ky_quy' | 'thanh_ly_ky_quy';
  copies_found: number;
  copies_expected: 4;
  mismatches: CopyMismatch[];
  verdict: 'MATCH' | 'MISMATCH' | 'COMPARISON_SKIPPED';
  error_code?: 'INSUFFICIENT_COPIES' | 'PARTIAL_TEXT_COMPARISON';
  status: 'success' | 'error';
  error?: string;
}

// ─── Field Type Configuration ─────────────────────────────────────────────────

type NormalizerType = 'name' | 'id' | 'money' | 'date' | 'string';

const FIELD_NORMALIZERS: Record<string, NormalizerType> = {
  // Shared fields (TTKQ, BBTL, ĐKNV, TTCN)
  escrow_full_name: 'name',
  escrow_national_id: 'id',
  escrow_id_issue_date: 'date',
  unit_code: 'string',
  // TTKQ-specific
  total_escrow_amount: 'money',
  number_of_installments: 'string',
  installment_index: 'string',
  amount: 'money',
  // BBTL-specific
  refund_amount: 'money',
  beneficiary_account_number: 'string',
  beneficiary_account_name: 'name',
  beneficiary_bank: 'string',
  debit_account_number: 'string',
  payment_content: 'string',
  // CCCD
  full_name: 'name',
  cccd_id: 'id',
  date_of_birth: 'date',
  nationality: 'string',
  id_issue_date: 'date',
  id_place: 'string',
  id_expiry_date: 'date',
  // Hộ chiếu
  passport_number: 'id',
  passport_issue_date: 'date',
  passport_expiry_date: 'date',
  // TTCN
  transfer_full_name: 'name',
  transfer_national_id: 'id',
  transfer_id_issue_date: 'date',
  // Array member helper key
  code: 'string',
  // Đơn tra soát
  t24_transaction: 'string',
  reconciliation_content: 'string',
  national_id: 'id',
};

// ─── Normalize Functions (exported for testing) ───────────────────────────────

/**
 * Normalize Vietnamese name: UPPERCASE, trim, collapse whitespace.
 */
export function normalizeName(val: string | null): string {
  if (!val) return '';
  return val.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Normalize ID (CCCD/HC): strip all non-digit characters.
 */
export function normalizeId(val: string | null): string {
  if (!val) return '';
  return val.replace(/[^0-9]/g, '');
}

/**
 * Normalize money: parse Vietnamese/international formats → number.
 * Returns null if unparseable or N/A.
 */
export function normalizeMoney(val: string | null): number | null {
  if (!val) return null;
  const cleaned = val.trim();
  if (!cleaned || cleaned === 'N/A' || cleaned === 'null') return null;

  // Strip currency suffixes and whitespace
  let s = cleaned
    .replace(/\s*(VND|VNĐ|đ|dong|đồng)\s*/gi, '')
    .replace(/\s/g, '')
    .trim();

  if (!s) return null;

  // Detect format:
  // Vietnamese: 1.500.000.000 (dot as thousands sep)
  // International: 1,500,000,000 (comma as thousands sep)
  // Plain: 1500000000

  // If has dots but no comma → Vietnamese thousands separator
  if (s.includes('.') && !s.includes(',')) {
    // Check if it's a decimal (e.g. "1500.50") vs thousands (e.g. "1.500.000")
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      // Thousands separator → remove dots
      s = s.replace(/\./g, '');
    }
    // else: single dot with non-3-digit decimal → leave as-is (will parseFloat)
  }

  // If has commas → thousands separator (remove them)
  if (s.includes(',')) {
    // Could be "1,500,000" or "1.500,50" (European decimal)
    // For VND context, treat comma as thousands separator
    s = s.replace(/,/g, '');
  }

  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

/**
 * Normalize date: parse various formats → DD/MM/YYYY.
 */
export function normalizeDate(val: string | null): string {
  if (!val) return '';
  const trimmed = val.trim();
  if (!trimmed) return '';

  // Try DD/MM/YYYY or D/M/YY or D/M/YYYY
  const match = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!match) return trimmed; // Return as-is if can't parse

  let [, day, month, year] = match;
  if (year.length === 2) {
    year = `20${year}`;
  }
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
}

/**
 * Normalize generic string: trim, collapse whitespace, uppercase.
 */
export function normalizeString(val: string | null): string {
  if (!val) return '';
  return val.trim().replace(/\s+/g, ' ').toUpperCase();
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function getNormalizer(fieldName: string): NormalizerType {
  return FIELD_NORMALIZERS[fieldName] || 'string';
}

function normalizeValue(fieldName: string, value: string | null): string | number | null {
  const type = getNormalizer(fieldName);
  switch (type) {
    case 'name': return normalizeName(value);
    case 'id': return normalizeId(value);
    case 'money': return normalizeMoney(value);
    case 'date': return normalizeDate(value);
    case 'string': return normalizeString(value);
  }
}

function valuesEqual(fieldName: string, a: string | null, b: string | null): boolean {
  const normA = normalizeValue(fieldName, a);
  const normB = normalizeValue(fieldName, b);

  // Money comparison: both must be numbers and equal
  if (getNormalizer(fieldName) === 'money') {
    if (normA === null && normB === null) return true;
    if (normA === null || normB === null) return false;
    return normA === normB;
  }

  return normA === normB;
}

// ─── Main Compare Function ────────────────────────────────────────────────────

/**
 * UC-04: Compare N copies of TTKQ or BBTL field-by-field.
 * Uses copy[0] as reference and compares all others against it.
 */
/** Minimal copy shape for comparison: extracted fields + originating page range. */
export interface ComparableCopy {
  fields: ExtractFieldResult['fields'];
  page_range: string;
}

type FlatEntry = { fieldName: string; value: string };
type FlatCopy = Record<string, FlatEntry>;

function isValidScalar(raw: unknown): raw is ScalarField {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const field = raw as Record<string, unknown>;
  return typeof field.value === 'string'
    && typeof field.confidence === 'number'
    && Number.isFinite(field.confidence)
    && field.confidence >= 0
    && field.confidence <= 1;
}

/**
 * Flatten a copy's fields into path→value for comparison. Returns null if any
 * required value is missing/null/non-string (i.e. cannot compare fully).
 * Array fields expand into indexed paths, e.g. "escrow_parties[0].escrow_full_name".
 */
function flattenCopy(
  fields: ExtractFieldResult['fields'],
  requiredFields: string[],
  docCode: string,
): FlatCopy | null {
  const arrayFields = new Set(ARRAY_FIELDS_BY_CODE[docCode] ?? []);
  const flat: FlatCopy = {};

  for (const fieldName of requiredFields) {
    const raw = fields[fieldName];

    if (arrayFields.has(fieldName)) {
      if (!Array.isArray(raw)) return null;
      const memberKeys = ARRAY_MEMBER_FIELDS[fieldName] ?? [];
      for (let i = 0; i < raw.length; i++) {
        const member = raw[i];
        if (!member || typeof member !== 'object') return null;
        for (const key of memberKeys) {
          const scalar = (member as Record<string, unknown>)[key];
          if (!isValidScalar(scalar)) return null;
          flat[`${fieldName}[${i}].${key}`] = { fieldName: key, value: scalar.value as string };
        }
      }
      continue;
    }

    if (!isValidScalar(raw)) return null;
    flat[fieldName] = { fieldName, value: raw.value as string };
  }

  return flat;
}

export function compareCopies(
  copies: ComparableCopy[],
  docCode: 'thoa_thuan_ky_quy' | 'thanh_ly_ky_quy',
): CopyCompareResult {
  const copiesFound = copies.length;

  if (copiesFound < 2) {
    return {
      doc_code: docCode,
      copies_found: copiesFound,
      copies_expected: 4,
      mismatches: [],
      verdict: 'COMPARISON_SKIPPED',
      error_code: 'INSUFFICIENT_COPIES',
      status: 'success',
    };
  }

  // UC-04 is defined for exactly four copies. Never report a false MATCH for
  // an over-grouped batch; the caller must fix its business grouping instead.
  if (copiesFound > 4) {
    return {
      doc_code: docCode,
      copies_found: copiesFound,
      copies_expected: 4,
      mismatches: [],
      verdict: 'COMPARISON_SKIPPED',
      status: 'success',
      error: `Expected exactly 4 copies but found ${copiesFound}.`,
    };
  }

  const requiredFields = EXTRACT_FIELDS_BY_CODE[docCode] ?? [];
  if (requiredFields.length === 0) {
    return {
      doc_code: docCode,
      copies_found: copiesFound,
      copies_expected: 4,
      mismatches: [],
      verdict: 'COMPARISON_SKIPPED',
      error_code: 'PARTIAL_TEXT_COMPARISON',
      status: 'success',
    };
  }

  // Flatten each copy into { path -> {fieldName, value} } covering scalar fields
  // and array members (escrow_parties[i].x, installments[i].y). A value is
  // considered incomplete if missing, null, non-string, or with invalid confidence.
  const flattened = copies.map((copy) => flattenCopy(copy.fields, requiredFields, docCode));
  const hasIncompleteFields = flattened.some((flat) => flat === null);

  if (hasIncompleteFields) {
    return {
      doc_code: docCode,
      copies_found: copiesFound,
      copies_expected: 4,
      mismatches: [],
      verdict: 'COMPARISON_SKIPPED',
      error_code: 'PARTIAL_TEXT_COMPARISON',
      status: 'success',
    };
  }

  const reference = flattened[0]!;
  const mismatches: CopyMismatch[] = [];

  for (let i = 1; i < flattened.length; i++) {
    const other = flattened[i]!;
    const allPaths = new Set([...Object.keys(reference), ...Object.keys(other)]);
    for (const path of allPaths) {
      const refEntry = reference[path];
      const otherEntry = other[path];
      const fieldName = refEntry?.fieldName ?? otherEntry?.fieldName ?? path;
      const refValue = refEntry?.value ?? null;
      const otherValue = otherEntry?.value ?? null;

      if (!valuesEqual(fieldName, refValue, otherValue)) {
        mismatches.push({
          field: path,
          copy_a: refValue ?? '(missing)',
          copy_b: otherValue ?? '(missing)',
          page_a: copies[0].page_range || `copy_1`,
          page_b: copies[i].page_range || `copy_${i + 1}`,
        });
      }
    }
  }

  // Determine verdict
  let verdict: 'MATCH' | 'MISMATCH' | 'COMPARISON_SKIPPED';
  let errorCode: 'INSUFFICIENT_COPIES' | undefined;

  if (mismatches.length > 0) {
    verdict = 'MISMATCH';
  } else if (copiesFound < 4) {
    verdict = 'COMPARISON_SKIPPED';
    errorCode = 'INSUFFICIENT_COPIES';
  } else {
    verdict = 'MATCH';
  }

  return {
    doc_code: docCode,
    copies_found: copiesFound,
    copies_expected: 4,
    mismatches,
    verdict,
    error_code: errorCode,
    status: 'success',
  };
}

// ─── AI-based Copy-Diff (validation mode) ──────────────────────────────────────
// Used by `validation` mode's copy-check (margin-deposit-mode-contracts spec).
// Unlike compareCopies() above, this compares full documents via AI rather than
// pre-defined extracted fields, catching differences anywhere in the document.

export type CopyDiffSeverity = 'info' | 'warning' | 'critical';

export interface CopyDiffFinding {
  location: string;
  description: string;
  file_refs: string[];
  severity: CopyDiffSeverity;
}

export interface CopyCheckResult {
  doc_type: 'thoa_thuan_ky_quy' | 'thanh_ly_ky_quy';
  group_id: string;
  copies_found: number;
  file_ids: string[];
  differences: CopyDiffFinding[];
  verdict: 'MATCH' | 'MISMATCH' | 'COMPARISON_SKIPPED';
  error_code?: 'INSUFFICIENT_COPIES';
  status: 'success' | 'error';
  error?: string;
}

const COPY_DIFF_SEVERITIES = new Set<CopyDiffSeverity>(['info', 'warning', 'critical']);
const MAX_COPY_DIFF_FINDINGS = 500;

/**
 * Strict, Layer-2-equivalent parser for the AI-based copy-diff response.
 * Mirrors the strictness of parseFrameworkCompareResult(): rejects any
 * structural violation as INVALID_AI_RESPONSE rather than tolerating it.
 */
export function parseCopyDiffResult(value: unknown): CopyDiffFinding[] {
  const parsed = parseDeep(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('INVALID_AI_RESPONSE: copy-diff response must be an object.');
  }
  const object = parsed as Record<string, unknown>;
  if (!Array.isArray(object.differences) || object.differences.length > MAX_COPY_DIFF_FINDINGS) {
    throw new Error(`INVALID_AI_RESPONSE: copy-diff differences must be an array of at most ${MAX_COPY_DIFF_FINDINGS} items.`);
  }

  return object.differences.map((item, index): CopyDiffFinding => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`INVALID_AI_RESPONSE: copy-diff difference[${index}] must be an object.`);
    }
    const diff = item as Record<string, unknown>;
    if (
      typeof diff.location !== 'string' || !diff.location.trim()
      || typeof diff.description !== 'string' || !diff.description.trim()
      || typeof diff.severity !== 'string' || !COPY_DIFF_SEVERITIES.has(diff.severity as CopyDiffSeverity)
      || !Array.isArray(diff.file_refs) || diff.file_refs.length === 0
      || diff.file_refs.some((ref) => typeof ref !== 'string' || !ref.trim())
    ) {
      throw new Error(`INVALID_AI_RESPONSE: copy-diff difference[${index}] is malformed.`);
    }
    return {
      location: diff.location,
      description: diff.description,
      file_refs: diff.file_refs as string[],
      severity: diff.severity as CopyDiffSeverity,
    };
  });
}
