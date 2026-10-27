// Port `inspect` bản thật (S1-R01, §4): đếm trang, PDF hỏng.
import { PDFDocument } from 'pdf-lib';

import { inspectFile } from '@/lib/loan-dossier/s1/inspect';

describe('inspectFile', () => {
  it('PDF 3 trang → page_count 3', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) doc.addPage();
    expect(await inspectFile(await doc.save(), 'application/pdf')).toEqual({ ok: true, page_count: 3 });
  });

  it('ảnh luôn 1 trang', async () => {
    expect(await inspectFile(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg')).toEqual({ ok: true, page_count: 1 });
  });

  it('file rỗng → EMPTY_OR_UNREADABLE', async () => {
    expect(await inspectFile(Buffer.alloc(0), 'application/pdf')).toEqual({ ok: false, kind: 'EMPTY_OR_UNREADABLE' });
  });

  it('PDF hỏng → CORRUPTED_FILE hoặc không có trang', async () => {
    const r = await inspectFile(Buffer.from('%PDF-1.7\n garbage garbage'), 'application/pdf');
    expect(r.ok).toBe(false);
  });
});
