// Thu thập giá trị theo (người | tài sản) × nhóm field (T-S5-02; S5-R02, R03, R04).
import type { MapDossierData } from '../contracts/check-stages';
import type { DocumentParty, EvidenceEnvelope } from '../s2/common-schema';
import type { Matrix, MatrixGroup, MatrixSource, MatrixSubField } from './matrix';

export interface CollectedValue {
  value: unknown;
  evidence: EvidenceEnvelope;
  /** Đường dẫn cụ thể, VD `data.parties[0].full_name`. */
  field_path: string;
  source: MatrixSource;
  /** party_index của party nguồn (PARTY / PARTY_INDEX_FIELD) — để tra id_status. */
  party_index: number | null;
}

export interface Comparison {
  group: MatrixGroup;
  sub: MatrixSubField;
  person_id: string | null;
  asset_id: string | null;
  values: CollectedValue[];
}

export type SkipReason = 'EVIDENCE_ERROR' | 'UNMAPPED' | 'ROLE_CONFLICT' | 'SUPERSEDED';
export interface SkippedEvidence { evidence_id: string; doc_type_key: string; skip_reason: SkipReason }

type Person = MapDossierData['role_registry'][number];
type Asset = MapDossierData['asset_registry'][number];

/** Đọc `a.b[].c` trên object; `[]` duyệt mảng. Trả mọi (giá trị, đường dẫn cụ thể, phần tử mảng đầu tiên). */
export function resolvePath(root: unknown, path: string): Array<{ value: unknown; path: string; element: unknown; index: number | null }> {
  const parts = path.split('.');
  let cur: Array<{ value: unknown; path: string; element: unknown; index: number | null }> = [{ value: root, path: '', element: null, index: null }];
  for (const part of parts) {
    const isArray = part.endsWith('[]');
    const key = isArray ? part.slice(0, -2) : part;
    const next: typeof cur = [];
    for (const c of cur) {
      const v = c.value && typeof c.value === 'object' ? (c.value as Record<string, unknown>)[key] : undefined;
      const p = c.path ? `${c.path}.${key}` : key;
      if (isArray) {
        if (Array.isArray(v)) v.forEach((x, i) => next.push({ value: x, path: `${p}[${i}]`, element: c.element ?? x, index: c.index ?? i }));
      } else if (v !== undefined) {
        next.push({ value: v, path: p, element: c.element, index: c.index });
      }
    }
    cur = next;
  }
  return cur;
}

const getRel = (obj: unknown, rel: string): unknown => rel.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

function passFilter(source: MatrixSource, element: unknown): boolean {
  if (!source.filter) return true;
  const v = getRel(element, source.filter.relative_path);
  if (v === null || v === undefined) return source.filter.include_when_null;
  return v === source.filter.equals;
}

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim())
  || (typeof v === 'object' && !Array.isArray(v) && v !== null && Object.values(v as Record<string, unknown>).every((x) => x === null));

/** Bộ dữ liệu đã lọc evidence không dùng được (S5-R04). */
export function usableEvidences(evidences: ReadonlyArray<EvidenceEnvelope>, s3: MapDossierData): { usable: EvidenceEnvelope[]; skipped: SkippedEvidence[] } {
  const unmapped = new Set(s3.unmapped_evidences.map((u) => u.evidence_id));
  const conflict = new Set(s3.role_registry.filter((p) => p.role_conflict)
    .flatMap((p) => (p.mapped_evidences as Array<{ evidence_id: string; doc_type_key: string }>).filter((m) => m.doc_type_key !== 'loan_application').map((m) => m.evidence_id)));
  const superseded = new Set(s3.superseded_evidences.map((s) => s.evidence_id));
  const usable: EvidenceEnvelope[] = [];
  const skipped: SkippedEvidence[] = [];
  for (const e of evidences) {
    const reason: SkipReason | null = e.status !== 'SUCCESS' ? 'EVIDENCE_ERROR' : superseded.has(e.evidence_id) ? 'SUPERSEDED'
      : unmapped.has(e.evidence_id) ? 'UNMAPPED' : conflict.has(e.evidence_id) ? 'ROLE_CONFLICT' : null;
    if (reason) skipped.push({ evidence_id: e.evidence_id, doc_type_key: e.doc_type_key, skip_reason: reason });
    else usable.push(e);
  }
  return { usable, skipped };
}

/** Giá trị của 1 nguồn cho người `p` (PARTY / SUBJECT_PARTY_ROLE / PARTY_INDEX_FIELD) hoặc tài sản (ASSET / ASSET_INDEX_FIELD). */
function valuesFor(e: EvidenceEnvelope, s: MatrixSource, personParties: ReadonlySet<number> | null, assetIndexes: ReadonlySet<number> | null): CollectedValue[] {
  const parties = (e.data?.parties as DocumentParty[] | undefined) ?? [];
  const roleOk = (p: DocumentParty) => !s.party_roles || s.party_roles.length === 0 || s.party_roles.includes(p.party_role);
  const out: CollectedValue[] = [];
  const push = (value: unknown, path: string, party_index: number | null) => {
    const vals = Array.isArray(value) ? value.map((v, i) => ({ v, p: `${path}[${i}]` })) : [{ v: value, p: path }];
    for (const { v, p } of vals) if (!isEmpty(v)) out.push({ value: v, evidence: e, field_path: p, source: s, party_index });
  };
  switch (s.attribution) {
    case 'PARTY': {
      if (!personParties) return [];
      for (const r of resolvePath(e, s.field_path.replace(/\[\]$/, ''))) {
        const party = r.element as DocumentParty | null;
        if (!party || !personParties.has(party.party_index) || !roleOk(party) || !passFilter(s, party)) continue;
        push(r.value, r.path, party.party_index);
      }
      return out;
    }
    case 'SUBJECT_PARTY_ROLE': {
      if (!personParties) return [];
      const subject = parties.find((p) => personParties.has(p.party_index) && roleOk(p));
      if (!subject) return [];
      for (const r of resolvePath(e, s.field_path)) push(r.value, r.path, subject.party_index);
      return out;
    }
    case 'PARTY_INDEX_FIELD': {
      if (!personParties || !s.index_field_path) return [];
      const idxRel = s.index_field_path.split('[].').pop()!;
      for (const r of resolvePath(e, s.field_path)) {
        const pi = getRel(r.element, idxRel);
        if (typeof pi !== 'number' || !personParties.has(pi) || !passFilter(s, r.element)) continue;
        push(r.value, r.path, pi);
      }
      return out;
    }
    case 'ASSET': {
      if (!assetIndexes) return [];
      for (const r of resolvePath(e, s.field_path)) {
        const a = r.element as { asset_index?: number } | null;
        if (!a || a.asset_index === undefined || !assetIndexes.has(a.asset_index) || !passFilter(s, a)) continue;
        push(r.value, r.path, null);
      }
      return out;
    }
    case 'ASSET_INDEX_FIELD': {
      if (!assetIndexes || !s.index_field_path) return [];
      const idxRel = s.index_field_path.split('[].').pop()!;
      for (const r of resolvePath(e, s.field_path)) {
        const ai = getRel(r.element, idxRel);
        if (typeof ai !== 'number' || !assetIndexes.has(ai) || !passFilter(s, r.element)) continue;
        push(r.value, r.path, null);
      }
      return out;
    }
    default:
      return [];
  }
}

/** Mọi phép so có ≥ 2 giá trị từ ≥ 2 evidence (S5-R04). Thứ tự: người (theo nhóm ma trận) rồi tài sản. */
export function collectComparisons(matrix: Matrix, s3: MapDossierData, usable: ReadonlyArray<EvidenceEnvelope>): Comparison[] {
  const byId = new Map(usable.map((e) => [e.evidence_id, e]));
  const partiesOf = (p: Person) => {
    const m = new Map<string, Set<number>>();
    for (const x of p.mapped_evidences as Array<{ evidence_id: string; party_index: number }>) {
      if (!m.has(x.evidence_id)) m.set(x.evidence_id, new Set());
      m.get(x.evidence_id)!.add(x.party_index);
    }
    return m;
  };
  const assetIdx = (a: Asset) => {
    const m = new Map<string, Set<number>>();
    for (const s of a.sources as Array<{ evidence_id: string; asset_index: number }>) {
      if (!m.has(s.evidence_id)) m.set(s.evidence_id, new Set());
      m.get(s.evidence_id)!.add(s.asset_index);
    }
    return m;
  };
  const enough = (vals: CollectedValue[]) => new Set(vals.map((v) => v.evidence.evidence_id)).size >= 2;
  const out: Comparison[] = [];

  const persons = [...s3.role_registry].sort((a, b) => Number(a.person_id.split('-')[1]) - Number(b.person_id.split('-')[1]));
  for (const p of persons) {
    const mine = partiesOf(p);
    for (const g of matrix.field_groups) {
      if (g.scope === 'ASSET' || !g.applicable_roles.some((r) => p.roles.includes(r as never))) continue;
      const targets: Array<{ assetId: string | null; evs: Map<string, Set<number>> | null }> = g.scope === 'PERSON_ASSET'
        ? s3.asset_registry.map((a) => ({ assetId: a.asset_id, evs: assetIdx(a) }))
        : [{ assetId: null, evs: null }];
      for (const t of targets) {
        for (const sub of g.sub_fields) {
          const vals: CollectedValue[] = [];
          for (const s of sub.sources) {
            for (const [evId, parties] of mine) {
              const e = byId.get(evId);
              if (!e || e.doc_type_key !== s.doc_type_key) continue;
              if (t.evs && !t.evs.has(evId)) continue;
              vals.push(...valuesFor(e, s, parties, null));
            }
          }
          const uniq = dedupe(vals);
          if (enough(uniq)) out.push({ group: g, sub, person_id: p.person_id, asset_id: t.assetId, values: uniq });
        }
      }
    }
  }
  const assets = [...s3.asset_registry].sort((a, b) => Number(a.asset_id.split('-')[1]) - Number(b.asset_id.split('-')[1]));
  for (const a of assets) {
    const idx = assetIdx(a);
    for (const g of matrix.field_groups) {
      if (g.scope !== 'ASSET' || !g.asset_types.includes(a.asset_type)) continue;
      for (const sub of g.sub_fields) {
        const vals: CollectedValue[] = [];
        for (const s of sub.sources) {
          for (const [evId, indexes] of idx) {
            const e = byId.get(evId);
            if (!e || e.doc_type_key !== s.doc_type_key) continue;
            vals.push(...valuesFor(e, s, null, indexes));
          }
        }
        const uniq = dedupe(vals);
        if (enough(uniq)) out.push({ group: g, sub, person_id: null, asset_id: a.asset_id, values: uniq });
      }
    }
  }
  return out;
}

function dedupe(vals: CollectedValue[]): CollectedValue[] {
  const seen = new Set<string>();
  return vals.filter((v) => {
    const k = `${v.evidence.evidence_id}|${v.field_path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
