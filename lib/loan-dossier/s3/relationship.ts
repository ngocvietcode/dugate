// Loại quan hệ chủ TSBĐ ↔ khách vay (T-S3-10; S3-R20).
import { stripDiacritics } from '../common/name';

export type RelationshipType = 'PARENT_CHILD' | 'SIBLING' | 'SPOUSE' | 'OTHER';

/** Theo thứ tự ưu tiên của bảng S3-R20. `required_count` = số giấy khai sinh cần (null = không xét). */
const TABLE: Array<{ type: RelationshipType; words: string[]; required: number | null }> = [
  { type: 'SPOUSE', words: ['VỢ', 'CHỒNG'], required: null },
  { type: 'PARENT_CHILD', words: ['BỐ', 'CHA', 'MẸ', 'BA', 'MÁ', 'CON'], required: 1 },
  { type: 'SIBLING', words: ['ANH', 'CHỊ', 'EM'], required: 2 },
];

export function requiredCountOf(type: RelationshipType | null): number | null {
  return TABLE.find((r) => r.type === type)?.required ?? null;
}

/**
 * `declaredType` (từ `party_details.relationship_to_borrower`) khác null thắng suy luận. Suy luận theo từ
 * **nguyên vẹn** của raw (NFC, HOA, ký tự không phải chữ → khoảng trắng; KHÔNG bỏ danh xưng như `N()` vì
 * "ANH", "CHỊ" ở đây là quan hệ), so cả dạng bỏ dấu. Rỗng → null, riêng là vợ/chồng theo Customer 360 → SPOUSE.
 */
export function classifyRelationship(
  raw: string | null,
  declaredType: RelationshipType | null,
  isSpouseByCustomer360: boolean,
): { relationship_type: RelationshipType | null; required_count: number | null } {
  const result = (t: RelationshipType | null) => ({ relationship_type: t, required_count: requiredCountOf(t) });
  if (declaredType) return result(declaredType);
  const words = String(raw ?? '').normalize('NFC').toLocaleUpperCase('vi-VN').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return result(isSpouseByCustomer360 ? 'SPOUSE' : null);
  // Từ trong raw khớp từ khóa khi bằng nguyên dạng, hoặc raw viết không dấu và bằng dạng bỏ dấu của từ khóa
  // (để "BÀ" có dấu không bị đọc thành "BA").
  const hit = (keyword: string) => words.some((x) => x === keyword || (x === stripDiacritics(x) && x === stripDiacritics(keyword)));
  for (const row of TABLE) {
    if (row.words.some(hit)) return result(row.type);
  }
  return result('OTHER');
}
