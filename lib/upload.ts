// lib/upload.ts
// File upload validation, filename normalization, and shared constants.

import path from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

// ─── Extension groups (composable per-endpoint in registry) ───────────────────
// Grouped so each endpoint can declare exactly what it accepts. The global
// default below deliberately uses ONLY the AI-native formats (PDF + images) that
// every connector mode (multipart AND AIHub) can actually read.

/** PDF — readable by all connectors and the rendering engines. */
export const PDF_EXTENSIONS = ['.pdf'] as const;

/** Images — limited to the formats Gemini 2.5 (and other vision LLMs) can actually read.
 *  Gemini 2.5 supported image MIME types: image/png, image/jpeg, image/webp, image/heic, image/heif.
 *  TIFF/BMP/GIF are intentionally excluded — Gemini cannot decode them. */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'] as const;

/** Word — only parseable locally via the internal WordParser (multipart mode).
 *  NOT readable by AIHub connectors, so this is opt-in per-endpoint, never a global default. */
export const WORD_EXTENSIONS = ['.docx'] as const;

/** Spreadsheets — only parseable locally via the internal ExcelParser (multipart mode). */
export const SHEET_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

/**
 * Global fallback allow-list used ONLY when neither a profile-level override nor an
 * endpoint-level `allowedExtensions` (registry) is configured.
 *
 * IMPORTANT: This is intentionally limited to PDF + images — the formats that EVERY
 * connector mode can read. DOCX/XLSX are NOT defaults because AIHub (and other
 * vision/LLM connectors) cannot read Office binaries; they must be enabled explicitly
 * per-endpoint (registry `allowedExtensions`) or per-profile.
 */
export const DEFAULT_ALLOWED_EXTENSIONS = [
  ...PDF_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
] as const;

export const MIME_MAP: Record<string, string> = {
  // Documents
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  // Chỉ endpoint khai `.json` trong ENDPOINT_ALLOWED_EXTENSIONS mới nhận (loan-appraisal: case_input.json).
  '.json': 'application/json',
  // Images — only formats Gemini 2.5 vision can decode
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

export type CompressLevel = 'screen' | 'ebook' | 'printer' | 'prepress';
export type FileType = 'docx' | 'pdf' | 'other';

// ─── Validation ───────────────────────────────────────────────────────────────

export type ValidateResult =
  | { valid: true; fileType: FileType; extension: string }
  | { valid: false; error: string };

const IMAGE_EXT_SET = new Set<string>(IMAGE_EXTENSIONS);

/**
 * Decide whether a provided MIME is acceptable for a given extension.
 * - Empty MIME → accepted (many clients omit it).
 * - Image extensions → accept ANY `image/*` (tolerates aliases like image/pjpeg).
 * - Other extensions → must match the expected MIME from MIME_MAP (if known).
 */
function isMimeAcceptable(ext: string, mime: string): boolean {
  if (mime === '') return true;
  if (IMAGE_EXT_SET.has(ext)) {
    return mime.startsWith('image/');
  }
  const expectedMime = MIME_MAP[ext];
  if (!expectedMime) return true; // unknown-but-allowed extension: don't gate on MIME
  return mime === expectedMime;
}

export function validateFile(file: File, allowedExtsStr?: string): ValidateResult {
  const rawName = file.name.normalize('NFC');
  const ext = path.extname(rawName).toLowerCase();

  // E06: Reject .docm (macro-enabled Word)
  if (ext === '.docm') {
    return {
      valid: false,
      error: 'File .docm (có macro) không được hỗ trợ. Vui lòng lưu lại dạng .docx thuần.',
    };
  }

  // Check extension
  const allowed = allowedExtsStr 
    ? allowedExtsStr.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    : [...DEFAULT_ALLOWED_EXTENSIONS];

  if (!allowed.includes(ext)) {
    return {
      valid: false,
      error: `Chỉ hỗ trợ file ${allowed.join(', ')}. File bạn upload có định dạng "${ext || 'không xác định'}".`,
    };
  }

  // Check MIME type — empty allowed; images accept any image/*; others must match.
  if (!isMimeAcceptable(ext, file.type)) {
    return {
      valid: false,
      error: `MIME type không hợp lệ. Mong đợi "${MIME_MAP[ext] ?? `${ext} hợp lệ`}", nhận được "${file.type || '(empty)'}".`,
    };
  }

  // Check size
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    const maxSizeMB = (MAX_FILE_SIZE / 1024 / 1024).toFixed(1);
    return {
      valid: false,
      error: `File quá lớn (${sizeMB}MB). Giới hạn tối đa là ${maxSizeMB}MB.`,
    };
  }

  const fileType: FileType = ext === '.docx' ? 'docx' : ext === '.pdf' ? 'pdf' : 'other';

  return { valid: true, fileType, extension: ext };
}

/**
 * Validate a file by its metadata (name, mime, size) — for downloaded files where
 * we don't have a File object. Applies the same rules as validateFile().
 */
export function validateFileMetadata(filename: string, mime: string, size: number, allowedExtsStr?: string): ValidateResult {
  const rawName = filename.normalize('NFC');
  const ext = path.extname(rawName).toLowerCase();

  if (ext === '.docm') {
    return { valid: false, error: 'File .docm (có macro) không được hỗ trợ. Vui lòng lưu lại dạng .docx thuần.' };
  }

  const allowed = allowedExtsStr 
    ? allowedExtsStr.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    : [...DEFAULT_ALLOWED_EXTENSIONS];

  if (!allowed.includes(ext)) {
    return { valid: false, error: `Chỉ hỗ trợ file ${allowed.join(', ')}. File có định dạng "${ext || 'không xác định'}".` };
  }

  const expectedMime = MIME_MAP[ext];
  if (mime !== 'application/octet-stream' && !isMimeAcceptable(ext, mime)) {
    return { valid: false, error: `MIME type không hợp lệ. Mong đợi "${expectedMime ?? `${ext} hợp lệ`}", nhận được "${mime || '(empty)'}".` };
  }

  if (size > MAX_FILE_SIZE) {
    const sizeMB = (size / 1024 / 1024).toFixed(1);
    const maxSizeMB = (MAX_FILE_SIZE / 1024 / 1024).toFixed(1);
    return { valid: false, error: `File quá lớn (${sizeMB}MB). Giới hạn tối đa là ${maxSizeMB}MB.` };
  }

  const fileType: FileType = ext === '.docx' ? 'docx' : ext === '.pdf' ? 'pdf' : 'other';
  return { valid: true, fileType, extension: ext };
}

// ─── Filename normalization ───────────────────────────────────────────────────

// E07: Normalize NFD → NFC cho tên file tiếng Việt
export function normalizeFilename(name: string): string {
  return name.normalize('NFC');
}

// ─── Legacy types (kept for backward compatibility) ──────────────────────────

export interface SaveResult {
  conversionId: string;
  originalPath: string;
  outputDir: string;
  normalizedName: string;
}

// NOTE: File saving is handled by lib/upload-helper.ts (streaming, operation-scoped).
// The legacy saveUploadedFile() was removed — use upload-helper.ts instead.

// ─── CompressLevel validation ─────────────────────────────────────────────────

const VALID_COMPRESS_LEVELS: CompressLevel[] = ['screen', 'ebook', 'printer', 'prepress'];

export function parseCompressLevel(value: FormDataEntryValue | null): CompressLevel {
  if (typeof value === 'string' && VALID_COMPRESS_LEVELS.includes(value as CompressLevel)) {
    return value as CompressLevel;
  }
  return 'ebook'; // default
}
