// Trạng thái nhóm trùng (T-S2-07; S2-R17, S2-R18). Nhóm tính trên toàn request, theo (loại, dedup_key).
import { distance } from 'fastest-levenshtein';

import { NEAR_MATCH_MIN_LENGTH } from '../s5/compare-exact';
import { dedupKey, type AssetKeyFn } from './dedup-key';

export const CONFLICT_CONFIDENCE = 0.8;

interface DupEvidence {
  doc_type_key: string;
  status: string;
  data: Record<string, unknown> | null;
  field_confidences: Record<string, number>;
  duplicate_group_id: string | null;
  duplicate_status: string | null;
  differing_fields: string[];
}

/** Lá mô tả phạm vi chụp, không so (S2-R18a). */
export function isScopeLeaf(path: string): boolean {
  const last = path.split('.').pop()!.replace(/\[\d+\]$/, '');
  return last === 'has_front_side' || last === 'has_back_side' || last.endsWith('_page')
    || /^party_details\[\d+\]\.source_page$/.test(path);
}

/** Khóa sắp phần tử mảng: party theo (vai trò, số, tên), tài sản theo (loại, định danh), còn lại theo JSON. */
export function sortKey(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ('party_role' in o) return `p|${o.party_role}|${o.id_number ?? ''}|${normLeaf(o.full_name ?? '')}`;
    if ('asset_type' in o) return `a|${o.asset_type}|${JSON.stringify(o.identifiers ?? null)}`;
  }
  return `j|${JSON.stringify(v)}`;
}

/** Bỏ khóa `*_index` (vị trí phụ thuộc thứ tự) và sắp phần tử mảng để thứ tự party/tài sản không ảnh hưởng. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map((x) => ({ k: sortKey(x), x: canonical(x) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((e) => e.x);
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !k.endsWith('_index'))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => [k, canonical(x)]));
  }
  return v;
}

function leaves(v: unknown, path: string, out: Map<string, unknown>): void {
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, path ? `${path}.${k}` : k, out);
  else if (!isScopeLeaf(path)) out.set(path, v);
}

function normLeaf(v: unknown): unknown {
  return typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN') : v;
}

/** Đường dẫn lá khác nhau (cả hai khác null và khác sau chuẩn hóa). */
export function differingLeaves(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const la = new Map<string, unknown>();
  const lb = new Map<string, unknown>();
  leaves(canonical(a), '', la);
  leaves(canonical(b), '', lb);
  const out: string[] = [];
  for (const [path, va] of la) {
    const vb = lb.get(path);
    if (va === null || va === undefined || vb === null || vb === undefined) continue;
    if (normLeaf(va) !== normLeaf(vb)) out.push(path);
  }
  return out;
}

const topField = (path: string) => path.split(/[.[]/)[0];

/** Mã/số: bỏ khoảng trắng + dấu câu, HOA (như K(v) của S3-R14). */
const codeNorm = (v: unknown) => String(v).normalize('NFC').toLocaleUpperCase('vi-VN').replace(/[^\p{L}\p{N}]/gu, '');

/** Lá là mã/số định danh (tài sản, số văn bản) — chỉ những lá này được coi là lệch do đọc sai. */
function isCodeLeaf(path: string): boolean {
  return /(^|\.)identifiers\.[a-z_]+$/.test(path) || /(^|\.)document_number$/.test(path);
}

/**
 * S2-R18b (D-43): trong một nhóm trùng, lá mã/số mà ≥ 2 bản ghi giống nhau và đúng 1 bản lệch đúng 1 ký tự
 * (độ dài ≥ NEAR_MATCH_MIN_LENGTH) là lệch do đọc sai, không phải 2 nội dung khác nhau → không tính xung đột.
 */
function ocrVariantLeaves(memberLeaves: ReadonlyArray<Map<string, unknown>>, paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const path of paths) {
    if (!isCodeLeaf(path)) continue;
    const counts = new Map<string, number>();
    for (const m of memberLeaves) {
      const v = m.get(path);
      if (v === null || v === undefined || v === '') continue;
      const k = codeNorm(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if (counts.size !== 2) continue;
    const [[a, na], [b, nb]] = [...counts.entries()].sort((x, y) => y[1] - x[1]);
    if (na >= 2 && nb === 1 && a.length >= NEAR_MATCH_MIN_LENGTH && b.length >= NEAR_MATCH_MIN_LENGTH && distance(a, b) === 1) out.add(path);
  }
  return out;
}

/**
 * Gán `duplicate_group_id` (`dup-1`… theo thứ tự xuất hiện), `duplicate_status`, `differing_fields`.
 * Evidence `ERROR` và evidence không có khóa không tham gia. Trả mảng mới, không sửa đầu vào.
 */
export function groupDuplicates<E extends DupEvidence>(evidences: ReadonlyArray<E>, assetKeyFn: AssetKeyFn): E[] {
  const out = evidences.map((e) => ({ ...e, duplicate_group_id: null, duplicate_status: null, differing_fields: [] as string[] }));
  const groups = new Map<string, { members: number[]; byNameOnly: boolean }>();
  out.forEach((e, i) => {
    if (e.status !== 'SUCCESS' || !e.data) return;
    const { key, keyByNameOnly } = dedupKey(e, assetKeyFn);
    if (key === null) return;
    const gk = `${e.doc_type_key}\u0000${key}`;
    const g = groups.get(gk) ?? { members: [], byNameOnly: keyByNameOnly };
    g.members.push(i);
    groups.set(gk, g);
  });
  let n = 0;
  for (const g of groups.values()) {
    if (g.members.length < 2) continue;
    n += 1;
    const differing = new Set<string>();
    const confident = new Set<string>();
    for (let x = 0; x < g.members.length; x++) {
      for (let y = x + 1; y < g.members.length; y++) {
        const a = out[g.members[x]];
        const b = out[g.members[y]];
        for (const path of differingLeaves(a.data!, b.data!)) {
          differing.add(path);
          const f = topField(path);
          if ((a.field_confidences[f] ?? 0) >= CONFLICT_CONFIDENCE && (b.field_confidences[f] ?? 0) >= CONFLICT_CONFIDENCE) confident.add(path);
        }
      }
    }
    const memberLeaves = g.members.map((i) => { const m = new Map<string, unknown>(); leaves(canonical(out[i].data), '', m); return m; });
    const ocrVariants = ocrVariantLeaves(memberLeaves, confident);
    const conflict = [...confident].some((p) => !ocrVariants.has(p));
    const status = conflict ? 'CONFLICTING_DUPLICATES'
      : differing.size > 0 || g.byNameOnly ? 'DUPLICATE_CANDIDATE' : 'CONFIRMED_DUPLICATE';
    const fields = [...differing].sort();
    for (const i of g.members) {
      Object.assign(out[i], { duplicate_group_id: `dup-${n}`, duplicate_status: status, differing_fields: fields });
    }
  }
  return out as E[];
}
