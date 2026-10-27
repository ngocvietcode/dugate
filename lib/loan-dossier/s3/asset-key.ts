// Khóa và nối tài sản (T-S3-07; S3-R14). Dùng chung cho S2 (`assetKeyFn` của khóa trùng, T-S2-06) và S3.
import { normKey } from '../common/normalize';
import type { AssetDescriptor } from '../s2/common-schema';

type Family = 'property' | 'vehicle' | null;

function family(type: string): Family {
  if (type === 'real_estate' || type === 'apartment') return 'property';
  if (type === 'vehicle') return 'vehicle';
  return null; // deposit, other: không có khóa
}

/** `K(v)`; riêng biển số bỏ thêm hậu tố trong ngoặc (`88C-276.60 (T)` ≡ `88C27660`). */
export function plateKey(v: string | null | undefined): string | null {
  return normKey(v ? v.replace(/\([^)]*\)/g, '') : v);
}

/**
 * Các tổ hợp khóa đầy đủ của descriptor, có tiền tố họ + loại khóa để BĐS và xe không bao giờ trùng:
 * `property:parcel:{thửa}/{tờ}`, `property:cert:{số GCN}`, `property:apt:{căn}/{tòa}`,
 * `vehicle:chassis:…`, `vehicle:engine:…`, `vehicle:plate:…`.
 */
export function assetKeys(d: Pick<AssetDescriptor, 'asset_type' | 'identifiers'>): string[] {
  const fam = family(d.asset_type);
  const id = d.identifiers;
  const keys: string[] = [];
  if (fam === 'property') {
    const parcel = normKey(id.land_parcel_number);
    const sheet = normKey(id.map_sheet_number);
    if (parcel && sheet) keys.push(`property:parcel:${parcel}/${sheet}`);
    const cert = normKey(id.certificate_number);
    if (cert) keys.push(`property:cert:${cert}`);
    const apt = normKey(id.apartment_number);
    const building = normKey(id.building_name);
    if (apt && building) keys.push(`property:apt:${apt}/${building}`);
  } else if (fam === 'vehicle') {
    const chassis = normKey(id.chassis_number);
    if (chassis) keys.push(`vehicle:chassis:${chassis}`);
    const engine = normKey(id.engine_number);
    if (engine) keys.push(`vehicle:engine:${engine}`);
    const plate = plateKey(id.license_plate);
    if (plate) keys.push(`vehicle:plate:${plate}`);
  }
  return keys;
}

export function hasFullKey(d: Pick<AssetDescriptor, 'asset_type' | 'identifiers'>): boolean {
  return assetKeys(d).length > 0;
}

/**
 * Nối chính xác: cùng họ và chung ít nhất 1 khóa. Hai descriptor của **cùng** evidence không nối trực tiếp —
 * truyền `evidence_id` để kiểm (bỏ trống nếu không biết).
 */
export function canLink(
  a: Pick<AssetDescriptor, 'asset_type' | 'identifiers'> & { evidence_id?: string },
  b: Pick<AssetDescriptor, 'asset_type' | 'identifiers'> & { evidence_id?: string },
): boolean {
  if (a.evidence_id !== undefined && a.evidence_id === b.evidence_id) return false;
  const ka = new Set(assetKeys(a));
  return assetKeys(b).some((k) => ka.has(k));
}
