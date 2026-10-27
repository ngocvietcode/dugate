// lib/pipelines/workflows/prompts/margin-deposit-profile-prompts.ts
// Prompt builders for the Margin Deposit Profile workflow (Hồ sơ Ký quỹ).
//
// Steps (mode-dependent):
//   Classify — nhận diện loại chứng từ (UC-01)
//   Extract — trích xuất field (UC-02)
//   Presence — chữ ký, ký nháy, con dấu (UC-03) [e2e, extraction]
//   Validate 04 copies — rule-based compareCopies (UC-04) [e2e, validation]
//   Framework compare — đối chiếu với chứng từ khung (UC-06) [e2e, framework]
//   UC-05 (cross-document) — REMOVED

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EscrowDocument {
  file_id: string;
  file_name: string;
  doc_code: string;
  doc_label: string;
  page_range: string;
  confidence: number;
}

export interface ClassifyPageResult {
  document_id?: string;
  code: string;
  title: string;
  confidence: number;
  reason: string;
  page_range: string;
  file_id: string;
}

export interface ClassifyFileResult {
  fileName: string;
  fileId: string;
  documents: ClassifyPageResult[];
  subOperationId: string;
  status: 'success';
}

export interface ClassifyFileError {
  fileName: string;
  fileId: string;
  documents: never[];
  subOperationId: string;
  status: 'error';
  error: string;
}

export type ClassifyResult = ClassifyFileResult | ClassifyFileError;

// NOTE: document_id/file_id/doc_code/page_range đã có ở DocumentItem cha nên
// KHÔNG lặp lại trong extracted/present_checks. subOperationId giữ để truy vết.

/** A single extracted scalar value. All values are strings (or null); numbers are stringified. */
export interface ScalarField {
  value: string | null;
  confidence: number;
}

/**
 * One member of a repeated group (e.g. an escrow party or an installment row).
 * A member value is usually a scalar { value, confidence }; for nested groups
 * (e.g. a reconciliation record whose `reconciliation_parties` is itself an
 * array of members) a member key may hold an array of sub-members.
 */
export type ExtractGroupMember = Record<string, ScalarField | ExtractGroupMember[]>;

/**
 * A field value is either a single scalar { value, confidence } or, for repeated
 * structures (escrow_parties, transfer_parties, installments), an array of members.
 */
export type ExtractFieldValue = ScalarField | ExtractGroupMember[];

export interface ExtractFieldResult {
  fields: Record<string, ExtractFieldValue>;
  /**
   * Per-field parse failures. A field that fails validation is NOT thrown away
   * for the whole document anymore: it is recorded here (fieldName → reason) and
   * its value in `fields` is set to a safe empty scalar { value: null,
   * confidence: 0 } so downstream readers keep working. Absent/empty when every
   * field parsed cleanly.
   */
  field_errors?: Record<string, string>;
  status: 'success';
  subOperationId: string;
}

/** Field names whose value is an array of group members instead of a scalar. */
export const ARRAY_FIELDS_BY_CODE: Record<string, string[]> = {
  thoa_thuan_ky_quy: ['escrow_parties', 'installments'],
  thanh_ly_ky_quy: ['escrow_parties'],
  dang_ky_nguyen_vong: ['escrow_parties'],
  thoa_thuan_chuyen_nhuong: ['escrow_parties', 'transfer_parties'],
  // Đơn tra soát: toàn bộ chứng từ là một MẢNG record. Mỗi record có 3 field
  // phẳng + 1 sub-array `reconciliation_parties` (xem ARRAY_MEMBER_SUBARRAYS).
  don_tra_soat: ['reconciliation'],
};

/** Scalar sub-field schema for each array field (member keys that are { value, confidence }). */
export const ARRAY_MEMBER_FIELDS: Record<string, string[]> = {
  escrow_parties: ['code', 'escrow_full_name', 'escrow_national_id', 'escrow_id_issue_date'],
  transfer_parties: ['code', 'transfer_full_name', 'transfer_national_id', 'transfer_id_issue_date'],
  installments: ['installment_index', 'amount'],
  // A reconciliation record's SCALAR keys. Its nested array key is declared in
  // ARRAY_MEMBER_SUBARRAYS below.
  reconciliation: ['t24_transaction', 'amount', 'reconciliation_content'],
};

/**
 * Nested array fields WITHIN a group member. Maps:
 *   arrayField → { subArrayKey → scalar member keys of that sub-array }
 * Enables one level of nesting (array of records, each record owning its own
 * array of members). Only `reconciliation` uses this today.
 */
export const ARRAY_MEMBER_SUBARRAYS: Record<string, Record<string, string[]>> = {
  reconciliation: {
    reconciliation_parties: ['full_name', 'unit_code', 'national_id'],
  },
};

export interface ExtractFieldError {
  status: 'error';
  error: string;
}

export type ExtractResult = ExtractFieldResult | ExtractFieldError;

export interface CopyCompareResult {
  doc_code: string;
  copies_found: number;
  copies_expected: number;
  mismatches: Array<{
    field: string;
    copy_a: string;
    copy_b: string;
    page_a: string;
    page_b: string;
  }>;
  verdict: 'MATCH' | 'MISMATCH' | 'INCOMPLETE';
  status: 'success' | 'error';
  error?: string;
}

export interface CrossDocResult {
  checks: Array<{
    field: string;
    source_doc: string;
    target_doc: string;
    source_value: string;
    target_value: string;
    match: boolean;
    explanation?: string;
  }>;
  verdict: 'PASS' | 'FAIL' | 'WARNING';
  status: 'success' | 'error';
  error?: string;
}

export interface FrameworkCompareResult {
  clauses_modified: Array<{
    /** Section / clause title or number, e.g. "Điều 3", "Căn cứ", "Tiêu đề". */
    clause_id: string;
    /**
     * - `missing`  : a template section/heading/mandatory content is ABSENT in the customer doc.
     * - `modified` : the section exists but its content differs from the template.
     * - `added`    : the customer doc has an extra section not present in the template.
     * - `removed`  : legacy alias kept for backward compatibility (treated like `missing`).
     */
    action: 'added' | 'removed' | 'modified' | 'missing';
    /** Template (khung) content for this section — source of truth. */
    template?: string;
    /** Customer (khách hàng) content for this section (empty/absent when action = missing). */
    customer?: string;
    /** Human-readable message describing exactly what is off at this location. */
    detail?: string;
    severity: 'info' | 'warning' | 'critical';
  }>;
  verdict: 'PASS' | 'FAIL' | 'WARNING';
  status: 'success' | 'error';
  error?: string;
  /** When several templates are supplied, the one the comparator matched the
   *  customer doc against (title/code). Absent for single-template compares. */
  matched_template?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const ESCROW_DOCUMENT_CODES = [
  'thoa_thuan_ky_quy',
  'thanh_ly_ky_quy',
  'dang_ky_nguyen_vong',
  'cccd',
  'ho_chieu',
  'thoa_thuan_chuyen_nhuong',
  'don_tra_soat',
] as const;

export const ESCROW_DOCUMENT_LABELS: Record<string, string> = {
  thoa_thuan_ky_quy: 'Thỏa thuận ký quỹ (TTKQ)',
  thanh_ly_ky_quy: 'Biên bản thanh lý (BBTL/TLKQ)',
  dang_ky_nguyen_vong: 'Đăng ký nguyện vọng (ĐKNV)',
  cccd: 'Căn cước / Căn cước công dân / Căn cước điện tử (CCCD)',
  ho_chieu: 'Hộ chiếu',
  thoa_thuan_chuyen_nhuong: 'Thỏa thuận chuyển nhượng (TTCN)',
  don_tra_soat: 'Đơn tra soát (ĐTS)',
};

/** Canonical document titles emitted in classification output (no person names). */
export const CLASSIFICATION_TITLES: Record<string, string> = {
  thoa_thuan_ky_quy: 'Thỏa thuận ký quỹ',
  thanh_ly_ky_quy: 'Biên bản thanh lý',
  dang_ky_nguyen_vong: 'Đăng ký nguyện vọng',
  cccd: 'Căn cước',
  ho_chieu: 'Hộ chiếu',
  thoa_thuan_chuyen_nhuong: 'Thỏa thuận chuyển nhượng',
  don_tra_soat: 'Đơn tra soát',
};

// Full set of top-level field keys per doc type. Keys listed in ARRAY_FIELDS_BY_CODE
// are array-valued; all others are scalar { value, confidence }.
export const EXTRACT_FIELDS_BY_CODE: Record<string, string[]> = {
  thoa_thuan_ky_quy: [
    'escrow_parties',
    'unit_code', 'total_escrow_amount', 'number_of_installments',
    'installments',
  ],
  thanh_ly_ky_quy: [
    'escrow_parties',
    'unit_code', 'refund_amount',
    'beneficiary_account_number', 'beneficiary_account_name', 'beneficiary_bank',
    'debit_account_number', 'payment_content',
  ],
  dang_ky_nguyen_vong: [
    'unit_code', 'escrow_parties',
  ],
  cccd: [
    'full_name', 'cccd_id', 'date_of_birth', 'nationality',
    'id_issue_date', 'id_place', 'id_expiry_date',
  ],
  ho_chieu: [
    'full_name', 'passport_number', 'date_of_birth', 'nationality',
    'passport_issue_date', 'passport_expiry_date',
  ],
  thoa_thuan_chuyen_nhuong: [
    'escrow_parties', 'transfer_parties', 'unit_code',
  ],
  don_tra_soat: [
    'reconciliation',
  ],
};

// UC-05 (cross-document validation) removed — no longer used.

// ─── Per-doc-type field extraction guides (from SRS Field Mapping Reference) ──

export const FIELD_EXTRACTION_GUIDE: Record<string, string> = {
  thoa_thuan_ky_quy: `
Bên ký quỹ có tối đa 3 người → trả MẢNG "escrow_parties". Mỗi phần tử là object gồm các key (mỗi key là { value, confidence }):
| Sub-field (trong escrow_parties[]) | Cách xác định | Chuẩn hóa |
|-------|--------------|-----------|
| code | Thứ tự người ký quỹ, bắt đầu từ 1 | Chuỗi số: "1", "2", "3" |
| escrow_full_name | "Họ và tên:" / "Ông" / "Bà" Bên ký quỹ | UPPERCASE, collapse whitespace |
| escrow_national_id | "Số CMND/CCCD/HC:" / "Số giấy tờ:" | Strip ký tự thừa, chỉ giữ số (9 hoặc 12 chữ số) |
| escrow_id_issue_date | "Cấp ngày", sau số CCCD | DD/MM/YYYY |

Các field phẳng (mỗi field là { value, confidence }):
| Field | Cách xác định | Chuẩn hóa | Ghi chú |
|-------|--------------|-----------|---------|
| unit_code | "Số:", dưới tiêu đề THỎA THUẬN KÝ QUỸ. Format: Tòa+Tầng+số nhà | UPPERCASE, strip whitespace | VD: A4-35-09 |
| total_escrow_amount | "Số tiền ký quỹ:" / "Bên Ký quỹ đồng ý chuyển..." | Chuỗi số tiền GIỮ NGUYÊN dấu . và , như trên chứng từ; chỉ bỏ "VND"/"đồng"/"đ" | VD: "478.000.000" |
| number_of_installments | Count từ bảng "Tiến độ chuyển tiền ký quỹ" | Chuỗi số nguyên | VD: "2" |

Tiến độ chuyển tiền → trả MẢNG "installments". Mỗi phần tử là object gồm (mỗi key là { value, confidence }):
| Sub-field (trong installments[]) | Cách xác định | Chuẩn hóa |
|-------|--------------|-----------|
| installment_index | "Đợt 1/Đợt 2/Đợt N" | Chuỗi số: "1", "2" |
| amount | Số tiền mỗi đợt | Chuỗi số tiền GIỮ NGUYÊN dấu . và , như trên chứng từ; chỉ bỏ "VND"/"đồng"/"đ", VD: "239.000.000" |`,

  thanh_ly_ky_quy: `
Bên ký quỹ có tối đa 3 người → trả MẢNG "escrow_parties". Mỗi phần tử là object gồm các key (mỗi key là { value, confidence }):
| Sub-field (trong escrow_parties[]) | Cách xác định | Chuẩn hóa |
|-------|--------------|-----------|
| code | Thứ tự người ký quỹ, bắt đầu từ 1 | Chuỗi số: "1", "2", "3" |
| escrow_full_name | "Họ và tên:" / "Ông" / "Bà" Bên ký quỹ | UPPERCASE, collapse whitespace |
| escrow_national_id | "Số CMND/CCCD/HC:" / "Số giấy tờ:" | Strip ký tự thừa, chỉ giữ số |
| escrow_id_issue_date | "Cấp ngày", sau số CCCD | DD/MM/YYYY |

Các field phẳng (mỗi field là { value, confidence }):
| Field | Cách xác định | Chuẩn hóa | Ghi chú |
|-------|--------------|-----------|---------|
| unit_code | "Số:", dưới tiêu đề. Format: Tòa+Tầng+số nhà | UPPERCASE, strip whitespace | |
| refund_amount | "Số tiền hoàn trả:" / "Hoàn trả số tiền:" | Chuỗi số tiền GIỮ NGUYÊN dấu . và , như trên chứng từ; chỉ bỏ "VND"/"đồng"/"đ" | |
| beneficiary_account_number | "Tài khoản ghi có:" / "Số tài khoản (bên nhận):" | GIỮ NGUYÊN VĂN toàn bộ, KHÔNG loại chữ/hậu tố (VD "123456 TEST" giữ nguyên) | Chỉ trim khoảng trắng đầu/cuối |
| beneficiary_account_name | "Tên tài khoản:" / "Chủ tài khoản:" | UPPERCASE | |
| beneficiary_bank | "Ngân hàng hưởng:" / "Ngân hàng:" | UPPERCASE | |
| debit_account_number | "Tài khoản trích nợ" / "Tài khoản ký quỹ số" | GIỮ NGUYÊN VĂN toàn bộ, KHÔNG loại chữ/hậu tố | Chỉ trim khoảng trắng đầu/cuối |
| payment_content | "Nội dung:" / "Nội dung chuyển tiền:" | Giữ nguyên | |`,

  dang_ky_nguyen_vong: `
Các field phẳng (mỗi field là { value, confidence }):
| Field | Cách xác định | Chuẩn hóa |
|-------|--------------|-----------|
| unit_code | "Căn hộ đăng ký:" / "Số nhà ở:". Format: Tòa+Tầng+số nhà | UPPERCASE, strip whitespace |

Bên ký quỹ có tối đa 3 người → trả MẢNG "escrow_parties". Mỗi phần tử là object gồm (mỗi key là { value, confidence }):
| Sub-field (trong escrow_parties[]) | Cách xác định | Chuẩn hóa |
|-------|--------------|-----------|
| code | Thứ tự người ký quỹ, bắt đầu từ 1 | Chuỗi số: "1", "2", "3" |
| escrow_full_name | "Họ và tên:" / "Ông" / "Bà" Bên ký quỹ | UPPERCASE, collapse whitespace |
| escrow_national_id | "Số CMND/CCCD/HC:" / "Số giấy tờ:" | Strip ký tự thừa, chỉ giữ số |
| escrow_id_issue_date | "Cấp ngày", sau số CCCD | DD/MM/YYYY |`,

  cccd: `
| Field | Cách xác định | Chuẩn hóa | Ghi chú |
|-------|--------------|-----------|---------|
| full_name | Dòng "Họ, chữ đệm và tên khai sinh" (mặt trước) | UPPERCASE, collapse whitespace | Áp dụng cho cả Căn cước, Căn cước công dân, Căn cước điện tử, Thẻ căn cước |
| cccd_id | Số định danh in trên thẻ (12 chữ số, mặt trước) | Chỉ giữ số, 12 chữ số | |
| date_of_birth | Dòng "Ngày, tháng, năm sinh" | DD/MM/YYYY | |
| nationality | Dòng "Quốc tịch" | Giữ nguyên | |
| id_issue_date | Dòng "Ngày cấp" (mặt sau) | DD/MM/YYYY | |
| id_place | Dòng "Nơi cấp" (mặt sau) | Giữ nguyên | VD: "Cục CSQLHC về TTXH" |
| id_expiry_date | Dòng "Có giá trị đến" (mặt sau) | DD/MM/YYYY | |`,

  ho_chieu: `
| Field | Cách xác định | Chuẩn hóa | Ghi chú |
|-------|--------------|-----------|---------|
| full_name | MRZ line 2 / dòng "Surname / Given names" | UPPERCASE, collapse whitespace | |
| passport_number | Dòng "Passport No." / MRZ | Strip ký tự thừa | |
| date_of_birth | Dòng "Date of birth" / MRZ (format YYMMDD → convert) | DD/MM/YYYY | |
| nationality | Dòng "Nationality" / MRZ | 3-char ISO code hoặc tên đầy đủ | VD: VNM |
| passport_issue_date | Dòng "Date of issue" | DD/MM/YYYY | |
| passport_expiry_date | Dòng "Date of expiry" / MRZ | DD/MM/YYYY | |`,

  thoa_thuan_chuyen_nhuong: `
Bên ký quỹ tối đa 3 người → MẢNG "escrow_parties". Bên nhận chuyển nhượng tối đa 3 người → MẢNG "transfer_parties". Mỗi phần tử là object (mỗi key là { value, confidence }).
| Sub-field (escrow_parties[]) | Cách xác định | Chuẩn hóa |
|-------|--------------|-----------|
| code | Thứ tự người ký quỹ, từ 1 | Chuỗi số |
| escrow_full_name | "Họ và tên:" Bên ký quỹ | UPPERCASE, collapse whitespace |
| escrow_national_id | "Số CMND/CCCD/HC:" Bên ký quỹ | Strip ký tự thừa, chỉ giữ số |
| escrow_id_issue_date | "Cấp ngày" Bên ký quỹ | DD/MM/YYYY |

| Sub-field (transfer_parties[]) | Cách xác định | Chuẩn hóa |
|-------|--------------|-----------|
| code | Thứ tự người nhận chuyển nhượng, từ 1 | Chuỗi số |
| transfer_full_name | "Họ và tên:" Bên nhận chuyển nhượng | UPPERCASE, collapse whitespace |
| transfer_national_id | "Số CMND/CCCD/HC:" Bên nhận chuyển nhượng | Strip ký tự thừa, chỉ giữ số |
| transfer_id_issue_date | "Cấp ngày" Bên nhận chuyển nhượng | DD/MM/YYYY |

Field phẳng (mỗi field là { value, confidence }):
| Field | Cách xác định | Chuẩn hóa |
|-------|--------------|-----------|
| unit_code | "Thỏa thuận ký quỹ số..." Format: Tòa+Tầng+số nhà | UPPERCASE, strip whitespace |`,

  don_tra_soat: `
Đơn tra soát là một BẢNG nhiều dòng → trả MẢNG "reconciliation". Mỗi phần tử là một RECORD (object) tương ứng một dòng/bút toán.
Mỗi record gồm 3 field phẳng (mỗi field là { value, confidence }) và 1 MẢNG con "reconciliation_parties":
| Field (trong reconciliation[]) | Cách xác định | Chuẩn hóa | Ghi chú |
|-------|--------------|-----------|---------|
| t24_transaction | "Bút toán" / "Bút toán T24" | Giữ nguyên | |
| amount | "Số tiền" | Chuỗi số tiền GIỮ NGUYÊN dấu . và , như trên chứng từ; chỉ bỏ "VND"/"đồng"/"đ" | |
| reconciliation_content | "Điều chỉnh các nội dung..." / "Nội dung tra soát" | Giữ nguyên, không xử lý | |

Trong mỗi record, "reconciliation_parties" là MẢNG — mỗi phần tử là object (mỗi key là { value, confidence }) tách ra từ reconciliation_content:
| Sub-field (trong reconciliation_parties[]) | Cách xác định | Chuẩn hóa |
|-------|--------------|-----------|
| full_name | Tách từ reconciliation_content, VD: "NGUYEN VAN AN" | UPPERCASE, bỏ dấu thừa, chuẩn hóa khoảng trắng |
| unit_code | Tách từ reconciliation_content, mã căn VD: A2-05-02 | UPPERCASE, strip khoảng trắng |
| national_id | Tách từ reconciliation_content, số CCCD/Hộ chiếu | Strip ký tự thừa, chuỗi số thuần (9 hoặc 12 chữ số) |

Ví dụ "reconciliation":
[
  {
    "t24_transaction": {"value":"TT2616617478","confidence":0.98},
    "amount": {"value":"500.000.000","confidence":0.98},
    "reconciliation_content": {"value":"Điều chỉnh ... NGUYEN VAN AN 12345678910 A2-05-02","confidence":0.97},
    "reconciliation_parties": [
      { "full_name": {"value":"NGUYEN VAN AN","confidence":0.97}, "unit_code": {"value":"A2-05-02","confidence":0.97}, "national_id": {"value":"12345678910","confidence":0.97} }
    ]
  }
]`,
};

// ─── Prompt Helpers ───────────────────────────────────────────────────────────

function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    key in vars ? vars[key] : match,
  );
}

const EXTRACT_OUTPUT_CONTRACT = `
## HỢP ĐỒNG OUTPUT BẮT BUỘC
- "fields" phải chứa đúng các key sau: {{fields}}. Không thêm key ngoài danh sách này.
- Field SCALAR có đúng dạng { "value": <string hoặc null>, "confidence": <number 0..1> }.
- Field MẢNG ({{array_fields}}) có value là JSON array; mỗi phần tử là object mà MỖI key con cũng là { "value": <string hoặc null>, "confidence": <number 0..1> }.
  Ví dụ escrow_parties: [ { "code": {"value":"1","confidence":0.99}, "escrow_full_name": {"value":"NGUYỄN VĂN AN","confidence":0.99}, "escrow_national_id": {"value":"036192001506","confidence":0.99}, "escrow_id_issue_date": {"value":"19/01/2024","confidence":0.99} } ]
  Ví dụ installments: [ { "installment_index": {"value":"1","confidence":0.99}, "amount": {"value":"239.000.000","confidence":0.99} } ]
- Một phần tử của field MẢNG có thể chứa MỘT key con là MẢNG LỒNG (array of object). Khi đó key lồng là JSON array, mỗi phần tử lại là object gồm các key { value, confidence }. Các key con còn lại vẫn là scalar { value, confidence }.
  Ví dụ reconciliation (đơn tra soát): [ { "t24_transaction": {"value":"TT123","confidence":0.98}, "amount": {"value":"500.000.000","confidence":0.98}, "reconciliation_content": {"value":"...","confidence":0.97}, "reconciliation_parties": [ { "full_name": {"value":"NGUYEN VAN AN","confidence":0.97}, "unit_code": {"value":"A2-05-02","confidence":0.97}, "national_id": {"value":"12345678910","confidence":0.97} } ] } ]
- MỌI "value" phải là JSON string hoặc null; KHÔNG trả JSON number. Số tiền GIỮ NGUYÊN dấu . và , như trên chứng từ (ví dụ "478.000.000"); số thứ tự là chuỗi số ("1", "2"). "confidence" luôn là JSON number 0..1.
- Nếu không có bên/đợt nào, trả mảng rỗng []. Tối đa 3 phần tử cho escrow_parties/transfer_parties.
- Giá trị không tồn tại trên biểu mẫu là chuỗi "N/A"; trường có trên biểu mẫu nhưng không đọc được thì value = null.
`;

// ─── Prompt Builders ──────────────────────────────────────────────────────────

export function buildClassifyPrompt(
  fileName: string,
  promptOverride?: string,
): Record<string, unknown> {
  const categories = Object.entries(ESCROW_DOCUMENT_LABELS)
    .map(([code, label]) => `- ${code}: ${label}`)
    .join('\n');

  if (promptOverride) {
    return { _prompt: interpolatePrompt(promptOverride, { file_name: fileName, categories }) };
  }

  return {
    _prompt: `Bạn là chuyên gia phân loại chứng từ ký quỹ ngân hàng VPBank.

## NHIỆM VỤ
Phân loại TẤT CẢ các trang trong file "${fileName}" vào các loại chứng từ dưới đây.

## DANH SÁCH LOẠI CHỨNG TỪ VÀ KEYWORD NHẬN DIỆN

| Code | Loại chứng từ | Keywords nhận diện (tiêu đề/cụm từ đặc trưng) |
|------|---------------|-----------------------------------------------|
| thoa_thuan_ky_quy | Thỏa thuận ký quỹ (TTKQ) | "THỎA THUẬN KÝ QUỸ", "Bên ký quỹ đồng ý chuyển vào tài khoản ký quỹ" |
| thanh_ly_ky_quy | Biên bản thanh lý (BBTL/TLKQ) | "BIÊN BẢN THANH LÝ", "THANH LÝ KÝ QUỸ", "giải tỏa và chuyển toàn bộ Tiền Ký Quỹ" |
| dang_ky_nguyen_vong | Đăng ký nguyện vọng (ĐKNV) | "ĐĂNG KÝ NGUYỆN VỌNG", "Căn hộ đăng ký" |
| cccd | Căn cước công dân (CCCD) | "CĂN CƯỚC CÔNG DÂN", "CĂN CƯỚC", "CĂN CƯỚC ĐIỆN TỬ", "THẺ CĂN CƯỚC", "SOCIALIST REPUBLIC OF VIETNAM", "IDENTITY CARD", 12 chữ số in lớn. Căn cước, Căn cước công dân, Căn cước điện tử, Thẻ căn cước đều thuộc loại này. |
| ho_chieu | Hộ chiếu | "PASSPORT", "HỘ CHIẾU", MRZ line (dòng <<< ở dưới) |
| thoa_thuan_chuyen_nhuong | Thỏa thuận chuyển nhượng (TTCN) | "THỎA THUẬN CHUYỂN NHƯỢNG", "Bên nhận chuyển nhượng" |
| don_tra_soat | Đơn tra soát (ĐTS) | "ĐƠN TRA SOÁT", "XÁC NHẬN THÔNG TIN", "Bút toán" |

## QUY TẮC PHÂN LOẠI
1. So sánh keyword KHÔNG phân biệt hoa/thường, có dấu/không dấu (VD: "thỏa thuận" = "THOA THUAN" = "Thỏa Thuận").
2. Nếu 1 trang match nhiều loại → chọn loại có weighted score cao nhất (ưu tiên: tiêu đề > cụm từ đặc trưng > pattern).
3. Nếu fuzzy similarity ≥ 85% nhưng không exact match → vẫn chấp nhận, gán match_type = "fuzzy".
4. Mỗi trang chỉ gán 1 loại (confidence cao nhất, threshold ≥ 0.7).
5. Nhóm các trang LIÊN TIẾP cùng 1 loại thành 1 document_item (page_range liền).
6. Nếu cùng 1 loại xuất hiện nhiều lần KHÔNG liên tiếp → tạo document_item riêng cho mỗi lần.
7. Trang không match loại nào (confidence < 0.7) → gán code = "unknown".
8. TTKQ và BBTL thường có 04 bản in giống nhau liên tiếp — mỗi bản là 1 document_item riêng.

## OUTPUT FORMAT (JSON array)
[
  {
    "code": "<mã chứng từ theo bảng trên>",
    "title": "<chỉ tên loại chứng từ đúng theo tiêu đề tài liệu, không kèm họ tên/tên cá nhân, mã giao dịch hoặc dữ liệu trích xuất>",
    "confidence": <0.0-1.0>,
    "match_type": "exact" | "fuzzy",
    "reason": "<keyword đã match, vị trí trên trang>",
    "page_range": "<VD: 1-5 hoặc 6>"
  }
]

## LƯU Ý
- page_range dùng đánh số 1-based.
- Nếu OCR trả text rỗng/whitespace cho tất cả trang → trả 01 item unknown với page_range là khoảng trang số cụ thể (VD: "1-24"), không dùng ký hiệu "N": [{"code":"unknown","title":"OCR_EMPTY_TEXT","confidence":0,"match_type":"exact","reason":"OCR returned empty text","page_range":"1-24"}].
- Confidence phản ánh mức chắc chắn: 1.0 = exact keyword match rõ ràng, 0.7-0.9 = fuzzy match hoặc layout-based.`,
  };
}

export function buildExtractPrompt(
  docCode: string,
  fileName: string,
  pageRange: string,
  promptOverride?: string,
): Record<string, unknown> {
  const fields = EXTRACT_FIELDS_BY_CODE[docCode] || [];
  const label = ESCROW_DOCUMENT_LABELS[docCode] || docCode;
  const fieldGuide = FIELD_EXTRACTION_GUIDE[docCode] || '';

  const arrayFields = ARRAY_FIELDS_BY_CODE[docCode] ?? [];
  const promptVariables = { file_name: fileName, doc_code: docCode, fields: fields.join(', '), page_range: pageRange };
  const outputContract = interpolatePrompt(EXTRACT_OUTPUT_CONTRACT, {
    fields: fields.join(', '),
    array_fields: arrayFields.length ? arrayFields.join(', ') : 'không có',
  });

  if (promptOverride) {
    return {
      _prompt: `${interpolatePrompt(promptOverride, promptVariables)}\n${outputContract}`,
    };
  }

  return {
    _prompt: `Bạn là chuyên gia OCR và bóc tách dữ liệu chứng từ ngân hàng VPBank.

## NHIỆM VỤ
Trích xuất các trường thông tin từ chứng từ "${label}" (code: ${docCode}).

## BƯỚC 0 — KIỂM TRA ĐÚNG LOẠI TÀI LIỆU (BẮT BUỘC, LÀM TRƯỚC KHI TRÍCH XUẤT)
- Đọc TIÊU ĐỀ của tài liệu (dòng in đậm/căn giữa ở đầu trang, ví dụ "THỎA THUẬN KÝ QUỸ", "BIÊN BẢN THANH LÝ", "ĐƠN TRA SOÁT", "ĐĂNG KÝ NGUYỆN VỌNG", "THỎA THUẬN CHUYỂN NHƯỢNG"...) và phần "Căn cứ"/mở đầu.
- So sánh loại đọc được với loại được yêu cầu: "${label}" (code: ${docCode}).
- Nếu tài liệu RÕ RÀNG KHÔNG PHẢI loại "${label}" (tiêu đề thuộc một loại chứng từ khác hẳn), thì KHÔNG trích xuất field. Thay vào đó trả về đúng JSON:
  { "doc_type_mismatch": true, "detected_title": "<tiêu đề/loại thực tế đọc được>" }
- Chỉ báo mismatch khi CHẮC CHẮN (tiêu đề rõ ràng là loại khác). Nếu tài liệu mờ/không rõ tiêu đề nhưng có khả năng là loại đã khai → vẫn tiếp tục trích xuất bình thường (không báo mismatch).
- Nếu đúng loại (hoặc không chắc chắn là loại khác) → bỏ qua bước này, trích xuất theo OUTPUT FORMAT bên dưới.

## HƯỚNG DẪN TRÍCH XUẤT THEO TỪNG TRƯỜNG
${fieldGuide}

## QUY TẮC CHUNG
1. Confidence: 0.95-1.0 = đọc rõ ràng; 0.8-0.95 = đọc được nhưng hơi mờ; < 0.8 = không chắc chắn
2. Giá trị không tồn tại trên biểu mẫu → value = "N/A" (chuỗi)
3. Trường có trên biểu mẫu nhưng không đọc được / trống → value = null

## CHUẨN HÓA DỮ LIỆU
- Số tiền (VND): GIỮ NGUYÊN dấu . và , như trên chứng từ (VD: "478.000.000"). Chỉ bỏ "VND", "đồng", "đ".
- Ngày tháng: DD/MM/YYYY (pad 0 nếu cần, VD: 01/06/2026)
- CMND/CCCD: chỉ giữ chữ số (strip space, dash), 9 hoặc 12 chữ số. Hộ chiếu: giữ chữ và số, uppercase, bỏ khoảng trắng và dấu phân cách không thuộc mã.
- Họ tên: UPPERCASE, collapse whitespace, bỏ dấu thừa.
- Mã căn: UPPERCASE, strip whitespace (VD: A4-35-09)
- Số tài khoản (beneficiary_account_number, debit_account_number): TRÍCH ĐÚNG NGUYÊN VĂN toàn bộ giá trị ghi trên chứng từ, KHÔNG được tự loại bỏ chữ cái/ký tự/hậu tố. Nếu chứng từ ghi "123456 TEST" thì phải trả "123456 TEST", không được cắt thành "123456". Chỉ bỏ khoảng trắng thừa ở đầu/cuối; giữ nguyên phần chữ, số và các ký tự khác đúng như hiển thị.

## OUTPUT FORMAT
{
  "doc_code": "${docCode}",
  "file_id": "${fileName}",
  "fields": {
    "<tên_trường>": { "value": "<chuỗi chuẩn hóa hoặc null>", "confidence": <0.0-1.0> }
  }
}
${outputContract}
Trả về ĐÚNG format JSON trên (hoặc JSON mismatch ở BƯỚC 0), không thêm text giải thích ngoài JSON.`,
  };
}

/**
 * `validation` mode copy-check (margin-deposit-mode-contracts spec): AI-based
 * full-document diff across N copies of the same doc_type/group_id, replacing
 * the field-by-field compareCopies() engine for full-document coverage.
 */
export function buildCopyDiffPrompt(
  docType: string,
  fileIds: string[],
  promptOverride?: string,
): Record<string, unknown> {
  const label = ESCROW_DOCUMENT_LABELS[docType] || docType;
  const fileList = fileIds.map((id, index) => `${index + 1}. ${id}`).join('\n');

  if (promptOverride) {
    return { _prompt: interpolatePrompt(promptOverride, { doc_type: docType, file_list: fileList }) };
  }

  return {
    _prompt: `Bạn là chuyên gia đối chiếu chứng từ ngân hàng VPBank.

## NHIỆM VỤ
So sánh TOÀN BỘ nội dung của ${fileIds.length} file dưới đây, tất cả cùng loại "${label}" (${docType}). Các file này ĐƯỢC KHAI BÁO là bản sao của cùng một chứng từ và PHẢI giống hệt nhau về nội dung.

Danh sách file (theo đúng thứ tự đính kèm):
${fileList}

## QUY TẮC SO SÁNH
1. Đọc toàn bộ nội dung mỗi file, không chỉ các trường dữ liệu cố định — so sánh cả điều khoản, số tiền, ngày tháng, tên, số CCCD, chữ ký/con dấu mô tả bằng văn bản, và bất kỳ nội dung nào khác xuất hiện trên chứng từ.
2. CHỈ báo cáo khác biệt có ý nghĩa về nội dung (số liệu, tên, điều khoản, ngày tháng...). KHÔNG báo cáo khác biệt do lỗi OCR vô hại, khoảng trắng, canh lề, font chữ, hoặc xuống dòng khi nội dung thực chất giống nhau.
3. Với mỗi khác biệt tìm thấy, xác định mức độ nghiêm trọng:
   - "critical": sai lệch số tiền, ngày tháng, tên, số CCCD/hộ chiếu, mã căn, hoặc nội dung điều khoản quan trọng.
   - "warning": sai lệch có thể ảnh hưởng nhưng chưa chắc chắn nghiêm trọng.
   - "info": lỗi chính tả nhỏ, khác biệt định dạng không ảnh hưởng nội dung.
4. Nếu tất cả file giống hệt nhau về nội dung, trả về mảng "differences" RỖNG.

## OUTPUT FORMAT
{
  "differences": [
    {
      "location": "<vị trí/điều khoản/mục xuất hiện khác biệt, VD: 'Điều 3 - Số tiền ký quỹ'>",
      "description": "<mô tả khác biệt cụ thể, VD: 'Bản 1 ghi 478.000.000, bản 3 ghi 478.500.000'>",
      "file_refs": ["<file_id của các bản liên quan tới khác biệt này>"],
      "severity": "info" | "warning" | "critical"
    }
  ]
}

Trả về ĐÚNG format JSON trên, không thêm text giải thích ngoài JSON. Nếu không có khác biệt, trả về { "differences": [] }.`,
  };
}

// buildCopyComparePrompt REMOVED (deterministic version) — UC-04 legacy compareCopies() in margin-deposit-profile-compare.ts remains for backward reference; validation mode uses buildCopyDiffPrompt above.

// buildCrossDocPrompt REMOVED — UC-05 removed entirely from workflow.

export function buildFrameworkComparePrompt(
  customerDoc: any,
  frameworkDoc: any,
  promptOverride?: string,
): Record<string, unknown> {
  const customerJson = JSON.stringify(customerDoc, null, 2);
  const frameworkJson = JSON.stringify(frameworkDoc, null, 2);

  if (promptOverride) {
    return { _prompt: interpolatePrompt(promptOverride, { customer_doc: customerJson, framework_doc: frameworkJson }) };
  }

  return {
    _prompt: `Bạn là chuyên gia so sánh hợp đồng/chứng từ khung.

So sánh chứng từ khách hàng với chứng từ khung theo dự án. Phát hiện điều khoản bị sửa, thêm hoặc xóa.

Chứng từ khách hàng:
${customerJson}

Chứng từ khung (template) — CÓ THỂ CÓ NHIỀU MẪU KHÁC NHAU:
${frameworkJson}

QUY TẮC NHIỀU MẪU KHUNG (ĐỌC TRƯỚC TIÊN):
- Có thể có NHIỀU chứng từ khung đính kèm (ví dụ 2 mẫu đơn tra soát khác nhau). Mỗi mẫu là một chuẩn độc lập.
- Khách hàng được coi là HỢP LỆ (PASS) nếu KHỚP VỚI ÍT NHẤT MỘT mẫu khung bất kỳ (logic HOẶC). KHÔNG bắt buộc khớp tất cả các mẫu.
- Hãy chọn mẫu khung GIỐNG NHẤT với chứng từ khách hàng (mẫu khớp nhiều mục cố định nhất) làm MẪU ĐỐI CHIẾU, ghi tiêu đề/mã mẫu đó vào "matched_template".
- CHỈ so sánh và báo lệch (clauses_modified) SO VỚI MẪU ĐÃ CHỌN. TUYỆT ĐỐI không báo lệch chỉ vì khách hàng khác với một mẫu khung khác mà nó không khớp.
- Nếu khách hàng khớp một mẫu → PASS, clauses_modified rỗng (hoặc chỉ info nhỏ).
- Nếu khách hàng KHÔNG khớp mẫu nào → chọn mẫu GẦN NHẤT (ít lệch nhất) làm "matched_template", đặt verdict FAIL/WARNING theo mức lệch, và liệt kê clauses_modified SO VỚI MẪU GẦN NHẤT đó.

Trả về JSON:
{
  "document_type_match": true|false,
  "customer_doc_title": "<tiêu đề/loại tài liệu của chứng từ khách hàng>",
  "template_doc_title": "<tiêu đề/loại tài liệu của MẪU KHUNG ĐÃ CHỌN để đối chiếu>",
  "matched_template": "<tên/tiêu đề mẫu khung đã chọn làm chuẩn đối chiếu (mẫu khớp nhất)>",
  "clauses_modified": [
    {
      "clause_id": "<tên/số mục hoặc tiêu đề, ví dụ: Tiêu đề, Căn cứ, Điều 3>",
      "action": "missing|modified|added",
      "template": "<nội dung mục này trong KHUNG>",
      "customer": "<nội dung mục này trong file KHÁCH HÀNG, để trống nếu thiếu>",
      "detail": "<mô tả CỤ THỂ điểm lệch: thiếu mục gì, sai chữ/số/ngày/số tiền nào, khác ở đâu>",
      "severity": "info|warning|critical"
    }
  ],
  "verdict": "PASS|FAIL|WARNING"
}

BƯỚC 0 — KIỂM TRA CÙNG LOẠI TÀI LIỆU (BẮT BUỘC, LÀM TRƯỚC TIÊN):
- Trước khi so sánh, xác định LOẠI của mỗi tài liệu dựa vào TIÊU ĐỀ (dòng in đậm/căn giữa như "THỎA THUẬN KÝ QUỸ", "BIÊN BẢN THANH LÝ", "THỎA THUẬN CHUYỂN NHƯỢNG"...) và PHẦN "Căn cứ"/mở đầu.
- Nếu chứng từ khách hàng và chứng từ khung KHÁC LOẠI (ví dụ khách hàng là "Thỏa thuận ký quỹ" nhưng khung là "Biên bản thanh lý"):
  - Đặt "document_type_match": false.
  - Đặt "verdict": "FAIL".
  - KHÔNG cố ghép/so sánh từng mục; trả "clauses_modified": [] (hoặc chỉ 1 mục mô tả sự khác loại nếu cần).
  - Không được kết luận PASS chỉ vì hai tài liệu tình cờ có một số đầu mục/bố cục giống nhau.
- Nếu cùng loại: đặt "document_type_match": true và tiếp tục kiểm tra bao phủ như bên dưới.

NGUYÊN TẮC PLACEHOLDER (RẤT QUAN TRỌNG — ĐỌC KỸ TRƯỚC KHI SO SÁNH):
- KHUNG là biểu mẫu trống chứa các Ô ĐIỀN (placeholder), ví dụ: «Họ_và_tên_khách_hàng», «Số», «Ngày_cấp», «Nơi_cấp», «Hộ_khẩu_thường_trú», «Địa_chỉ_liên_hệ», «Số tiền», các đoạn "……", "…/…/…", dấu gạch dưới để trống, hoặc chữ trong dấu ngoặc kép/ngoặc nhọn dùng làm mẫu.
- Những chỗ này SINH RA để khách hàng ĐIỀN dữ liệu thật vào. Giá trị khách hàng điền vào (họ tên, CCCD, ngày, số tiền, địa chỉ...) là DỮ LIỆU RIÊNG của từng hồ sơ.
- TUYỆT ĐỐI KHÔNG so sánh, KHÔNG báo lệch, KHÔNG tạo entry chỉ vì:
  - Khách hàng điền giá trị thật vào chỗ mà khung để placeholder/để trống. Đây là ĐÚNG mục đích, không phải "modified".
  - Placeholder trong khung khác với giá trị thật trong file khách hàng.
- Chỉ so sánh PHẦN CỐ ĐỊNH (boilerplate) của biểu mẫu: tiêu đề, tên các mục/điều khoản, nhãn trường (label), câu chữ in sẵn, điều khoản pháp lý cố định. Đây là phần PHẢI GIỐNG giữa khung và khách hàng.
- Ví dụ: khung ghi "CCCD: «Số» cấp ngày «Ngày_cấp» nơi cấp «Nơi_cấp»", khách hàng ghi "CCCD: 001186043418 cấp ngày 18/12/2021 nơi cấp Cục CSQLHC" → COI LÀ KHỚP (label "CCCD/cấp ngày/nơi cấp" giống nhau, phần còn lại là dữ liệu điền → bỏ qua). KHÔNG tạo entry.

CHUỖI MẪU / CÔNG THỨC GHÉP GIÁ TRỊ (mở rộng của nguyên tắc placeholder):
- Khi khung mô tả một chuỗi bằng các token đánh số hoặc ký hiệu như "[1]", "[2]", "[3]", "{1}", "<...>", kèm ký tự nối hoặc từ khóa cố định (ví dụ khung: "Nội dung nộp tiền: [1]_[2]_ky quy_[3]_ALM"), thì "[1] [2] [3]", dấu gạch dưới "_", và các mảnh như "ky quy", "ALM" ở đây LÀ HƯỚNG DẪN CÁCH GHÉP GIÁ TRỊ ĐIỀN, KHÔNG phải nội dung cố định bắt buộc phải xuất hiện nguyên văn trong file khách hàng.
- Khi khách hàng điền giá trị thật (ví dụ "Nội dung nộp tiền: NGUYEN VAN A 0123 ALM" hay "[1] [2] [3]" đã được thay bằng dữ liệu), chuỗi kết quả SẼ khác hình dạng chuỗi mẫu. Đây là ĐÚNG mục đích điền, KHÔNG được coi là "thiếu thành phần cố định" hay "modified".
- CHỈ báo lệch ở dòng dạng chuỗi-mẫu khi phần NHÃN/CÂU CHỮ CỐ ĐỊNH đứng trước công thức bị đổi/thiếu (ví dụ đổi nhãn "Nội dung nộp tiền:" thành thứ khác, hoặc thiếu hẳn dòng này). KHÔNG so sánh chi tiết bên trong công thức ghép ([1], "_", "ky quy", "[3]", "ALM"...).
- Ví dụ CỤ THỂ (KHÔNG tạo entry): khung "Nội dung nộp tiền: [1]_[2]_ky quy_[3]_ALM", khách hàng "Nội dung nộp tiền: [1] [2] [3]" hoặc giá trị đã điền → COI LÀ KHỚP vì nhãn "Nội dung nộp tiền:" giống nhau; phần công thức/giá trị điền BỎ QUA.

DANH SÁCH / KHỐI LẶP MẪU — SỐ LƯỢNG KHÔNG CỐ ĐỊNH (mở rộng nguyên tắc placeholder):
- Khi khung liệt kê nhiều dòng/mục CÙNG KIỂU theo số thứ tự (ví dụ "Đợt 1 / Đợt 2 / Đợt 3", "Bên A / Bên B", danh sách "1. ... 2. ... 3. ...", các dòng "……" lặp lại), thì SỐ LƯỢNG phần tử trong khung CHỈ LÀ MẪU MINH HỌA cách trình bày, KHÔNG phải số cố định bắt buộc.
- Số lượng thực tế do DỮ LIỆU TỪNG HỒ SƠ quyết định. Khách hàng có ÍT HƠN hoặc NHIỀU HƠN số phần tử so với khung đều HỢP LỆ.
- TUYỆT ĐỐI KHÔNG báo "missing"/"modified"/"thiếu Đợt N"/"thiếu mục thứ N" chỉ vì khách hàng có số đợt/số dòng/số mục khác với khung. Đây KHÔNG phải lỗi.
- Ví dụ CỤ THỂ (KHÔNG tạo entry): khung ghi "Đợt 1: ... ; Đợt 2: ... ; Đợt 3: ...", khách hàng chỉ có "Đợt 1: 431.000.000 VNĐ ...; Đợt 2: 431.000.000 VNĐ ..." (2 đợt) → COI LÀ KHỚP; số đợt là dữ liệu thực tế, KHÔNG được coi thiếu "Đợt 3".
- CHỈ xét dòng/mục lặp này khi NHÃN CỐ ĐỊNH của cả khối bị đổi/thiếu (ví dụ thiếu hẳn nhãn "Tiến độ chuyển tiền ký quỹ"/"Đợt"), KHÔNG xét từng phần tử con và KHÔNG đếm số lượng.

BƯỚC 1 — KIỂM TRA BAO PHỦ ĐẦY ĐỦ THEO KHUNG (khi document_type_match = true):
- KHUNG (template) là chuẩn về CẤU TRÚC. File khách hàng PHẢI có ĐẦY ĐỦ mọi mục tiêu đề và nội dung CỐ ĐỊNH (boilerplate) có trong khung.
- Duyệt LẦN LƯỢT TỪNG mục/tiêu đề/điều khoản của KHUNG. Với mỗi mục, chỉ xét PHẦN CỐ ĐỊNH (theo nguyên tắc placeholder ở trên):
  - Nếu khách hàng KHÔNG có mục đó (thiếu hẳn tiêu đề, thiếu điều khoản, thiếu label/nội dung cố định bắt buộc) → "action": "missing", "detail" nêu rõ mục nào bị thiếu, "severity": "critical".
  - Nếu khách hàng CÓ mục đó nhưng PHẦN CỐ ĐỊNH bị SỬA (đổi câu chữ điều khoản, đổi/xóa label, sửa nội dung pháp lý cố định làm đổi nghĩa) → "action": "modified", điền "template" (nội dung khung) và "customer" (nội dung khách hàng), "detail" nêu CHÍNH XÁC chỗ lệch của phần cố định, "severity" theo mức độ.
  - Nếu mục khớp về cấu trúc/boilerplate (chỉ khác ở dữ liệu điền vào placeholder) → KHÔNG tạo entry.
- Nếu khách hàng có thêm mục/điều khoản CỐ ĐỊNH KHÔNG có trong khung → "action": "added", "detail" nêu rõ mục thừa; severity tùy nội dung.
- "detail" là BẮT BUỘC cho mọi entry và phải chỉ đích danh vị trí + nội dung cố định lệch, không nói chung chung.
- KHÔNG được tạo entry cho: số hồ sơ để trống, họ tên/CCCD/ngày/địa chỉ/số tiền được điền hay để trống — đó đều là dữ liệu điền, không phải boilerplate.
- KHÔNG được tạo entry cho khác biệt BÊN TRONG chuỗi mẫu/công thức ghép giá trị (token [1]/[2]/[3], ký tự nối "_", các mảnh mô tả cách ghép). Chỉ xét nhãn/câu chữ cố định đứng ngoài công thức đó.
- KHÔNG được tạo entry vì khác SỐ LƯỢNG phần tử trong danh sách/khối lặp mẫu (số đợt thanh toán, số bên, số dòng liệt kê). Số lượng là dữ liệu thực tế, không cố định theo khung.

BƯỚC 2 — VERDICT (đánh giá SO VỚI MẪU KHUNG ĐÃ CHỌN — mẫu khớp nhất):
- Nếu khách hàng khớp (bao phủ đầy đủ + đúng boilerplate) VỚI ÍT NHẤT MỘT mẫu khung → "PASS". Đặt mẫu đó vào "matched_template", clauses_modified rỗng hoặc chỉ info nhỏ.
- Nếu KHÔNG khớp mẫu nào: chọn mẫu GẦN NHẤT (ít lệch nhất) làm "matched_template", rồi:
  - "FAIL" nếu so với mẫu gần nhất vẫn có BẤT KỲ mục "missing", hoặc "modified" ở phần CỐ ĐỊNH bắt buộc (severity "critical").
  - "WARNING" nếu chỉ có khác biệt nhỏ ở phần cố định không đổi nghĩa (severity "info"/"warning") hoặc chỉ có mục "added" không ảnh hưởng.
- clauses_modified LUÔN chỉ liệt kê điểm lệch so với "matched_template", không trộn lệch của các mẫu khác.
- Luôn điền "customer_doc_title", "template_doc_title" (của mẫu đã chọn) và "matched_template" theo đúng tiêu đề đọc được.`,
  };
}
