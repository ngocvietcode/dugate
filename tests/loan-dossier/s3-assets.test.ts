// T-S3-08, T-S3-09 — gom nhóm tài sản, thuộc tính, chủ sở hữu, ngữ cảnh (S3-R14…R19).
import { finalizeAssets } from '@/lib/loan-dossier/s3/asset-attrs';
import { collectDescriptors, groupAssets } from '@/lib/loan-dossier/s3/asset-group';
import { matchParties } from '@/lib/loan-dossier/s3/match-parties';
import { buildRegistry } from '@/lib/loan-dossier/s3/registry';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, ID_B12, ID_C12, loanApp } from './fixtures/dossier';

const groups = (es: EvidenceEnvelope[]) => groupAssets(collectDescriptors(es));
const collateral = (ids: Record<string, string>, type = 'real_estate') => ({ asset_type: type, usage_context_hint: 'collateral', identifiers: ids });

function registry(anchor: EvidenceEnvelope, others: EvidenceEnvelope[]) {
  const persons = buildRegistry(anchor);
  const all = [anchor, ...others];
  const { personOf } = matchParties(persons, all, anchor.evidence_id);
  return { persons, assets: finalizeAssets(groups(all), personOf, all) };
}

describe('groupAssets', () => {
  it('UAT (V-24): đơn vay ghi GCN "AA08798136" + mục đích TSBĐ, GCN in "AA 08798136" → ghép chính xác; số vào sổ lệch → AMBIGUOUS có conflict; cùng số vào sổ → CONFIRMED', () => {
    const app = (book: string) => loanApp([{ party_role: 'BORROWER', full_name: 'A B' }], { assets: [collateral({ certificate_number: 'AA08798136', certificate_book_number: book })] });
    const gcn = ev('land_use_certificate', { assets: [{ asset_type: 'real_estate', usage_context_hint: null, identifiers: { certificate_number: 'AA 08798136', certificate_book_number: 'CS 06475' } }] });
    const lech = registry(app('CN 6475'), [gcn]).assets;
    expect(lech).toHaveLength(1);
    expect(lech[0]).toMatchObject({ usage_contexts: ['collateral'], context_status: 'AMBIGUOUS', context_reason_code: 'ASSET_IDENTIFIER_CONFLICT' });
    expect((lech[0].identifier_conflicts as Array<{ field: string }>).map((c) => c.field)).toEqual(['certificate_book_number']);
    expect(registry(app('CS 06475'), [gcn]).assets[0]).toMatchObject({ context_status: 'CONFIRMED', usage_contexts: ['collateral'] });
  });
  it('S3-AC07: đơn vay và định giá cùng thửa+tờ → 1 asset_id, 2 nguồn', () => {
    const g = groups([
      loanApp([{ party_role: 'BORROWER', full_name: 'A B' }], { assets: [collateral({ land_parcel_number: '12', map_sheet_number: '5' })] }),
      ev('real_estate_valuation_report', { assets: [{ asset_type: 'real_estate', usage_context_hint: null, identifiers: { land_parcel_number: '12', map_sheet_number: '05'.replace('0', '') } }] }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].members).toHaveLength(2);
  });

  it('S3-AC08: số khung lệch 1 ký tự, biển số trùng → 1 tài sản, identifier_conflicts chassis', () => {
    const g = groups([
      ev('vehicle_registration', { assets: [{ asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234567', license_plate: '51K-123.45' } }] }),
      ev('movable_asset_valuation_report', { assets: [{ asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234568', license_plate: '51K12345' } }] }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].identifier_conflicts.map((c) => c.field)).toEqual(['chassis_number']);
  });

  it('nối gần đúng (Levenshtein 1) khi chưa có khóa chung; field khác mâu thuẫn → không nối', () => {
    const near = groups([
      ev('vehicle_registration', { assets: [{ asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234567' } }] }),
      ev('vehicle_inspection', { assets: [{ asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234568' } }] }),
    ]);
    expect(near).toHaveLength(1);
    expect(near[0].links).toEqual(['SEED', 'APPROXIMATE']);
    const conflict = groups([
      ev('vehicle_registration', { assets: [{ asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234567', engine_number: 'E1' } }] }),
      ev('vehicle_inspection', { assets: [{ asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234568', engine_number: 'E2' } }] }),
    ]);
    expect(conflict).toHaveLength(2);
  });

  it('bắc cầu đưa 2 descriptor cùng evidence vào 1 nhóm → bỏ cạnh gần đúng', () => {
    const g = groups([
      ev('movable_asset_valuation_report', { assets: [
        { asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234567' } },
        { asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234568' } },
      ] }),
      ev('vehicle_registration', { assets: [{ asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234567' } }] }),
    ]);
    expect(g).toHaveLength(2);
    expect(g.every((x) => !x.ambiguous)).toBe(true);
  });

  it('hint không khóa + đúng 1 nhóm ứng viên → nối yếu; 2 ứng viên → riêng', () => {
    const app = (n: number) => ev('cic', { assets: Array.from({ length: n }, (_, i) => ({ asset_type: 'real_estate', identifiers: { certificate_number: `GCN${i}` } })) });
    const hinted = loanApp([{ party_role: 'BORROWER', full_name: 'A B' }], { assets: [collateral({})] });
    const one = groups([app(1), hinted]);
    expect(one).toHaveLength(1);
    expect(one[0].weak).toBe(true);
    expect(groups([ev('cic', { assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'X1' } }] }), ev('cic', { assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'X2' } }] }), hinted])).toHaveLength(3);
  });

  it('asset_id theo thứ tự xuất hiện, ổn định', () => {
    const es = [
      ev('vehicle_registration', { assets: [{ asset_type: 'vehicle', identifiers: { license_plate: '30A1' } }] }),
      ev('land_use_certificate', { assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'CS1' } }] }),
    ];
    expect(groups(es).map((g) => [g.asset_id, g.members[0].descriptor.asset_type])).toEqual([['asset-1', 'vehicle'], ['asset-2', 'real_estate']]);
    expect(groups(es)).toEqual(groups(es));
  });
});

describe('finalizeAssets', () => {
  const owner = (source: string, date: string | null, current: boolean) => ({ asset_index: 0, ownership_source: source, ownership_change_date: date, is_current_owner: current });
  const anchor = loanApp([
    { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 },
    { party_role: 'COLLATERAL_OWNER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 },
    { party_role: 'COLLATERAL_OWNER', full_name: 'LÊ VĂN CƯỜNG', id_number: ID_C12 },
  ], { assets: [collateral({ certificate_number: 'CS 01' })] });

  it('S3-AC09: GCN 2 biến động → current_owner là người nhận sau cùng', () => {
    const gcn = ev('land_use_certificate', {
      assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'CS01' } }],
      parties: [
        { party_role: 'OWNER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, ownership: owner('COVER_PAGE', null, false) },
        { party_role: 'OWNER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12, ownership: owner('CHANGE_RECORD', '2020-01-01', false) },
        { party_role: 'OWNER', full_name: 'LÊ VĂN CƯỜNG', id_number: ID_C12, ownership: owner('CHANGE_RECORD', '2024-01-01', true) },
      ],
    });
    const { assets } = registry(anchor, [gcn]);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ owner_person_ids: ['person-1', 'person-2', 'person-3'], current_owner_person_ids: ['person-3'], context_status: 'CONFIRMED', usage_contexts: ['collateral'] });
  });

  it('S3-AC10: GCN không được đơn vay nhắc tới → UNRESOLVED', () => {
    const { assets } = registry(loanApp([{ party_role: 'BORROWER', full_name: 'A B' }]), [ev('land_use_certificate', { assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'ZZ9' } }] })]);
    expect(assets[0]).toMatchObject({ usage_contexts: [], context_status: 'UNRESOLVED', context_reason_code: 'ASSET_CONTEXT_AMBIGUOUS' });
  });

  it('ưu tiên nguồn: ownership > không hint > hint; apartment thắng khi nguồn mức 1 là apartment', () => {
    const own = ev('apartment_ownership_certificate', {
      assets: [{ asset_type: 'apartment', identifiers: { certificate_number: 'CS01', apartment_number: 'A1', building_name: null } }],
      parties: [{ party_role: 'OWNER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, ownership: owner('COVER_PAGE', null, true) }],
      confidence: 0.6,
    });
    const val = ev('real_estate_valuation_report', { assets: [{ asset_type: 'real_estate', usage_context_hint: null, identifiers: { certificate_number: 'CS01', building_name: 'T1', apartment_number: 'B9' } }] });
    const { assets } = registry(anchor, [val, own]);
    expect(assets[0].asset_type).toBe('apartment');
    expect(assets[0].identifiers).toMatchObject({ apartment_number: 'A1', building_name: 'T1', certificate_number: 'CS 01'.replace(' ', '') });
  });

  it('ownership null + evidence 1 tài sản → gán chủ; 2 tài sản → không gán', () => {
    const one = ev('land_use_certificate', { assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'CS01' } }], parties: [{ party_role: 'OWNER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, ownership: null }] });
    expect(registry(anchor, [one]).assets[0].owner_person_ids).toEqual(['person-1']);
    const two = ev('land_use_certificate', { assets: [
      { asset_type: 'real_estate', identifiers: { certificate_number: 'CS01' } },
      { asset_type: 'real_estate', identifiers: { certificate_number: 'CS02' } },
    ], parties: [{ party_role: 'OWNER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, ownership: null }] });
    expect(registry(anchor, [two]).assets.every((a) => a.owner_person_ids.length === 0)).toBe(true);
  });

  it('context_status: lệch định danh → AMBIGUOUS/ASSET_IDENTIFIER_CONFLICT; nối yếu → ASSET_CONTEXT_AMBIGUOUS', () => {
    const a1 = loanApp([{ party_role: 'BORROWER', full_name: 'A B' }], { assets: [collateral({ chassis_number: 'RLNAB1234567', license_plate: '51K1' }, 'vehicle')] });
    const conflict = registry(a1, [ev('vehicle_registration', { assets: [{ asset_type: 'vehicle', identifiers: { chassis_number: 'RLNAB1234568', license_plate: '51K1' } }] })]);
    expect(conflict.assets[0]).toMatchObject({ context_status: 'AMBIGUOUS', context_reason_code: 'ASSET_IDENTIFIER_CONFLICT' });
    const a2 = loanApp([{ party_role: 'BORROWER', full_name: 'A B' }], { assets: [collateral({})] });
    const weak = registry(a2, [ev('land_use_certificate', { assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'CS9' } }] })]);
    expect(weak.assets[0]).toMatchObject({ context_status: 'AMBIGUOUS', context_reason_code: 'ASSET_CONTEXT_AMBIGUOUS' });
  });

  it('tài sản vừa collateral vừa rental_income', () => {
    const a = loanApp([{ party_role: 'BORROWER', full_name: 'A B' }], { assets: [collateral({ certificate_number: 'CS1' })] });
    const inc = ev('income_statement', { assets: [{ asset_type: 'real_estate', usage_context_hint: 'rental_income', identifiers: { certificate_number: 'CS1' } }] });
    expect(registry(a, [inc]).assets[0].usage_contexts).toEqual(['collateral', 'rental_income']);
  });
});
