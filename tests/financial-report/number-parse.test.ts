// tests/financial-report/number-parse.test.ts
// Unit test bắt buộc theo PLAN/TASK-1-WORKFLOW.md §14 + §22 (T3).
// Pure function → rẻ và giá trị cao. Không unit-test phần gọi AI.

import {
  normalizeCurrency,
  normalizeDate,
  parseFinancialNumber,
  resolveUnit,
  toAsciiDigits,
  toCellValue,
} from '@/lib/pipelines/workflows/financial-report/number-parse';

describe('parseFinancialNumber — bảng rule §14', () => {
  it('bỏ dấu phân cách nghìn', () => {
    expect(parseFinancialNumber('5,288')).toBe(5288);
    expect(parseFinancialNumber('124,732')).toBe(124732);
  });

  it('ký hiệu âm kiểu Nhật △ và ▲ → số âm thật', () => {
    expect(parseFinancialNumber('△37')).toBe(-37);
    expect(parseFinancialNumber('▲37')).toBe(-37);
    expect(parseFinancialNumber('△1,250')).toBe(-1250);
    expect(parseFinancialNumber('△8')).toBe(-8);
  });

  it('dấu ngoặc kế toán → số âm', () => {
    expect(parseFinancialNumber('(1,250)')).toBe(-1250);
    expect(parseFinancialNumber('(37)')).toBe(-37);
  });

  it('dấu trừ ASCII → số âm', () => {
    expect(parseFinancialNumber('-1,250')).toBe(-1250);
  });

  it('giữ phần thập phân', () => {
    expect(parseFinancialNumber('1,234.56')).toBe(1234.56);
    expect(parseFinancialNumber('△1,234.56')).toBe(-1234.56);
  });

  it('phân cách nghìn kiểu EU (nhiều dấu chấm) không bị hiểu là thập phân', () => {
    expect(parseFinancialNumber('163.540.767')).toBe(163540767);
  });

  it('gạch ngang / N/A / rỗng KHÔNG được thành 0', () => {
    expect(parseFinancialNumber('-')).toBeNull();
    expect(parseFinancialNumber('—')).toBeNull();
    expect(parseFinancialNumber('ー')).toBeNull();
    expect(parseFinancialNumber('N/A')).toBeNull();
    expect(parseFinancialNumber('n/a')).toBeNull();
    expect(parseFinancialNumber('')).toBeNull();
    expect(parseFinancialNumber('   ')).toBeNull();
    expect(parseFinancialNumber(null)).toBeNull();
    expect(parseFinancialNumber(undefined)).toBeNull();
  });

  it('số 0 in trên tài liệu vẫn là 0 (khác với ô trống)', () => {
    expect(parseFinancialNumber('0')).toBe(0);
  });

  it('chữ số full-width được chuẩn hóa sang ASCII', () => {
    expect(parseFinancialNumber('１２３')).toBe(123);
    expect(parseFinancialNumber('△１，２５０')).toBe(-1250);
  });

  it('bỏ ký hiệu tiền tệ và ký tự nhiễu', () => {
    expect(parseFinancialNumber('¥5,288')).toBe(5288);
    expect(parseFinancialNumber('5,288 百万円')).toBe(5288);
  });

  it('chuỗi không có chữ số → null', () => {
    expect(parseFinancialNumber('該当なし')).toBeNull();
    expect(parseFinancialNumber('abc')).toBeNull();
  });

  it('nhận number đầu vào', () => {
    expect(parseFinancialNumber(-37)).toBe(-37);
    expect(parseFinancialNumber(Number.NaN)).toBeNull();
  });
});

describe('toCellValue — raw giữ nguyên như in trên PDF', () => {
  it('giữ nguyên raw kể cả △ và dấu phẩy', () => {
    expect(toCellValue('△37')).toEqual({ raw: '△37', normalized: -37 });
    expect(toCellValue('5,288')).toEqual({ raw: '5,288', normalized: 5288 });
    expect(toCellValue('(1,250)')).toEqual({ raw: '(1,250)', normalized: -1250 });
  });

  it('ô trống trả null để caller BỎ KEY (không đặt 0)', () => {
    expect(toCellValue('')).toBeNull();
    expect(toCellValue('   ')).toBeNull();
    expect(toCellValue(null)).toBeNull();
    expect(toCellValue(undefined)).toBeNull();
  });

  it('gạch ngang vẫn có raw nhưng normalized null', () => {
    expect(toCellValue('-')).toEqual({ raw: '-', normalized: null });
  });
});

describe('toAsciiDigits', () => {
  it('chuẩn hóa chữ số, dấu phẩy, dấu chấm, dấu trừ full-width', () => {
    expect(toAsciiDigits('１２３')).toBe('123');
    expect(toAsciiDigits('１，２３４．５')).toBe('1,234.5');
    expect(toAsciiDigits('－５')).toBe('-5');
  });
});

describe('resolveUnit — bảng §15', () => {
  it('nhận diện đơn vị tiếng Nhật', () => {
    expect(resolveUnit('百万円', 'vi')).toEqual({ source: '百万円', translated: 'Triệu yên', multiplier: 1_000_000 });
    expect(resolveUnit('千円', 'vi').multiplier).toBe(1_000);
    expect(resolveUnit('十億円', 'vi').multiplier).toBe(1_000_000_000);
    expect(resolveUnit('円', 'vi').multiplier).toBe(1);
  });

  it('nhận diện đơn vị tiếng Anh và dịch theo targetLang', () => {
    expect(resolveUnit('Million Yen', 'en')).toEqual({ source: 'Million Yen', translated: 'Million yen', multiplier: 1_000_000 });
    expect(resolveUnit('Thousand yen', 'vi').translated).toBe('Nghìn yên');
  });

  it('không xác định được đơn vị → multiplier null, giữ chữ nguồn', () => {
    expect(resolveUnit('unknown unit', 'vi')).toEqual({ source: 'unknown unit', translated: null, multiplier: null });
    expect(resolveUnit(null, 'vi')).toEqual({ source: null, translated: null, multiplier: null });
  });
});

describe('normalizeCurrency', () => {
  it('nhận mã ISO và suy ra JPY từ 円/Yen', () => {
    expect(normalizeCurrency('JPY')).toBe('JPY');
    expect(normalizeCurrency('jpy')).toBe('JPY');
    expect(normalizeCurrency('百万円')).toBe('JPY');
    expect(normalizeCurrency('Japanese Yen')).toBe('JPY');
    expect(normalizeCurrency(null)).toBeNull();
  });
});

describe('normalizeDate', () => {
  it('chuẩn hóa các dạng ngày về ISO', () => {
    expect(normalizeDate('2025-03-31')).toBe('2025-03-31');
    expect(normalizeDate('2025/3/31')).toBe('2025-03-31');
    expect(normalizeDate('2025年3月31日')).toBe('2025-03-31');
    expect(normalizeDate('31/03/2025')).toBe('2025-03-31');
  });

  it('không nhận diện được thì giữ nguyên chuỗi gốc', () => {
    expect(normalizeDate('FY2024')).toBe('FY2024');
    expect(normalizeDate(null)).toBeNull();
  });
});
