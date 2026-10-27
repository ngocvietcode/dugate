// JSON tích hợp hồ sơ vay cho hệ thống ngoài (webhook / GET ?view=integration / download?view=integration).
//
// schema_version 5.0 — xem integration-contract.ts (nguồn duy nhất của contract + nguyên tắc bền vững).
// File này là PROJECTION thuần từ kết quả cuối (`AppraisalResultV2`) sang contract; không log giá trị (PII).
//
// Mỗi sự thật chỉ xuất hiện MỘT lần:
//   người / tổ chức → `parties` (họ tên, định danh, trường đã hợp nhất)   tài sản → `assets`
//   chứng từ        → `documents`  (trạng thái + dữ liệu đã hợp nhất theo chứng từ)
//   kiểm tra        → `checks`     (rule engine / LLM / Agent cùng MỘT hình dạng)
//   còn lại chỉ tham chiếu bằng khóa (`party-1`, `asset-1`, item_key, check id).
//
// Không có: tiến trình xử lý, kết quả giai đoạn 1, tóm tắt bóc tách, evidence (evidence_id, found_in, sources...).

import type { MasterDossier, MasterField } from '@/lib/loan-dossier/contracts/master-dossier';
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import { loanProductConfig } from '@/lib/loan-dossier/catalog/products';
import { loadChecklistCatalog } from '@/lib/loan-dossier/s4/catalog';
import { toCheckResult } from './check-contract';
import {
  INTEGRATION_INCLUDES,
  INTEGRATION_SCHEMA,
  INTEGRATION_SCHEMA_VERSION,
  type IntegrationInclude,
  type IntegrationPayload,
  type Outcome,
  OUTCOMES,
} from './integration-contract';
import { LOAN_CHECK_CATALOG, LOAN_CHECK_SET_VERSION } from './check-set';
import { RULE_GROUPS } from './rule-groups';
import type { IntakeAssessment } from './intake-assessment';
import type { AppraisalResultV2, DossierOutputV3, FinancialMetrics } from './types';

export {
  INTEGRATION_SCHEMA as LOAN_APPRAISAL_INTEGRATION_SCHEMA,
  INTEGRATION_SCHEMA_VERSION as LOAN_APPRAISAL_INTEGRATION_SCHEMA_VERSION,
};
export type LoanAppraisalIntegrationPayload = IntegrationPayload;

/** Artifact một stage như được lưu trong stepsResultJson (giữ chữ ký cho caller cũ; payload 5.0 không đọc). */
export interface StoredStageArtifact {
  step?: number;
  stage_key?: string;
  processor?: string;
  extracted_data?: unknown;
}

/** Thông tin operation do caller truyền vào. Payload 5.0 chỉ dùng `operation_id` và `completed_at`. */
export interface IntegrationOperationInfo {
  operation_id: string;
  state: string;
  created_at: string | null;
  completed_at: string | null;
}

export interface IntegrationBuildOptions {
  /** `narrative`: thêm `assessment` (4 tiêu chí + finding + tổng kết, văn bản dài). `labels`: thêm nhãn hiển thị. */
  include?: readonly IntegrationInclude[];
}

/** `?include=narrative,labels` → danh sách hợp lệ; giá trị lạ bị bỏ (không lỗi, để thêm include mới không phá consumer cũ). */
export function parseIntegrationIncludes(raw: string | null | undefined): IntegrationInclude[] {
  if (!raw) return [];
  const wanted = new Set(raw.split(',').map((s) => s.trim().toLowerCase()));
  return INTEGRATION_INCLUDES.filter((name) => wanted.has(name));
}

type FinalResult = DossierOutputV3 & Partial<Omit<AppraisalResultV2, keyof DossierOutputV3>>;
type Party = NonNullable<IntegrationPayload['parties']>[number];
type Asset = NonNullable<IntegrationPayload['assets']>[number];
type DocumentsBlock = NonNullable<IntegrationPayload['documents']>;
type Finding = NonNullable<IntegrationPayload['findings']>[number];
type Field = NonNullable<Party['fields']>[number];

const arrayOf = <T>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);

// ─── Khóa tham chiếu ─────────────────────────────────────────────────────────
// Nội bộ dùng `person-<n>` / `asset-<n>`; hợp đồng dùng `party-<n>` / `asset-<n>` để mở rộng cho tổ chức.
const partyRef = (personId: string | null | undefined): string | undefined => (personId ? personId.replace(/^person-/, 'party-') : undefined);
const assetRef = (assetId: string | null | undefined): string | undefined => (assetId ? assetId : undefined);

// ─── Trường master → Field ───────────────────────────────────────────────────

function field(f: MasterField): Field {
  return {
    path: f.path,
    value: f.value,
    status: f.status,
    ...(f.review_status === 'REVIEW' ? { review: true as const } : {}),
    ...(f.status === 'CONFLICT' ? { candidates: f.candidates.map((c) => c.value) } : {}),
  };
}

/** `person-1` → `Hộ khách hàng...`: nhãn master có kèm tên; chỉ lấy ở `parties[].name`, không lặp lại ở chỗ khác. */
const IDENTITY_PATHS = new Set(['full_name', 'id_number']);
/** Họ tên / số định danh dưới dạng `full_name` (thực thể) hoặc `parties[n].full_name` (trường của chứng từ). Các giá trị này nằm ở `parties`. */
const isIdentityPath = (path: string): boolean => IDENTITY_PATHS.has(path.replace(/^parties\[\d+\]\./, ''));

function identifiersOf(p: MapDossierData['customer_360'][number]): Party['identifiers'] {
  const out: NonNullable<Party['identifiers']> = [];
  if (p.identity.id_number) out.push({ type: 'NATIONAL_ID', value: p.identity.id_number });
  return out.length > 0 ? out : undefined;
}

function buildParties(result: FinalResult): Party[] {
  const master = new Map((result.master_dossier?.persons ?? []).map((e) => [e.entity_id, e]));
  const registry = new Map(arrayOf(result.customer_360?.role_registry).map((r) => [r.person_id, r]));
  return arrayOf(result.customer_360?.customer_360).map((c): Party => {
    const entity = master.get(c.person_id);
    const reg = registry.get(c.person_id);
    const relations: NonNullable<Party['relations']> = [];
    if (c.spouse_person_id) relations.push({ type: 'SPOUSE', party: partyRef(c.spouse_person_id)! });
    // Tên và số định danh nằm ở `name`/`identifiers`; không lặp lại ở `fields`.
    const fields = (entity?.fields ?? []).filter((f) => !isIdentityPath(f.path)).map(field);
    return {
      id: partyRef(c.person_id)!,
      type: 'PERSON',
      roles: c.roles.length > 0 ? [...c.roles] : (reg?.roles ?? ['other']),
      ...(c.identity.full_name ? { name: c.identity.full_name } : {}),
      ...(identifiersOf(c) ? { identifiers: identifiersOf(c) } : {}),
      ...(relations.length > 0 ? { relations } : {}),
      ...(fields.length > 0 ? { fields } : {}),
    };
  });
}

const ASSET_ID_LABELS: Array<[keyof MapDossierData['asset_registry'][number]['identifiers'], string]> = [
  ['certificate_number', 'CERTIFICATE_NUMBER'], ['certificate_book_number', 'CERTIFICATE_BOOK_NUMBER'], ['land_parcel_number', 'LAND_PARCEL'],
  ['map_sheet_number', 'MAP_SHEET'], ['apartment_number', 'APARTMENT_NUMBER'], ['building_name', 'BUILDING_NAME'], ['project_name', 'PROJECT_NAME'],
  ['license_plate', 'LICENSE_PLATE'], ['chassis_number', 'CHASSIS_NUMBER'], ['engine_number', 'ENGINE_NUMBER'], ['registration_number', 'REGISTRATION_NUMBER'],
];

function buildAssets(result: FinalResult): Asset[] {
  const master = new Map((result.master_dossier?.assets ?? []).map((e) => [e.entity_id, e]));
  return arrayOf(result.customer_360?.asset_registry).map((a): Asset => {
    const ids = ASSET_ID_LABELS.flatMap(([key, type]) => (a.identifiers[key] ? [{ type, value: String(a.identifiers[key]) }] : []));
    const owners = a.owner_person_ids.map((id) => partyRef(id)!);
    const fields = (master.get(a.asset_id)?.fields ?? []).map(field);
    return {
      id: a.asset_id,
      type: a.asset_type,
      ...(owners.length > 0 ? { owners } : {}),
      ...(a.usage_contexts.length > 0 ? { usage: [...a.usage_contexts] } : {}),
      ...(ids.length > 0 ? { identifiers: ids } : {}),
      ...(fields.length > 0 ? { fields } : {}),
    };
  });
}

// ─── documents ───────────────────────────────────────────────────────────────

function buildDocuments(result: FinalResult): DocumentsBlock {
  const checklist = result.checklist;
  const readiness = result.dossier_readiness;
  const items = arrayOf(checklist?.items)
    // Mục không áp dụng không mang thông tin; mục đã đạt mà không bắt buộc cũng bỏ. Tổng quan đầy đủ nằm ở `by_group`.
    .filter((i) => i.status !== 'NOT_APPLICABLE' && (i.required || i.status !== 'PRESENT'))
    .map((i): DocumentsBlock['items'][number] => ({
      key: i.item_key,
      group: i.checklist_group,
      status: i.status as DocumentsBlock['items'][number]['status'],
      required: i.required,
      ...(partyRef(i.person_id) ? { party: partyRef(i.person_id)! } : {}),
      ...(assetRef(i.asset_id) ? { asset: assetRef(i.asset_id)! } : {}),
      ...(i.status !== 'PRESENT' && i.reason_code ? { code: i.reason_code } : {}),
      ...(i.suggested_action !== 'NONE' ? { action: i.suggested_action as 'UPLOAD' | 'RESCAN' | 'REVIEW_CONTEXT' } : {}),
      ...(i.substituted_by_item_key ? { substituted_by: i.substituted_by_item_key } : {}),
    }));

  const brief = briefMasterDossier(result.master_dossier);
  return {
    readiness: readiness?.status ?? 'NOT_PROCESSABLE',
    completeness_percent: readiness?.completeness_percent ?? checklist?.completeness_percent ?? 0,
    required_present: readiness?.required_present ?? 0,
    required_total: readiness?.required_total ?? 0,
    by_group: arrayOf(checklist?.summary_by_group).map((g) => ({
      group: g.checklist_group,
      required: g.total_required,
      done: g.present_count + g.substituted_count,
      missing: g.missing_count,
      needs_review: g.needs_rescan_count + g.needs_review_count,
      ...(g.completeness_percent !== null ? { percent: g.completeness_percent } : {}),
    })),
    items,
    records: (brief?.documents ?? []).flatMap((d) => {
      // Giá trị định danh (họ tên, số định danh) đã ở `parties`; bản theo chứng từ chỉ giữ khi có xung đột / cần rà soát.
      // Trường MISSING không có giá trị: vắng mặt trong `records` nghĩa là "chứng từ không có thông tin này".
      const fields = d.fields
        .filter((f) => f.status !== 'MISSING')
        .filter((f) => !isIdentityPath(f.path) || f.status === 'CONFLICT' || f.needs_review)
        .map((f) => ({
          path: f.path,
          value: f.value,
          status: f.status,
          ...(f.needs_review ? { review: true as const } : {}),
          ...(f.candidates ? { candidates: f.candidates } : {}),
        }));
      if (fields.length === 0) return [];
      return [{
        doc: d.doc_type_key ?? d.item_key ?? 'unknown',
        ...(d.item_key ? { item: d.item_key } : {}),
        ...(partyRef(d.person_id) ? { party: partyRef(d.person_id)! } : {}),
        ...(assetRef(d.asset_id) ? { asset: assetRef(d.asset_id)! } : {}),
        fields,
      }];
    }),
    issues: [
      ...arrayOf(readiness?.unclassified_files).map((f) => ({ kind: 'UNCLASSIFIED_FILE' as const, file: f.file_name, message: f.reason })),
      ...arrayOf(readiness?.extraction_errors).map((e) => ({ kind: 'EXTRACTION_ERROR' as const, file: e.file_name, doc: e.doc_type_key, message: e.error })),
    ],
  };
}

// ─── Bản chiếu master tối thiểu (giữ cho test cũ và đường nội bộ) ─────────────

export interface IntegrationMasterField {
  path: string;
  label: string;
  value: unknown;
  status: MasterField['status'];
  needs_review: boolean;
  candidates?: unknown[];
  note?: string;
}

export interface IntegrationMasterDossier {
  summary: MasterDossier['summary'];
  documents: Array<{ item_key: string | null; doc_type_key: string | null; person_id: string | null; asset_id: string | null; fields: IntegrationMasterField[] }>;
  persons: Array<{ entity_id: string; label: string; fields: IntegrationMasterField[] }>;
  assets: Array<{ entity_id: string; label: string; fields: IntegrationMasterField[] }>;
}

function briefField(f: MasterField): IntegrationMasterField {
  return {
    path: f.path,
    label: f.label,
    value: f.value,
    status: f.status,
    needs_review: f.review_status === 'REVIEW',
    ...(f.status === 'CONFLICT' ? { candidates: f.candidates.map((c) => c.value) } : {}),
    ...(f.note ? { note: f.note } : {}),
  };
}

/** Bản chiếu tối thiểu của `master_dossier` (D-66): giá trị hợp nhất + trạng thái; không nguồn, độ tin cậy, bản sao. */
export function briefMasterDossier(m: MasterDossier | null | undefined): IntegrationMasterDossier | null {
  if (!m) return null;
  const entity = (e: MasterDossier['persons'][number]) => ({ entity_id: e.entity_id, label: e.label, fields: e.fields.map(briefField) });
  return {
    summary: m.summary,
    documents: m.documents
      .filter((d) => d.fields.length > 0)
      .map((d) => ({ item_key: d.item_key, doc_type_key: d.doc_type_key, person_id: d.person_id, asset_id: d.asset_id, fields: d.fields.map(briefField) })),
    persons: m.persons.map(entity),
    assets: m.assets.map(entity),
  };
}

// ─── extractions (OCR) ───────────────────────────────────────────────────────

/** Trường cấu trúc OCR: bỏ khóa null / rỗng ở mọi độ sâu để payload nhỏ. Mảng và object rỗng cũng bỏ; số 0 và false được giữ. */
function pruneEmpty(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(pruneEmpty).filter((v) => v !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pruned = pruneEmpty(v);
      if (pruned !== undefined) out[k] = pruned;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  if (value === null || value === undefined || value === '') return undefined;
  return value;
}

/**
 * Kết quả OCR theo chứng từ (S2). Bản data giữ đúng cấu trúc của danh mục chứng từ, đã bỏ trường rỗng; bỏ field_confidences,
 * source_pages, evidence_id, file_id (provenance, không phải giá trị cuối).
 */
function buildExtractions(result: FinalResult): IntegrationPayload['extractions'] {
  return arrayOf(result.documents?.evidences).map((e) => {
    const data = e.status === 'SUCCESS' ? pruneEmpty(e.data) as Record<string, unknown> | undefined : undefined;
    return {
      doc: e.doc_type_key,
      file: e.file_name,
      ...(e.instance_index > 1 ? { instance: e.instance_index } : {}),
      ...(e.page_range ? { pages: [e.page_range[0], e.page_range[1]] as [number, number] } : {}),
      status: e.status === 'SUCCESS' ? 'SUCCESS' as const : 'ERROR' as const,
      ...(e.status !== 'SUCCESS' && e.reason_code ? { code: e.reason_code } : {}),
      ...(e.schema_version ? { schema_version: e.schema_version } : {}),
      ...(e.duplicate_status ? { duplicate: String(e.duplicate_status) } : {}),
      ...(data ? { data } : {}),
    };
  });
}

/** Các bước kiểm tra hồ sơ đã chạy (kết quả cũ, hoặc khi bật lại)? Khi tạm tắt, khối kiểm tra mang mã DOSSIER_CHECKS_DISABLED / không có dữ liệu. */
function hasDossierChecks(result: FinalResult): boolean {
  const code = result.checklist?.status_code;
  return Boolean(result.customer_360) && code !== 'DOSSIER_CHECKS_DISABLED' && code !== 'DEFERRED_TO_PHASE_2';
}

// ─── findings ────────────────────────────────────────────────────────────────

function buildFindings(c: DossierOutputV3['cross_check'] | undefined): Finding[] {
  const discrepancies = arrayOf(c?.results)
    .filter((r) => r.match_status !== 'MATCH')
    .map((r): Finding => ({
      kind: 'DISCREPANCY',
      field: r.sub_field ? `${r.field_label} / ${r.sub_field}` : r.field_label,
      status: r.match_status as 'NEAR_MATCH' | 'MISMATCH' | 'UNDETERMINED',
      severity: r.severity,
      ...(r.requires_review ? { review: true as const } : {}),
      ...(r.reason_code ? { code: r.reason_code } : {}),
      ...(partyRef(r.person_id) ? { party: partyRef(r.person_id)! } : {}),
      ...(assetRef(r.asset_id) ? { asset: assetRef(r.asset_id)! } : {}),
      values: r.values.map((v) => ({ doc: v.source.doc_type_key, value: v.value })),
      ...(r.canonical_source?.doc_type_key ? { canonical_doc: r.canonical_source.doc_type_key } : {}),
      message: r.reason,
    }));
  const logic = arrayOf(c?.logic_findings)
    .filter((f) => f.violated)
    .map((f): Finding => ({
      kind: 'LOGIC',
      field: f.rule_key,
      severity: f.severity,
      ...(f.requires_review ? { review: true as const } : {}),
      ...(partyRef(f.person_id) ? { party: partyRef(f.person_id)! } : {}),
      ...(assetRef(f.asset_id) ? { asset: assetRef(f.asset_id)! } : {}),
      message: f.message,
    }));
  return [...discrepancies, ...logic];
}

// ─── financials ──────────────────────────────────────────────────────────────

function buildFinancials(f: FinancialMetrics | undefined): IntegrationPayload['financials'] {
  if (!f) return [];
  return (Object.keys(f) as Array<keyof FinancialMetrics>).map((metric) => {
    const m = f[metric];
    return {
      metric,
      ...(m.value !== null ? { value: m.value } : {}),
      unit: m.unit,
      status: m.status,
      ...(m.input_conflict ? { conflict: true as const } : {}),
    };
  });
}

// ─── checks ──────────────────────────────────────────────────────────────────

/** Trạng thái tổng hợp của bộ kiểm tra; giá trị ngoài 4 trạng thái đã công bố (NOT_RUN...) coi là cần rà soát. */
function toPolicyStatus(status: string | undefined): IntegrationPayload['checks_summary']['status'] {
  return status === 'PASS' || status === 'PASS_WITH_CONDITIONS' || status === 'FAIL' ? status : 'REVIEW';
}

function buildChecks(result: FinalResult) {
  const rules = arrayOf(result.policy_compliance?.rule_results);
  const checks = rules.map((r) => toCheckResult(r, { modelCode: r.model_code }));
  const counts = new Map<Outcome, number>();
  for (const c of checks) counts.set(c.outcome, (counts.get(c.outcome) ?? 0) + 1);
  const summary: IntegrationPayload['checks_summary'] = {
    status: toPolicyStatus(result.policy_compliance?.status),
    ...(result.policy_compliance ? { policy: { id: result.policy_compliance.policy_id, version: result.policy_compliance.policy_version } } : {}),
    total: checks.length,
    by_outcome: OUTCOMES.filter((o) => counts.has(o)).map((o) => ({ outcome: o, count: counts.get(o)! })),
  };
  return { checks, summary };
}

// ─── decision ────────────────────────────────────────────────────────────────

function buildDecision(result: FinalResult): IntegrationPayload['decision'] {
  const rec = result.recommendation;
  const review = result.review;
  const external = arrayOf(result.policy_compliance?.external_checks).filter((c) => c.status === 'NOT_RUN');
  return {
    status: result.processing_status ?? 'PARTIAL',
    recommendation: rec?.recommendation ?? 'INSUFFICIENT_DATA',
    ...(rec?.suggested_amount_vnd != null ? { suggested_amount_vnd: rec.suggested_amount_vnd } : {}),
    ...(rec?.suggested_tenor_months != null ? { suggested_tenor_months: rec.suggested_tenor_months } : {}),
    route: review?.route ?? 'RISK_REVIEW',
    ...(review?.required_role ? { required_role: review.required_role } : {}),
    review_required: Boolean(review?.required ?? rec?.review_required ?? true),
    ...(result.intake_assessment ? { ready_for_handover: result.intake_assessment.ready_for_handover } : {}),
    reason_codes: [...new Set(arrayOf(rec?.reason_codes ?? review?.reasons))],
    // Điều kiện chứng từ KHÔNG lặp ở đây: chứng từ cần bổ sung nằm ở `documents.items`.
    ...(external.length > 0 ? { conditions: [{ code: 'EXTERNAL_COMPLIANCE_PENDING', message: external.map((c) => c.check).join(', ') }] } : {}),
    ...(arrayOf(rec?.covenants).length > 0 ? { covenants: arrayOf(rec?.covenants) } : {}),
  };
}

// ─── assessment + labels (tuỳ chọn) ──────────────────────────────────────────

function buildAssessment(a: IntakeAssessment | undefined): IntegrationPayload['assessment'] {
  if (!a) return undefined;
  return {
    ready_for_handover: a.ready_for_handover,
    criteria: a.criteria.map((c) => ({
      key: c.key,
      status: c.status,
      summary: c.summary,
      ...(c.findings.length > 0 ? { findings: c.findings.map((f) => ({ code: f.code, message: f.message, acknowledgeable: f.acknowledgeable })) } : {}),
    })),
    ...(a.dossier_summary ? { summary: { overview: a.dossier_summary.overview, highlights: a.dossier_summary.highlights, next_actions: a.dossier_summary.next_actions } } : {}),
  };
}

function buildLabels(result: FinalResult, payload: IntegrationPayload): IntegrationPayload['labels'] {
  const checklist = loadChecklistCatalog();
  const itemKeys = new Set((payload.documents?.items ?? []).map((i) => i.key));
  const groups = new Set((payload.documents?.by_group ?? []).map((g) => g.group));
  const usedChecks = new Set(payload.checks.map((c) => c.id));
  return {
    checks: arrayOf(result.policy_compliance?.rule_results)
      .filter((r) => usedChecks.has(r.rule_id))
      .map((r) => {
        const def = LOAN_CHECK_CATALOG.find((c) => c.id === r.rule_id);
        return { id: r.rule_id, name: r.check_name ?? r.rule_id, severity: r.severity, ...(def?.outputs?.codes ? { codes: def.outputs.codes } : {}) };
      }),
    documents: checklist.items.filter((i) => itemKeys.has(i.item_key)).map((i) => ({ key: i.item_key, label: i.item_label })),
    check_groups: RULE_GROUPS.filter((g) => payload.checks.some((c) => c.group === g.key)).map((g) => ({ group: g.key, label: g.label })),
    document_groups: checklist.groups.filter((g) => groups.has(g.checklist_group)).map((g) => ({ group: g.checklist_group, label: g.group_label })),
    metrics: payload.financials.map((m) => ({ metric: m.metric, label: m.metric })),
  };
}

// ─── gốc ─────────────────────────────────────────────────────────────────────

/** Dựng JSON tích hợp 5.0 từ kết quả cuối (`_steps` giữ để tương thích chữ ký caller; không còn đọc). */
export function buildLoanAppraisalIntegrationPayload(
  result: FinalResult,
  _steps: StoredStageArtifact[],
  operation: IntegrationOperationInfo,
  options: IntegrationBuildOptions = {},
): IntegrationPayload {
  const include = new Set(options.include ?? []);
  const product = loanProductConfig(result.product_code);
  const checksOn = hasDossierChecks(result);
  const { checks, summary } = buildChecks(result);
  const exceptions = checks.filter((c) => c.exception).map((c) => c.id);
  const notes = [
    ...arrayOf(result.risk_notes).map((text) => ({ kind: 'RISK' as const, text })),
    ...arrayOf(result.system_notes).map((text) => ({ kind: 'SYSTEM' as const, text })),
  ];

  const payload: IntegrationPayload = {
    schema: INTEGRATION_SCHEMA,
    schema_version: INTEGRATION_SCHEMA_VERSION,
    case: {
      id: operation.operation_id,
      ...(operation.completed_at ? { completed_at: operation.completed_at } : {}),
      profile: {
        segment: product?.segment ?? 'HKD',
        product: result.product_code,
        ...(result.product_name ? { product_name: result.product_name } : {}),
        ...(result.flow ? { flow: result.flow } : {}),
        catalog: { checks: result.config_snapshot?.check_set?.version ?? LOAN_CHECK_SET_VERSION, documents: loadChecklistCatalog().catalog_version },
      },
    },
    decision: buildDecision(result),
    extractions: buildExtractions(result),
    ...(checksOn ? {
      parties: buildParties(result),
      assets: buildAssets(result),
      documents: buildDocuments(result),
      findings: buildFindings(result.cross_check),
    } : {}),
    financials: buildFinancials(result.financial_metrics),
    checks,
    checks_summary: summary,
    ...(exceptions.length > 0 ? { exceptions } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
  if (include.has('narrative')) {
    const assessment = buildAssessment(result.intake_assessment);
    if (assessment) payload.assessment = assessment;
  }
  if (include.has('labels')) payload.labels = buildLabels(result, payload);
  return payload;
}
