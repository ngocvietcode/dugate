// app/api/settings/cache/route.ts
// GET  /api/settings/cache — Cache + output storage stats
// DELETE /api/settings/cache — Clear cache/output files
//   ?target=cache (default) — clear FileCache entries
//   ?target=outputs         — clean expired output files on S3
//   &expired=true           — only expired entries

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
    const [cacheCount, cacheSizeResult, cacheOldest] = await Promise.all([
      prisma.fileCache.count(),
      prisma.fileCache.aggregate({ _sum: { size: true } }),
      prisma.fileCache.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);

    // Output file stats — operations with outputFilePath that haven't been cleaned
    const outputStats = await prisma.operation.aggregate({
      where: {
        outputFilePath: { not: null },
        filesDeleted: false,
        deletedAt: null,
      },
      _count: true,
    });

    // Expired operations (files older than 24h that can be cleaned)
    const expiryCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expiredCount = await prisma.operation.count({
      where: {
        createdAt: { lt: expiryCutoff },
        filesDeleted: false,
        deletedAt: null,
      },
    });

    return NextResponse.json({
      // FileCache (deduped uploads)
      totalFiles: cacheCount,
      totalSizeBytes: cacheSizeResult._sum.size ?? 0,
      totalSizeMB: Math.round(((cacheSizeResult._sum.size ?? 0) / 1024 / 1024) * 100) / 100,
      oldestEntry: cacheOldest?.createdAt ?? null,
      // Output files
      outputFiles: outputStats._count,
      expiredOperations: expiredCount,
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
      entries = await prisma.fileCache.findMany({
        where: { refCount: { lte: 0 }, lastAccessedAt: { lt: cutoff } },
      });
    } else {
      // Only delete unreferenced files (refCount <= 0) to avoid breaking in-progress operations
      entries = await prisma.fileCache.findMany({ where: { refCount: { lte: 0 } } });
    }

    if (entries.length === 0) {
      return NextResponse.json({ deleted: 0, freedMB: 0 });
    }

    // Delete S3 objects
    const keys = entries.map((e) => e.s3Key);
    await backend.deleteMany(keys);

    // Delete DB records
    await prisma.fileCache.deleteMany({
      where: { id: { in: entries.map((e) => e.id) } },
    });

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
