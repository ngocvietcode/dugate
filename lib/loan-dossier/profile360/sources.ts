// Tra cứu dùng chung của hồ sơ 360: lá OCR → fact LAC (`record_id = {evidence_id}#{path}`), party → người S3, chọn giá trị một trường.
import type { MapDossierData } from '../contracts/check-stages';
import type { LacFact, LoanApplicationContext } from '../context/schema';
import type { EvidenceEnvelope } from '../s2/common-schema';
import type { ProfileField, Verification } from './schema';

export interface Lookup {
  /** Evidence SUCCESS còn hiệu lực (bỏ bản bị thay thế, S3-R27), theo thứ tự S2. */
  evidences: EvidenceEnvelope[];
  factOf: (evidenceId: string, path: string) => LacFact | undefined;
  /** Người S3 của party `party_index` trên evidence, kèm cách ghép. */
  personOf: (evidenceId: string, partyIndex: number) => { person_id: string; matched_by: string } | undefined;
}

export function buildLookup(evidences: ReadonlyArray<EvidenceEnvelope>, s3: MapDossierData | null, lac: LoanApplicationContext): Lookup {
  const superseded = new Set(lac.meta.superseded_evidence_ids);
  const facts = new Map<string, LacFact>();
  for (const f of lac.facts) for (const s of f.sources) facts.set(s.record_id, f);
  const persons = new Map<string, { person_id: string; matched_by: string }>();
  for (const p of s3?.role_registry ?? []) {
    for (const m of p.mapped_evidences as Array<{ evidence_id?: unknown; party_index?: unknown; matched_by?: unknown }>) {
      const key = `${String(m.evidence_id)}#${String(m.party_index)}`;
      if (!persons.has(key)) persons.set(key, { person_id: p.person_id, matched_by: String(m.matched_by) });
    }
  }
  return {
    evidences: evidences.filter((e) => e.status === 'SUCCESS' && e.data && !superseded.has(e.evidence_id)),
    factOf: (evidenceId, path) => facts.get(`${evidenceId}#${path}`),
    personOf: (evidenceId, partyIndex) => persons.get(`${evidenceId}#${partyIndex}`),
  };
}

/** `ANCHOR` / `ID_NUMBER` → VERIFIED, ghép theo tên → PARTIAL (L360-B03). */
export const verificationOf = (matchedBy: string): Verification => (matchedBy === 'ANCHOR' || matchedBy === 'ID_NUMBER' ? 'VERIFIED' : 'PARTIAL');

export const VERIFICATION_RANK: Record<Verification, number> = { VERIFIED: 0, PARTIAL: 1, UNVERIFIED: 2 };

export const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export interface Candidate { value: string | number | boolean; fact: LacFact | undefined }

const EMPTY: ProfileField = { value: null, fact_ids: [], trust: null, review: null };

/**
 * Chọn giá trị một trường từ các lần nhắc. `identity` (số GCN, mã số thuế, số tiền khoản vay): > 1 giá trị khác nhau → không chọn,
 * `DISPUTED`. `text` (tên, ngành, địa chỉ): khác nhau là bình thường (L360-B02), chọn giá trị nhắc nhiều nhất, hòa → nhắc trước.
 */
export function pickField(candidates: readonly Candidate[], mode: 'identity' | 'text', norm: (v: string | number | boolean) => string): ProfileField {
  if (candidates.length === 0) return EMPTY;
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) groups.set(norm(c.value), [...(groups.get(norm(c.value)) ?? []), c]);
  const fact_ids = [...new Set(candidates.map((c) => c.fact?.fact_id).filter((x): x is string => !!x))];
  const review = candidates.some((c) => !c.fact || c.fact.review === 'REVIEW') ? 'REVIEW' : 'ACCEPTED';
  if (mode === 'identity' && groups.size > 1) return { value: null, fact_ids, trust: 'DISPUTED', review };
  const chosen = [...groups.values()].sort((a, b) => b.length - a.length)[0][0];
  return { value: chosen.value, fact_ids, trust: chosen.fact?.trust ?? null, review };
}

export const normText = (v: string | number | boolean): string => String(v).normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN');
