// app/api/internal/prompt-wizard/route.ts
// POST — Nâng cấp prompt bằng AI thông qua connector slug "ext-prompt-wizard"
// Admin cần tạo ExternalApiConnection với slug = "ext-prompt-wizard" trước khi dùng.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { externalApiConnections } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth-guard';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'prompt-wizard' });

const WIZARD_SLUG = 'ext-prompt-wizard';

export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await req.json();
    const {
      currentPrompt,
      problem,
      metadata,
    }: {
      currentPrompt: string;
      problem?: string;
      metadata?: {
        endpointName?: string;
        endpointSlug?: string;
        connectorName?: string;
        connectorSlug?: string;
        stepIndex?: number;
      };
    } = body;

    if (!currentPrompt?.trim()) {
      return NextResponse.json({ success: false, error: 'currentPrompt không được để trống' }, { status: 400 });
    }

    // Find the designated wizard connector by fixed slug
    const [wizardConn] = await db
      .select()
      .from(externalApiConnections)
      .where(and(eq(externalApiConnections.slug, WIZARD_SLUG), eq(externalApiConnections.state, 'ENABLED')))
      .limit(1);

    if (!wizardConn) {
      return NextResponse.json(
        {
          success: false,
          error: `Chưa cấu hình Prompt Wizard Connector. Vào trang API Connections, tạo một connector mới với slug = "${WIZARD_SLUG}" và trỏ tới LLM endpoint của bạn.`,
        },
        { status: 404 },
      );
    }

    // Build the meta-prompt sent to the LLM
    const problemText = problem?.trim()
      ? problem.trim()
      : 'Không có — hãy tự phân tích và cải thiện chất lượng tổng thể của prompt.';

    const contextLines: string[] = [];
    if (metadata?.endpointName) {
      contextLines.push(`- Endpoint: ${metadata.endpointName}${metadata.endpointSlug ? ` (${metadata.endpointSlug})` : ''}`);
    }
    if (metadata?.connectorName) {
      contextLines.push(
        `- Connector: ${metadata.connectorName}${metadata.connectorSlug ? ` [${metadata.connectorSlug}]` : ''}` +
        (metadata.stepIndex !== undefined ? `, Bước ${metadata.stepIndex + 1} trong pipeline` : ''),
      );
    }

    const wizardPrompt = [
      'Bạn là chuyên gia viết system prompt cho AI pipeline xử lý tài liệu.',
      '',
      '## Prompt Hiện Tại',
      '<prompt>',
      currentPrompt.trim(),
      '</prompt>',
      '',
      '## Vấn Đề Đang Gặp',
      problemText,
      '',
      ...(contextLines.length > 0 ? ['## Context', ...contextLines, ''] : []),
      '## Yêu Cầu',
      'Viết lại prompt trên để:',
      '1. Rõ ràng và cụ thể hơn về format output mong muốn',
      '2. Giải quyết vấn đề đang gặp (nếu có)',
      '3. Giữ nguyên các template variable như {{input_content}} nếu có',
      '4. KHÔNG thêm giải thích hay chú thích — chỉ trả về nội dung prompt mới',
    ].join('\n');

    // Build request headers
    const headers: Record<string, string> = { accept: 'application/json' };
    if (wizardConn.authType === 'API_KEY_HEADER') {
      headers[wizardConn.authKeyHeader] = wizardConn.authSecret;
    } else if (wizardConn.authType === 'BEARER') {
      headers['Authorization'] = `Bearer ${wizardConn.authSecret}`;
    }
    if (wizardConn.extraHeaders) {
      try { Object.assign(headers, JSON.parse(wizardConn.extraHeaders)); } catch { /* ignore */ }
    }
    // Remove explicit multipart Content-Type so fetch auto-generates boundary
    const ctKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
    if (ctKey && headers[ctKey].toLowerCase().includes('multipart/form-data')) delete headers[ctKey];

    // Build form data
    const formData = new FormData();
    formData.append(wizardConn.promptFieldName, wizardPrompt);
    if (wizardConn.staticFormFields) {
      try {
        const fields = JSON.parse(wizardConn.staticFormFields) as Array<{ key: string; value: string }>;
        for (const f of fields) formData.append(f.key, f.value);
      } catch { /* ignore */ }
    }

    // Call the connector
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), wizardConn.timeoutSec * 1000);

    let upgradedPrompt: string | null = null;
    let errorMessage: string | null = null;

    try {
      const response = await fetch(wizardConn.endpointUrl, {
        method: wizardConn.httpMethod,
        headers,
        body: formData,
        signal: controller.signal,
      });

      const rawBody = await response.text();

      if (!response.ok) {
        errorMessage = `Connector trả về lỗi HTTP ${response.status}: ${rawBody.slice(0, 300)}`;
      } else {
        try {
          const json = JSON.parse(rawBody);
          const contentPath = wizardConn.responseContentPath?.trim();
          if (!contentPath) {
            upgradedPrompt = typeof json === 'string' ? json : JSON.stringify(json);
          } else {
            let current: unknown = json;
            for (const part of contentPath.split('.')) {
              if (current == null) break;
              current = (current as Record<string, unknown>)[part];
            }
            upgradedPrompt = current != null ? String(current) : null;
          }
        } catch {
          upgradedPrompt = rawBody;
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        errorMessage = `Timeout sau ${wizardConn.timeoutSec}s`;
      } else {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    } finally {
      clearTimeout(timeout);
    }

    if (errorMessage || !upgradedPrompt) {
      return NextResponse.json(
        { success: false, error: errorMessage ?? 'Connector không trả về nội dung' },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, upgradedPrompt });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[POST] Prompt wizard failed', {}, error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
