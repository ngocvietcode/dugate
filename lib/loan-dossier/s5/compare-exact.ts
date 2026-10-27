// So khớp EXACT (T-S5-03; S5-R07). Text: trim, HOA, gộp khoảng trắng, bỏ dấu chấm thừa (giữ dấu tiếng Việt).
// Mã/số: so từng ký tự trên giá trị lõi (biển số bỏ hậu tố trong ngoặc).
import { distance } from 'fastest-levenshtein';

import { normIdNumber, normKey } from '../common/normalize';
import { stripDiacritics } from '../common/name';
import { plateKey } from '../s3/asset-key';

export type ExactKind = 'text' | 'code' | 'id' | 'plate';

/** Loại so khớp theo nhóm/sub_field của ma trận. */
export function exactKindOf(fieldGroup: string, subField: string | null): ExactKind {
  const key = subField ?? fieldGroup;
  if (key === 'id_number') return 'id';
  if (key === 'license_plate') return 'plate';
  if (['full_name', 'date_of_birth'].includes(key)) return 'text';
  return 'code';
}

export function normalizeExact(value: unknown, kind: ExactKind): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  switch (kind) {
    case 'id': return normIdNumber(s);
    case 'plate': return plateKey(s);
    case 'code': return normKey(s);
    default: {
      const t = s.normalize('NFC').toLocaleUpperCase('vi-VN').replace(/\s+/g, ' ').replace(/\.+$/g, '').replace(/\s*\.\s*/g, '.').trim();
      return t || null;
    }
  }
}

export function compareExact(values: readonly unknown[], kind: ExactKind): { allEqual: boolean; normalized: Array<string | null> } {
  const normalized = values.map((v) => normalizeExact(v, kind));
  const distinct = new Set(normalized.filter((v) => v !== null));
  return { allEqual: distinct.size <= 1, normalized };
}

const hasDiacritics = (s: string) => stripDiacritics(s) !== s;

/** Độ dài tối thiểu của mã/số để coi lệch 1 ký tự là nghi lỗi đọc (mã ngắn lệch 1 ký tự là khác hẳn). */
export const NEAR_MATCH_MIN_LENGTH = 6;

export interface NearMatch {
  /** Giá trị chuẩn hóa mà các nguồn đa số ghi. */
  majority: string;
  /** Vị trí (trong mảng đầu vào) của nguồn lệch duy nhất. */
  outlier: number;
  agreeing: number;
}

/**
 * S5-R07 "Gần khớp" (D-41): đúng 2 giá trị khác nhau; ≥ 2 nguồn ghi giá trị đa số, đúng 1 nguồn ghi giá trị còn lại;
 * hai giá trị lệch đúng 1 ký tự (thiếu / thừa / sai 1 ký tự) và đều dài ≥ 6. Chỉ dùng cho mã/số, không cho tên/địa chỉ/tiền.
 */
export function nearMatch(normalized: ReadonlyArray<string | null>, evidenceIds?: ReadonlyArray<string>): NearMatch | null {
  const counts = new Map<string, number[]>();
  normalized.forEach((n, i) => { if (n !== null) counts.set(n, [...(counts.get(n) ?? []), i]); });
  if (counts.size !== 2) return null;
  const [[a, ia], [b, ib]] = [...counts.entries()];
  const [major, majorIdx, minor, minorIdx] = ia.length >= ib.length ? [a, ia, b, ib] : [b, ib, a, ia];
  // Đa số phải đến từ ≥ 2 chứng từ khác nhau (2 trường của cùng 1 chứng từ không tính là 2 nguồn).
  const distinctMajor = evidenceIds ? new Set(majorIdx.map((i) => evidenceIds[i])).size : majorIdx.length;
  if (minorIdx.length !== 1 || distinctMajor < 2) return null;
  if (major.length < NEAR_MATCH_MIN_LENGTH || minor.length < NEAR_MATCH_MIN_LENGTH) return null;
  if (distance(major, minor) !== 1) return null;
  return { majority: major, outlier: minorIdx[0], agreeing: distinctMajor };
}

/**
 * S5-R07 (D-38): tên khác nhau CHỈ vì có chứng từ ghi không dấu (CIC, hệ thống không hỗ trợ tiếng Việt).
 * Đúng khi mọi giá trị trùng nhau sau khi bỏ dấu VÀ các giá trị có dấu chỉ có 1 cách viết. Hai cách viết
 * có dấu khác nhau ("TRẦN" / "TRÂN") vẫn là lệch: đó là sai chính tả thật trên chứng từ, CO phải xem.
 */
export function unaccentedOnly(normalized: ReadonlyArray<string | null>): boolean {
  const present = normalized.filter((n): n is string => n !== null);
  if (new Set(present).size <= 1) return false;
  if (new Set(present.map(stripDiacritics)).size !== 1) return false;
  return new Set(present.filter(hasDiacritics)).size <= 1;
}
