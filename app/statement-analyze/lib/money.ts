// app/statement-analyze/lib/money.ts
// Parse/format tiền tệ VN — client-safe, thuần. Logic parse ĐỒNG BỘ với engine calc
// (statement-analyze-calc.ts): dấu '.' đứng một mình + nhóm cuối 3 chữ số = ngăn nghìn.

const CURRENCY_TOKENS = /(vnđ|vnd|đồng|dong|đ|usd|\$)/gi;

/** Parse chuỗi số tiền như in trên sao kê → number, hoặc null nếu không hợp lệ. */
export function parseVndAmount(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;

  let s = String(input).trim();
  if (s === '') return null;
  s = s.replace(/\u2212/g, '-').replace(CURRENCY_TOKENS, '').replace(/\s+/g, '');
  if (s === '') return null;

  let sign = 1;
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); }
  else if (s.startsWith('+')) { s = s.slice(1); }

  if (!/\d/.test(s)) return null;
  if (!/^[0-9.,]+$/.test(s)) return null;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let normalized: string;

  if (hasDot && hasComma) {
    const decimalSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    const parts = s.split(decimalSep);
    const decimalPart = parts.pop() ?? '';
    const intPart = parts.join('').split(thousandsSep).join('');
    normalized = decimalPart ? `${intPart}.${decimalPart}` : intPart;
  } else if (hasDot || hasComma) {
    const sep: '.' | ',' = hasDot ? '.' : ',';
    const groups = s.split(sep);
    const lastGroup = groups[groups.length - 1];
    const lastIsDecimal = lastGroup.length !== 3;
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
  return Number.isFinite(value) ? sign * value : null;
}

/** Format số theo chuẩn VN (dấu '.' ngăn nghìn), tối đa 2 chữ số thập phân. */
export function formatVnd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

/** Parse ngày dd/mm/yyyy → { epochDay, dayKey 'yyyy-mm-dd' }, hoặc null. */
export function parseDMY(raw: string | null | undefined): { epochDay: number; dayKey: string; month: number; year: number } | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const epochDay = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { epochDay, dayKey, month, year };
}
