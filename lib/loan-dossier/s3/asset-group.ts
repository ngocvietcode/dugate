// Gom nhóm tài sản bằng union-find, nối gần đúng, nối yếu theo hint (T-S3-08; S3-R14, R15, R16).
import { distance } from 'fastest-levenshtein';

import { normKey } from '../common/normalize';
import type { AssetDescriptor, DocumentParty } from '../s2/common-schema';
import { NEAR_MATCH_MIN_LENGTH } from '../s5/compare-exact';
import { assetKeys, hasFullKey, plateKey } from './asset-key';
import { confidenceOf, type Evidence } from './types';

export type LinkKind = 'SEED' | 'EXACT' | 'APPROXIMATE' | 'WEAK';

export interface Descriptor {
  evidence_id: string;
  evidence_order: number;
  doc_type_key: string;
  asset_index: number;
  descriptor: AssetDescriptor;
  /** `field_confidences.assets` của evidence. */
  confidence: number;
  /** Được trỏ bởi `parties[].ownership.asset_index` của chính evidence (ưu tiên nguồn mức 1, S3-R16). */
  owned: boolean;
}

export interface IdentifierConflict {
  field: string;
  values: string[];
  evidence_ids: string[];
  /**
   * D-41 (S3-R15): ≥ 2 chứng từ ghi giống nhau, đúng 1 chứng từ lệch đúng 1 ký tự (mã dài ≥ 6) — nghi lỗi đọc.
   * Vẫn ghi nhận để S5 hiện "Gần khớp", nhưng không làm tài sản mất trạng thái CONFIRMED.
   */
  probable_ocr_error: boolean;
  /** Chứng từ ghi giá trị lệch khi `probable_ocr_error`; còn lại []. */
  outlier_evidence_ids: string[];
}

export interface AssetGroup {
  asset_id: string;
  members: Descriptor[];
  /** Cách mỗi member vào nhóm (song song `members`). */
  links: LinkKind[];
  identifier_conflicts: IdentifierConflict[];
  /** S3-R15(3): bắc cầu vẫn đưa 2 descriptor cùng evidence vào nhóm. */
  ambiguous: boolean;
  weak: boolean;
}

const FAMILY = (t: string) => (t === 'real_estate' || t === 'apartment' ? 'property' : t === 'vehicle' ? 'vehicle' : null);
const APPROX_FIELDS = ['chassis_number', 'engine_number', 'certificate_number'] as const;
const IDENTIFIER_FIELDS = [
  'certificate_number', 'certificate_book_number', 'land_parcel_number', 'map_sheet_number', 'apartment_number',
  'building_name', 'project_name', 'license_plate', 'chassis_number', 'engine_number', 'registration_number',
] as const;

const keyOf = (field: string, v: string | null) => (field === 'license_plate' ? plateKey(v) : normKey(v));

/** Mọi descriptor của evidence SUCCESS theo thứ tự evidences rồi asset_index. */
export function collectDescriptors(evidences: ReadonlyArray<Evidence>): Descriptor[] {
  const out: Descriptor[] = [];
  evidences.forEach((e, order) => {
    if (e.status !== 'SUCCESS' || !e.data) return;
    const assets = [...((e.data.assets as AssetDescriptor[] | undefined) ?? [])].sort((a, b) => a.asset_index - b.asset_index);
    const owned = new Set(((e.data.parties as DocumentParty[] | undefined) ?? []).map((p) => p.ownership?.asset_index).filter((i): i is number => i !== undefined && i !== null));
    for (const d of assets) {
      out.push({
        evidence_id: e.evidence_id, evidence_order: order, doc_type_key: e.doc_type_key, asset_index: d.asset_index,
        descriptor: d, confidence: confidenceOf(e, 'assets'), owned: owned.has(d.asset_index),
      });
    }
  });
  return out;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number { while (this.parent[i] !== i) { this.parent[i] = this.parent[this.parent[i]]; i = this.parent[i]; } return i; }
  union(a: number, b: number): void { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb); }
}

/** Nối gần đúng: chưa có khóa chung, một field (khung/máy/GCN) dài ≥ 6 lệch đúng 1 ký tự, không field định danh nào khác mâu thuẫn. */
function approxLink(a: AssetDescriptor, b: AssetDescriptor): boolean {
  if (FAMILY(a.asset_type) === null || FAMILY(a.asset_type) !== FAMILY(b.asset_type)) return false;
  const nearFields = new Set<string>();
  for (const f of APPROX_FIELDS) {
    const ka = keyOf(f, a.identifiers[f]);
    const kb = keyOf(f, b.identifiers[f]);
    if (ka && kb && ka.length >= 6 && kb.length >= 6 && distance(ka, kb) === 1) nearFields.add(f);
  }
  if (nearFields.size === 0) return false;
  // Mọi field định danh khác (ngoài field lệch 1 ký tự) phải không mâu thuẫn.
  return IDENTIFIER_FIELDS.every((f) => {
    if (nearFields.has(f)) return true;
    const ka = keyOf(f, a.identifiers[f]); const kb = keyOf(f, b.identifiers[f]);
    return !ka || !kb || ka === kb;
  });
}

function components(n: number, edges: Array<[number, number]>): number[][] {
  const uf = new UnionFind(n);
  for (const [a, b] of edges) uf.union(a, b);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) groups.set(uf.find(i), [...(groups.get(uf.find(i)) ?? []), i]);
  return [...groups.values()];
}

const hasSameEvidencePair = (idx: number[], ds: Descriptor[]) => new Set(idx.map((i) => ds[i].evidence_id)).size < idx.length;

export function groupAssets(ds: Descriptor[]): AssetGroup[] {
  const n = ds.length;
  const exact: Array<[number, number]> = [];
  const approx: Array<[number, number]> = [];
  const keys = ds.map((d) => new Set(assetKeys(d.descriptor)));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (ds[i].evidence_id === ds[j].evidence_id) continue;
      if ([...keys[i]].some((k) => keys[j].has(k))) exact.push([i, j]);
      else if (approxLink(ds[i].descriptor, ds[j].descriptor)) approx.push([i, j]);
    }
  }
  // S3-R15(3): bắc cầu đưa 2 descriptor cùng evidence vào 1 nhóm → bỏ cạnh gần đúng của nhóm đó.
  let comps = components(n, [...exact, ...approx]);
  const badRoots = new Set(comps.filter((c) => hasSameEvidencePair(c, ds)).flatMap((c) => c));
  const keptApprox = approx.filter(([a, b]) => !badRoots.has(a) && !badRoots.has(b));
  comps = components(n, [...exact, ...keptApprox]);

  // S3-R15(4): nối yếu descriptor có hint nhưng không có khóa đầy đủ vào đúng 1 nhóm cùng họ có khóa đầy đủ.
  const weakInto = new Map<number, number>();
  const compOf = new Map<number, number>();
  comps.forEach((c, ci) => c.forEach((i) => compOf.set(i, ci)));
  for (let i = 0; i < n; i++) {
    const d = ds[i];
    const fam = FAMILY(d.descriptor.asset_type);
    if (!fam || hasFullKey(d.descriptor) || d.descriptor.usage_context_hint === null || comps[compOf.get(i)!].length > 1) continue;
    const candidates = comps
      .map((c, ci) => ({ c, ci }))
      .filter(({ c, ci }) => ci !== compOf.get(i) && c.some((j) => FAMILY(ds[j].descriptor.asset_type) === fam && hasFullKey(ds[j].descriptor)));
    if (candidates.length === 1) weakInto.set(i, candidates[0].ci);
  }
  const finalMembers = comps.map((c) => [...c]);
  const weakMembers = new Set<number>();
  for (const [i, ci] of weakInto) {
    const own = compOf.get(i)!;
    finalMembers[own] = finalMembers[own].filter((x) => x !== i);
    finalMembers[ci].push(i);
    weakMembers.add(i);
  }

  const approxSet = new Set(keptApprox.flat());
  const groups = finalMembers
    .filter((m) => m.length > 0)
    .map((m) => m.sort((a, b) => ds[a].evidence_order - ds[b].evidence_order || ds[a].asset_index - ds[b].asset_index))
    .sort((a, b) => ds[a[0]].evidence_order - ds[b[0]].evidence_order || ds[a[0]].asset_index - ds[b[0]].asset_index);

  return groups.map((idx, gi) => {
    const members = idx.map((i) => ds[i]);
    const links: LinkKind[] = idx.map((i, k) => (k === 0 ? 'SEED' : weakMembers.has(i) ? 'WEAK' : approxSet.has(i) && !exact.some(([a, b]) => (a === i || b === i) && idx.includes(a === i ? b : a)) ? 'APPROXIMATE' : 'EXACT'));
    const identifier_conflicts: IdentifierConflict[] = [];
    for (const f of IDENTIFIER_FIELDS) {
      const seen = new Map<string, { raw: string; evidence: Set<string> }>();
      for (const m of members) {
        const raw = m.descriptor.identifiers[f];
        const k = keyOf(f, raw);
        if (!k || !raw) continue;
        const entry = seen.get(k) ?? { raw, evidence: new Set<string>() };
        entry.evidence.add(m.evidence_id);
        seen.set(k, entry);
      }
      if (seen.size >= 2) {
        const entries = [...seen.entries()];
        const [major, minor] = [...entries].sort((x, y) => y[1].evidence.size - x[1].evidence.size);
        const probable = entries.length === 2 && minor[1].evidence.size === 1 && major[1].evidence.size >= 2
          && major[0].length >= NEAR_MATCH_MIN_LENGTH && minor[0].length >= NEAR_MATCH_MIN_LENGTH && distance(major[0], minor[0]) === 1
          && !major[1].evidence.has([...minor[1].evidence][0]);
        identifier_conflicts.push({
          field: f,
          values: [...seen.values()].map((v) => v.raw),
          evidence_ids: [...new Set([...seen.values()].flatMap((v) => [...v.evidence]))],
          probable_ocr_error: probable,
          outlier_evidence_ids: probable ? [...minor[1].evidence] : [],
        });
      }
    }
    return {
      asset_id: `asset-${gi + 1}`,
      members,
      links,
      identifier_conflicts,
      ambiguous: hasSameEvidencePair(idx, ds),
      weak: idx.some((i) => weakMembers.has(i)),
    };
  });
}
