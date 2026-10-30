// Hợp đồng hiệu chỉnh hồ sơ và tính lại (spec cross_cutting/case_corrections.md §4, COR-R14). Zod là nguồn duy nhất: kiểu suy ra từ đây.
// Không lưu trạng thái (COR-R01): hệ thống gọi giữ `case_input.json` và gửi lại; DUGate chỉ kiểm và áp trong bộ nhớ của lần chạy.
import { z } from 'zod';

import { ClassifyDataSchema } from '../contracts/stage-result';
import { EvidenceEnvelopeSchema, EvidenceIdSchema } from '../s2/common-schema';

export const CASE_INPUT_CONTRACT = 'loan-appraisal.case-input' as const;
export const CASE_INPUT_VERSION = '1.0' as const;
export const MAX_CORRECTIONS = 200;

/** `{evidence_id}#{field_path}` — cùng dạng LacSource.record_id / EvidenceRecord.evidence_id (V2-R04). */
export const RecordIdSchema = z.string().regex(/^ev-[0-9a-f]{12}#[^#\s]{1,300}$/, 'record_id phải là ev-{12 hex}#<field_path>');

const LeafValueSchema = z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()]);

export const CaseSealSchema = z.object({
  alg: z.literal('HMAC-SHA256'),
  key_id: z.literal('v1'),
  source_operation_id: z.string().min(1).max(100),
  product_code: z.string().min(1).max(100),
  flow: z.string().max(50).nullable(),
  workflow_version: z.string().min(1).max(50),
  mac: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const CaseDocumentsSchema = z.object({
  classify: ClassifyDataSchema,
  evidences: z.array(EvidenceEnvelopeSchema),
}).strict();

const CorrectionBase = {
  correction_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  /** Có thể chứa PII: không log, không vào prompt (COR-R12). */
  reason: z.string().trim().min(1).max(500),
  /** Mã người sửa ở hệ thống gọi; DUGate không xác minh. */
  corrected_by: z.string().trim().min(1).max(64),
  corrected_at: z.string().datetime({ offset: true }),
};

const OccurrenceSchema = z.object({ evidence_id: EvidenceIdSchema, index: z.number().int().min(0) }).strict();

export const OcrFixSchema = z.object({
  ...CorrectionBase,
  kind: z.literal('OCR_FIX'),
  record_id: RecordIdSchema,
  original_value: LeafValueSchema,
  value: LeafValueSchema,
}).strict();

export const FactResolutionSchema = z.object({
  ...CorrectionBase,
  kind: z.literal('FACT_RESOLUTION'),
  record_ids: z.array(RecordIdSchema).min(2).max(50),
  chosen_record_id: RecordIdSchema,
}).strict().refine((c) => c.record_ids.includes(c.chosen_record_id), { message: 'chosen_record_id phải thuộc record_ids', path: ['chosen_record_id'] });

export const SubjectLinkSchema = z.object({
  ...CorrectionBase,
  kind: z.enum(['SAME_SUBJECT', 'DIFFERENT_SUBJECT']),
  subject_kind: z.enum(['person', 'asset']),
  a: OccurrenceSchema,
  b: OccurrenceSchema,
}).strict().refine((c) => c.a.evidence_id !== c.b.evidence_id || c.a.index !== c.b.index, { message: 'a và b phải khác nhau', path: ['b'] });

export const CorrectionSchema = z.union([OcrFixSchema, FactResolutionSchema, SubjectLinkSchema]);

export const CaseInputSchema = z.object({
  contract: z.literal(CASE_INPUT_CONTRACT),
  contract_version: z.literal(CASE_INPUT_VERSION),
  documents: CaseDocumentsSchema,
  /** `result.dossier_precheck` của Operation nguồn; kiểu chi tiết do workflow kiểm (`isDossierPrecheck`). */
  dossier_precheck: z.record(z.string(), z.unknown()).nullable(),
  case_seal: CaseSealSchema,
  corrections: z.array(CorrectionSchema).max(MAX_CORRECTIONS),
}).strict().superRefine((c, ctx) => {
  const ids = c.corrections.map((x) => x.correction_id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['corrections'], message: 'correction_id trùng' });
});

export const CorrectionSkipCodeSchema = z.enum([
  'ORPHAN_EDIT', 'FIELD_NOT_EDITABLE', 'EDIT_ON_ERROR_EVIDENCE', 'EDIT_BASE_CHANGED', 'INVALID_VALUE',
  'LINK_ORPHAN', 'LINK_CONTRADICTS_ID', 'LINK_CYCLE',
  'RESOLUTION_ORPHAN', 'RESOLUTION_STALE',
  'DUPLICATE_TARGET',
]);

export type CaseSeal = z.infer<typeof CaseSealSchema>;
export type CaseDocuments = z.infer<typeof CaseDocumentsSchema>;
export type OcrFix = z.infer<typeof OcrFixSchema>;
export type FactResolution = z.infer<typeof FactResolutionSchema>;
export type SubjectLink = z.infer<typeof SubjectLinkSchema>;
export type Correction = z.infer<typeof CorrectionSchema>;
export type CaseInput = z.infer<typeof CaseInputSchema>;
export type CorrectionSkipCode = z.infer<typeof CorrectionSkipCodeSchema>;

export interface CorrectionReport {
  source_operation_id: string;
  applied: Array<{ correction_id: string; kind: Correction['kind'] }>;
  skipped: Array<{ correction_id: string; kind: Correction['kind']; code: CorrectionSkipCode }>;
}
