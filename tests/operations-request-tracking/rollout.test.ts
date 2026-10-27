import { readFileSync } from 'node:fs';
import {
  BUSINESS_DASHBOARD_ENV,
  BUSINESS_DASHBOARD_SHADOW_ENV,
  BUSINESS_DASHBOARD_SHADOW_SAMPLE_RATE_ENV,
  resolveBusinessOperationsRolloutConfig,
  selectOperationsDashboardVariant,
  shouldRunBusinessOperationsShadowRead,
} from '@/lib/operations/rollout';
import { SETTING_DEFAULTS } from '@/lib/settings';

describe('Business Operations rollout controls', () => {
  it('keeps the business dashboard enabled by safe default with shadow reads off', () => {
    const config = resolveBusinessOperationsRolloutConfig(SETTING_DEFAULTS, {});

    expect(config).toEqual({
      dashboardEnabled: true,
      shadowReadEnabled: false,
      shadowSampleRate: 0.1,
    });
    expect(selectOperationsDashboardVariant(config)).toBe('business');
  });

  it('supports reversible environment overrides over AppSetting values', () => {
    const config = resolveBusinessOperationsRolloutConfig({
      ...SETTING_DEFAULTS,
      ops_business_dashboard_enabled: 'true',
      ops_business_dashboard_shadow_enabled: 'false',
      ops_business_dashboard_shadow_sample_rate: '0.1',
    }, {
      [BUSINESS_DASHBOARD_ENV]: 'false',
      [BUSINESS_DASHBOARD_SHADOW_ENV]: 'true',
      [BUSINESS_DASHBOARD_SHADOW_SAMPLE_RATE_ENV]: '1',
    });

    expect(config).toEqual({
      dashboardEnabled: false,
      shadowReadEnabled: true,
      shadowSampleRate: 1,
    });
    expect(selectOperationsDashboardVariant(config)).toBe('legacy');
  });

  it('uses deterministic bounded sampling and safe fallbacks for invalid values', () => {
    const invalid = resolveBusinessOperationsRolloutConfig(SETTING_DEFAULTS, {
      [BUSINESS_DASHBOARD_ENV]: 'invalid',
      [BUSINESS_DASHBOARD_SHADOW_ENV]: 'invalid',
      [BUSINESS_DASHBOARD_SHADOW_SAMPLE_RATE_ENV]: '2',
    });
    const sampleConfig = { shadowReadEnabled: true, shadowSampleRate: 0.5 };
    const first = shouldRunBusinessOperationsShadowRead(sampleConfig, 'request-1:range=today');

    expect(invalid).toEqual({
      dashboardEnabled: true,
      shadowReadEnabled: false,
      shadowSampleRate: 0.1,
    });
    expect(shouldRunBusinessOperationsShadowRead(sampleConfig, 'request-1:range=today')).toBe(first);
    expect(shouldRunBusinessOperationsShadowRead({
      shadowReadEnabled: false,
      shadowSampleRate: 1,
    }, 'any')).toBe(false);
    expect(shouldRunBusinessOperationsShadowRead({
      shadowReadEnabled: true,
      shadowSampleRate: 0,
    }, 'any')).toBe(false);
    expect(shouldRunBusinessOperationsShadowRead({
      shadowReadEnabled: true,
      shadowSampleRate: 1,
    }, 'any')).toBe(true);
  });

  it('keeps both route implementations wired while the server wrapper selects one', () => {
    const wrapper = readFileSync('app/operations/page.tsx', 'utf8');
    const business = readFileSync('app/operations/BusinessOperationsPage.tsx', 'utf8');
    const legacy = readFileSync('app/operations/LegacyOperationsPage.tsx', 'utf8');

    expect(wrapper).toContain('selectOperationsDashboardVariant');
    expect(wrapper).toContain('<BusinessOperationsPage />');
    expect(wrapper).toContain('<LegacyOperationsPage />');
    expect(business).toContain('useBusinessOperationsDashboard');
    expect(legacy).toContain('useOperationsList');
    expect(legacy).toContain('RequestsTab');
    expect(legacy).toContain('CostBreakdownTab');
  });
});
