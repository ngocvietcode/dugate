// T-360-07, T-360-10, T-360-12 — hồ sơ 360: đơn vị HKD, luồng thu nhập, chính sách chọn giá trị (loan_360.md AC-8…AC-12, AC-18).
import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import { buildProfile360 } from '@/lib/loan-dossier/profile360/build';
import { parseMergePolicies } from '@/lib/loan-dossier/profile360/policies';
import { Profile360Schema } from '@/lib/loan-dossier/profile360/schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, ID_B12, loanApp } from './fixtures/dossier';

const A = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const B = { party_role: 'CO_BORROWER', full_name: 'TRẦN THỊ BÌNH', id_number: ID_B12 };
const addr = (full_text: string) => ({ full_text, street: null, ward: null, district: null, province: null });

function profile(evidences: EvidenceEnvelope[], policies?: unknown) {
  const s3 = runMapDossier({ evidences, dossier_submitted_at: '2026-10-14' }).data;
  const lac = buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences, s3, s3_status: 'SUCCESS' });
  return Profile360Schema.parse(buildProfile360({ evidences, s3, lac, ...(policies === undefined ? {} : { policies: parseMergePolicies(policies) }) }));
}

const app = (business_info: Record<string, unknown> | null) => {
  const a = loanApp([A, B]);
  a.data!.business_info = business_info;
  return a;
};
const license = (holder: Record<string, unknown>, registration_number: string, business_name = 'TẠP HÓA AN') =>
  ev('household_business_license', {
    parties: [{ ...holder, party_role: 'HOLDER' }],
    data: { fields: { registration_number, business_name, business_address: addr('Xã Yên Cường, Ninh Bình'), business_line: 'Bán lẻ tạp hóa' } },
  });
const row = (i: number, income_type: string, monthly_amount: number, extra: Record<string, unknown> = {}) => ({
  source_index: i, party_index: 0, income_type, source_label_raw: null, monthly_amount, frequency_raw: null,
  salary: null, rental: null, household_business: null, trip_trading: null, enterprise: null, ...extra,
});
const statement = (rows: Array<Record<string, unknown>>) => ev('income_statement', { parties: [{ ...A, party_role: 'BORROWER' }], data: { income_sources: rows, assets: [] } });

describe('đơn vị HKD (L360-B01…B03)', () => {
  it('AC-8: đơn vay + GCN ĐKHKD + bảng kê cùng một HKD → một đơn vị, OPERATES VERIFIED, nguồn thu nối EARNS_FROM', () => {
    const hkd = { business_name: 'Tạp hóa An', business_line: 'Bán lẻ', business_address: null, tax_id: null, registration_number: '01A8001234' };
    const p = profile([
      app(hkd),
      license(A, '01A8001234'),
      statement([row(0, 'household_business', 15_000_000, { household_business: { business_name: 'TẠP HÓA AN', business_forms: [], business_line: null, operating_time_raw: null, actual_address: null, premises_type_raw: null, premises_area_m2: null, net_revenue_annual: null, cogs_annual: null, gross_profit_annual: null, total_cost_annual: null, net_profit_annual: null } })]),
    ]);
    expect(p.business_units).toHaveLength(1);
    expect(p.business_units[0]).toMatchObject({ business_id: 'biz-1', owner_person_ids: ['person-1'], flags: [], registration_number: { value: '01A8001234' } });
    expect(p.business_units[0].registration_number.fact_ids).toHaveLength(2); // đơn vay + GCN, dẫn về fact LAC
    expect(p.relations).toEqual(expect.arrayContaining([
      { type: 'OPERATES', from: 'person-1', to: 'biz-1', verification: 'VERIFIED' },
      { type: 'EARNS_FROM', from: 'inc-1', to: 'biz-1', verification: 'VERIFIED' },
    ]));
    expect(p.income_streams[0]).toMatchObject({ kind: 'household_business', business_id: 'biz-1', evidenced: true });
  });

  it('AC-9: vợ và chồng mỗi người một GCN → hai đơn vị, mỗi đơn vị một chủ', () => {
    const p = profile([app(null), license(A, '01A8000001', 'TẠP HÓA AN'), license(B, '01A8000002', 'BÁN THỊT BÌNH')]);
    expect(p.business_units.map((u) => u.owner_person_ids)).toEqual([['person-1'], ['person-2']]);
  });

  it('AC-12: cùng chủ, cùng tên, khác số GCN → không gộp, cả hai gắn BUSINESS_NUMBER_MISMATCH', () => {
    const p = profile([app(null), license(A, '01A8000001'), license(A, '01A8000009')]);
    expect(p.business_units.map((u) => u.flags)).toEqual([['BUSINESS_NUMBER_MISMATCH'], ['BUSINESS_NUMBER_MISMATCH']]);
  });
});

describe('luồng thu nhập (L360-B04, L360-G03)', () => {
  it('AC-10: 3 dòng 20tr / 5tr / 5tr → 3 luồng, tổng 30tr', () => {
    const p = profile([app(null), statement([row(0, 'salary', 20_000_000), row(1, 'rental', 5_000_000), row(2, 'other', 5_000_000)])]);
    expect(p.income_streams.map((s) => s.kind)).toEqual(['salary', 'rental', 'other']);
    expect(p.income_streams.reduce((n, s) => n + (s.monthly_amount ?? 0), 0)).toBe(30_000_000);
  });

  it('AC-18: lương cùng chủ lao động trên 3 chứng từ → một luồng, số theo chính sách MIN; sao kê lương → evidenced', () => {
    const employer = { party_role: 'EMPLOYER', party_type: 'ORGANIZATION', full_name: 'CÔNG TY TNHH ABC', id_number: null };
    const p = profile([
      app(null),
      statement([row(0, 'salary', 20_000_000, { salary: { employer_name: 'Công ty TNHH ABC', current_job_raw: null, position: null, months_at_employer: null, workplace_address: null } })]),
      ev('labor_contract', { parties: [employer, { ...A, party_role: 'EMPLOYEE' }], data: { contract_info: { contract_number: null, contract_type_raw: null, sign_date: null, effective_date: null, expiry_date: null, position: null, work_location_raw: null, monthly_salary: 18_000_000, payment_terms_raw: null } } }),
      ev('payroll_bank_statement', { parties: [{ ...A, party_role: 'HOLDER' }] }),
    ]);
    expect(p.income_streams).toHaveLength(1);
    expect(p.income_streams[0]).toMatchObject({ kind: 'salary', person_id: 'person-1', monthly_amount: 18_000_000, evidenced: true });
  });

  it('catalog chính sách hỏng → không chọn số tiền, gap MERGE_POLICY_INVALID', () => {
    const p = profile([app(null), statement([row(0, 'salary', 20_000_000)])], { policy_version: '' });
    expect(p.income_streams[0].monthly_amount).toBeNull();
    expect(p.gaps).toContainEqual({ code: 'MERGE_POLICY_INVALID', count: 1 });
  });
});
