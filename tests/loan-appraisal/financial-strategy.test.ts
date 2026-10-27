import {
  HkdSecuredFinancialStrategy,
  parseRatePercent,
  parseTenorMonths,
} from '@/lib/pipelines/workflows/loan-appraisal/strategies';
import type { EvidenceRecord, EvidenceRegistry } from '@/lib/pipelines/workflows/loan-appraisal/types';

let seq = 0;
function record(docTypeKey: string, fieldPath: string, value: string | number | boolean, accepted = true): EvidenceRecord {
  seq += 1;
  return {
    evidence_id: `ev-${seq}`,
    field_path: fieldPath,
    value,
    normalized_value: value,
    file_name: `${docTypeKey}.pdf`,
    doc_type_key: docTypeKey,
    doc_type_label: docTypeKey,
    classification_confidence: 0.9,
    extraction_method: 'AI_EXTRACT',
    evidence_kind: 'EXTRACTED_FIELD',
    review_status: accepted ? 'ACCEPTED' : 'REVIEW',
  };
}
const registry = (records: EvidenceRecord[]): EvidenceRegistry => ({ records, by_file: [], by_document_type: [] });
const run = (records: EvidenceRecord[]) => new HkdSecuredFinancialStrategy().execute({ evidence: registry(records) });

function expectedAnnualPayment(principal: number, ratePercent: number, months: number): number {
  const r = ratePercent / 100 / 12;
  return (principal * r) / (1 - Math.pow(1 + r, -months)) * 12;
}

beforeEach(() => { seq = 0; });

describe('parse kỳ hạn và lãi suất', () => {
  it.each([
    ['60 tháng', 60], ['5 năm', 60], [36, 36], ['0', null], ['abc', null],
  ])('parseTenorMonths(%p) = %p', (input, expected) => {
    expect(parseTenorMonths(input)).toBe(expected);
  });

  it.each([
    ['9,5%/năm', 9.5], [12, 12], [0.1, 10], ['0,8%/tháng', 9.6], ['không rõ', null],
  ])('parseRatePercent(%p) ≈ %p', (input, expected) => {
    const result = parseRatePercent(input);
    if (expected === null) expect(result).toBeNull();
    else expect(result).toBeCloseTo(expected as number, 6);
  });
});

describe('HkdSecuredFinancialStrategy — DSCR', () => {
  // Field theo danh mục mẫu biểu: de_nghi_vay_von.loan_amount / loan_term /
  // interest_rate_percent / existing_monthly_debt_payment / has_existing_debt,
  // bang_ke_thu_nhap.hkd_net_profit (theo năm).
  const base = () => [
    record('loan_request', 'loan_amount', '1.000.000.000'),
    record('loan_request', 'loan_term', '60'),
    record('loan_request', 'interest_rate_percent', '12%/năm'),
    record('income_statement', 'hkd_net_profit', '800.000.000'),
  ];

  it('tính nghĩa vụ nợ năm = niên kim khoản vay mới + nghĩa vụ hiện hữu × 12', () => {
    const result = run([...base(), record('loan_request', 'existing_monthly_debt_payment', '5.000.000')]);
    const expectedDebt = expectedAnnualPayment(1_000_000_000, 12, 60) + 5_000_000 * 12;
    expect(result.annual_debt_service.status).toBe('CALCULATED');
    expect(result.annual_debt_service.value).toBeCloseTo(expectedDebt, 0);
    expect(result.dscr.status).toBe('CALCULATED');
    expect(result.dscr.value).toBeCloseTo(800_000_000 / expectedDebt, 6);
    expect(result.dscr.evidence_ids.length).toBeGreaterThan(0);
  });

  it('không coi mã biểu lãi suất (interest_rate = "LC10") là 10%/năm', () => {
    const records = base().filter((item) => !item.field_path.includes('interest_rate_percent'));
    const result = run([
      ...records,
      record('loan_request', 'interest_rate', 'LC10'),
      record('loan_request', 'existing_monthly_debt_payment', '0'),
    ]);
    expect(result.annual_debt_service.status).toBe('INSUFFICIENT_DATA');
    expect(result.annual_debt_service.warnings[0]).toContain('lãi suất');
  });

  it('coi nghĩa vụ hiện hữu = 0 chỉ khi hồ sơ khai rõ không có khoản vay', () => {
    const result = run([...base(), record('loan_request', 'has_existing_debt', 'Không')]);
    expect(result.annual_debt_service.value).toBeCloseTo(expectedAnnualPayment(1_000_000_000, 12, 60), 0);
  });

  it('không giả định nghĩa vụ hiện hữu khi hồ sơ không khai', () => {
    const result = run(base());
    expect(result.annual_debt_service.status).toBe('INSUFFICIENT_DATA');
    expect(result.annual_debt_service.warnings[0]).toContain('nghĩa vụ nợ hiện hữu');
    expect(result.dscr.status).toBe('INSUFFICIENT_DATA');
  });

  it('không dùng evidence chưa được chấp nhận', () => {
    const records = base();
    records[1] = record('loan_request', 'loan_term', '60', false);
    const result = run([...records, record('loan_request', 'existing_obligations.monthly_debt_payment', '0')]);
    expect(result.annual_debt_service.status).toBe('INSUFFICIENT_DATA');
  });
});

describe('HkdSecuredFinancialStrategy — LTV', () => {
  it('lấy giá trị từ chứng thư định giá (asset_value) và ưu tiên hơn GCN', () => {
    const result = run([
      record('loan_request', 'loan_amount', '1.000.000.000'),
      record('collateral_cert', 'valuation.total_value', '5.000.000.000'),
      record('valuation', 'asset_value', '2.000.000.000'),
    ]);
    expect(result.collateral_value.value).toBe(2_000_000_000);
    expect(result.ltv.value).toBeCloseTo(0.5, 6);
  });

  it('dùng GCN khi không có chứng thư định giá', () => {
    const result = run([
      record('loan_request', 'loan_request.requested_amount.number', '1.000.000.000'),
      record('collateral_cert', 'valuation.total_value', '4.000.000.000'),
    ]);
    expect(result.ltv.value).toBeCloseTo(0.25, 6);
  });
});
