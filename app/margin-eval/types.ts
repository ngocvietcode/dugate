// app/margin-eval/types.ts
// Shared types for the Margin Deposit Eval UI — human-in-the-loop evaluation:
// upload files → run one of 4 modes → show each field → tick correct/wrong → score.

export type MarginMode = 'classify' | 'extraction' | 'framework' | 'validation';

export type FileRole = 'customer' | 'template';

/** Canonical 7-code taxonomy. */
export const DOC_TYPES = [
  'thoa_thuan_ky_quy',
  'thanh_ly_ky_quy',
  'dang_ky_nguyen_vong',
  'cccd',
  'ho_chieu',
  'thoa_thuan_chuyen_nhuong',
  'don_tra_soat',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** One uploaded file plus its per-file metadata (index-aligned with files[]). */
export interface EvalFile {
  id: string;
  file: File;
  name: string;
  size: number;
  /** Required for extraction/framework/validation. Ignored for classify. */
  doc_type?: DocType | '';
  /** framework/validation only. */
  role?: FileRole;
  /** validation only — required for customer TTKQ/BBTL. */
  group_id?: string;
  /** Object URL for the PDF preview (created lazily). */
  objectUrl?: string;
  /** PDF page count (fetched from /api/margin-eval/pageinfo). 0 = unknown. */
  pageCount?: number;
}

/** A single reviewable item (one field / one verdict), tickable correct/wrong. */
export type Judgement = 'unset' | 'correct' | 'wrong';

export interface ReviewItem {
  /** Stable key within a document, e.g. "unit_code" or "escrow_parties[0].escrow_full_name". */
  key: string;
  label: string;
  /** Raw AI value shown to the reviewer. */
  value: string;
  /** Optional confidence (0..1) if available. */
  confidence?: number | null;
  /** Optional bbox [ymin,xmin,ymax,xmax] normalized 0..1000 (presence only). */
  bbox?: [number, number, number, number] | null;
  /** Which uploaded file this item belongs to (for preview). */
  fileId?: string;
  /** 1-based page number within that file (presence only). */
  page?: number | null;
  judgement: Judgement;
}

/** A group of review items belonging to one output document / one comparison. */
export interface ReviewDocument {
  docId: string;
  title: string;
  subtitle?: string;
  fileId?: string;
  items: ReviewItem[];
}

export interface UsageStats {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  seconds: number;
}

export type RunStatus = 'idle' | 'submitting' | 'running' | 'done' | 'error';
