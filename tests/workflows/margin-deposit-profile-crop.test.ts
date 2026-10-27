/**
 * Unit tests for margin-deposit-profile-crop.ts
 * Tests parsePageRange and extractPagesFromPdf (pure functions, no S3 needed).
 */
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { getStorageBackend } from '@/lib/storage';
import {
  parsePageRange,
  extractPagesFromPdf,
  cropFileByClassification,
} from '@/lib/pipelines/workflows/margin-deposit-profile-crop';

jest.mock('@/lib/storage', () => ({ getStorageBackend: jest.fn() }));
const mockedGetStorageBackend = getStorageBackend as jest.MockedFunction<typeof getStorageBackend>;

describe('cropFileByClassification', () => {
  it('persists the bounded original page list used by presence mapping', async () => {
    const sourcePath = path.join(os.tmpdir(), `margin-source-${Date.now()}.pdf`);
    await fsPromises.writeFile(sourcePath, await createTestPdf(5));
    const upload = jest.fn(async (key: string, stream: AsyncIterable<Uint8Array>) => {
      let bytesWritten = 0;
      for await (const chunk of stream) bytesWritten += chunk.length;
      return { bytesWritten, md5: 'test-md5', s3Key: key };
    });
    mockedGetStorageBackend.mockResolvedValue({
      downloadToTempFile: jest.fn(async () => sourcePath),
      upload,
      delete: jest.fn(async () => undefined),
    } as unknown as Awaited<ReturnType<typeof getStorageBackend>>);

    try {
      const result = await cropFileByClassification('op-test', {
        name: 'request.pdf', path: 'source/request.pdf', mime: 'application/pdf', file_id: 'input-001',
      }, [{
        document_id: 'input-001::doc-001', file_id: 'input-001', code: 'cccd', title: 'CCCD',
        confidence: 0.99, reason: 'title', page_range: '1,3-4',
      }]);
      expect(result.files.get('input-001::doc-001')?.original_page_numbers).toEqual([1, 3, 4]);
      await expect(fsPromises.access(sourcePath)).resolves.toBeUndefined();
    } finally {
      await fsPromises.rm(sourcePath, { force: true });
    }
  });

  it('deletes only operation-owned downloaded temp files', async () => {
    let downloadedPath = '';
    mockedGetStorageBackend.mockResolvedValue({
      downloadToTempFile: jest.fn(async (_key: string, tmpDir: string) => {
        await fsPromises.mkdir(tmpDir, { recursive: true });
        downloadedPath = path.join(tmpDir, 'downloaded.pdf');
        await fsPromises.writeFile(downloadedPath, await createTestPdf(2));
        return downloadedPath;
      }),
      upload: jest.fn(async (key: string, stream: AsyncIterable<Uint8Array>) => {
        let bytesWritten = 0;
        for await (const chunk of stream) bytesWritten += chunk.length;
        return { bytesWritten, md5: 'test-md5', s3Key: key };
      }),
      delete: jest.fn(async () => undefined),
    } as unknown as Awaited<ReturnType<typeof getStorageBackend>>);

    await cropFileByClassification('op-temp-cleanup', {
      name: 'request.pdf', path: 'source/request.pdf', mime: 'application/pdf', file_id: 'input-001',
    }, [{
      document_id: 'input-001::doc-001', file_id: 'input-001', code: 'cccd', title: 'CCCD',
      confidence: 0.99, reason: 'title', page_range: '1',
    }]);

    await expect(fsPromises.access(downloadedPath)).rejects.toThrow();
  });

  it('deletes a partial crop object when upload fails', async () => {
    const sourcePath = path.join(os.tmpdir(), `margin-source-fail-${Date.now()}.pdf`);
    await fsPromises.writeFile(sourcePath, await createTestPdf(2));
    const deleteObject = jest.fn(async () => undefined);
    mockedGetStorageBackend.mockResolvedValue({
      downloadToTempFile: jest.fn(async () => sourcePath),
      upload: jest.fn(async () => { throw new Error('upload failed'); }),
      delete: deleteObject,
    } as unknown as Awaited<ReturnType<typeof getStorageBackend>>);

    try {
      const result = await cropFileByClassification('op-upload-fail', {
        name: 'request.pdf', path: 'source/request.pdf', mime: 'application/pdf', file_id: 'input-001',
      }, [{
        document_id: 'input-001::doc-001', file_id: 'input-001', code: 'cccd', title: 'CCCD',
        confidence: 0.99, reason: 'title', page_range: '1',
      }]);
      expect(result.errors.get('input-001::doc-001')).toContain('upload failed');
      expect(deleteObject).toHaveBeenCalledWith(expect.stringContaining('input-001_doc-001.pdf'));
    } finally {
      await fsPromises.rm(sourcePath, { force: true });
    }
  });
});

// ─── Helper: create a multi-page PDF for testing ──────────────────────────────

async function createTestPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([200, 200]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 100, size: 12 });
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function getPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer);
  return doc.getPageCount();
}

// ─── parsePageRange ───────────────────────────────────────────────────────────

describe('parsePageRange', () => {
  it('should parse single page "3" → [2]', () => {
    expect(parsePageRange('3', 10)).toEqual([2]);
  });

  it('should parse range "1-5" → [0,1,2,3,4]', () => {
    expect(parsePageRange('1-5', 10)).toEqual([0, 1, 2, 3, 4]);
  });

  it('should parse comma-separated "1,3,5" → [0,2,4]', () => {
    expect(parsePageRange('1,3,5', 10)).toEqual([0, 2, 4]);
  });

  it('should parse mixed "1-3,7,9-10" → [0,1,2,6,8,9]', () => {
    expect(parsePageRange('1-3,7,9-10', 10)).toEqual([0, 1, 2, 6, 8, 9]);
  });

  it('should clamp pages exceeding totalPages', () => {
    // "8-15" with totalPages=10 → only 8,9,10 → [7,8,9]
    expect(parsePageRange('8-15', 10)).toEqual([7, 8, 9]);
  });

  it('should clamp pages below 1', () => {
    // "0-3" → 0 is invalid, starts from 1 → [0,1,2]
    expect(parsePageRange('0-3', 10)).toEqual([0, 1, 2]);
  });

  it('should return empty for page beyond totalPages', () => {
    expect(parsePageRange('20', 10)).toEqual([]);
  });

  it('should deduplicate overlapping ranges', () => {
    // "1-3,2-4" → [0,1,2,3] (no duplicates)
    expect(parsePageRange('1-3,2-4', 10)).toEqual([0, 1, 2, 3]);
  });

  it('should handle whitespace in parts', () => {
    expect(parsePageRange(' 1 - 3 , 5 ', 10)).toEqual([0, 1, 2, 4]);
  });

  it('should handle single page equal to totalPages', () => {
    expect(parsePageRange('10', 10)).toEqual([9]);
  });

  it('bounds huge model-generated ranges by the real PDF page count', () => {
    expect(parsePageRange('1-999999999999999999999999', 10)).toEqual([]);
    expect(parsePageRange('1-999999999', 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('rejects excessively long or fragmented model-generated ranges', () => {
    expect(parsePageRange('1'.repeat(1001), 10)).toEqual([]);
    expect(parsePageRange(Array.from({ length: 101 }, () => '1').join(','), 10)).toEqual([]);
  });
});

// ─── extractPagesFromPdf ──────────────────────────────────────────────────────

describe('extractPagesFromPdf', () => {
  it('should extract a single page from a 5-page PDF', async () => {
    const pdf = await createTestPdf(5);
    const cropped = await extractPagesFromPdf(pdf, [2]); // page 3
    const count = await getPageCount(cropped);
    expect(count).toBe(1);
  });

  it('should extract pages 1-3 from a 10-page PDF', async () => {
    const pdf = await createTestPdf(10);
    const cropped = await extractPagesFromPdf(pdf, [0, 1, 2]);
    const count = await getPageCount(cropped);
    expect(count).toBe(3);
  });

  it('should extract non-contiguous pages', async () => {
    const pdf = await createTestPdf(8);
    const cropped = await extractPagesFromPdf(pdf, [0, 3, 7]); // pages 1, 4, 8
    const count = await getPageCount(cropped);
    expect(count).toBe(3);
  });

  it('should extract all pages', async () => {
    const pdf = await createTestPdf(4);
    const cropped = await extractPagesFromPdf(pdf, [0, 1, 2, 3]);
    const count = await getPageCount(cropped);
    expect(count).toBe(4);
  });

  it('should throw for empty page indices', async () => {
    const pdf = await createTestPdf(5);
    await expect(extractPagesFromPdf(pdf, [])).rejects.toThrow('PDF_CROP_FAILED');
  });

  it('should produce a valid PDF buffer', async () => {
    const pdf = await createTestPdf(6);
    const cropped = await extractPagesFromPdf(pdf, [1, 2, 3]);
    // Should be loadable as a valid PDF
    const doc = await PDFDocument.load(cropped);
    expect(doc.getPageCount()).toBe(3);
  });

  it('should produce smaller buffer than original for subset', async () => {
    const pdf = await createTestPdf(20);
    const cropped = await extractPagesFromPdf(pdf, [0, 1]);
    expect(cropped.length).toBeLessThan(pdf.length);
  });
});
