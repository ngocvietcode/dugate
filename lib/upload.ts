// lib/upload.ts
// Business logic cho upload: validate, normalize filename, lưu file, tạo output dir
// Dùng bởi app/api/upload/route.ts

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

export const DEFAULT_ALLOWED_EXTENSIONS = ['.docx', '.pdf'] as const;

export const MIME_MAP: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
};

export type CompressLevel = 'screen' | 'ebook' | 'printer' | 'prepress';
export type FileType = 'docx' | 'pdf' | 'other';

// ─── Validation ───────────────────────────────────────────────────────────────

export type ValidateResult =
  | { valid: true; fileType: FileType; extension: string }
  | { valid: false; error: string };

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

  // Check MIME type — empty type allowed (some clients omit it), but if provided it must match
  const expectedMime = MIME_MAP[ext];
  if (file.type !== '' && file.type !== expectedMime) {
    return {
      valid: false,
      error: `MIME type không hợp lệ. Mong đợi "${expectedMime}", nhận được "${file.type || '(empty)'}".`,
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
  if (expectedMime && mime !== '' && mime !== expectedMime) {
    return { valid: false, error: `MIME type không hợp lệ. Mong đợi "${expectedMime}", nhận được "${mime || '(empty)'}".` };
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

// ─── File saving ──────────────────────────────────────────────────────────────

export interface SaveResult {
  conversionId: string;
  originalPath: string;
  outputDir: string;
  normalizedName: string;
}

export async function saveUploadedFile(file: File): Promise<SaveResult> {
  const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
  const outputDir = process.env.OUTPUT_DIR ?? './outputs';

  const conversionId = crypto.randomUUID();

  // E07: normalize tên file tiếng Việt NFD → NFC
  const normalizedName = normalizeFilename(file.name);

  // Lưu file gốc: uploads/[uuid]-[originalname]
  const originalPath = path.join(uploadDir, `${conversionId}-${normalizedName}`);

  // Tạo thư mục outputs/[uuid]/ cho transformation này
  const conversionOutputDir = path.join(outputDir, conversionId);

  // Đảm bảo các thư mục tồn tại
  await fs.mkdir(path.dirname(originalPath), { recursive: true });
  await fs.mkdir(conversionOutputDir, { recursive: true });

  // Ghi file từ ArrayBuffer
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(originalPath, buffer);

  return {
    conversionId,
    originalPath,
    outputDir: conversionOutputDir,
    normalizedName,
  };
}

// ─── CompressLevel validation ─────────────────────────────────────────────────

const VALID_COMPRESS_LEVELS: CompressLevel[] = ['screen', 'ebook', 'printer', 'prepress'];

export function parseCompressLevel(value: FormDataEntryValue | null): CompressLevel {
  if (typeof value === 'string' && VALID_COMPRESS_LEVELS.includes(value as CompressLevel)) {
    return value as CompressLevel;
  }
  return 'ebook'; // default
}
