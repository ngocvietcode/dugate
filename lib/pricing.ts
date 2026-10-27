// lib/pricing.ts
// Model pricing resolution for cost estimation of token-only providers (AIHub).
// Source of truth = AppSetting key `model_pricing_json` (editable on Settings page).
// Seeds from lib/config.ts MODEL_PRICING when never configured.
//
// IMPORTANT: providers that RETURN a cost (CAIP / Agent Studio) must NOT go through
// here — their reported cost is authoritative. This module only ESTIMATES cost for
// token-only providers, and clearly reports when a model is UNPRICED so Ops can fix it.

import { getSetting } from '@/lib/settings';
import { MODEL_PRICING } from '@/lib/config';

/** Where a cost figure came from — surfaced to the UI for transparency. */
export type CostSource = 'provider' | 'estimate' | 'unpriced' | 'none';

export interface ModelRate {
  input: number;  // USD per 1M input tokens
  output: number; // USD per 1M output tokens
}

/** Row shape stored in AppSetting.model_pricing_json */
export interface PricingRow {
  model: string;
  inputPer1M: number;
  outputPer1M: number;
}

const CACHE_TTL_MS = 60_000;
let cache: { at: number; map: Record<string, ModelRate> } | null = null;

/** Drop the in-process cache (called after a pricing update in the same process). */
export function invalidatePricingCache(): void {
  cache = null;
}

/** Build the seed pricing rows from the legacy hardcoded table (for first-time setup). */
export function seedPricingRows(): PricingRow[] {
  return Object.entries(MODEL_PRICING).map(([model, r]) => ({
    model,
    inputPer1M: r.input,
    outputPer1M: r.output,
  }));
}

/** Read + parse the configured pricing map (cached). Falls back to seed when empty/invalid. */
export async function getModelPricingMap(): Promise<Record<string, ModelRate>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.map;

  const map: Record<string, ModelRate> = {};
  try {
    const raw = await getSetting('model_pricing_json');
    if (raw) {
      const rows = JSON.parse(raw) as PricingRow[];
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r && typeof r.model === 'string' && r.model.trim()) {
            map[r.model.trim()] = {
              input: Number(r.inputPer1M) || 0,
              output: Number(r.outputPer1M) || 0,
            };
          }
        }
      }
    }
  } catch {
    // fall through to seed
  }

  if (Object.keys(map).length === 0) {
    for (const [model, r] of Object.entries(MODEL_PRICING)) {
      map[model] = { input: r.input, output: r.output };
    }
  }

  cache = { at: now, map };
  return map;
}

function normalizeModel(model: string): string {
  return model.replace(/^ext:/, '').replace(/^internal:/, '').trim();
}

/**
 * Resolve a rate for a model name by EXACT match only (after stripping the
 * "ext:"/"internal:" prefix the pipeline adds).
 *
 * We deliberately DO NOT fuzzy/prefix-match: for billing, guessing a price from a
 * similar model name can silently apply the wrong (e.g. more expensive) rate
 * — e.g. "gemini-2.5-flash-lite" must NOT inherit "gemini-2.5-flash". If the exact
 * model is not configured, we return null so the caller flags it as UNPRICED and
 * Ops adds the exact model + price on the Settings page.
 */
export function resolveRate(map: Record<string, ModelRate>, model: string): ModelRate | null {
  const norm = normalizeModel(model);
  if (!norm) return null;
  return map[norm] ?? null;
}

/**
 * Estimate cost for a token-only provider.
 * - no tokens at all       → { cost: 0, source: 'none' }   (nothing to charge)
 * - model has a rate       → { cost, source: 'estimate' }
 * - tokens but no rate      → { cost: 0, source: 'unpriced' } (Ops must configure price)
 */
export async function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<{ cost: number; source: CostSource }> {
  if (inputTokens === 0 && outputTokens === 0) {
    return { cost: 0, source: 'none' };
  }
  const map = await getModelPricingMap();
  const rate = resolveRate(map, model);
  if (!rate) return { cost: 0, source: 'unpriced' };
  const cost = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  return { cost, source: 'estimate' };
}
