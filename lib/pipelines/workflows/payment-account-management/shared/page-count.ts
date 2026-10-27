// lib/pipelines/workflows/payment-account-management/shared/page-count.ts
// Page-count pre-pass for the document-splitting feature (enable_document_splitting).
//
// Before the split-aware classifier runs, we read each file's real page count so
// the LLM's page assignments can be validated against actual bounds (see
// classifyDocumentSegments). PDFs are read with pdf-lib (already a dependency);
// images count as a single page. Anything unreadable returns null → the caller
// falls back to a single-segment result instead of trusting the LLM's bounds.

import { PDFDocument } from 'pdf-lib';

import type { PamFileData } from './file-classify';
import { getExtension, readFileBuffer } from './utils';

const PDF_EXTS = ['.pdf'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/**
 * Read the page count of ONE document.
 *   - PDF   → real page count via pdf-lib (ignoreEncryption so light-protected
 *             PDFs still report their length).
 *   - image → 1 (a single "page").
 *   - other / unreadable / corrupt → null (caller treats as unknown bounds).
 *
 * NEVER throws: a bad file must not abort the batch. `operationId` is needed to
 * resolve the file through the storage backend (same as the extract/classify engines).
 */
export async function getPageCount(
  doc: PamFileData & { s3Key?: string },
  operationId: string,
): Promise<number | null> {
  const ext = getExtension(doc.name);

  // Images are always a single page.
  if (IMAGE_EXTS.includes(ext) || (doc.mime || '').toLowerCase().startsWith('image/')) {
    return 1;
  }

  // Only PDFs have a meaningful multi-page count we can read here.
  const isPdf = PDF_EXTS.includes(ext) || (doc.mime || '').toLowerCase() === 'application/pdf';
  if (!isPdf) return null;

  try {
    // The engine resolves a file by `s3Key ?? path`; mirror that here.
    const storageKey = doc.s3Key ?? doc.path;
    const buf = await readFileBuffer(storageKey, operationId);
    const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
    const count = pdf.getPageCount();
    return count > 0 ? count : null;
  } catch {
    // Encrypted / corrupt / unreadable → unknown bounds.
    return null;
  }
}
