// Đọc `result.usage` của operation. Backend trả usage khi SUCCEEDED (đủ) và FAILED
// (chỉ token/cost/breakdown). CANCELLED hoặc không có result thì không có usage.

export interface UsageBreakdownItem {
  processor: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface OperationUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  pages: number | null;
  model: string | null;
  costUsd: number | null;
  breakdown: UsageBreakdownItem[];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseUsage(opData: unknown): OperationUsage | null {
  const root = record(opData);
  if (!root) return null;
  const state = record(root.metadata)?.state;
  if (state === 'CANCELLED') return null;
  const usage = record(record(root.result)?.usage);
  if (!usage) return null;

  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const costUsd = num(usage.cost_usd);
  const breakdown: UsageBreakdownItem[] = (Array.isArray(usage.breakdown) ? usage.breakdown : [])
    .map((item) => record(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      processor: str(item.processor) ?? '—',
      model: str(item.model),
      inputTokens: num(item.input_tokens),
      outputTokens: num(item.output_tokens),
      costUsd: num(item.cost_usd),
    }));

  const succeeded = state === 'SUCCEEDED';
  const parsed: OperationUsage = {
    inputTokens,
    outputTokens,
    pages: succeeded ? num(usage.pages_processed) : null,
    model: succeeded ? str(usage.model_used) : null,
    costUsd,
    breakdown,
  };

  const hasAnything = inputTokens !== null || outputTokens !== null || costUsd !== null
    || parsed.pages !== null || parsed.model !== null || breakdown.length > 0;
  return hasAnything ? parsed : null;
}
