// app/api/settings/cache/route.ts
// GET  /api/settings/cache — Cache + output storage stats
// DELETE /api/settings/cache — Clear cache/output files
//   ?target=cache (default) — clear FileCache entries
//   ?target=outputs         — clean expired output files on S3
//   &expired=true           — only expired entries

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fileCaches, operations } from '@/lib/db/schema';
import { lte, inArray, sql, sum, asc } from 'drizzle-orm';
import { getStorageBackend } from '@/lib/storage';
import { LocalStorageBackend } from '@/lib/storage/local-backend';
import { getSetting } from '@/lib/settings';
import { requireAdmin } from '@/lib/rbac';
import { cleanupExpiredFiles } from '@/lib/cleanup';

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const backend = await getStorageBackend();
    const isS3 = !(backend instanceof LocalStorageBackend);

    // FileCache stats (deduped uploaded files)
    const [cacheCountResult, cacheSizeResult, cacheOldestResult] = await Promise.all([
      db.select({ count: sql`count(*)`.mapWith(Number) }).from(fileCaches),
      db.select({ sum: sum(fileCaches.size).mapWith(Number) }).from(fileCaches),
      db.select({ createdAt: fileCaches.createdAt }).from(fileCaches).orderBy(asc(fileCaches.createdAt)).limit(1),
    ]);
    const cacheCount = cacheCountResult[0].count;
    const cacheSizeTotal = cacheSizeResult[0].sum ?? 0;
    const cacheOldest = cacheOldestResult[0];

    // Output file stats — operations with outputFilePath that haven't been cleaned
    const [outputStatsResult] = await db.select({ count: sql`count(*)`.mapWith(Number) }).from(operations).where(
      sql`${operations.outputFilePath} IS NOT NULL AND ${operations.filesDeleted} = false AND ${operations.deletedAt} IS NULL`
    );

    // Expired operations (files older than 24h that can be cleaned)
    const expiryCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [expiredCountResult] = await db.select({ count: sql`count(*)`.mapWith(Number) }).from(operations).where(
      sql`${operations.createdAt} < ${expiryCutoff} AND ${operations.filesDeleted} = false AND ${operations.deletedAt} IS NULL`
    );

    return NextResponse.json({
      // FileCache (deduped uploads)
      totalFiles: cacheCount,
      totalSizeBytes: cacheSizeTotal,
      totalSizeMB: Math.round((cacheSizeTotal / 1024 / 1024) * 100) / 100,
      oldestEntry: cacheOldest?.createdAt ?? null,
      // Output files
      outputFiles: outputStatsResult.count,
      expiredOperations: expiredCountResult.count,
      // Backend info
      storageBackend: isS3 ? 's3' : 'local',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Failed to fetch storage stats' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const target = req.nextUrl.searchParams.get('target') ?? 'cache';
    const expiredOnly = req.nextUrl.searchParams.get('expired') === 'true';

    // ── Clean output files (trigger cleanupExpiredFiles) ──
    if (target === 'outputs') {
      const result = await cleanupExpiredFiles();
      return NextResponse.json({
        deleted: result.deleted,
        freedMB: result.freedMB,
      });
    }

    // ── Clean FileCache entries (default) ──
    const backend = await getStorageBackend();

    let entries;
    if (expiredOnly) {
      const ttlHours = parseInt(await getSetting('s3_cache_ttl_hours') || '168', 10);
      const cutoff = new Date(Date.now() - ttlHours * 3600_000);
      entries = await db.select().from(fileCaches).where(
        sql`${fileCaches.refCount} <= 0 AND ${fileCaches.lastAccessedAt} < ${cutoff}`
      );
    } else {
      // Only delete unreferenced files (refCount <= 0) to avoid breaking in-progress operations
      entries = await db.select().from(fileCaches).where(lte(fileCaches.refCount, 0));
    }

    if (entries.length === 0) {
      return NextResponse.json({ deleted: 0, freedMB: 0 });
    }

    // Delete S3 objects
    const keys = entries.map((e) => e.s3Key);
    await backend.deleteMany(keys);

    // Delete DB records
    await db.delete(fileCaches).where(inArray(fileCaches.id, entries.map((e) => e.id)));

    const freedBytes = entries.reduce((sum, e) => sum + e.size, 0);
    return NextResponse.json({
      deleted: entries.length,
      freedMB: Math.round((freedBytes / 1024 / 1024) * 100) / 100,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Failed to clear storage' }, { status: 500 });
  }
}
