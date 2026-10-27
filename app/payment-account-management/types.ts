// app/payment-account-management/types.ts
// UI types for the Payment Account Management (mở tài khoản) test page.
// See DESIGN.md for the design/control doc.

/** `open` and `update` are implemented in the runner; close/freeze are stubs. */
export type PamMode = 'open' | 'close' | 'freeze' | 'update';

/**
 * Stage of the open-account run.
 * - classification: chỉ phân loại (dừng sau khi có code + title).
 * - extraction:     phân loại + trích xuất trường.
 * - e2e:            phân loại + trích xuất + xác minh (validation).
 * (`verification` stage is intentionally excluded — it takes metadata.data, not files.)
 */
export type PamStage = 'classification' | 'extraction' | 'e2e';

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  icon: string;
}

/** Per-file lifecycle status shown on each DocumentCard. */
export type DocStatus =
  | 'pending'      // uploaded, not started
  | 'processing'   // run in flight, no per-file result yet
  | 'classified'   // has code + title (classification stage result)
  | 'done'         // final (extracted and/or validated)
  | 'error';       // this document failed / unsupported

/** One document's classification result (mirrors runner DocClassification). */
export interface CardClassification {
  code: string;
  title: string;
  confidence: number;
  reason: string;
}

/**
 * Document-level validation envelope for mode=update (mirrors the runner's
 * UpdateAccountValidation). Per-field results are NOT here — the runner attaches
 * them inside the extracted tree as `<leaf>.validation[]`; this is only the
 * roll-up. `error` is set when the LLM verify step could not run at all, in
 * which case `summary` is all zeros.
 *
 * Note: `overall` only flips to 'fail' on an error-severity failure, and every
 * entry the LLM emits today is 'warning' — so read `summary.fail` to decide
 * whether a reviewer needs to look, not `overall`.
 */
export interface CardValidation {
  overall: 'pass' | 'fail';
  summary: { pass: number; fail: number; skip: number };
  error?: string;
}

/**
 * One validation entry the runner attached to a leaf of the extracted tree
 * (`{ value, confidence, validation: ValidationEntry[] }`). Mirrors the runner's
 * ValidationEntry. `bank_value` is the RAW core-bank value, before the LLM's
 * normalization, so a reviewer sees exactly what the source system sent.
 */
export interface FieldValidationEntry {
  code: string;
  status: 'pass' | 'fail' | 'skip';
  severity: 'error' | 'warning';
  bank_value: string | null;
  reason?: string;
}

// ─── Bank data input (metadata.data for mode=update) ────────────────────────

/**
 * One person row on the bank side. `(full_name, id_no)` is the match key against
 * the MB03 people lists; `position` is the only value actually compared.
 */
export interface BankPerson {
  full_name: string;
  id_no: string;
  position: string;
}

/** The five MB03 people lists, in MB03 Section 4 order (4.I … 4.V). */
export const BANK_PEOPLE_LISTS = [
  { key: 'legal_representatives', label: 'Đại diện theo pháp luật', section: '4.I' },
  { key: 'authorized_representatives', label: 'ĐD hợp pháp — Ủy quyền', section: '4.II' },
  { key: 'authorized_account_users', label: 'Người UQ sử dụng TK', section: '4.III' },
  { key: 'chief_accountants', label: 'Kế toán trưởng / PTKT', section: '4.IV' },
  { key: 'authorized_by_chief_accountants', label: 'Ủy quyền KTT / PTKT', section: '4.V' },
] as const;

export type BankPeopleListKey = typeof BANK_PEOPLE_LISTS[number]['key'];

/**
 * Core-bank account data sent as `metadata.data` for mode=update. Mirrors the
 * runner's UpdateAccountBankData exactly — the backend parser accepts ONLY these
 * keys and silently ignores everything else, so the form is the safe way to
 * build one. Every field is optional: missing = "no comparison for that field".
 */
export interface BankData {
  org_name_vi?: string;
  org_name_foreign?: string;
  org_short_name?: string;
  legal_representatives?: BankPerson[];
  authorized_representatives?: BankPerson[];
  authorized_account_users?: BankPerson[];
  chief_accountants?: BankPerson[];
  authorized_by_chief_accountants?: BankPerson[];
}

/**
 * Provenance for a split segment: which parent scan file it came from and the
 * pages it occupies (1-based, may be non-contiguous, e.g. [1, 4]). Present only
 * when the document-splitting feature (enable_document_splitting) is active.
 */
export interface CardSource {
  file_id: string | null;
  name: string;
  pages: number[];
}

/**
 * Normalized per-document card. `usePamPolling` maps every stage's runner result
 * into this shape, keyed by file_id (the workflow's unique per-document key).
 */
export interface DocCard {
  /** file_id from the runner, or the local upload id before results arrive. */
  key: string;
  fileName: string;
  fileIcon: string;
  status: DocStatus;
  classification: CardClassification | null;
  /** Flat key→value field map from extraction; null if unsupported/failed. */
  extracted: Record<string, unknown> | null;
  validation: CardValidation | null;
  /** Short Vietnamese reason when this document was skipped/failed. */
  error?: string;
  /** Split-mode provenance to the parent scan file. Undefined for non-split docs. */
  source?: CardSource;
  /** Split-mode note when a file's page partition was auto-repaired after retries. */
  warning?: string;
}

/** Overall run status for the page. */
export type RunStatus = 'idle' | 'running' | 'complete' | 'error';
