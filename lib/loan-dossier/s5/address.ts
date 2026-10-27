// Địa chỉ — so trên bề mặt chứng từ (T-S5-04; S5-R05, R07, R10). Không tra dữ liệu địa giới, không quy đổi
// địa danh cũ/mới, không dùng LLM: chỉ chuẩn hóa hoa/thường, dấu câu, khoảng trắng rồi so văn bản như in.

export interface AddressLike { full_text: string | null; street: string | null; ward: string | null; district: string | null; province: string | null }

export interface AddressVerdict {
  match_status: 'MATCH' | 'MISMATCH';
  reason_code: 'EXACT_MATCH' | 'VALUE_CONFLICT';
  normalized: string[];
}

/** Văn bản địa chỉ như in (`full_text`; thiếu thì ghép các cấp có giá trị), đã chuẩn hóa để so. */
export function addressText(a: AddressLike): string {
  return (a.full_text ?? [a.street, a.ward, a.district, a.province].filter(Boolean).join(', '))
    .normalize('NFC').toLocaleUpperCase('vi-VN').replace(/[.,;]+/g, ',').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '');
}

export function compareAddress(values: readonly AddressLike[]): AddressVerdict {
  const normalized = values.map(addressText);
  const same = new Set(normalized).size <= 1;
  return { match_status: same ? 'MATCH' : 'MISMATCH', reason_code: same ? 'EXACT_MATCH' : 'VALUE_CONFLICT', normalized };
}
