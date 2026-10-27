// lib/pipelines/workflows/payroll-money.ts
// Locale-aware money parser for the Payroll Verify workflow.
//
// PURPOSE
//   Existing helpers (`toIntSafe`, `normalizeNumber`, `normalizeAmount`) each
//   handle amounts differently and are NOT locale-aware:
//     - toIntSafe:      Math.round(parseFloat) → "133.855" wrongly becomes 134
//     - normalizeNumber: strips all "." and "," → "133.855.000,00" inflates 100x
//   This module provides ONE deterministic parser that resolves the decimal vs.
//   thousands separator correctly BEFORE any rounding, so both the Excel side
//   and the (LLM-produced) PDF side normalize to the same numeric value.
//
//   This file adds NEW functions only. It does not modify any existing helper.

export type MoneyLocale = 'vn' | 'us';

export interface ParsedMoney {
  /** Parsed numeric value (decimals preserved, no rounding applied). */
  value: number;
  /** True when the input carried a fractional (decimal) part. */
  hadDecimal: boolean;
}

/** Currency tokens stripped before parsing (lowercased match). */
const CURRENCY_TOKENS = /(vnđ|vnd|đồng|dong|đ|usd|\$)/gi;

/**
 * Parse a VN/US-formatted money value into a numeric value.
 *
 * Decision rules (in order):
 *   1. null/empty/non-numeric junk → null.
 *   2. Real JS number (from xlsx numeric cell) → returned as-is.
 *   3. String: strip whitespace + currency tokens, then resolve separators.
 *      A valid THOUSANDS group is exactly 3 digits, which drives the logic:
 *      - Both "." and "," present → the RIGHTMOST separator is the decimal,
 *        the other is the thousands separator ("1.234.567,89" → 1234567.89).
 *      - Only DOTS present (dot = decimal separator):
 *          • a SINGLE dot → DECIMAL ("12.500" → 12.5, "5.000" → 5, "133.855" →
 *            133.855, "7000.123" → 7000.123).
 *          • TWO OR MORE dots → thousands grouping ("86.478.000" → 86478000).
 *            Exception: if the last group is not exactly 3 digits, the last dot is
 *            a decimal (recovers malformed "1.000.128.500.21" → 1000128500.21).
 *      - Only COMMAS present (comma = thousands separator, groups of 3):
 *          • "690,561" → 690561, "133,855,000" → 133855000.
 *          • a comma is a decimal ONLY when the last group is not 3 digits
 *            ("5,00" → 5, "5,5" → 5.5).
 *
 * NOTE: `locale` is currently unused by the decision (the rules are
 * locale-independent) but kept for API stability.
 *
 * No rounding is performed here; callers decide how to round.
 */
export function parseMoney(input: unknown, locale: MoneyLocale = 'vn'): ParsedMoney | null {
  if (input == null) return null;

  // Real numeric cell value — trust it directly.
  if (typeof input === 'number') {
    if (Number.isNaN(input) || !Number.isFinite(input)) return null;
    return { value: input, hadDecimal: !Number.isInteger(input) };
  }

  let s = String(input).trim();
  if (s === '') return null;

  // Normalize unicode minus and strip currency tokens + whitespace.
  s = s.replace(/\u2212/g, '-').replace(CURRENCY_TOKENS, '').replace(/\s+/g, '');
  if (s === '') return null;

  // Capture sign.
  let sign = 1;
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); }
  else if (s.startsWith('+')) { s = s.slice(1); }

  // Must contain at least one digit; only digits, dots, commas allowed.
  if (!/\d/.test(s)) return null;
  if (!/^[0-9.,]+$/.test(s)) return null;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  let normalized: string;

  if (hasDot && hasComma) {
    // Two different separators present: the RIGHTMOST one is the decimal,
    // the other is the thousands separator (e.g. "1.234.567,89" → 1234567.89).
    const decimalSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    const parts = s.split(decimalSep);
    const decimalPart = parts.pop() ?? '';
    const intPart = parts.join('').split(thousandsSep).join('');
    normalized = decimalPart ? `${intPart}.${decimalPart}` : intPart;
  } else if (hasDot || hasComma) {
    // Only one kind of separator. The dot and the comma play different roles:
    const sep: '.' | ',' = hasDot ? '.' : ',';
    const groups = s.split(sep);
    const count = groups.length - 1;
    const lastGroup = groups[groups.length - 1];

    let lastIsDecimal: boolean;
    if (sep === '.') {
      // DOT = decimal separator in this data:
      //   - a SINGLE dot is always a decimal ("5.000" → 5, "133.855" → 133.855,
      //     "7000.123" → 7000.123).
      //   - MULTIPLE dots are thousands grouping ("86.478.000" → 86478000), unless
      //     the last group isn't 3 digits → last dot is a decimal (recovers
      //     malformed "1.000.128.500.21" → 1000128500.21).
      lastIsDecimal = count === 1 ? true : lastGroup.length !== 3;
    } else {
      // COMMA = thousands separator (groups of 3): "690,561" → 690561,
      // "133,855,000" → 133855000. It is a decimal ONLY when the last group is
      // not exactly 3 digits ("5,00" → 5, "5,5" → 5.5).
      lastIsDecimal = lastGroup.length !== 3;
    }

    if (lastIsDecimal) {
      const decimalPart = groups.pop() as string;
      normalized = `${groups.join('')}.${decimalPart}`;
    } else {
      normalized = groups.join('');
    }
  } else {
    normalized = s;
  }

  const value = Number(normalized);
  if (Number.isNaN(value) || !Number.isFinite(value)) return null;

  return { value: sign * value, hadDecimal: normalized.includes('.') };
}

/**
 * Convenience: parse money and return just the numeric value (or null).
 */
export function parseMoneyValue(input: unknown, locale: MoneyLocale = 'vn'): number | null {
  const parsed = parseMoney(input, locale);
  return parsed ? parsed.value : null;
}

/**
 * Compare two money values numerically within an absolute tolerance.
 * Returns false if either side cannot be parsed to a number.
 *
 * epsilon defaults to 0.5 (whole-VND): tolerates trailing ".00"/",00" noise
 * (e.g. 133855000 vs "133.855.000,00") while still catching real differences.
 */
export function moneyEquals(
  a: unknown,
  b: unknown,
  epsilon = 0.5,
  locale: MoneyLocale = 'vn',
): boolean {
  const av = parseMoneyValue(a, locale);
  const bv = parseMoneyValue(b, locale);
  if (av == null || bv == null) return false;
  return Math.abs(av - bv) <= epsilon;
}
