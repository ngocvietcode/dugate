// lib/config.ts
// Centralized application configuration.
// All magic numbers, timeouts, limits, and model pricing live here.

// ─── File limits ──────────────────────────────────────────────────────────────

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
export const OUTPUT_DIR = process.env.OUTPUT_DIR ?? './outputs';

// ─── Worker ───────────────────────────────────────────────────────────────────

export const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
export const SUBSTEP_WORKER_CONCURRENCY = parseInt(process.env.SUBSTEP_WORKER_CONCURRENCY || String(WORKER_CONCURRENCY * 2), 10);
export const MAX_QUEUE_DEPTH = parseInt(process.env.MAX_QUEUE_DEPTH || '500', 10);
export const SYNC_TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT_MS || '30000', 10);
export const WORKER_MEMORY_THRESHOLD = parseFloat(process.env.WORKER_MEMORY_THRESHOLD || '0.90');

// ─── Rate limiting ────────────────────────────────────────────────────────────

export const RATE_LIMIT_API_KEY_PER_MIN = parseInt(process.env.RATE_LIMIT_API_KEY || '100', 10);
export const RATE_LIMIT_IP_PER_MIN = parseInt(process.env.RATE_LIMIT_IP || '30', 10);

// ─── Model pricing (USD per 1M tokens) ───────────────────────────────────────
// Used for cost tracking in Phase 6. Update as provider pricing changes.

export interface ModelPricing {
  input: number;   // USD per 1M input tokens
  output: number;  // USD per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gemini-1.5-flash':   { input: 0.075,  output: 0.30  },
  'gemini-1.5-pro':     { input: 3.50,   output: 10.50 },
  'gemini-2.0-flash':   { input: 0.10,   output: 0.40  },
  'gpt-4o':             { input: 2.50,   output: 10.00 },
  'gpt-4o-mini':        { input: 0.15,   output: 0.60  },
  'gpt-3.5-turbo':      { input: 0.50,   output: 1.50  },
};

/**
 * Calculate cost in USD for a given model and token counts.
 * Returns 0 if the model is not in the pricing table.
 */
export function calculateCostUsd(
  modelUsed: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Normalize: match prefix (e.g. "ext:gemini-1.5-flash" → "gemini-1.5-flash")
  const normalized = modelUsed.replace(/^ext:/, '').replace(/^internal:/, '');
  const pricing = MODEL_PRICING[normalized];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}
