import { createHash } from 'node:crypto';
import { Logger } from '@/lib/logger';
import { getAllSettings, SETTING_DEFAULTS } from '@/lib/settings';

const logger = new Logger({ service: 'business-operations-rollout' });

export const BUSINESS_DASHBOARD_ENV = 'OPS_BUSINESS_DASHBOARD_ENABLED' as const;
export const BUSINESS_DASHBOARD_SHADOW_ENV = 'OPS_BUSINESS_DASHBOARD_SHADOW_ENABLED' as const;
export const BUSINESS_DASHBOARD_SHADOW_SAMPLE_RATE_ENV =
  'OPS_BUSINESS_DASHBOARD_SHADOW_SAMPLE_RATE' as const;

export interface BusinessOperationsRolloutConfig {
  dashboardEnabled: boolean;
  shadowReadEnabled: boolean;
  shadowSampleRate: number;
}

export type OperationsDashboardVariant = 'business' | 'legacy';

type RolloutEnvironment = Partial<Record<
  | typeof BUSINESS_DASHBOARD_ENV
  | typeof BUSINESS_DASHBOARD_SHADOW_ENV
  | typeof BUSINESS_DASHBOARD_SHADOW_SAMPLE_RATE_ENV,
  string
>>;

/**
 * Resolves AppSetting values with environment overrides for emergency rollout
 * control. Invalid legacy/env values fail back to the documented safe defaults.
 */
export function resolveBusinessOperationsRolloutConfig(
  settings: Readonly<Record<string, string>>,
  environment: RolloutEnvironment = process.env as RolloutEnvironment,
): BusinessOperationsRolloutConfig {
  return {
    dashboardEnabled: parseBooleanFlag(
      environment[BUSINESS_DASHBOARD_ENV] ?? settings.ops_business_dashboard_enabled,
      SETTING_DEFAULTS.ops_business_dashboard_enabled === 'true',
    ),
    shadowReadEnabled: parseBooleanFlag(
      environment[BUSINESS_DASHBOARD_SHADOW_ENV]
        ?? settings.ops_business_dashboard_shadow_enabled,
      SETTING_DEFAULTS.ops_business_dashboard_shadow_enabled === 'true',
    ),
    shadowSampleRate: parseSampleRate(
      environment[BUSINESS_DASHBOARD_SHADOW_SAMPLE_RATE_ENV]
        ?? settings.ops_business_dashboard_shadow_sample_rate,
      Number(SETTING_DEFAULTS.ops_business_dashboard_shadow_sample_rate),
    ),
  };
}

export async function getBusinessOperationsRolloutConfig(): Promise<BusinessOperationsRolloutConfig> {
  try {
    return resolveBusinessOperationsRolloutConfig(await getAllSettings());
  } catch {
    logger.error('Failed to read Operations rollout settings; using safe defaults', {
      dashboardDefaultEnabled: true,
      shadowDefaultEnabled: false,
    });
    return resolveBusinessOperationsRolloutConfig(SETTING_DEFAULTS);
  }
}

export function selectOperationsDashboardVariant(
  config: Pick<BusinessOperationsRolloutConfig, 'dashboardEnabled'>,
): OperationsDashboardVariant {
  return config.dashboardEnabled ? 'business' : 'legacy';
}

/** Deterministic request sampling keeps retries/debugging reproducible. */
export function shouldRunBusinessOperationsShadowRead(
  config: Pick<BusinessOperationsRolloutConfig, 'shadowReadEnabled' | 'shadowSampleRate'>,
  sampleKey: string,
): boolean {
  if (!config.shadowReadEnabled || config.shadowSampleRate <= 0) return false;
  if (config.shadowSampleRate >= 1) return true;

  const digest = createHash('sha256').update(sampleKey, 'utf8').digest();
  const bucket = digest.readUInt32BE(0) / 0x1_0000_0000;
  return bucket < config.shadowSampleRate;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}
