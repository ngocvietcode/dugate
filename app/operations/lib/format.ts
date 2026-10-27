// app/operations/lib/format.ts
// Canonical number formatting for Operations cost/token views.

const COST_DATA_DECIMAL_PLACES = 10;
const COST_DISPLAY_DECIMAL_PLACES = 6;
const MIN_VISIBLE_COST_USD = 10 ** -COST_DISPLAY_DECIMAL_PLACES;

/** Expand JavaScript's shortest number string without introducing scientific notation. */
function toPlainNumber(value: number): string {
  const raw = value.toString().toLowerCase();
  if (!raw.includes('e')) return raw;

  const [coefficient, exponentText] = raw.split('e');
  const exponent = Number(exponentText);
  const [integerPart, fractionPart = ''] = coefficient.split('.');
  const digits = `${integerPart}${fractionPart}`;
  const decimalIndex = integerPart.length + exponent;

  if (decimalIndex <= 0) return `0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function formatExactNumber(value: number): string {
  const negative = value < 0;
  const plain = toPlainNumber(Math.abs(value));
  const [integerPart, fractionPart] = plain.split('.');
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fractionPart === undefined ? '' : `.${fractionPart}`}`;
}

/** Remove binary floating-point noise while retaining ten decimal places of cost precision. */
export function normalizeCost(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(COST_DATA_DECIMAL_PLACES));
}

/** Fixed-notation decimal for cost CSV fields; never emits grouping or scientific notation. */
export function formatDecimal(value: number): string {
  const normalized = normalizeCost(value);
  const plain = toPlainNumber(Math.abs(normalized));
  return normalized < 0 ? `-${plain}` : plain;
}

/** Display USD compactly without ever presenting a positive micro-cost as zero. */
export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';

  const normalized = normalizeCost(value);
  const absolute = Math.abs(normalized || value);
  if (absolute < MIN_VISIBLE_COST_USD) {
    return value > 0 ? '<$0.000001' : '>-$0.000001';
  }

  const displayed = absolute.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: COST_DISPLAY_DECIMAL_PLACES,
  });
  return value < 0 ? `-$${displayed}` : `$${displayed}`;
}

/** Token counts are integers by contract; preserve unexpected decimals for diagnosis. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return formatExactNumber(value);
}

/** Format a number without abbreviating or rounding it. */
export function formatInt(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return formatExactNumber(value);
}
