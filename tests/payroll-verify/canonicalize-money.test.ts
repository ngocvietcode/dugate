/**
 * Tests for canonicalizeMoneyFields — the PDF/OCR-side money normalization that
 * preserves decimals and recovers malformed formatting, symmetric with the
 * Excel branch.
 */
import { canonicalizeMoneyFields } from '@/lib/pipelines/workflows/payroll-verify';
import type { PayrollJSON, PayrollRecord } from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';

function rec(stt: number, soTien: unknown): PayrollRecord {
  return {
    stt,
    ho_ten: 'NGUYEN VAN A',
    so_tai_khoan: '123456789',
    so_tien: soTien as PayrollRecord['so_tien'],
    loai_tai_khoan: 'vpbank',
  } as PayrollRecord;
}

function payroll(records: PayrollRecord[], tong?: string | null): PayrollJSON {
  return {
    thong_tin_chung: { tong_so_tien_bang_so: tong ?? null } as PayrollJSON['thong_tin_chung'],
    danh_sach_trong_vpbank: records,
    danh_sach_ngoai_vpbank: [],
  };
}

describe('canonicalizeMoneyFields (PDF/OCR side)', () => {
  it('preserves genuine decimals in record so_tien', () => {
    const data = payroll([rec(1, '25.369.005,6'), rec(2, '1.500.000')]);
    canonicalizeMoneyFields(data);
    expect(data.danh_sach_trong_vpbank[0].so_tien).toBe(25369005.6);
    expect(data.danh_sach_trong_vpbank[1].so_tien).toBe(1500000);
  });

  it('recovers malformed dot-thousands-over-decimal total', () => {
    const data = payroll([rec(1, 1500000)], '1.000.128.500.21');
    canonicalizeMoneyFields(data);
    expect(data.thong_tin_chung.tong_so_tien_bang_so).toBe('1000128500.21');
  });

  it('leaves unparseable values untouched (mismatch stays visible)', () => {
    const data = payroll([rec(1, 'N/A')], null);
    canonicalizeMoneyFields(data);
    expect(data.danh_sach_trong_vpbank[0].so_tien).toBe('N/A');
    expect(data.thong_tin_chung.tong_so_tien_bang_so).toBeNull();
  });
});
