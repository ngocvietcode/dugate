// Hợp đồng `master_dossier` (T-MD-01; master_dossier.md §4, MD-R01, MD-R12).
import { z } from 'zod';

export const MASTER_FIELD_STATUSES = ['AGREED', 'OCR_NORMALIZED', 'SINGLE_SOURCE', 'CONFLICT', 'MISSING', 'CORRECTED'] as const;
export const MASTER_COPY_ROLES = ['PRIMARY', 'DUPLICATE', 'SUPERSEDED', 'EXCLUDED'] as const;
export const MASTER_FIELD_KINDS = ['code', 'id', 'plate', 'name', 'text', 'address', 'money', 'number', 'date', 'enum', 'boolean'] as const;

export type MasterFieldStatus = typeof MASTER_FIELD_STATUSES[number];
export type MasterCopyRole = typeof MASTER_COPY_ROLES[number];
export type MasterFieldKind = typeof MASTER_FIELD_KINDS[number];

const ReviewStatus = z.enum(['ACCEPTED', 'REVIEW']);
const RecordId = z.string().regex(/^ev-[0-9a-f]{12}#.+$/, 'evidence record id dạng ev-…#<field_path> (V2-R04)');

export const MasterCandidateSchema = z.object({ value: z.unknown(), evidence_ids: z.array(RecordId).min(1) }).strict();
export const MasterOutlierSchema = z.object({
  evidence_id: RecordId, raw_value: z.unknown(), reason_code: z.literal('PROBABLE_OCR_ERROR'),
}).strict();

/** MD-R17 (D-67, D-69): trường `CONFLICT` được LLM chọn lại trong các giá trị đã đọc. */
export const MasterCorrectionSchema = z.object({
  method: z.literal('LLM_SELECTED_CANDIDATE'),
  proposal_id: z.string().regex(/^mc-[0-9a-f]{12}$/),
  original: z.object({ status: z.literal('CONFLICT'), value: z.unknown() }).strict(),
  distance: z.number().int().min(0),
  minority: z.array(z.object({ evidence_id: RecordId, raw_value: z.unknown() }).strict()),
  reason: z.string(),
}).strict();
export type MasterCorrection = z.infer<typeof MasterCorrectionSchema>;

const fieldShape = {
  path: z.string().min(1),
  label: z.string(),
  kind: z.enum(MASTER_FIELD_KINDS),
  value: z.unknown(),
  status: z.enum(MASTER_FIELD_STATUSES),
  review_status: ReviewStatus,
  confidence: z.number().min(0).max(1).nullable(),
  sources: z.array(RecordId),
  candidates: z.array(MasterCandidateSchema),
  outliers: z.array(MasterOutlierSchema),
  note: z.string().nullable(),
  correction: MasterCorrectionSchema.optional(),
};

type FieldLike = { value: unknown; status: MasterFieldStatus; review_status: string; sources: string[]; candidates: unknown[]; outliers: unknown[]; note: string | null; correction?: unknown };

/** Ràng buộc chung; `conflictValueNull` chỉ áp cho trường của chứng từ (thực thể giữ giá trị canonical, MD-R08). */
function refineField(f: FieldLike, ctx: z.RefinementCtx, conflictValueNull: boolean): void {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  const empty = f.value === null || f.value === undefined;
  if (f.status === 'CONFLICT') {
    if (conflictValueNull && !empty) issue('value', 'CONFLICT → value = null');
    if (f.candidates.length < 2) issue('candidates', 'CONFLICT → candidates ≥ 2');
    if (f.review_status !== 'REVIEW') issue('review_status', 'CONFLICT → REVIEW');
  }
  if (f.status === 'OCR_NORMALIZED') {
    if (f.outliers.length < 1) issue('outliers', 'OCR_NORMALIZED → outliers ≥ 1');
    if (!f.note) issue('note', 'OCR_NORMALIZED → note bắt buộc (MD-R07)');
  }
  if (f.status === 'MISSING') {
    if (!empty) issue('value', 'MISSING → value = null');
    if (f.sources.length > 0) issue('sources', 'MISSING → sources = []');
    if (f.review_status !== 'REVIEW') issue('review_status', 'MISSING → REVIEW');
  }
  if (f.status !== 'OCR_NORMALIZED' && f.outliers.length > 0) issue('outliers', 'chỉ OCR_NORMALIZED có outliers');
  if (f.status === 'CORRECTED') {
    if (!f.correction) issue('correction', 'CORRECTED → correction bắt buộc (MD-R17)');
    if (empty) issue('value', 'CORRECTED → value khác null');
    if (f.review_status !== 'REVIEW') issue('review_status', 'CORRECTED → REVIEW');
    if (f.candidates.length < 2) issue('candidates', 'CORRECTED → candidates ≥ 2');
    if (f.sources.length < 1) issue('sources', 'CORRECTED → sources ≥ 1');
    if (!f.note) issue('note', 'CORRECTED → note bắt buộc');
  } else if (f.correction) {
    issue('correction', 'chỉ CORRECTED có correction');
  }
}

export const MasterFieldSchema = z.object(fieldShape).strict().superRefine((f, ctx) => refineField(f as FieldLike, ctx, true));
export type MasterField = z.infer<typeof MasterFieldSchema>;

export const MasterEntityFieldSchema = z.object({
  ...fieldShape,
  canonical_doc_type_key: z.string().nullable(),
  cross_check_result_id: z.string().regex(/^xck-\d+$/).nullable(),
}).strict().superRefine((f, ctx) => refineField(f as FieldLike, ctx, false));
export type MasterEntityField = z.infer<typeof MasterEntityFieldSchema>;

export const MasterCopySchema = z.object({
  evidence_id: z.string().regex(/^ev-[0-9a-f]{12}$/),
  file_name: z.string(),
  page_range: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  role: z.enum(MASTER_COPY_ROLES),
  excluded_reason: z.string().nullable(),
}).strict().superRefine((c, ctx) => {
  if ((c.role === 'EXCLUDED') !== (c.excluded_reason !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['excluded_reason'], message: 'excluded_reason khác null khi và chỉ khi EXCLUDED' });
  }
});

export const MasterDocumentSchema = z.object({
  document_id: z.string().regex(/^mdoc-\d+$/),
  item_key: z.string().nullable(),
  item_label: z.string().nullable(),
  checklist_group: z.string().nullable(),
  required: z.boolean().nullable(),
  checklist_status: z.string().nullable(),
  doc_type_key: z.string().nullable(),
  doc_type_label: z.string().nullable(),
  person_id: z.string().nullable(),
  asset_id: z.string().nullable(),
  copies: z.array(MasterCopySchema),
  fields: z.array(MasterFieldSchema),
}).strict().superRefine((d, ctx) => {
  const primaries = d.copies.filter((c) => c.role === 'PRIMARY').length;
  if (primaries > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['copies'], message: 'tối đa 1 bản PRIMARY' });
  if (primaries === 0 && d.fields.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'không có bản PRIMARY → fields = []' });
});
export type MasterDocument = z.infer<typeof MasterDocumentSchema>;

export const MasterEntitySchema = z.object({
  entity_id: z.string().regex(/^(person|asset)-\d+$/),
  label: z.string(),
  fields: z.array(MasterEntityFieldSchema),
  document_ids: z.array(z.string().regex(/^mdoc-\d+$/)),
}).strict();
export type MasterEntity = z.infer<typeof MasterEntitySchema>;

const Count = z.number().int().min(0);
export const MasterDossierSchema = z.object({
  master_version: z.literal('1.0'),
  program_key: z.string().nullable(),
  product_code: z.string().nullable(),
  flow: z.string().nullable(),
  documents: z.array(MasterDocumentSchema),
  other_documents: z.array(MasterDocumentSchema),
  persons: z.array(MasterEntitySchema),
  assets: z.array(MasterEntitySchema),
  summary: z.object({
    documents_total: Count, documents_present: Count, fields_total: Count,
    agreed: Count, ocr_normalized: Count, single_source: Count, conflict: Count, missing: Count, corrected: Count,
  }).strict(),
}).strict().superRefine((m, ctx) => {
  const ids = [...m.documents, ...m.other_documents].map((d) => d.document_id);
  const expected = ids.map((_, i) => `mdoc-${i + 1}`);
  if (ids.join() !== expected.join()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['documents'], message: 'document_id liên tục mdoc-1… qua documents rồi other_documents (MD-R12)' });
});
export type MasterDossier = z.infer<typeof MasterDossierSchema>;
