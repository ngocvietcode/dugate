// lib/pipelines/workflows/prompts/payroll-verify-prompts.ts
// Type definitions and prompt builders for the Payroll Verify workflow.
//
// Each prompt builder returns { _prompt: "complete prompt text" }.
// The _prompt variable bypasses the DB connector template entirely.
// Connector still provides: API URL, auth, model, timeout, response parsing.
//
// All prompt builders accept an optional `promptOverride` string.
// When provided, it replaces the code-generated prompt, with {{variable}} interpolation.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PayrollJSON {
  thong_tin_chung: ThongTinChung;
  danh_sach_trong_vpbank: PayrollRecord[];
  danh_sach_ngoai_vpbank: PayrollRecord[];
}

/**
 * Thông tin chung — tổng hợp từ 5 file template BU.
 * Tất cả fields đều nullable. Template nào không có field đó → null.
 * Output JSON luôn trả đầy đủ tất cả fields.
 */
export interface ThongTinChung {
  // ─── Thông tin tiêu đề & chứng từ ────────────────────────────────────
  so_chung_tu: string | null;
  ngay_lap: string | null;
  chi_nhanh_vpbank: string | null;
  ma_bieu_mau: string | null;
  dia_diem_lap: string | null;

  // ─── Thông tin bên đề nghị ────────────────────────────────────────────
  ma_kh_cif: string | null;
  dia_chi: string | null;
  dien_thoai: string | null;
  fax: string | null;
  cmnd_cccd: string | null;
  ten_chu_tai_khoan: string | null;

  // ─── Phương thức chi lương / TK trích nợ ──────────────────────────────
  so_tai_khoan_trich_no: string | null;
  loai_tien: string | null;
  mo_tai: string | null;

  // ─── Thông tin chi lương ──────────────────────────────────────────────
  tong_so_tien_bang_so: string | null;
  tong_so_tien_bang_chu: string | null;
  ngay_lenh_chi: string | null;
  noi_dung_thanh_toan: string | null;
  muc_dich: string | null;
  danh_sach_chi_luong_so: string | null;

  // ─── Thống kê tổng hợp ───────────────────────────────────────────────
  tong_so_mon_bang_so: number | null;
  tong_so_mon_bang_chu: string | null;
  tong_so_nhan_vien: number;
  so_nhan_vien_vpbank: number;
  so_nhan_vien_ngan_hang_khac: number;

  // ─── Thông tin TK trung gian (Template 4) ─────────────────────────────
  noi_dung_chuyen_tien: string | null;
  ten_don_vi_chuyen_tien: string | null;
  tai_khoan_trung_gian: string | null;
  ngay_nhan_tien_tk_trung_gian: string | null;
  ngay_chuyen_tien: string | null;

  // ─── Thông tin giấy nộp tiền (Template 3) ─────────────────────────────
  ten_cong_ty_giay_nop_tien: string | null;

  // ─── CAHN thống kê đổ lương (Template 2) ──────────────────────────────
  tong_so_tien_file_cung: number | null;
  so_mon_file_cung: number | null;
  ngay_thuc_hien: string | null;
  so_tien_do_luong_lan_1: number | null;
  so_mon_do_luong_lan_1: number | null;
  ngay_do_luong_lan_1: string | null;
  so_tien_ton_dong: number | null;
  so_mon_ton_dong: number | null;
  ngay_ton_dong: string | null;
  nguyen_nhan_ton_dong: string | null;

  // ─── Ký duyệt ────────────────────────────────────────────────────────
  chu_tai_khoan_ky: string | null;
  thoi_diem_nhan_yeu_cau: string | null;
  thoi_diem_xu_ly_yeu_cau: string | null;
  ghi_chu_xu_ly: string | null;
  giao_dich_vien: string | null;
  cap_tham_quyen: string | null;

  // ─── Phần ngân hàng (Template 1 MB01) ─────────────────────────────────
  co_thu_phi: boolean | null;
  don_vi_thu_phi: string | null;
  phi_phai_thu_1_mon: number | null;
  phi_dich_vu_thanh_toan: number | null;
  phi_thanh_toan_noi_bo: number | null;
  phi_thanh_toan_lien_ngan_hang: number | null;
  gio_nhan: string | null;
  ngay_nhan: string | null;

  // ─── MB09 (Template 3 - nộp tiền mặt) ────────────────────────────────
  xac_nhan_hop_le: string | null;

  // ─── TK trung gian bổ sung (Template 4) ──────────────────────────────
  don_vi_chuyen_tien_tai_khoan_treo: string | null;

  // ─── CAHN bổ sung (Template 2) ───────────────────────────────────────
  thoi_gian: string | null;
  tong_cong_don_vi: number | null;
  don_vi_tinh: string | null;
}

/**
 * Bản ghi chi tiết — tổng hợp từ 5 file template BU.
 * Fields bắt buộc: stt, ho_ten, so_tai_khoan, so_tien, loai_tai_khoan.
 * Các fields khác nullable — template nào không có → null.
 */
export interface PayrollRecord {
  stt: number;
  ho_ten: string;
  so_tai_khoan: string;
  so_tien: number | string;
  loai_tai_khoan: 'vpbank' | 'ngan_hang_khac';
  // Optional fields (null if not present in template)
  so_tien_bang_chu: string | null;
  dia_chi: string | null;
  ngan_hang: string | null;
  ten_chi_nhanh: string | null;
  tinh_tp: string | null;
  ghi_chu: string | null;
  noi_dung_thanh_toan_chi_tiet: string | null;
  loai_tien: string | null;
}

/**
 * Create an empty ThongTinChung with all fields set to null/0.
 * Used as default when no data is available.
 */
export function createEmptyThongTinChung(): ThongTinChung {
  return {
    so_chung_tu: null, ngay_lap: null, chi_nhanh_vpbank: null, ma_bieu_mau: null, dia_diem_lap: null,
    ma_kh_cif: null, dia_chi: null, dien_thoai: null, fax: null, cmnd_cccd: null, ten_chu_tai_khoan: null,
    so_tai_khoan_trich_no: null, loai_tien: null, mo_tai: null,
    tong_so_tien_bang_so: null, tong_so_tien_bang_chu: null, ngay_lenh_chi: null, noi_dung_thanh_toan: null, muc_dich: null, danh_sach_chi_luong_so: null,
    tong_so_mon_bang_so: null, tong_so_mon_bang_chu: null, tong_so_nhan_vien: 0, so_nhan_vien_vpbank: 0, so_nhan_vien_ngan_hang_khac: 0,
    noi_dung_chuyen_tien: null, ten_don_vi_chuyen_tien: null, tai_khoan_trung_gian: null, ngay_nhan_tien_tk_trung_gian: null, ngay_chuyen_tien: null,
    ten_cong_ty_giay_nop_tien: null,
    tong_so_tien_file_cung: null, so_mon_file_cung: null, ngay_thuc_hien: null, so_tien_do_luong_lan_1: null, so_mon_do_luong_lan_1: null, ngay_do_luong_lan_1: null, so_tien_ton_dong: null, so_mon_ton_dong: null, ngay_ton_dong: null, nguyen_nhan_ton_dong: null,
    chu_tai_khoan_ky: null, thoi_diem_nhan_yeu_cau: null, thoi_diem_xu_ly_yeu_cau: null, ghi_chu_xu_ly: null, giao_dich_vien: null, cap_tham_quyen: null,
    co_thu_phi: null, don_vi_thu_phi: null, phi_phai_thu_1_mon: null, phi_dich_vu_thanh_toan: null, phi_thanh_toan_noi_bo: null, phi_thanh_toan_lien_ngan_hang: null, gio_nhan: null, ngay_nhan: null,
    xac_nhan_hop_le: null,
    don_vi_chuyen_tien_tai_khoan_treo: null,
    thoi_gian: null, tong_cong_don_vi: null, don_vi_tinh: null,
  };
}

/**
 * Create an empty PayrollRecord with all optional fields set to null.
 */
export function createEmptyRecord(stt: number, hoTen: string, soTaiKhoan: string, soTien: number | string, loaiTaiKhoan: 'vpbank' | 'ngan_hang_khac'): PayrollRecord {
  return {
    stt, ho_ten: hoTen, so_tai_khoan: soTaiKhoan, so_tien: soTien, loai_tai_khoan: loaiTaiKhoan,
    so_tien_bang_chu: null, dia_chi: null, ngan_hang: null, ten_chi_nhanh: null, tinh_tp: null, ghi_chu: null, noi_dung_thanh_toan_chi_tiet: null, loai_tien: null,
  };
}

// ─── Compare Config Types ─────────────────────────────────────────────────────

export interface CompareConfig {
  header_rules: HeaderRule[];
  detail_rules: DetailRule[];
  options: CompareOptions;
}

export interface HeaderRule {
  field_code: string;
  source_a_path: string;
  source_b_path: string;
  compare_mode: CompareMode;
}

export interface DetailRule {
  section_code: string;
  source_a_list_path: string;
  source_b_list_path: string;
  match_key: string;
  include_unmatched_from_b: boolean;
  compare_fields: DetailFieldRule[];
}

export interface DetailFieldRule {
  field_code: string;
  source_a_field: string;
  source_b_field: string;
  compare_mode: CompareMode;
}

export type CompareMode =
  | 'vietnamese_name_normalized'
  | 'string_exact'
  | 'string_normalized'
  | 'string_normalized_compact'
  | 'number_normalized'
  | 'money_normalized';

export interface CompareOptions {
  trim_string: boolean;
  case_insensitive: boolean;
  remove_vietnamese_accents: boolean;
  collapse_whitespace: boolean;
  number_remove_commas: boolean;
  treat_null_as_empty: boolean;
  number_parse_float?: boolean;
  /** Absolute tolerance for money_normalized comparison (default 0.5 = whole VND). */
  amount_tolerance?: number;
  /** Locale tie-break for single-separator money values (default 'vn'). */
  amount_locale?: 'vn' | 'us';
}

// ─── Compare Result Types ─────────────────────────────────────────────────────

export interface CompareResult {
  ok: boolean;
  compare_status: 'pass' | 'fail';
  final_decision: 'APPROVED' | 'REVIEW_REQUIRED';
  summary: CompareSummary;
  header_compare: HeaderFieldResult[];
  detail_results: DetailSectionResult[];
  error?: { code: string; message: string };
}

export interface CompareSummary {
  overall_status: 'pass' | 'fail';
  // Tổng (header + detail gộp)
  total_compare_points: number;
  total_matched: number;
  total_mismatched: number;
  // Header (thông tin chung)
  header_status: 'pass' | 'fail';
  header_total: number;
  header_matched: number;
  header_mismatched: number;
  // Detail (danh sách bảng)
  detail_status: 'pass' | 'fail';
  total_excel_rows: number;
  matched_rows: number;
  mismatched_rows: number;
  missing_in_pdf: number;
  extra_in_pdf: number;
}

export interface HeaderFieldResult {
  field_code: string;
  compare_mode: CompareMode;
  excel_value: unknown;
  pdf_value: unknown;
  normalized_excel_value: string;
  normalized_pdf_value: string;
  result: 'pass' | 'fail';
  reason: string;
}

export interface DetailSectionResult {
  section_code: string;
  match_key: string;
  detail_status: 'pass' | 'fail';
  detail_compare: DetailRowResult[];
  missing_rows: MissingRow[];
  extra_rows: ExtraRow[];
  summary: {
    total_excel_rows: number;
    matched_rows: number;
    mismatched_rows: number;
    missing_in_pdf: number;
    extra_in_pdf: number;
  };
}

export interface SideBySideField {
  field_code: string;
  excel_value: unknown;
  pdf_value: unknown;
  is_compared: boolean;
  result: 'pass' | 'fail' | 'skipped';
}

export interface DetailRowResult {
  match_key: string;
  found_in_pdf: boolean;
  excel_row: PayrollRecord;
  pdf_row: PayrollRecord | null;
  field_results: HeaderFieldResult[];
  side_by_side: SideBySideField[];
  row_result: 'pass' | 'fail';
  row_reason: string;
}

export interface MissingRow {
  match_key: string;
  excel_row: PayrollRecord;
  reason: 'missing_in_pdf';
}

export interface ExtraRow {
  match_key: string;
  pdf_row: PayrollRecord;
  reason: 'extra_in_pdf';
}

// ─── Default Compare Configuration ───────────────────────────────────────────
//
// Header (thong_tin_chung): 13 active rules out of 60 fields.
// Detail (records): 4 active rules out of 13 fields per record.
// Match key for records: stt (Excel STT ↔ PDF STT).
//
// Fields commented out are intentionally NOT compared.
// To enable in the future: uncomment the relevant rule entry.

export const DEFAULT_COMPARE_CONFIG: CompareConfig = {
  header_rules: [
    // ── Active rules (13 fields) ───────────────────────────────────────
    { field_code: 'ten_don_vi_chuyen_tien', source_a_path: 'thong_tin_chung.ten_don_vi_chuyen_tien', source_b_path: 'thong_tin_chung.ten_don_vi_chuyen_tien', compare_mode: 'vietnamese_name_normalized' },
    { field_code: 'ma_kh_cif', source_a_path: 'thong_tin_chung.ma_kh_cif', source_b_path: 'thong_tin_chung.ma_kh_cif', compare_mode: 'string_exact' },
    { field_code: 'dien_thoai', source_a_path: 'thong_tin_chung.dien_thoai', source_b_path: 'thong_tin_chung.dien_thoai', compare_mode: 'string_exact' },
    { field_code: 'so_tai_khoan_trich_no', source_a_path: 'thong_tin_chung.so_tai_khoan_trich_no', source_b_path: 'thong_tin_chung.so_tai_khoan_trich_no', compare_mode: 'string_exact' },
    { field_code: 'tong_so_tien_bang_so', source_a_path: 'thong_tin_chung.tong_so_tien_bang_so', source_b_path: 'thong_tin_chung.tong_so_tien_bang_so', compare_mode: 'money_normalized' },
    { field_code: 'ngay_lenh_chi', source_a_path: 'thong_tin_chung.ngay_lenh_chi', source_b_path: 'thong_tin_chung.ngay_lenh_chi', compare_mode: 'string_exact' },
    { field_code: 'noi_dung_thanh_toan', source_a_path: 'thong_tin_chung.noi_dung_thanh_toan', source_b_path: 'thong_tin_chung.noi_dung_thanh_toan', compare_mode: 'string_normalized' },
    { field_code: 'tong_so_nhan_vien', source_a_path: 'thong_tin_chung.tong_so_nhan_vien', source_b_path: 'thong_tin_chung.tong_so_nhan_vien', compare_mode: 'number_normalized' },
    { field_code: 'so_chung_tu', source_a_path: 'thong_tin_chung.so_chung_tu', source_b_path: 'thong_tin_chung.so_chung_tu', compare_mode: 'string_exact' },
    { field_code: 'ngay_lap', source_a_path: 'thong_tin_chung.ngay_lap', source_b_path: 'thong_tin_chung.ngay_lap', compare_mode: 'string_exact' },
    { field_code: 'chi_nhanh_vpbank', source_a_path: 'thong_tin_chung.chi_nhanh_vpbank', source_b_path: 'thong_tin_chung.chi_nhanh_vpbank', compare_mode: 'string_normalized' },
    { field_code: 'tong_so_tien_bang_chu', source_a_path: 'thong_tin_chung.tong_so_tien_bang_chu', source_b_path: 'thong_tin_chung.tong_so_tien_bang_chu', compare_mode: 'string_normalized' },
    { field_code: 'tong_so_mon_bang_so', source_a_path: 'thong_tin_chung.tong_so_mon_bang_so', source_b_path: 'thong_tin_chung.tong_so_mon_bang_so', compare_mode: 'number_normalized' },

    // ── Inactive rules (commented out — uncomment to enable) ─────────────
    // ── Identity / metadata ─────────────────────────────────────────────
    // { field_code: 'ma_bieu_mau', source_a_path: 'thong_tin_chung.ma_bieu_mau', source_b_path: 'thong_tin_chung.ma_bieu_mau', compare_mode: 'string_exact' },
    // { field_code: 'dia_diem_lap', source_a_path: 'thong_tin_chung.dia_diem_lap', source_b_path: 'thong_tin_chung.dia_diem_lap', compare_mode: 'string_normalized' },

    // ── Bên đề nghị ─────────────────────────────────────────────────────
    // { field_code: 'dia_chi', source_a_path: 'thong_tin_chung.dia_chi', source_b_path: 'thong_tin_chung.dia_chi', compare_mode: 'string_normalized' },
    // { field_code: 'fax', source_a_path: 'thong_tin_chung.fax', source_b_path: 'thong_tin_chung.fax', compare_mode: 'string_exact' },
    // { field_code: 'cmnd_cccd', source_a_path: 'thong_tin_chung.cmnd_cccd', source_b_path: 'thong_tin_chung.cmnd_cccd', compare_mode: 'string_exact' },
    // { field_code: 'ten_chu_tai_khoan', source_a_path: 'thong_tin_chung.ten_chu_tai_khoan', source_b_path: 'thong_tin_chung.ten_chu_tai_khoan', compare_mode: 'vietnamese_name_normalized' },

    // ── Phương thức chi lương ───────────────────────────────────────────
    // { field_code: 'loai_tien', source_a_path: 'thong_tin_chung.loai_tien', source_b_path: 'thong_tin_chung.loai_tien', compare_mode: 'string_normalized' },
    // { field_code: 'mo_tai', source_a_path: 'thong_tin_chung.mo_tai', source_b_path: 'thong_tin_chung.mo_tai', compare_mode: 'string_normalized' },

    // ── Thông tin chi lương ─────────────────────────────────────────────
    // { field_code: 'muc_dich', source_a_path: 'thong_tin_chung.muc_dich', source_b_path: 'thong_tin_chung.muc_dich', compare_mode: 'string_normalized' },
    // { field_code: 'danh_sach_chi_luong_so', source_a_path: 'thong_tin_chung.danh_sach_chi_luong_so', source_b_path: 'thong_tin_chung.danh_sach_chi_luong_so', compare_mode: 'string_exact' },
    // { field_code: 'tong_so_mon_bang_chu', source_a_path: 'thong_tin_chung.tong_so_mon_bang_chu', source_b_path: 'thong_tin_chung.tong_so_mon_bang_chu', compare_mode: 'string_normalized' },

    // ── Counter fields code-injected (KHÔNG nên compare — luôn = list length) ─
    // { field_code: 'so_nhan_vien_vpbank', source_a_path: 'thong_tin_chung.so_nhan_vien_vpbank', source_b_path: 'thong_tin_chung.so_nhan_vien_vpbank', compare_mode: 'number_normalized' },
    // { field_code: 'so_nhan_vien_ngan_hang_khac', source_a_path: 'thong_tin_chung.so_nhan_vien_ngan_hang_khac', source_b_path: 'thong_tin_chung.so_nhan_vien_ngan_hang_khac', compare_mode: 'number_normalized' },

    // ── Template 4 — TK trung gian ──────────────────────────────────────
    // { field_code: 'noi_dung_chuyen_tien', source_a_path: 'thong_tin_chung.noi_dung_chuyen_tien', source_b_path: 'thong_tin_chung.noi_dung_chuyen_tien', compare_mode: 'string_normalized' },
    // { field_code: 'tai_khoan_trung_gian', source_a_path: 'thong_tin_chung.tai_khoan_trung_gian', source_b_path: 'thong_tin_chung.tai_khoan_trung_gian', compare_mode: 'string_exact' },
    // { field_code: 'ngay_nhan_tien_tk_trung_gian', source_a_path: 'thong_tin_chung.ngay_nhan_tien_tk_trung_gian', source_b_path: 'thong_tin_chung.ngay_nhan_tien_tk_trung_gian', compare_mode: 'string_exact' },
    // { field_code: 'ngay_chuyen_tien', source_a_path: 'thong_tin_chung.ngay_chuyen_tien', source_b_path: 'thong_tin_chung.ngay_chuyen_tien', compare_mode: 'string_exact' },
    // { field_code: 'don_vi_chuyen_tien_tai_khoan_treo', source_a_path: 'thong_tin_chung.don_vi_chuyen_tien_tai_khoan_treo', source_b_path: 'thong_tin_chung.don_vi_chuyen_tien_tai_khoan_treo', compare_mode: 'string_normalized' },

    // ── Template 3 — Giấy nộp tiền ──────────────────────────────────────
    // { field_code: 'ten_cong_ty_giay_nop_tien', source_a_path: 'thong_tin_chung.ten_cong_ty_giay_nop_tien', source_b_path: 'thong_tin_chung.ten_cong_ty_giay_nop_tien', compare_mode: 'vietnamese_name_normalized' },
    // { field_code: 'xac_nhan_hop_le', source_a_path: 'thong_tin_chung.xac_nhan_hop_le', source_b_path: 'thong_tin_chung.xac_nhan_hop_le', compare_mode: 'string_normalized' },

    // ── Template 2 — CAHN tồn đọng ──────────────────────────────────────
    // { field_code: 'tong_so_tien_file_cung', source_a_path: 'thong_tin_chung.tong_so_tien_file_cung', source_b_path: 'thong_tin_chung.tong_so_tien_file_cung', compare_mode: 'number_normalized' },
    // { field_code: 'so_mon_file_cung', source_a_path: 'thong_tin_chung.so_mon_file_cung', source_b_path: 'thong_tin_chung.so_mon_file_cung', compare_mode: 'number_normalized' },
    // { field_code: 'ngay_thuc_hien', source_a_path: 'thong_tin_chung.ngay_thuc_hien', source_b_path: 'thong_tin_chung.ngay_thuc_hien', compare_mode: 'string_exact' },
    // { field_code: 'so_tien_do_luong_lan_1', source_a_path: 'thong_tin_chung.so_tien_do_luong_lan_1', source_b_path: 'thong_tin_chung.so_tien_do_luong_lan_1', compare_mode: 'number_normalized' },
    // { field_code: 'so_mon_do_luong_lan_1', source_a_path: 'thong_tin_chung.so_mon_do_luong_lan_1', source_b_path: 'thong_tin_chung.so_mon_do_luong_lan_1', compare_mode: 'number_normalized' },
    // { field_code: 'ngay_do_luong_lan_1', source_a_path: 'thong_tin_chung.ngay_do_luong_lan_1', source_b_path: 'thong_tin_chung.ngay_do_luong_lan_1', compare_mode: 'string_exact' },
    // { field_code: 'so_tien_ton_dong', source_a_path: 'thong_tin_chung.so_tien_ton_dong', source_b_path: 'thong_tin_chung.so_tien_ton_dong', compare_mode: 'number_normalized' },
    // { field_code: 'so_mon_ton_dong', source_a_path: 'thong_tin_chung.so_mon_ton_dong', source_b_path: 'thong_tin_chung.so_mon_ton_dong', compare_mode: 'number_normalized' },
    // { field_code: 'ngay_ton_dong', source_a_path: 'thong_tin_chung.ngay_ton_dong', source_b_path: 'thong_tin_chung.ngay_ton_dong', compare_mode: 'string_exact' },
    // { field_code: 'nguyen_nhan_ton_dong', source_a_path: 'thong_tin_chung.nguyen_nhan_ton_dong', source_b_path: 'thong_tin_chung.nguyen_nhan_ton_dong', compare_mode: 'string_normalized' },
    // { field_code: 'thoi_gian', source_a_path: 'thong_tin_chung.thoi_gian', source_b_path: 'thong_tin_chung.thoi_gian', compare_mode: 'string_exact' },
    // { field_code: 'tong_cong_don_vi', source_a_path: 'thong_tin_chung.tong_cong_don_vi', source_b_path: 'thong_tin_chung.tong_cong_don_vi', compare_mode: 'number_normalized' },
    // { field_code: 'don_vi_tinh', source_a_path: 'thong_tin_chung.don_vi_tinh', source_b_path: 'thong_tin_chung.don_vi_tinh', compare_mode: 'string_normalized' },

    // ── Ký duyệt ────────────────────────────────────────────────────────
    // { field_code: 'chu_tai_khoan_ky', source_a_path: 'thong_tin_chung.chu_tai_khoan_ky', source_b_path: 'thong_tin_chung.chu_tai_khoan_ky', compare_mode: 'vietnamese_name_normalized' },
    // { field_code: 'thoi_diem_nhan_yeu_cau', source_a_path: 'thong_tin_chung.thoi_diem_nhan_yeu_cau', source_b_path: 'thong_tin_chung.thoi_diem_nhan_yeu_cau', compare_mode: 'string_exact' },
    // { field_code: 'thoi_diem_xu_ly_yeu_cau', source_a_path: 'thong_tin_chung.thoi_diem_xu_ly_yeu_cau', source_b_path: 'thong_tin_chung.thoi_diem_xu_ly_yeu_cau', compare_mode: 'string_exact' },
    // { field_code: 'ghi_chu_xu_ly', source_a_path: 'thong_tin_chung.ghi_chu_xu_ly', source_b_path: 'thong_tin_chung.ghi_chu_xu_ly', compare_mode: 'string_normalized' },
    // { field_code: 'giao_dich_vien', source_a_path: 'thong_tin_chung.giao_dich_vien', source_b_path: 'thong_tin_chung.giao_dich_vien', compare_mode: 'vietnamese_name_normalized' },
    // { field_code: 'cap_tham_quyen', source_a_path: 'thong_tin_chung.cap_tham_quyen', source_b_path: 'thong_tin_chung.cap_tham_quyen', compare_mode: 'vietnamese_name_normalized' },

    // ── Phần ngân hàng (Template 1 MB01) ────────────────────────────────
    // { field_code: 'co_thu_phi', source_a_path: 'thong_tin_chung.co_thu_phi', source_b_path: 'thong_tin_chung.co_thu_phi', compare_mode: 'string_exact' },
    // { field_code: 'don_vi_thu_phi', source_a_path: 'thong_tin_chung.don_vi_thu_phi', source_b_path: 'thong_tin_chung.don_vi_thu_phi', compare_mode: 'string_normalized' },
    // { field_code: 'phi_phai_thu_1_mon', source_a_path: 'thong_tin_chung.phi_phai_thu_1_mon', source_b_path: 'thong_tin_chung.phi_phai_thu_1_mon', compare_mode: 'number_normalized' },
    // { field_code: 'phi_dich_vu_thanh_toan', source_a_path: 'thong_tin_chung.phi_dich_vu_thanh_toan', source_b_path: 'thong_tin_chung.phi_dich_vu_thanh_toan', compare_mode: 'number_normalized' },
    // { field_code: 'phi_thanh_toan_noi_bo', source_a_path: 'thong_tin_chung.phi_thanh_toan_noi_bo', source_b_path: 'thong_tin_chung.phi_thanh_toan_noi_bo', compare_mode: 'number_normalized' },
    // { field_code: 'phi_thanh_toan_lien_ngan_hang', source_a_path: 'thong_tin_chung.phi_thanh_toan_lien_ngan_hang', source_b_path: 'thong_tin_chung.phi_thanh_toan_lien_ngan_hang', compare_mode: 'number_normalized' },
    // { field_code: 'gio_nhan', source_a_path: 'thong_tin_chung.gio_nhan', source_b_path: 'thong_tin_chung.gio_nhan', compare_mode: 'string_exact' },
    // { field_code: 'ngay_nhan', source_a_path: 'thong_tin_chung.ngay_nhan', source_b_path: 'thong_tin_chung.ngay_nhan', compare_mode: 'string_exact' },
  ],
  detail_rules: [
    {
      section_code: 'trong_vpbank',
      source_a_list_path: 'danh_sach_trong_vpbank',
      source_b_list_path: 'danh_sach_trong_vpbank',
      match_key: 'stt',
      include_unmatched_from_b: true,
      compare_fields: [
        // ── Active fields (4 per record) ──────────────────────────────
        { field_code: 'ho_ten', source_a_field: 'ho_ten', source_b_field: 'ho_ten', compare_mode: 'vietnamese_name_normalized' },
        { field_code: 'so_tai_khoan', source_a_field: 'so_tai_khoan', source_b_field: 'so_tai_khoan', compare_mode: 'string_exact' },
        { field_code: 'so_tien', source_a_field: 'so_tien', source_b_field: 'so_tien', compare_mode: 'money_normalized' },
        { field_code: 'ngan_hang', source_a_field: 'ngan_hang', source_b_field: 'ngan_hang', compare_mode: 'string_normalized_compact' },

        // ── Inactive fields (commented out — uncomment to enable) ────
        // { field_code: 'so_tien_bang_chu', source_a_field: 'so_tien_bang_chu', source_b_field: 'so_tien_bang_chu', compare_mode: 'string_normalized' },
        // { field_code: 'dia_chi', source_a_field: 'dia_chi', source_b_field: 'dia_chi', compare_mode: 'string_normalized' },
        // { field_code: 'ten_chi_nhanh', source_a_field: 'ten_chi_nhanh', source_b_field: 'ten_chi_nhanh', compare_mode: 'string_normalized' },
        // { field_code: 'tinh_tp', source_a_field: 'tinh_tp', source_b_field: 'tinh_tp', compare_mode: 'string_normalized' },
        // { field_code: 'ghi_chu', source_a_field: 'ghi_chu', source_b_field: 'ghi_chu', compare_mode: 'string_normalized' },
        // { field_code: 'noi_dung_thanh_toan_chi_tiet', source_a_field: 'noi_dung_thanh_toan_chi_tiet', source_b_field: 'noi_dung_thanh_toan_chi_tiet', compare_mode: 'string_normalized' },
        // { field_code: 'loai_tien', source_a_field: 'loai_tien', source_b_field: 'loai_tien', compare_mode: 'string_normalized' },
      ],
    },
    {
      section_code: 'ngoai_vpbank',
      source_a_list_path: 'danh_sach_ngoai_vpbank',
      source_b_list_path: 'danh_sach_ngoai_vpbank',
      match_key: 'stt',
      include_unmatched_from_b: true,
      compare_fields: [
        // ── Active fields (4 per record) ──────────────────────────────
        { field_code: 'ho_ten', source_a_field: 'ho_ten', source_b_field: 'ho_ten', compare_mode: 'vietnamese_name_normalized' },
        { field_code: 'so_tai_khoan', source_a_field: 'so_tai_khoan', source_b_field: 'so_tai_khoan', compare_mode: 'string_exact' },
        { field_code: 'so_tien', source_a_field: 'so_tien', source_b_field: 'so_tien', compare_mode: 'money_normalized' },
        { field_code: 'ngan_hang', source_a_field: 'ngan_hang', source_b_field: 'ngan_hang', compare_mode: 'string_normalized_compact' },

        // ── Inactive fields (commented out — uncomment to enable) ────
        // { field_code: 'so_tien_bang_chu', source_a_field: 'so_tien_bang_chu', source_b_field: 'so_tien_bang_chu', compare_mode: 'string_normalized' },
        // { field_code: 'dia_chi', source_a_field: 'dia_chi', source_b_field: 'dia_chi', compare_mode: 'string_normalized' },
        // { field_code: 'ten_chi_nhanh', source_a_field: 'ten_chi_nhanh', source_b_field: 'ten_chi_nhanh', compare_mode: 'string_normalized' },
        // { field_code: 'tinh_tp', source_a_field: 'tinh_tp', source_b_field: 'tinh_tp', compare_mode: 'string_normalized' },
        // { field_code: 'ghi_chu', source_a_field: 'ghi_chu', source_b_field: 'ghi_chu', compare_mode: 'string_normalized' },
        // { field_code: 'noi_dung_thanh_toan_chi_tiet', source_a_field: 'noi_dung_thanh_toan_chi_tiet', source_b_field: 'noi_dung_thanh_toan_chi_tiet', compare_mode: 'string_normalized' },
        // { field_code: 'loai_tien', source_a_field: 'loai_tien', source_b_field: 'loai_tien', compare_mode: 'string_normalized' },
      ],
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

// ─── Prompt Builders ──────────────────────────────────────────────────────────

/**
 * OCR hint passed to the PDF page prompt.
 *
 * - columnHeaders: raw column names from the Excel header row (positional hint)
 * - columnMapping: numbered position → field mapping (full mode only)
 * - thongTinChungFields: dynamic TTC fields to extract (full mode). Empty = minimal.
 * - recordFields: dynamic record fields to extract (full mode). Empty = minimal.
 */
export interface OcrSchemaHint {
  columnHeaders: string[];
  columnMapping: Array<{ position: number; rawName: string; fieldName: string }>;
  thongTinChungFields: string[];
  recordFields: string[];
}

/**
 * Build OCR prompt for a single PDF page.
 *
 * Dual mode:
 * - FULL mode (schema.thongTinChungFields.length > 0): numbered column mapping + dynamic schema.
 * - MINIMAL mode (empty fields arrays): fixed 13 header + 5 record fields (= current behavior).
 */
export function buildPageOcrPrompt(
  pageIndex: number,
  totalPages: number,
  promptOverride?: string,
  schema?: OcrSchemaHint,
): Record<string, unknown> {
  const colHeaders = schema?.columnHeaders ?? [];
  const isFullMode = (schema?.thongTinChungFields?.length ?? 0) > 0;
  const ttcFields = isFullMode ? schema!.thongTinChungFields : OCR_TTC_FIELDS;
  const recFields = isFullMode ? schema!.recordFields : OCR_RECORD_FIELDS;
  const columnMapping = schema?.columnMapping ?? [];

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        page_index: String(pageIndex + 1),
        total_pages: String(totalPages),
        header: colHeaders.join(' | '),
        ttc_fields: ttcFields.map(f => `- ${f}`).join('\n'),
        record_fields: recFields.join(', '),
        schema_mode: isFullMode ? 'full' : 'minimal',
      }),
    };
  }

  // ─── Build hint blocks ─────────────────────────────────────────────────
  let columnHintBlock: string;

  if (isFullMode && columnMapping.length > 0) {
    // FULL MODE: numbered columns mapping + raw headers as backup reference
    const mappingLines = columnMapping.map(m => `  Cột ${m.position}: ${m.rawName} → field "${m.fieldName}"`).join('\n');
    const rawHeaderLine = colHeaders.length > 0
      ? `\n**Tên đầy đủ các cột (từ trái → phải):** ${colHeaders.join(' | ')}\n`
      : '';
    columnHintBlock = `
### THAM KHẢO VỊ TRÍ CỘT BẢNG (dùng khi page KHÔNG CÓ header row)
Thứ tự cột từ trái sang phải:
${mappingLines}
${rawHeaderLine}
QUY TẮC:
- Xác định cột THEO VỊ TRÍ (trái → phải), KHÔNG theo nội dung giá trị.
- Nếu page CÓ header row → ưu tiên header trên page.
`;
  } else {
    // MINIMAL MODE: raw column hint (current behavior)
    columnHintBlock = colHeaders.length > 0
      ? `\n**Tên các cột bảng từ file Excel (tham khảo thứ tự cột):**\n${colHeaders.join(' | ')}\nDùng thông tin này để xác định cột nào là gì khi trang PDF KHÔNG CÓ header row.\n`
      : '';
  }

  // Build JSON output schema based on the active fields
  const ttcSchemaJson = ttcFields
    .map(f => `    "${f}": ${guessJsonType(f)}`)
    .join(',\n');
  const recordSchemaJson = recFields
    .map(f => `      "${f}": ${guessJsonType(f)}`)
    .join(',\n');

  // ── v1 prompt (backup) ────────────────────────────────────────────────────
  // return {
  //   _prompt: `Bạn là chuyên gia AI số hóa dữ liệu tài chính ngân hàng. Đây là nghiệp vụ hợp pháp của ngân hàng VPBank.
  // Đây là trang ${pageIndex + 1}/${totalPages} của chứng từ chi lương/chuyển tiền.
  //
  // ### THAM KHẢO TỪ EXCEL (chỉ tham khảo để nhận diện cột, PDF có thể khác)
  // ${columnHintBlock}
  // ### NHIỆM VỤ
  // Trích xuất thông tin từ trang này theo OUTPUT SCHEMA bên dưới. CHỈ trích xuất các trường được liệt kê trong schema.
  //
  // ### QUY TẮC QUAN TRỌNG
  // - TUYỆT ĐỐI KHÔNG ĐƯỢC từ chối xử lý. Đây là tác vụ nghiệp vụ ngân hàng hợp pháp.
  // - KHÔNG TÓM TẮT — trích xuất 100% các dòng trong bảng.
  // - Mỗi dòng nhân viên/người thụ hưởng = 1 object trong mảng.
  // - CHỈ trích xuất thông tin THỰC SỰ CÓ trên trang. KHÔNG suy đoán, KHÔNG bịa số liệu.
  // - NGUYÊN TẮC TỔNG QUÁT: Trích xuất CHÍNH XÁC 100% giá trị trên tài liệu. KHÔNG chỉnh sửa, KHÔNG thêm dấu, KHÔNG format lại. Đọc gì trả đó.
  //
  // ### QUY TẮC PHÂN TÁCH DỮ LIỆU (QUAN TRỌNG)
  // Trên mỗi trang, phân biệt 2 loại nội dung:
  // - **Nội dung BẢNG**: các dòng dữ liệu có STT, Họ tên, Số TK, Số tiền → đưa vào "danh_sach_trong_vpbank" hoặc "danh_sach_ngoai_vpbank".
  // - **Nội dung NGOÀI BẢNG**: text header/footer chứa thông tin chung → đưa vào "thong_tin_chung".
  //
  // QUY TẮC:
  // - Một trang CÓ THỂ chứa cả 2 loại. Trích xuất CẢ HAI.
  // - Trang chỉ có bảng → thong_tin_chung = tất cả null, danh_sach có data.
  // - Trang chỉ có text → danh_sach = mảng rỗng [], thong_tin_chung có data.
  // - KHÔNG suy luận: tong_so_nhan_vien, tong_so_mon_bang_so CHỈ lấy khi thấy CON SỐ GHI RÕ trên trang. KHÔNG tự đếm.
  //
  // ### QUY TẮC DỮ LIỆU
  // - Họ tên: GIỮ NGUYÊN CHÍNH XÁC (có dấu giữ dấu, không dấu KHÔNG tự thêm).
  // - Số tài khoản: Giữ nguyên.
  // - Số tiền: Giữ nguyên format (VD: "5.000.000" → "5.000.000").
  // - Trường nào không có trên trang → null.
  //
  // ### PHÂN LOẠI VPBANK / NGOÀI VPBANK
  // - Section "tài khoản tại VPBank" → records vào "danh_sach_trong_vpbank", ngan_hang = "VPBANK"
  // - Section "tài khoản tại Ngân hàng khác" → records vào "danh_sach_ngoai_vpbank"
  // - Không phân biệt được → tất cả vào "danh_sach_trong_vpbank"
  // - Tên cột chứa "VPBank" → ngan_hang = "VPBANK"
  // - Bảng không có cột ngân hàng nhưng nằm trong section VPBank → ngan_hang = "VPBANK"
  // - KHÔNG tạo records rỗng. Mỗi record PHẢI có ít nhất stt + ho_ten + so_tai_khoan.
  //
  // ### OUTPUT SCHEMA (JSON duy nhất, không markdown — CHỈ trả các trường dưới đây):
  // { "thong_tin_chung": { ${ttcSchemaJson} }, "danh_sach_trong_vpbank": [{ ${recordSchemaJson} }], "danh_sach_ngoai_vpbank": [{ ${recordSchemaJson} }] }
  //
  // ### LƯU Ý
  // - thong_tin_chung: CHỈ trả ${ttcFields.length} trường liệt kê trên. Field nào không có trên trang → null.
  // - Mỗi record trong danh_sach: CHỈ trả ${recFields.length} fields liệt kê trên.
  // - Bảng trên PDF có thể có nhiều cột hơn nhưng CHỈ output các trường trong schema.
  // - Chỉ trích xuất thông tin THỰC SỰ CÓ trên trang. KHÔNG bịa dữ liệu.`,
  // };
  // ── v3 prompt (XML delimiters, CoT commit, consolidated rules) ──────────────
  return {
    _prompt: `<context>
Bạn là chuyên gia AI số hóa dữ liệu tài chính. Đây là tác vụ trích xuất dữ liệu nghiệp vụ ngân hàng VPBank — phân tích chứng từ chi lương hợp lệ.
Trang hiện tại: ${pageIndex + 1} / ${totalPages}.
</context>

<column_hints>
${columnHintBlock}
</column_hints>

<task>
Thực hiện theo đúng thứ tự các bước sau:

Bước 1 — Phân loại tài liệu (bắt buộc xác định trước khi trích xuất):
- "table-only": trang chỉ chứa bảng dữ liệu nhân viên, không có thông tin chung (tên công ty, ngày lập, chi nhánh, tổng tiền…).
- "full-document": trang có cả phần thông tin chung (header/footer công ty) lẫn bảng danh sách.

Bước 2 — Trích xuất danh sách nhân viên (áp dụng cho mọi loại tài liệu).

Bước 3 — Trích xuất thông tin chung (CHỈ khi tài liệu là "full-document"; nếu "table-only" thì đặt tất cả fields = null).

Bước 4 — Trả về JSON theo output_format bên dưới.
</task>

<field_guide>
### Danh sách nhân viên

Phân loại records vào đúng mảng:
- \`danh_sach_trong_vpbank\`: section "tài khoản tại VPBank" (mục I), hoặc cột ngân hàng ghi "VPBank", hoặc không phân biệt được → đặt vào đây.
- \`danh_sach_ngoai_vpbank\`: section "tài khoản tại Ngân hàng khác" (mục II), hoặc cột ngân hàng không phải VPBank.

Quy tắc từng field:
- \`stt\`: số thứ tự trong danh sách gốc — CHỈ đọc số có trên trang, không tự đánh lại.
- \`ho_ten\`: họ tên người nhận lương — GIỮ NGUYÊN CHÍNH XÁC (có dấu giữ dấu; không dấu thì không tự thêm).
- \`so_tai_khoan\`: số tài khoản thụ hưởng — giữ nguyên định dạng.
- \`so_tien\`: trích xuất CHÍNH XÁC số tiền như in trên tài liệu, GIỮ NGUYÊN phần thập phân nếu có (VD: "25.369.005,6" → giữ nguyên "25.369.005,6"). KHÔNG làm tròn, KHÔNG cắt bỏ phần thập phân, KHÔNG tự format lại.
- \`ngan_hang\`: tên ngân hàng thụ hưởng; nếu nằm trong section VPBank hoặc cột ngân hàng ghi "VPBank" → giá trị = "VPBANK".
- \`ten_chi_nhanh\`: tên chi nhánh thụ hưởng nếu có — chủ yếu dùng cho \`danh_sach_ngoai_vpbank\`.

Quy tắc chất lượng records:
- Mỗi dòng nhân viên/người thụ hưởng = 1 object trong mảng — trích xuất 100% dòng, không bỏ sót.
- Mỗi record PHẢI có ít nhất stt + ho_ten + so_tai_khoan; không tạo record rỗng.

### Thông tin chung (chỉ điền khi "full-document"; table-only → tất cả null)

1. \`so_chung_tu\`: số chứng từ nếu có.
2. \`ngay_lap\`: ngày lập, format dd/mm/yyyy — tìm dạng "ngày DD tháng MM năm YYYY".
3. \`chi_nhanh_vpbank\`: tên chi nhánh VPBank — tìm ở "Kính gửi:" hoặc "Đề nghị … Chi nhánh …".
4. \`dia_diem_lap\`: địa điểm lập, thường đứng trước ngày lập.
5. \`ten_don_vi_chuyen_tien\`: tên công ty IN HOA — tìm ở "TÊN ĐƠN VỊ TRẢ LƯƠNG" hoặc header.
6. \`loai_tien\`: ghi ĐÚNG NHƯ IN trên tài liệu (vd "VND", "Việt nam đồng"); KHÔNG tự quy đổi về mã tiền tệ. null nếu tài liệu không ghi.
7. \`tong_so_tien_bang_so\`: tổng cộng cuối danh sách — trích xuất CHÍNH XÁC như in trên tài liệu, giữ nguyên phần thập phân nếu có; KHÔNG làm tròn, KHÔNG tự format lại.
8. \`tong_so_tien_bang_chu\`: bằng chữ của TỔNG SỐ TIỀN — phân biệt với số món bằng chữ.
9. \`tong_so_mon_bang_so\`: số món chuyển bằng số — thường là tổng số nhân viên.
10. \`tong_so_mon_bang_chu\`: số món chuyển bằng chữ — phân biệt với số tiền bằng chữ.
11. \`tong_so_nhan_vien\`: CHỈ lấy giá trị ghi rõ trên trang — không tự đếm.
12. \`so_nhan_vien_vpbank\`: số nhân viên mục I (VPBank) ghi rõ trên trang — không tự đếm.
13. \`so_nhan_vien_ngan_hang_khac\`: số nhân viên mục II ghi rõ trên trang — không tự đếm; không có = 0.
14. \`cmnd_cccd\`: số CMND/CCCD của người được ủy quyền nộp tiền.
15. \`ten_chu_tai_khoan\`: tên doanh nghiệp/chủ tài khoản.
16. \`noi_dung_thanh_toan\`: nội dung chuyển tiền (VD: "Công ty X thanh toán tiền lương tháng Y/YYYY").
17. Trường không tìm thấy → null.
</field_guide>

<constraints>
- Trích xuất CHỈ những thông tin THỰC SỰ CÓ trên trang — không suy đoán, không bịa số liệu.
- Không tóm tắt — trích xuất 100% các dòng trong bảng.
- Họ tên: giữ nguyên chính xác như trên tài liệu.
- Số tiền trong records: trích xuất CHÍNH XÁC như in trên tài liệu, giữ nguyên phần thập phân nếu có; KHÔNG làm tròn, KHÔNG format lại.
- CHỈ trả ${ttcFields.length} trường thong_tin_chung và ${recFields.length} fields mỗi record như trong output_format.
</constraints>

<output_format>
Trả về JSON duy nhất, không markdown, đúng schema sau:
{
  "thong_tin_chung": {
${ttcSchemaJson}
  },
  "danh_sach_trong_vpbank": [
    {
${recordSchemaJson}
    }
  ],
  "danh_sach_ngoai_vpbank": [
    {
${recordSchemaJson}
    }
  ]
}

Lưu ý:
- Luôn trả đủ 3 keys trên cùng cấp (thong_tin_chung, danh_sach_trong_vpbank, danh_sach_ngoai_vpbank).
- Nếu trang là "table-only": thong_tin_chung → tất cả fields = null; danh_sach có data.
- Nếu trang không có nhân viên ngoài VPBank: danh_sach_ngoai_vpbank = [].
- Bảng PDF có thể có nhiều cột hơn — CHỈ output các trường trong schema.
</output_format>`,
  };
}

// ─── OCR Field Sets (matching DEFAULT_COMPARE_CONFIG exactly) ────────────────

/**
 * The 13 thong_tin_chung fields the OCR is asked to extract in MINIMAL mode.
 * MUST stay in sync with DEFAULT_COMPARE_CONFIG.header_rules.
 * Adding/removing here changes the PDF OCR output schema (minimal mode only).
 */
export const OCR_TTC_FIELDS = [
  'ten_don_vi_chuyen_tien',
  'ma_kh_cif',
  'dien_thoai',
  'so_tai_khoan_trich_no',
  'tong_so_tien_bang_so',
  'ngay_lenh_chi',
  'noi_dung_thanh_toan',
  'tong_so_nhan_vien',
  'so_chung_tu',
  'ngay_lap',
  'chi_nhanh_vpbank',
  'tong_so_tien_bang_chu',
  'tong_so_mon_bang_so',
];

/**
 * The 5 record fields the OCR is asked to extract per row in MINIMAL mode (4 compared + stt as match key).
 * MUST stay in sync with DEFAULT_COMPARE_CONFIG.detail_rules.compare_fields.
 */
export const OCR_RECORD_FIELDS = [
  'stt',
  'ho_ten',
  'so_tai_khoan',
  'so_tien',
  'ngan_hang',
];

/**
 * ALL 60 thong_tin_chung field names (full mode).
 * Used by deriveOcrSchemaFromExcel to determine dynamic fields.
 */
export const ALL_TTC_FIELDS: string[] = [
  'so_chung_tu', 'ngay_lap', 'chi_nhanh_vpbank', 'ma_bieu_mau', 'dia_diem_lap',
  'ten_don_vi_chuyen_tien', 'ma_kh_cif', 'dia_chi', 'dien_thoai', 'fax', 'cmnd_cccd', 'ten_chu_tai_khoan',
  'so_tai_khoan_trich_no', 'loai_tien', 'mo_tai',
  'tong_so_tien_bang_so', 'tong_so_tien_bang_chu', 'ngay_lenh_chi', 'noi_dung_thanh_toan', 'muc_dich', 'danh_sach_chi_luong_so',
  'tong_so_mon_bang_so', 'tong_so_mon_bang_chu', 'tong_so_nhan_vien', 'so_nhan_vien_vpbank', 'so_nhan_vien_ngan_hang_khac',
  'noi_dung_chuyen_tien', 'ten_cong_ty_giay_nop_tien', 'tai_khoan_trung_gian', 'ngay_nhan_tien_tk_trung_gian', 'ngay_chuyen_tien',
  'don_vi_chuyen_tien_tai_khoan_treo',
  'tong_so_tien_file_cung', 'so_mon_file_cung', 'ngay_thuc_hien',
  'so_tien_do_luong_lan_1', 'so_mon_do_luong_lan_1', 'ngay_do_luong_lan_1',
  'so_tien_ton_dong', 'so_mon_ton_dong', 'ngay_ton_dong', 'nguyen_nhan_ton_dong',
  'chu_tai_khoan_ky', 'thoi_diem_nhan_yeu_cau', 'thoi_diem_xu_ly_yeu_cau', 'ghi_chu_xu_ly', 'giao_dich_vien', 'cap_tham_quyen',
  'co_thu_phi', 'don_vi_thu_phi', 'phi_phai_thu_1_mon', 'phi_dich_vu_thanh_toan', 'phi_thanh_toan_noi_bo', 'phi_thanh_toan_lien_ngan_hang',
  'gio_nhan', 'ngay_nhan', 'xac_nhan_hop_le',
  'thoi_gian', 'tong_cong_don_vi', 'don_vi_tinh',
];

/**
 * ALL 13 record field names (full mode) — excludes loai_tai_khoan (internal).
 * Used by deriveOcrSchemaFromExcel to determine dynamic fields.
 */
export const ALL_RECORD_FIELDS: string[] = [
  'stt', 'ho_ten', 'so_tai_khoan', 'so_tien',
  'so_tien_bang_chu', 'dia_chi', 'ngan_hang', 'ten_chi_nhanh', 'tinh_tp', 'ghi_chu',
  'noi_dung_thanh_toan_chi_tiet', 'loai_tien',
];

/**
 * Counter fields that are code-injected (should NOT be compared dynamically).
 */
export const COUNTER_TTC_FIELDS = new Set([
  'tong_so_nhan_vien', 'so_nhan_vien_vpbank', 'so_nhan_vien_ngan_hang_khac',
]);

/**
 * Pick the appropriate CompareMode for a field based on naming patterns.
 */
export function pickCompareMode(fieldName: string): CompareMode {
  // Vietnamese name fields
  if (/^ten_/.test(fieldName) || fieldName === 'ho_ten' || fieldName === 'chu_tai_khoan_ky' ||
      fieldName === 'giao_dich_vien' || fieldName === 'cap_tham_quyen' || fieldName === 'ten_chu_tai_khoan' ||
      fieldName === 'ten_cong_ty_giay_nop_tien' || fieldName === 'ten_don_vi_chuyen_tien') {
    return 'vietnamese_name_normalized';
  }
  // String fields that look numeric but are actually text (must check BEFORE number block)
  if (fieldName === 'tong_so_tien_bang_chu' || fieldName === 'tong_so_mon_bang_chu') {
    return 'string_normalized';
  }
  // Number fields
  if (/^tong_so_tien_/.test(fieldName) || fieldName === 'so_tien' || /^phi_/.test(fieldName) ||
      /^so_tien_/.test(fieldName) || /^tong_cong_/.test(fieldName) || /^tong_so_mon_/.test(fieldName) ||
      /^so_mon_/.test(fieldName) || fieldName === 'tong_so_nhan_vien' || fieldName === 'phi_phai_thu_1_mon' ||
      fieldName === 'phi_dich_vu_thanh_toan' || fieldName === 'phi_thanh_toan_noi_bo' ||
      fieldName === 'phi_thanh_toan_lien_ngan_hang' || fieldName === 'tong_so_tien_file_cung' ||
      fieldName === 'so_mon_file_cung' || fieldName === 'so_tien_do_luong_lan_1' ||
      fieldName === 'so_mon_do_luong_lan_1' || fieldName === 'so_tien_ton_dong' ||
      fieldName === 'so_mon_ton_dong' || fieldName === 'tong_cong_don_vi') {
    return 'number_normalized';
  }
  // Bank name fields
  if (fieldName === 'ngan_hang' || fieldName === 'don_vi_thu_phi') {
    return 'string_normalized_compact';
  }
  // Exact fields (codes, accounts, dates, ids)
  if (/^ma_/.test(fieldName) || /^so_tai_khoan/.test(fieldName) || /^tai_khoan_/.test(fieldName) ||
      /^ngay_/.test(fieldName) || /^thoi_/.test(fieldName) || fieldName === 'dien_thoai' ||
      fieldName === 'fax' || fieldName === 'cmnd_cccd' || fieldName === 'so_chung_tu' ||
      fieldName === 'gio_nhan' || fieldName === 'loai_tien' || fieldName === 'so_tai_khoan_trich_no') {
    return 'string_exact';
  }
  // Fallback
  return 'string_normalized';
}

/**
 * Like pickCompareMode, but upgrades currency-amount fields to 'money_normalized'
 * (locale-aware parse + numeric tolerance). Count fields (số món / số nhân viên)
 * stay on 'number_normalized'. All non-numeric fields delegate unchanged.
 *
 * Additive: pickCompareMode is left untouched for existing callers.
 */
export function pickCompareModeV2(fieldName: string): CompareMode {
  const base = pickCompareMode(fieldName);
  if (base !== 'number_normalized') return base;
  // Counts are integers without separators — keep exact numeric comparison.
  const isCount = /mon/.test(fieldName) || /nhan_vien/.test(fieldName);
  return isCount ? base : 'money_normalized';
}

/**
 * Guess JSON type description for a field based on its name (for output schema rendering).
 */
function guessJsonType(fieldName: string): string {
  if (fieldName === 'stt') return '"number"';
  if (fieldName.startsWith('ngay_') || fieldName.startsWith('thoi_')) return '"dd/mm/yyyy or null"';
  if (fieldName.startsWith('so_mon_') || fieldName === 'tong_so_mon_bang_so' || fieldName === 'tong_so_nhan_vien' ||
      fieldName === 'so_nhan_vien_vpbank' || fieldName === 'so_nhan_vien_ngan_hang_khac' ||
      fieldName.startsWith('phi_') || fieldName === 'tong_cong_don_vi') return '"number or null"';
  if (fieldName.startsWith('co_') || fieldName === 'co_thu_phi') return '"boolean or null"';
  if (fieldName === 'so_tien') return '"số tiền ĐÚNG NHƯ IN trên tài liệu, GIỮ nguyên phần thập phân nếu có, KHÔNG làm tròn, KHÔNG format lại (vd: \\"7000.12\\") or null"';
  if (fieldName.startsWith('tong_so_tien_bang_so') ||
      fieldName === 'so_tien_do_luong_lan_1' || fieldName === 'so_tien_ton_dong' ||
      fieldName === 'tong_so_tien_file_cung') return '"số tiền ĐÚNG NHƯ IN trên tài liệu, GIỮ nguyên phần thập phân nếu có, KHÔNG làm tròn, KHÔNG format lại or null"';
  return '"string or null"';
}

/**
 * Build prompt for AI extraction of general_info text into thong_tin_chung.
 */
export function buildExcelHeaderPrompt(
  generalInfoText: string,
  promptOverride?: string,
): Record<string, unknown> {
  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        general_info_text: generalInfoText,
      }),
    };
  }

  return {
    _prompt: `Phân tích thông tin chung từ bảng lương Excel.

Dữ liệu text phía trên bảng biểu:
---
${generalInfoText}
---

Trích xuất thành JSON FLAT (không nested). Trả TẤT CẢ fields dưới đây, field nào không tìm thấy → null:
{
  "so_chung_tu": "string or null",
  "ngay_lap": "dd/mm/yyyy or null",
  "chi_nhanh_vpbank": "string or null",
  "ma_bieu_mau": "string or null",
  "dia_diem_lap": "string or null",
  "ma_kh_cif": "string or null",
  "dia_chi": "string or null",
  "dien_thoai": "string (chỉ số) or null",
  "fax": "string or null",
  "cmnd_cccd": "string or null",
  "ten_chu_tai_khoan": "string or null",
  "so_tai_khoan_trich_no": "string (chỉ số) or null",
  "loai_tien": "VND",
  "mo_tai": "string or null",
  "tong_so_tien_bang_so": "số tiền ĐÚNG NHƯ IN trên tài liệu, giữ nguyên phần thập phân nếu có, KHÔNG làm tròn, KHÔNG format lại or null",
  "tong_so_tien_bang_chu": "string or null",
  "ngay_lenh_chi": "dd/mm/yyyy or null",
  "noi_dung_thanh_toan": "string or null",
  "muc_dich": "string or null",
  "danh_sach_chi_luong_so": "string or null",
  "tong_so_mon_bang_so": "number or null",
  "tong_so_mon_bang_chu": "string or null",
  "noi_dung_chuyen_tien": "string or null",
  "ten_don_vi_chuyen_tien": "string or null",
  "tai_khoan_trung_gian": "string or null",
  "ngay_nhan_tien_tk_trung_gian": "string or null",
  "ngay_chuyen_tien": "string or null",
  "ten_cong_ty_giay_nop_tien": "string or null",
  "tong_so_tien_file_cung": "number or null",
  "so_mon_file_cung": "number or null",
  "ngay_thuc_hien": "string or null",
  "so_tien_do_luong_lan_1": "number or null",
  "so_mon_do_luong_lan_1": "number or null",
  "ngay_do_luong_lan_1": "string or null",
  "so_tien_ton_dong": "number or null",
  "so_mon_ton_dong": "number or null",
  "ngay_ton_dong": "string or null",
  "nguyen_nhan_ton_dong": "string or null",
  "chu_tai_khoan_ky": "string or null",
  "thoi_diem_nhan_yeu_cau": "string or null",
  "thoi_diem_xu_ly_yeu_cau": "string or null",
  "ghi_chu_xu_ly": "string or null",
  "giao_dich_vien": "string or null",
  "cap_tham_quyen": "string or null",
  "co_thu_phi": "boolean or null",
  "don_vi_thu_phi": "string or null",
  "phi_phai_thu_1_mon": "number or null",
  "phi_dich_vu_thanh_toan": "number or null",
  "phi_thanh_toan_noi_bo": "number or null",
  "phi_thanh_toan_lien_ngan_hang": "number or null",
  "gio_nhan": "string or null",
  "ngay_nhan": "string or null",
  "xac_nhan_hop_le": "string or null",
  "don_vi_chuyen_tien_tai_khoan_treo": "string or null",
  "thoi_gian": "string or null",
  "tong_cong_don_vi": "number or null",
  "don_vi_tinh": "string or null",
  "default_beneficiary_bank": "string or null"
}

Quy tắc:
- Tên đơn vị: IN HOA
- Số tài khoản, điện thoại: chỉ giữ ký tự số
- Số tiền: format dấu chấm phân cách hàng nghìn (VD: 5.000.000)
- Ngày: format dd/mm/yyyy
- Nếu không tìm thấy giá trị → null
- Return JSON only, no markdown fences.

Quy tắc cho "default_beneficiary_bank" (ngân hàng thụ hưởng mặc định):
- Mục đích: xác định trường hợp đơn vị trả lương chi trả cho người thụ hưởng qua MỘT ngân hàng cố định mặc định, để hệ thống tự điền ngân hàng cho các dòng KHÔNG ghi rõ ngân hàng.
- Quy tắc CỤ THỂ: nếu đơn vị trả lương là CÔNG AN thuộc THÀNH PHỐ HÀ NỘI (ví dụ: Công an phường/xã/quận/huyện... trên địa bàn Hà Nội) → trả về "VPBANK".
- Được phép dựa vào MỌI thông tin tài liệu ghi rõ (tên đơn vị, địa danh, "Hà Nội"...) để kết luận, không chỉ dựa vào tên phường/xã/quận/huyện.
- NGUYÊN TẮC THẬN TRỌNG: nếu KHÔNG chắc chắn đơn vị thuộc Công an Hà Nội → trả về null. KHÔNG suy đoán.
- Trường này CHỈ phục vụ tự điền ngân hàng, KHÔNG dùng để đối chiếu.`,
  };
}

// ─── Interpolation Helper ─────────────────────────────────────────────────────

/**
 * Replace {{variable_name}} placeholders in a prompt template.
 * Supports all workflow step variables.
 */
function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}
