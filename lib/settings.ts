// lib/settings.ts
// Read/write AppSetting from DB. Used by system configuration.

import { db } from './db';
import { appSettings } from './db/schema';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from './crypto';
import { Logger } from './logger';

const logger = new Logger({ service: 'settings' });

export const DEFAULT_OPS_CALENDAR_TIMEZONE = 'Asia/Ho_Chi_Minh';

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const SETTING_DEFAULTS: Record<string, string> = {
  // S3-compatible storage
  s3_endpoint: '',
  s3_bucket: '',
  s3_access_key: '',
  s3_secret_key: '',
  s3_region: 'us-east-1',
  s3_cache_ttl_hours: '168', // 7 days
  // Home mode: 'showcase' (marketing page, AI Skill Hub branding) | 'developer' (technical API reference, RPA.Doc branding)
  home_mode: 'showcase',
  // ─── Operations monitoring ─────────────────────────────────
  // Stuck-request detection thresholds (minutes). A RUNNING/PENDING op with no
  // DB write (updatedAt) older than these is flagged as "nghi treo" on the dashboard.
  ops_stuck_running_min: '10',
  ops_stuck_pending_min: '5',
  // Server-authoritative timezone for Operations calendar windows and trend buckets.
  ops_calendar_timezone: DEFAULT_OPS_CALENDAR_TIMEZONE,
  // Controlled rollout for the Business Operations dashboard. The new dashboard
  // remains the safe default while this switch provides an immediate rollback.
  ops_business_dashboard_enabled: 'true',
  // Optional sampled reconciliation. Shadow results are never returned to clients.
  ops_business_dashboard_shadow_enabled: 'false',
  ops_business_dashboard_shadow_sample_rate: '0.1',
  // Max span (days) allowed for CSV summary export — guards DB/memory.
  ops_export_max_days: '31',
  // AIHub model pricing table (JSON array of {model, inputPer1M, outputPer1M}, USD per 1M tokens).
  // Editable on the Settings page. Empty '' → lib/pricing.ts seeds from MODEL_PRICING.
  model_pricing_json: '',
};

const ENCRYPTED_KEYS = new Set(['s3_access_key', 's3_secret_key']);
const BOOLEAN_SETTING_KEYS = new Set([
  'ops_business_dashboard_enabled',
  'ops_business_dashboard_shadow_enabled',
]);

/** True when Intl can resolve the value as an IANA timezone identifier. */
export function isValidIanaTimezone(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return true;
  } catch {
    return false;
  }
}

function validateSettingValue(key: string, value: string): string {
  const candidate = value.trim();

  if (BOOLEAN_SETTING_KEYS.has(key)) {
    if (!['true', 'false'].includes(candidate.toLowerCase())) {
      throw new RangeError(`${key} must be true or false`);
    }
    return candidate.toLowerCase();
  }

  if (key === 'ops_business_dashboard_shadow_sample_rate') {
    const rate = Number(candidate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new RangeError('ops_business_dashboard_shadow_sample_rate must be between 0 and 1');
    }
    return String(rate);
  }

  if (key !== 'ops_calendar_timezone') return value;

  if (!isValidIanaTimezone(candidate)) {
    throw new RangeError('ops_calendar_timezone must be a valid IANA timezone');
  }
  return candidate;
}

function resolveRuntimeSetting(key: string, value: string): string {
  if (key !== 'ops_calendar_timezone' || isValidIanaTimezone(value)) return value;

  logger.error('Invalid Operations calendar timezone; using safe default', {
    settingKey: key,
    fallbackTimezone: DEFAULT_OPS_CALENDAR_TIMEZONE,
  });
  return DEFAULT_OPS_CALENDAR_TIMEZONE;
}

// ─── Read ──────────────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (!row) return SETTING_DEFAULTS[key] ?? '';

  let value = row.value;
  if (ENCRYPTED_KEYS.has(key) && value) {
    try {
      value = decrypt(value);
    } catch {
      value = '';
    }
  }
  return resolveRuntimeSetting(key, value);
}

/** Calendar timezone actually used by Operations queries, always valid. */
export async function getOpsCalendarTimezone(): Promise<string> {
  return getSetting('ops_calendar_timezone');
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(appSettings);
  const result: Record<string, string> = { ...SETTING_DEFAULTS };

  for (const row of rows) {
    if (ENCRYPTED_KEYS.has(row.key) && row.value) {
      try {
        result[row.key] = decrypt(row.value);
      } catch {
        result[row.key] = '';
      }
    } else {
      result[row.key] = row.value;
    }
  }
  result.ops_calendar_timezone = resolveRuntimeSetting(
    'ops_calendar_timezone',
    result.ops_calendar_timezone,
  );
  return result;
}

// ─── Write ─────────────────────────────────────────────────────────────────────

export async function setSetting(key: string, value: string): Promise<void> {
  const validated = validateSettingValue(key, value);
  const stored = ENCRYPTED_KEYS.has(key) && validated ? encrypt(validated) : validated;
  await db.insert(appSettings).values({ key, value: stored }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: stored },
  });
}

export async function setSettings(updates: Record<string, string>): Promise<void> {
  // Validate the entire batch before starting writes so an invalid timezone cannot
  // leave unrelated settings partially persisted.
  const validatedUpdates = Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [key, validateSettingValue(key, value)]),
  );
  await Promise.all(
    Object.entries(validatedUpdates).map(([key, value]) => setSetting(key, value))
  );
}
