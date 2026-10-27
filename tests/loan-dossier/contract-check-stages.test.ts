// T-CON-02 — hợp đồng data của S3, S4, S5. S6 không áp dụng trên nền v2 (D-32) nên không có ở đây.
import {
  CheckChecklistDataSchema, CheckChecklistStageResultSchema, CrossCheckDataSchema, CrossCheckPreviewSchema,
  CrossCheckStageResultSchema, MapDossierDataSchema, MapDossierStageResultSchema, countChecklist, roundHalfUp2,
} from '@/lib/loan-dossier/contracts/check-stages';

import { FAKE_ID12, FAKE_NAME, makeAddress, makeIdentifiers } from './fixtures/build';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const EV1 = 'ev-00000000000a';
const EV2 = 'ev-00000000000b';
const FILE1 = 'file-00000000000a';

// ── fixture tối thiểu S3 ────────────────────────────────────────────────────
const S3 = {
  role_registry: [{
    person_id: 'person-1', roles: ['borrower', 'collateral_owner'], primary_role: 'borrower', other_role_detail: null,
    full_name: FAKE_NAME, declared_id_number: FAKE_ID12, current_id_number: FAKE_ID12,
    historical_id_numbers: [], observed_id_numbers: [FAKE_ID12],
    id_number_check: { status: 'CONSISTENT', severity: 'INFO', requires_review: false, reason_code: null },
    id_number_sources: [], role_conflict: false, role_conflict_details: [],
    mapped_evidences: [{ evidence_id: EV1, party_index: 0, matched_by: 'ANCHOR' }],
  }],
  unmapped_evidences: [],
  asset_registry: [{
    asset_id: 'asset-1', asset_type: 'real_estate', identifiers: makeIdentifiers({ certificate_number: 'BQ 000000' }),
    owner_person_ids: ['person-1'], current_owner_person_ids: ['person-1'], usage_contexts: ['collateral'],
    context_status: 'CONFIRMED', context_reason_code: null, sources: [{ evidence_id: EV2, asset_index: 0 }], identifier_conflicts: [],
  }],
  relationship_verifications: [],
  customer_360: [{
    person_id: 'person-1', roles: ['borrower', 'collateral_owner'],
    identity: { full_name: FAKE_NAME, id_number: FAKE_ID12, date_of_birth: '1990-01-01', gender: 'MALE', permanent_address: makeAddress(), current_address: null },
    marital_status: 'SINGLE', spouse_person_id: null, business: null, owned_asset_ids: ['asset-1'],
  }],
  superseded_evidences: [],
};

// ── fixture tối thiểu S4 ────────────────────────────────────────────────────
function item(overrides: Record<string, unknown> = {}) {
  return {
    item_key: 'legal_id_card', checklist_group: 'legal', checklist_subgroup: 'general', item_no: 1, item_label: 'CCCD',
    doc_type_key: 'id_card', scope: 'PERSON', person_id: 'person-1', roles: ['borrower'], primary_role: 'borrower',
    asset_id: null, usage_context: null, context_status: null, required: true, status: 'PRESENT',
    reason_code: 'DOCUMENT_FOUND', message: null, substituted_by_item_key: null, substituted_by_doc_type_key: null,
    found_in: [{ evidence_id: EV1, file_id: FILE1, file_name: 'ho-so-gia.pdf', page: 1, field_path: null }],
    duplicate_group_ids: [], duplicate_status: null, condition_id: null, condition_source: null, condition_result: null,
    validity_days: null, expired_evidence_ids: [], relationship_checks: [], original_or_copy: null, suggested_action: 'NONE', note: null,
    ...overrides,
  };
}
const S4_ITEMS = [item(), item({ item_key: 'legal_residence', item_no: 2, status: 'MISSING', reason_code: 'DOCUMENT_NOT_FOUND', found_in: [], suggested_action: 'UPLOAD' })];
const S4 = {
  flow: 'FULL', program_key: 'hkd_secured', product_code: 'hkd-loan', overrides_applied: [], dossier_submitted_at: '2026-10-14', catalog_version: '3.0.0',
  subject_mapping_available: true, asset_mapping_available: true, completeness_percent: 50,
  items: S4_ITEMS,
  summary_by_group: [{ checklist_group: 'legal', ...countChecklist(S4_ITEMS) }],
  condition_evaluations: [], excluded_evidences: [],
};

// ── fixture tối thiểu S5 ────────────────────────────────────────────────────
function value(evidenceId: string, v: string) {
  return {
    value: v, normalized_value: v, id_status: null, metric: null, period: null, unit: null,
    source: { evidence_id: evidenceId, file_id: FILE1, file_name: 'ho-so-gia.pdf', doc_type_key: 'id_card', field_path: 'data.parties[0].full_name', page: 1 },
    duplicate_group_id: null, duplicate_status: null,
  };
}
const S5_RESULT = {
  result_id: 'xck-1', person_id: 'person-1', primary_role: 'borrower', roles: ['borrower'], asset_id: null,
  field_group: 'identity_name', field_label: 'Họ tên', sub_field: null, comparison_method: 'EXACT',
  match_status: 'MATCH', reason_code: 'EXACT_MATCH', severity: 'INFO', requires_review: false,
  values: [value(EV1, FAKE_NAME), value(EV2, FAKE_NAME)],
  canonical_source: { rule: 'CURRENT_IDENTITY_DOCUMENT', doc_type_key: 'id_card', evidence_id: EV1 },
  reason: 'Họ tên khớp giữa 2 chứng từ.',
};
const S5 = {
  matrix_version: '3.0.0', results: [S5_RESULT],
  logic_findings: [{
    finding_id: 'lf-1', rule_key: 'collateral_owner_identity', person_id: 'person-1', asset_id: 'asset-1',
    evidence_ids: [EV1, EV2], violated: false, severity: 'INFO', requires_review: false, needs_ba_confirmation: false, message: 'Đạt.',
  }],
  skipped_evidences: [{ evidence_id: 'ev-00000000000c', doc_type_key: 'marital_status_confirmation', skip_reason: 'SUPERSEDED' }],
};

const stage = (stage_key: string, data: unknown, content_preview: unknown) => ({
  stage_key, status: 'SUCCESS', status_code: 'COMPLETED', message: null,
  started_at: '2026-10-14T03:00:00Z', finished_at: '2026-10-14T03:00:01Z', content_preview, data, blocking_inputs: [],
});

describe('contracts/check-stages (T-CON-02)', () => {
  it('S3, S4, S5: fixture tối thiểu parse qua (data và StageResult)', () => {
    expect(MapDossierDataSchema.safeParse(S3).success).toBe(true);
    expect(CheckChecklistDataSchema.safeParse(S4).success).toBe(true);
    expect(CrossCheckDataSchema.safeParse(S5).success).toBe(true);

    expect(MapDossierStageResultSchema.safeParse(stage('map_dossier_roles', S3, {
      person_count: 1, mapped_evidence_count: 1, unmapped_party_count: 0, role_conflict_count: 0,
      id_review_count: 0, asset_count: 1, unconfirmed_asset_count: 0, relationship_verification_count: 0,
    })).success).toBe(true);
    expect(CheckChecklistStageResultSchema.safeParse(stage('check_checklist', S4, {
      flow: 'FULL', program_key: 'hkd_secured', completeness_percent: 50, subject_mapping_available: true, asset_mapping_available: true,
      persons_evaluated: 1, total_required: 2, missing_count: 1, needs_rescan_count: 0, needs_review_count: 0,
    })).success).toBe(true);
    expect(CrossCheckStageResultSchema.safeParse(stage('cross_check_documents', S5, {
      total_comparisons: 1, match_count: 1, near_match_count: 0, mismatch_count: 0, undetermined_count: 0, requires_review_count: 0,
      high_severity_count: 0, logic_violation_count: 0, persons_compared: 1, assets_compared: 0,
    })).success).toBe(true);
  });

  it('field lạ ở mọi cấp đã khai báo bị từ chối', () => {
    const a = clone(S3) as Record<string, unknown>; a.extra = [];
    const b = clone(S3); (b.role_registry[0] as Record<string, unknown>).extra = 1;
    const c = clone(S4); (c.items[0] as Record<string, unknown>).co_confirmed_value = 'x';
    const d = clone(S5); (d.results[0] as Record<string, unknown>).decision_state = 'x';
    expect(MapDossierDataSchema.safeParse(a).success).toBe(false);
    expect(MapDossierDataSchema.safeParse(b).success).toBe(false);
    expect(CheckChecklistDataSchema.safeParse(c).success).toBe(false);
    expect(CrossCheckDataSchema.safeParse(d).success).toBe(false);
  });

  it('S3: tham chiếu person_id/asset_id không tồn tại bị từ chối', () => {
    const a = clone(S3); a.asset_registry[0].owner_person_ids = ['person-9'];
    const b = clone(S3); b.customer_360[0].owned_asset_ids = ['asset-9'];
    const c = clone(S3); c.customer_360[0].person_id = 'person-2';
    for (const d of [a, b, c]) expect(MapDossierDataSchema.safeParse(d).success).toBe(false);
  });

  it('S3: observed ⊇ historical ∪ {current}; verified_count = verified_documents.length', () => {
    const a = clone(S3); a.role_registry[0].observed_id_numbers = [];
    expect(MapDossierDataSchema.safeParse(a).success).toBe(false);
    const b = clone(S3) as unknown as { relationship_verifications: unknown[] };
    b.relationship_verifications = [{
      subject_person_id: 'person-1', collateral_owner_person_id: 'person-1', relationship_type: 'PARENT_CHILD',
      relationship_raw: 'Bố', required_count: 1, verified_count: 1, verified_documents: [],
    }];
    expect(MapDossierDataSchema.safeParse(b).success).toBe(false);
  });

  it('S3: CONFIRMED ↔ context_reason_code null; bản thay thế không bị thay thế', () => {
    const a = clone(S3); (a.asset_registry[0] as Record<string, unknown>).context_reason_code = 'ASSET_CONTEXT_AMBIGUOUS';
    expect(MapDossierDataSchema.safeParse(a).success).toBe(false);
    const sup = (id: string, by: string) => ({ evidence_id: id, doc_type_key: 'marital_status_confirmation', person_id: 'person-1', asset_id: null, issue_date: '2026-01-01', superseded_by_evidence_ids: [by], reason_code: 'DOCUMENT_EXPIRED' });
    const ok = clone(S3) as unknown as { superseded_evidences: unknown[] };
    ok.superseded_evidences = [sup(EV1, EV2)];
    expect(MapDossierDataSchema.safeParse(ok).success).toBe(true);
    const chain = clone(S3) as unknown as { superseded_evidences: unknown[] };
    chain.superseded_evidences = [sup(EV1, EV2), sup(EV2, 'ev-00000000000c')];
    expect(MapDossierDataSchema.safeParse(chain).success).toBe(false);
  });

  it('S4: completeness_percent và summary_by_group phải khớp items[]', () => {
    const a = clone(S4); a.completeness_percent = 100;
    const b = clone(S4); b.summary_by_group[0].missing_count = 0;
    expect(CheckChecklistDataSchema.safeParse(a).success).toBe(false);
    expect(CheckChecklistDataSchema.safeParse(b).success).toBe(false);
    expect(roundHalfUp2((1 / 3) * 100)).toBe(33.33);
    expect(roundHalfUp2((2 / 3) * 100)).toBe(66.67);
    expect(countChecklist([]).completeness_percent).toBeNull();
  });

  it('S4: SUBSTITUTED thiếu substituted_by_* và bộ ba condition lệch bị từ chối', () => {
    const a = clone(S4); Object.assign(a.items[0], { status: 'SUBSTITUTED', reason_code: 'SUBSTITUTED_BY_ALLOWED_DOC' });
    a.summary_by_group = [{ checklist_group: 'legal', ...countChecklist(a.items) }];
    a.completeness_percent = 50;
    expect(CheckChecklistDataSchema.safeParse(a).success).toBe(false);
    Object.assign(a.items[0], { substituted_by_item_key: 'legal_vneid', substituted_by_doc_type_key: 'vneid' });
    expect(CheckChecklistDataSchema.safeParse(a).success).toBe(true);
    const b = clone(S4); (b.items[0] as Record<string, unknown>).condition_id = 'COND_X';
    expect(CheckChecklistDataSchema.safeParse(b).success).toBe(false);
  });

  it('S4: status ngoài ChecklistItemStatus và reason_code ngoài scope CHK bị từ chối', () => {
    const a = clone(S4); a.items[0].status = 'OK';
    const b = clone(S4); a.items[0].reason_code = 'EXACT_MATCH';
    b.items[0].reason_code = 'EXACT_MATCH';
    expect(CheckChecklistDataSchema.safeParse(a).success).toBe(false);
    expect(CheckChecklistDataSchema.safeParse(b).success).toBe(false);
  });

  it('S5: match_status ngoài CrossCheckMatchStatus bị từ chối', () => {
    const a = clone(S5); a.results[0].match_status = 'OCR_VALUE_MISSING'; // giá trị của S6, không thuộc S5
    expect(CrossCheckDataSchema.safeParse(a).success).toBe(false);
  });

  it('S5: values < 2 nguồn, field normalization (đã bỏ — so địa chỉ trên bề mặt), reason rỗng bị từ chối', () => {
    const a = clone(S5); a.results[0].values = [a.results[0].values[0]];
    const b = clone(S5); a.results[0].values = [value(EV1, 'X'), value(EV1, 'X')];
    (b.results[0] as Record<string, unknown>).normalization = { dataset_version: 'v1', effective_from: null, effective_to: null, mapped_value: null };
    const c = clone(S5); c.results[0].reason = '';
    for (const d of [a, b, c]) expect(CrossCheckDataSchema.safeParse(d).success).toBe(false);
  });

  it('S5: skip_reason ngoài tập đóng bị từ chối; preview phải cộng đúng', () => {
    const a = clone(S5); a.skipped_evidences[0].skip_reason = 'OTHER';
    expect(CrossCheckDataSchema.safeParse(a).success).toBe(false);
    expect(CrossCheckPreviewSchema.safeParse({
      total_comparisons: 2, match_count: 1, near_match_count: 0, mismatch_count: 0, undetermined_count: 0, requires_review_count: 0,
      high_severity_count: 0, logic_violation_count: 0, persons_compared: 1, assets_compared: 0,
    }).success).toBe(false);
  });
});
