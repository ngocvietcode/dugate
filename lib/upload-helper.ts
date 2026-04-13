// lib/upload-helper.ts
// Utility to save uploaded files to disk

import path from 'path';
import fs from 'fs/promises';
import { validateFile } from '@/lib/upload';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

export async function saveUploadedFile(
  file: File,
  operationId: string,
  prefix?: string,
  allowedExtsStr?: string
): Promise<{ path: string; size: number }> {
  // Validate file type, MIME, and size before saving anything to disk
  const validation = validateFile(file, allowedExtsStr);
  if (!validation.valid) {
    throw new Error(`File validation failed: ${validation.error}`);
  }

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
