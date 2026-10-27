// T-S2-03 — chuẩn hóa giá trị.
import { normDate, normIdNumber, normKey, normMoney, normName } from '@/lib/loan-dossier/common/normalize';

describe('normDate', () => {
  it.each([
    ['5/3/2026', '2026-03-05'],
    ['05/03/2026', '2026-03-05'],
    ['05-03-2026', '2026-03-05'],
    ['26/01/2026 14:20:00', '2026-01-26'],
    ['26 tháng 11 năm 2023', '2023-11-26'],
    ['Ngày 26 tháng 11 năm 2023', '2023-11-26'],
    ['2026-10-14', '2026-10-14'],
    ['03/2026', '2026-03'],
    ['2026', '2026'],
  ])('%s → %s', (input, expected) => expect(normDate(input)).toBe(expected));

  it.each(['31/02/2026', '2026-02-30', '13/2026', 'abc', '', '   '])('%s → null', (input) => expect(normDate(input)).toBeNull());
  it('null/undefined → null', () => {
    expect(normDate(null)).toBeNull();
    expect(normDate(undefined)).toBeNull();
  });
});

describe('normMoney', () => {
  it.each(['120.000.000 đ', '120,000,000', '120 000 000 VNĐ', '120000000', '120.000.000đ'])('%s → 120000000', (s) =>
    expect(normMoney(s)).toBe(120000000));
  it('2 489 000 000', () => expect(normMoney('2 489 000 000')).toBe(2489000000));
  it.each(['abc', '-5.000', '1,5', '12.34.567', ''])('%s → null', (s) => expect(normMoney(s)).toBeNull());
  it('số: nguyên không âm giữ nguyên, thập phân → null', () => {
    expect(normMoney(500)).toBe(500);
    expect(normMoney(1.5)).toBeNull();
    expect(normMoney(-1)).toBeNull();
  });
});

describe('normIdNumber', () => {
  it('giữ số 0 đầu', () => expect(normIdNumber('012345678901')).toBe('012345678901'));
  it('bỏ ký tự không phải số', () => expect(normIdNumber('0123 456 789')).toBe('0123456789'));
  it('không có chữ số → null', () => expect(normIdNumber('abc')).toBeNull());
});

describe('normName', () => {
  it('HOA, gộp khoảng trắng, giữ dấu', () => expect(normName('nguyễn  văn a')).toBe('NGUYỄN VĂN A'));
  it('NFC: chuỗi tổ hợp và dựng sẵn cho cùng kết quả', () =>
    expect(normName('nguye\u0302\u0303n')).toBe(normName('nguyễn')));
  it('rỗng → null', () => expect(normName('  ')).toBeNull());
});

describe('normKey', () => {
  it('biển số', () => expect(normKey('88C-276.60 (T)')).toBe('88C27660(T)'));
  it('số GCN', () => expect(normKey('bq 747 032')).toBe('BQ747032'));
  it('rỗng → null', () => expect(normKey(' - ')).toBeNull());
});
