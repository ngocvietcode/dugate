// lib/upload-helper.ts
// Utility to save uploaded files to disk

import path from 'path';
import fs from 'fs/promises';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

export async function saveUploadedFile(
  file: File,
  operationId: string,
  prefix?: string,
): Promise<{ path: string; size: number }> {
  const dir = path.join(UPLOAD_DIR, operationId);
  await fs.mkdir(dir, { recursive: true });

  const sanitizedName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeName = prefix ? `${prefix}_${sanitizedName}` : sanitizedName;
  const filePath = path.join(dir, safeName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  // Normalize path to use forward slashes (/) for cross-platform compatibility 
  // (Windows host 'npm run dev' -> Linux Docker worker)
  const normalizedPath = filePath.replace(/\\/g, '/');

  return { path: normalizedPath, size: buffer.length };
}
