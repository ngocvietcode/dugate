// Nhận dạng định dạng theo nội dung và `file_id` (T-S1-01; S1-R01, S1-R02).
// Hàm không nhận tên file: đuôi file sai mà nội dung hợp lệ vẫn được xử lý.
import { createHash } from 'crypto';

export type SupportedMime = 'application/pdf' | 'image/jpeg' | 'image/png';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * Định dạng theo magic bytes. PDF cho phép tối đa 1024 byte rác trước `%PDF-` (như các trình đọc PDF).
 * Không thuộc 3 định dạng hỗ trợ → null.
 */
export function sniffMime(buf: Uint8Array): SupportedMime | null {
  if (startsWith(buf, PNG_MAGIC)) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  const head = Buffer.from(buf.subarray(0, Math.min(buf.length, 1024 + 5))).toString('latin1');
  if (head.includes('%PDF-')) return 'application/pdf';
  return null;
}

/** `file-` + 12 ký tự hex đầu của SHA-256 nội dung. Cùng nội dung → cùng `file_id`. */
export function computeFileId(buf: Uint8Array): string {
  return `file-${createHash('sha256').update(buf).digest('hex').slice(0, 12)}`;
}
