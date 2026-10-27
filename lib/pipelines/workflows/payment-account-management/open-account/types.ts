// lib/pipelines/workflows/payment-account-management/open-account/types.ts
// Domain types for the "open account" (mở tài khoản) feature.

// Classification types (DocClassification, LlmClassifyResponse) live in
// ../shared/classify-engine.ts; extraction types (DocExtraction, DocToExtract)
// live in ../shared/extract-engine.ts — both shared across modes.

/**
 * Fields extracted from the account-opening application form.
 * All nullable — the AI/parser fills what it can, downstream validation
 * decides which nulls are acceptable per business rule.
 */
export interface OpenAccountExtracted {
  // ── Khách hàng ────────────────────────────────────────────────────────
  ho_ten: string | null;
  ngay_sinh: string | null;          // dd/mm/yyyy
  gioi_tinh: 'nam' | 'nu' | 'khac' | null;
  cmnd_cccd: string | null;
  ngay_cap_cmnd: string | null;      // dd/mm/yyyy
  noi_cap_cmnd: string | null;
  quoc_tich: string | null;
  dia_chi_thuong_tru: string | null;
  dia_chi_lien_lac: string | null;
  so_dien_thoai: string | null;
  email: string | null;

  // ── Yêu cầu mở tài khoản ─────────────────────────────────────────────
  loai_tai_khoan: string | null;     // ví dụ "thanh toán VND", "thanh toán USD"
  loai_tien: string | null;          // VND / USD / ...
  chi_nhanh_mo: string | null;       // chi nhánh VPBank mở tài khoản
  ngay_de_nghi: string | null;       // dd/mm/yyyy
  muc_dich_su_dung: string | null;
  nguon_tien: string | null;         // nguồn tiền vào tài khoản

  // ── Xác thực ─────────────────────────────────────────────────────────
  co_chu_ky_khach_hang: boolean | null;
  co_dau_don_vi: boolean | null;
}

/**
 * Result payload returned to the client for a completed open-account run.
 * Uniform envelope: `extracted` = raw AI+parse output; `validation` = rules verdict.
 */
export interface OpenAccountResult {
  document_processed: number;
  extracted: OpenAccountExtracted;
  validation: OpenAccountValidation;
  /** Convenience summary — stringified into completeWorkflow's `contentPreview`. */
  summary: {
    final_decision: 'APPROVED' | 'REVIEW_REQUIRED' | 'REJECTED';
    total_checks: number;
    passed: number;
    failed: number;
  };
}

export interface OpenAccountValidation {
  overall: 'pass' | 'fail';
  checks: OpenAccountCheck[];
}

export interface OpenAccountCheck {
  code: string;
  description: string;
  result: 'pass' | 'fail';
  severity: 'error' | 'warning';
  reason?: string;
}
