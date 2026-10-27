// T-S1-01 — nhận dạng định dạng và file_id (S1-R01, S1-R02).
import { computeFileId, sniffMime } from '@/lib/loan-dossier/s1/file-id';

const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]); // zip

describe('sniffMime', () => {
  it('nhận PDF, JPEG, PNG theo nội dung', () => {
    expect(sniffMime(pdf)).toBe('application/pdf');
    expect(sniffMime(jpeg)).toBe('image/jpeg');
    expect(sniffMime(png)).toBe('image/png');
  });

  it('.docx (zip) → null', () => {
    expect(sniffMime(docx)).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });

  it('không nhận tên file: PDF đặt tên .jpg vẫn là PDF (hàm chỉ có 1 tham số)', () => {
    expect(sniffMime.length).toBe(1);
    expect(sniffMime(pdf)).toBe('application/pdf');
  });

  it('PDF có byte rác trước %PDF- vẫn nhận', () => {
    expect(sniffMime(Buffer.concat([Buffer.from('\r\n\r\n'), pdf]))).toBe('application/pdf');
  });
});

describe('computeFileId', () => {
  it('cùng buffer → cùng id; khác 1 byte → khác', () => {
    const copy = Buffer.from(pdf);
    expect(computeFileId(copy)).toBe(computeFileId(pdf));
    const changed = Buffer.from(pdf);
    changed[changed.length - 1] ^= 1;
    expect(computeFileId(changed)).not.toBe(computeFileId(pdf));
  });

  it('dạng file-{12 hex}', () => {
    for (const b of [pdf, jpeg, png, docx]) expect(computeFileId(b)).toMatch(/^file-[0-9a-f]{12}$/);
  });
});
