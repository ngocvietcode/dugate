// Người và tài sản hợp nhất giữa các chứng từ (T-MD-03; MD-R08, MD-R09).
import type { CrossCheckData } from '../contracts/check-stages';
import type { MasterDocument, MasterEntity, MasterEntityField, MasterFieldKind } from '../contracts/master-dossier';
import { listAssets, listPersons, supersededEvidenceIds, type DossierGraph } from '../graph';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { normKey } from '../common/normalize';
import { nearMatch } from '../s5/compare-exact';
import { ACCEPT_CONFIDENCE, compareKey, fieldKind } from './field';

type CrossRow = CrossCheckData['results'][number];

const ROLE_LABEL: Record<string, string> = { borrower: 'Khách hàng vay', co_borrower: 'Người đồng vay', collateral_owner: 'Chủ TSBĐ', other: 'Đối tượng khác' };
const USAGE_LABEL: Record<string, string> = { collateral: 'TSBĐ', rental_income: 'Tài sản cho thuê' };
const ASSET_TYPE_LABEL: Record<string, string> = { real_estate: 'Bất động sản', apartment: 'Căn hộ', vehicle: 'Xe', deposit: 'Tiền gửi', other: 'Tài sản khác' };
const VALUATION_TYPES = ['real_estate_valuation_report', 'external_valuation_certificate', 'movable_asset_valuation_report'];
const IDENTITY_KEYS = ['full_name', 'id_number', 'date_of_birth', 'gender', 'permanent_address', 'current_address'] as const;

const topField = (path: string) => path.split(/[.[]/)[0];
const recordId = (v: CrossRow['values'][number]) => `${v.source.evidence_id}#${v.source.field_path.replace(/^data\./, '')}`;

interface Ctx { byId: Map<string, EvidenceEnvelope> }

function confOf(ctx: Ctx, rid: string): number | null {
  const [ev, path] = rid.split('#');
  return ctx.byId.get(ev)?.field_confidences[topField(path)] ?? null;
}
function minConf(ctx: Ctx, rids: string[]): number | null {
  const cs = rids.map((r) => confOf(ctx, r));
  return cs.length === 0 || cs.some((c) => c === null) ? null : Math.min(...(cs as number[]));
}
const reviewOf = (conf: number | null) => (conf !== null && conf >= ACCEPT_CONFIDENCE ? 'ACCEPTED' as const : 'REVIEW' as const);

/** MD-R08: trường thực thể từ một dòng S5. */
function fromCrossRow(ctx: Ctx, r: CrossRow): MasterEntityField {
  const path = r.sub_field ?? r.field_group;
  const rids = r.values.map(recordId);
  const raw = r.values.map((v) => v.value as unknown);
  const norm = r.values.map((v) => (v.normalized_value === null ? null : String(v.normalized_value)));
  const canonIdx = r.canonical_source?.evidence_id ? r.values.findIndex((v) => v.source.evidence_id === r.canonical_source!.evidence_id) : -1;
  const kind: MasterFieldKind = r.comparison_method === 'ADDRESS_REFERENCE' ? 'address'
    : r.comparison_method === 'METRIC' ? 'money' : fieldKind(path, raw.find((x) => x !== null) ?? null);
  const groups = new Map<string, number[]>();
  norm.forEach((k, i) => { if (k !== null) groups.set(k, [...(groups.get(k) ?? []), i]); });
  const candidates = [...groups.values()].map((idx) => ({ value: raw[idx[0]], evidence_ids: idx.map((i) => rids[i]) }));
  const base = {
    path, label: r.field_label, kind, candidates: [] as MasterEntityField['candidates'], outliers: [] as MasterEntityField['outliers'], note: null as string | null,
    canonical_doc_type_key: r.canonical_source?.doc_type_key ?? null, cross_check_result_id: r.result_id,
  };
  if (r.match_status === 'MATCH') {
    const conf = minConf(ctx, rids);
    return { ...base, value: raw[canonIdx >= 0 ? canonIdx : 0], status: 'AGREED', review_status: reviewOf(conf), confidence: conf, sources: rids };
  }
  if (r.match_status === 'NEAR_MATCH') {
    const near = nearMatch(norm, r.values.map((v) => v.source.evidence_id));
    if (near) {
      const major = norm.map((k, i) => (k === near.majority ? i : -1)).filter((i) => i >= 0);
      const conf = minConf(ctx, major.map((i) => rids[i]));
      return {
        ...base, value: raw[major[0]], status: 'OCR_NORMALIZED', review_status: reviewOf(conf), confidence: conf, sources: major.map((i) => rids[i]),
        outliers: [{ evidence_id: rids[near.outlier], raw_value: raw[near.outlier], reason_code: 'PROBABLE_OCR_ERROR' }], note: r.reason,
      };
    }
  }
  // MISMATCH / UNDETERMINED (hoặc NEAR_MATCH không dựng lại được): giữ giá trị chứng từ chuẩn, cần rà soát.
  return {
    ...base, value: canonIdx >= 0 ? raw[canonIdx] : null, status: candidates.length >= 2 ? 'CONFLICT' : 'SINGLE_SOURCE', review_status: 'REVIEW',
    confidence: null, sources: canonIdx >= 0 ? [rids[canonIdx]] : [], candidates: candidates.length >= 2 ? candidates : [], note: r.reason,
  };
}

/** Trường chỉ có ở 1 chứng từ / lấy từ S3: AGREED khi ≥ 2 bản ghi cùng giá trị, SINGLE_SOURCE khi 1, không nguồn → SINGLE_SOURCE/REVIEW. */
function fromValue(ctx: Ctx, path: string, label: string, value: unknown, rids: string[], kindHint?: MasterFieldKind): MasterEntityField {
  const conf = rids.length ? minConf(ctx, rids) : null;
  return {
    path, label, kind: kindHint ?? fieldKind(path, value), value, status: rids.length >= 2 ? 'AGREED' : 'SINGLE_SOURCE',
    review_status: rids.length ? reviewOf(conf) : 'REVIEW', confidence: conf, sources: rids, candidates: [], outliers: [], note: rids.length ? null : 'Không trỏ được lá nguồn.',
    canonical_doc_type_key: null, cross_check_result_id: null,
  };
}

const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);

/**
 * Người và tài sản đọc từ DossierGraph (dựng một lần từ output S3): thuộc tính nằm ở node, chứng từ nguồn là cạnh
 * `MENTIONED_IN`, danh sách bản bị thay thế là thuộc tính node evidence. Không còn tra mảng song song
 * `customer_360` / `role_registry` / `asset_registry` bằng `.find`.
 */
export function buildEntities(
  evidences: ReadonlyArray<EvidenceEnvelope>,
  graph: DossierGraph | null,
  crossRows: ReadonlyArray<CrossRow>,
  documents: ReadonlyArray<MasterDocument>,
): { persons: MasterEntity[]; assets: MasterEntity[] } {
  if (!graph) return { persons: [], assets: [] };
  const ctx: Ctx = { byId: new Map(evidences.map((e) => [e.evidence_id, e])) };
  const superseded = supersededEvidenceIds(graph);

  const persons = listPersons(graph).map((c): MasterEntity => {
    const rows = crossRows.filter((r) => r.person_id === c.person_id && r.asset_id === null);
    const fields = rows.map((r) => fromCrossRow(ctx, r));
    const covered = new Set(rows.map((r) => r.sub_field ?? r.field_group));
    const mapped = c.mentions;
    for (const key of IDENTITY_KEYS) {
      if (covered.has(key)) continue;
      const value = c.identity[key];
      if (value === null || value === undefined) continue;
      const kind = fieldKind(key, value);
      const target = compareKey(kind, value);
      const rids = mapped.flatMap((m) => {
        const e = ctx.byId.get(m.evidence_id);
        if (!e?.data || superseded.has(e.evidence_id)) return [];
        const parties = (e.data.parties as Array<Record<string, unknown>> | undefined) ?? [];
        const pos = parties.findIndex((p) => p.party_index === m.party_index);
        if (pos < 0 || compareKey(kind, parties[pos][key]) !== target) return [];
        return [`${e.evidence_id}#parties[${pos}].${key}${kind === 'address' ? '.full_text' : ''}`];
      });
      fields.push(fromValue(ctx, key, key, value, [...new Set(rids)], kind));
    }
    const role = ROLE_LABEL[c.primary_role] ?? c.primary_role;
    return {
      entity_id: c.person_id,
      label: `${role}${c.identity.full_name ? ` · ${c.identity.full_name}` : ''}`,
      fields,
      document_ids: documents.filter((d) => d.person_id === c.person_id).map((d) => d.document_id),
    };
  });

  const assets = listAssets(graph).map((a): MasterEntity => {
    const rows = crossRows.filter((r) => r.asset_id === a.asset_id && r.person_id === null);
    const fields = rows.map((r) => fromCrossRow(ctx, r));
    const covered = new Set(rows.map((r) => r.sub_field ?? r.field_group));
    const srcs = a.sources.filter((s) => !superseded.has(s.evidence_id));
    const assetLeaf = (s: { evidence_id: string; asset_index: number }, kind: 'assets' | 'asset_details', path: string) => {
      const e = ctx.byId.get(s.evidence_id);
      const arr = (e?.data?.[kind] as Array<Record<string, unknown>> | undefined) ?? [];
      const pos = arr.findIndex((x) => x.asset_index === s.asset_index);
      return pos < 0 ? null : { rid: `${s.evidence_id}#${kind}[${pos}].${path}`, value: get(arr[pos], path), e: e! };
    };
    fields.unshift(fromValue(ctx, 'asset_type', 'asset_type', a.asset_type,
      srcs.map((s) => assetLeaf(s, 'assets', 'asset_type')).filter((l) => l && l.value === a.asset_type).map((l) => l!.rid), 'enum'));
    if ((a.usage_contexts as string[]).length) {
      fields.push(fromValue(ctx, 'usage_contexts', 'usage_contexts', [...(a.usage_contexts as string[])],
        srcs.map((s) => assetLeaf(s, 'assets', 'usage_context_hint')).filter((l) => l && (a.usage_contexts as string[]).includes(String(l.value))).map((l) => l!.rid), 'enum'));
    }
    for (const [k, v] of Object.entries(a.identifiers as Record<string, string | null>)) {
      if (!v || covered.has(k)) continue;
      const key = normKey(v);
      const rids = srcs.map((s) => assetLeaf(s, 'assets', `identifiers.${k}`)).filter((l) => l && l.value && normKey(String(l.value)) === key).map((l) => l!.rid);
      fields.push(fromValue(ctx, `identifiers.${k}`, `identifiers.${k}`, v, rids, 'code'));
    }
    // Giá trị định giá mới nhất (cùng cách chọn với đầu vào tài chính V2-R06), khi S5 chưa có dòng asset_value.
    if (!covered.has('asset_value')) {
      const vals = srcs
        .filter((s) => VALUATION_TYPES.includes(ctx.byId.get(s.evidence_id)?.doc_type_key ?? ''))
        .map((s) => assetLeaf(s, 'asset_details', 'valuation_value'))
        .filter((l): l is NonNullable<typeof l> => Boolean(l) && typeof l!.value === 'number')
        .map((l) => ({ ...l, issue: (get(l.e.data, 'legal_info.issue_date') as string | null | undefined) ?? '' }))
        .sort((x, y) => (x.issue === y.issue ? 0 : x.issue < y.issue ? 1 : -1));
      if (vals[0]) fields.push(fromValue(ctx, 'valuation_value', 'valuation_value', vals[0].value, [vals[0].rid], 'money'));
    }
    const purpose = (a.usage_contexts as string[]).map((u) => USAGE_LABEL[u] ?? u).join(' + ');
    const type = ASSET_TYPE_LABEL[a.asset_type] ?? a.asset_type;
    return {
      entity_id: a.asset_id,
      label: `${purpose || type} · ${type} (${a.asset_id})`,
      fields,
      document_ids: documents.filter((d) => d.asset_id === a.asset_id).map((d) => d.document_id),
    };
  });
  return { persons, assets };
}
