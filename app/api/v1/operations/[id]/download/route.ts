// app/api/v1/operations/[id]/download/route.ts
// GET /api/v1/operations/{id}/download — Download output files

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { getStorageBackend } from '@/lib/storage';
import { LocalStorageBackend } from '@/lib/storage/local-backend';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const op = await prisma.operation.findUnique({ where: { id } });

  if (!op || op.deletedAt) {
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/not-found', title: 'Not Found', status: 404 },
      { status: 404 }
    );
  }

  const apiKeyId = req.headers.get('x-api-key-id');
  if (apiKeyId && op.apiKeyId !== apiKeyId) {
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/forbidden', title: 'Forbidden', status: 403, detail: `Access denied.` },
      { status: 403 }
    );
  }

  if (!op.done || op.state !== 'SUCCEEDED') {
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/not-ready', title: 'Not Ready', status: 409, detail: 'Operation has not completed successfully.' },
      { status: 409 }
    );
  }

  // If we have output content, return it directly
  if (op.outputContent) {
    const ext = op.outputFormat === 'html' ? 'html' : op.outputFormat === 'json' ? 'json' : 'md';
    const contentType = ext === 'html' ? 'text/html' : ext === 'json' ? 'application/json' : 'text/markdown';
    const filesData: Array<{ name: string }> = op.filesJson ? JSON.parse(op.filesJson) : [];
    const firstName = filesData[0]?.name ?? 'output';
    const baseName = path.basename(firstName, path.extname(firstName));

    return new NextResponse(op.outputContent, {
      headers: {
        'Content-Type': `${contentType}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${baseName}.${ext}"`,
      },
    });
  }

  // If we have an output file path, stream it
  if (op.outputFilePath) {
    try {
      const backend = await getStorageBackend();

      if (backend instanceof LocalStorageBackend) {
        // Local: validate path traversal and stream from disk
        const outputBaseDir = path.resolve(process.env.OUTPUT_DIR ?? './outputs');
        const resolvedOutputPath = path.resolve(op.outputFilePath);
        const relativePath = path.relative(outputBaseDir, resolvedOutputPath);
        if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          // If the path breaks out of the output directory, it's either an invalid path or a legacy S3 key
          // accessed while the local backend is active. Return 404 instead of an alarming 403.
          return NextResponse.json(
            { type: 'https://dugate.vn/errors/file-not-found', title: 'File Not Found', status: 404, detail: 'Output file not found or is stored in an inactive S3 backend.' },
            { status: 404 }
          );
        }

        const stat = await fs.stat(resolvedOutputPath);
        const ext = path.extname(resolvedOutputPath).slice(1);
        const contentType = ext === 'html' ? 'text/html' : ext === 'json' ? 'application/json' : 'text/markdown';
        const stream = Readable.toWeb(createReadStream(resolvedOutputPath)) as ReadableStream<Uint8Array>;

        return new NextResponse(stream, {
          headers: {
            'Content-Type': `${contentType}; charset=utf-8`,
            'Content-Length': String(stat.size),
            'Content-Disposition': `attachment; filename="${path.basename(resolvedOutputPath)}"`,
          },
        });
      } else {
        // S3: stream from storage backend
        const readable = await backend.download(op.outputFilePath);
        const meta = await backend.getMetadata(op.outputFilePath);
        const ext = path.extname(op.outputFilePath).slice(1);
        const contentType = ext === 'html' ? 'text/html' : ext === 'json' ? 'application/json' : 'text/markdown';
        const stream = Readable.toWeb(readable) as ReadableStream<Uint8Array>;

        return new NextResponse(stream, {
          headers: {
            'Content-Type': `${contentType}; charset=utf-8`,
            ...(meta?.size ? { 'Content-Length': String(meta.size) } : {}),
            'Content-Disposition': `attachment; filename="${path.basename(op.outputFilePath)}"`,
          },
        });
      }
    } catch {
      return NextResponse.json(
        { type: 'https://dugate.vn/errors/file-not-found', title: 'File Not Found', status: 404, detail: 'Output file has been cleaned up.' },
        { status: 404 }
      );
    }
  }

  return NextResponse.json(
    { type: 'https://dugate.vn/errors/no-output', title: 'No Output', status: 404, detail: 'No output content or file available.' },
    { status: 404 }
  );
}
