import { crossCheckCsv, toCsv } from '@/app/loan-appraisal-v2/lib/csv';
import { formatBytes, formatCurrencyVnd, formatMetric, formatProbability } from '@/app/loan-appraisal-v2/lib/format';
import { isValidOperationId } from '@/app/loan-appraisal-v2/lib/operation-id';

describe('format', () => {
  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formatMetric by unit and missing data', () => {
    const base = { status: 'CALCULATED' as const, formula: '', warnings: [] };
    expect(formatMetric({ ...base, unit: 'PERCENT', value: 0.7 })).toBe('70%');
    expect(formatMetric({ ...base, unit: 'RATIO', value: 0.7 })).toBe('0,7×');
    expect(formatMetric({ ...base, unit: 'MONTHS', value: 12 })).toBe('12 tháng');
    expect(formatMetric({ ...base, unit: 'VND', value: 1500000 })).toContain('đ');
    expect(formatMetric({ ...base, status: 'INSUFFICIENT_DATA', unit: 'VND', value: null })).toBe('Chưa đủ dữ liệu');
    expect(formatMetric(undefined)).toBe('Chưa đủ dữ liệu');
  });

  it('currency and probability never show fake zero', () => {
    expect(formatCurrencyVnd(null)).toBe('Chưa đủ dữ liệu');
    expect(formatProbability(null)).toBe('Không khả dụng');
    expect(formatProbability(0.05)).toBe('5%');
  });
});

describe('csv', () => {
  it('escapes quotes, commas and uses CRLF', () => {
    expect(toCsv([['a,b', 'say "hi"'], ['x', 'y']])).toBe('"a,b","say ""hi"""\r\n"x","y"');
  });

  it('cross-check CSV starts with BOM and has header + rows', () => {
    const csv = crossCheckCsv([{
      field_id: 'f', field_label: 'Họ tên', group: 'Pháp lý', dimension: 'single', result: 'MISMATCH', evidence_ids: [],
      sides: [{ value: 'A', documents: ['a.pdf'], evidence_ids: [] }, { value: 'B', documents: ['b.pdf'], evidence_ids: [] }],
    }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Lệch"');
  });
});

describe('operation id', () => {
  it('validates format', () => {
    expect(isValidOperationId('abcd1234-ef')).toBe(true);
    expect(isValidOperationId('short')).toBe(false);
    expect(isValidOperationId('../../etc/passwd')).toBe(false);
    expect(isValidOperationId('a'.repeat(65))).toBe(false);
    expect(isValidOperationId(null)).toBe(false);
  });
});
