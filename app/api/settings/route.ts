// app/api/settings/route.ts
// GET /api/settings → trả tất cả settings (api_key masked)
// PUT /api/settings → update 1 hoặc nhiều settings

import { getAllSettings, setSettings } from '@/lib/settings';
import { maskApiKey } from '@/lib/crypto';
import { Logger } from '@/lib/logger';
import { requireAdmin } from '@/lib/rbac';
import { resetStorageBackend } from '@/lib/storage';

const logger = new Logger({ service: 'settings' });


export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const settings = await getAllSettings();
    // Mask API key trước khi trả về client (S04)
    const masked = { ...settings };
    if (masked.ai_api_key) {
      masked.ai_api_key = maskApiKey(masked.ai_api_key);
    }
    if (masked.openai_api_key) {
      masked.openai_api_key = maskApiKey(masked.openai_api_key);
    }
    if (masked.api_secret_key) {
      masked.api_secret_key = maskApiKey(masked.api_secret_key);
    }
    if (masked.s3_access_key) {
      masked.s3_access_key = maskApiKey(masked.s3_access_key);
    }
    if (masked.s3_secret_key) {
      masked.s3_secret_key = maskApiKey(masked.s3_secret_key);
    }
    return Response.json(masked);
  } catch (error) {
    logger.error('[GET] Failed to fetch settings', {}, error);
    return Response.json({ error: 'Không thể đọc settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const body = await request.json() as Record<string, string>;

    const allowedKeys = new Set([
      'ai_provider',
      'ai_api_key',
      'ai_model',
      'ai_image_prompt',
      'ai_pdf_prompt',
      'ai_docx_prompt',
      'ai_compare_prompt',
      'ai_generate_prompt',
      'openai_api_key',
      'openai_base_url',
      'api_secret_key',
      's3_endpoint',
      's3_bucket',
      's3_access_key',
      's3_secret_key',
      's3_region',
      's3_cache_ttl_hours',
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

    await setSettings(updates);

    // Reset storage backend cache when S3 settings change
    const s3Keys = ['s3_endpoint', 's3_bucket', 's3_access_key', 's3_secret_key', 's3_region'];
    if (s3Keys.some(k => k in updates)) {
      resetStorageBackend();
    }

    return Response.json({ success: true });
  } catch (error) {
    logger.error('[PUT] Failed to update settings', {}, error);
    return Response.json({ error: 'Không thể lưu settings' }, { status: 500 });
  }
}
