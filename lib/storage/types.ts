// lib/storage/types.ts
// Storage backend interface — abstracts local filesystem vs S3-compatible storage.

import type { Readable } from 'stream';

export interface UploadResult {
  bytesWritten: number;
  md5: string;   // hex digest computed during streaming
  s3Key: string; // the storage key (local path or S3 object key)
}

export interface StorageMetadata {
  size: number;
  md5?: string;
}

export interface StorageBackend {
  /** Stream data to storage. Returns bytes written, MD5 hash, and storage key. */
  upload(key: string, stream: Readable, opts?: { contentType?: string }): Promise<UploadResult>;

  /** Get a readable stream for a stored object. */
  download(key: string): Promise<Readable>;

  /**
   * Download to a temp file on local disk. Returns the temp file path.
   * For local backend, may return the original path directly (no copy).
   */
  downloadToTempFile(key: string, tmpDir: string): Promise<string>;

  /** Delete a single object. */
  delete(key: string): Promise<void>;

  /** Delete multiple objects (batch). */
  deleteMany(keys: string[]): Promise<void>;

  /** Check if an object exists. */
  exists(key: string): Promise<boolean>;

  /** Get object metadata (size, md5). Returns null if not found. */
  getMetadata(key: string): Promise<StorageMetadata | null>;
}
