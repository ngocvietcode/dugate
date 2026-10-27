// lib/pipelines/workflows/payment-account-management/update-account/types.ts
// Domain types for the "update account" (cập nhật tài khoản) feature.
// Classification/extraction types are shared (see ../shared/*-engine.ts); only
// validation + caller-supplied bank data types are mode-specific.
//
// Validation strategy (2026-07 pivot): rules are enforced by an LLM verifier,
// not by hand-written code. The MB03 extracted tree is decorated in place with
// per-field `validation` entries; the document envelope carries a summary +
// orphan_checks bucket for aggregate checks that don't attach to a single field.

// ─── Per-field validation entry ─────────────────────────────────────────────

/**
 * One validation entry attached to (or associated with) an MB03 extracted field.
 *
 * Same shape whether it lives inline on a leaf (`extracted.<path>.validation[]`)
 * or in the document-level `orphan_checks[]` bucket — a uniform shape keeps the
 * frontend renderer simple.
 *
 * `status`:
 *   - 'pass'  — bank value equals MB03 value (LLM's judgment, allowing lenient
 *               formatting differences).
 *   - 'fail'  — bank value differs from MB03 value in a way that matters.
 *   - 'skip'  — could not compare (gate not met, one side empty, or the LLM
 *               declined to judge).
 * `severity`: 'warning' by default. Reserved 'error' for future hard-fail
 *   rules; today no LLM-emitted check is 'error', so the doc-level `overall`
 *   stays 'pass'. Downstream reviewers decide.
 * `bank_value`: RAW value from the core-bank payload (before any normalization),
 *   so a reviewer sees exactly what the source system sent. `null` when the
 *   bank did not supply that field, or when the check has no natural bank
 *   counterpart.
 */
export interface ValidationEntry {
  code: string;
  status: 'pass' | 'fail' | 'skip';
  severity: 'error' | 'warning';
  bank_value: string | null;
  reason?: string;
}

// ─── Document-level validation summary ──────────────────────────────────────

/**
 * Envelope attached to each MB03 document alongside `extracted`. Per-field
 * results live inline on the extracted tree; this struct carries only the
 * roll-up counters + an optional error string when the LLM verify itself
 * failed (LLM call threw, returned non-JSON, etc). Field-level results are
 * discoverable by walking `extracted.*.validation[]` — see
 * ../shared/prompts/update-verify-prompt.ts for the LLM-side rule spec.
 */
export interface UpdateAccountValidation {
  overall: 'pass' | 'fail';
  summary: {
    pass: number;
    fail: number;
    skip: number;
  };
  /**
   * Set only when the LLM verify step could not run to completion (LLM call
   * threw, returned empty/non-JSON, or `extracted` was itself null). When set,
   * `summary` will be all zeros and no per-field validations were attached.
   */
  error?: string;
}

// ─── Bank data (metadata.data for mode=update) ──────────────────────────────

/**
 * A person record from the core banking system, used to reconcile against MB03
 * people-list entries. Match key = (full_name, id_no); check surface = position.
 * All fields optional so partially populated bank records don't reject the run —
 * the LLM decides per-field how to handle missing values.
 */
export interface BankPersonRef {
  /** Họ và tên — matching key */
  full_name?: string | null;
  /** Số GTTT (CCCD / hộ chiếu / ...) — matching key */
  id_no?: string | null;
  /** Chức vụ — the ONLY compared field */
  position?: string | null;
}

/**
 * Source-of-truth account data pulled from the core banking system. Delivered on
 * `metadata.data` for mode=update. Shape mirrors MB03's extracted keys 1:1 (see
 * ../shared/extract-schemas.ts for the MB03 side and
 * docs/IDP-PAYMENT-ACCOUNT-MANAGEMENT-API-GUIDE.md §8.3 for the public contract).
 *
 * Every field is optional — missing = "no comparison for that field this run",
 * never a hard failure.
 */
export interface UpdateAccountBankData {
  // ── Section 2 organization identity (current values on the bank side) ─────
  org_name_vi?: string | null;
  org_name_foreign?: string | null;
  org_short_name?: string | null;

  // ── Section 4 people lists (current people on the bank side) ─────────────
  legal_representatives?: BankPersonRef[];            // 4.I  Đại diện theo pháp luật
  authorized_representatives?: BankPersonRef[];       // 4.II ĐD hợp pháp — Ủy quyền
  authorized_account_users?: BankPersonRef[];         // 4.III Người UQ sử dụng TK
  chief_accountants?: BankPersonRef[];                // 4.IV Kế toán trưởng / PTKT
  authorized_by_chief_accountants?: BankPersonRef[];  // 4.V   Ủy quyền KTT / PTKT
}

/** Canonical list of the 5 people-list keys — used by the parser + prompt builder. */
export const BANK_PEOPLE_LIST_KEYS = [
  'legal_representatives',
  'authorized_representatives',
  'authorized_account_users',
  'chief_accountants',
  'authorized_by_chief_accountants',
] as const;

export type BankPeopleListKey = typeof BANK_PEOPLE_LIST_KEYS[number];
