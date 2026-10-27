// Tín hiệu nghi trùng mức loại giữa các file (T-S1-05; S1-R16). Không xóa, không gộp.

export interface RepeatedDocType {
  doc_type_key: string;
  file_ids: string[];
  status: 'DUPLICATE_CANDIDATE';
  requires_review: true;
}

/** Loại xuất hiện ở ≥ 2 file khác nhau. Nhiều instance trong 1 file không tính. Thứ tự theo lần xuất hiện đầu. */
export function repeatedDocTypes(files: ReadonlyArray<{ file_id: string; matches: ReadonlyArray<{ doc_type_key: string }> }>): RepeatedDocType[] {
  const byKey = new Map<string, string[]>();
  for (const f of files) {
    for (const key of new Set(f.matches.map((m) => m.doc_type_key))) {
      const ids = byKey.get(key) ?? [];
      if (!ids.includes(f.file_id)) ids.push(f.file_id);
      byKey.set(key, ids);
    }
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([doc_type_key, file_ids]) => ({ doc_type_key, file_ids, status: 'DUPLICATE_CANDIDATE', requires_review: true }));
}
