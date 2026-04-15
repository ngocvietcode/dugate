// lib/upload-helper.ts
// Save uploaded files via StorageBackend (local disk or S3).
// Computes MD5 during streaming for dedup via FileCache.

import path from 'path';
import { Readable } from 'stream';
import { validateFile } from '@/lib/upload';
import { getStorageBackend } from '@/lib/storage';
import { dedup } from '@/lib/storage/dedup';

/**
 * Sanitize filename: keep Unicode letters/numbers (Vietnamese-safe), strip control chars
 * and filesystem-dangerous characters only.
 */
function sanitizeFilename(name: string): string {
  return path.basename(name)
    .normalize('NFC')
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_');
}

export interface SavedFile {
  path: string;
  size: number;
  fileCacheId?: string;
  s3Key?: string;
  md5?: string;
}

export async function saveUploadedFile(
  file: File,
  operationId: string,
  prefix?: string,
  allowedExtsStr?: string,
): Promise<SavedFile> {
  const validation = validateFile(file, allowedExtsStr);
  if (!validation.valid) {
    throw new Error(`File validation failed: ${validation.error}`);
  }

  const sanitizedName = sanitizeFilename(file.name);
  const safeName = prefix ? `${prefix}_${sanitizedName}` : sanitizedName;
  const storageKey = `${operationId}/${safeName}`;

  const backend = await getStorageBackend();
  const readable = Readable.fromWeb(file.stream() as import('stream/web').ReadableStream<Uint8Array>);

  const result = await backend.upload(storageKey, readable, {
    contentType: file.type || 'application/octet-stream',
  });

  // MD5 dedup via FileCache — returns canonical s3Key (may differ if file was a duplicate)
  const dedupResult = await dedup(result.md5, result.s3Key, sanitizedName, file.type || 'application/octet-stream', result.bytesWritten, backend);

  return {
    path: dedupResult.s3Key,
    size: result.bytesWritten,
    fileCacheId: dedupResult.id,
    s3Key: dedupResult.s3Key,
    md5: result.md5,
  };
}

// dedup() is in lib/storage/dedup.ts (shared with file-url-downloader.ts)
