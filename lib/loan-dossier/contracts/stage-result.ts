// Hợp đồng `StageResult` và `data` của S1, S2 (T-CON-01; 02_conventions §4, S1 §2, S2 §2).
// Mọi object `.strict()` (D-05): field lạ ở bất kỳ cấp nào bị từ chối. Enum và mã lý do lấy từ catalog
// để không lệch spec. Trên nền v2 (D-32) không có `contract`/`contract_version` của W1/W2: StageResult
// được workflow `loan-appraisal` lưu vào `extracted_data` của bước (v2_integration V2-R03).
import { z } from 'zod';

import { docTypeByKey, isReasonCode, loadReasonCodes } from '../catalog';
import {
  ConfidenceSchema, DocTypeKeySchema, EvidenceEnvelopeSchema, FileIdSchema, PageRangeSchema,
  catalogEnumStrict,
} from '../s2/common-schema';

// ── Khung StageResult (02_conventions §4) ───────────────────────────────────
export const StageKeySchema = catalogEnumStrict('StageKey');
export const StageStatusSchema = catalogEnumStrict('StageStatus');
export type StageStatus = z.infer<typeof StageStatusSchema>;

/** Mã scope `STAGE` trong `reason_codes.json`. */
export const StageStatusCodeSchema = z.string().refine(
  (c) => isReasonCode(c, 'STAGE'),
  'status_code không có trong reason_codes.json (scope STAGE)',
);

export const BlockingInputSchema = z.object({
  type: z.enum(['DOCUMENT', 'EXTERNAL_DATA', 'INTEGRATION']),
  key: z.string().min(1),
  message: z.string(),
}).strict();
export type BlockingInput = z.infer<typeof BlockingInputSchema>;

const IsoDateTimeSchema = z.string().datetime({ offset: true });

/** Trạng thái stage mà mã lý do được gắn trong catalog (cột `status`), VD `INVALID_FLOW` → `FAILED`. */
function statusOfCode(code: string): string | undefined {
  return loadReasonCodes().find((r) => r.code === code && r.scope === 'STAGE')?.status;
}

/** Các trạng thái đã có kết quả nghiệp vụ → `data` bắt buộc khác null. */
const STATUSES_WITH_DATA = new Set(['SUCCESS', 'PARTIAL_SUCCESS', 'INSUFFICIENT_DATA']);

/**
 * `StageResult` có `data`/`content_preview` theo từng stage.
 * `data` được null khi stage `RUNNING`/`UNAVAILABLE`/`FAILED` (chưa có hoặc không có kết quả).
 */
export function StageResultSchema<D extends z.ZodTypeAny, P extends z.ZodTypeAny>(
  stageKey: z.infer<typeof StageKeySchema>,
  dataSchema: D,
  previewSchema: P,
) {
  return z.object({
    stage_key: z.literal(stageKey),
    status: StageStatusSchema,
    status_code: StageStatusCodeSchema,
    message: z.string().nullable(),
    started_at: IsoDateTimeSchema.nullable(),
    finished_at: IsoDateTimeSchema.nullable(),
    content_preview: previewSchema.nullable(),
    data: dataSchema.nullable(),
    blocking_inputs: z.array(BlockingInputSchema),
  }).strict().superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    const expected = statusOfCode(r.status_code);
    if (expected && expected !== r.status) issue('status_code', `mã ${r.status_code} đi với status ${expected}`);
    if (STATUSES_WITH_DATA.has(r.status) && r.data === null) issue('data', `status ${r.status} → data là object`);
    if (r.status !== 'RUNNING' && r.finished_at === null) issue('finished_at', 'stage đã kết thúc → bắt buộc finished_at');
    if (r.started_at && r.finished_at && r.finished_at < r.started_at) issue('finished_at', 'finished_at trước started_at');
  });
}

// ── S1 classify (S1 §2, §4) ────────────────────────────────────────────────
export const FileStatusSchema = catalogEnumStrict('FileStatus');

/** Bảng §4: status → (reason_code, next_action) hợp lệ. */
const FILE_STATUS_TABLE: Record<string, Array<[string | null, string | null]>> = {
  CLASSIFIED: [[null, null]],
  UNSUPPORTED_FILE: [['UNSUPPORTED_FORMAT', 'CONVERT_AND_REUPLOAD']],
  PASSWORD_PROTECTED: [['PASSWORD_PROTECTED', 'REMOVE_PASSWORD_AND_REUPLOAD']],
  CORRUPTED_FILE: [['CORRUPTED_FILE', 'RESCAN_AND_REUPLOAD']],
  UNKNOWN: [
    ['EMPTY_OR_UNREADABLE', 'RESCAN_AND_REUPLOAD'],
    ['LOW_QUALITY_UNREADABLE', 'RESCAN_AND_REUPLOAD'],
    ['UNCLASSIFIED', null],
  ],
};

/** D-70, S1-R21/R22: `value` chép nguyên văn từ chứng từ (null = không có, "[không rõ]" = không đọc được). */
export const KeyFactSchema = z.object({
  subject: z.string().min(1),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  value: z.string().nullable(),
  page: z.number().int().min(1).nullable(),
}).strict();

export const ClassifyInstanceSchema = z.object({
  instance_index: z.number().int().min(1),
  page_range: PageRangeSchema,
  confidence: ConfidenceSchema,
  summary: z.string(),
  key_facts: z.array(KeyFactSchema),
}).strict();

export const ClassifyMatchSchema = z.object({
  doc_type_key: DocTypeKeySchema,
  /** S1-R04: < 0.50 bị loại nên không bao giờ có trong output. */
  confidence: ConfidenceSchema.refine((c) => c >= 0.5, 'confidence < 0.50 bị loại (S1-R04)'),
  needs_manual_review: z.boolean(),
  needs_extraction: z.boolean(),
  instances_count: z.number().int().min(1),
  hint_mismatch: z.boolean(),
  instances: z.array(ClassifyInstanceSchema).min(1),
}).strict().superRefine((m, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (m.instances_count !== m.instances.length) issue('instances_count', 'instances_count = instances.length (S1-R07)');
  if (m.needs_manual_review !== (m.confidence < 0.8)) issue('needs_manual_review', 'true khi và chỉ khi 0.50 ≤ confidence < 0.80 (S1-R04)');
  const docType = docTypeByKey(m.doc_type_key);
  if (docType && docType.needs_extraction !== m.needs_extraction) issue('needs_extraction', 'phải tra doc_types.json (S1-R14)');
  const idx = m.instances.map((i) => i.instance_index);
  if (new Set(idx).size !== idx.length) issue('instances', 'instance_index trùng');
});

export const ClassifyFileSchema = z.object({
  file_id: FileIdSchema,
  file_name: z.string(),
  status: FileStatusSchema,
  reason_code: z.string().nullable(),
  next_action: z.string().nullable(),
  message: z.string().nullable(),
  page_count: z.number().int().min(0).nullable(),
  matches: z.array(ClassifyMatchSchema),
}).strict().superRefine((f, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  const allowed = FILE_STATUS_TABLE[f.status] ?? [];
  if (!allowed.some(([rc, na]) => rc === f.reason_code && na === f.next_action)) {
    issue('reason_code', `(reason_code, next_action) không khớp bảng §4 cho ${f.status}`);
  }
  if (f.status === 'CLASSIFIED' && f.matches.length === 0) issue('matches', 'CLASSIFIED → ≥ 1 match');
  if (f.status !== 'CLASSIFIED' && f.matches.length > 0) issue('matches', `${f.status} → matches = []`);
  const keys = f.matches.map((m) => m.doc_type_key);
  if (new Set(keys).size !== keys.length) issue('matches', 'mỗi doc_type_key tối đa 1 match / file (S1-R06)');
});
export type ClassifyFile = z.infer<typeof ClassifyFileSchema>;

export const RepeatedDocTypeSchema = z.object({
  doc_type_key: DocTypeKeySchema,
  file_ids: z.array(FileIdSchema).min(2),
  status: z.literal('DUPLICATE_CANDIDATE'),
  requires_review: z.literal(true),
}).strict();

export const ClassifyDataSchema = z.object({
  files: z.array(ClassifyFileSchema),
  repeated_doc_types: z.array(RepeatedDocTypeSchema),
}).strict().superRefine((d, ctx) => {
  const ids = d.files.map((f) => f.file_id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['files'], message: 'file_id trùng (S1-R13)' });
  }
});
export type ClassifyData = z.infer<typeof ClassifyDataSchema>;

const Count = z.number().int().min(0);
export const ClassifyPreviewSchema = z.object({
  file_count: Count, classified_count: Count, unknown_count: Count, blocked_count: Count, match_count: Count,
}).strict();

export const ClassifyStageResultSchema = StageResultSchema('classify', ClassifyDataSchema, ClassifyPreviewSchema);
export type ClassifyStageResult = z.infer<typeof ClassifyStageResultSchema>;

// ── S2 extract_evidence (S2 §2) ─────────────────────────────────────────────
export const ExtractDataSchema = z.object({
  evidences: z.array(EvidenceEnvelopeSchema),
}).strict().superRefine((d, ctx) => {
  const ids = d.evidences.map((e) => e.evidence_id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['evidences'], message: 'evidence_id trùng (S2-R14)' });
  }
});
export type ExtractData = z.infer<typeof ExtractDataSchema>;

export const ExtractPreviewSchema = z.object({
  evidence_count: Count, success_count: Count, error_count: Count, duplicate_group_count: Count,
}).strict();

export const ExtractStageResultSchema = StageResultSchema('extract_evidence', ExtractDataSchema, ExtractPreviewSchema);
export type ExtractStageResult = z.infer<typeof ExtractStageResultSchema>;
