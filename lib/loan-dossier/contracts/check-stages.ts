// Hợp đồng `data` của S3, S4, S5 (T-CON-02). Tên field lấy đúng mục Output của S3 §2, S4 §2, S5 §2.
// S6 (`compare_ocr_sl`) KHÔNG có ở đây: trên nền v2 S6 không áp dụng (D-32, v2_integration §1).
//
// Mức chặt:
// - Field mà mục Output liệt kê tên → khai báo đủ, `.strict()` (D-05).
// - Phần tử mảng mà spec chỉ nêu tên mảng, chưa liệt kê field con (VD `mapped_evidences[]`, `sources[]`,
//   `condition_evaluations[]`) → `OpenEntrySchema` (object bất kỳ). Engine S3–S5 (C4) chốt shape rồi siết
//   lại ở đây cùng task của engine; không bịa field trước khi spec có.
import { z } from 'zod';

import { isReasonCode } from '../catalog';
import {
  AddressSchema, AssetIdentifiersSchema, DateStringSchema, DocTypeKeySchema, EvidenceIdSchema, FileIdSchema,
  NullableDateSchema, PercentSchema, catalogEnum, catalogEnumStrict,
} from '../s2/common-schema';
import { StageResultSchema } from './stage-result';

const Count = z.number().int().min(0);
const PersonIdSchema = z.string().regex(/^person-\d+$/, 'person_id phải là person-{n}');
const AssetIdSchema = z.string().regex(/^asset-\d+$/, 'asset_id phải là asset-{n}');
/** Object chưa chốt field con trong spec — xem ghi chú đầu file. */
const OpenEntrySchema = z.record(z.string(), z.unknown());

function reasonCodeOf(scope: 'MAP' | 'CHK' | 'XCK') {
  return z.string().refine((c) => isReasonCode(c, scope), `mã không có trong reason_codes.json (scope ${scope})`);
}

const RoleSchema = catalogEnumStrict('Role');
const SeveritySchema = catalogEnumStrict('Severity');
type Issue = (path: Array<string | number>, message: string) => void;
const issuer = (ctx: z.RefinementCtx): Issue => (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

// ── S3 map_dossier_roles ────────────────────────────────────────────────────
export const IdNumberCheckSchema = z.object({
  status: catalogEnumStrict('IdNumberCheckStatus'),
  severity: SeveritySchema,
  requires_review: z.boolean(),
  reason_code: reasonCodeOf('MAP').nullable(),
}).strict();

export const RoleRegistryEntrySchema = z.object({
  person_id: PersonIdSchema,
  roles: z.array(RoleSchema).min(1),
  primary_role: RoleSchema,
  other_role_detail: catalogEnumStrict('OtherRoleDetail').nullable(),
  full_name: z.string().nullable(),
  declared_id_number: z.string().nullable(),
  current_id_number: z.string().nullable(),
  historical_id_numbers: z.array(z.string()),
  observed_id_numbers: z.array(z.string()),
  id_number_check: IdNumberCheckSchema,
  id_number_sources: z.array(OpenEntrySchema),
  role_conflict: z.boolean(),
  role_conflict_details: z.array(OpenEntrySchema),
  mapped_evidences: z.array(OpenEntrySchema),
}).strict().superRefine((p, ctx) => {
  const issue = issuer(ctx);
  if (!p.roles.includes(p.primary_role)) issue(['primary_role'], 'primary_role phải thuộc roles');
  const main = p.roles.some((r) => r !== 'other');
  if (main && p.roles.includes('other')) issue(['roles'], 'người có vai trò chính không giữ other (S3-R02)');
  if ((p.other_role_detail !== null) !== (p.primary_role === 'other')) issue(['other_role_detail'], 'chỉ có khi primary_role = other');
  const observed = new Set(p.observed_id_numbers);
  const mustObserve = [...p.historical_id_numbers, ...(p.current_id_number ? [p.current_id_number] : [])];
  if (mustObserve.some((n) => !observed.has(n))) issue(['observed_id_numbers'], 'observed ⊇ historical ∪ {current}');
  if (p.role_conflict && p.current_id_number !== null) issue(['current_id_number'], 'role_conflict → current_id_number = null (S3-R11)');
  if (p.role_conflict !== (p.role_conflict_details.length > 0)) issue(['role_conflict_details'], 'có phần tử khi và chỉ khi role_conflict');
});

export const UnmappedEvidenceSchema = z.object({
  evidence_id: EvidenceIdSchema,
  file_id: FileIdSchema,
  file_name: z.string(),
  doc_type_key: DocTypeKeySchema,
  party_index: z.number().int().min(0).nullable(),
  full_name: z.string().nullable(),
  id_number: z.string().nullable(),
  reason_code: z.enum(['NO_IDENTITY_MATCH', 'NAME_SPELLING_DIFFERENCE', 'NO_IDENTITY_FIELDS', 'AMBIGUOUS_IDENTITY_MATCH']),
  message: z.string().nullable(),
}).strict().superRefine((u, ctx) => {
  if ((u.party_index === null) !== (u.reason_code === 'NO_IDENTITY_FIELDS')) {
    issuer(ctx)(['party_index'], 'party_index = null khi và chỉ khi NO_IDENTITY_FIELDS (S3-R10c)');
  }
});

export const AssetRegistryEntrySchema = z.object({
  asset_id: AssetIdSchema,
  asset_type: catalogEnumStrict('AssetType'),
  identifiers: AssetIdentifiersSchema,
  owner_person_ids: z.array(PersonIdSchema),
  current_owner_person_ids: z.array(PersonIdSchema),
  usage_contexts: z.array(catalogEnumStrict('UsageContext')),
  context_status: catalogEnumStrict('ContextStatus'),
  context_reason_code: z.enum(['ASSET_CONTEXT_AMBIGUOUS', 'ASSET_IDENTIFIER_CONFLICT']).nullable(),
  sources: z.array(OpenEntrySchema),
  identifier_conflicts: z.array(OpenEntrySchema),
}).strict().superRefine((a, ctx) => {
  const issue = issuer(ctx);
  if ((a.context_status === 'CONFIRMED') !== (a.context_reason_code === null)) {
    issue(['context_reason_code'], 'CONFIRMED ↔ context_reason_code = null (S3-R19)');
  }
  if (a.usage_contexts.length === 0 && a.context_status !== 'UNRESOLVED') issue(['context_status'], 'usage_contexts = [] → UNRESOLVED (S3-R19)');
  if (a.identifier_conflicts.some((c) => (c as { probable_ocr_error?: boolean }).probable_ocr_error !== true) && a.context_status === 'CONFIRMED') {
    issue(['context_status'], 'có identifier_conflicts (không phải nghi lỗi đọc) → không CONFIRMED');
  }
  const order = ['collateral', 'rental_income'];
  const sorted = [...a.usage_contexts].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  if (new Set(a.usage_contexts).size !== a.usage_contexts.length || sorted.join() !== a.usage_contexts.join()) {
    issue(['usage_contexts'], 'không trùng, sắp theo collateral, rental_income (S3-R18)');
  }
});

export const RelationshipVerificationSchema = z.object({
  subject_person_id: PersonIdSchema,
  collateral_owner_person_id: PersonIdSchema,
  relationship_type: catalogEnum('RelationshipType'),
  relationship_raw: z.string().nullable(),
  required_count: z.number().int().min(1).nullable(),
  verified_count: Count,
  verified_documents: z.array(OpenEntrySchema),
}).strict().superRefine((r, ctx) => {
  if (r.verified_count !== r.verified_documents.length) issuer(ctx)(['verified_count'], 'verified_count = verified_documents.length');
});

/** `identity` theo S3-R22. */
export const Customer360IdentitySchema = z.object({
  full_name: z.string().nullable(),
  id_number: z.string().nullable(),
  date_of_birth: NullableDateSchema,
  gender: catalogEnum('Gender'),
  permanent_address: AddressSchema.nullable(),
  current_address: AddressSchema.nullable(),
}).strict();

/** Thông tin pháp nhân của một "người" `party_type = ORGANIZATION` (SME). Chỉ có ở pháp nhân; cá nhân không có khóa này. */
export const OrganizationInfoSchema = z.object({
  tax_id: z.string().nullable(),
  registration_number: z.string().nullable(),
  headquarters_address: AddressSchema.nullable(),
  representative_name: z.string().nullable(),
  representative_position: z.string().nullable(),
  /** Người đại diện đã gom được trong registry; null khi không có hoặc khớp nhiều người. */
  representative_person_id: PersonIdSchema.nullable(),
}).strict();

export const Customer360EntrySchema = z.object({
  person_id: PersonIdSchema,
  roles: z.array(RoleSchema).min(1),
  identity: Customer360IdentitySchema,
  marital_status: catalogEnum('MaritalStatus'),
  spouse_person_id: PersonIdSchema.nullable(),
  /** `business_info` của `loan_application` (S3-R22) — shape theo schema chứng từ. */
  business: OpenEntrySchema.nullable(),
  owned_asset_ids: z.array(AssetIdSchema),
  /** Chỉ pháp nhân (SME). Tùy chọn để output của HKD không đổi. */
  organization: OrganizationInfoSchema.optional(),
}).strict();

export const SupersededEvidenceSchema = z.object({
  evidence_id: EvidenceIdSchema,
  doc_type_key: DocTypeKeySchema,
  person_id: PersonIdSchema.nullable(),
  asset_id: AssetIdSchema.nullable(),
  issue_date: NullableDateSchema,
  superseded_by_evidence_ids: z.array(EvidenceIdSchema).min(1),
  reason_code: z.literal('DOCUMENT_EXPIRED'),
}).strict();

export const MapDossierDataSchema = z.object({
  role_registry: z.array(RoleRegistryEntrySchema),
  unmapped_evidences: z.array(UnmappedEvidenceSchema),
  asset_registry: z.array(AssetRegistryEntrySchema),
  relationship_verifications: z.array(RelationshipVerificationSchema),
  customer_360: z.array(Customer360EntrySchema),
  superseded_evidences: z.array(SupersededEvidenceSchema),
}).strict().superRefine((d, ctx) => {
  const issue = issuer(ctx);
  const persons = new Set(d.role_registry.map((p) => p.person_id));
  const assets = new Set(d.asset_registry.map((a) => a.asset_id));
  if (persons.size !== d.role_registry.length) issue(['role_registry'], 'person_id trùng');
  if (assets.size !== d.asset_registry.length) issue(['asset_registry'], 'asset_id trùng');
  const person = (path: Array<string | number>, id: string | null) => { if (id !== null && !persons.has(id)) issue(path, `${id} không có trong role_registry`); };
  const asset = (path: Array<string | number>, id: string | null) => { if (id !== null && !assets.has(id)) issue(path, `${id} không có trong asset_registry`); };

  d.asset_registry.forEach((a, i) => {
    a.owner_person_ids.forEach((id, j) => person(['asset_registry', i, 'owner_person_ids', j], id));
    a.current_owner_person_ids.forEach((id, j) => person(['asset_registry', i, 'current_owner_person_ids', j], id));
  });
  d.relationship_verifications.forEach((r, i) => {
    person(['relationship_verifications', i, 'subject_person_id'], r.subject_person_id);
    person(['relationship_verifications', i, 'collateral_owner_person_id'], r.collateral_owner_person_id);
  });
  if (d.customer_360.length !== d.role_registry.length) issue(['customer_360'], 'cùng số phần tử với role_registry');
  d.customer_360.forEach((c, i) => {
    if (d.role_registry[i] && c.person_id !== d.role_registry[i].person_id) issue(['customer_360', i, 'person_id'], 'cùng thứ tự role_registry (S3-R22)');
    person(['customer_360', i, 'spouse_person_id'], c.spouse_person_id);
    c.owned_asset_ids.forEach((id, j) => asset(['customer_360', i, 'owned_asset_ids', j], id));
    if (c.organization) {
      person(['customer_360', i, 'organization', 'representative_person_id'], c.organization.representative_person_id);
      // Pháp nhân không có vợ/chồng: tránh nối nhầm người đại diện thành "vợ/chồng của công ty".
      if (c.spouse_person_id !== null) issue(['customer_360', i, 'spouse_person_id'], 'pháp nhân không có vợ/chồng');
      if (c.organization.representative_person_id === c.person_id) issue(['customer_360', i, 'organization', 'representative_person_id'], 'người đại diện không thể là chính pháp nhân');
    }
  });
  const supersededIds = new Set(d.superseded_evidences.map((s) => s.evidence_id));
  d.superseded_evidences.forEach((s, i) => {
    person(['superseded_evidences', i, 'person_id'], s.person_id);
    asset(['superseded_evidences', i, 'asset_id'], s.asset_id);
    s.superseded_by_evidence_ids.forEach((id, j) => {
      // Bản thay thế phải còn hạn → không thể đồng thời bị thay thế (S3 §2 ràng buộc nhất quán).
      if (supersededIds.has(id)) issue(['superseded_evidences', i, 'superseded_by_evidence_ids', j], 'bản thay thế không được nằm trong superseded_evidences');
    });
  });
});
export type MapDossierData = z.infer<typeof MapDossierDataSchema>;

export const MapDossierPreviewSchema = z.object({
  person_count: Count, mapped_evidence_count: Count, unmapped_party_count: Count, role_conflict_count: Count,
  id_review_count: Count, asset_count: Count, unconfirmed_asset_count: Count, relationship_verification_count: Count,
}).strict();

export const MapDossierStageResultSchema = StageResultSchema('map_dossier_roles', MapDossierDataSchema, MapDossierPreviewSchema);

// ── S4 check_checklist ──────────────────────────────────────────────────────
export const ChecklistFoundInSchema = z.object({
  evidence_id: EvidenceIdSchema,
  file_id: FileIdSchema,
  file_name: z.string(),
  page: z.number().int().min(1).nullable(),
  field_path: z.string().nullable(),
}).strict();

export const ChecklistItemResultSchema = z.object({
  item_key: z.string().min(1),
  checklist_group: catalogEnumStrict('ChecklistGroup'),
  checklist_subgroup: catalogEnum('ChecklistSubgroup'),
  item_no: z.number().int().min(1),
  item_label: z.string(),
  doc_type_key: DocTypeKeySchema.nullable(),
  scope: catalogEnumStrict('ChecklistScope'),
  person_id: PersonIdSchema.nullable(),
  roles: z.array(RoleSchema),
  primary_role: RoleSchema.nullable(),
  asset_id: AssetIdSchema.nullable(),
  usage_context: catalogEnumStrict('UsageContext').nullable(),
  context_status: catalogEnumStrict('ContextStatus').nullable(),
  required: z.boolean(),
  status: catalogEnumStrict('ChecklistItemStatus'),
  reason_code: reasonCodeOf('CHK').nullable(),
  message: z.string().nullable(),
  substituted_by_item_key: z.string().nullable(),
  substituted_by_doc_type_key: DocTypeKeySchema.nullable(),
  found_in: z.array(ChecklistFoundInSchema),
  duplicate_group_ids: z.array(z.string().regex(/^dup-\d+$/)),
  duplicate_status: catalogEnum('DuplicateStatus'),
  condition_id: z.string().nullable(),
  condition_source: catalogEnum('ConditionSource'),
  condition_result: catalogEnum('ConditionResult'),
  validity_days: z.number().int().min(1).nullable(),
  expired_evidence_ids: z.array(EvidenceIdSchema),
  relationship_checks: z.array(OpenEntrySchema),
  original_or_copy: catalogEnum('OriginalOrCopy'),
  suggested_action: catalogEnumStrict('ChecklistSuggestedAction'),
  note: z.string().nullable(),
}).strict().superRefine((it, ctx) => {
  const issue = issuer(ctx);
  const subst = it.substituted_by_item_key !== null && it.substituted_by_doc_type_key !== null;
  if (it.status === 'SUBSTITUTED' && !subst) issue(['substituted_by_item_key'], 'SUBSTITUTED → bắt buộc substituted_by_item_key và substituted_by_doc_type_key');
  if (it.status !== 'SUBSTITUTED' && (it.substituted_by_item_key !== null || it.substituted_by_doc_type_key !== null)) {
    issue(['substituted_by_item_key'], 'chỉ có khi SUBSTITUTED');
  }
  const cond = [it.condition_id, it.condition_source, it.condition_result];
  if (!cond.every((v) => v === null) && !cond.every((v) => v !== null)) issue(['condition_id'], 'condition_id, condition_source, condition_result cùng null hoặc cùng có giá trị');
  if (it.scope !== 'PERSON' && (it.person_id !== null || it.roles.length > 0 || it.primary_role !== null)) issue(['person_id'], 'person_id, roles, primary_role chỉ ở dòng PERSON');
  if (it.scope !== 'ASSET' && (it.asset_id !== null || it.usage_context !== null || it.context_status !== null)) issue(['asset_id'], 'asset_id, usage_context, context_status chỉ ở dòng ASSET');
  if ((it.duplicate_status === null) !== (it.duplicate_group_ids.length === 0)) issue(['duplicate_status'], 'duplicate_status khác null khi và chỉ khi có duplicate_group_ids');
});
export type ChecklistItemResult = z.infer<typeof ChecklistItemResultSchema>;

export const ChecklistGroupSummarySchema = z.object({
  checklist_group: catalogEnumStrict('ChecklistGroup'),
  total_items: Count,
  total_required: Count,
  present_count: Count,
  substituted_count: Count,
  missing_count: Count,
  needs_rescan_count: Count,
  needs_review_count: Count,
  not_required_count: Count,
  /** `null` khi nhóm không có dòng bắt buộc (S4 quy ước đếm). */
  completeness_percent: PercentSchema.nullable(),
}).strict();

/** Đếm theo quy ước S4 §2 (chỉ dòng `required` cho 5 trạng thái). */
export function countChecklist(items: readonly Pick<ChecklistItemResult, 'required' | 'status'>[]) {
  const req = items.filter((i) => i.required);
  const n = (s: string) => req.filter((i) => i.status === s).length;
  const present = n('PRESENT');
  const substituted = n('SUBSTITUTED');
  return {
    total_items: items.length,
    total_required: req.length,
    present_count: present,
    substituted_count: substituted,
    missing_count: n('MISSING'),
    needs_rescan_count: n('NEEDS_RESCAN'),
    needs_review_count: n('NEEDS_REVIEW'),
    not_required_count: items.length - req.length,
    completeness_percent: req.length === 0 ? null : roundHalfUp2(((present + substituted) / req.length) * 100),
  };
}

/** `round_half_up(x, 2)`; bù sai số dấu phẩy động (VD 1/3·100). */
export function roundHalfUp2(x: number): number {
  return Math.floor(x * 100 + 0.5 + 1e-9) / 100;
}

/** Khóa luồng của chương trình checklist (S4-R24): viết HOA, VD FULL/FAST/SIMPLE hoặc A/B. */
const FlowKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const FlowReqSchema = z.enum(['REQUIRED', 'CONDITIONAL', 'NOT_REQUIRED']).nullable();

export const CheckChecklistDataSchema = z.object({
  flow: FlowKeySchema,
  program_key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  product_code: z.string().min(1),
  /** Ghi đè mức yêu cầu từ Profile thực sự làm đổi kết quả của lần chạy (S4-R25). */
  overrides_applied: z.array(z.object({
    item_key: z.string(), flow: FlowKeySchema, from: FlowReqSchema, to: FlowReqSchema,
  }).strict()),
  dossier_submitted_at: DateStringSchema,
  catalog_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  subject_mapping_available: z.boolean(),
  asset_mapping_available: z.boolean(),
  completeness_percent: PercentSchema,
  items: z.array(ChecklistItemResultSchema),
  summary_by_group: z.array(ChecklistGroupSummarySchema),
  condition_evaluations: z.array(OpenEntrySchema),
  excluded_evidences: z.array(OpenEntrySchema),
}).strict().superRefine((d, ctx) => {
  const issue = issuer(ctx);
  const all = countChecklist(d.items);
  const expected = all.completeness_percent ?? 100;
  if (Math.abs(d.completeness_percent - expected) > 1e-9) issue(['completeness_percent'], `phải là ${expected} theo items[]`);
  d.summary_by_group.forEach((g, i) => {
    const c = countChecklist(d.items.filter((it) => it.checklist_group === g.checklist_group));
    for (const [k, v] of Object.entries(c)) {
      const got = g[k as keyof typeof c];
      if (got !== v && !(typeof got === 'number' && typeof v === 'number' && Math.abs(got - v) < 1e-9)) {
        issue(['summary_by_group', i, k], `phải là ${v} theo items[] của nhóm`);
      }
    }
  });
  const groups = d.summary_by_group.map((g) => g.checklist_group);
  if (new Set(groups).size !== groups.length) issue(['summary_by_group'], 'checklist_group trùng');
});
export type CheckChecklistData = z.infer<typeof CheckChecklistDataSchema>;

export const CheckChecklistPreviewSchema = z.object({
  flow: FlowKeySchema,
  program_key: z.string(),
  completeness_percent: PercentSchema,
  subject_mapping_available: z.boolean(),
  asset_mapping_available: z.boolean(),
  persons_evaluated: Count,
  total_required: Count,
  missing_count: Count,
  needs_rescan_count: Count,
  needs_review_count: Count,
}).strict();

export const CheckChecklistStageResultSchema = StageResultSchema('check_checklist', CheckChecklistDataSchema, CheckChecklistPreviewSchema);

// ── S5 cross_check_documents ────────────────────────────────────────────────
export const CrossCheckSourceSchema = z.object({
  evidence_id: EvidenceIdSchema,
  file_id: FileIdSchema,
  file_name: z.string(),
  doc_type_key: DocTypeKeySchema,
  field_path: z.string().regex(/^data\./, 'field_path bắt đầu bằng data.'),
  page: z.number().int().min(1).nullable(),
}).strict();

const ScalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const CrossCheckValueSchema = z.object({
  value: z.union([ScalarValueSchema, OpenEntrySchema]),
  normalized_value: ScalarValueSchema,
  id_status: catalogEnumStrict('IdStatus').nullable(),
  metric: z.string().nullable(),
  period: catalogEnum('MetricPeriod'),
  unit: catalogEnum('MetricUnit'),
  source: CrossCheckSourceSchema,
  duplicate_group_id: z.string().regex(/^dup-\d+$/).nullable(),
  duplicate_status: catalogEnum('DuplicateStatus'),
}).strict();

export const CanonicalSourceSchema = z.object({
  rule: catalogEnumStrict('CanonicalSourceRule'),
  doc_type_key: DocTypeKeySchema.nullable(),
  evidence_id: EvidenceIdSchema.nullable(),
}).strict();

export const CrossCheckResultSchema = z.object({
  result_id: z.string().regex(/^xck-\d+$/, 'result_id phải là xck-{n}'),
  person_id: PersonIdSchema.nullable(),
  primary_role: RoleSchema.nullable(),
  roles: z.array(RoleSchema),
  asset_id: AssetIdSchema.nullable(),
  field_group: z.string().min(1),
  field_label: z.string(),
  sub_field: z.string().nullable(),
  comparison_method: catalogEnumStrict('ComparisonMethod'),
  match_status: catalogEnumStrict('CrossCheckMatchStatus'),
  reason_code: reasonCodeOf('XCK').nullable(),
  severity: SeveritySchema,
  requires_review: z.boolean(),
  values: z.array(CrossCheckValueSchema).min(2, 'values ≥ 2 nguồn (S5-R04)'),
  canonical_source: CanonicalSourceSchema.nullable(),
  reason: z.string().min(1, 'reason bắt buộc'),
}).strict().superRefine((r, ctx) => {
  const issue = issuer(ctx);
  if (r.person_id === null && r.roles.length > 0) issue(['roles'], 'dòng không theo người → roles = []');
  if (r.primary_role !== null && !r.roles.includes(r.primary_role)) issue(['primary_role'], 'primary_role phải thuộc roles');
  if (new Set(r.values.map((v) => v.source.evidence_id)).size < 2) issue(['values'], 'giá trị từ ≥ 2 evidence khác nhau (S5-R04)');
});
export type CrossCheckResult = z.infer<typeof CrossCheckResultSchema>;

export const LogicFindingSchema = z.object({
  finding_id: z.string().min(1),
  rule_key: z.string().min(1),
  person_id: PersonIdSchema.nullable(),
  asset_id: AssetIdSchema.nullable(),
  evidence_ids: z.array(EvidenceIdSchema),
  violated: z.boolean(),
  severity: SeveritySchema,
  requires_review: z.boolean(),
  needs_ba_confirmation: z.boolean(),
  message: z.string(),
}).strict();

export const SkippedEvidenceSchema = z.object({
  evidence_id: EvidenceIdSchema,
  doc_type_key: DocTypeKeySchema,
  skip_reason: z.enum(['EVIDENCE_ERROR', 'UNMAPPED', 'ROLE_CONFLICT', 'SUPERSEDED']),
}).strict();

export const CrossCheckDataSchema = z.object({
  matrix_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  results: z.array(CrossCheckResultSchema),
  logic_findings: z.array(LogicFindingSchema),
  skipped_evidences: z.array(SkippedEvidenceSchema),
}).strict().superRefine((d, ctx) => {
  const ids = d.results.map((r) => r.result_id);
  if (new Set(ids).size !== ids.length) issuer(ctx)(['results'], 'result_id trùng');
});
export type CrossCheckData = z.infer<typeof CrossCheckDataSchema>;

export const CrossCheckPreviewSchema = z.object({
  total_comparisons: Count, match_count: Count, near_match_count: Count, mismatch_count: Count, undetermined_count: Count,
  requires_review_count: Count, high_severity_count: Count, logic_violation_count: Count,
  persons_compared: Count, assets_compared: Count,
}).strict().superRefine((p, ctx) => {
  if (p.match_count + p.near_match_count + p.mismatch_count + p.undetermined_count !== p.total_comparisons) {
    issuer(ctx)(['total_comparisons'], 'match + near_match + mismatch + undetermined = total_comparisons');
  }
});

export const CrossCheckStageResultSchema = StageResultSchema('cross_check_documents', CrossCheckDataSchema, CrossCheckPreviewSchema);

export type MapDossierStageResult = z.infer<typeof MapDossierStageResultSchema>;
export type CheckChecklistStageResult = z.infer<typeof CheckChecklistStageResultSchema>;
export type CrossCheckStageResult = z.infer<typeof CrossCheckStageResultSchema>;
