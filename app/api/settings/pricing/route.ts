// app/api/settings/pricing/route.ts
// GET  /api/settings/pricing → effective AIHub model pricing rows (seeded if unset)
// PUT  /api/settings/pricing → save pricing rows (ADMIN)
//
// Pricing is the source of truth for ESTIMATED cost of token-only providers (AIHub).
// Stored in AppSetting.model_pricing_json as JSON array of {model, inputPer1M, outputPer1M}.

import { NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth-guard';
import { getSetting, setSetting } from '@/lib/settings';
import { seedPricingRows, invalidatePricingCache, type PricingRow } from '@/lib/pricing';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'settings-pricing' });

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireCapability('settings:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const raw = await getSetting('model_pricing_json');
    let rows: PricingRow[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) rows = parsed;
      } catch {
        rows = [];
      }
    }
    // Seed from legacy table when never configured, so the UI shows the current effective pricing.
    if (rows.length === 0) rows = seedPricingRows();
    return NextResponse.json({ rows });
  } catch (error) {
    logger.error('[GET] pricing failed', {}, error);
    return NextResponse.json({ error: 'Không thể đọc bảng giá' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const guard = await requireCapability('settings:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = (await request.json()) as { rows?: unknown };
    if (!Array.isArray(body.rows)) {
      return NextResponse.json({ error: 'Payload phải có mảng rows' }, { status: 400 });
    }

    // Validate + normalize
    const clean: PricingRow[] = [];
    const seen = new Set<string>();
    for (const r of body.rows as PricingRow[]) {
      const model = typeof r?.model === 'string' ? r.model.trim() : '';
      if (!model) {
        return NextResponse.json({ error: 'Tên model không được để trống' }, { status: 400 });
      }
      if (seen.has(model)) {
        return NextResponse.json({ error: `Model trùng lặp: ${model}` }, { status: 400 });
      }
      const inputPer1M = Number(r?.inputPer1M);
      const outputPer1M = Number(r?.outputPer1M);
      if (!Number.isFinite(inputPer1M) || inputPer1M < 0 || !Number.isFinite(outputPer1M) || outputPer1M < 0) {
        return NextResponse.json({ error: `Giá không hợp lệ cho model ${model}` }, { status: 400 });
      }
      seen.add(model);
      clean.push({ model, inputPer1M, outputPer1M });
    }

    await setSetting('model_pricing_json', JSON.stringify(clean));
    invalidatePricingCache(); // effective immediately in this process; worker refreshes within TTL

    return NextResponse.json({ success: true, count: clean.length });
  } catch (error) {
    logger.error('[PUT] pricing failed', {}, error);
    return NextResponse.json({ error: 'Không thể lưu bảng giá' }, { status: 500 });
  }
}
