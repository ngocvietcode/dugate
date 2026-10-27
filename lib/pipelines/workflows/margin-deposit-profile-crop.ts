// PDF crop utility for the Margin Deposit Profile workflow.
// Splits a source PDF into one storage object per classified document item.

import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { PDFDocument } from 'pdf-lib';
import { getStorageBackend } from '@/lib/storage';
import { DEFAULT_RENDER_SCALE, renderPageImages } from './financial-report/pdf-utils';
import type { ClassifyPageResult } from './prompts/margin-deposit-profile-prompts';

export interface ClassifiedDocumentForCrop extends ClassifyPageResult {
  document_id: string;
}

export interface CroppedFile {
  document_id: string;
  file_id: string;
  doc_code: string;
  page_range: string;
  /** Bounded, validated 1-based source page numbers in sub-PDF order. */
  original_page_numbers: number[];
  path: string;
  name: string;
  mime: string;
  size: number;
}

/** High-resolution page image used only by Presence detection. */
export interface PresenceAsset {
  original_page_number: number;
  path: string;
  name: string;
  mime: 'image/png';
  size: number;
}

export interface CropBatchResult {
  files: Map<string, CroppedFile>;
  errors: Map<string, string>;
  /** Per-document PNG pages, kept separate from the PDF used by Extract. */
  presenceAssets: Map<string, PresenceAsset[]>;
}

export interface CropOptions {
  renderPresenceImages?: boolean;
  /** 3.0 = 216 DPI, chosen to preserve small signatures/stamps. */
  presenceRenderScale?: number;
}

function safeSegment(value: string): string {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'document';
}

/** Parse a 1-based range such as "1-5", "6", or "1,3-5" to 0-based indices. */
export function parsePageRange(pageRange: string, totalPages: number): number[] {
  if (!pageRange || !Number.isSafeInteger(totalPages) || totalPages <= 0 || pageRange.length > 1_000) return [];
  const parts = pageRange.split(',');
  if (parts.length > 100) return [];

  const indices: number[] = [];
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const rawStart = Number(rangeMatch[1]);
      const rawEnd = Number(rangeMatch[2]);
      if (!Number.isSafeInteger(rawStart) || !Number.isSafeInteger(rawEnd) || rawEnd < rawStart) continue;
      const start = Math.max(1, rawStart);
      const end = Math.min(totalPages, rawEnd);
      for (let page = start; page <= end; page += 1) indices.push(page - 1);
      continue;
    }
    if (!/^\d+$/.test(part)) continue;
    const page = Number(part);
    if (Number.isSafeInteger(page) && page >= 1 && page <= totalPages) indices.push(page - 1);
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}

export async function extractPagesFromPdf(pdfBuffer: Buffer, pageIndices: number[]): Promise<Buffer> {
  if (pageIndices.length === 0) {
    throw new Error('PDF_CROP_FAILED: No valid page indices to extract.');
  }
  const source = await PDFDocument.load(pdfBuffer);
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, pageIndices);
  pages.forEach((page) => output.addPage(page));
  return Buffer.from(await output.save());
}

function mapPdfReadError(fileName: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/encrypt|password/i.test(message)) {
    return new Error(`FILE_PASSWORD_PROTECTED: File "${fileName}" requires a password or uses unsupported encryption.`);
  }
  return new Error(`FILE_UNREADABLE: Cannot read PDF "${fileName}": ${message}`);
}

async function renderAndUploadPresenceAssets(
  backend: Awaited<ReturnType<typeof getStorageBackend>>,
  operationId: string,
  fileId: string,
  documentId: string,
  sourceFileName: string,
  pdfBuffer: Buffer,
  pageNumbers: readonly number[],
  renderScale: number,
): Promise<PresenceAsset[]> {
  if (pageNumbers.length === 0) return [];

  const sortedPages = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const rendered = await renderPageImages(
    pdfBuffer,
    sortedPages[0],
    sortedPages[sortedPages.length - 1],
    sourceFileName,
    renderScale,
  );
  const renderedByPage = new Map(rendered.map((item) => [item.page, item.buffer]));
  const uploadedKeys: string[] = [];
  const assets: PresenceAsset[] = [];
  const stem = `${safeSegment(fileId)}_${safeSegment(documentId)}`;

  try {
    for (const pageNumber of sortedPages) {
      const buffer = renderedByPage.get(pageNumber);
      if (!buffer) throw new Error(`Rendered page ${pageNumber} is missing.`);
      const name = `${stem}_p${String(pageNumber).padStart(3, '0')}.png`;
      const storageKey = `${safeSegment(operationId)}/margin-deposit-presence/${name}`;
      await backend.upload(storageKey, Readable.from(buffer), { contentType: 'image/png' });
      uploadedKeys.push(storageKey);
      assets.push({
        original_page_number: pageNumber,
        path: storageKey,
        name,
        mime: 'image/png',
        size: buffer.length,
      });
    }
    return assets;
  } catch (error) {
    if (uploadedKeys.length > 0) await backend.deleteMany(uploadedKeys).catch(() => undefined);
    throw error;
  }
}

export async function cropFileByClassification(
  operationId: string,
  fileData: { name: string; path: string; mime?: string; file_id?: string },
  classifiedDocs: ClassifiedDocumentForCrop[],
  options: CropOptions = {},
): Promise<CropBatchResult> {
  const backend = await getStorageBackend();
  const files = new Map<string, CroppedFile>();
  const errors = new Map<string, string>();
  const presenceAssets = new Map<string, PresenceAsset[]>();
  const fileId = fileData.file_id || fileData.name;
  const extension = path.extname(fileData.name).toLowerCase();

  if (extension !== '.pdf' && fileData.mime !== 'application/pdf') {
    const message = `FILE_REQUESTED_MISMATCH: File "${fileData.name}" is not a PDF.`;
    classifiedDocs.forEach((doc) => errors.set(doc.document_id, message));
    return { files, errors, presenceAssets };
  }

  let pdfBuffer: Buffer;
  let totalPages: number;
  const tempDir = path.join(os.tmpdir(), 'dugate', safeSegment(operationId), 'margin-deposit');
  let localPath: string | undefined;
  try {
    localPath = await backend.downloadToTempFile(fileData.path, tempDir);
    pdfBuffer = await fsPromises.readFile(localPath);
    const source = await PDFDocument.load(pdfBuffer);
    totalPages = source.getPageCount();
    if (totalPages <= 0) throw new Error('PDF has no pages.');
  } catch (error) {
    const mapped = mapPdfReadError(fileData.name, error);
    classifiedDocs.forEach((doc) => errors.set(doc.document_id, mapped.message));
    return { files, errors, presenceAssets };
  } finally {
    // S3 writes a copy inside tempDir; LocalStorage returns the original upload
    // path. Delete only files proven to be inside our operation-owned temp dir.
    if (localPath) {
      const resolvedTempDir = path.resolve(tempDir);
      const resolvedLocalPath = path.resolve(localPath);
      if (resolvedLocalPath.startsWith(`${resolvedTempDir}${path.sep}`)) {
        await fsPromises.unlink(resolvedLocalPath).catch(() => undefined);
      }
    }
  }

  for (const doc of classifiedDocs) {
    const pageIndices = parsePageRange(doc.page_range, totalPages);
    if (pageIndices.length === 0) {
      errors.set(doc.document_id, `FILE_REQUESTED_MISMATCH: Invalid page_range "${doc.page_range}" for ${totalPages}-page PDF.`);
      continue;
    }

    const croppedName = `${safeSegment(fileId)}_${safeSegment(doc.document_id)}.pdf`;
    const storageKey = `${safeSegment(operationId)}/margin-deposit-crop/${croppedName}`;
    try {
      const croppedBuffer = await extractPagesFromPdf(pdfBuffer, pageIndices);
      await backend.upload(storageKey, Readable.from(croppedBuffer), { contentType: 'application/pdf' });

      let documentPresenceAssets: PresenceAsset[] = [];
      if (options.renderPresenceImages) {
        try {
          documentPresenceAssets = await renderAndUploadPresenceAssets(
            backend,
            operationId,
            fileId,
            doc.document_id,
            fileData.name,
            pdfBuffer,
            pageIndices.map((index) => index + 1),
            options.presenceRenderScale ?? Math.max(DEFAULT_RENDER_SCALE, 3),
          );
        } catch {
          // Presence images are an accuracy enhancement. Keep the PDF fallback
          // available if this optional render/upload path is unsupported.
          documentPresenceAssets = [];
        }
      }

      files.set(doc.document_id, {
        document_id: doc.document_id,
        file_id: fileId,
        doc_code: doc.code,
        page_range: doc.page_range,
        original_page_numbers: pageIndices.map((index) => index + 1),
        path: storageKey,
        name: croppedName,
        mime: 'application/pdf',
        size: croppedBuffer.length,
      });
      if (documentPresenceAssets.length > 0) {
        presenceAssets.set(doc.document_id, documentPresenceAssets);
      }
    } catch (error) {
      await backend.delete(storageKey).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      errors.set(doc.document_id, `FILE_UNREADABLE: Failed to crop "${fileData.name}" pages ${doc.page_range}: ${message}`);
    }
  }
  return { files, errors, presenceAssets };
}

export async function cropAllFiles(
  operationId: string,
  filesData: Array<{ name: string; path: string; mime: string; size: number; file_id?: string }>,
  classifiedDocs: ClassifiedDocumentForCrop[],
  options: CropOptions = {},
): Promise<CropBatchResult> {
  const result: CropBatchResult = { files: new Map(), errors: new Map(), presenceAssets: new Map() };
  const docsByFile = new Map<string, ClassifiedDocumentForCrop[]>();
  for (const doc of classifiedDocs) {
    const group = docsByFile.get(doc.file_id) ?? [];
    group.push(doc);
    docsByFile.set(doc.file_id, group);
  }

  for (const [fileId, docs] of docsByFile) {
    const fileData = filesData.find((file) => (file.file_id || file.name) === fileId);
    if (!fileData) {
      docs.forEach((doc) => result.errors.set(doc.document_id, `FILE_REQUESTED_MISMATCH: Source file "${fileId}" was not found.`));
      continue;
    }
    const fileResult = await cropFileByClassification(operationId, fileData, docs, options);
    fileResult.files.forEach((file, id) => result.files.set(id, file));
    fileResult.presenceAssets.forEach((assets, id) => result.presenceAssets.set(id, assets));
    fileResult.errors.forEach((error, id) => result.errors.set(id, error));
  }
  return result;
}

export async function cleanupCroppedFiles(
  croppedMap: Map<string, CroppedFile>,
  presenceAssets: Map<string, PresenceAsset[]> = new Map(),
): Promise<void> {
  const paths = [
    ...[...croppedMap.values()].map((file) => file.path),
    ...[...presenceAssets.values()].flat().map((asset) => asset.path),
  ];
  if (paths.length === 0) return;
  try {
    const backend = await getStorageBackend();
    await backend.deleteMany([...new Set(paths)]);
  } catch {
    // Best effort. Storage TTL remains the final safety net.
  }
}
