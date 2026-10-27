/**
 * Tests for the locale-aware money parser (payroll-money.ts).
 *
 * Data convention:
 *   - DOT = decimal separator:
 *       • a single dot → decimal ("12.500" → 12.5, "5.000" → 5, "133.855" → 133.855).
 *       • two or more dots → thousands grouping ("86.478.000" → 86478000); a last
 *         group that is not 3 digits makes the last dot a decimal
 *         ("1.000.128.500.21" → 1000128500.21).
 *   - COMMA = thousands separator (groups of 3): "690,561" → 690561,
 *       "133,855,000" → 133855000; a comma is a decimal only when the last group
 *       is not 3 digits ("5,00" → 5, "5,5" → 5.5).
 *   - Both "." and "," present → the rightmost one is the decimal
 *       ("1.234.567,89" → 1234567.89, "690,561.50" → 690561.5).
 */
import * as fc from 'fast-check';
import { parseMoney, parseMoneyValue, moneyEquals } from '@/lib/pipelines/workflows/payroll-money';

describe('parseMoney — table cases (vn locale)', () => {
  const cases: Array<[unknown, number | null]> = [
    // Multiple dots → thousands grouping
    ['133.855.000', 133855000],
    ['1.234.567', 1234567],
    ['86.478.000', 86478000],
    // Single dot → DECIMAL (per data convention)
    ['133.855', 133.855],
    ['5.000', 5],
    ['12.500', 12.5],
    ['7000.123', 7000.123],
    ['25369005.6', 25369005.6],
    ['700.123', 700.123],
    ['12345.67', 12345.67],
    ['70000.5', 70000.5],
    // Both "." and "," present → rightmost (comma) is decimal
    ['133.855.000,00', 133855000],
    ['1.234.567,89', 1234567.89],
    ['5.000,50', 5000.5],
    ['1.000.000,21', 1000000.21],
    // Comma = thousands separator (groups of 3)
    ['690,561', 690561],
    ['1,234', 1234],
    // Comma is a decimal only when the last group is not 3 digits
    ['5,00', 5],
    ['1,5', 1.5],
    // Multiple dots but malformed last group (not 3 digits) → last dot is decimal
    ['1.000.128.500.21', 1000128500.21],
    // US-style input (both separators present) still resolves via rightmost rule
    ['1,234,567.89', 1234567.89],
    ['133,855,000', 133855000],
    // Plain integers / numbers (numeric cells are exact, unaffected)
    ['50000', 50000],
    [50000, 50000],
    [133855000, 133855000],
    [7000.123, 7000.123],
    [0, 0],
    // Currency tokens (multi-dot → thousands)
    ['133.855.000 VND', 133855000],
    ['133.855.000đ', 133855000],
    // Junk / empty
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
    ['abc', null],
    ['N/A', null],
  ];

  it.each(cases)('parseMoneyValue(%p) === %p', (input, expected) => {
    expect(parseMoneyValue(input, 'vn')).toBe(expected);
  });
});

describe('parseMoney — dot is a decimal separator', () => {
  it('a single dot → decimal regardless of trailing group length', () => {
    expect(parseMoneyValue('5.000', 'vn')).toBe(5);
    expect(parseMoneyValue('12.500', 'vn')).toBe(12.5);
    expect(parseMoneyValue('133.855', 'vn')).toBe(133.855);
    expect(parseMoneyValue('7000.123', 'vn')).toBe(7000.123);
  });
  it('two or more dots → thousands grouping', () => {
    expect(parseMoneyValue('1.234.567', 'vn')).toBe(1234567);
    expect(parseMoneyValue('86.478.000', 'vn')).toBe(86478000);
  });
});

describe('parseMoney — comma is a thousands separator (groups of 3)', () => {
  it('single comma with 3-digit group → thousands (not decimal)', () => {
    expect(parseMoneyValue('690,561', 'vn')).toBe(690561);
    expect(parseMoneyValue('1,234', 'vn')).toBe(1234);
  });
  it('multiple commas → thousands', () => {
    expect(parseMoneyValue('133,855,000', 'vn')).toBe(133855000);
  });
  it('comma is a decimal only when last group is not 3 digits', () => {
    expect(parseMoneyValue('5,00', 'vn')).toBe(5);
    expect(parseMoneyValue('5,5', 'vn')).toBe(5.5);
  });
});

describe('parseMoney — hadDecimal flag', () => {
  it('flags fractional values', () => {
    expect(parseMoney('1.234.567,89', 'vn')?.hadDecimal).toBe(true);
    expect(parseMoney('133.855.000', 'vn')?.hadDecimal).toBe(false);
    expect(parseMoney('5.000', 'vn')?.hadDecimal).toBe(true); // single dot → decimal
    expect(parseMoney(5000.5)?.hadDecimal).toBe(true);
    expect(parseMoney(5000)?.hadDecimal).toBe(false);
  });
});

describe('moneyEquals', () => {
  it('matches equal values across formats', () => {
    expect(moneyEquals(133855000, '133.855.000,00')).toBe(true);
    expect(moneyEquals(7000.123, '7000.123')).toBe(true);
    expect(moneyEquals(133.855, '133.855')).toBe(true);
    expect(moneyEquals(1234567, '1.234.567')).toBe(true);
  });
  it('rejects real differences (beyond the 0.5 default tolerance)', () => {
    expect(moneyEquals(133855000, '133.855.001')).toBe(false);
    expect(moneyEquals(7000.123, '7001.123')).toBe(false);
  });
  it('returns false when a side is unparseable', () => {
    expect(moneyEquals('abc', 5000)).toBe(false);
    expect(moneyEquals(null, 5000)).toBe(false);
  });
});

describe('parseMoney — properties', () => {
  it('multi-group thousands (>= 1,000,000) round-trips to the integer', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_000_000, max: 999_999_999_999 }), (n) => {
        const raw = String(n);
        const grouped = raw.replace(/\B(?=(\d{3})+(?!\d))/g, '#');
        const vn = grouped.replace(/#/g, '.');   // >= 2 dots → thousands
        const us = grouped.replace(/#/g, ',');   // >= 2 commas → thousands
        expect(parseMoneyValue(vn, 'vn')).toBe(n);
        expect(parseMoneyValue(us, 'vn')).toBe(n);
      }),
    );
  });

  it('raw digit strings (no separator) never return NaN and round-trip', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999_999_999 }), (n) => {
        const v = parseMoneyValue(String(n), 'vn');
        expect(v).not.toBeNaN();
        expect(v).toBe(n);
      }),
    );
  });
});
