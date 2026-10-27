// T-S3-07 — khóa và nối tài sản (S3-R14).
import { assetKeys, canLink, hasFullKey, plateKey } from '@/lib/loan-dossier/s3/asset-key';

import { makeAsset, makeIdentifiers } from './fixtures/build';

const re = (ids: Parameters<typeof makeIdentifiers>[0], type = 'real_estate') => makeAsset({ asset_type: type, identifiers: makeIdentifiers(ids) });
const car = (ids: Parameters<typeof makeIdentifiers>[0]) => makeAsset({ asset_type: 'vehicle', identifiers: makeIdentifiers(ids), address: null });

describe('assetKeys / canLink', () => {
  it('BĐS nối theo (thửa + tờ), theo số GCN, theo (căn hộ + tòa)', () => {
    expect(canLink(re({ land_parcel_number: '12', map_sheet_number: '5' }), re({ land_parcel_number: '12', map_sheet_number: '5' }))).toBe(true);
    expect(canLink(re({ land_parcel_number: '12' }), re({ land_parcel_number: '12' }))).toBe(false);
    expect(canLink(re({ certificate_number: 'BQ 123.456' }), re({ certificate_number: 'bq123456' }))).toBe(true);
    expect(canLink(re({ apartment_number: 'A-12', building_name: 'T1' }, 'apartment'), re({ apartment_number: 'A12', building_name: 't1' }))).toBe(true);
  });

  it('xe nối theo khung / máy / biển số; 88C-276.60 (T) ≡ 88C27660', () => {
    expect(canLink(car({ chassis_number: 'RL4ABC' }), car({ chassis_number: 'rl4abc' }))).toBe(true);
    expect(canLink(car({ engine_number: 'E-1' }), car({ engine_number: 'E1' }))).toBe(true);
    expect(canLink(car({ license_plate: '88C-276.60 (T)' }), car({ license_plate: '88C27660' }))).toBe(true);
    expect(plateKey('88C-276.60 (T)')).toBe('88C27660');
  });

  it('deposit / other không có khóa, không nối', () => {
    const dep = makeAsset({ asset_type: 'deposit', identifiers: makeIdentifiers({ certificate_number: 'X1' }) });
    expect(hasFullKey(dep)).toBe(false);
    expect(canLink(dep, dep)).toBe(false);
    expect(assetKeys(makeAsset({ asset_type: 'other' }))).toEqual([]);
  });

  it('BĐS và xe không nối với nhau dù trùng chuỗi', () => {
    expect(canLink(re({ certificate_number: 'AB123' }), car({ chassis_number: 'AB123', license_plate: 'AB123' }))).toBe(false);
  });

  it('hai descriptor cùng evidence không nối', () => {
    const a = { ...re({ certificate_number: 'BQ1' }), evidence_id: 'ev-1' };
    expect(canLink(a, { ...a })).toBe(false);
    expect(canLink(a, { ...a, evidence_id: 'ev-2' })).toBe(true);
  });
});
