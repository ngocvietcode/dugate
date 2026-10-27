import type { CrossCheckFieldResult } from '@/app/loan-appraisal/types';

const RESULT_LABEL: Record<string, string> = {
  MATCH: 'Khớp',
  MISMATCH: 'Lệch',
  INSUFFICIENT: 'Chưa đủ dữ liệu',
};

/** RFC 4180: mọi ô đặt trong dấu nháy kép, nháy kép bên trong được nhân đôi, xuống dòng CRLF. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  return rows.map((row) => row.map(escape).join(',')).join('\r\n');
}

/** Thêm BOM UTF-8 để Excel mở đúng tiếng Việt. */
export function withBom(csv: string): string {
  return `\uFEFF${csv}`;
}

export function crossCheckRows(fields: ReadonlyArray<CrossCheckFieldResult>): string[][] {
  const header = ['Nhóm hồ sơ', 'Field', 'Đối tượng', 'Chứng từ A', 'Giá trị A', 'Chứng từ B', 'Giá trị B', 'Kết quả'];
  const rows = fields.map((field) => {
    const [a, b] = Array.isArray(field.sides) ? field.sides : [];
    return [
      field.group,
      field.field_label,
      field.subject_label ?? '',
      (a?.documents ?? []).join(' / '),
      a?.value ?? '',
      (b?.documents ?? []).join(' / '),
      b?.value ?? '',
      RESULT_LABEL[field.result] ?? field.result,
    ].map(String);
  });
  return [header, ...rows];
}

export function crossCheckCsv(fields: ReadonlyArray<CrossCheckFieldResult>): string {
  return withBom(toCsv(crossCheckRows(fields)));
}
