// lib/pipelines/workflows/payment-account-management/open-account/validate.ts
// Rule-based validation ("check") for the open-account feature.
// SAMPLE rules only — real business rules are TODO (domain not finalized).

import type { OpenAccountExtracted, OpenAccountValidation, OpenAccountCheck } from './types';
import { unwrap } from '../shared/utils';

/**
 * Verify an extracted (or caller-supplied) open-account data object against
 * a set of rule-based checks. Pure function — no I/O, no throws.
 * overall = 'fail' when any error-severity check fails; warnings never fail.
 */
export function verifyOpenAccount(data: unknown): OpenAccountValidation {
  const d = (data ?? {}) as Partial<OpenAccountExtracted>;
  const checks: OpenAccountCheck[] = [];

  const requireField = (
    code: string,
    description: string,
    ok: boolean,
    severity: 'error' | 'warning',
    reason: string,
  ) => {
    checks.push({
      code,
      description,
      result: ok ? 'pass' : 'fail',
      severity,
      ...(ok ? {} : { reason }),
    });
  };

  // Fields may be wrapped as { value, confidence } (from extraction) or raw scalars
  // (caller-supplied metadata.data in the verification stage). unwrap handles both.
  const hoTen = unwrap(d.ho_ten);
  const cmnd = unwrap(d.cmnd_cccd);
  const loaiTk = unwrap(d.loai_tai_khoan);
  const coChuKy = unwrap(d.co_chu_ky_khach_hang);

  requireField('ho_ten_present', 'Họ tên khách hàng', typeof hoTen === 'string' && !!hoTen.trim(), 'error', 'Thiếu họ tên khách hàng.');
  requireField('cmnd_cccd_present', 'Số CMND/CCCD', typeof cmnd === 'string' && !!cmnd.trim(), 'error', 'Thiếu số CMND/CCCD.');
  requireField('loai_tai_khoan_present', 'Loại tài khoản', typeof loaiTk === 'string' && !!loaiTk.trim(), 'warning', 'Thiếu loại tài khoản.');
  requireField('co_chu_ky', 'Chữ ký khách hàng', coChuKy === true, 'error', 'Chưa có chữ ký khách hàng.');

  const overall: 'pass' | 'fail' =
    checks.some((c) => c.severity === 'error' && c.result === 'fail') ? 'fail' : 'pass';

  return { overall, checks };
}
