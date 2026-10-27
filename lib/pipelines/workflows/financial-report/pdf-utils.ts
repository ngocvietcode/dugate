// lib/pipelines/workflows/financial-report/pdf-utils.ts
// Step 0 Preflight + tách/gộp trang PDF cho workflow financial-report-translation.
// Bám pattern splitPdf của payroll-verify.ts, nhưng map lỗi về errorCode của SRS (§5).

import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { PDFDocument } from 'pdf-lib';

import { getStorageBackend } from '@/lib/storage';
import { FinancialReportError, type PageSourceMode } from './types';

export interface WorkflowFile {
  name: string;
  path: string;
  mime: string;
  size: number;
}

export type { PageSourceMode };

/** Nguồn trang đã preflight. Callers chỉ cần truyền cả object này cho `prepareChunkAssets`. */
export interface PageSource {
  mode: PageSourceMode;
  totalPages: number;
  /** mode='pdf': buffer từng trang (index 0 = trang 1). mode='image': rỗng. */
  pageBuffers: Buffer[];
  /** mode='image': buffer gốc, dùng để render trang khi cần (render lazily, không dựng sẵn 85 ảnh). */
  originalBuffer: Buffer | null;
  /** PDF có /Encrypt hay không — để ghi vào log và processingInfo. */
  encrypted: boolean;
  /** Hệ số render khi `mode = 'image'`. DPI hiệu dụng = 72 × scale. */
  renderScale: number;
}

export type PreflightResult = PageSource;

/**
 * Hệ số render mặc định khi phải gửi ảnh. DPI hiệu dụng = 72 × scale.
 * Đo trên JFE Annual Report 2023 (A4, 85 trang):
 *   scale 2   = 144 DPI, 1190×1684, ~376 KB/trang
 *   scale 2.5 = 180 DPI, 1487×2105, ~499 KB/trang   ← default
 *   scale 3   = 216 DPI, 1785×2526, ~627 KB/trang
 * Chọn 2.5: 144 DPI thấp hơn ngưỡng OCR thông dụng (200–300 DPI) nên rủi ro với chữ Nhật
 * cỡ nhỏ trong bảng; 216 DPI làm dung lượng upload cả file lên ~53 MB mà chưa có bằng chứng
 * là AI đọc tốt hơn. Tune được qua param Profile `render_scale` (không cần deploy).
 */
export const DEFAULT_RENDER_SCALE = 2.5;

/** Đọc file từ storage backend (local hoặc S3) về Buffer. */
export async function readWorkflowFile(filePath: string, operationId: string): Promise<Buffer> {
  const backend = await getStorageBackend();
  const tmpDir = path.join(os.tmpdir(), 'dugate', operationId);
  const localPath = await backend.downloadToTempFile(filePath, tmpDir);
  return fsPromises.readFile(localPath);
}

/**
 * Step 0 — Preflight: đọc PDF, đếm trang, phát hiện corrupt / password / blank.
 * Map lỗi về errorCode theo SRS:
 *   - PDF cần user password thật → PASSWORD_PROTECTED_FILE
 *   - PDF lỗi cấu trúc           → CORRUPTED_FILE
 *   - 0 trang / không nội dung   → EMPTY_OR_BLANK_PAGES
 *   - /Encrypt + mở được nhưng render lỗi → ENCRYPTED_PDF_UNSUPPORTED
 *
 * VÒNG #05 mục 34 — phân biệt 2 loại PDF mã hoá:
 *
 *   owner-password-only : có /Encrypt nhưng USER PASSWORD RỖNG. Mọi trình đọc mở bình thường,
 *                         chỉ hạn chế quyền in/copy. Rất phổ biến với báo cáo thường niên của
 *                         doanh nghiệp Nhật (3/7 file mẫu: JFE, Marubeni, Sony).
 *                         → PHẢI xử lý được, KHÔNG được trả PASSWORD_PROTECTED_FILE.
 *   user-password       : cần mật khẩu thật để mở → PASSWORD_PROTECTED_FILE (giữ như trước).
 *
 * Vì sao không dùng `PDFDocument.load(buf, { ignoreEncryption: true })`: đã đo trên JFE —
 * pdf-lib KHÔNG chỉ "không giải mã content stream" mà còn THROW ngay ở bước parse cấu trúc
 * (`Expected instance of PDFDict, but got instance of undefined`). Nên với file mã hoá,
 * đường split-bằng-pdf-lib là bất khả thi, phải render trang thành ảnh (xem `renderPageImages`).
 *
 * Lưu ý: phát hiện trang trắng theo NỘI DUNG vẫn không làm ở đây — do bước classify của AI
 * báo về (`blank: true`).
 */
export async function preflightPdf(
  pdfBuffer: Buffer,
  fileName: string,
  renderScale: number = DEFAULT_RENDER_SCALE,
): Promise<PreflightResult> {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new FinancialReportError('EMPTY_OR_BLANK_PAGES', `File "${fileName}" rỗng (0 byte).`);
  }

  let srcDoc: PDFDocument;
  try {
    srcDoc = await PDFDocument.load(pdfBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encrypt|password/i.test(msg) || looksEncrypted(pdfBuffer)) {
      // Có thể là owner-password-only → thử mở bằng pdf-parse trước khi kết luận.
      return preflightEncryptedPdf(pdfBuffer, fileName, renderScale);
    }
    throw new FinancialReportError('CORRUPTED_FILE', `Không đọc được file "${fileName}": ${msg}`);
  }

  if (srcDoc.isEncrypted) {
    return preflightEncryptedPdf(pdfBuffer, fileName, renderScale);
  }

  const totalPages = srcDoc.getPageCount();
  if (totalPages === 0) {
    throw new FinancialReportError('EMPTY_OR_BLANK_PAGES', `File "${fileName}" không có trang nào.`);
  }

  const pageBuffers: Buffer[] = [];
  try {
    for (let i = 0; i < totalPages; i++) {
      const newDoc = await PDFDocument.create();
      const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
      newDoc.addPage(copiedPage);
      pageBuffers.push(Buffer.from(await newDoc.save()));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new FinancialReportError('CORRUPTED_FILE', `Lỗi khi tách trang file "${fileName}": ${msg}`);
  }

  return { mode: 'pdf', pageBuffers, totalPages, originalBuffer: null, encrypted: false, renderScale };
}

/** Có dictionary /Encrypt trong file hay không (kiểm thô trên bytes). */
function looksEncrypted(pdfBuffer: Buffer): boolean {
  return /\/Encrypt[\s/<]/.test(pdfBuffer.toString('latin1'));
}

/**
 * Preflight cho PDF có /Encrypt: mở bằng pdf-parse với mật khẩu RỖNG.
 *   mở được  → mode 'image', render trang khi cần.
 *   đòi mật khẩu → PASSWORD_PROTECTED_FILE.
 */
async function preflightEncryptedPdf(
  pdfBuffer: Buffer,
  fileName: string,
  renderScale: number,
): Promise<PreflightResult> {
  let totalPages = 0;
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
    try {
      const info = await parser.getInfo();
      totalPages = Number(info?.total ?? 0);
    } finally {
      await parser.destroy?.();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : '';
    if (/password/i.test(msg) || /password/i.test(name)) {
      throw new FinancialReportError(
        'PASSWORD_PROTECTED_FILE',
        `File "${fileName}" cần mật khẩu để mở.`,
      );
    }
    throw new FinancialReportError(
      'ENCRYPTED_PDF_UNSUPPORTED',
      `File "${fileName}" được mã hoá theo cách hệ thống chưa đọc được: ${msg}`,
    );
  }

  if (totalPages <= 0) {
    throw new FinancialReportError('EMPTY_OR_BLANK_PAGES', `File "${fileName}" không có trang nào.`);
  }

  return { mode: 'image', pageBuffers: [], totalPages, originalBuffer: pdfBuffer, encrypted: true, renderScale };
}

/**
 * Render một dải trang (1-based, inclusive) của PDF mã hoá thành PNG.
 * Chỉ dùng cho `mode = 'image'`. Render lazily theo chunk, không dựng sẵn toàn bộ trang.
 *
 * Export để script verify chạy được ĐÚNG code path này trên file mẫu thật (không dựng lại
 * lời gọi tương đương — vòng #05 yêu cầu chứng minh chunk sinh ra đọc được, không chỉ
 * "không throw"). Không dùng ở nơi khác; classify/extract đi qua `prepareChunkAssets`.
 */
export async function renderPageImages(
  pdfBuffer: Buffer,
  pageFrom: number,
  pageTo: number,
  fileName: string,
  renderScale: number = DEFAULT_RENDER_SCALE,
): Promise<Array<{ page: number; buffer: Buffer }>> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
  try {
    const shot = await parser.getScreenshot({ first: pageFrom, last: pageTo, scale: renderScale });
    const pages = (shot?.pages ?? []) as Array<{ pageNumber?: number; data?: Uint8Array | Buffer }>;
    const out: Array<{ page: number; buffer: Buffer }> = [];

    pages.forEach((entry, index) => {
      if (!entry?.data) return;
      out.push({ page: entry.pageNumber ?? pageFrom + index, buffer: Buffer.from(entry.data) });
    });

    if (out.length === 0) {
      throw new FinancialReportError(
        'ENCRYPTED_PDF_UNSUPPORTED',
        `Không render được trang ${pageFrom}-${pageTo} của file "${fileName}".`,
      );
    }
    return out;
  } finally {
    await parser.destroy?.();
  }
}

/**
 * Gộp một dải trang (1-based, inclusive) thành 1 PDF buffer.
 * Dùng cho cả classify (cửa sổ trang) và extract (chunk theo report).
 */
export async function buildPageRangePdf(
  pageBuffers: Buffer[],
  pageFrom: number,
  pageTo: number,
): Promise<Buffer> {
  const from = Math.max(1, pageFrom);
  const to = Math.min(pageBuffers.length, pageTo);
  if (from > to) {
    throw new FinancialReportError('UNRECOGNIZED_REPORT_STRUCTURE', `Dải trang không hợp lệ: ${pageFrom}-${pageTo}.`);
  }

  if (from === to) return pageBuffers[from - 1];

  const merged = await PDFDocument.create();
  for (let page = from; page <= to; page++) {
    const srcDoc = await PDFDocument.load(pageBuffers[page - 1]);
    const [copiedPage] = await merged.copyPages(srcDoc, [0]);
    merged.addPage(copiedPage);
  }
  return Buffer.from(await merged.save());
}

/**
 * Upload chunk PDF lên storage và trả filesJson để truyền cho sub-step AI.
 * `keySuffix` phải unique trong 1 operation.
 */
export async function uploadChunkAndBuildFilesJson(
  operationId: string,
  originalFileName: string,
  keySuffix: string,
  buffer: Buffer,
): Promise<{ filesJson: string; storageKey: string }> {
  const backend = await getStorageBackend();
  const storageKey = `${operationId}/financial-report/${keySuffix}.pdf`;
  await backend.upload(storageKey, Readable.from(buffer), { contentType: 'application/pdf' });

  const filesJson = JSON.stringify([
    {
      name: `${stripExtension(originalFileName)}_${keySuffix}.pdf`,
      path: storageKey,
      mime: 'application/pdf',
      size: buffer.length,
    },
  ]);

  return { filesJson, storageKey };
}

/**
 * Dựng dữ liệu 1 chunk (dải trang) rồi upload, trả `filesJson` cho sub-step AI.
 *
 * Là ĐIỂM VÀO DUY NHẤT cho classify/extract — che khác biệt giữa 2 chế độ:
 *   mode='pdf'   → 1 file .pdf gộp các trang trong dải (như trước).
 *   mode='image' → N file .png, mỗi trang 1 ảnh, gửi cùng lúc trong 1 sub-step.
 *
 * Trả `storageKeys` (số nhiều) để orchestrator cleanup đầy đủ.
 */
export async function prepareChunkAssets(
  source: PageSource,
  operationId: string,
  originalFileName: string,
  keySuffix: string,
  pageFrom: number,
  pageTo: number,
): Promise<{ filesJson: string; storageKeys: string[] }> {
  if (source.mode === 'pdf') {
    const buffer = await buildPageRangePdf(source.pageBuffers, pageFrom, pageTo);
    const { filesJson, storageKey } = await uploadChunkAndBuildFilesJson(
      operationId, originalFileName, keySuffix, buffer,
    );
    return { filesJson, storageKeys: [storageKey] };
  }

  if (!source.originalBuffer) {
    throw new FinancialReportError('ENCRYPTED_PDF_UNSUPPORTED', 'Thiếu buffer gốc để render trang.');
  }

  const from = Math.max(1, pageFrom);
  const to = Math.min(source.totalPages, pageTo);
  if (from > to) {
    throw new FinancialReportError('UNRECOGNIZED_REPORT_STRUCTURE', `Dải trang không hợp lệ: ${pageFrom}-${pageTo}.`);
  }

  const rendered = await renderPageImages(
    source.originalBuffer, from, to, originalFileName, source.renderScale,
  );
  const backend = await getStorageBackend();
  const stem = stripExtension(originalFileName);
  const storageKeys: string[] = [];
  const files: Array<{ name: string; path: string; mime: string; size: number }> = [];

  // 1 chunk ảnh = N file PNG. Nếu upload file thứ k thất bại thì k-1 file trước ĐÃ nằm trên
  // storage; hàm này throw nên caller không nhận được `storageKeys` và `cleanupChunks` không
  // bao giờ xoá chúng. Với JFE 85 trang mỗi lần lỗi để lại tới `pages_per_chunk` file ~500 KB
  // tồn vĩnh viễn. Vì vậy phải tự dọn phần đã upload trước khi throw ra ngoài.
  try {
    for (const item of rendered) {
      const storageKey = `${operationId}/financial-report/${keySuffix}-p${item.page}.png`;
      await backend.upload(storageKey, Readable.from(item.buffer), { contentType: 'image/png' });
      storageKeys.push(storageKey);
      files.push({
        name: `${stem}_p${item.page}.png`,
        path: storageKey,
        mime: 'image/png',
        size: item.buffer.length,
      });
    }
  } catch (err) {
    // Dọn best-effort: lỗi khi dọn KHÔNG được che mất lỗi gốc.
    if (storageKeys.length > 0) {
      try {
        await backend.deleteMany(storageKeys);
      } catch {
        // bỏ qua có chủ ý — lỗi gốc quan trọng hơn
      }
    }
    throw err;
  }

  return { filesJson: JSON.stringify(files), storageKeys };
}

/** Xóa các file tạm đã upload (§23 — cleanup sau khi xong). */
export async function cleanupChunks(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;
  const backend = await getStorageBackend();
  await backend.deleteMany(storageKeys);
}

function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

/** Chia một dải trang thành các chunk tối đa `pagesPerChunk` trang. */
export function chunkPageRange(
  pageFrom: number,
  pageTo: number,
  pagesPerChunk: number,
): Array<{ from: number; to: number }> {
  const size = Math.max(1, pagesPerChunk);
  const chunks: Array<{ from: number; to: number }> = [];
  for (let start = pageFrom; start <= pageTo; start += size) {
    chunks.push({ from: start, to: Math.min(pageTo, start + size - 1) });
  }
  return chunks;
}
