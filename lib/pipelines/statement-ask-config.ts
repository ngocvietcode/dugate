// lib/pipelines/statement-ask-config.ts
// Đọc cấu hình admin cho Q&A/Risk sao kê từ ProfileEndpoint — CÙNG cơ chế với các
// workflow khác: profileEndpoints.parameters._workflowPrompts.value[<step>] và
// _workflowModels.value[<step>]. Nhờ vậy admin chỉnh prompt/model ở cùng một chỗ
// (Profile của endpoint 'workflows:statement-analyze').
//
// Step keys dùng cho tính năng này:
//   - 'statement_qa'   : prompt hỏi–đáp tự do
//   - 'statement_risk' : prompt đánh giá rủi ro tổng thể

import { db } from '@/lib/db';
import { profileEndpoints } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

const ENDPOINT_SLUG = 'workflows:statement-analyze';

export type AskStep = 'statement_qa' | 'statement_risk';

export interface AskOverride {
  /** Prompt do admin cấu hình (thay template mặc định). undefined = dùng mặc định. */
  promptOverride?: string;
  /** Model do admin cấu hình cho bước này. undefined = dùng model mặc định của connector. */
  modelOverride?: string;
}

function readStringMap(obj: unknown, step: string): string | undefined {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const v = (obj as Record<string, unknown>)[step];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * Nạp override prompt/model cho một bước Q&A/Risk từ Profile của apiKey.
 * Trả về {} nếu không có apiKey hoặc profile chưa cấu hình (dùng mặc định trong code).
 */
export async function resolveStatementAskOverride(
  apiKeyId: string | null | undefined,
  step: AskStep,
): Promise<AskOverride> {
  if (!apiKeyId) return {};
  try {
    const [pe] = await db
      .select({ parameters: profileEndpoints.parameters })
      .from(profileEndpoints)
      .where(and(eq(profileEndpoints.apiKeyId, apiKeyId), eq(profileEndpoints.endpointSlug, ENDPOINT_SLUG)))
      .limit(1);
    if (!pe?.parameters) return {};

    const params = JSON.parse(pe.parameters);
    const promptOverride = readStringMap(params?._workflowPrompts?.value, step);
    const modelRaw = readStringMap(params?._workflowModels?.value, step);
    return {
      promptOverride,
      modelOverride: modelRaw ? modelRaw.trim() : undefined,
    };
  } catch {
    return {};
  }
}
