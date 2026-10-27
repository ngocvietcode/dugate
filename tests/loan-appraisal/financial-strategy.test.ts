// Phép tính của HkdSecuredFinancialStrategy trên đầu vào có cấu trúc (FinancialInputs, V2-R06).
// Cách đọc đầu vào từ chứng từ spec-v3 (bank_proposed_amount, interest_rate vs mã biểu, has_existing_debt, định giá
// mới nhất…) nằm ở v2-financial-inputs.test.ts. Đường đọc registry bằng regex của v2 cũ đã gỡ (D-99).
import type { FinancialInputs, SourcedNumber } from '@/lib/pipelines/workflows/loan-appraisal/financial-inputs';
import { CONFLICT_PREFIX, HkdSecuredFinancialStrategy } from '@/lib/pipelines/workflows/loan-appraisal/strategies';

const n = (value: number, id: string): SourcedNumber => ({ value, evidenceIds: [id] });
const inputs = (over: Partial<FinancialInputs> = {}): FinancialInputs => ({
  requested: n(1_000_000_000, 'ev-app#loan_info.bank_proposed_amount'),
  tenor: n(60, 'ev-app#loan_info.loan_term_months'),
  rate: n(12, 'ev-app#loan_info.interest_rate'),
  existingMonthly: n(5_000_000, 'ev-app#financial_info.existing_monthly_debt_payment'),
  revenue: n(2_000_000_000, 'ev-inc#income_sources[0].household_business.net_revenue_annual'),
  profit: n(800_000_000, 'ev-inc#income_sources[0].household_business.net_profit_annual'),
  debtService: null,
  collateral: n(2_000_000_000, 'ev-val#asset_details[0].valuation_value'),
  ...over,
});
const run = (i: FinancialInputs, skipCollateral = false) => new HkdSecuredFinancialStrategy().execute({ inputs: i, skipCollateral });

function expectedAnnualPayment(principal: number, ratePercent: number, months: number): number {
  const r = ratePercent / 100 / 12;
  return (principal * r) / (1 - Math.pow(1 + r, -months)) * 12;
}

describe('HkdSecuredFinancialStrategy — DSCR', () => {
  it('nghĩa vụ nợ năm = niên kim khoản vay mới + nghĩa vụ hiện hữu × 12; DSCR = lợi nhuận / nghĩa vụ nợ', () => {
    const result = run(inputs());
    const expectedDebt = expectedAnnualPayment(1_000_000_000, 12, 60) + 5_000_000 * 12;
    expect(result.annual_debt_service.status).toBe('CALCULATED');
    expect(result.annual_debt_service.value).toBeCloseTo(expectedDebt, 0);
    expect(result.dscr.status).toBe('CALCULATED');
    expect(result.dscr.value).toBeCloseTo(800_000_000 / expectedDebt, 6);
    expect(result.dscr.evidence_ids).toEqual(expect.arrayContaining([
      'ev-inc#income_sources[0].household_business.net_profit_annual', 'ev-app#loan_info.bank_proposed_amount', 'ev-app#loan_info.interest_rate',
    ]));
  });

  it('lãi suất 0%: trả gốc đều', () => {
    const result = run(inputs({ rate: n(0, 'r'), existingMonthly: n(0, 'e') }));
    expect(result.annual_debt_service.value).toBeCloseTo((1_000_000_000 / 60) * 12, 0);
  });

  it('nghĩa vụ hiện hữu = 0 (hồ sơ khai không có khoản vay) → chỉ còn niên kim khoản vay mới', () => {
    const result = run(inputs({ existingMonthly: n(0, 'ev-app#financial_info.has_existing_debt') }));
    expect(result.annual_debt_service.value).toBeCloseTo(expectedAnnualPayment(1_000_000_000, 12, 60), 0);
  });

  it('không giả định nghĩa vụ hiện hữu khi hồ sơ không khai: nghĩa vụ nợ và DSCR thiếu dữ liệu, cảnh báo nêu đầu vào thiếu', () => {
    const result = run(inputs({ existingMonthly: null }));
    expect(result.annual_debt_service.status).toBe('INSUFFICIENT_DATA');
    expect(result.annual_debt_service.warnings[0]).toContain('nghĩa vụ nợ hiện hữu');
    expect(result.dscr.status).toBe('INSUFFICIENT_DATA');
  });

  it('thiếu lãi suất → nghĩa vụ nợ thiếu dữ liệu, cảnh báo nêu lãi suất', () => {
    const result = run(inputs({ rate: null }));
    expect(result.annual_debt_service.status).toBe('INSUFFICIENT_DATA');
    expect(result.annual_debt_service.warnings[0]).toContain('lãi suất');
  });

  it('đầu vào xung đột (MD-R13) → chỉ số phụ thuộc thiếu dữ liệu, gắn input_conflict, cảnh báo nêu trường', () => {
    const result = run(inputs({ rate: null, conflicts: { rate: 'loan_info.interest_rate' } }));
    expect(result.annual_debt_service.input_conflict).toBe(true);
    expect(result.annual_debt_service.warnings.some((w) => w.startsWith(CONFLICT_PREFIX) && w.includes('loan_info.interest_rate'))).toBe(true);
    expect(result.dscr.input_conflict).toBe(true);
  });
});

describe('HkdSecuredFinancialStrategy — LTV, biên lợi nhuận', () => {
  it('LTV = số tiền cho vay / giá trị TSBĐ; biên lợi nhuận = lợi nhuận / doanh thu', () => {
    const result = run(inputs());
    expect(result.collateral_value.value).toBe(2_000_000_000);
    expect(result.ltv.value).toBeCloseTo(0.5, 6);
    expect(result.operating_margin.value).toBeCloseTo(0.4, 6);
  });

  it('không có giá trị TSBĐ → LTV thiếu dữ liệu', () => {
    expect(run(inputs({ collateral: null })).ltv.status).toBe('INSUFFICIENT_DATA');
  });

  it('skipCollateral (S3 lỗi) → giá trị TSBĐ và LTV NOT_APPLICABLE, không báo thiếu giả', () => {
    const result = run(inputs(), true);
    expect(result.collateral_value.status).toBe('NOT_APPLICABLE');
    expect(result.ltv.status).toBe('NOT_APPLICABLE');
    expect(result.dscr.status).toBe('CALCULATED');
  });
});
