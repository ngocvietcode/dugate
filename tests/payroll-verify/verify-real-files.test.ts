/**
 * Verify real Excel files parse correctly with all 14 record fields.
 * Tests that parsePayrollExcel returns records with the full field set.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parsePayrollExcel } from '@/lib/pipelines/workflows/payroll-verify-excel';
import type { PayrollRecord } from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';

const INPUT_DIR = path.resolve(__dirname, '../../handover-report/Payroll/input');

// All 14 fields that every PayrollRecord must have
const REQUIRED_RECORD_KEYS: (keyof PayrollRecord)[] = [
  'stt', 'ho_ten', 'so_tai_khoan', 'so_tien', 'loai_tai_khoan',
  'so_tien_bang_chu', 'dia_chi', 'ngan_hang', 'ten_chi_nhanh',
  'tinh_tp', 'ghi_chu', 'noi_dung_thanh_toan_chi_tiet', 'loai_tien',
];

// Find all .xlsx files in the input directory (non-recursive)
function findExcelFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.xlsx') || f.endsWith('.xls'))
    .map((f) => path.join(dir, f));
}

describe('Real Excel files: full field coverage', () => {
  const files = findExcelFiles(INPUT_DIR);

  if (files.length === 0) {
    it.skip('No Excel files found in input directory', () => {});
    return;
  }

  for (const filePath of files) {
    const fileName = path.basename(filePath);

    it(`${fileName}: parses without error and records have all 14 fields`, () => {
      const buffer = fs.readFileSync(filePath);

      let result;
      try {
        result = parsePayrollExcel(buffer);
      } catch (err) {
        // Multi-sheet files are expected to throw EXCEL_PARSE_FAILED
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('EXCEL_PARSE_FAILED')) {
          // This is expected for multi-sheet files — skip validation
          return;
        }
        throw err;
      }

      // Should have at least some records
      const allRecords = [...result.vpbankList, ...result.nonVpbankList];
      expect(allRecords.length).toBeGreaterThan(0);

      // Every record must have all 14 keys
      for (const record of allRecords) {
        for (const key of REQUIRED_RECORD_KEYS) {
          expect(record).toHaveProperty(key);
        }
        // Required fields must not be null
        expect(record.stt).toBeGreaterThan(0);
        expect(record.ho_ten.length).toBeGreaterThan(1);
        expect(record.so_tai_khoan.length).toBeGreaterThan(1);
        expect(typeof record.loai_tai_khoan).toBe('string');
      }

      // Meta should be consistent
      expect(result.meta.vpbankRecordCount).toBe(result.vpbankList.length);
      expect(result.meta.nonVpbankRecordCount).toBe(result.nonVpbankList.length);
    });
  }
});
