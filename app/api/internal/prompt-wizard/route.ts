// app/api/internal/prompt-wizard/route.ts
// POST — Nâng cấp prompt bằng AI thông qua connector slug "ext-prompt-wizard"
// Admin cần tạo ExternalApiConnection với slug = "ext-prompt-wizard" trước khi dùng.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { externalApiConnections } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth-guard';
import { Logger } from '@/lib/logger';
import { resolveConnectionSecret } from '@/lib/secrets/resolve';
import { summarizeErrorBody } from '@/lib/pipelines/processors/http-client';

const logger = new Logger({ service: 'prompt-wizard' });

const WIZARD_SLUG = 'ext-prompt-wizard';

export async function POST(req: NextRequest) {
  // Prompt Override editing is ADMIN-only in the UI, and this route spends the
  // connector's AI budget with its credentials attached. requireAuth let any
  // logged-in account — including one with zero Profile assignments — drive it.
  const guard = await requireAdmin();
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
    // Resolve the outbound auth value — Vault ref when set, else the legacy stored field (dual-read).
    const wizardSecret = await resolveConnectionSecret(wizardConn);
    if (wizardConn.authType === 'API_KEY_HEADER') {
      headers[wizardConn.authKeyHeader] = wizardSecret;
    } else if (wizardConn.authType === 'BEARER') {
      headers['Authorization'] = `Bearer ${wizardSecret}`;
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
      // `redirect: 'manual'` is the one outbound change made here.
      //
      // The default 'follow' would replay this request — including the
      // connector's API key header — at whatever host the endpoint redirects to.
      // Refusing redirects removes that credential-leak path with no behavioural
      // risk for a correctly configured connector.
      //
      // Deliberately NOT switching to ssrfSafeFetch: that would also block
      // private/internal hostnames, and this connector URL is admin-configured
      // and may legitimately point at an internal host today. Blocking it would
      // break a working feature to guard against an actor who is already ADMIN
      // and could reach the same host through any connector. The sibling
      // /ext-connections/[id]/test route uses plain fetch for the same reason.
      const response = await fetch(wizardConn.endpointUrl, {
        method: wizardConn.httpMethod,
        headers,
        body: formData,
        signal: controller.signal,
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        throw new Error('Connector trả về redirect — không đi theo để tránh gửi khoá xác thực sang host khác');
      }

      const rawBody = await response.text();

      if (!response.ok) {
        const detail = summarizeErrorBody(rawBody);
        errorMessage = `Connector trả về lỗi HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
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
    logger.error('[POST] Prompt wizard failed', {}, error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
