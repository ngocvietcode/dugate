// T-S2-06 — khóa trùng dedup_key (S2-R17).
import { dedupKey, type AssetKeyFn } from '@/lib/loan-dossier/s2/dedup-key';
import { assetKeys } from '@/lib/loan-dossier/s3/asset-key';
import type { AssetDescriptor } from '@/lib/loan-dossier/s2/common-schema';

import { makeAsset, makeIdentifiers, makeLegalInfo, makeParty } from './fixtures/build';

const keyFn: AssetKeyFn = (a) => assetKeys(a as unknown as AssetDescriptor);
const env = (doc_type_key: string, data: Record<string, unknown>) => ({ doc_type_key, data });

describe('dedupKey', () => {
  it('loan_application → hằng, không nối ngày cấp', () => {
    const r = dedupKey(env('loan_application', { parties: [makeParty()], legal_info: makeLegalInfo({ issue_date: '2026-01-01' }) }), keyFn);
    expect(r).toEqual({ key: 'loan_application', keyByNameOnly: false });
  });

  it('evidence có tài sản → tập khóa đã sắp, nối bằng |', () => {
    const assets = [
      makeAsset({ identifiers: makeIdentifiers({ certificate_number: 'Z9' }) }),
      makeAsset({ asset_index: 1, identifiers: makeIdentifiers({ certificate_number: 'A1', land_parcel_number: '3', map_sheet_number: '4' }) }),
      makeAsset({ asset_index: 2, asset_type: 'other', identifiers: makeIdentifiers() }),
    ];
    const r = dedupKey(env('land_use_certificate', { parties: [makeParty()], assets, legal_info: makeLegalInfo({ issue_date: null }) }), keyFn);
    expect(r.key!.split('#')[0]).toBe('property:cert:A1|property:cert:Z9|property:parcel:3/4');
  });

  it('party có id_number dùng số; không có thì tên chuẩn hóa (giữ dấu)', () => {
    const r = dedupKey(env('cic', { parties: [makeParty({ id_number: '001' + '0'.repeat(9) }), makeParty({ id_number: null, full_name: 'trần  thị b' })], legal_info: null }), keyFn);
    expect(r.key).toBe('id:001000000000|name:TRẦN THỊ B#issue:null');
    expect(r.keyByNameOnly).toBe(false);
  });

  it('không party nào có số → keyByNameOnly', () => {
    const r = dedupKey(env('cic', { parties: [makeParty({ id_number: null })], legal_info: null }), keyFn);
    expect(r.keyByNameOnly).toBe(true);
  });

  it('tập rỗng → null; party tổ chức không tính', () => {
    expect(dedupKey(env('cic', { parties: [], legal_info: null }), keyFn).key).toBeNull();
    expect(dedupKey(env('cic', { parties: [makeParty({ party_type: 'ORGANIZATION' })], legal_info: null }), keyFn).key).toBeNull();
  });

  it('S2-AC13: cùng người, khác ngày cấp → khác khóa; cùng ngày → cùng; null ≠ có ngày', () => {
    const k = (d: string | null) => dedupKey(env('marital_status_confirmation', { parties: [makeParty()], legal_info: makeLegalInfo({ issue_date: d }) }), keyFn).key;
    expect(k('2026-01-05')).not.toBe(k('2026-09-20'));
    expect(k('2026-01-05')).toBe(k('2026-01-05'));
    expect(k(null)).not.toBe(k('2026-01-05'));
    expect(k(null)).toBe(k(null));
  });
});
