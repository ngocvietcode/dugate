// Chủ sở hữu hiện tại trong 1 chứng từ (T-S2-04; S2-R13). Áp cho GCN đất/căn hộ, GCN cần mua, đăng ký xe.
import type { DocumentParty } from './common-schema';

export const CURRENT_OWNER_DOC_TYPES: ReadonlySet<string> = new Set([
  'land_use_certificate', 'apartment_ownership_certificate', 'land_use_cert_to_buy', 'vehicle_registration',
]);

export interface CurrentOwnerResult {
  parties: DocumentParty[];
  /** 0.5 khi có CHANGE_RECORD mà ngày null (S2-R13) — trần cho `field_confidences.parties`. */
  confidenceCap: number | null;
}

/**
 * Đặt `ownership.is_current_owner` theo từng tài sản (`ownership.asset_index`):
 * không có CHANGE_RECORD → mọi COVER_PAGE là chủ hiện tại; có CHANGE_RECORD → chỉ (các) party có ngày
 * biến động lớn nhất. CHANGE_RECORD ngày null bị bỏ khi so ngày và hạ trần confidence. Party không có
 * `ownership` giữ nguyên.
 */
export function markCurrentOwners(parties: ReadonlyArray<DocumentParty>): CurrentOwnerResult {
  const out = parties.map((p) => (p.ownership ? { ...p, ownership: { ...p.ownership } } : { ...p }));
  let confidenceCap: number | null = null;
  const assets = new Set(out.filter((p) => p.ownership).map((p) => p.ownership!.asset_index));
  for (const assetIndex of assets) {
    const owners = out.filter((p) => p.ownership?.asset_index === assetIndex);
    const changes = owners.filter((p) => p.ownership!.ownership_source === 'CHANGE_RECORD');
    if (changes.length === 0) {
      for (const p of owners) p.ownership!.is_current_owner = p.ownership!.ownership_source === 'COVER_PAGE';
      continue;
    }
    if (changes.some((p) => p.ownership!.ownership_change_date === null)) confidenceCap = 0.5;
    const dated = changes.map((p) => p.ownership!.ownership_change_date).filter((d): d is string => d !== null);
    // ISO YYYY[-MM[-DD]] so sánh được theo chuỗi khi cùng độ dài; chuỗi dài hơn cùng tiền tố coi là muộn hơn.
    const latest = dated.length > 0 ? dated.reduce((a, b) => (b > a ? b : a)) : null;
    for (const p of owners) {
      p.ownership!.is_current_owner = latest !== null
        && p.ownership!.ownership_source === 'CHANGE_RECORD'
        && p.ownership!.ownership_change_date === latest;
    }
  }
  return { parties: out, confidenceCap };
}
