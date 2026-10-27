// T-S3-13, T-S3-14, T-S3-15 — trạng thái, nhất quán, lắp ráp stage S3.
import { MapDossierStageResultSchema } from '@/lib/loan-dossier/contracts/check-stages';
import { checkInvariants } from '@/lib/loan-dossier/s3/invariants';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, ID_A9, ID_B12, ID_C12, loanApp } from './fixtures/dossier';

const D0 = '2026-10-14';
const now = () => new Date('2026-10-14T03:00:00.000Z');
const run = (evidences: EvidenceEnvelope[]) => runMapDossier({ evidences, dossier_submitted_at: D0, now });
const valid = (r: unknown) => {
  const p = MapDossierStageResultSchema.safeParse(r);
  if (!p.success) throw new Error(JSON.stringify(p.error.issues.slice(0, 3), null, 1));
};

const ID_D12 = '001090000004';
const own = (current: boolean) => ({ asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: current });

/** Hồ sơ đầy đủ: 1 vay, vợ đồng vay, 2 chủ TSBĐ (mẹ + người khác), 1 xe, 1 BĐS. */
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

describe('runMapDossier', () => {
  it('hồ sơ đầy đủ: output hợp lệ, nhất quán, đúng vai trò/tài sản/quan hệ', () => {
    const evs = fullDossier();
    const r = run(evs);
    valid(r);
    const d = r.data!;
    expect(checkInvariants(d, new Set(evs.map((e) => e.evidence_id)))).toEqual([]);
    expect(d.role_registry.map((p) => [p.person_id, p.roles])).toEqual([
      ['person-1', ['borrower']], ['person-2', ['co_borrower']], ['person-3', ['collateral_owner']], ['person-4', ['collateral_owner']],
    ]);
    expect(d.role_registry[0]).toMatchObject({ current_id_number: ID_A12, id_number_check: { status: 'HISTORICAL_ID_NUMBER' } });
    expect(d.asset_registry.map((a) => [a.asset_id, a.asset_type, a.current_owner_person_ids, a.context_status])).toEqual([
      ['asset-1', 'real_estate', ['person-3'], 'CONFIRMED'], ['asset-2', 'vehicle', ['person-4'], 'CONFIRMED'],
    ]);
    expect(d.relationship_verifications.map((v) => [v.collateral_owner_person_id, v.relationship_type, v.verified_count])).toEqual([
      ['person-3', 'PARENT_CHILD', 1], ['person-4', 'OTHER', 0],
    ]);
    // S3-AC15: bản hôn nhân cũ bị thay thế, marital_status từ bản mới
    expect(d.superseded_evidences).toEqual([expect.objectContaining({ evidence_id: 'ev-aaaaaaaaaa07', superseded_by_evidence_ids: ['ev-aaaaaaaaaa08'] })]);
    expect(d.customer_360[0]).toMatchObject({ marital_status: 'MARRIED', spouse_person_id: 'person-2', business: { business_name: 'HKD AN' } });
    expect([r.status, r.status_code]).toEqual(['SUCCESS', 'COMPLETED']);
    expect(r.content_preview).toMatchObject({ person_count: 4, asset_count: 2, relationship_verification_count: 2, unmapped_party_count: 0 });
  });

  it('S3-AC13: không có loan_application → INSUFFICIENT_DATA, asset_registry vẫn dựng', () => {
    const r = run(fullDossier().slice(1));
    expect([r.status, r.status_code]).toEqual(['INSUFFICIENT_DATA', 'LOAN_APPLICATION_MISSING']);
    expect(r.data!.role_registry).toEqual([]);
    expect(r.data!.asset_registry.length).toBeGreaterThan(0);
    valid(r);
  });

  it('S3-AC14: cùng input 2 lần → output giống hệt', () => {
    expect(JSON.stringify(run(fullDossier()))).toBe(JSON.stringify(run(fullDossier())));
  });

  it('trạng thái: unmapped → UNMAPPED_DOCUMENTS_PRESENT; tài sản chưa rõ → ASSET_CONTEXT_UNRESOLVED; role_conflict', () => {
    const evs = fullDossier();
    const unmapped = run([...evs, ev('cic', { parties: [{ full_name: 'NGƯỜI LẠ', id_number: '001099999999' }] })]);
    expect(unmapped.status_code).toBe('UNMAPPED_DOCUMENTS_PRESENT');
    const unresolved = run([...evs, ev('land_use_certificate', { assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'ZZ' } }], parties: [] })]);
    expect(unresolved.status_code).toBe('ASSET_CONTEXT_UNRESOLVED');
    const conflict = run([...evs, ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A9, previous_id_numbers: [], date_of_birth: '1999-09-09' }] }),
      ev('vneid', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: '001090000099', previous_id_numbers: [ID_A9], date_of_birth: '1999-09-09' }] })]);
    expect(conflict.status).not.toBe('FAILED');
    for (const r of [unmapped, unresolved, conflict]) valid(r);
  });

  it('không log tên / số định danh', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    run(fullDossier());
    const out = spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n');
    for (const pii of ['NGUYỄN VĂN AN', ID_A12, ID_B12]) expect(out).not.toContain(pii);
    spies.forEach((s) => s.mockRestore());
  });
});
