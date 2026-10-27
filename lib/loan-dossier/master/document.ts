// Chứng từ hợp nhất theo mục checklist (T-MD-02; MD-R02, MD-R03, MD-R04, MD-R05, MD-R12).
import type { CheckChecklistData, MapDossierData } from '../contracts/check-stages';
import type { MasterCopyRole, MasterDocument } from '../contracts/master-dossier';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { isScopeLeaf, sortKey } from '../s2/duplicates';
import { isAddressValue, mergeField, type CopyValue } from './field';

type ChecklistItem = CheckChecklistData['items'][number];

const topField = (path: string) => path.split(/[.[]/)[0];

/**
 * Lá của `data` theo đường dẫn CHUẨN (mảng sắp theo khóa party/tài sản như S2-R18, bỏ `*_index`, bỏ lá phạm vi chụp),
 * kèm đường dẫn GỐC trong bản đó (để trỏ evidence record). Địa chỉ object là một lá.
 */
export function alignedLeaves(data: Record<string, unknown>): Map<string, { orig: string; value: unknown }> {
  const out = new Map<string, { orig: string; value: unknown }>();
  const walk = (v: unknown, canon: string, orig: string) => {
    if (Array.isArray(v)) {
      v.map((x, i) => ({ x, i, k: sortKey(x) }))
        .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
        .forEach((e, pos) => walk(e.x, `${canon}[${pos}]`, `${orig}[${e.i}]`));
      return;
    }
    if (v && typeof v === 'object' && !isAddressValue(v)) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k.endsWith('_index')) continue;
        walk(x, canon ? `${canon}.${k}` : k, orig ? `${orig}.${k}` : k);
      }
      return;
    }
    if (!canon || isScopeLeaf(orig)) return;
    out.set(canon, { orig, value: v ?? null });
  };
  walk(data, '', '');
  return out;
}

const meanConfidence = (e: EvidenceEnvelope) => {
  const vs = Object.values(e.field_confidences);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
};
const issueDate = (e: EvidenceEnvelope) =>
  ((e.data?.legal_info as { issue_date?: string | null } | undefined)?.issue_date ?? null);
const where = (e: EvidenceEnvelope) =>
  `${e.doc_type_label} (${e.file_name} · tr.${e.page_range[0]}${e.page_range[1] !== e.page_range[0] ? `-${e.page_range[1]}` : ''})`;

interface CopyPlan { e: EvidenceEnvelope; role: MasterCopyRole; excluded_reason: string | null }

/**
 * MD-R04: vai trò bản. Chỉ gộp các bản của CÙNG một chứng từ (cùng loại + cùng nhóm trùng S2-R18); cụm khác của mục
 * (VD 2 báo cáo CIC khác ngày tra cứu) là bản thể khác → EXCLUDED/OTHER_INSTANCE, không trộn giá trị.
 * Chọn cụm: loại ưu tiên của mục, rồi ngày cấp mới nhất, rồi nhiều bản hơn, rồi thứ tự S2.
 */
export function planCopies(
  evidences: ReadonlyArray<EvidenceEnvelope>,
  superseded: ReadonlySet<string>,
  preferredDocType: string | null,
  order: ReadonlyMap<string, number>,
): CopyPlan[] {
  const plans: CopyPlan[] = [];
  const usable: EvidenceEnvelope[] = [];
  for (const e of evidences) {
    if (superseded.has(e.evidence_id)) plans.push({ e, role: 'SUPERSEDED', excluded_reason: null });
    else if (e.status !== 'SUCCESS' || !e.data) plans.push({ e, role: 'EXCLUDED', excluded_reason: e.reason_code ?? 'ERROR' });
    else usable.push(e);
  }
  const clusters = new Map<string, EvidenceEnvelope[]>();
  for (const e of usable) {
    const k = `${e.doc_type_key}\u0000${e.duplicate_group_id ?? e.evidence_id}`;
    clusters.set(k, [...(clusters.get(k) ?? []), e]);
  }
  const ranked = [...clusters.values()].sort((a, b) => {
    const pa = a[0].doc_type_key === preferredDocType ? 0 : 1;
    const pb = b[0].doc_type_key === preferredDocType ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const da = a.map(issueDate).filter(Boolean).sort().pop() ?? '';
    const db = b.map(issueDate).filter(Boolean).sort().pop() ?? '';
    if (da !== db) return da < db ? 1 : -1;
    if (a.length !== b.length) return b.length - a.length;
    return Math.min(...a.map((e) => order.get(e.evidence_id) ?? 0)) - Math.min(...b.map((e) => order.get(e.evidence_id) ?? 0));
  });
  ranked.forEach((cluster, ci) => {
    if (ci > 0) { for (const e of cluster) plans.push({ e, role: 'EXCLUDED', excluded_reason: 'OTHER_INSTANCE' }); return; }
    const primary = [...cluster].sort((a, b) => meanConfidence(b) - meanConfidence(a) || (order.get(a.evidence_id) ?? 0) - (order.get(b.evidence_id) ?? 0))[0];
    for (const e of cluster) plans.push({ e, role: e === primary ? 'PRIMARY' : 'DUPLICATE', excluded_reason: null });
  });
  return plans.sort((a, b) => (order.get(a.e.evidence_id) ?? 0) - (order.get(b.e.evidence_id) ?? 0));
}

/** MD-R05 trên các bản PRIMARY + DUPLICATE; thứ tự trường theo bản PRIMARY rồi các bản sau. */
export function mergeCopies(plans: ReadonlyArray<CopyPlan>): MasterDocument['fields'] {
  const merging = plans.filter((p) => p.role === 'PRIMARY' || p.role === 'DUPLICATE')
    .sort((a, b) => (a.role === 'PRIMARY' ? -1 : b.role === 'PRIMARY' ? 1 : 0));
  if (merging.length === 0) return [];
  const leaves = merging.map((p) => ({ p, map: alignedLeaves(p.e.data!) }));
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const l of leaves) for (const k of l.map.keys()) if (!seen.has(k)) { seen.add(k); paths.push(k); }
  return paths.map((canon) => {
    const values: CopyValue[] = [];
    let label = canon;
    for (const { p, map } of leaves) {
      const leaf = map.get(canon);
      if (!leaf) continue;
      if (label === canon) label = leaf.orig;
      const recordPath = isAddressValue(leaf.value) ? `${leaf.orig}.full_text` : leaf.orig;
      values.push({
        record_id: `${p.e.evidence_id}#${recordPath}`, evidence_id: p.e.evidence_id, value: leaf.value,
        confidence: p.e.field_confidences[topField(leaf.orig)] ?? null, primary: p.role === 'PRIMARY', where: where(p.e),
      });
    }
    // Đường dẫn của trường = đường dẫn gốc trong bản PRIMARY (bản đầu có lá này).
    return mergeField(label, label, values);
  });
}

export interface DocumentInput {
  evidences: ReadonlyArray<EvidenceEnvelope>;
  s3: MapDossierData | null;
  checklist: CheckChecklistData | null;
}

/** MD-R02 + MD-R03: `documents` theo dòng S4, `other_documents` cho evidence SUCCESS không thuộc dòng nào. */
export function buildDocuments(input: DocumentInput): { documents: MasterDocument[]; other_documents: MasterDocument[] } {
  const byId = new Map(input.evidences.map((e) => [e.evidence_id, e]));
  const order = new Map(input.evidences.map((e, i) => [e.evidence_id, i]));
  const superseded = new Set((input.s3?.superseded_evidences ?? []).map((s) => s.evidence_id));
  const excluded = (input.checklist?.excluded_evidences ?? []) as Array<{ evidence_id: string; doc_type_key: string }>;
  const covered = new Set<string>();
  let n = 0;
  const mk = (it: ChecklistItem | null, evs: EvidenceEnvelope[], preferred: string | null): MasterDocument => {
    const plans = planCopies(evs, superseded, preferred, order);
    const fields = mergeCopies(plans);
    const lead = plans.find((p) => p.role === 'PRIMARY')?.e ?? evs[0] ?? null;
    n += 1;
    return {
      document_id: `mdoc-${n}`,
      item_key: it?.item_key ?? null,
      item_label: it?.item_label ?? null,
      checklist_group: it?.checklist_group ?? null,
      required: it ? it.required : null,
      checklist_status: it?.status ?? null,
      doc_type_key: lead?.doc_type_key ?? preferred,
      doc_type_label: lead?.doc_type_label ?? null,
      person_id: it?.person_id ?? null,
      asset_id: it?.asset_id ?? null,
      copies: plans.map((p) => ({ evidence_id: p.e.evidence_id, file_name: p.e.file_name, page_range: [p.e.page_range[0], p.e.page_range[1]] as [number, number], role: p.role, excluded_reason: p.excluded_reason })),
      fields,
    };
  };

  const documents = (input.checklist?.items ?? []).map((it) => {
    const preferred = it.substituted_by_doc_type_key ?? it.doc_type_key;
    const ids = [...new Set(it.found_in.map((f) => f.evidence_id))];
    // Bản nhận nhầm loại (S4-R26) của loại này vẫn liệt kê để truy vết, vai trò EXCLUDED.
    for (const x of excluded) if (preferred && x.doc_type_key === preferred && !ids.includes(x.evidence_id)) ids.push(x.evidence_id);
    const evs = ids.map((id) => byId.get(id)).filter((e): e is EvidenceEnvelope => Boolean(e));
    for (const e of evs) covered.add(e.evidence_id);
    return mk(it, evs, preferred);
  });

  const rest = input.evidences.filter((e) => e.status === 'SUCCESS' && e.data && !covered.has(e.evidence_id) && !superseded.has(e.evidence_id));
  const clusters = new Map<string, EvidenceEnvelope[]>();
  for (const e of rest) {
    const k = `${e.doc_type_key}\u0000${e.duplicate_group_id ?? e.evidence_id}`;
    clusters.set(k, [...(clusters.get(k) ?? []), e]);
  }
  const other_documents = [...clusters.values()].map((evs) => mk(null, evs, evs[0].doc_type_key));
  return { documents, other_documents };
}
