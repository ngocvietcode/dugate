// DossierGraph (HKD): dựng từ output S3 rồi chiếu ngược phải ra đúng từng byte, kể cả thứ tự phần tử và thứ tự khóa.
import { MapDossierDataSchema } from '@/lib/loan-dossier/contracts/check-stages';
import {
  buildDossierGraph, projectAssetRegistry, projectCustomer360, projectMapDossierData, projectRoleRegistry,
} from '@/lib/loan-dossier/graph';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';

import { ev, ID_A12, ID_A9, ID_B12, ID_C12, loanApp } from './fixtures/dossier';

const now = () => new Date('2026-10-14T03:00:00.000Z');
const run = (evidences: EvidenceEnvelope[]) => runMapDossier({ evidences, dossier_submitted_at: '2026-10-14', now }).data!;
const ID_D12 = '001090000004';
const own = (current: boolean) => ({ asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: current });

/** Cùng hồ sơ với s3-run.test.ts: 1 vay, vợ đồng vay, 2 chủ TSBĐ, 1 xe, 1 BĐS, 1 bản hôn nhân bị thay thế. */
function fullDossier(): EvidenceEnvelope[] {
  const anchor = loanApp([
    { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A9, date_of_birth: '1985-02-02' },
    { party_role: 'CO_BORROWER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 },
    { party_role: 'SPOUSE', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 },
    { party_role: 'COLLATERAL_OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_C12 },
    { party_role: 'COLLATERAL_OWNER', full_name: 'PHẠM VĂN DŨNG', id_number: ID_D12 },
  ], {
    id: 'ev-aaaaaaaaaa01',
    relations: { 3: { raw: 'Mẹ' }, 4: { raw: 'Bạn bè' } },
    assets: [
      { asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { land_parcel_number: '12', map_sheet_number: '5' } },
      { asset_type: 'vehicle', usage_context_hint: 'collateral', identifiers: { license_plate: '51K-123.45' } },
    ],
    data: { business_info: { business_name: 'HKD AN' } },
  });
  return [
    anchor,
    ev('id_card', { id: 'ev-aaaaaaaaaa02', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, previous_id_numbers: [ID_A9], date_of_birth: '1985-02-02' }] }),
    ev('id_card', { id: 'ev-aaaaaaaaaa03', parties: [{ party_role: 'HOLDER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 }] }),
    ev('land_use_certificate', {
      id: 'ev-aaaaaaaaaa04',
      assets: [{ asset_type: 'real_estate', identifiers: { land_parcel_number: '12', map_sheet_number: '5', certificate_number: 'CS01' } }],
      parties: [{ party_role: 'OWNER', full_name: 'LÊ THỊ CÚC', id_number: ID_C12, ownership: own(true) }],
    }),
    ev('vehicle_registration', {
      id: 'ev-aaaaaaaaaa05',
      assets: [{ asset_type: 'vehicle', identifiers: { license_plate: '51K12345', chassis_number: 'RLNAB1234567' } }],
      parties: [{ party_role: 'OWNER', full_name: 'PHẠM VĂN DŨNG', id_number: ID_D12, ownership: own(true) }],
    }),
    ev('birth_certificate', { id: 'ev-aaaaaaaaaa06', parties: [
      { party_role: 'CHILD', full_name: 'NGUYỄN VĂN AN' }, { party_index: 1, party_role: 'FATHER', full_name: 'NGUYỄN VĂN BỐ' }, { party_index: 2, party_role: 'MOTHER', full_name: 'LÊ THỊ CÚC' },
    ] }),
    ev('marital_status_confirmation', { id: 'ev-aaaaaaaaaa07', issue_date: '2026-01-05', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }], data: { marital_status: 'SINGLE' } }),
    ev('marital_status_confirmation', { id: 'ev-aaaaaaaaaa08', issue_date: '2026-09-20', parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }], data: { marital_status: 'MARRIED' } }),
  ];
}

const same = (a: unknown, b: unknown) => expect(JSON.stringify(a)).toBe(JSON.stringify(b));

describe('DossierGraph (HKD)', () => {
  it('hồ sơ đầy đủ: chiếu ngược khớp output S3 từng byte và vẫn hợp lệ hợp đồng', () => {
    const data = run(fullDossier());
    const projected = projectMapDossierData(buildDossierGraph(data));
    same(projected, data);
    expect(MapDossierDataSchema.safeParse(projected).success).toBe(true);
  });

  it('từng hình chiếu riêng khớp khối tương ứng', () => {
    const data = run(fullDossier());
    const g = buildDossierGraph(data);
    same(projectRoleRegistry(g), data.role_registry);
    same(projectCustomer360(g), data.customer_360);
    same(projectAssetRegistry(g), data.asset_registry);
  });

  it('có party chưa ghép (unmapped) và nhiều lỗi định danh: vẫn khớp', () => {
    const evs = [
      ...fullDossier(),
      ev('cic', { parties: [{ full_name: 'NGƯỜI LẠ', id_number: '001099999999' }] }),
      ev('land_use_certificate', { assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'ZZ' } }], parties: [] }),
      ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A9, previous_id_numbers: [], date_of_birth: '1999-09-09' }] }),
    ];
    const data = run(evs);
    expect(data.unmapped_evidences.length).toBeGreaterThan(0);
    same(projectMapDossierData(buildDossierGraph(data)), data);
  });

  it('không có loan_application: không có người, vẫn có tài sản', () => {
    const data = run(fullDossier().slice(1));
    expect(data.role_registry).toEqual([]);
    same(projectMapDossierData(buildDossierGraph(data)), data);
  });

  it('graph truy vấn được quan hệ mà S3 chỉ lưu bằng mảng id', () => {
    const data = run(fullDossier());
    const g = buildDossierGraph(data);
    // person-3 (mẹ) sở hữu asset-1; asset-1 có chứng từ nguồn; person-1 ↔ person-3 qua RELATIVE_OF
    expect(g.hasEdge('OWNS:person-3>asset-1')).toBe(true);
    expect(g.outNeighbors('asset-1')).toEqual(expect.arrayContaining(['ev-aaaaaaaaaa01', 'ev-aaaaaaaaaa04']));
    expect(g.outNeighbors('person-1')).toEqual(expect.arrayContaining(['person-2', 'person-3', 'person-4']));
    expect(g.getNodeAttribute('ev-aaaaaaaaaa07', 'kind')).toBe('evidence');
    expect(g.outNeighbors('ev-aaaaaaaaaa07')).toEqual(['ev-aaaaaaaaaa08']);
  });

  it('mỗi thuộc tính người chỉ nằm ở một node: graph không giữ mảng id chéo', () => {
    const g = buildDossierGraph(run(fullDossier()));
    const attrs = g.getNodeAttributes('person-1') as unknown as Record<string, unknown>;
    for (const k of ['owned_asset_ids', 'spouse_person_id', 'mapped_evidences', 'person_id']) expect(attrs).not.toHaveProperty(k);
  });

  it('tham chiếu treo bị từ chối, thông báo chỉ nêu id (không PII)', () => {
    const data = run(fullDossier());
    const broken = JSON.parse(JSON.stringify(data)) as typeof data;
    broken.customer_360[0].spouse_person_id = 'person-99';
    expect(() => buildDossierGraph(broken)).toThrow(/person-99 không có trong role_registry/);
    const msg = (() => { try { buildDossierGraph(broken); return ''; } catch (e) { return String((e as Error).message); } })();
    for (const pii of ['NGUYỄN VĂN AN', ID_A12, ID_B12]) expect(msg).not.toContain(pii);
  });

  it('build không đổi input và graph không dùng chung tham chiếu', () => {
    const data = run(fullDossier());
    const before = JSON.stringify(data);
    const g = buildDossierGraph(data);
    const projected = projectMapDossierData(g);
    projected.role_registry[0].roles.push('other');
    same(data, JSON.parse(before));
    same(projectMapDossierData(g), JSON.parse(before));
  });
});
