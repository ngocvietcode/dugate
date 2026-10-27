// app/api/v1/operations/[id]/download/route.ts
// GET /api/v1/operations/{id}/download — Download output files

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { operations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { getStorageBackend } from '@/lib/storage';
import { LocalStorageBackend } from '@/lib/storage/local-backend';
import { BASE_TYPE_URI } from '@/lib/errors';
import { resolveCallerIdentity } from '@/lib/auth-resolve-key';
import { encryptOperationResponse } from '@/lib/crypto/operation-response-encrypt';
import { formatOperationIntegrationResponse, INTEGRATION_VIEW_ENDPOINTS } from '@/lib/pipelines/format';
import { parseIntegrationIncludes } from '@/lib/pipelines/workflows/loan-appraisal/integration-payload';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [op] = await db.select().from(operations).where(eq(operations.id, id)).limit(1);

  if (!op || op.deletedAt) {
    return NextResponse.json(
      { type: `${BASE_TYPE_URI}/not-found`, title: 'Not Found', status: 404 },
      { status: 404 }
    );
  }

  const { apiKeyId, userId, userRole } = await resolveCallerIdentity(req);

  if (!apiKeyId && !userId) {
    return NextResponse.json(
      { type: `${BASE_TYPE_URI}/unauthorized`, title: 'Unauthorized', status: 401, detail: 'Authentication required.' },
      { status: 401 }
    );
  }

  if (apiKeyId && op.apiKeyId !== apiKeyId) {
    return NextResponse.json(
      { type: `${BASE_TYPE_URI}/forbidden`, title: 'Forbidden', status: 403, detail: `Access denied.` },
      { status: 403 }
    );
  }

  if (!apiKeyId && userId && userRole !== 'ADMIN' && op.createdByUserId !== userId) {
    return NextResponse.json(
      { type: `${BASE_TYPE_URI}/forbidden`, title: 'Forbidden', status: 403, detail: `Access denied.` },
      { status: 403 }
    );
  }

  if (!op.done || op.state !== 'SUCCEEDED') {
    return NextResponse.json(
      { type: `${BASE_TYPE_URI}/not-ready`, title: 'Not Ready', status: 409, detail: 'Operation has not completed successfully.' },
      { status: 409 }
    );
  }

  // `view=integration`: tải file JSON tích hợp (classification / extraction /
  // evaluation) thay cho chuỗi tóm tắt legacy trong outputContent.
  if (req.nextUrl.searchParams.get('view') === 'integration') {
    if (!INTEGRATION_VIEW_ENDPOINTS.has(op.endpointSlug ?? '')) {
      return NextResponse.json(
        {
          type: `${BASE_TYPE_URI}/unsupported-view`,
          title: 'Unsupported View',
          status: 400,
          detail: `view=integration chỉ hỗ trợ cho: ${[...INTEGRATION_VIEW_ENDPOINTS].join(', ')}.`,
        },
        { status: 400 },
      );
    }
    const integration = (formatOperationIntegrationResponse(op, { include: parseIntegrationIncludes(req.nextUrl.searchParams.get('include')) }).result as Record<string, unknown> | undefined)?.extracted_data ?? null;
    const fileName = `loan-appraisal-${op.id}`.replace(/["\\\r\n]/g, '_');
    const { body: encBody, headers: encHeaders, encrypted } = await encryptOperationResponse(
      { extracted_data: integration },
      op,
      undefined,
      'full',
    );
    return new NextResponse(JSON.stringify(encrypted ? encBody : integration, null, encrypted ? undefined : 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}${encrypted ? '.enc' : ''}.json"`,
        ...encHeaders,
      },
    });
  }

  // If we have output content, return it directly
  if (op.outputContent) {
    const ext = op.outputFormat === 'html' ? 'html' : op.outputFormat === 'json' ? 'json' : 'md';
    const contentType = ext === 'html' ? 'text/html' : ext === 'json' ? 'application/json' : 'text/markdown';
    let firstName = 'output';
    try {
      const filesData: Array<{ name: string }> = op.filesJson ? JSON.parse(op.filesJson) : [];
      firstName = filesData[0]?.name ?? 'output';
    } catch { /* corrupt filesJson — use default name */ }
    const baseName = path.basename(firstName, path.extname(firstName)).replace(/["\\\r\n]/g, '_');

    // Optional encryption (Profile opt-in) — prevents a plaintext bypass of the
    // poll encryption. Wraps the whole content as an encrypted envelope; the
    // response becomes application/json regardless of the original format.
    const { body: encBody, headers: encHeaders, encrypted } = await encryptOperationResponse(
      { content: op.outputContent, output_format: op.outputFormat },
      op,
      undefined,
      'full', // download wraps the whole content; selective field-paths don't apply here
    );
    if (encrypted) {
      return new NextResponse(JSON.stringify(encBody), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}.enc.json"`,
          ...encHeaders,
        },
      });
    }

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
            { type: `${BASE_TYPE_URI}/file-not-found`, title: 'File Not Found', status: 404, detail: 'Output file not found or is stored in an inactive S3 backend.' },
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
            'Content-Disposition': `attachment; filename="${path.basename(resolvedOutputPath).replace(/["\\\r\n]/g, '_')}"`,
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
        { type: `${BASE_TYPE_URI}/file-not-found`, title: 'File Not Found', status: 404, detail: 'Output file has been cleaned up.' },
        { status: 404 }
      );
    }
  }

  return NextResponse.json(
    { type: `${BASE_TYPE_URI}/no-output`, title: 'No Output', status: 404, detail: 'No output content or file available.' },
    { status: 404 }
  );
}
