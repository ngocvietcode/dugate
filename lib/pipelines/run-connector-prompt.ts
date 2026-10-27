// lib/pipelines/run-connector-prompt.ts
// Gọi MỘT connector LLM (ext-*) ĐỒNG BỘ với prompt tuỳ ý, KHÔNG file, KHÔNG qua queue.
// Dùng cho các tác vụ tương tác (vd Q&A sao kê): tái sử dụng runExternalApiProcessor
// (đã kiểm thử) nhưng dựng ProcessorContext tối thiểu và nạp connection trực tiếp từ DB.

import crypto from 'crypto';
import { db } from '@/lib/db';
import { externalApiConnections } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { runExternalApiProcessor } from '@/lib/pipelines/processors/external-api';
import type { ProcessorContext } from '@/lib/pipelines/engine';

export interface RunConnectorPromptResult {
  content: string;
  modelUsed: string;
}

/**
 * Chạy connector `slug` với `prompt` (biến _prompt bỏ qua template DB) và trả text.
 * Ném lỗi nếu connector không tồn tại hoặc đang bị DISABLE.
 */
export async function runConnectorPrompt(
  slug: string,
  prompt: string,
  opts?: { model?: string | null; outputFormat?: string; correlationId?: string },
): Promise<RunConnectorPromptResult> {
  const [connection] = await db
    .select()
    .from(externalApiConnections)
    .where(eq(externalApiConnections.slug, slug))
    .limit(1);

  if (!connection) {
    throw new Error(`CONNECTOR_NOT_FOUND: Connector '${slug}' chưa được cấu hình.`);
  }
  if (connection.state !== 'ENABLED') {
    throw new Error(`CONNECTOR_DISABLED: Connector '${slug}' đang bị vô hiệu hoá.`);
  }

  const correlationId = opts?.correlationId ?? crypto.randomUUID();
  const logger = new Logger({ correlationId, service: 'run-connector-prompt' });

  const variables: Record<string, unknown> = { _prompt: prompt };
  if (opts?.model && opts.model.trim()) variables._model = opts.model.trim();

  const ctx: ProcessorContext = {
    operationId: crypto.randomUUID(),
    stepIndex: 0,
    totalSteps: 1,
    filePaths: [],
    fileNames: [],
    remoteFileUrls: [],
    inputText: undefined,
    processorSlug: connection.slug,
    variables,
    outputFormat: opts?.outputFormat ?? 'md',
    correlationId,
    logger,
    pipelineState: {},
    captureSession: null,
    injectSession: null,
  };

  const result = await runExternalApiProcessor(ctx, connection, null);
  return { content: (result.content ?? '').trim(), modelUsed: result.modelUsed };
}
