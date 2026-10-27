// Lắp ráp stage S5 `cross_check_documents` (T-S5-08, T-S5-10; S5-R05…R16, §4). Không log `values` (PII).
import type { CrossCheckData, CrossCheckResult, CrossCheckStageResult, MapDossierData } from '../contracts/check-stages';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { compareAddress, type AddressLike } from './address';
import { collectComparisons, usableEvidences, type CollectedValue, type Comparison } from './collect';
import { exactKindOf, nearMatch, normalizeExact, unaccentedOnly } from './compare-exact';
import { adjudicateDuplicates, adjudicateIdLinkedByDocument, adjudicateIdNumber } from './id-and-dup';
import { evaluateLogicRules } from './logic-rules';
import { loadMatrix, type Matrix } from './matrix';
import { compareMetric, compareSemantic, SEMANTIC_DEFERRED_CODE, type SemanticPort, type Verdict } from './metric';

export interface CrossCheckInput {
  evidences: ReadonlyArray<EvidenceEnvelope>;
  s3: { status: string; data: MapDossierData | null } | null;
  now?: () => Date;
}

export interface CrossCheckPorts {
  semantic: SemanticPort | null;
  /** D-57: không gọi LLM so ngữ nghĩa; cặp cần LLM ra SEMANTIC_DEFERRED để so sau (completeSemanticChecks). */
  defer_semantic?: boolean;
}

type Person = MapDossierData['role_registry'][number];
const ROLE_PRIORITY = ['borrower', 'co_borrower', 'collateral_owner', 'other'] as const;

const MATCH_REASON: Record<string, string> = {
  EXACT_MATCH: 'Giá trị khớp giữa các chứng từ.',
  UNACCENTED_MATCH: 'Khớp; chỉ khác vì có chứng từ ghi không dấu (VD CIC).',
  VALUE_CONFLICT: 'Giá trị khác nhau giữa các chứng từ.',
};

/** S5-R10: địa chỉ khác văn bản là lệch; CO tự đánh giá trường hợp địa danh cũ/mới cùng vị trí. */
const ADDRESS_CONFLICT_REASON = 'Địa chỉ ghi trên các chứng từ khác nhau (so nguyên văn, không quy đổi địa danh cũ/mới); cần rà soát.';

/** id_status của 1 giá trị số định danh theo `id_number_sources` của S3. */
function idStatusOf(person: Person | undefined, v: CollectedValue, normalized: string | null): 'CURRENT' | 'HISTORICAL' | 'OBSERVED' | null {
  if (!person || !normalized) return null;
  const src = (person.id_number_sources as Array<{ evidence_id: string; id_number: string; id_status: 'CURRENT' | 'HISTORICAL' | 'OBSERVED' }>)
    .find((s) => s.evidence_id === v.evidence.evidence_id && s.id_number === normalized);
  return src?.id_status ?? (person.current_id_number === normalized ? 'CURRENT' : person.historical_id_numbers.includes(normalized) ? 'HISTORICAL' : 'OBSERVED');
}

/** S5-R10: số tiền vay luôn so bằng bank_proposed_amount — bỏ requested_amount của chính đơn vay. */
function loanAmountValues(values: CollectedValue[]): CollectedValue[] {
  const hasBank = values.some((v) => v.source.metric === 'bank_proposed_loan_amount');
  const kept = values.filter((v) => !(v.evidence.doc_type_key === 'loan_application' && v.source.metric === 'requested_loan_amount'));
  return hasBank ? kept : kept.filter((v) => v.evidence.doc_type_key !== 'loan_application');
}

/** Trang của giá trị: trang nguồn của field cấp 1, không có thì trang đầu của bản thể. */
function pageOf(v: CollectedValue): number | null {
  return (v.evidence.source_pages[v.field_path.split('.')[1]?.replace(/\[\d+\]$/, '')] ?? [v.evidence.page_range[0]])[0] ?? null;
}

/** S5-R07 "Gần khớp" (D-41): đa số ≥ 2 chứng từ ghi giống nhau, đúng 1 nguồn lệch 1 ký tự — nghi lỗi đọc. */
function nearMatchVerdict(values: CollectedValue[], normalized: Array<string | null>): Verdict | null {
  const near = nearMatch(normalized, values.map((v) => v.evidence.evidence_id));
  if (!near) return null;
  const odd = values[near.outlier];
  const page = pageOf(odd);
  return {
    match_status: 'NEAR_MATCH', reason_code: 'PROBABLE_OCR_ERROR', severity: 'INFO',
    reason: `${near.agreeing} chứng từ ghi giống nhau; ${odd.evidence.doc_type_label} (${odd.evidence.file_name}${page ? ` tr.${page}` : ''}) lệch đúng 1 ký tự, nghi do đọc sai. `
      + 'Xem lại trang đó; nếu chứng từ ghi sai thật thì yêu cầu sửa.',
  };
}

async function judge(c: Comparison, person: Person | undefined, ports: CrossCheckPorts): Promise<{ verdict: Verdict; normalized: unknown[]; idStatus: Array<string | null>; values: CollectedValue[] }> {
  let values = c.values;
  const method = c.sub.comparison_method;
  if (method === 'METRIC') {
    if (c.group.field_group === 'loan_amount') values = loanAmountValues(values);
    const mv = values.map((v) => ({ value: Number(v.value), metric: v.source.metric, period: v.source.period, unit: v.source.unit }));
    // Số tiền vay: so bank_proposed với số trên chứng từ khác bất kể tên chỉ số (cùng kỳ, cùng đơn vị).
    const forCompare = c.group.field_group === 'loan_amount' ? mv.map((m) => ({ ...m, metric: 'loan_amount' })) : mv;
    return { verdict: compareMetric(forCompare), normalized: mv.map((m) => m.value), idStatus: values.map(() => null), values };
  }
  if (method === 'ADDRESS_REFERENCE') {
    // S5-R07/R10: so văn bản địa chỉ như in trên chứng từ; không tra địa giới, không quy đổi địa danh cũ/mới.
    const a = compareAddress(values.map((v) => v.value as AddressLike));
    const severity = a.match_status === 'MATCH' ? 'INFO' : 'REVIEW';
    return { verdict: { match_status: a.match_status, reason_code: a.reason_code, severity, reason: a.match_status === 'MATCH' ? MATCH_REASON.EXACT_MATCH : ADDRESS_CONFLICT_REASON }, normalized: a.normalized, idStatus: values.map(() => null), values };
  }
  if (method === 'SEMANTIC') {
    const texts = values.map((v) => (v.value && typeof v.value === 'object' ? String((v.value as AddressLike).full_text ?? '') : String(v.value)));
    const dup = adjudicateDuplicates(values.map((v, i) => ({ normalized: texts[i], duplicate_group_id: v.evidence.duplicate_group_id, duplicate_status: v.evidence.duplicate_status })));
    const verdict = dup ?? await compareSemantic(texts, ports.semantic, { defer: ports.defer_semantic === true });
    return { verdict, normalized: texts, idStatus: values.map(() => null), values };
  }
  // EXACT
  const kind = exactKindOf(c.group.field_group, c.sub.sub_field);
  const normalized = values.map((v) => normalizeExact(v.value, kind));
  const idStatus = kind === 'id' ? values.map((v, i) => idStatusOf(person, v, normalized[i])) : values.map(() => null);
  if (kind === 'id') {
    const idv = adjudicateIdNumber(normalized.map((n, i) => ({ normalized: n, id_status: idStatus[i] as never })));
    // D-61: QR / cam kết 2 CMND-CCCD / xác nhận CMND địa phương thể hiện đủ các số → cùng một người; trừ khi có ≥ 2 số hiện tại xung đột (S5-R08).
    const linked = idv?.reason_code === 'CURRENT_ID_NUMBER_CONFLICT'
      ? null
      : adjudicateIdLinkedByDocument(values.map((v, i) => ({ evidence_id: v.evidence.evidence_id, doc_type_key: v.evidence.doc_type_key, normalized: normalized[i] })));
    if (linked) return { verdict: linked, normalized, idStatus, values };
    if (idv) return { verdict: idv, normalized, idStatus, values };
  }
  // D-43: lệch 1 ký tự so với đa số là nghi lỗi đọc — xét TRƯỚC xung đột bản trùng (bản trùng đọc sai 1 ký tự
  // không phải "2 nội dung khác nhau").
  const same = new Set(normalized.filter((n) => n !== null)).size <= 1;
  if (!same && (kind === 'code' || kind === 'plate')) {
    const near = nearMatchVerdict(values, normalized);
    if (near) return { verdict: near, normalized, idStatus, values };
  }
  const dup = adjudicateDuplicates(values.map((v, i) => ({ normalized: normalized[i], duplicate_group_id: v.evidence.duplicate_group_id, duplicate_status: v.evidence.duplicate_status })));
  if (dup) return { verdict: dup, normalized, idStatus, values };
  if (!same && kind === 'text' && unaccentedOnly(normalized)) {
    return { verdict: { match_status: 'MATCH', reason_code: 'UNACCENTED_MATCH', severity: 'INFO', reason: MATCH_REASON.UNACCENTED_MATCH }, normalized, idStatus, values };
  }
  const verdict: Verdict = same
    ? { match_status: 'MATCH', reason_code: 'EXACT_MATCH', severity: 'INFO', reason: MATCH_REASON.EXACT_MATCH }
    : { match_status: 'MISMATCH', reason_code: 'VALUE_CONFLICT', severity: 'REVIEW', reason: MATCH_REASON.VALUE_CONFLICT };
  return { verdict, normalized, idStatus, values };
}

function canonical(c: Comparison, values: CollectedValue[]): CrossCheckResult['canonical_source'] {
  const rule = c.sub.canonical_source ?? c.group.canonical_source;
  for (const k of rule.preferred_doc_type_keys) {
    const v = values.find((x) => x.evidence.doc_type_key === k);
    if (v) return { rule: rule.rule as never, doc_type_key: k, evidence_id: v.evidence.evidence_id };
  }
  return { rule: rule.rule as never, doc_type_key: null, evidence_id: null };
}

const scalar = (v: unknown) => (v === null || ['string', 'number', 'boolean'].includes(typeof v) ? v : JSON.stringify(v));

/** S5-R12: mỗi identifier_conflicts của S3 phải có 1 dòng MISMATCH cùng sub_field. */
export function rowsFromIdentifierConflicts(matrix: Matrix, s3: MapDossierData, usable: readonly EvidenceEnvelope[], existing: ReadonlyArray<{ asset_id: string | null; sub_field: string | null }>): Comparison[] {
  const out: Comparison[] = [];
  const byId = new Map(usable.map((e) => [e.evidence_id, e]));
  for (const a of s3.asset_registry) {
    for (const conflict of a.identifier_conflicts as Array<{ field: string; evidence_ids: string[] }>) {
      if (existing.some((r) => r.asset_id === a.asset_id && r.sub_field === conflict.field)) continue;
      const group = matrix.field_groups.find((g) => g.scope === 'ASSET' && g.asset_types.includes(a.asset_type));
      if (!group) continue;
      const sub = group.sub_fields.find((f) => f.sub_field === conflict.field)
        ?? { sub_field: conflict.field, field_label: conflict.field, comparison_method: 'EXACT' as const, canonical_source: null, sources: [] };
      const values: CollectedValue[] = [];
      for (const s of a.sources as Array<{ evidence_id: string; asset_index: number }>) {
        const e = byId.get(s.evidence_id);
        const d = (e?.data?.assets as Array<{ asset_index: number; identifiers: Record<string, string | null> }> | undefined)?.find((x) => x.asset_index === s.asset_index);
        const v = d?.identifiers[conflict.field];
        if (!e || !v) continue;
        const pos = (e.data!.assets as Array<{ asset_index: number }>).indexOf(d!);
        values.push({
          value: v, evidence: e, field_path: `data.assets[${pos}].identifiers.${conflict.field}`, party_index: null,
          source: { doc_type_key: e.doc_type_key, field_path: `data.assets[].identifiers.${conflict.field}`, attribution: 'ASSET', party_roles: null, index_field_path: null, filter: null, metric: null, period: null, unit: null },
        });
      }
      if (new Set(values.map((v) => v.evidence.evidence_id)).size >= 2) out.push({ group, sub, person_id: null, asset_id: a.asset_id, values });
    }
  }
  return out;
}

export async function runCrossCheck(input: CrossCheckInput, ports: CrossCheckPorts): Promise<CrossCheckStageResult> {
  const now = () => (input.now ? input.now() : new Date()).toISOString();
  const started_at = now();
  const fail = (status: 'UNAVAILABLE', code: string, message: string): CrossCheckStageResult => ({
    stage_key: 'cross_check_documents', status, status_code: code, message, started_at, finished_at: now(), content_preview: null, data: null, blocking_inputs: [],
  });
  const s3 = input.s3;
  if (s3 && s3.status === 'FAILED') return fail('UNAVAILABLE', 'DEPENDENCY_FAILED', 'Bước gom người và tài sản lỗi.');
  if (!s3 || !s3.data || !['SUCCESS', 'PARTIAL_SUCCESS'].includes(s3.status) || s3.data.role_registry.length === 0) {
    return fail('UNAVAILABLE', 'ROLE_REGISTRY_UNAVAILABLE', 'Chưa xác định được người trong hồ sơ nên không đối chiếu chéo.');
  }
  const matrix = loadMatrix();
  const { usable, skipped } = usableEvidences(input.evidences, s3.data);
  const persons = new Map(s3.data.role_registry.map((p) => [p.person_id, p]));

  const comparisons = collectComparisons(matrix, s3.data, usable);
  comparisons.push(...rowsFromIdentifierConflicts(matrix, s3.data, usable, comparisons.map((c) => ({ asset_id: c.asset_id, sub_field: c.sub.sub_field }))));

  const results: CrossCheckResult[] = [];
  for (const c of comparisons) {
    const person = c.person_id ? persons.get(c.person_id) : undefined;
    const j = await judge(c, person, ports);
    if (new Set(j.values.map((v) => v.evidence.evidence_id)).size < 2) continue;
    // Dòng từ identifier_conflicts luôn MISMATCH (S5-R12).
    const forced = !c.sub.sources.length;
    const verdict: Verdict = forced && j.verdict.match_status !== 'NEAR_MATCH' ? { match_status: 'MISMATCH', reason_code: 'VALUE_CONFLICT', severity: 'REVIEW', reason: 'Định danh tài sản lệch giữa các chứng từ.' } : j.verdict;
    const roles = person ? [...person.roles] : [];
    results.push({
      result_id: '',
      person_id: c.person_id,
      primary_role: person ? ROLE_PRIORITY.find((r) => person.roles.includes(r)) ?? null : null,
      roles,
      asset_id: c.asset_id,
      field_group: c.group.field_group,
      field_label: c.sub.sub_field ? `${c.group.field_label} — ${c.sub.field_label}` : c.group.field_label,
      sub_field: c.group.sub_fields.length === 1 && !forced ? null : c.sub.sub_field,
      comparison_method: c.sub.comparison_method,
      match_status: verdict.match_status,
      reason_code: verdict.reason_code as CrossCheckResult['reason_code'],
      severity: verdict.severity,
      requires_review: verdict.match_status !== 'MATCH' && verdict.reason_code !== SEMANTIC_DEFERRED_CODE,
      values: j.values.map((v, i) => ({
        value: (v.value && typeof v.value === 'object' ? v.value : scalar(v.value)) as never,
        normalized_value: scalar(j.normalized[i] ?? null) as never,
        id_status: j.idStatus[i] as never,
        metric: v.source.metric,
        period: v.source.period as never,
        unit: v.source.unit as never,
        source: { evidence_id: v.evidence.evidence_id, file_id: v.evidence.file_id, file_name: v.evidence.file_name, doc_type_key: v.evidence.doc_type_key, field_path: v.field_path, page: pageOf(v) },
        duplicate_group_id: v.evidence.duplicate_group_id,
        duplicate_status: v.evidence.duplicate_status,
      })),
      canonical_source: canonical(c, j.values),
      reason: verdict.reason,
    });
  }
  // S5-R16: người (theo person_id, rồi thứ tự nhóm/sub_field), dòng tài sản ở cuối theo asset_id.
  const groupRank = new Map(matrix.field_groups.map((g, i) => [g.field_group, i]));
  const num = (id: string | null) => (id === null ? Number.MAX_SAFE_INTEGER : Number(id.split('-')[1]));
  results.sort((a, b) => num(a.person_id) - num(b.person_id) || num(a.asset_id) - num(b.asset_id) || groupRank.get(a.field_group)! - groupRank.get(b.field_group)!);
  results.forEach((r, i) => { r.result_id = `xck-${i + 1}`; });

  const logic_findings = evaluateLogicRules(matrix, s3.data, usable);
  const data: CrossCheckData = {
    matrix_version: matrix.catalog_version,
    results,
    logic_findings,
    skipped_evidences: skipped as CrossCheckData['skipped_evidences'],
  };
  const success = input.evidences.filter((e) => e.status === 'SUCCESS').length;
  let status: CrossCheckStageResult['status'] = 'SUCCESS';
  let code = 'COMPLETED';
  if (success === 0) { status = 'INSUFFICIENT_DATA'; code = 'MISSING_PRIMARY_EVIDENCE'; }
  else if (success === 1) { status = 'INSUFFICIENT_DATA'; code = 'SINGLE_DOCUMENT_ONLY'; }
  else if (results.length === 0) { status = 'NOT_EVALUATED'; code = 'NO_COMPARABLE_PAIRS'; }
  else if (results.some((r) => r.match_status === 'UNDETERMINED' && r.reason_code !== SEMANTIC_DEFERRED_CODE)) { status = 'PARTIAL_SUCCESS'; code = 'UNDETERMINED_RESULTS_PRESENT'; }
  const count = (s: string) => results.filter((r) => r.match_status === s).length;
  return {
    stage_key: 'cross_check_documents',
    status,
    status_code: code,
    message: null,
    started_at,
    finished_at: now(),
    content_preview: {
      total_comparisons: results.length,
      match_count: count('MATCH'),
      mismatch_count: count('MISMATCH'),
      undetermined_count: count('UNDETERMINED'),
      near_match_count: count('NEAR_MATCH'),
      requires_review_count: results.filter((r) => r.requires_review).length,
      high_severity_count: results.filter((r) => r.severity === 'HIGH').length,
      logic_violation_count: logic_findings.filter((f) => f.violated).length,
      persons_compared: new Set(results.map((r) => r.person_id).filter(Boolean)).size,
      assets_compared: new Set(results.map((r) => r.asset_id).filter(Boolean)).size,
    },
    data,
    blocking_inputs: [],
  };
}
