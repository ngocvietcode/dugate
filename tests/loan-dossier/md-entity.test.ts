// T-MD-03 — người và tài sản hợp nhất theo S5 (MD-R08, MD-R09).
import { MasterDossierSchema } from '@/lib/loan-dossier/contracts/master-dossier';
import { normKey } from '@/lib/loan-dossier/common/normalize';

import { ev, ID_A12, loanApp } from './fixtures/dossier';
import { runDossier } from './fixtures/master';

const addr = (full_text: string) => ({ full_text, street: null, ward: null, district: null, province: null });
const person = (m: Awaited<ReturnType<typeof runDossier>>['master'], id = 'person-1') => m.persons.find((p) => p.entity_id === id)!;

describe('người (T-MD-03)', () => {
  it('MD-AC03: CCCD có dấu + CIC không dấu → họ tên AGREED, giá trị có dấu', async () => {
    const name = 'NGUYỄN THỊ KIỀU ANH';
    const { master } = await runDossier([
      loanApp([{ party_role: 'BORROWER', full_name: name, id_number: ID_A12 }]),
      ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: name, id_number: ID_A12 }] }),
      ev('cic', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYEN THI KIEU ANH', id_number: ID_A12 }] }),
    ]);
    const f = person(master).fields.find((x) => x.path === 'full_name')!;
    expect(f).toMatchObject({ status: 'AGREED', value: name });
    expect(f.cross_check_result_id).toMatch(/^xck-\d+$/);
    expect(MasterDossierSchema.safeParse(master).success).toBe(true);
  });

  it('MD-AC07: địa chỉ thường trú lệch (S5 MISMATCH) → CONFLICT, giữ giá trị chứng từ chuẩn, trỏ dòng S5', async () => {
    const { master, s5 } = await runDossier([
      loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, permanent_address: addr('Số 1, Xã A') }]),
      ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, permanent_address: addr('Số 9, Xã B') }] }),
    ]);
    const row = s5.data!.results.find((r) => r.field_group === 'permanent_address')!;
    expect(row.match_status).toBe('MISMATCH');
    const f = person(master).fields.find((x) => x.path === 'permanent_address')!;
    expect(f).toMatchObject({ status: 'CONFLICT', review_status: 'REVIEW', cross_check_result_id: row.result_id });
    expect(f.candidates).toHaveLength(2);
    expect(f.value).not.toBeNull();
  });

  it('trường chỉ có ở 1 chứng từ lấy từ S3, trỏ lá nguồn', async () => {
    const { master } = await runDossier([loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12, date_of_birth: '1990-01-01' }])]);
    const f = person(master).fields.find((x) => x.path === 'date_of_birth')!;
    expect(f).toMatchObject({ status: 'SINGLE_SOURCE', value: '1990-01-01' });
    expect(f.sources[0]).toMatch(/#parties\[0\]\.date_of_birth$/);
  });
});

describe('tài sản (T-MD-03)', () => {
  it('MD-AC06: số GCN NEAR_MATCH → OCR_NORMALIZED theo đa số; có loại, mục đích', async () => {
    const rea = (cert: string) => ({ asset_type: 'real_estate', usage_context_hint: null, identifiers: { certificate_number: cert } });
    const app = loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AA08798136' } }] });
    const { master } = await runDossier([app, ev('land_use_certificate', { parties: [], assets: [rea('AA 08798136')] }), { ...ev('real_estate_valuation_report', { parties: [], assets: [rea('AA 0798136')] }), file_name: 'dinh_gia_doi_chieu.pdf' }]);
    const a = master.assets[0];
    expect(a.label).toBe('TSBĐ · Bất động sản (asset-1)');
    const f = a.fields.find((x) => x.path === 'certificate_number')!;
    expect(f.status).toBe('OCR_NORMALIZED');
    expect(normKey(String(f.value))).toBe('AA08798136');
    expect(f.outliers[0].raw_value).toBe('AA 0798136');
    expect(a.fields.find((x) => x.path === 'usage_contexts')).toMatchObject({ value: ['collateral'] });
    expect(MasterDossierSchema.safeParse(master).success).toBe(true);
  });
});
