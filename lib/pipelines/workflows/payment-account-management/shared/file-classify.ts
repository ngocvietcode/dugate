// lib/pipelines/workflows/payment-account-management/shared/file-classify.ts
// File-type classification shared across payment-account-management modes.
// Each mode picks the categories it needs — the classifier is generic.

import { getExtension } from './utils';

export interface PamFileData {
  name: string;
  path: string;
  mime: string;
  size: number;
  // Unique per-document key (see open-account/index.ts contract). Optional here
  // because the file-type classifier does not require it; when the caller passes
  // files that already have it, classifyFiles carries it through to the buckets.
  file_id?: string;
}

export interface ClassifiedFiles {
  pdfs: PamFileData[];
  images: PamFileData[];
  excels: PamFileData[];
  others: PamFileData[];
}

const PDF_EXTS = ['.pdf'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const EXCEL_EXTS = ['.xlsx', '.xls', '.csv'];

const PDF_MIMES = ['application/pdf'];
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const EXCEL_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
];

/**
 * Split incoming files into pdfs / images / excels / others by extension + MIME.
 * Pure function — no validation, no throws. Modes decide what combinations they accept.
 */
export function classifyFiles(files: PamFileData[]): ClassifiedFiles {
  const out: ClassifiedFiles = { pdfs: [], images: [], excels: [], others: [] };

  for (const f of files) {
    const ext = getExtension(f.name);
    const mime = (f.mime || '').toLowerCase();

    if (PDF_EXTS.includes(ext) || PDF_MIMES.includes(mime)) {
      out.pdfs.push(f);
    } else if (IMAGE_EXTS.includes(ext) || IMAGE_MIMES.some((m) => mime.startsWith(m))) {
      out.images.push(f);
    } else if (EXCEL_EXTS.includes(ext) || EXCEL_MIMES.includes(mime)) {
      out.excels.push(f);
    } else {
      out.others.push(f);
    }
  }

  return out;
}
