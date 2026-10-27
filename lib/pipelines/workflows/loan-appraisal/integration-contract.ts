// HỢP ĐỒNG JSON TÍCH HỢP — dugate.loan-appraisal.integration, schema_version 5.2 (5.1 + financials[].review; 5.1 = 5.0 + extractions; parties/assets/documents/findings tuỳ chọn).
//
// Đây là NGUỒN DUY NHẤT của contract: kiểu TypeScript (z.infer), kiểm tra runtime (safeParse) và JSON Schema công bố
// (z.toJSONSchema) đều sinh từ các schema trong file này. Không viết tay kiểu thứ hai.
//
// NGUYÊN TẮC BỀN VỮNG (để số rule engine / rule LLM / rule Agent và loại bộ hồ sơ thay đổi mà không vỡ consumer):
//  1. Cấu trúc đứng yên, dữ liệu thay đổi. Rule, chỉ số, chứng từ, bên liên quan đều là MẢNG phần tử cùng hình dạng.
//     Thêm/bớt phần tử không đổi schema. Không bao giờ dùng id nghiệp vụ làm TÊN KHÓA JSON.
//  2. Enum đóng, văn bản mở. Consumer quyết định bằng `outcome`, `severity`, `code`, `status`; `message` chỉ để hiển thị.
//     Giá trị enum lạ (thêm sau trong cùng MAJOR) PHẢI được coi là `REVIEW` — xem UNKNOWN_VALUE_POLICY.
//  3. Mỗi sự thật xuất hiện MỘT lần. Người ở `parties`, chứng từ ở `documents`, rule ở `checks`; nơi khác chỉ tham chiếu
//     bằng khóa. Tên/số định danh không lặp lại trong câu chữ.
//  4. Vắng mặt = không áp dụng. Không dùng `null` để giữ chỗ; tiết kiệm kích thước và tránh "null nghĩa là gì".
//  5. Phần riêng theo loại bộ hồ sơ nằm ở `extensions[<namespace>]`, mỗi namespace có version riêng; khung không đổi.
//  6. Phiên bản hai tầng: `schema_version` (cấu trúc; MAJOR đổi = phá vỡ) và `case.profile.catalog` (bộ rule/chứng từ; đổi tự do).
//  7. Không có evidence, không có tiến trình xử lý. Kết quả đầy đủ vẫn ở GET /operations/{id} (không `view`).
//
// Quy ước semver: MINOR = chỉ THÊM field tùy chọn / giá trị enum mới; MAJOR = đổi nghĩa, xóa, đổi kiểu.
import { z } from 'zod/v4';

export const INTEGRATION_SCHEMA = 'dugate.loan-appraisal.integration' as const;
export const INTEGRATION_SCHEMA_VERSION = '5.2' as const;

/** Chính sách bắt buộc cho consumer khi gặp giá trị enum chưa biết (thêm ở MINOR sau này). */
export const UNKNOWN_VALUE_POLICY = 'TREAT_AS_REVIEW' as const;

// ─── Enum đóng ───────────────────────────────────────────────────────────────

/** Kết quả một kiểm tra. Đây là thứ DUY NHẤT consumer nên rẽ nhánh theo. */
export const OUTCOMES = ['PASS', 'FAIL', 'REVIEW', 'INSUFFICIENT_DATA', 'NOT_RUN', 'NOT_APPLICABLE'] as const;
export const OutcomeSchema = z.enum(OUTCOMES);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const SEVERITIES = ['BLOCKER', 'EXCEPTION', 'REVIEW', 'INFO'] as const;
export const SeveritySchema = z.enum(SEVERITIES);

/** Cách một kiểm tra được thực thi. EXTERNAL = nhà cung cấp ngoài (AML/PEP...). Thêm loại mới chỉ là thêm một giá trị, không đổi schema. */
export const CHECK_KINDS = ['ENGINE', 'LLM', 'AGENT', 'EXTERNAL'] as const;
export const CheckKindSchema = z.enum(CHECK_KINDS);
export type CheckKind = z.infer<typeof CheckKindSchema>;

export const RECOMMENDATIONS = ['CONSIDER', 'REFER', 'INSUFFICIENT_DATA'] as const;
export const ROUTES = ['STRAIGHT_THROUGH', 'CREDIT_REVIEW', 'RISK_REVIEW', 'REQUEST_DOCUMENTS'] as const;
export const PROCESSING_STATUSES = ['COMPLETE', 'PARTIAL', 'REVIEW_REQUIRED', 'BLOCKED'] as const;
export const READINESS_STATUSES = ['READY_FOR_APPRAISAL', 'NEEDS_DOCUMENTS', 'NEEDS_VERIFICATION', 'NOT_PROCESSABLE'] as const;
export const DOCUMENT_STATUSES = ['PRESENT', 'SUBSTITUTED', 'MISSING', 'NEEDS_RESCAN', 'NEEDS_REVIEW', 'NOT_APPLICABLE'] as const;
export const PARTY_TYPES = ['PERSON', 'ORGANIZATION'] as const;
export const FIELD_STATUSES = ['AGREED', 'OCR_NORMALIZED', 'SINGLE_SOURCE', 'CONFLICT', 'MISSING', 'CORRECTED'] as const;
export const FINDING_KINDS = ['DISCREPANCY', 'LOGIC'] as const;
export const POLICY_STATUSES = ['PASS', 'PASS_WITH_CONDITIONS', 'FAIL', 'REVIEW'] as const;
export const NOTE_KINDS = ['RISK', 'SYSTEM'] as const;
export const MATCH_STATUSES = ['NEAR_MATCH', 'MISMATCH', 'UNDETERMINED'] as const;
export const METRIC_UNITS = ['VND', 'RATIO', 'PERCENT', 'MONTHS'] as const;
export const METRIC_STATUSES = ['CALCULATED', 'INSUFFICIENT_DATA', 'NOT_APPLICABLE'] as const;
/** Phân khúc khách hàng. Thêm giá trị = thêm bộ hồ sơ mới (MINOR). */
export const SEGMENTS = ['HKD', 'SME', 'CORPORATE', 'RETAIL'] as const;

// ─── Khóa tham chiếu ─────────────────────────────────────────────────────────

/** `party-<n>` / `asset-<n>`. Ổn định trong một payload; dùng để tham chiếu, KHÔNG phải định danh nghiệp vụ. */
const PartyRef = z.string().regex(/^party-\d+$/);
const AssetRef = z.string().regex(/^asset-\d+$/);
const CheckId = z.string().min(1).max(120);

// ─── case ────────────────────────────────────────────────────────────────────

export const CaseSchema = z.object({
  id: z.string().min(1),
  completed_at: z.string().optional(),
  profile: z.object({
    segment: z.enum(SEGMENTS),
    product: z.string().min(1),
    product_name: z.string().optional(),
    flow: z.string().optional(),
    /** Phiên bản danh mục đã áp dụng; consumer dùng để tra nhãn / mã. Đổi tự do, không phá vỡ schema. */
    catalog: z.object({ checks: z.string().min(1), documents: z.string().min(1) }).strict(),
  }).strict(),
}).strict();

// ─── decision ────────────────────────────────────────────────────────────────

export const DecisionSchema = z.object({
  status: z.enum(PROCESSING_STATUSES),
  recommendation: z.enum(RECOMMENDATIONS),
  suggested_amount_vnd: z.number().optional(),
  suggested_tenor_months: z.number().optional(),
  route: z.enum(ROUTES),
  required_role: z.string().optional(),
  review_required: z.boolean(),
  /** Hồ sơ đủ điều kiện chuyển CBQL/CO (4 tiêu chí tiếp nhận). Chi tiết từng tiêu chí: include=narrative. */
  ready_for_handover: z.boolean().optional(),
  /** Mã lý do ổn định (enum mở theo catalog). Nhãn tiếng Việt xem `include=labels`. */
  reason_codes: z.array(z.string()),
  /** Điều kiện ngoài chứng từ (VD EXTERNAL_COMPLIANCE_PENDING). Chứng từ cần bổ sung KHÔNG lặp ở đây: xem `documents.items` (status MISSING/NEEDS_*). */
  conditions: z.array(z.object({ code: z.string(), message: z.string().optional() }).strict()).optional(),
  covenants: z.array(z.string()).optional(),
}).strict();

// ─── parties / assets ────────────────────────────────────────────────────────

/** Một trường dữ liệu đã hợp nhất của bên liên quan / tài sản. */
export const FieldSchema = z.object({
  /** Đường dẫn trường theo schema chứng từ, VD "permanent_address". Ổn định theo catalog. */
  path: z.string(),
  value: z.unknown(),
  status: z.enum(FIELD_STATUSES),
  /** Chỉ có (true) khi cần người rà soát. */
  review: z.literal(true).optional(),
  /** Chỉ khi CONFLICT: các giá trị khác nhau giữa các bản. */
  candidates: z.array(z.unknown()).optional(),
}).strict();

export const PartySchema = z.object({
  id: PartyRef,
  type: z.enum(PARTY_TYPES),
  /** Vai trò trong hồ sơ: borrower, co_borrower, collateral_owner, legal_representative, beneficial_owner... (enum mở). */
  roles: z.array(z.string()).min(1),
  name: z.string().optional(),
  /** Định danh theo loại, không đặt tên field cố định: NATIONAL_ID, TAX_CODE, BUSINESS_REG... */
  identifiers: z.array(z.object({ type: z.string(), value: z.string() }).strict()).optional(),
  /** Quan hệ với bên khác: vợ/chồng, người đại diện, công ty mẹ... */
  relations: z.array(z.object({ type: z.string(), party: PartyRef }).strict()).optional(),
  fields: z.array(FieldSchema).optional(),
}).strict();

export const AssetSchema = z.object({
  id: AssetRef,
  type: z.string(),
  owners: z.array(PartyRef).optional(),
  /** Mục đích sử dụng: collateral, rental_income... */
  usage: z.array(z.string()).optional(),
  /** Định danh theo loại, không đặt tên field cố định: CERTIFICATE_NUMBER, LICENSE_PLATE, LAND_PARCEL... */
  identifiers: z.array(z.object({ type: z.string(), value: z.string() }).strict()).optional(),
  fields: z.array(FieldSchema).optional(),
}).strict();

// ─── documents ───────────────────────────────────────────────────────────────

export const DocumentItemSchema = z.object({
  /** Khóa mục checklist (VD "legal_id_card"), ổn định theo catalog. */
  key: z.string(),
  group: z.string(),
  status: z.enum(DOCUMENT_STATUSES),
  required: z.boolean(),
  /** Bên / tài sản mà mục này thuộc về. */
  party: PartyRef.optional(),
  asset: AssetRef.optional(),
  /** Mã lý do (VD DOCUMENT_NOT_FOUND). */
  code: z.string().optional(),
  action: z.enum(['UPLOAD', 'RESCAN', 'REVIEW_CONTEXT']).optional(),
  substituted_by: z.string().optional(),
}).strict();

export const DocumentsSchema = z.object({
  readiness: z.enum(READINESS_STATUSES),
  completeness_percent: z.number(),
  required_present: z.number().int(),
  required_total: z.number().int(),
  /** Tổng hợp theo nhóm; để consumer vẽ tiến độ mà không cần duyệt `items`. */
  by_group: z.array(z.object({
    group: z.string(),
    required: z.number().int(),
    done: z.number().int(),
    missing: z.number().int(),
    needs_review: z.number().int(),
    percent: z.number().optional(),
  }).strict()),
  /** CHỈ mục có ý nghĩa: không phải NOT_APPLICABLE, và hoặc bắt buộc hoặc đang có vấn đề. Tổng quan đầy đủ xem by_group. */
  items: z.array(DocumentItemSchema),
  /** Dữ liệu đã hợp nhất theo từng chứng từ (giá trị cuối, không nguồn). Trường MISSING (không có giá trị) không xuất hiện. */
  records: z.array(z.object({
    doc: z.string(),
    item: z.string().optional(),
    party: PartyRef.optional(),
    asset: AssetRef.optional(),
    fields: z.array(FieldSchema),
  }).strict()),
  /** Vấn đề cấp tệp: tệp không nhận dạng được / bóc tách lỗi. */
  issues: z.array(z.object({
    kind: z.enum(['UNCLASSIFIED_FILE', 'EXTRACTION_ERROR']),
    file: z.string(),
    doc: z.string().optional(),
    message: z.string().optional(),
  }).strict()),
}).strict();

// ─── findings (đối chiếu chéo) ───────────────────────────────────────────────

export const FindingSchema = z.object({
  kind: z.enum(FINDING_KINDS),
  /** DISCREPANCY: tên trường lệch. LOGIC: khóa luật. */
  field: z.string(),
  status: z.enum(MATCH_STATUSES).optional(),
  severity: z.string(),
  review: z.literal(true).optional(),
  code: z.string().optional(),
  party: PartyRef.optional(),
  asset: AssetRef.optional(),
  /** Giá trị theo từng loại chứng từ; không kèm file/trang/evidence. */
  values: z.array(z.object({ doc: z.string(), value: z.unknown() }).strict()).optional(),
  canonical_doc: z.string().optional(),
  /** DISCREPANCY: lý do lệch. LOGIC: nội dung vi phạm. */
  message: z.string().optional(),
}).strict();

// ─── financials ──────────────────────────────────────────────────────────────

/** Mảng {metric,value,unit}: thêm chỉ số (ICR, D/E, current ratio...) không đổi schema. */
export const FinancialSchema = z.object({
  metric: z.string(),
  value: z.number().optional(),
  unit: z.enum(METRIC_UNITS),
  status: z.enum(METRIC_STATUSES),
  conflict: z.literal(true).optional(),
  /** 5.2 (D-101): đã tính được nhưng có đầu vào đọc với độ tin cậy thấp — cần rà soát trước khi dùng. Vắng = đầu vào đã chấp nhận. */
  review: z.literal(true).optional(),
}).strict();

// ─── checks (rule engine + rule LLM + rule Agent) ────────────────────────────

/** Đại lượng so sánh của rule engine. */
export const MeasureSchema = z.object({
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  unit: z.enum(METRIC_UNITS).optional(),
}).strict();

/**
 * MỘT hình dạng cho mọi loại kiểm tra. `kind` chỉ cho biết cách thực thi; consumer không cần phân nhánh theo `kind`.
 * Kiểm tra đạt (PASS) chỉ mang {id, ver, kind, group, outcome}: hồ sơ tốt càng nhỏ.
 */
export const CheckSchema = z.object({
  id: CheckId,
  ver: z.string(),
  kind: CheckKindSchema,
  group: z.string(),
  outcome: OutcomeSchema,
  /** Luôn có: consumer không phải tra catalog để biết mức độ. */
  severity: SeveritySchema,
  /** Mã kết quả ổn định. LLM/Agent CHỈ được chọn trong `outputs.codes` đã khai báo ở catalog; ngoài danh sách → REVIEW + UNKNOWN_CODE. */
  code: z.string().optional(),
  /** Đối tượng bị kiểm tra, khi rule chạy theo từng bên / tài sản. */
  party: PartyRef.optional(),
  asset: AssetRef.optional(),
  /** Chỉ ENGINE. */
  measure: MeasureSchema.optional(),
  /** Chỉ LLM/AGENT: 0..1. */
  confidence: z.number().min(0).max(1).optional(),
  /** Chỉ khi outcome ≠ PASS và có diễn giải. Không đưa tên người / số định danh vào đây. */
  message: z.string().optional(),
  /** FAIL nhưng được phép ngoại lệ. */
  exception: z.literal(true).optional(),
}).strict();

export const ChecksSummarySchema = z.object({
  /** Kết luận tổng hợp của bộ kiểm tra (FAIL BLOCKER → FAIL; còn REVIEW/INSUFFICIENT_DATA/NOT_RUN → REVIEW...). */
  status: z.enum(POLICY_STATUSES),
  policy: z.object({ id: z.string(), version: z.string() }).strict().optional(),
  total: z.number().int(),
  by_outcome: z.array(z.object({ outcome: OutcomeSchema, count: z.number().int() }).strict()),
}).strict();

// ─── assessment (văn bản diễn giải — chỉ khi include=narrative) ──────────────

export const AssessmentSchema = z.object({
  ready_for_handover: z.boolean(),
  criteria: z.array(z.object({
    key: z.string(),
    status: z.string(),
    summary: z.string().optional(),
    findings: z.array(z.object({ code: z.string(), message: z.string(), acknowledgeable: z.boolean().optional() }).strict()).optional(),
  }).strict()),
  summary: z.object({
    overview: z.string(),
    highlights: z.array(z.string()),
    next_actions: z.array(z.string()),
  }).strict().optional(),
}).strict();

// ─── labels (chỉ khi include=labels) ─────────────────────────────────────────

/** Nhãn hiển thị tách khỏi dữ liệu: gửi một lần theo khóa thay vì lặp trong từng phần tử. */
export const LabelsSchema = z.object({
  checks: z.array(z.object({ id: z.string(), name: z.string(), severity: SeveritySchema, codes: z.array(z.string()).optional() }).strict()).optional(),
  documents: z.array(z.object({ key: z.string(), label: z.string() }).strict()).optional(),
  /** Nhóm kiểm tra (checks[].group) và nhóm chứng từ (documents.items[].group) là HAI không gian khóa khác nhau. */
  check_groups: z.array(z.object({ group: z.string(), label: z.string() }).strict()).optional(),
  document_groups: z.array(z.object({ group: z.string(), label: z.string() }).strict()).optional(),
  metrics: z.array(z.object({ metric: z.string(), label: z.string() }).strict()).optional(),
}).strict();

// ─── extractions (kết quả OCR) ───────────────────────────────────────────────

/**
 * Kết quả trích xuất OCR của từng chứng từ: giá trị cuối theo schema của loại chứng từ, không bản ghi evidence, không độ tin cậy từng trường.
 * data giữ đúng cấu trúc của danh mục chứng từ (theo doc + schema_version), nên thêm loại chứng từ mới không đổi contract.
 * Giai đoạn 2 hiện chỉ có khối này cho phần hồ sơ (các bước kiểm tra tạm tắt); khi bật lại, phần hợp nhất nằm ở documents.records / parties.
 */
export const ExtractionSchema = z.object({
  /** Khóa loại chứng từ (VD loan_application), ổn định theo danh mục. */
  doc: z.string(),
  file: z.string(),
  /** Chứng từ thứ n trong cùng một tệp (tệp gộp nhiều chứng từ). */
  instance: z.number().int().optional(),
  pages: z.tuple([z.number().int(), z.number().int()]).optional(),
  status: z.enum(['SUCCESS', 'ERROR']),
  /** Chỉ khi ERROR. */
  code: z.string().optional(),
  schema_version: z.string().optional(),
  /** Bản trùng với chứng từ khác trong hồ sơ (VD DUPLICATE_OF); không có nghĩa là bỏ qua bản này. */
  duplicate: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ─── gốc ─────────────────────────────────────────────────────────────────────

export const IntegrationPayloadSchema = z.object({
  schema: z.literal(INTEGRATION_SCHEMA),
  schema_version: z.literal(INTEGRATION_SCHEMA_VERSION),
  case: CaseSchema,
  decision: DecisionSchema,
  /** Kết quả OCR của từng chứng từ. Luôn có (mảng rỗng nếu không bóc tách được gì). */
  extractions: z.array(ExtractionSchema),
  /** Các khối dưới đây đến từ các bước kiểm tra hồ sơ (Customer 360, checklist, đối chiếu chéo). Vắng khi các bước đó tạm tắt (giai đoạn 2 hiện tại). */
  parties: z.array(PartySchema).optional(),
  assets: z.array(AssetSchema).optional(),
  documents: DocumentsSchema.optional(),
  findings: z.array(FindingSchema).optional(),
  financials: z.array(FinancialSchema),
  checks: z.array(CheckSchema),
  checks_summary: ChecksSummarySchema,
  /** Ngoại lệ policy: id các kiểm tra FAIL được phép ngoại lệ (tham chiếu `checks[].id`). */
  exceptions: z.array(CheckId).optional(),
  notes: z.array(z.object({ kind: z.enum(NOTE_KINDS), text: z.string() }).strict()).optional(),
  /** Phần riêng theo loại bộ hồ sơ: khóa là namespace (VD "segment.sme"), mỗi namespace có schema/version riêng. */
  extensions: z.record(z.string(), z.object({ version: z.string(), data: z.unknown() }).strict()).optional(),
  /** `include=narrative`. */
  assessment: AssessmentSchema.optional(),
  /** `include=labels`. */
  labels: LabelsSchema.optional(),
}).strict();

export type IntegrationPayload = z.infer<typeof IntegrationPayloadSchema>;
export type IntegrationCheck = z.infer<typeof CheckSchema>;
export type IntegrationParty = z.infer<typeof PartySchema>;

/** Giá trị cho `?include=`. Mặc định (không truyền) = không có `assessment` và `labels`. */
export const INTEGRATION_INCLUDES = ['narrative', 'labels'] as const;
export type IntegrationInclude = typeof INTEGRATION_INCLUDES[number];

/** JSON Schema công bố cho consumer (draft 2020-12). Sinh từ chính schema runtime nên không thể lệch. */
export function integrationJsonSchema() {
  return z.toJSONSchema(IntegrationPayloadSchema);
}
