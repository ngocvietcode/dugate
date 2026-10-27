import type { ConstituentRequestItem } from '../types';

export const NOT_AVAILABLE_DISPLAY = 'N/A' as const;
export const MISSING_VALUE_DISPLAY = '—' as const;
export const PROCESSING_DISPLAY = 'Đang xử lý' as const;

const FIXED_DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/**
 * Formats an API fixed-decimal string without converting it to a JavaScript
 * number, so large values and all supplied decimal precision remain exact.
 */
export function formatFixedDecimal(value: string | null | undefined): string {
  if (value === null || value === undefined) return MISSING_VALUE_DISPLAY;

  const match = FIXED_DECIMAL_PATTERN.exec(value.trim());
  if (!match) return MISSING_VALUE_DISPLAY;

  const [, sign, rawInteger, rawFraction = ''] = match;
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.replace(/0+$/, '');
  const isZero = /^0+$/.test(integer) && fraction.length === 0;
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${sign === '-' && !isZero ? '-' : ''}${groupedInteger}${fraction ? `.${fraction}` : ''}`;
}

/** Formats the exact fixed-decimal cost returned by the dashboard/detail API. */
export function formatBusinessCostUsd(value: string | null | undefined): string {
  const decimal = formatFixedDecimal(value);
  if (decimal === MISSING_VALUE_DISPLAY) return decimal;
  if (decimal.startsWith('-')) return `-$${decimal.slice(1)}`;
  return `$${decimal}`;
}

export const SLOW_BUSINESS_DURATION_SECONDS = 60;
export const HIGH_BUSINESS_TOKENS = 100_000;

export function isSlowBusinessDuration(seconds: number | null | undefined): boolean {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= SLOW_BUSINESS_DURATION_SECONDS;
}
export function isHighBusinessTokenCount(tokens: number | null | undefined): boolean {
  return typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= HIGH_BUSINESS_TOKENS;
}

/**
 * Compact cost for dense admin views. Values >= $0.01 show 2 decimals; tiny
 * positive values show a couple significant digits. Always pair with the exact
 * value (formatBusinessCostUsd) in a title tooltip. Display-only rounding.
 */
export function formatCompactBusinessCostUsd(value: string | null | undefined): string {
  if (value === null || value === undefined) return MISSING_VALUE_DISPLAY;
  const match = FIXED_DECIMAL_PATTERN.exec(value.trim());
  if (!match) return MISSING_VALUE_DISPLAY;
  const [, sign, rawInteger, rawFraction = ''] = match;
  const asNumber = Number(`${sign === '-' ? '-' : ''}${rawInteger}.${rawFraction || '0'}`);
  if (!Number.isFinite(asNumber)) return formatBusinessCostUsd(value);
  const abs = Math.abs(asNumber);
  let body: string;
  if (abs === 0) {
    body = '0.00';
  } else if (abs >= 0.01) {
    body = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else {
    const significantDecimals = Math.min(10, Math.max(2, -Math.floor(Math.log10(abs)) + 1));
    body = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: significantDecimals });
  }
  return `${asNumber < 0 ? '-$' : '$'}${body}`;
}

/** Rates are already rounded by the API; render their required two decimals. */
export function formatBusinessRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NOT_AVAILABLE_DISPLAY;
  }
  return `${value.toFixed(2)}%`;
}

/** Formats integer token totals, using an em dash only for genuinely missing data. */
export function formatBusinessTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return MISSING_VALUE_DISPLAY;
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Breakdown averages are rounded to one decimal by the API. */
export function formatAverageBusinessTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NOT_AVAILABLE_DISPLAY;
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/**
 * Presents a rounded duration while retaining the API's one-decimal seconds.
 * Null denotes a card with no terminal business operation and therefore N/A.
 */
export function formatBusinessDurationSeconds(
  value: number | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return NOT_AVAILABLE_DISPLAY;
  }

  if (value < 60) return `${(Math.round(value * 10) / 10).toFixed(1)}s`;

  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}p`);
  if (seconds > 0) parts.push(`${seconds}s`);
  if (parts.length === 0) return '0s';
  return parts.join(' ');
}

/** Requirement 7.3: null source fields display an em dash, never a fabricated value. */
export function displayConstituentValue<T>(
  value: T | null | undefined,
  formatter: (presentValue: T) => string = String,
): string {
  return value === null || value === undefined
    ? MISSING_VALUE_DISPLAY
    : formatter(value);
}

/** Requirement 7.4: a request with no completion timestamp is still processing. */
export function formatConstituentCompletedAt(
  completedAt: string | null | undefined,
  formatter: (isoTimestamp: string) => string = String,
): string {
  return completedAt === null || completedAt === undefined
    ? PROCESSING_DISPLAY
    : formatter(completedAt);
}

/** FAILED and CANCELLED constituent requests always expose a labelled error panel. */
export function shouldShowConstituentErrorPanel(
  state: ConstituentRequestItem['state'],
): boolean {
  return state === 'FAILED' || state === 'CANCELLED';
}
