// Bộ chấm Fellegi-Sunter nối hai descriptor BĐS chưa chung khóa (D-117; spec s3_fellegi_sunter.md §9).
// Hàm thuần, tất định. Chỉ ghi mức so sánh, không ghi giá trị (FS-R13). Xe vẫn theo luật gần đúng S3-R15(2).
import { normIdNumber, normKey } from '../../common/normalize';
import type { DocumentParty } from '../../s2/common-schema';
import { NEAR_MATCH_MIN_LENGTH } from '../../s5/compare-exact';
import { ownedAssetIndex, personsOfParty } from '../asset-attrs';
import type { Descriptor } from '../asset-group';
import type { Evidence } from '../types';
import type { ASSET_FS_LEVELS, AssetFsField, AssetFsParams } from './asset-params';

export type AssetFsLevel<F extends AssetFsField = AssetFsField> = (typeof ASSET_FS_LEVELS)[F][number] | 'MISSING';
export type AssetFsLevels = { [F in AssetFsField]: AssetFsLevel<F> };
export type AssetFsDecision = 'MATCH' | 'POSSIBLE_MATCH' | 'NO_MATCH';

export interface AssetFsVerdict {
  decision: AssetFsDecision;
  weight: number;
  breakdown: AssetFsLevels;
}

/** So hai descriptor; null = không thuộc phạm vi FS (không phải cặp BĐS), người gọi dùng luật cũ. */
export type AssetScorer = (a: Descriptor, b: Descriptor) => AssetFsVerdict | null;

const isProperty = (t: string) => t === 'real_estate' || t === 'apartment';
const ROLES_OWNING: ReadonlySet<string> = new Set(['OWNER', 'COLLATERAL_OWNER']);

/** Optimal string alignment: thêm / bớt / thay 1 ký tự, hoặc đảo 2 ký tự liền nhau đều tính 1 (`AA08798136` ↔ `AA07898136`). */
export function osaDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLocaleUpperCase('vi-VN');
/** Phần số của số vào sổ, bỏ số 0 đầu: `CN 6475` ≡ `CS 06475` ở mức DIGITS_AGREE. */
const bookDigits = (k: string) => k.replace(/\D+/g, '').replace(/^0+/, '');

function certLevel(a: string | null, b: string | null): AssetFsLevel<'certificate_number'> {
  const ka = normKey(a); const kb = normKey(b);
  if (!ka || !kb) return 'MISSING';
  if (ka === kb) return 'AGREE';
  return ka.length >= NEAR_MATCH_MIN_LENGTH && kb.length >= NEAR_MATCH_MIN_LENGTH && osaDistance(ka, kb) === 1 ? 'NEAR' : 'DISAGREE';
}

function bookLevel(a: string | null, b: string | null): AssetFsLevel<'certificate_book_number'> {
  const ka = normKey(a); const kb = normKey(b);
  if (!ka || !kb) return 'MISSING';
  if (ka === kb) return 'AGREE';
  const da = bookDigits(ka); const db = bookDigits(kb);
  return da.length >= 3 && da === db ? 'DIGITS_AGREE' : 'DISAGREE';
}

function ownerLevel(a: ReadonlySet<string>, b: ReadonlySet<string>): AssetFsLevel<'owner'> {
  if (a.size === 0 || b.size === 0) return 'MISSING';
  return [...a].some((p) => b.has(p)) ? 'AGREE' : 'DISAGREE';
}

/** OQ-FS-04 (D-112): chưa có bảng địa danh trước / sau sáp nhập 2025 → chỉ `AGREE` / `MISSING`, không phạt địa chỉ lệch. */
function addressLevel(a: Descriptor['descriptor']['address'], b: Descriptor['descriptor']['address']): AssetFsLevel<'address'> {
  const ta = norm(a?.full_text); const tb = norm(b?.full_text);
  return ta && ta === tb ? 'AGREE' : 'MISSING';
}

export function compareAssets(a: Descriptor, b: Descriptor, ownersA: ReadonlySet<string>, ownersB: ReadonlySet<string>): AssetFsLevels {
  const x = a.descriptor.identifiers; const y = b.descriptor.identifiers;
  return {
    certificate_number: certLevel(x.certificate_number, y.certificate_number),
    certificate_book_number: bookLevel(x.certificate_book_number, y.certificate_book_number),
    owner: ownerLevel(ownersA, ownersB),
    address: addressLevel(a.descriptor.address, b.descriptor.address),
  };
}

export function assetPairWeight(levels: AssetFsLevels, params: AssetFsParams): number {
  let w = 0;
  for (const field of Object.keys(levels) as AssetFsField[]) {
    const p = (params.comparisons[field] as Record<string, { m: number; u: number }>)[levels[field]];
    if (p) w += Math.log2(p.m / p.u);
  }
  return w;
}

/**
 * Người sở hữu mỗi descriptor (khóa `evidence_id#asset_index`): party OWNER / COLLATERAL_OWNER trỏ tới tài sản (S3-R17).
 * Khác `owner_person_ids` của registry: ở đây chủ TSBĐ khai trên đơn vay cũng tính, vì chỉ dùng làm bằng chứng nối.
 * Party chưa ghép vào người nào → dùng số định danh (`id:<số>`) để vẫn nhận ra "chủ khác"; không có số thì bỏ qua.
 */
export function descriptorOwners(evidences: ReadonlyArray<Evidence>, personOf: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of evidences) {
    for (const p of (e.data?.parties as DocumentParty[] | undefined) ?? []) {
      if (!ROLES_OWNING.has(p.party_role)) continue;
      const idx = ownedAssetIndex(p, e);
      if (idx === null) continue;
      const key = `${e.evidence_id}#${idx}`;
      const set = out.get(key) ?? new Set<string>();
      const persons = personsOfParty(personOf, e.evidence_id, p.party_index);
      const idNumber = normIdNumber(p.id_number);
      if (persons.length > 0) for (const id of persons) set.add(id);
      else if (idNumber) set.add(`id:${idNumber}`);
      out.set(key, set);
    }
  }
  return out;
}

export function makeAssetScorer(params: AssetFsParams, owners: ReadonlyMap<string, ReadonlySet<string>>): AssetScorer {
  const none: ReadonlySet<string> = new Set();
  const ownersOf = (d: Descriptor) => owners.get(`${d.evidence_id}#${d.asset_index}`) ?? none;
  return (a, b) => {
    if (!isProperty(a.descriptor.asset_type) || !isProperty(b.descriptor.asset_type)) return null;
    const breakdown = compareAssets(a, b, ownersOf(a), ownersOf(b));
    const weight = assetPairWeight(breakdown, params);
    const { upper, lower } = params.thresholds;
    const decision: AssetFsDecision = weight >= upper ? 'MATCH' : weight > lower ? 'POSSIBLE_MATCH' : 'NO_MATCH';
    return { decision, weight: Math.round(weight * 100) / 100, breakdown };
  };
}
