// Hồ sơ 360 SME (T-360-09; loan_360.md L360-B08…B11, AC-14, AC-15): khách vay pháp nhân, người đại diện theo CCCD, BCTC nối theo
// mã số thuế, số cho DSCR SME (OQ-360-13). Dữ liệu giả, không PII thật.
import { Profile360Schema } from '@/lib/loan-dossier/profile360/schema';
import { financialInputsFromProfile } from '@/lib/pipelines/workflows/loan-appraisal/financial-inputs';

import { ev, ID_A12, loanApp } from './fixtures/dossier';
import { profileOf } from './fixtures/profile';

const TAX = '0101234567';
const COMPANY = { party_role: 'BORROWER', party_type: 'ORGANIZATION', full_name: 'CÔNG TY TNHH THƯƠNG MẠI AN PHÁT', tax_id: TAX };
const REP = { party_role: 'LEGAL_REPRESENTATIVE', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };

const erc = (representative_id_number: string | null) => ev('enterprise_registration_license', {
  parties: [{ ...COMPANY, party_role: 'HOLDER', representative_name: 'NGUYỄN VĂN AN' }],
  data: { fields: { registration_number: TAX, headquarters_address: null, representative_id_number } },
});
const pnl = (tax_id: string, period_to: string, profit_before_tax: number, interest_expense: number) => ev('financial_performance_report', {
  parties: [{ ...COMPANY, party_role: 'HOLDER', tax_id }],
  data: {
    performance_info: {
      period_raw: null, period_from: null, period_to, net_revenue: 5_000_000_000, cogs: null, gross_profit: null,
      interest_expense, profit_before_tax, profit_after_tax: null, is_audited: false,
    },
  },
});
const sme = (evidences: Parameters<typeof profileOf>[0]) => Profile360Schema.parse(profileOf(evidences, { segment: 'SME' }));

describe('khách vay SME là pháp nhân (T-360-09)', () => {
  it('AC-15 + OQ-360-13: GCN ĐKDN, BCKQKD cùng MST → một doanh nghiệp; DSCR dùng LNTT + lãi vay của kỳ gần nhất; người đại diện khớp CCCD', () => {
    const p = sme([loanApp([COMPANY, REP]), erc(ID_A12), pnl(TAX, '2024-12-31', 300_000_000, 50_000_000), pnl(TAX, '2025-12-31', 400_000_000, 100_000_000)]);
    const enterprise = p.business_units.filter((u) => u.kind === 'ENTERPRISE');
    expect(enterprise).toHaveLength(1);
    const company = p.customers.find((c) => c.party_type === 'ORGANIZATION')!;
    expect(enterprise[0].owner_person_ids).toEqual([company.person_id]);
    expect(p.relations.filter((r) => r.type === 'FILED_BY' && r.verification === 'VERIFIED')).toHaveLength(2);
    expect(financialInputsFromProfile(p).profit?.value).toBe(500_000_000);
    expect(company.relations).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'REPRESENTED_BY', verification: 'VERIFIED' })]));
    expect(p.issues.map((i) => i.code)).not.toContain('LEGAL_REP_NOT_VERIFIED');
  });

  it('AC-14 + AC-15: GCN không có số định danh người đại diện → LEGAL_REP_NOT_VERIFIED; BCKQKD khác MST → không nối, không vào DSCR', () => {
    const p = sme([loanApp([COMPANY, REP]), erc(null), pnl('0109999999', '2025-12-31', 400_000_000, 100_000_000)]);
    expect(p.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['LEGAL_REP_NOT_VERIFIED', 'FILING_NOT_LINKED']));
    expect(financialInputsFromProfile(p).profit).toBeNull();
  });
});
