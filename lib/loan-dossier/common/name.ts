// So khớp tên người (T-COM-01; S3-R07, S3-R08). Hàm thuần.
import { distance } from 'fastest-levenshtein';

export type NameLevel = 'EXACT' | 'REORDERED' | 'SPELLING_DIFFERENCE' | 'NO_MATCH';

/** Danh xưng bị bỏ khi đứng ĐẦU tên (S3-R07). Chỉ bỏ ở đầu vì "ANH", "BÀ" có thể là một phần tên thật. */
const TITLES = new Set(['ÔNG', 'BÀ', 'ANH', 'CHỊ', 'MR', 'MRS', 'MS']);

/** `N(s)`: NFC, HOA, ký tự không phải chữ/khoảng trắng → khoảng trắng, gộp khoảng trắng, bỏ danh xưng đầu. */
export function normalizeName(input: string | null | undefined): string {
  if (input === null || input === undefined) return '';
  const words = String(input)
    .normalize('NFC')
    .toLocaleUpperCase('vi-VN')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && TITLES.has(words[0])) words.shift();
  return words.join(' ');
}

/** Bỏ dấu tiếng Việt, kể cả Đ → D. */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/Đ/g, 'D').replace(/đ/g, 'd').normalize('NFC');
}

const sortedWords = (s: string) => s.split(' ').sort().join(' ');

export function nameLevel(a: string | null | undefined, b: string | null | undefined): NameLevel {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 'NO_MATCH';
  if (na === nb) return 'EXACT';
  if (sortedWords(na) === sortedWords(nb)) return 'REORDERED';
  if (stripDiacritics(na) === stripDiacritics(nb)) return 'SPELLING_DIFFERENCE';
  if (na.split(' ').length === nb.split(' ').length && distance(na, nb) <= 2) return 'SPELLING_DIFFERENCE';
  return 'NO_MATCH';
}

/** Chỉ `EXACT` và `REORDERED` được coi là cùng người (S3-R07). */
export function isNameMatch(level: NameLevel): boolean {
  return level === 'EXACT' || level === 'REORDERED';
}
