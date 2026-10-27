// T-S2-05 — hạ confidence khi đọc nhầm trang (S2-R15).
import { applyPageGuard, loanApplicationChecks } from '@/lib/loan-dossier/s2/page-guard';

const conf = { loan_info: 0.95, financial_info: 0.9, business_info: 0.85, parties: 0.9 };

describe('applyPageGuard', () => {
  it('đọc đúng trang → không đổi', () => {
    const r = applyPageGuard(conf, [{ field: 'loan_info', pages: [2], heading_page: 2 }]);
    expect(r.field_confidences).toEqual(conf);
    expect(r.misplaced).toEqual([]);
  });

  it('1 field sai trang → min(cũ, 0.5)', () => {
    const r = applyPageGuard(conf, [{ field: 'loan_info', pages: [3], heading_page: 2 }]);
    expect(r.field_confidences).toEqual({ ...conf, loan_info: 0.5 });
  });

  it('2 field sai trang → mọi field cấp 1 ≤ 0.5', () => {
    const r = applyPageGuard(conf, [
      { field: 'loan_info', pages: [3], heading_page: 2 },
      { field: 'financial_info', pages: [1], heading_page: 4 },
    ]);
    expect(Object.values(r.field_confidences).every((c) => c <= 0.5)).toBe(true);
  });

  it('confidence thấp hơn 0.5 sẵn → không bị nâng; heading null → không yêu cầu', () => {
    const r = applyPageGuard({ loan_info: 0.3 }, [
      { field: 'loan_info', pages: [3], heading_page: 2 },
      { field: 'business_info', pages: [9], heading_page: null },
    ]);
    expect(r.field_confidences.loan_info).toBe(0.3);
    expect(r.misplaced).toEqual(['loan_info']);
  });
});

describe('loanApplicationChecks', () => {
  it('S2-AC07: bank_proposed_amount đọc từ trang không có tiêu đề phần ngân hàng → loan_info ≤ 0.5', () => {
    const data = { loan_info: { bank_proposed_amount: 500000000, bank_proposed_amount_page: 3 } };
    const checks = loanApplicationChecks(data, { loan_info: [2, 3] }, { loan_info: 2, bank_section: 5 });
    expect(applyPageGuard(conf, checks).field_confidences.loan_info).toBe(0.5);
  });

  it('bank_proposed_amount đúng trang phần ngân hàng → không hạ', () => {
    const data = { loan_info: { bank_proposed_amount: 500000000, bank_proposed_amount_page: 5 } };
    const checks = loanApplicationChecks(data, { loan_info: [2, 5] }, { loan_info: 2, bank_section: 5 });
    expect(applyPageGuard(conf, checks).field_confidences.loan_info).toBe(0.95);
  });
});
