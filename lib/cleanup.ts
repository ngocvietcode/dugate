// lib/cleanup.ts
// Auto cleanup: xóa file uploads + outputs sau 24h, giữ Transformation record trong DB

import fs from 'fs/promises';
import path from 'path';
import { prisma } from './prisma';

const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 giờ

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
        } catch { /* bỏ qua file lỗi */ }
      }
    }
  } catch { /* thư mục không tồn tại */ }
  return size;
}

// ─── cleanupExpiredFiles ──────────────────────────────────────────────────────
export async function cleanupExpiredFiles(): Promise<{ deleted: number; freedMB: number }> {
  const cutoff = new Date(Date.now() - EXPIRY_MS);
  const outputDir = process.env.OUTPUT_DIR ?? './outputs';

  const expired = await prisma.operation.findMany({
    where: {
      createdAt: { lt: cutoff },
      filesDeleted: false,
      deletedAt: null,
    },
    select: {
      id: true,
      filesJson: true,
    },
  });

  let freed = 0;
  let deleted = 0;

  for (const conv of expired) {
    try {
      // Xóa thư mục outputs/[uuid]/
      const convOutputDir = path.join(outputDir, conv.id);
      freed += await getDirSize(convOutputDir);
      await fs.rm(convOutputDir, { recursive: true, force: true });

      // Delete all uploaded files from filesJson
      const filesData: Array<{ name: string; path: string }> = conv.filesJson
        ? JSON.parse(conv.filesJson)
        : [];
      for (const f of filesData) {
        if (f.path) {
          try {
            const stat = await fs.stat(f.path);
            freed += stat.size;
          } catch { /* file already deleted */ }
          await fs.rm(f.path, { force: true });
        }
      }

      // Mark as deleted in DB
      await prisma.operation.update({
        where: { id: conv.id },
        data: { filesDeleted: true },
      });

      deleted++;
    } catch (err) {
      console.error(`[Cleanup] Failed for ${conv.id}:`, err);
    }
  }

  const freedMB = Math.round((freed / 1024 / 1024) * 100) / 100;
  if (deleted > 0) {
    console.log(`[Cleanup] Đã xóa ${deleted} transformations, giải phóng ${freedMB} MB`);
  }

  return { deleted, freedMB };
}
