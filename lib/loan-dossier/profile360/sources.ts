// Tra cứu dùng chung của hồ sơ 360: lá OCR → fact LAC (`record_id = {evidence_id}#{path}`), party → người S3, chọn giá trị một trường,
// số có nguồn cho stage 2, chi tiết của chủ thể. Mọi nơi trong profile360 đọc qua đây để cùng một quy tắc (bỏ bản bị thay thế, ngưỡng đọc).
import type { MapDossierData } from '../contracts/check-stages';
import { LAC_ACCEPT_CONFIDENCE } from '../context/build';
import type { LacFact, LoanApplicationContext } from '../context/schema';
import type { EvidenceEnvelope } from '../s2/common-schema';
import type { BasisValue, DetailFact, ProfileField, Verification } from './schema';

export interface Lookup {
  /** Evidence SUCCESS còn hiệu lực (bỏ bản bị thay thế, S3-R27), theo thứ tự S2. */
  evidences: EvidenceEnvelope[];
  /** Giấy đề nghị vay gốc (anchor S3), null khi S3 không chọn được. */
  anchor: EvidenceEnvelope | null;
  lac: LoanApplicationContext;
  factOf: (evidenceId: string, path: string) => LacFact | undefined;
  /** Người S3 của party `party_index` trên evidence, kèm cách ghép. */
  personOf: (evidenceId: string, partyIndex: number) => { person_id: string; matched_by: string } | undefined;
}

const topKey = (path: string) => path.split(/[.[]/)[0];

export function buildLookup(evidences: ReadonlyArray<EvidenceEnvelope>, s3: MapDossierData | null, lac: LoanApplicationContext): Lookup {
  const superseded = new Set(lac.meta.superseded_evidence_ids);
  const facts = new Map<string, LacFact>();
  for (const f of lac.facts) for (const s of f.sources) facts.set(s.record_id, f);
  const persons = new Map<string, { person_id: string; matched_by: string }>();
  let anchorId: string | null = null;
  for (const p of s3?.role_registry ?? []) {
    for (const m of p.mapped_evidences as Array<{ evidence_id?: unknown; party_index?: unknown; matched_by?: unknown }>) {
      const key = `${String(m.evidence_id)}#${String(m.party_index)}`;
      if (!persons.has(key)) persons.set(key, { person_id: p.person_id, matched_by: String(m.matched_by) });
      if (m.matched_by === 'ANCHOR' && typeof m.evidence_id === 'string') anchorId ??= m.evidence_id;
    }
  }
  const usable = evidences.filter((e) => e.status === 'SUCCESS' && e.data && !superseded.has(e.evidence_id));
  return {
    evidences: usable,
    anchor: usable.find((e) => e.evidence_id === anchorId) ?? null,
    lac,
    factOf: (evidenceId, path) => facts.get(`${evidenceId}#${path}`),
    personOf: (evidenceId, partyIndex) => persons.get(`${evidenceId}#${partyIndex}`),
  };
}

const get = (o: unknown, path: string): unknown =>
  path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);

/** Số tại `path` của evidence, kèm `record_id` và cờ cần soát theo độ tin cậy đọc của field cấp 1 (V2-R04). */
export function basisAt(e: EvidenceEnvelope | null | undefined, path: string): BasisValue | null {
  if (!e) return null;
  const v = get(e.data, path);
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const record = `${e.evidence_id}#${path}`;
  const conf = e.field_confidences[topKey(path)];
  return { value: v, record_ids: [record], review_record_ids: typeof conf === 'number' && conf >= LAC_ACCEPT_CONFIDENCE ? [] : [record] };
}

export function sumBasis(xs: ReadonlyArray<BasisValue | null>): BasisValue | null {
  const present = xs.filter((x): x is BasisValue => x !== null);
  if (present.length === 0) return null;
  return {
    value: present.reduce((n, x) => n + x.value, 0),
    record_ids: present.flatMap((x) => x.record_ids),
    review_record_ids: present.flatMap((x) => x.review_record_ids),
  };
}

export const valueAt = get;

/** `ANCHOR` / `ID_NUMBER` → VERIFIED, ghép theo tên → PARTIAL (L360-B03). */
export const verificationOf = (matchedBy: string): Verification => (matchedBy === 'ANCHOR' || matchedBy === 'ID_NUMBER' ? 'VERIFIED' : 'PARTIAL');

export const VERIFICATION_RANK: Record<Verification, number> = { VERIFIED: 0, PARTIAL: 1, UNVERIFIED: 2, NOT_REQUIRED: 3 };

export const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export interface Candidate { value: string | number | boolean; fact: LacFact | undefined }

export const EMPTY_FIELD: ProfileField = { value: null, fact_ids: [], trust: null, review: null };

/**
 * Chọn giá trị một trường từ các lần nhắc. `identity` (số GCN, mã số thuế): > 1 giá trị khác nhau → không chọn, `DISPUTED`.
 * `text` (tên, ngành, địa chỉ): khác nhau là bình thường (L360-B02), chọn giá trị nhắc nhiều nhất, hòa → nhắc trước.
 */
export function pickField(candidates: readonly Candidate[], mode: 'identity' | 'text', norm: (v: string | number | boolean) => string): ProfileField {
  if (candidates.length === 0) return EMPTY_FIELD;
  // COR-R09: giá trị người thẩm định đã bác không dự phần chọn (còn lại ít nhất một lần nhắc thì mới bỏ).
  const kept = candidates.filter((c) => c.fact?.trust !== 'OVERRULED');
  if (kept.length > 0 && kept.length < candidates.length) return pickField(kept, mode, norm);
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) groups.set(norm(c.value), [...(groups.get(norm(c.value)) ?? []), c]);
  const fact_ids = [...new Set(candidates.map((c) => c.fact?.fact_id).filter((x): x is string => !!x))];
  const review = candidates.some((c) => !c.fact || c.fact.review === 'REVIEW') ? 'REVIEW' : 'ACCEPTED';
  if (mode === 'identity' && groups.size > 1) return { value: null, fact_ids, trust: 'DISPUTED', review };
  const chosen = [...groups.values()].sort((a, b) => b.length - a.length)[0][0];
  return { value: chosen.value, fact_ids, trust: chosen.fact?.trust ?? null, review };
}

/** Trường lấy từ ĐÚNG một bản (anchor): giá trị của bản đó, trust / fact của LAC (bản khác lệch → LAC đã gắn `DISPUTED`). */
export function fieldAt(e: EvidenceEnvelope | null | undefined, path: string, lookup: Lookup): ProfileField {
  if (!e) return EMPTY_FIELD;
  const v = get(e.data, path);
  if (v === null || v === undefined || (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')) return EMPTY_FIELD;
  const fact = lookup.factOf(e.evidence_id, path);
  const siblings = fact ? lookup.lac.facts.filter((f) => f.subject_id === fact.subject_id && f.field === fact.field && f.trust !== 'SUPERSEDED' && f.trust !== 'OVERRULED' && !f.hidden) : [];
  // COR-R09: giá trị của bản này bị người thẩm định bác → trình bày giá trị được chọn của cùng trường.
  const chosen = fact?.trust === 'OVERRULED' ? chosenFor(lookup.lac, fact) : undefined;
  if (chosen) return { value: chosen.value, fact_ids: siblings.map((f) => f.fact_id), trust: chosen.trust, review: chosen.review };
  return { value: v, fact_ids: siblings.map((f) => f.fact_id), trust: fact?.trust ?? null, review: fact?.review ?? 'REVIEW' };
}

/** Fact được chọn (FACT_RESOLUTION) thay cho `overruled`. */
export function chosenFor(lac: LoanApplicationContext, overruled: LacFact): LacFact | undefined {
  const r = lac.resolutions?.find((x) => x.overruled_fact_ids.includes(overruled.fact_id));
  return r ? lac.facts.find((f) => f.fact_id === r.chosen_fact_id) : undefined;
}

export const normText = (v: string | number | boolean): string => String(v).normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN');

/** Chi tiết của chủ thể: fact LAC còn hiệu lực, không ẩn, trừ các trường đã có ô riêng. Hai fact cùng nhãn và giá trị chỉ giữ một dòng. */
export function detailsOf(lac: LoanApplicationContext, subjectId: string, exclude: ReadonlySet<string>): DetailFact[] {
  const seen = new Set<string>();
  const out: DetailFact[] = [];
  for (const f of lac.facts) {
    if (f.subject_id !== subjectId || f.hidden || f.trust === 'SUPERSEDED' || f.trust === 'OVERRULED' || exclude.has(f.field)) continue;
    const key = `${f.label}\u0000${normText(f.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fact_id: f.fact_id, field: f.field, label: f.label, value: f.value, trust: f.trust, review: f.review, doc_types: [...new Set(f.sources.map((s) => s.doc_type_key))] });
  }
  return out;
}
