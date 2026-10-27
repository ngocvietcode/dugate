/**
 * Compare-engine tests for the 'money_normalized' mode.
 *
 * Verifies that so_tien comparison tolerates Vietnamese formatting / decimal
 * noise (Excel integer vs OCR-formatted string) while still catching real
 * differences — the behavior that fixes the "lost comparison" rounding bug.
 */
import { comparePayrollData } from '@/lib/pipelines/workflows/payroll-verify-compare';
import type {
  CompareConfig,
  PayrollJSON,
  PayrollRecord,
} from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';

function rec(stt: number, soTien: unknown): PayrollRecord {
  return {
    stt,
    ho_ten: 'NGUYEN VAN A',
    so_tai_khoan: '123456789',
    so_tien: soTien as PayrollRecord['so_tien'],
    loai_tai_khoan: 'vpbank',
  } as PayrollRecord;
}

function payroll(records: PayrollRecord[]): PayrollJSON {
  return {
    thong_tin_chung: {} as PayrollJSON['thong_tin_chung'],
    danh_sach_trong_vpbank: records,
    danh_sach_ngoai_vpbank: [],
  };
}

const CONFIG: CompareConfig = {
  header_rules: [],
  detail_rules: [
    {
      section_code: 'trong_vpbank',
      source_a_list_path: 'danh_sach_trong_vpbank',
      source_b_list_path: 'danh_sach_trong_vpbank',
      match_key: 'stt',
      include_unmatched_from_b: true,
      compare_fields: [
        { field_code: 'so_tien', source_a_field: 'so_tien', source_b_field: 'so_tien', compare_mode: 'money_normalized' },
      ],
    },
    {
      section_code: 'ngoai_vpbank',
      source_a_list_path: 'danh_sach_ngoai_vpbank',
      source_b_list_path: 'danh_sach_ngoai_vpbank',
      match_key: 'stt',
      include_unmatched_from_b: true,
      compare_fields: [],
    },
  ],
  options: {
    trim_string: true,
    case_insensitive: true,
    remove_vietnamese_accents: true,
    collapse_whitespace: true,
    number_remove_commas: true,
    treat_null_as_empty: true,
    amount_tolerance: 0,
    amount_locale: 'vn',
  },
};

describe('money_normalized compare mode', () => {
  it('matches Excel integer vs OCR string with decimal noise', () => {
    // Excel stored as integer (post toMoneyVnd), PDF read as formatted string.
    const excel = payroll([rec(1, 133855000)]);
    const pdf = payroll([rec(1, '133.855.000,00')]);
    const r = comparePayrollData(excel, pdf, CONFIG);
    expect(r.compare_status).toBe('pass');
  });

  it('matches multi-dot thousands ("1.234.567") vs 1234567', () => {
    const excel = payroll([rec(1, 1234567)]);
    const pdf = payroll([rec(1, '1.234.567')]);
    const r = comparePayrollData(excel, pdf, CONFIG);
    expect(r.compare_status).toBe('pass');
  });

  it('single dot is a decimal: 5000 (Excel) vs "5.000" (PDF=5) is flagged', () => {
    // Per data convention a single dot is a decimal, so "5.000" = 5, not 5000.
    const excel = payroll([rec(1, 5000)]);
    const pdf = payroll([rec(1, '5.000')]);
    const r = comparePayrollData(excel, pdf, CONFIG);
    expect(r.compare_status).toBe('fail');
  });

  it('flags a real amount difference', () => {
    const excel = payroll([rec(1, 133855000)]);
    const pdf = payroll([rec(1, '133.855.001')]);
    const r = comparePayrollData(excel, pdf, CONFIG);
    expect(r.compare_status).toBe('fail');
  });

  it('flags exact decimal Excel value vs rounded PDF (no rounding at compare)', () => {
    // Excel stores the exact value 25369005.6; PDF shows the rounded 25369006.
    // No rounding at compare → 25369005.6 ≠ 25369006 → MUST be flagged for review.
    const excel = payroll([rec(1, 25369005.6)]);
    const pdf = payroll([rec(1, '25.369.006')]);
    const r = comparePayrollData(excel, pdf, CONFIG);
    expect(r.compare_status).toBe('fail');
    // The report shows the EXACT Excel value (no rounding).
    const row = r.detail_results[0].detail_compare[0];
    const soTienField = row.field_results.find((f) => f.field_code === 'so_tien');
    expect(soTienField?.normalized_excel_value).toBe('25369005.6');
    expect(soTienField?.result).toBe('fail');
  });

  it('passes when exact values are equal across formats', () => {
    // Same exact value, different rendering → equal → pass.
    const excel = payroll([rec(1, 25369005.6)]);
    const pdf = payroll([rec(1, '25.369.005,6')]);
    const r = comparePayrollData(excel, pdf, CONFIG);
    expect(r.compare_status).toBe('pass');
  });
});
