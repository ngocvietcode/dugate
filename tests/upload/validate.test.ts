import {
  validateFile,
  validateFileMetadata,
  DEFAULT_ALLOWED_EXTENSIONS,
  IMAGE_EXTENSIONS,
  WORD_EXTENSIONS,
} from '../../lib/upload';

// Helper to build a File object with a given name/type/size.
function makeFile(name: string, type: string, sizeBytes = 1024): File {
  // Use a small backing buffer; override size via defineProperty when a large size is needed.
  const file = new File([new Uint8Array(Math.min(sizeBytes, 64))], name, { type });
  if (sizeBytes > 64) {
    Object.defineProperty(file, 'size', { value: sizeBytes });
  }
  return file;
}

describe('upload validation — default allow-list', () => {
  it('default allow-list contains PDF and all image types, but NOT docx', () => {
    expect(DEFAULT_ALLOWED_EXTENSIONS).toContain('.pdf');
    for (const ext of IMAGE_EXTENSIONS) {
      expect(DEFAULT_ALLOWED_EXTENSIONS).toContain(ext);
    }
    // DOCX must NOT be a global default (AIHub/vision connectors can't read it)
    for (const ext of WORD_EXTENSIONS) {
      expect(DEFAULT_ALLOWED_EXTENSIONS).not.toContain(ext);
    }
  });
});

describe('validateFile — images', () => {
  it.each([
    ['scan.jpg', 'image/jpeg'],
    ['scan.jpeg', 'image/jpeg'],
    ['scan.png', 'image/png'],
    ['scan.webp', 'image/webp'],
    ['scan.heic', 'image/heic'],
    ['scan.heif', 'image/heif'],
  ])('accepts %s with MIME %s using default allow-list', (name, mime) => {
    const res = validateFile(makeFile(name, mime));
    expect(res.valid).toBe(true);
  });

  it('accepts an image with empty MIME (client omitted type)', () => {
    expect(validateFile(makeFile('scan.png', '')).valid).toBe(true);
  });

  it('tolerates legacy image MIME aliases (image/pjpeg)', () => {
    expect(validateFile(makeFile('scan.jpg', 'image/pjpeg')).valid).toBe(true);
  });

  it('rejects formats Gemini cannot decode (tiff/bmp/gif) under default allow-list', () => {
    expect(validateFile(makeFile('scan.tiff', 'image/tiff')).valid).toBe(false);
    expect(validateFile(makeFile('scan.bmp', 'image/bmp')).valid).toBe(false);
    expect(validateFile(makeFile('scan.gif', 'image/gif')).valid).toBe(false);
  });

  it('rejects an image whose MIME is clearly not an image', () => {
    const res = validateFile(makeFile('fake.png', 'application/pdf'));
    expect(res.valid).toBe(false);
  });
});

describe('validateFile — documents', () => {
  it('still accepts PDF by default', () => {
    expect(validateFile(makeFile('doc.pdf', 'application/pdf')).valid).toBe(true);
  });

  it('rejects docx under the default allow-list (not a default type)', () => {
    const res = validateFile(makeFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    expect(res.valid).toBe(false);
  });

  it('accepts docx when the endpoint explicitly allows it', () => {
    const res = validateFile(
      makeFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      '.pdf,.docx',
    );
    expect(res.valid).toBe(true);
  });

  it('rejects .docm (macro-enabled) regardless of allow-list', () => {
    const res = validateFile(makeFile('m.docm', ''), '.pdf,.docx,.docm');
    expect(res.valid).toBe(false);
  });
});

describe('validateFileMetadata — URL downloads', () => {
  it('accepts a png by metadata under default allow-list', () => {
    expect(validateFileMetadata('a.png', 'image/png', 2048).valid).toBe(true);
  });

  it('accepts application/octet-stream MIME (generic server response)', () => {
    expect(validateFileMetadata('a.jpg', 'application/octet-stream', 2048).valid).toBe(true);
  });

  it('rejects unknown extension under default allow-list', () => {
    expect(validateFileMetadata('a.exe', 'application/octet-stream', 2048).valid).toBe(false);
  });
});
