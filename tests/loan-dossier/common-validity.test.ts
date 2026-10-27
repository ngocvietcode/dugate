// T-S4-02 — hiệu lực chứng từ (S4-R15, S4-AC06, S4-AC18–20).
import { evaluateValidity, minimumIssueDate } from '@/lib/loan-dossier/common/validity';

const D0 = '2026-10-14';
const days180 = { validityDays: 180, ignorePrintedExpiry: false };
const noDays = { validityDays: null, ignorePrintedExpiry: false };

describe('evaluateValidity', () => {
  it('S4-AC06: ngày thứ validityDays còn hạn, ngày validityDays+1 hết hạn', () => {
    expect(evaluateValidity({ issue_date: '2026-04-17', valid_until: null }, days180, D0)).toEqual({ expired: false, dateOK: true, basis: null });
    expect(evaluateValidity({ issue_date: '2026-04-16', valid_until: null }, days180, D0)).toEqual({ expired: true, dateOK: true, basis: 'VALIDITY_DAYS' });
  });

  it('valid_until < d0 hết hạn dù issue_date còn hạn', () => {
    expect(evaluateValidity({ issue_date: '2026-09-20', valid_until: '2026-10-13' }, days180, D0))
      .toEqual({ expired: true, dateOK: true, basis: 'PRINTED_EXPIRY' });
  });

  it('S4-AC19: validityDays = null, valid_until < d0 → hết hạn (CCCD)', () => {
    expect(evaluateValidity({ issue_date: '2015-01-01', valid_until: '2026-08-01' }, noDays, D0).expired).toBe(true);
  });

  it('S4-AC20: ignorePrintedExpiry → không hết hạn (đăng kiểm xe)', () => {
    expect(evaluateValidity({ issue_date: '2025-01-01', valid_until: '2026-01-01' }, { validityDays: null, ignorePrintedExpiry: true }, D0))
      .toEqual({ expired: false, dateOK: true, basis: null });
  });

  it('YYYY-MM: chắc chắn hết hạn / chắc chắn còn hạn / không kết luận', () => {
    expect(evaluateValidity({ issue_date: '2026-03', valid_until: null }, days180, D0).expired).toBe(true);
    expect(evaluateValidity({ issue_date: '2026-09', valid_until: null }, days180, D0)).toEqual({ expired: false, dateOK: true, basis: null });
    expect(evaluateValidity({ issue_date: '2026-04', valid_until: null }, days180, D0)).toEqual({ expired: false, dateOK: false, basis: null });
  });

  it('YYYY: cả năm nằm ngoài hạn → hết hạn', () => {
    expect(evaluateValidity({ issue_date: '2024', valid_until: null }, days180, D0).expired).toBe(true);
  });

  it('issue_date = null → dateOK = false; có valid_until còn hạn thì kết luận được', () => {
    expect(evaluateValidity({ issue_date: null, valid_until: null }, days180, D0)).toEqual({ expired: false, dateOK: false, basis: null });
    expect(evaluateValidity({ issue_date: null, valid_until: '2027-01-01' }, days180, D0)).toEqual({ expired: false, dateOK: true, basis: null });
  });

  it('validityDays = null, không có valid_until → không bao giờ hết hạn', () => {
    expect(evaluateValidity({ issue_date: '2000-01-01', valid_until: null }, noDays, D0)).toEqual({ expired: false, dateOK: true, basis: null });
  });

  it('chứng từ chỉ nhận diện không ngày → còn hạn', () => {
    expect(evaluateValidity({ issue_date: null, valid_until: null, recognition_only: true }, days180, D0))
      .toEqual({ expired: false, dateOK: true, basis: null });
  });

  it('d0 sai định dạng → RangeError', () => {
    expect(() => evaluateValidity({ issue_date: null, valid_until: null }, noDays, '14/10/2026')).toThrow(RangeError);
  });
});

describe('minimumIssueDate', () => {
  it('S4-AC18: d0 2026-10-14, 180 ngày → 2026-04-17', () => expect(minimumIssueDate(180, D0)).toBe('2026-04-17'));
});
