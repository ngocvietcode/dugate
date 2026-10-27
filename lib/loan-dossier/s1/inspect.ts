// Bản thật của port `inspect` (S1-R01, §4): đếm trang, phát hiện PDF đặt mật khẩu / hỏng.
// PDF chỉ có owner-password (mở được không cần mật khẩu) vẫn xử lý được — như financial-report/pdf-utils.ts.
import { PDFDocument } from 'pdf-lib';

import type { SupportedMime } from './file-id';
import type { InspectResult } from './run';

function looksEncrypted(buf: Uint8Array): boolean {
  return /\/Encrypt[\s/<]/.test(Buffer.from(buf).toString('latin1'));
}

async function inspectEncrypted(buf: Uint8Array): Promise<InspectResult> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const info = await parser.getInfo();
      const total = Number(info?.total ?? 0);
      return total > 0 ? { ok: true, page_count: total } : { ok: false, kind: 'EMPTY_OR_UNREADABLE' };
    } finally {
      await parser.destroy?.();
    }
  } catch (err) {
    const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
    return { ok: false, kind: /password/i.test(text) ? 'PASSWORD_PROTECTED' : 'CORRUPTED_FILE' };
  }
}

export async function inspectFile(content: Uint8Array, mime: SupportedMime): Promise<InspectResult> {
  if (content.length === 0) return { ok: false, kind: 'EMPTY_OR_UNREADABLE' };
  if (mime !== 'application/pdf') return { ok: true, page_count: 1 };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encrypt|password/i.test(msg) || looksEncrypted(content)) return inspectEncrypted(content);
    return { ok: false, kind: 'CORRUPTED_FILE' };
  }
  if (doc.isEncrypted) return inspectEncrypted(content);
  let pages: number;
  try {
    // pdf-lib parse lỏng: cấu trúc hỏng có thể chỉ lộ ra khi đọc cây trang.
    pages = doc.getPageCount();
  } catch {
    return { ok: false, kind: 'CORRUPTED_FILE' };
  }
  return pages > 0 ? { ok: true, page_count: pages } : { ok: false, kind: 'EMPTY_OR_UNREADABLE' };
}
