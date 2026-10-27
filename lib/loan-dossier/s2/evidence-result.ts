// Kết quả kiểm `data` của một bản thể sau khi model trả về (dùng chung cho FULL — T-S2-08 — và LIGHT — T-S2-10).
import type { ZodError } from 'zod';

export interface EvidenceResult {
  status: 'SUCCESS' | 'ERROR';
  reason_code: string | null;
  /** Chỉ nêu đường dẫn field / mã lỗi, không chứa giá trị (data là PII — S2-R19). */
  message: string | null;
  data: Record<string, unknown> | null;
  /** Field sai định dạng đã bị thay bằng null/rỗng hoặc bỏ khi kiểm schema mềm (S2-R21); chỉ đường dẫn. */
  invalid_fields?: string[];
}

/** Cảnh báo SUCCESS (S2-R09, S2-R21): định danh bắt buộc null ưu tiên hơn field sai định dạng; message nêu cả hai. */
export function successResult(data: Record<string, unknown>, identityGaps: string[], invalidFields: string[]): EvidenceResult {
  const parts: string[] = [];
  if (identityGaps.length) parts.push(identityGaps.join(', '));
  if (invalidFields.length) {
    const shown = invalidFields.slice(0, 8).join(', ');
    const more = invalidFields.length > 8 ? ` (+${invalidFields.length - 8})` : '';
    parts.push(`${identityGaps.length ? 'Field sai định dạng (đã bỏ giá trị): ' : ''}${shown}${more}`);
  }
  const reason_code = identityGaps.length ? 'REQUIRED_FIELD_UNREADABLE' : invalidFields.length ? 'FIELD_FORMAT_INVALID' : null;
  return { status: 'SUCCESS', reason_code, message: parts.length ? parts.join('; ') : null, data, invalid_fields: invalidFields };
}

/** Tóm tắt lỗi zod không lộ giá trị: `parties.0.party_role: invalid_enum_value; …` (tối đa 5 lỗi). */
export function describeZodError(err: ZodError): string {
  const parts = err.issues.slice(0, 5).map((i) => `${i.path.length ? i.path.join('.') : '(gốc)'}: ${i.code}`);
  const more = err.issues.length > 5 ? ` (+${err.issues.length - 5} lỗi)` : '';
  return parts.join('; ') + more;
}
