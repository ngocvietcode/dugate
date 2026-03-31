// app/api/internal/ext-connections/[id]/test/route.ts
// POST — Test connection với optional file + custom prompt
// Trả về: HTTP status, latency, response preview, mapped content

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const connection = await prisma.externalApiConnection.findUnique({ where: { id } });
    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connection không tồn tại' }, { status: 404 });
    }

    // Parse test payload
    const form = await req.formData();
    const testPrompt = (form.get('prompt') as string | null) ?? connection.defaultPrompt;
    const testFiles = form.getAll('files') as File[];

    // Build headers
    const headers: Record<string, string> = {
      'accept': 'application/json',
    };
    if (connection.authType === 'API_KEY_HEADER') {
      headers[connection.authKeyHeader] = connection.authSecret;
    } else if (connection.authType === 'BEARER') {
      headers['Authorization'] = `Bearer ${connection.authSecret}`;
    }
    if (connection.extraHeaders) {
      try {
        Object.assign(headers, JSON.parse(connection.extraHeaders));
      } catch { /* ignore */ }
    }

    // Remove explicitly set multipart/form-data Content-Type header so fetch can generate boundary
    const ctKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
    if (ctKey && headers[ctKey].toLowerCase().includes('multipart/form-data')) {
      delete headers[ctKey];
    }

    // Build form data
    const formData = new FormData();
    formData.append(connection.promptFieldName, testPrompt);

    // Static fields
    if (connection.staticFormFields) {
      try {
        const fields = JSON.parse(connection.staticFormFields) as Array<{ key: string; value: string }>;
        for (const field of fields) {
          formData.append(field.key, field.value);
        }
      } catch { /* ignore */ }
    }

    // Files (optional for test)
    if (testFiles && testFiles.length > 0) {
      for (const testFile of testFiles) {
        if (testFile.name) {
          const buf = await testFile.arrayBuffer();
          // Ensure file type is preserved to avoid application/octet-stream fallback
          formData.append(connection.fileFieldName, new Blob([buf], { type: testFile.type }), testFile.name);
        }
      }
    }

    // Execute request with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), connection.timeoutSec * 1000);
    const startedAt = Date.now();

    let httpStatus = 0;
    let responseBodyRaw = '';
    let mappedContent: unknown = null;
    let errorMessage: string | null = null;
    let errorStack: string | null = null;

    // Generate curl command
    let curlCmd = `curl -X ${connection.httpMethod} '${connection.endpointUrl}' \\`;
    for (const [k, v] of Object.entries(headers)) {
      const escapedValue = String(v).replace(/'/g, "'\\''");
      curlCmd += `\n  -H '${k}: ${escapedValue}' \\`;
    }
    curlCmd += `\n  -F '${connection.promptFieldName}=${testPrompt.replace(/'/g, "'\\''")}'`;

    if (connection.staticFormFields) {
      try {
        const fields = JSON.parse(connection.staticFormFields) as Array<{ key: string; value: string }>;
        for (const field of fields) {
            curlCmd += ` \\\n  -F '${field.key}=${String(field.value).replace(/'/g, "'\\''")}'`;
        }
      } catch { /* ignore */ }
    }

    if (testFiles && testFiles.length > 0) {
      for (const testFile of testFiles) {
        if (testFile.name) {
          curlCmd += ` \\\n  -F '${connection.fileFieldName}=@${testFile.name.replace(/'/g, "'\\''")}'`;
        }
      }
    }

    try {
      const isGetOrHead = connection.httpMethod === 'GET' || connection.httpMethod === 'HEAD';
      const response = await fetch(connection.endpointUrl, {
        method: connection.httpMethod,
        headers,
        body: isGetOrHead ? undefined : formData,
        signal: controller.signal,
      });

      httpStatus = response.status;
      responseBodyRaw = await response.text();

      if (response.ok) {
        try {
          const json = JSON.parse(responseBodyRaw);
          // Resolve dot-path
          const contentPath = connection.responseContentPath?.trim();
          if (!contentPath) {
             mappedContent = typeof json === 'object' && json !== null ? JSON.stringify(json, null, 2) : String(json);
          } else {
            let current: unknown = json;
            for (const part of contentPath.split('.')) {
              if (current === null || current === undefined) break;
              current = (current as Record<string, unknown>)[part];
            }
            mappedContent = typeof current === 'object' && current !== null
              ? JSON.stringify(current, null, 2)
              : (current !== undefined && current !== null ? String(current) : null);
          }
        } catch {
          mappedContent = responseBodyRaw;
        }
      } else {
        errorMessage = `HTTP ${response.status}`;
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        errorMessage = `Timeout sau ${connection.timeoutSec}s`;
        httpStatus = 0;
      } else {
        const e = err instanceof Error ? err : new Error(String(err));
        errorMessage = e.message;
        if ('cause' in e && e.cause) {
           errorMessage += ` (Cause: ${(e.cause as Error).message || String(e.cause)})`;
        }
        errorStack = e.stack ?? null;
      }
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - startedAt;

    return NextResponse.json({
      success: !errorMessage,
      httpStatus,
      latencyMs,
      responsePreview: responseBodyRaw,
      mappedContent,
      error: errorMessage,
      errorStack,
      curlCmd
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ExtConnections Test]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
