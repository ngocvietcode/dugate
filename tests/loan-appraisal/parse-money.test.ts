import { parseMoney } from '@/lib/pipelines/workflows/loan-appraisal/evidence';

describe('parseMoney', () => {
  it.each([
    ['1,5 tỷ', 1_500_000_000],
    ['2 tỷ đồng', 2_000_000_000],
    ['2 tỷ 50 triệu', 2_050_000_000],
    ['1,250 tỷ', 1_250_000_000],
    ['500 triệu đồng', 500_000_000],
    ['2 triệu 500 nghìn', 2_500_000],
    ['1.500.000.000', 1_500_000_000],
    ['1.500.000.000 đồng', 1_500_000_000],
    ['1.500.000.000 VNĐ', 1_500_000_000],
    ['1,500,000', 1_500_000],
    ['1.234,56', 1234.56],
    ['500000', 500_000],
    ['500 triệu', 500_000_000],
    ['(1.000.000)', -1_000_000],
    ['-5.000.000', -5_000_000],
    ['1.500.000 ₫', 1_500_000],
  ])('%s -> %s', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['50,000 USD', '100 EUR', '$1,000', 'Một tỷ năm trăm triệu đồng', '', 'abc'])('%s -> null', (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it.each(['1,5 tỷ', '2 tỷ 50 triệu', '2 triệu 500 nghìn', '500 triệu đồng', '1.500.000 VNĐ'])(
    'NFC và NFD cho cùng kết quả: %s',
    (input) => {
      expect(parseMoney(input.normalize('NFD'))).toBe(parseMoney(input.normalize('NFC')));
      expect(parseMoney(input.normalize('NFD'))).not.toBeNull();
    },
  );

  it('giữ nguyên input dạng number / không phải chuỗi', () => {
    expect(parseMoney(1234.5)).toBe(1234.5);
    expect(parseMoney(Number.NaN)).toBeNull();
    expect(parseMoney(Infinity)).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney({})).toBeNull();
  });
});
