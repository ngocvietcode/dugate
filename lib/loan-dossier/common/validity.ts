// Hiệu lực chứng từ — hàm dùng chung S3 (bản bị thay thế, S3-R27) và S4 (S4-R15). T-S4-02.
// Hàm thuần, tất định; ngày tính theo lịch (UTC), không theo giờ.

export interface ValidityInput {
  /** `legal_info.issue_date`: `YYYY-MM-DD`, `YYYY-MM`, `YYYY` hoặc null. */
  issue_date: string | null;
  /** `legal_info.valid_until`: chỉ dùng khi đủ ngày. */
  valid_until: string | null;
  /** Chứng từ chỉ nhận diện (không có evidence bóc tách đầy đủ). */
  recognition_only?: boolean;
}

export interface ValidityRule {
  /** `validity_days` của item checklist; null = không có thời hạn theo catalog. */
  validityDays: number | null;
  /** `ignore_printed_expiry` của item (VD đăng kiểm xe). */
  ignorePrintedExpiry: boolean;
}

export type ValidityBasis = 'PRINTED_EXPIRY' | 'VALIDITY_DAYS' | null;

export interface ValidityResult {
  expired: boolean;
  /** false = không đủ ngày để kết luận (S4-R15 c, d). */
  dateOK: boolean;
  /** Căn cứ kết luận hết hạn (S4-R23 chọn câu thông báo); null khi không hết hạn. */
  basis: ValidityBasis;
}

const FULL = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const YEAR = /^(\d{4})$/;
const DAY_MS = 86_400_000;

function dayNumber(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fullDay(s: string | null): number | null {
  const m = s ? s.match(FULL) : null;
  return m ? dayNumber(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** Khoảng [ngày sớm nhất, ngày muộn nhất] của một ngày có thể thiếu tháng/ngày. */
function dayRange(s: string | null): [number, number] | null {
  if (!s) return null;
  const full = fullDay(s);
  if (full !== null) return [full, full];
  let m = s.match(MONTH);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return [dayNumber(y, mo, 1), dayNumber(y, mo + 1, 1) - 1];
  }
  m = s.match(YEAR);
  if (m) {
    const y = Number(m[1]);
    return [dayNumber(y, 1, 1), dayNumber(y, 12, 31)];
  }
  return null;
}

const ok = (): ValidityResult => ({ expired: false, dateOK: true, basis: null });

export function evaluateValidity(c: ValidityInput, rule: ValidityRule, d0: string): ValidityResult {
  const today = fullDay(d0);
  if (today === null) throw new RangeError('evaluateValidity: d0 phải là ngày ISO YYYY-MM-DD');

  // (A) Ngày hết hạn in trên giấy — mọi item trừ ignore_printed_expiry.
  const printed = rule.ignorePrintedExpiry ? null : fullDay(c.valid_until);
  if (printed !== null && printed < today) return { expired: true, dateOK: true, basis: 'PRINTED_EXPIRY' };

  // (e) Chứng từ chỉ nhận diện không có ngày → luôn còn hạn.
  if (c.recognition_only && !c.issue_date && !c.valid_until) return ok();

  // (B) Thời hạn theo catalog.
  if (rule.validityDays === null) return ok();
  const days = rule.validityDays;
  const range = dayRange(c.issue_date);
  if (range === null) {
    // (d) Không có ngày cấp: chỉ kết luận được nếu ngày hết hạn in trên giấy còn hiệu lực.
    return printed !== null ? ok() : { expired: false, dateOK: false, basis: null };
  }
  const [earliest, latest] = range;
  if (earliest === latest) {
    // (b) Ngày thứ `validityDays` vẫn còn hạn.
    return today - earliest > days ? { expired: true, dateOK: true, basis: 'VALIDITY_DAYS' } : ok();
  }
  // (c) Ngày cấp chỉ có tháng/năm.
  if (today - latest > days) return { expired: true, dateOK: true, basis: 'VALIDITY_DAYS' };
  if (today - earliest <= days) return ok();
  return { expired: false, dateOK: false, basis: null };
}

/** Ngày cấp tối thiểu để còn hạn tại d0 (`d0 − validityDays`, S4-R23). */
export function minimumIssueDate(validityDays: number, d0: string): string {
  const today = fullDay(d0);
  if (today === null) throw new RangeError('minimumIssueDate: d0 phải là ngày ISO YYYY-MM-DD');
  return new Date((today - validityDays) * DAY_MS).toISOString().slice(0, 10);
}
