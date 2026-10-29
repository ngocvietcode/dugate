// T-V2-06, T-360-03 (D-114) — đầu vào tài chính đọc hồ sơ 360 (nguồn sự thật duy nhất).
import { financialInputsFromProfile } from '@/lib/pipelines/workflows/loan-appraisal/financial-inputs';
import { HkdSecuredFinancialStrategy } from '@/lib/pipelines/workflows/loan-appraisal/strategies';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';
import { profileOf } from '../loan-dossier/fixtures/profile';

const D0 = '2026-10-14';
const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };

function app(loan: Record<string, unknown>, fin: Record<string, unknown> = {}) {
  const a = loanApp([borrower], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'CS1' } }] });
  a.data!.loan_info = { ...(a.data!.loan_info as object), requested_amount: 600_000_000, bank_proposed_amount: 500_000_000, loan_term_months: 60, interest_rate: 10, interest_rate_code: 'LC10', ...loan };
  a.data!.financial_info = { ...(a.data!.financial_info as object), has_existing_debt: true, existing_monthly_debt_payment: 2_000_000, ...fin };
  return a;
}
const income = (sources: Array<Record<string, unknown>>) => ev('income_statement', { parties: [borrower], data: { income_sources: sources } });
const hkd = { income_type: 'household_business', monthly_amount: 30_000_000, household_business: { net_revenue_annual: 1_200_000_000, net_profit_annual: 360_000_000 } };
const valuation = (value: number, issue: string) => {
  const v = ev('real_estate_valuation_report', { issue_date: issue, parties: [], assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'CS1' } }] });
  v.data!.asset_details = [{ ...((v.data!.asset_details as Array<Record<string, unknown>> | undefined)?.[0] ?? {}), asset_index: 0, valuation_value: value }];
  return v;
};

function metrics(evs: EvidenceEnvelope[]) {
  const s3 = runMapDossier({ evidences: evs, dossier_submitted_at: D0 });
  const inputs = financialInputsFromProfile(profileOf(evs, { s3: s3.data }));
  return { inputs, m: new HkdSecuredFinancialStrategy().execute({ inputs }), s3 };
}

describe('financialInputsFromProfile', () => {
  it('đủ dữ liệu → DSCR, LTV tính được; số tiền vay = bank_proposed_amount', () => {
    const { m } = metrics([app({}), income([hkd]), valuation(1_000_000_000, '2026-06-01')]);
    expect(m.requested_amount.value).toBe(500_000_000);
    expect(m.dscr.status).toBe('CALCULATED');
    expect(m.ltv.value).toBeCloseTo(0.5);
    expect(m.annual_revenue.value).toBe(1_200_000_000);
  });

  it('bank_proposed_amount null, requested_amount có → DSCR, LTV INSUFFICIENT_DATA', () => {
    const { m } = metrics([app({ bank_proposed_amount: null }), income([hkd]), valuation(1_000_000_000, '2026-06-01')]);
    expect([m.requested_amount.status, m.dscr.status, m.ltv.status]).toEqual(['INSUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'INSUFFICIENT_DATA']);
  });

  it('interest_rate null, interest_rate_code LC10 → DSCR INSUFFICIENT_DATA', () => {
    const { m } = metrics([app({ interest_rate: null }), income([hkd])]);
    expect(m.dscr.status).toBe('INSUFFICIENT_DATA');
  });

  it('has_existing_debt = false → nợ hiện hữu 0; cả hai null → INSUFFICIENT_DATA', () => {
    expect(metrics([app({}, { has_existing_debt: false, existing_monthly_debt_payment: null })]).inputs.existingMonthly?.value).toBe(0);
    const { m } = metrics([app({}, { has_existing_debt: null, existing_monthly_debt_payment: null }), income([hkd])]);
    expect(m.annual_debt_service.status).toBe('INSUFFICIENT_DATA');
  });

  it('chỉ đọc *_annual của nguồn household_business', () => {
    const other = { income_type: 'salary', monthly_amount: 10_000_000, household_business: { net_revenue_annual: 999, net_profit_annual: 999 } };
    expect(metrics([app({}), income([other])]).inputs.revenue).toBeNull();
    expect(metrics([app({}), income([other, hkd])]).inputs.profit?.value).toBe(360_000_000);
  });

  it('định giá bị thay thế không dùng cho LTV', () => {
    const { inputs, s3 } = metrics([app({}), valuation(800_000_000, '2025-01-01'), valuation(1_000_000_000, '2026-06-01')]);
    expect(s3.data!.superseded_evidences.length).toBe(1);
    expect(inputs.collateral?.value).toBe(1_000_000_000);
  });

  it('D-112: nhiều chứng thư còn hiệu lực cho một tài sản → LTV dùng giá thấp nhất', () => {
    const external = ev('external_valuation_certificate', { issue_date: '2026-06-01', parties: [], assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'CS1' } }] });
    external.data!.asset_details = [{ ...((external.data!.asset_details as Array<Record<string, unknown>> | undefined)?.[0] ?? {}), asset_index: 0, valuation_value: 900_000_000 }];
    expect(metrics([app({}), valuation(1_000_000_000, '2026-06-01'), external]).inputs.collateral?.value).toBe(900_000_000);
  });

  it('D-114: hai HKD khác nhau → cộng lợi nhuận; một HKD trên hai bảng kê → không cộng trùng', () => {
    const named = (business_name: string, net_profit_annual: number) => ({ ...hkd, household_business: { business_name, net_revenue_annual: 100, net_profit_annual } });
    expect(metrics([app({}), income([named('HKD A', 300), named('HKD B', 40)])]).inputs.profit?.value).toBe(340);
    expect(metrics([app({}), income([named('HKD A', 300)]), income([named('HKD A', 300)])]).inputs.profit?.value).toBe(300);
  });

  it('có S3 và không skipCollateral: giá trị TSBĐ và LTV tính được từ tài sản collateral; không có S3 thì không biết TSBĐ nào', () => {
    const evs = [app({}), valuation(1_000_000_000, '2026-06-01')];
    const s3 = runMapDossier({ evidences: evs, dossier_submitted_at: D0 });
    const withS3 = new HkdSecuredFinancialStrategy().execute({ inputs: financialInputsFromProfile(profileOf(evs, { s3: s3.data })), skipCollateral: false });
    expect(withS3.collateral_value).toMatchObject({ status: 'CALCULATED', value: 1_000_000_000 });
    expect(withS3.ltv.value).toBeCloseTo(0.5);
    const noS3 = new HkdSecuredFinancialStrategy().execute({ inputs: financialInputsFromProfile(profileOf(evs, { s3: null })), skipCollateral: true });
    expect([noS3.collateral_value.status, noS3.ltv.status]).toEqual(['NOT_APPLICABLE', 'NOT_APPLICABLE']);
  });
});

describe('E9 / D-101: đầu vào đọc với độ tin cậy thấp vẫn dùng, nhưng gắn cờ', () => {
  const withConf = (e: EvidenceEnvelope, conf: Record<string, number>) => ({ ...e, field_confidences: { ...e.field_confidences, ...conf } });

  it('loan_info, financial_info, income_sources đều ≥ 0.80 → không có reviewIds, chỉ số không mang cờ', () => {
    const evs = [withConf(app({}), { loan_info: 0.95, financial_info: 0.9 }), withConf(income([hkd]), { income_sources: 0.85 })];
    const { inputs, m } = metrics(evs);
    for (const k of ['requested', 'tenor', 'rate', 'existingMonthly', 'revenue', 'profit'] as const) expect(inputs[k]?.reviewIds).toBeUndefined();
    expect(m.dscr.needs_review).toBeUndefined();
  });

  it('loan_info < 0.80 → số tiền vay, kỳ hạn, lãi suất mang reviewIds đúng evidence_id; giá trị vẫn được đọc', () => {
    const a = withConf(app({}), { loan_info: 0.5, financial_info: 0.9 });
    const { inputs, m } = metrics([a, withConf(income([hkd]), { income_sources: 0.9 })]);
    expect(inputs.requested).toMatchObject({ value: 500_000_000, reviewIds: [`${a.evidence_id}#loan_info.bank_proposed_amount`] });
    expect(inputs.rate?.reviewIds).toEqual([`${a.evidence_id}#loan_info.interest_rate`]);
    expect(inputs.existingMonthly?.reviewIds).toBeUndefined();
    expect(m.dscr).toMatchObject({ status: 'CALCULATED', needs_review: true });
  });

  it('không có độ tin cậy cho field cấp 1 → coi như REVIEW (cùng quy tắc V2-R04)', () => {
    const { inputs } = metrics([app({})]); // fixture chỉ khai parties / assets / legal_info
    expect(inputs.requested?.reviewIds).toHaveLength(1);
  });

  it('income_sources < 0.80 → doanh thu, lợi nhuận mang reviewIds dạng [i]', () => {
    const inc = withConf(income([hkd]), { income_sources: 0.6 });
    const { inputs } = metrics([withConf(app({}), { loan_info: 0.95, financial_info: 0.95 }), inc]);
    expect(inputs.profit?.reviewIds).toEqual([`${inc.evidence_id}#income_sources[0].household_business.net_profit_annual`]);
  });
});
