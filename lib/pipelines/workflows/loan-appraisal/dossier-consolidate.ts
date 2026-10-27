// Stage 2 `consolidate_dossier` chạy S3 → S4 → S5 bằng rule (T-V2-03; V2-R01, V2-R03). Bỏ lần gọi AI tổng hợp.
// LLM chỉ còn ở 6 điều kiện LLM_SEMANTIC của S4 và phép so SEMANTIC của S5 (qua port).
//
// CẦU NỐI TẠM (tới T-V2-06…T-V2-08): stage 3–7 vẫn đọc AppraisalResult/IntakeResult kiểu v2, nên
// `toLegacyEvaluation` / `toLegacyIntake` dựng hai object này từ S3–S5.
import type { WorkflowStepResult } from '@/lib/pipelines/workflow-engine';
import type {
  CheckChecklistStageResult, CrossCheckStageResult, MapDossierStageResult,
} from '@/lib/loan-dossier/contracts/check-stages';
import type { ExternalInput } from '@/lib/loan-dossier/s4/context';
import type { ChecklistOverrides } from '@/lib/loan-dossier/s4/programs';
import { runChecklist, type ChecklistPorts } from '@/lib/loan-dossier/s4/run';
import { SEMANTIC_DEFERRED_CODE } from '@/lib/loan-dossier/s5/metric';
import type { IntakeLlmCache } from './intake-review';
import type { MasterCorrectionCache } from './master-correction';
import { runCrossCheck, type CrossCheckPorts } from '@/lib/loan-dossier/s5/run';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';

import type { AppraisalResult, ChecklistItemResult, CrossCheckFinding, LoanProduct } from '../prompts/loan-appraisal-prompts';
import { DOSSIER_ARTIFACT_VERSION, toLegacyClassification, type ClassifyCheckpoint, type ExtractCheckpoint, type StageOutcome } from './dossier-stages';
import { toLegacyCustomer360 } from './evidence-v3';
import type { DossierOutputV3, IntakeResult } from './types';

export interface ConsolidateCheckpoint {
  map_dossier_roles: MapDossierStageResult;
  check_checklist: CheckChecklistStageResult;
  cross_check_documents: CrossCheckStageResult;
  /** D-59: kết quả LLM chấm nháp + tổng kết, ghi sau bước tiếp nhận để resume không gọi lại. */
  intake_llm?: IntakeLlmCache;
  /** D-67…D-69: quyết định LLM hiệu chỉnh master_dossier, ghi sau khi dựng master để resume không gọi lại. */
  master_correction?: MasterCorrectionCache;
}

export interface ConsolidateOptions {
  flow: unknown;
  /** Mã sản phẩm → chương trình checklist (S4-R24). */
  product_code: string;
  /** Ghi đè mức yêu cầu checklist từ Profile, đã parse (S4-R25). */
  checklist_overrides?: ChecklistOverrides | null;
  dossier_submitted_at: string;
  external_input: ExternalInput | null;
  ports: ChecklistPorts & CrossCheckPorts;
  now?: () => Date;
}

export function isConsolidateCheckpoint(v: unknown): v is ConsolidateCheckpoint {
  return !!v && typeof v === 'object' && 'map_dossier_roles' in v && 'check_checklist' in v && 'cross_check_documents' in v;
}

/** Ngày nộp hồ sơ mặc định: ngày theo giờ Việt Nam (V2-R01). */
export function vnToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Tham số chạy (V2-R01): `dossier_submitted_at`, `external_input` (hoặc các biến rời) từ pipelineVars. */
export function consolidateParams(vars: Record<string, unknown>, now?: Date): { dossier_submitted_at: string; external_input: ExternalInput | null } {
  const d = typeof vars.dossier_submitted_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(vars.dossier_submitted_at) ? vars.dossier_submitted_at : vnToday(now);
  let ext: Record<string, unknown> | null = null;
  const rawExt = vars.external_input;
  if (rawExt && typeof rawExt === 'object') ext = rawExt as Record<string, unknown>;
  else if (typeof rawExt === 'string' && rawExt.trim()) { try { ext = JSON.parse(rawExt); } catch { ext = null; } }
  const pick = (k: string) => (ext && k in ext ? ext[k] : vars[k]);
  const amount = pick('loan_amount');
  const mortgaged = pick('collateral_mortgaged_elsewhere');
  const deviation = pick('deviation_code');
  const external: ExternalInput = {
    deviation_code: typeof deviation === 'string' ? deviation : null,
    loan_amount: typeof amount === 'number' ? amount : typeof amount === 'string' && /^\d+$/.test(amount) ? Number(amount) : null,
    collateral_mortgaged_elsewhere: typeof mortgaged === 'boolean' ? mortgaged : mortgaged === 'true' ? true : mortgaged === 'false' ? false : null,
  };
  const any = Object.values(external).some((v) => v !== null);
  return { dossier_submitted_at: d, external_input: any ? external : null };
}

export async function runConsolidateStage(
  classify: ClassifyCheckpoint,
  extract: ExtractCheckpoint,
  opts: ConsolidateOptions,
): Promise<StageOutcome & { checkpoint: ConsolidateCheckpoint }> {
  const now = opts.now;
  const s3 = runMapDossier({ evidences: extract.evidences, dossier_submitted_at: opts.dossier_submitted_at, now });
  const s3ref = { status: s3.status, data: s3.data };
  const s4 = await runChecklist({
    flow: opts.flow, product_code: opts.product_code, checklist_overrides: opts.checklist_overrides ?? null,
    dossier_submitted_at: opts.dossier_submitted_at, external_input: opts.external_input,
    classify: { files: classify.files, repeated_doc_types: classify.repeated_doc_types }, evidences: extract.evidences, s3: s3ref, now,
  }, opts.ports);
  // D-57: giai đoạn tiếp nhận không gọi LLM so ngữ nghĩa — cặp cần LLM ra SEMANTIC_DEFERRED, so ở `completeSemanticChecks`.
  const s5 = await runCrossCheck({ evidences: extract.evidences, s3: s3ref, now }, { ...opts.ports, defer_semantic: true });
  return buildConsolidateStep({ map_dossier_roles: s3, check_checklist: s4, cross_check_documents: s5 });
}

/** Có cặp S5 đang chờ so ngữ nghĩa (D-57) không. */
export function hasDeferredSemantic(cp: ConsolidateCheckpoint): boolean {
  return (cp.cross_check_documents.data?.results ?? []).some((r) => r.reason_code === SEMANTIC_DEFERRED_CODE);
}

/**
 * D-57: chạy lại S5 (thuần quy tắc) với port LLM thật để so các cặp đã hoãn; S3/S4 giữ nguyên.
 * Trả step 2 mới để ghi đè checkpoint (lần resume sau không so lại).
 */
export async function completeSemanticChecks(
  extract: ExtractCheckpoint,
  cp: ConsolidateCheckpoint,
  ports: CrossCheckPorts,
  now?: () => Date,
): Promise<StageOutcome & { checkpoint: ConsolidateCheckpoint }> {
  const s3 = cp.map_dossier_roles;
  const s5 = await runCrossCheck({ evidences: extract.evidences, s3: { status: s3.status, data: s3.data }, now }, { ...ports, defer_semantic: false });
  return buildConsolidateStep({ ...cp, cross_check_documents: s5 });
}

function buildConsolidateStep(checkpoint: ConsolidateCheckpoint): StageOutcome & { checkpoint: ConsolidateCheckpoint } {
  const { map_dossier_roles: s3, check_checklist: s4, cross_check_documents: s5 } = checkpoint;
  const statuses = [s3.status, s4.status, s5.status];
  const status: WorkflowStepResult['status'] = s3.status === 'FAILED' ? 'FAILED' : statuses.every((s) => s === 'SUCCESS') ? 'SUCCESS' : 'PARTIAL_SUCCESS';
  const step: WorkflowStepResult = {
    step: 2,
    stage_key: 'consolidate_dossier',
    artifact_version: DOSSIER_ARTIFACT_VERSION,
    status,
    stepName: 'Gom người & tài sản + Checklist + Đối chiếu chéo',
    processor: 'loan-dossier-rules',
    content_preview: {
      map_dossier_roles: { status: s3.status, status_code: s3.status_code, ...s3.content_preview },
      check_checklist: { status: s4.status, status_code: s4.status_code, ...(s4.content_preview ?? {}) },
      cross_check_documents: { status: s5.status, status_code: s5.status_code, ...(s5.content_preview ?? {}) },
    },
    extracted_data: checkpoint,
  };
  return { step, failure: null, checkpoint };
}

const LEGACY_STATUS: Record<string, ChecklistItemResult['status']> = {
  PRESENT: 'present', SUBSTITUTED: 'present', NOT_APPLICABLE: 'present', MISSING: 'missing', NEEDS_RESCAN: 'review', NEEDS_REVIEW: 'review',
};

/** CẦU NỐI TẠM: checklist S4 → ChecklistItemResult[] kiểu v2 (khóa = item_key, kèm người/tài sản). */
export function toLegacyChecklist(cp: ConsolidateCheckpoint): ChecklistItemResult[] {
  return (cp.check_checklist.data?.items ?? []).map((it) => {
    const scope = it.person_id ?? it.asset_id;
    return {
      key: scope ? `${it.item_key}:${scope}` : it.item_key,
      label: scope ? `${it.item_label} (${scope})` : it.item_label,
      required: it.required,
      status: LEGACY_STATUS[it.status],
      found_in: [...new Set(it.found_in.map((f) => f.file_name))],
      ...(it.message || it.note ? { note: [it.message, it.note].filter(Boolean).join(' ') } : {}),
    };
  });
}

/** CẦU NỐI TẠM: S5 (dòng không khớp + logic rule vi phạm) → CrossCheckFinding[] kiểu v2. */
export function toLegacyCrossCheck(cp: ConsolidateCheckpoint): CrossCheckFinding[] {
  const d = cp.cross_check_documents.data;
  if (!d) return [];
  const sev = (s: string): CrossCheckFinding['severity'] => (s === 'HIGH' ? 'error' : s === 'REVIEW' ? 'warning' : 'info');
  return [
    ...d.results.filter((r) => r.match_status !== 'MATCH').map((r) => ({
      severity: sev(r.severity),
      title: `${r.field_label}${r.person_id ? ` — ${r.person_id}` : r.asset_id ? ` — ${r.asset_id}` : ''}`,
      message: r.reason,
      documents: [...new Set(r.values.map((v) => v.source.file_name))],
    })),
    ...d.logic_findings.filter((f) => f.violated).map((f) => ({ severity: sev(f.severity), title: f.rule_key, message: f.message })),
  ];
}

export function toLegacyEvaluation(cp: ConsolidateCheckpoint, classify: ClassifyCheckpoint, product: LoanProduct): AppraisalResult {
  return {
    product_code: product.code,
    product_name: product.name,
    documents: toLegacyClassification(classify),
    customer_360: toLegacyCustomer360(cp.map_dossier_roles.data),
    checklist: toLegacyChecklist(cp),
    completeness_percent: cp.check_checklist.data?.completeness_percent ?? 0,
    cross_check: toLegacyCrossCheck(cp),
    risk_notes: [],
    overall_assessment: '',
  };
}

export function toLegacyIntake(cp: ConsolidateCheckpoint, classify: ClassifyCheckpoint, extract: ExtractCheckpoint): IntakeResult {
  const checklist = toLegacyChecklist(cp);
  const required = checklist.filter((c) => c.required);
  return {
    required_present: required.filter((c) => c.status === 'present').length,
    required_total: required.length,
    completeness_percent: cp.check_checklist.data?.completeness_percent ?? 0,
    checklist,
    missing_required_keys: required.filter((c) => c.status === 'missing').map((c) => c.key),
    review_required_keys: required.filter((c) => c.status === 'review').map((c) => c.key),
    extraction_errors: extract.evidences.filter((e) => e.status === 'ERROR').map((e) => ({ file_name: e.file_name, doc_type_key: e.doc_type_key, error: e.reason_code ?? 'ERROR' })),
    error_files: classify.files.filter((f) => f.status !== 'CLASSIFIED').map((f) => ({
      file_name: f.file_name, doc_type_key: 'unknown', reason: f.message ?? f.reason_code ?? f.status,
      suggested_action: f.next_action === 'CONVERT_AND_REUPLOAD' || f.next_action === 'RESCAN_AND_REUPLOAD' || f.next_action === 'REMOVE_PASSWORD_AND_REUPLOAD' ? 'REQUEST_SUPPLEMENT' : 'REVIEW',
    })),
    blank_fields: [],
  };
}

/** V2-R09: phần hồ sơ của kết quả cuối — documents = S1 + S2, customer_360 = S3, checklist = S4, cross_check = S5. */
export function buildDossierOutput(
  product: LoanProduct,
  classify: ClassifyCheckpoint,
  extract: ExtractCheckpoint,
  cp: ConsolidateCheckpoint,
): DossierOutputV3 {
  const s4 = cp.check_checklist;
  const s5 = cp.cross_check_documents;
  return {
    product_code: product.code,
    product_name: product.name,
    documents: { classify: { files: classify.files, repeated_doc_types: classify.repeated_doc_types }, evidences: extract.evidences },
    customer_360: cp.map_dossier_roles.data,
    checklist: {
      status: s4.status,
      status_code: s4.status_code,
      flow: s4.data?.flow ?? null,
      items: s4.data?.items ?? [],
      summary_by_group: s4.data?.summary_by_group ?? [],
      completeness_percent: s4.data?.completeness_percent ?? null,
    },
    cross_check: {
      status: s5.status,
      status_code: s5.status_code,
      results: s5.data?.results ?? [],
      logic_findings: s5.data?.logic_findings ?? [],
      skipped_evidences: s5.data?.skipped_evidences ?? [],
    },
    completeness_percent: s4.data?.completeness_percent ?? 0,
  };
}
