/**
 * Tests for syncRecordCurrencyFromHeader — the fix for the loai_tien mismatch bug.
 *
 * Bug: Excel record.loai_tien used to be extracted per-block by detectLoaiTien(),
 * which joined every cell in a row into one string and sliced from after "Loại
 * tiền" to the end of the row. When "Loại tiền" and "Tổng số tiền bằng chữ" sit
 * on the same Excel row, the slice swallowed the amount-in-words text too,
 * producing values like "VNĐ Ba mươi lăm tỷ, một trăm lẻ chín triệu, ...".
 *
 * Fix: record-level loai_tien is no longer extracted by the Excel parser
 * (payroll-verify-excel.ts always sets it to null). Instead,
 * syncRecordCurrencyFromHeader copies the already-cleaned
 * thong_tin_chung.loai_tien (AI-first, code-fallback) onto every record.
 */
import { syncRecordCurrencyFromHeader } from '@/lib/pipelines/workflows/payroll-verify';
import { createEmptyThongTinChung, createEmptyRecord } from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';
import type { PayrollJSON } from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';

function payrollWith(loaiTien: string | null, vpbankLoaiTien: (string | null)[], nonVpbankLoaiTien: (string | null)[] = []): PayrollJSON {
  return {
    thong_tin_chung: { ...createEmptyThongTinChung(), loai_tien: loaiTien },
    danh_sach_trong_vpbank: vpbankLoaiTien.map((lt, i) => ({
      ...createEmptyRecord(i + 1, 'NGUYEN VAN A', '123456789', 1000000, 'vpbank'),
      loai_tien: lt,
    })),
    danh_sach_ngoai_vpbank: nonVpbankLoaiTien.map((lt, i) => ({
      ...createEmptyRecord(i + 1, 'TRAN THI B', '987654321', 2000000, 'ngan_hang_khac'),
      loai_tien: lt,
    })),
  };
}

describe('syncRecordCurrencyFromHeader', () => {
  it('overwrites every record loai_tien with the clean thong_tin_chung value', () => {
    const data = payrollWith('VNĐ', [null, null], [null]);
    syncRecordCurrencyFromHeader(data);

    for (const r of data.danh_sach_trong_vpbank) {
      expect(r.loai_tien).toBe('VNĐ');
    }
    for (const r of data.danh_sach_ngoai_vpbank) {
      expect(r.loai_tien).toBe('VNĐ');
    }
  });

  it('replaces a corrupted per-row value (old detectLoaiTien bug) with the clean header value', () => {
    // Simulates the reported bug: record.loai_tien got polluted with the
    // amount-in-words text because "Loại tiền" and "Tổng số tiền bằng chữ"
    // shared the same Excel row.
    const corrupted = 'VNĐ Ba mươi lăm tỷ, một trăm lẻ chín triệu, năm trăm hai mươi bốn ngàn, không trăm hai mươi ba đồng';
    const data = payrollWith('VNĐ', [corrupted]);

    syncRecordCurrencyFromHeader(data);

    expect(data.danh_sach_trong_vpbank[0].loai_tien).toBe('VNĐ');
    expect(data.danh_sach_trong_vpbank[0].loai_tien).not.toContain('tỷ');
  });

  it('propagates null when thong_tin_chung.loai_tien is null (document states no currency)', () => {
    const data = payrollWith(null, ['VND', 'USD']);
    syncRecordCurrencyFromHeader(data);

    for (const r of data.danh_sach_trong_vpbank) {
      expect(r.loai_tien).toBeNull();
    }
  });

  it('is a no-op on empty lists', () => {
    const data = payrollWith('VND', []);
    expect(() => syncRecordCurrencyFromHeader(data)).not.toThrow();
    expect(data.danh_sach_trong_vpbank).toEqual([]);
    expect(data.danh_sach_ngoai_vpbank).toEqual([]);
  });

  it('applies uniformly across both vpbank and non-vpbank lists even with mixed prior values', () => {
    const data = payrollWith('VNĐ', ['VND', null, 'usd'], ['garbage value']);
    syncRecordCurrencyFromHeader(data);

    expect(data.danh_sach_trong_vpbank.every((r) => r.loai_tien === 'VNĐ')).toBe(true);
    expect(data.danh_sach_ngoai_vpbank.every((r) => r.loai_tien === 'VNĐ')).toBe(true);
  });
});
