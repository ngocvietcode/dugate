// lib/cleanup.ts
// Auto cleanup: xóa file uploads + outputs, giữ Operation record trong DB.
// Supports both local filesystem and S3 storage backend.

import fs from 'fs/promises';
import path from 'path';
import { db } from './db';
import { operations, fileCaches } from './db/schema';
import { lt, eq, isNull, and, lte, inArray, sql } from 'drizzle-orm';
import { Logger } from './logger';
import { getStorageBackend } from './storage';
import { LocalStorageBackend } from './storage/local-backend';
import { getSetting } from './settings';

const logger = new Logger({ service: 'cleanup' });

const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── getDirSize: tính dung lượng thư mục đệ quy ──────────────────────────────
async function getDirSize(dirPath: string): Promise<number> {
  let size = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += await getDirSize(p);
      } else {
        try {
          const stat = await fs.stat(p);
          size += stat.size;
        } catch { /* ignore */ }
      }
    }
  } catch { /* directory doesn't exist */ }
  return size;
}

// ─── cleanupExpiredFiles ──────────────────────────────────────────────────────
export async function cleanupExpiredFiles(): Promise<{ deleted: number; freedMB: number }> {
  const cutoff = new Date(Date.now() - EXPIRY_MS);
  const outputDir = process.env.OUTPUT_DIR ?? './outputs';
  const backend = await getStorageBackend();
  const isLocal = backend instanceof LocalStorageBackend;

  const expired = await db.select({
    id: operations.id,
    filesJson: operations.filesJson,
    outputFilePath: operations.outputFilePath,
  }).from(operations).where(and(
    lt(operations.createdAt, cutoff),
    eq(operations.filesDeleted, false),
    isNull(operations.deletedAt)
  ));

  let freed = 0;
  let deleted = 0;

  for (const conv of expired) {
    try {
      // Unconditionally clean up local output directory if it exists
      const convOutputDir = path.join(outputDir, conv.id);
      try {
        const dsize = await getDirSize(convOutputDir);
        if (dsize > 0) {
          freed += dsize;
          await fs.rm(convOutputDir, { recursive: true, force: true });
        }
      } catch {}

      // Clean up output file from backend if configured
      if (conv.outputFilePath) {
        // Safe delete from active backend
        const meta = await backend.getMetadata(conv.outputFilePath).catch(() => null);
        if (meta) freed += meta.size;
        await backend.delete(conv.outputFilePath).catch(() => {});
      }

      // Delete uploaded files
      const filesData: Array<{ name: string; path: string; fileCacheId?: string; s3Key?: string }> = conv.filesJson
        ? JSON.parse(conv.filesJson)
        : [];

      for (const f of filesData) {
        if (f.fileCacheId) {
          // S3-cached file: decrement refCount (actual S3 deletion in cleanupExpiredCache)
          await db.update(fileCaches)
            .set({ refCount: sql`${fileCaches.refCount} - 1` })
            .where(eq(fileCaches.id, f.fileCacheId)).catch(() => {
            // FileCache record may already be deleted
          });
        } else if (f.s3Key) {
          // S3 file without cache entry — delete directly
          const meta = await backend.getMetadata(f.s3Key).catch(() => null);
          if (meta) freed += meta.size;
          await backend.delete(f.s3Key).catch(() => {});
        } else if (f.path) {
          // Legacy local file
          try {
            const stat = await fs.stat(f.path);
            freed += stat.size;
            await fs.rm(f.path, { force: true });
            try {
              const parentDir = path.dirname(f.path);
              await fs.rmdir(parentDir);
            } catch { /* ignore if not empty */ }
          } catch { /* already deleted or error */ }
        }
      }

      await db.update(operations).set({ filesDeleted: true }).where(eq(operations.id, conv.id));

      deleted++;
    } catch (err) {
      logger.error(`[cleanupExpiredFiles] Failed for operation ${conv.id}`, {}, err);
    }
  }

  const freedMB = Math.round((freed / 1024 / 1024) * 100) / 100;
  if (deleted > 0) {
    logger.info(`[cleanupExpiredFiles] Deleted ${deleted} operations, freed ${freedMB} MB`);
  }

  return { deleted, freedMB };
}

// ─── cleanupExpiredCache — S3 FileCache TTL cleanup ──────────────────────────
export async function cleanupExpiredCache(): Promise<{ deleted: number; freedMB: number }> {
  const ttlHours = parseInt(await getSetting('s3_cache_ttl_hours') || '168', 10);
  const cutoff = new Date(Date.now() - ttlHours * 3600_000);

  const expired = await db.select().from(fileCaches).where(and(
    lte(fileCaches.refCount, 0),
    lt(fileCaches.lastAccessedAt, cutoff)
  ));

  if (expired.length === 0) return { deleted: 0, freedMB: 0 };

  const backend = await getStorageBackend();
  const keys = expired.map((e) => e.s3Key);

  await backend.deleteMany(keys);
  await db.delete(fileCaches).where(inArray(fileCaches.id, expired.map((e) => e.id)));

  const freedBytes = expired.reduce((sum, e) => sum + e.size, 0);
  const freedMB = Math.round((freedBytes / 1024 / 1024) * 100) / 100;

  logger.info(`[cleanupExpiredCache] Deleted ${expired.length} cached files, freed ${freedMB} MB`);

  return { deleted: expired.length, freedMB };
}
