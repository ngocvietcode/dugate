// Lắp ráp stage S4 `check_checklist` (T-S4-10). Rule-based; LLM chỉ cho 6 điều kiện LLM_SEMANTIC (qua port).
import type { CheckChecklistData, CheckChecklistStageResult, ChecklistItemResult, MapDossierData } from '../contracts/check-stages';
import type { ClassifyData } from '../contracts/stage-result';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { conditionById, loadChecklistCatalog } from './catalog';
import { applySubstituteGroups } from './substitute-groups';
import { evaluateSemanticConditions, SEMANTIC_CONDITIONS, type LlmClassifierPort } from './conditions-llm';
import { assetCondition, evaluateCondition, type ConditionOutcome } from './conditions-rule';
import type { ChecklistContext, ConditionResult, ExternalInput, Flow } from './context';
import {
  loadChecklistPrograms, programFlowKeys, programForProduct, resolveChecklist,
  type ChecklistOverrides, type ChecklistProgramsCatalog,
} from './programs';
import { resolveRequired } from './required';
import { decideRowStatus } from './row-status';
import { buildRows, CandidateIndex, type Candidate, type Row } from './rows';
import { completeness, stageStatus, summarize } from './summary';

export interface ChecklistInput {
  flow: unknown;
  /** Mã sản phẩm vay → chương trình checklist (S4-R24). */
  product_code: unknown;
  /** Ghi đè mức yêu cầu từ Profile, đã qua `parseChecklistOverrides` (S4-R25). */
  checklist_overrides?: ChecklistOverrides | null;
  /** Catalog chương trình thay thế (test); mặc định `checklist_programs.json`. */
  programs?: ChecklistProgramsCatalog;
  dossier_submitted_at: string;
  external_input: ExternalInput | null;
  classify: ClassifyData;
  evidences: ReadonlyArray<EvidenceEnvelope>;
  /** Kết quả S3; null = S3 không có dữ liệu. */
  s3: { status: string; data: MapDossierData | null } | null;
  now?: () => Date;
}

export interface ChecklistPorts {
  llm: LlmClassifierPort | null;
}

const DUP_RANK = ['CONFLICTING_DUPLICATES', 'DUPLICATE_CANDIDATE', 'CONFIRMED_DUPLICATE'];

function foundIn(cs: readonly Candidate[]) {
  return cs.filter((c) => c.evidence_id).map((c) => ({ evidence_id: c.evidence_id!, file_id: c.file_id, file_name: c.file_name, page: c.page, field_path: c.field_path }));
}

export async function runChecklist(input: ChecklistInput, ports: ChecklistPorts): Promise<CheckChecklistStageResult> {
  const now = () => (input.now ? input.now() : new Date()).toISOString();
  const started_at = now();
  const base = { stage_key: 'check_checklist' as const, started_at, content_preview: null, data: null, blocking_inputs: [] };

  // §4 #1: dependency FAILED
  if (input.s3 && (input.s3.status === 'FAILED' || input.s3.status === 'UNAVAILABLE')) {
    return { ...base, status: 'UNAVAILABLE', status_code: 'DEPENDENCY_FAILED', message: 'Bước gom người và tài sản không có kết quả.', finished_at: now() };
  }
  // §4 #2 / S4-R24: sản phẩm → chương trình checklist
  const program = programForProduct(input.product_code, input.programs ?? loadChecklistPrograms());
  if (!program) {
    return { ...base, status: 'FAILED', status_code: 'UNKNOWN_CHECKLIST_PROGRAM', message: 'Sản phẩm vay không thuộc chương trình checklist nào.', finished_at: now() };
  }
  // §4 #3 / S4-R01: luồng phải thuộc chương trình
  const flows = programFlowKeys(program);
  if (typeof input.flow !== 'string' || !flows.includes(input.flow)) {
    return { ...base, status: 'FAILED', status_code: 'INVALID_FLOW', message: `Thiếu hoặc sai luồng hồ sơ (${flows.join('/')}).`, finished_at: now() };
  }
  const flow: Flow = input.flow;
  const resolved = resolveChecklist(program, flow, input.checklist_overrides ?? {});
  const requirementOf = new Map(resolved.rows.map((r) => [r.item.item_key, r.requirement]));
  const s3data = input.s3?.data ?? null;
  const s3ok = input.s3 !== null && (input.s3.status === 'SUCCESS' || input.s3.status === 'PARTIAL_SUCCESS');
  const ctx: ChecklistContext = {
    flow, d0: input.dossier_submitted_at, external: input.external_input, classify: input.classify, evidences: input.evidences,
    s3: s3data, subjectMapping: s3ok && (s3data?.role_registry.length ?? 0) > 0, assetMapping: s3ok && s3data !== null,
    superseded: new Set((s3data?.superseded_evidences ?? []).map((s) => s.evidence_id)),
  };

  const index = new CandidateIndex(ctx);
  const rows = buildRows(resolved.rows.map((r) => r.item), ctx, index);

  // Điều kiện LLM: chỉ hỏi khi có dòng cần (S4-R12), mỗi port tối đa 1 lần.
  const needed = new Set(rows.map((r) => r.item.condition_id).filter((c): c is string => c !== null));
  const semanticNeeded = new Set([...needed].filter((c) => (SEMANTIC_CONDITIONS as readonly string[]).includes(c) || c === 'household_business_license_required'));
  const semantic = await evaluateSemanticConditions(ctx, ports.llm, semanticNeeded);

  const evaluations = new Map<string, { condition_id: string; person_id: string | null; asset_id: string | null; result: ConditionResult; source: string }>();
  const conditionOf = (row: Row): ConditionOutcome | null => {
    const id = row.item.condition_id;
    if (!id) return null;
    const personId = row.item.scope === 'PERSON' ? row.person?.person_id ?? null : null;
    const assetId = row.item.scope === 'ASSET' ? row.asset?.asset_id ?? null : null;
    const outcome: ConditionOutcome = row.item.scope === 'ASSET'
      ? { result: row.preset_condition ?? assetCondition(id, row.asset), source: 'OCR' }
      : evaluateCondition(id, ctx, personId, semantic);
    const k = `${id}|${personId}|${assetId}`;
    if (!evaluations.has(k)) evaluations.set(k, { condition_id: id, person_id: personId, asset_id: assetId, result: outcome.result, source: outcome.source });
    return outcome;
  };

  const allowSubstitute: boolean[] = [];
  const rawItems: ChecklistItemResult[] = rows.map((row) => {
    const cond = conditionOf(row);
    const onMissing = row.item.condition_id ? conditionById(row.item.condition_id)?.on_input_missing ?? null : null;
    const req = resolveRequired(row.item, cond?.result ?? null, requirementOf.get(row.item.item_key)!, onMissing);
    allowSubstitute.push(req.allowSubstitute);
    const d = decideRowStatus(row, cond?.result ?? null, req, ctx, index);
    const dups = [...new Set(d.found_in.map((c) => c.duplicate_group_id).filter((g): g is string => g !== null))];
    const dupStatus = DUP_RANK.find((s) => d.found_in.some((c) => c.duplicate_status === s)) ?? null;
    const isPerson = row.item.scope === 'PERSON';
    const isAsset = row.item.scope === 'ASSET';
    return {
      item_key: row.item.item_key,
      checklist_group: row.item.checklist_group as ChecklistItemResult['checklist_group'],
      checklist_subgroup: row.item.checklist_subgroup as ChecklistItemResult['checklist_subgroup'],
      item_no: row.item.item_no,
      item_label: row.item.item_label,
      doc_type_key: row.item.accepted_doc_type_keys[0] ?? null,
      scope: row.item.scope,
      person_id: isPerson ? row.person?.person_id ?? null : null,
      roles: isPerson ? row.person?.roles ?? [] : [],
      primary_role: isPerson ? row.person?.primary_role ?? null : null,
      asset_id: isAsset ? row.asset?.asset_id ?? null : null,
      usage_context: isAsset ? (row.usage_context as ChecklistItemResult['usage_context']) : null,
      context_status: isAsset ? row.asset?.context_status ?? null : null,
      required: req.required,
      status: d.status,
      reason_code: d.reason_code,
      message: d.message,
      substituted_by_item_key: d.substituted_by_item_key,
      substituted_by_doc_type_key: d.substituted_by_doc_type_key,
      found_in: foundIn(d.found_in),
      duplicate_group_ids: dupStatus ? dups : [],
      duplicate_status: dupStatus as ChecklistItemResult['duplicate_status'],
      condition_id: cond ? row.item.condition_id : null,
      condition_source: cond ? cond.source : null,
      condition_result: cond ? cond.result : null,
      validity_days: row.item.validity_days,
      expired_evidence_ids: d.expired_evidence_ids,
      relationship_checks: d.relationship_checks as unknown as Array<Record<string, unknown>>,
      original_or_copy: row.item.original_or_copy as ChecklistItemResult['original_or_copy'],
      suggested_action: d.suggested_action,
      note: d.note,
    };
  });
  // S4-R27 (D-48): nhóm chứng từ thay thế nhau là một yêu cầu; mục đã được thay thế không còn bắt buộc.
  const items = applySubstituteGroups(rawItems, allowSubstitute);

  const anyClassified = input.classify.files.some((f) => f.status === 'CLASSIFIED');
  const verdict = stageStatus(items, anyClassified, ctx.subjectMapping);
  const data: CheckChecklistData = {
    flow,
    program_key: program.program_key,
    product_code: input.product_code as string,
    overrides_applied: resolved.overrides_applied,
    dossier_submitted_at: input.dossier_submitted_at,
    catalog_version: loadChecklistCatalog().catalog_version,
    subject_mapping_available: ctx.subjectMapping,
    asset_mapping_available: ctx.assetMapping,
    completeness_percent: completeness(items),
    items,
    summary_by_group: summarize(items),
    condition_evaluations: [...evaluations.values()],
    excluded_evidences: index.excluded as unknown as Array<Record<string, unknown>>,
  };
  const req = items.filter((i) => i.required);
  return {
    stage_key: 'check_checklist',
    status: verdict.status,
    status_code: verdict.code,
    message: null,
    started_at,
    finished_at: now(),
    content_preview: {
      flow,
      program_key: program.program_key,
      completeness_percent: data.completeness_percent,
      subject_mapping_available: ctx.subjectMapping,
      asset_mapping_available: ctx.assetMapping,
      persons_evaluated: new Set(items.filter((i) => i.scope === 'PERSON').map((i) => i.person_id)).size,
      total_required: req.length,
      missing_count: req.filter((i) => i.status === 'MISSING').length,
      needs_rescan_count: req.filter((i) => i.status === 'NEEDS_RESCAN').length,
      needs_review_count: req.filter((i) => i.status === 'NEEDS_REVIEW').length,
    },
    data,
    blocking_inputs: verdict.blocking,
  };
}
