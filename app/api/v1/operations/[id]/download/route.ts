// app/api/v1/operations/[id]/download/route.ts
// GET /api/v1/operations/{id}/download — Download output files

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import path from 'path';
import fs from 'fs/promises';

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
    // Derive base name from first uploaded file in filesJson
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
      const buffer = await fs.readFile(op.outputFilePath);
      const ext = path.extname(op.outputFilePath).slice(1);
      const contentType = ext === 'html' ? 'text/html' : ext === 'json' ? 'application/json' : 'text/markdown';

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': `${contentType}; charset=utf-8`,
          'Content-Disposition': `attachment; filename="${path.basename(op.outputFilePath)}"`,
        },
      });
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
