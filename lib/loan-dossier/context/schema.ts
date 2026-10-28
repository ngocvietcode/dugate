// Contract của Loan Application Context (LAC, spec cross_cutting/loan_application_context.md §4; D-103).
// Zod là nguồn duy nhất: kiểu TypeScript suy ra từ đây. LAC dựng bằng code từ S2 + S3 + sổ Claim, không gọi model.
import { z } from 'zod';

export const LAC_VERSION = '1.0' as const;

export const LacSubjectKindSchema = z.enum(['loan', 'business', 'person', 'asset', 'document']);

export const LacTrustSchema = z.enum([
  'CORROBORATED', // ≥ 2 LOẠI chứng từ khác nhau cùng giá trị (D-112)
  'SINGLE_SOURCE', // 1 chứng từ không phải đơn vay
  'DECLARED', // chỉ đơn vay (lời khai)
  'SPELLING_VARIANT', // cùng nghĩa, khác dấu
  'PROBABLE_OCR_ERROR', // lệch 1 ký tự so với đa số
  'DISPUTED', // khác giá trị thực chất
  'SUPERSEDED', // chỉ còn nguồn là bản đã bị thay thế (S3-R27)
]);

export const LacSubjectFlagSchema = z.enum(['ROLE_CONFLICT', 'ID_NUMBER_REVIEW', 'LOW_MATCH_CONFIDENCE', 'NAME_SPELLING_DIFFERENCE']);

export const LacGapCodeSchema = z.enum([
  'NO_LOAN_APPLICATION', // không có anchor: không gom được người nào
  'S3_UNAVAILABLE', // S3 lỗi: chủ thể chỉ còn loan / business / document
  'PARTY_NOT_MAPPED', // party trên chứng từ chưa gắn được người
  'ASSET_NOT_MAPPED',
  'EVIDENCE_READ_ERROR', // evidence S2 status ≠ SUCCESS
  'SUPERSEDED_EVIDENCE', // bản bị thay thế: dữ kiện của nó không render
  'LOAN_APPLICATION_DUPLICATE', // > 1 đơn vay ghi khác nhau định danh khoản vay
]);

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export const LacSubjectSchema = z.object({
  /** "loan", "business-1", "person-n" / "asset-n" (= id của S3), "doc-<n>". */
  subject_id: z.string().min(1),
  kind: LacSubjectKindSchema,
  label: z.string(),
  roles: z.array(z.string()),
  mentioned_in: z.array(z.object({ doc_type_key: z.string(), count: z.number().int().min(1) }).strict()),
  flags: z.array(LacSubjectFlagSchema),
}).strict();

export const LacSourceSchema = z.object({
  /** `{evidence_id}#{field_path}` — cùng dạng EvidenceRecord.evidence_id (V2-R04). */
  record_id: z.string().min(1),
  doc_type_key: z.string(),
  page: z.number().int().nullable(),
  read_confidence: z.number().nullable(),
}).strict();

export const LacFactSchema = z.object({
  fact_id: z.string().regex(/^fact-\d+$/),
  subject_id: z.string().min(1),
  /** Trường chung đã bỏ chỉ số mảng (`identity…`, `loan_info.requested_amount`). */
  field: z.string(),
  label: z.string(),
  value: Scalar,
  value_kind: z.enum(['text', 'name', 'id', 'date', 'money', 'number', 'boolean', 'key']),
  trust: LacTrustSchema,
  /** ACCEPTED khi MỌI nguồn có read_confidence ≥ 0.80 (LAC-R06). */
  review: z.enum(['ACCEPTED', 'REVIEW']),
  sources: z.array(LacSourceSchema).min(1),
  contradicts: z.array(z.string()),
  /**
   * Giữ cho lossless nhưng không render (LAC-R04, mở rộng ở D-103): liên kết nội bộ (party_index…), mã vai trò / loại party
   * theo chứng từ, `ownership.*` (đã thành quan hệ), thành phần địa chỉ (đã có full_text).
   */
  hidden: z.boolean(),
}).strict();

export const LacRelationSchema = z.object({
  relation_id: z.string().regex(/^rel-\d+$/),
  type: z.enum(['OWNS', 'OWNED_FORMERLY', 'SPOUSE_OF', 'RELATIVE_OF', 'LEGAL_REP_OF']),
  from: z.string(),
  to: z.string(),
  verification: z.object({
    status: z.enum(['VERIFIED', 'PARTIAL', 'UNVERIFIED', 'NOT_REQUIRED']),
    detail: z.string().nullable(),
  }).strict(),
  support_fact_ids: z.array(z.string()),
}).strict();

export const LacConflictSchema = z.object({
  conflict_id: z.string().regex(/^conf-\d+$/),
  subject_id: z.string(),
  field: z.string(),
  kind: z.enum(['DISPUTED', 'PROBABLE_OCR_ERROR']),
  /** Mọi giá trị đang tranh chấp, nhiều chứng từ ủng hộ nhất trước. */
  fact_ids: z.array(z.string()).min(2),
}).strict();

export const LacGapSchema = z.object({
  code: LacGapCodeSchema,
  subject_id: z.string().nullable(),
  /** Số mục bị ảnh hưởng; KHÔNG chứa giá trị (PII). */
  count: z.number().int().min(1),
}).strict();

export const LoanApplicationContextSchema = z.object({
  lac_version: z.literal(LAC_VERSION),
  product_code: z.string(),
  flow: z.string().nullable(),
  subjects: z.array(LacSubjectSchema),
  facts: z.array(LacFactSchema),
  relations: z.array(LacRelationSchema),
  conflicts: z.array(LacConflictSchema),
  gaps: z.array(LacGapSchema),
  meta: z.object({
    /** = ClaimLedger.leaf_count (bất biến lossless: = Σ sources của facts). */
    leaf_count: z.number().int().min(0),
    fact_count: z.number().int().min(0),
    unresolved_count: z.number().int().min(0),
    s3_status: z.string().nullable(),
    /** Evidence bị thay thế bởi bản mới hơn (S3-R27): nguồn của chúng không render và không vào bảng mã. */
    superseded_evidence_ids: z.array(z.string()),
    /** sha256 của (evidence_id, field_path, raw) đã sắp xếp — để tái lập. */
    source_hash: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
}).strict();

export type LacSubjectKind = z.infer<typeof LacSubjectKindSchema>;
export type LacTrust = z.infer<typeof LacTrustSchema>;
export type LacSubjectFlag = z.infer<typeof LacSubjectFlagSchema>;
export type LacGapCode = z.infer<typeof LacGapCodeSchema>;
export type LacSubject = z.infer<typeof LacSubjectSchema>;
export type LacSource = z.infer<typeof LacSourceSchema>;
export type LacFact = z.infer<typeof LacFactSchema>;
export type LacRelation = z.infer<typeof LacRelationSchema>;
export type LacConflict = z.infer<typeof LacConflictSchema>;
export type LacGap = z.infer<typeof LacGapSchema>;
export type LoanApplicationContext = z.infer<typeof LoanApplicationContextSchema>;
