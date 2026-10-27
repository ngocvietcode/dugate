/**
 * Regression test for the loai_tien mismatch bug reported against payroll-verify.
 *
 * Root cause: the Excel code-parser used to derive record.loai_tien with
 * detectLoaiTien(), which joined every cell in a row into a single string and
 * sliced everything after the "Loại tiền" label to the end of the row. When a
 * template places "Loại tiền: VNĐ" and "Tổng số tiền bằng chữ: ..." on the same
 * physical row, that slice swallowed the amount-in-words text too, producing
 * corrupted values such as:
 *   "VNĐ Ba mươi lăm tỷ, một trăm lẻ chín triệu, năm trăm hai mươi bốn ngàn,
 *    không trăm hai mươi ba đồng"
 * while thong_tin_chung.loai_tien (AI-extracted) stayed correct ("VNĐ").
 *
 * Fix: parsePayrollExcel no longer derives loai_tien per record (always null).
 * The clean value is applied uniformly from thong_tin_chung.loai_tien via
 * syncRecordCurrencyFromHeader (payroll-verify.ts), covered separately in
 * sync-currency.test.ts.
 */
import * as xlsx from 'xlsx';
import { parsePayrollExcel } from '@/lib/pipelines/workflows/payroll-verify-excel';

function buildBufferWithCurrencyOnSameRowAsAmountInWords(): Buffer {
  const rows: unknown[][] = [
    ['Company Info', 'Some Address', '', '', '', '', ''],
    // "Loại tiền" and "Tổng số tiền bằng chữ" on the SAME row — the exact
    // layout that triggered the old detectLoaiTien slicing bug.
    ['Loại tiền: VNĐ', 'Tổng số tiền bằng chữ: Ba mươi lăm tỷ, một trăm lẻ chín triệu, năm trăm hai mươi bốn ngàn, không trăm hai mươi ba đồng', '', '', '', '', ''],
    ['', 'Có tài khoản thanh toán tại VPBank', '', '', '', '', ''],
    ['STT', 'Họ tên', 'Số TK', 'Số tiền', '', 'NH', ''],
    [1, 'TRAN THI THAO', '303607153', 13467808, '', 'VPBANK', ''],
    [2, 'NGUYEN VAN B', '303607154', 20000000, '', 'VPBANK', ''],
    ['', 'Tổng số món chuyển', '', '', '', '', ''],
    ['Footer', 'End of document', '', '', '', '', ''],
  ];

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return Buffer.from(xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

describe('parsePayrollExcel: loai_tien is not derived per-record (regression)', () => {
  it('does not pollute record.loai_tien even when "Loại tiền" and "Tổng số tiền bằng chữ" share a row', () => {
    const buffer = buildBufferWithCurrencyOnSameRowAsAmountInWords();
    const result = parsePayrollExcel(buffer);

    expect(result.vpbankList.length).toBe(2);
    for (const record of result.vpbankList) {
      // The old bug produced a string containing "tỷ", "triệu", "đồng" etc.
      // Record-level loai_tien must now be null — the parser no longer guesses it.
      expect(record.loai_tien).toBeNull();
    }
  });
});

/**
 * Note: parseHeaderFromText's own "Loại tiền" regex (the code-level fallback
 * used only when AI extraction fails/returns empty) has the same same-row
 * slicing weakness. That fallback path is out of scope for this fix — the
 * fix here targets record-level loai_tien, which now always defers to
 * thong_tin_chung.loai_tien (AI-first, code-fallback second) via
 * syncRecordCurrencyFromHeader instead of being derived independently.
 */
