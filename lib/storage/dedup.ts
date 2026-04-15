// lib/storage/dedup.ts
// Atomic FileCache dedup — handles concurrent uploads of the same file safely.

import { prisma } from '@/lib/prisma';
import type { StorageBackend } from './types';

/**
 * Atomic dedup: try upsert with unique constraint handling.
 * If two concurrent uploads produce the same MD5:
 * - One wins the create, the other catches P2002 and increments refCount.
 * - The loser's S3 object is deleted.
 */
export interface DedupResult {
  id: string;
  /** The canonical S3 key that exists in storage (may differ from the uploaded key if deduped). */
  s3Key: string;
}

export async function dedup(
  md5: string,
  s3Key: string,
  fileName: string,
  mimeType: string,
  size: number,
  backend: StorageBackend,
): Promise<DedupResult> {
  // Try upsert: if md5Hash exists → increment refCount, else create
  try {
    const result = await prisma.fileCache.upsert({
      where: { md5Hash: md5 },
      update: {
        refCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
      create: {
        md5Hash: md5,
        s3Key,
        fileName,
        mimeType,
        size,
      },
    });

    // If upsert hit the "update" path, the new upload is a duplicate
    if (result.s3Key !== s3Key) {
      // Verify the canonical S3 object still exists before discarding the new upload
      const canonicalExists = await backend.exists(result.s3Key).catch(() => false);
      if (canonicalExists) {
        await backend.delete(s3Key).catch(() => {});
        return { id: result.id, s3Key: result.s3Key };
      }
      // Canonical object was deleted — adopt the new upload as the canonical copy
      await prisma.fileCache.update({
        where: { id: result.id },
        data: { s3Key },
      });
      return { id: result.id, s3Key };
    }

    return { id: result.id, s3Key: result.s3Key };
  } catch (err: unknown) {
    // Fallback: unique constraint race (extremely rare with upsert, but be defensive)
    const isUniqueViolation =
      err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002';

    if (isUniqueViolation) {
      const existing = await prisma.fileCache.update({
        where: { md5Hash: md5 },
        data: { refCount: { increment: 1 }, lastAccessedAt: new Date() },
      });
      if (s3Key !== existing.s3Key) {
        const canonicalExists = await backend.exists(existing.s3Key).catch(() => false);
        if (canonicalExists) {
          await backend.delete(s3Key).catch(() => {});
          return { id: existing.id, s3Key: existing.s3Key };
        }
        await prisma.fileCache.update({
          where: { id: existing.id },
          data: { s3Key },
        });
        return { id: existing.id, s3Key };
      }
      return { id: existing.id, s3Key: existing.s3Key };
    }
    throw err;
  }
}
