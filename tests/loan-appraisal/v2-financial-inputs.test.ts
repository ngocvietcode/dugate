// T-V2-06 — đầu vào tài chính theo spec (V2-R06).
import { financialInputsV3 } from '@/lib/pipelines/workflows/loan-appraisal/financial-inputs';
import { HkdSecuredFinancialStrategy } from '@/lib/pipelines/workflows/loan-appraisal/strategies';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

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
  const inputs = financialInputsV3(evs, s3.data);
  return { inputs, m: new HkdSecuredFinancialStrategy().execute({ inputs }), s3 };
}

describe('financialInputsV3', () => {
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

  it('định giá bị thay thế không dùng cho LTV; nhiều bản → bản mới nhất', () => {
    const { inputs, s3 } = metrics([app({}), valuation(800_000_000, '2025-01-01'), valuation(1_000_000_000, '2026-06-01')]);
    expect(s3.data!.superseded_evidences.length).toBe(1);
    expect(inputs.collateral?.value).toBe(1_000_000_000);
  });

  it('có S3 và không skipCollateral: giá trị TSBĐ và LTV tính được từ tài sản collateral; không có S3 thì không biết TSBĐ nào', () => {
    const evs = [app({}), valuation(1_000_000_000, '2026-06-01')];
    const s3 = runMapDossier({ evidences: evs, dossier_submitted_at: D0 });
    const withS3 = new HkdSecuredFinancialStrategy().execute({ inputs: financialInputsV3(evs, s3.data), skipCollateral: false });
    expect(withS3.collateral_value).toMatchObject({ status: 'CALCULATED', value: 1_000_000_000 });
    expect(withS3.ltv.value).toBeCloseTo(0.5);
    const noS3 = new HkdSecuredFinancialStrategy().execute({ inputs: financialInputsV3(evs, null), skipCollateral: true });
    expect([noS3.collateral_value.status, noS3.ltv.status]).toEqual(['NOT_APPLICABLE', 'NOT_APPLICABLE']);
  });
});
