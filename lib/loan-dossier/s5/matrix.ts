// Nạp và kiểm tra ma trận đối chiếu chéo (T-S5-01; S5-R01).
import { z } from 'zod';

import { docTypeByKey, parseCatalogFile } from '../catalog';
import raw from '../catalog/data/cross_check_matrix.json';

const SourceSchema = z.object({
  doc_type_key: z.string(),
  field_path: z.string().regex(/^data\./, 'field_path phải bắt đầu bằng data.'),
  attribution: z.enum(['PARTY', 'SUBJECT_PARTY_ROLE', 'PARTY_INDEX_FIELD', 'ASSET', 'ASSET_INDEX_FIELD', 'DOCUMENT']),
  party_roles: z.array(z.string()).nullable().optional(),
  index_field_path: z.string().nullable(),
  filter: z.object({ relative_path: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]), include_when_null: z.boolean() }).strict().nullable(),
  metric: z.string().nullable(),
  period: z.string().nullable(),
  unit: z.string().nullable(),
}).strict();
export type MatrixSource = z.infer<typeof SourceSchema>;

const CanonicalSchema = z.object({ rule: z.string(), preferred_doc_type_keys: z.array(z.string()) }).strict();
export type MatrixCanonical = z.infer<typeof CanonicalSchema>;

const SubFieldSchema = z.object({
  sub_field: z.string().nullable(),
  field_label: z.string(),
  comparison_method: z.enum(['EXACT', 'SEMANTIC', 'ADDRESS_REFERENCE', 'METRIC']),
  canonical_source: CanonicalSchema.nullable(),
  sources: z.array(SourceSchema).min(1),
}).strict();
export type MatrixSubField = z.infer<typeof SubFieldSchema>;

const GroupSchema = z.object({
  field_group: z.string(),
  field_label: z.string(),
  scope: z.enum(['PERSON', 'ASSET', 'PERSON_ASSET', 'DOSSIER']),
  applicable_roles: z.array(z.string()),
  asset_owner_roles: z.array(z.string()),
  asset_types: z.array(z.string()),
  canonical_source: CanonicalSchema,
  sub_fields: z.array(SubFieldSchema).min(1),
}).strict();
export type MatrixGroup = z.infer<typeof GroupSchema>;

const LogicRuleSchema = z.object({
  rule_key: z.string(),
  rule_label: z.string(),
  scope: z.enum(['PERSON', 'ASSET', 'DOSSIER']),
  severity_when_violated: z.enum(['INFO', 'REVIEW', 'HIGH']),
  inputs: z.array(z.object({ doc_type_key: z.string(), field_path: z.string(), attribution: z.string(), party_roles: z.array(z.string()).optional() }).strict()),
  condition: z.string(),
  message: z.string(),
  needs_ba_confirmation: z.boolean(),
}).strict();
export type MatrixLogicRule = z.infer<typeof LogicRuleSchema>;

export const MatrixFileSchema = z.object({
  catalog_key: z.string(),
  catalog_version: z.string(),
  stage_key: z.literal('cross_check_documents'),
  description: z.string(),
  role_priority: z.array(z.string()),
  role_labels: z.record(z.string(), z.string()),
  field_groups: z.array(GroupSchema).min(1),
  logic_rules: z.array(LogicRuleSchema),
}).strict().superRefine((m, ctx) => {
  m.field_groups.forEach((g, gi) => g.sub_fields.forEach((f, fi) => f.sources.forEach((s, si) => {
    const dt = docTypeByKey(s.doc_type_key);
    const path = ['field_groups', gi, 'sub_fields', fi, 'sources', si, 'doc_type_key'];
    if (!dt) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `doc_type_key lạ ${s.doc_type_key}` });
    else if (!dt.needs_extraction) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `${s.doc_type_key} không bóc tách đầy đủ` });
  })));
});
export type Matrix = z.infer<typeof MatrixFileSchema>;

let cache: Matrix | null = null;

export function loadMatrix(): Matrix {
  if (!cache) cache = parseCatalogFile('cross_check_matrix.json', raw, MatrixFileSchema);
  return cache;
}
