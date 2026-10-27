// lib/storage/local-backend.ts
// Local filesystem implementation of StorageBackend.

import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { StorageBackend, UploadResult, StorageMetadata } from './types';

const BASE_DIR = path.resolve(process.env.UPLOAD_DIR ?? './uploads');

function safePath(key: string): string {
  const resolved = path.resolve(BASE_DIR, key);
  if (!resolved.startsWith(BASE_DIR)) {
    throw new Error(`Path traversal blocked: key "${key}" resolves outside base directory`);
  }
  return resolved;
}

export class LocalStorageBackend implements StorageBackend {
  async upload(key: string, stream: Readable, _opts?: { contentType?: string }): Promise<UploadResult> {
    const filePath = safePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const hash = crypto.createHash('md5');
    let bytesWritten = 0;
    const writeStream = createWriteStream(filePath);

    try {
      await pipeline(
        stream,
        async function* (source) {
          for await (const chunk of source) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            hash.update(buf);
            bytesWritten += buf.length;
            yield buf;
          }
        },
        writeStream,
      );
    } catch (err) {
      await fs.unlink(filePath).catch(() => {});
      throw err;
    }

    return {
      bytesWritten,
      md5: hash.digest('hex'),
      s3Key: key,
    };
  }

  async download(key: string): Promise<Readable> {
    return createReadStream(safePath(key));
  }

  async downloadToTempFile(key: string, _tmpDir: string): Promise<string> {
    const filePath = safePath(key);
    await fs.access(filePath);
    return filePath;
  }

  async delete(key: string): Promise<void> {
    const filePath = safePath(key);
    await fs.rm(filePath, { force: true });
    // Attempt to remove parent directory if empty (e.g. uploads/operationId).
    // Ignores ENOTEMPTY error if other files are still inside.
    const parentDir = path.dirname(filePath);
    try {
      if (parentDir !== BASE_DIR) {
        await fs.rmdir(parentDir);
      }
    } catch { /* ignore if not empty or doesn't exist */ }
  }

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => this.delete(k)));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(safePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    try {
      const stat = await fs.stat(safePath(key));
      return { size: stat.size };
    } catch {
      return null;
    }
  }
}
