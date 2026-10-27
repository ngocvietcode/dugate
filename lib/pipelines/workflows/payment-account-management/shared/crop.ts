// lib/pipelines/workflows/payment-account-management/shared/crop.ts
// Crop a split segment into its own file so the extractor can read it in isolation
// (feature: enable_document_splitting). A segment is a set of pages inside a parent
// scan; here we build a new PDF containing ONLY those pages and store it under an
// operation-scoped key — the same storage pattern payroll-verify uses for its page
// splits (backend.upload to "<operationId>/...", cleaned up by the caller afterwards).

import { Readable } from 'stream';
import { PDFDocument } from 'pdf-lib';

import { type WorkflowContext } from '@/lib/pipelines/workflow-engine';
import { getStorageBackend } from '@/lib/storage';

import type { PamFileData } from './file-classify';
import { getExtension, readFileBuffer } from './utils';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/**
 * Build an extractable file for ONE segment.
 *
 *   - PDF parent  → a NEW PDF containing only the segment's pages (in order),
 *                   uploaded to "<operationId>/crops/<segFileId>.pdf".
 *   - image parent→ no crop needed (an image is a single page = the whole file);
 *                   the parent's own PamFileData is returned as-is.
 *
 * Returns the cropped file as a PamFileData (path = the new storage key) so it
 * drops straight into extractDocuments, or null on any failure (the caller then
 * records a per-segment error and keeps going — one bad crop never aborts others).
 *
 * @param parent   the parent scan file the segment came from
 * @param pages    1-based page numbers the segment occupies (may be non-contiguous)
 * @param segFileId the segment's generated id (used for the crop's storage key)
 */
export async function cropSegment(
  ctx: WorkflowContext,
  parent: PamFileData & { s3Key?: string },
  pages: number[],
  segFileId: string,
): Promise<PamFileData | null> {
  const { logger } = ctx;
  const ext = getExtension(parent.name);

  // Image parent: the segment IS the whole image — reuse the parent file directly.
  if (IMAGE_EXTS.includes(ext) || (parent.mime || '').toLowerCase().startsWith('image/')) {
    return parent;
  }

  try {
    // The engine resolves a file by `s3Key ?? path`; read the same source.
    const srcKey = parent.s3Key ?? parent.path;
    const srcBuf = await readFileBuffer(srcKey, ctx.operationId);
    const srcDoc = await PDFDocument.load(srcBuf, { ignoreEncryption: true });

    // Copy the segment's pages (convert 1-based → 0-based) into a fresh PDF, in
    // the order given. Out-of-range pages are skipped defensively (validation
    // upstream already bounds them, but a crop must never throw on a stray index).
    const total = srcDoc.getPageCount();
    const zeroBased = pages.map((p) => p - 1).filter((i) => i >= 0 && i < total);
    if (zeroBased.length === 0) {
      logger.error(`[PAM:crop] Segment ${segFileId} has no valid pages within "${parent.name}" (${total} pages).`);
      return null;
    }

    const outDoc = await PDFDocument.create();
    const copied = await outDoc.copyPages(srcDoc, zeroBased);
    copied.forEach((page) => outDoc.addPage(page));
    const outBytes = await outDoc.save();

    // Store under an operation-scoped key (parallel to payroll's "<opId>/pages/").
    const cropKey = `${ctx.operationId}/crops/${segFileId}.pdf`;
    const backend = await getStorageBackend();
    await backend.upload(cropKey, Readable.from(Buffer.from(outBytes)), { contentType: 'application/pdf' });

    return {
      name: `${segFileId}.pdf`,
      path: cropKey,
      mime: 'application/pdf',
      size: outBytes.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[PAM:crop] Failed to crop segment ${segFileId} from "${parent.name}": ${msg}`);
    return null;
  }
}
