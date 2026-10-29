// T-DOC-10 — schema zod loan_application: 10a parties/party_details, 10b assets/asset_details,
// 10c loan_info/business_info/financial_info/officer_info (S2-R16, S2-AC12, D-32).
import { getDocSchema } from '@/lib/loan-dossier/s2/schema-registry';
import type { LoanApplicationData } from '@/lib/loan-dossier/s2/schemas';

import { describeDocSchema } from './fixtures/doc-schema-suite';
import { makeRichData } from './fixtures/build';

describeDocSchema('loan_application', ['BORROWER', 'CO_BORROWER', 'SPOUSE', 'COLLATERAL_OWNER', 'REFERENCE_PERSON', 'LEGAL_REPRESENTATIVE', 'GUARANTOR', 'CAPITAL_MEMBER']);

const schema = getDocSchema('loan_application');
const rich = () => makeRichData('loan_application') as unknown as LoanApplicationData;
const ok = (d: unknown) => schema.safeParse(d).success;

describe('T-DOC-10a — parties, party_details', () => {
  it('party_details.form_section ngoài enum bị từ chối', () => {
    const d = rich();
    (d.party_details[0] as Record<string, unknown>).form_section = 'SECTION_9';
    expect(ok(d)).toBe(false);
  });

  it('party của đơn vay không mang ownership', () => {
    const d = rich();
    (d.parties[0] as Record<string, unknown>).ownership = { asset_index: 0, ownership_source: 'COVER_PAGE', ownership_change_date: null, is_current_owner: true };
    expect(ok(d)).toBe(false);
  });
});

describe('T-DOC-10b — assets, asset_details', () => {
  it('tài sản trên đơn vay là TSBĐ: usage_context_hint = collateral (S2-R12)', () => {
    const d = rich();
    expect(ok(d)).toBe(true);
    (d.assets[0] as Record<string, unknown>).usage_context_hint = 'rental_income';
    expect(ok(d)).toBe(false);
    (d.assets[0] as Record<string, unknown>).usage_context_hint = null;
    expect(ok(d)).toBe(false);
  });

  it('asset_details.declared_value là số nguyên VND', () => {
    const d = rich();
    (d.asset_details[0] as Record<string, unknown>).declared_value = 1500000.5;
    expect(ok(d)).toBe(false);
  });
});

describe('T-DOC-10c — loan_info, business_info, financial_info, officer_info', () => {
  it('S2-AC12: số tiền đề nghị và số tiền cho vay khác nhau, mỗi số có trang nguồn', () => {
    const d = rich();
    Object.assign(d.loan_info!, { requested_amount: 600000000, requested_amount_page: 2, bank_proposed_amount: 500000000, bank_proposed_amount_page: 6 });
    const r = schema.safeParse(d);
    expect(r.success).toBe(true);
    const loan = (r.data as LoanApplicationData).loan_info!;
    expect([loan.requested_amount, loan.bank_proposed_amount]).toEqual([600000000, 500000000]);
  });

  it('một bên trống → null, bên còn lại vẫn hợp lệ', () => {
    const d = rich();
    Object.assign(d.loan_info!, { requested_amount: null, requested_amount_page: null });
    expect(ok(d)).toBe(true);
  });

  it('ô "Lãi suất" ghi LC10 → interest_rate_code = "LC10", interest_rate = null; LC10 không vào được interest_rate', () => {
    const d = rich();
    Object.assign(d.loan_info!, { interest_rate_code: 'LC10', interest_rate: null, interest_rate_raw: 'LC10' });
    expect(ok(d)).toBe(true);
    (d.loan_info as Record<string, unknown>).interest_rate = 'LC10';
    expect(ok(d)).toBe(false);
  });

  it('interest_rate là %/năm trong 0–100', () => {
    const d = rich();
    d.loan_info!.interest_rate = 101;
    expect(ok(d)).toBe(false);
  });

  it('nghĩa vụ nợ hiện hữu: has_existing_debt boolean, existing_monthly_debt_payment số nguyên (D-32)', () => {
    const d = rich();
    Object.assign(d.financial_info!, { has_existing_debt: false, existing_monthly_debt_payment: 0 });
    expect(ok(d)).toBe(true);
    (d.financial_info as Record<string, unknown>).has_existing_debt = 'Không';
    expect(ok(d)).toBe(false);
    Object.assign(d.financial_info!, { has_existing_debt: true, existing_monthly_debt_payment: '5.000.000' });
    expect(ok(d)).toBe(false);
  });

  it('loan_purpose_categories không được trùng', () => {
    const d = rich();
    d.loan_info!.loan_purpose_categories = ['PURCHASE_VEHICLE', 'PURCHASE_VEHICLE'];
    expect(ok(d)).toBe(false);
  });

  it('business_info.business_address là object Address, không phải chuỗi', () => {
    const d = rich();
    (d.business_info as Record<string, unknown>).business_address = 'SO 1 DUONG A';
    expect(ok(d)).toBe(false);
  });

  it('officer_info.decision_date phải là ngày ISO', () => {
    const d = rich();
    (d.officer_info as Record<string, unknown>).decision_date = '14/10/2026';
    expect(ok(d)).toBe(false);
  });
});
