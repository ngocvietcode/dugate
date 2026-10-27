import { NextResponse } from 'next/server';
// app/api/settings/route.ts
// GET /api/settings → trả tất cả settings (api_key masked)
// PUT /api/settings → update 1 hoặc nhiều settings

import { getAllSettings, setSettings } from '@/lib/settings';
import { maskApiKey } from '@/lib/crypto';
import { Logger } from '@/lib/logger';
import { requireCapability } from '@/lib/auth-guard';
import { resetStorageBackend } from '@/lib/storage';

const logger = new Logger({ service: 'settings' });

// [SEC 18/09 P1.1] Keys whose value GET only ever returns masked, so PUT must never
// take the mask at face value and write it back over the real secret.
const MASKED_SECRET_KEYS = ['s3_access_key', 's3_secret_key'] as const;

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireCapability('settings:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const settings = await getAllSettings();
    // Mask sensitive keys before returning to client
    const masked = { ...settings };
    for (const key of MASKED_SECRET_KEYS) {
      if (masked[key]) masked[key] = maskApiKey(masked[key]);
    }
    return Response.json(masked);
  } catch (error) {
    logger.error('[GET] Failed to fetch settings', {}, error);
    return Response.json({ error: 'Không thể đọc settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const guard = await requireCapability('settings:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await request.json() as Record<string, string>;

    const allowedKeys = new Set([
      's3_endpoint',
      's3_bucket',
      's3_access_key',
      's3_secret_key',
      's3_region',
      's3_cache_ttl_hours',
      'home_mode',
      'ops_stuck_running_min',
      'ops_stuck_pending_min',
      'ops_calendar_timezone',
      'ops_business_dashboard_enabled',
      'ops_business_dashboard_shadow_enabled',
      'ops_business_dashboard_shadow_sample_rate',
      'ops_export_max_days',
      // NOTE: model_pricing_json is intentionally NOT here — it is saved only via
      // /api/settings/pricing which validates each row (model non-empty/unique, price ≥ 0).
    ]);

    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowedKeys.has(key) && typeof value === 'string') {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'Không có field hợp lệ để update' }, { status: 400 });
    }

    // [SEC 18/09 P1.1] Server-side mask guard. GET hands the client maskApiKey() of
    // each secret, so a client that saves a form it never edited posts the mask back.
    // Compare against the mask of the value *currently stored*, never against '' —
    // matching on empty would make it impossible to clear a secret on purpose.
    // Three outcomes: a fresh value is written, the current value's mask keeps the
    // stored secret, and an empty string still clears it.
    const ignoredMaskedKeys: string[] = [];
    const newMasks: Record<string, string> = {};
    if (MASKED_SECRET_KEYS.some(k => k in updates)) {
      const current = await getAllSettings();
      for (const key of MASKED_SECRET_KEYS) {
        if (!(key in updates)) continue;
        const stored = current[key] ?? '';
        if (stored && updates[key] === maskApiKey(stored)) {
          delete updates[key];
          ignoredMaskedKeys.push(key);
          newMasks[key] = maskApiKey(stored);
        } else {
          newMasks[key] = updates[key] ? maskApiKey(updates[key]) : '';
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await setSettings(updates);
    }

    // Reset storage backend cache when S3 settings change
    const s3Keys = ['s3_endpoint', 's3_bucket', 's3_access_key', 's3_secret_key', 's3_region'];
    if (s3Keys.some(k => k in updates)) {
      resetStorageBackend();
    }

    return Response.json({ success: true, ignoredMaskedKeys, masked: newMasks });
  } catch (error) {
    if (error instanceof RangeError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    logger.error('[PUT] Failed to update settings', {}, error);
    return Response.json({ error: 'Không thể lưu settings' }, { status: 500 });
  }
}
