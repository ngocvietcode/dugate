const mockLimit = jest.fn();
const mockValues = jest.fn();
const mockOnConflictDoUpdate = jest.fn();
const mockInsert = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ limit: mockLimit })),
      })),
    })),
    insert: mockInsert,
  },
}));

jest.mock('@/lib/db/schema', () => ({
  appSettings: { key: 'AppSetting.key' },
}));

jest.mock('drizzle-orm', () => ({
  eq: jest.fn((column: unknown, value: unknown) => ({ column, value })),
}));

jest.mock('@/lib/crypto', () => ({
  encrypt: jest.fn((value: string) => `encrypted:${value}`),
  decrypt: jest.fn((value: string) => value.replace(/^encrypted:/, '')),
}));

jest.mock('@/lib/logger', () => ({
  Logger: jest.fn(() => ({ error: mockLoggerError })),
}));

import {
  DEFAULT_OPS_CALENDAR_TIMEZONE,
  SETTING_DEFAULTS,
  getOpsCalendarTimezone,
  isValidIanaTimezone,
  setSetting,
  setSettings,
} from '@/lib/settings';

describe('Operations calendar timezone setting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLimit.mockResolvedValue([]);
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockInsert.mockReturnValue({ values: mockValues });
  });

  it('defines the server-authoritative default timezone', async () => {
    expect(DEFAULT_OPS_CALENDAR_TIMEZONE).toBe('Asia/Ho_Chi_Minh');
    expect(SETTING_DEFAULTS.ops_calendar_timezone).toBe(DEFAULT_OPS_CALENDAR_TIMEZONE);
    expect(SETTING_DEFAULTS).toMatchObject({
      ops_business_dashboard_enabled: 'true',
      ops_business_dashboard_shadow_enabled: 'false',
      ops_business_dashboard_shadow_sample_rate: '0.1',
    });
    await expect(getOpsCalendarTimezone()).resolves.toBe(DEFAULT_OPS_CALENDAR_TIMEZONE);
  });

  it('normalizes valid rollout controls and rejects invalid flag writes', async () => {
    await setSettings({
      ops_business_dashboard_enabled: ' TRUE ',
      ops_business_dashboard_shadow_enabled: 'false',
      ops_business_dashboard_shadow_sample_rate: '0.25',
    });

    expect(mockValues).toHaveBeenCalledWith({
      key: 'ops_business_dashboard_enabled',
      value: 'true',
    });
    expect(mockValues).toHaveBeenCalledWith({
      key: 'ops_business_dashboard_shadow_enabled',
      value: 'false',
    });
    expect(mockValues).toHaveBeenCalledWith({
      key: 'ops_business_dashboard_shadow_sample_rate',
      value: '0.25',
    });

    jest.clearAllMocks();
    await expect(setSetting('ops_business_dashboard_enabled', 'maybe')).rejects.toThrow(
      'ops_business_dashboard_enabled must be true or false',
    );
    await expect(setSetting('ops_business_dashboard_shadow_sample_rate', '1.1')).rejects.toThrow(
      'ops_business_dashboard_shadow_sample_rate must be between 0 and 1',
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('accepts valid IANA zones and rejects blank or unknown zones', () => {
    expect(isValidIanaTimezone('UTC')).toBe(true);
    expect(isValidIanaTimezone('America/New_York')).toBe(true);
    expect(isValidIanaTimezone('  Asia/Ho_Chi_Minh  ')).toBe(true);
    expect(isValidIanaTimezone('')).toBe(false);
    expect(isValidIanaTimezone('Mars/Olympus_Mons')).toBe(false);
  });

  it('falls back and logs when a legacy runtime value is invalid', async () => {
    mockLimit.mockResolvedValue([{ value: 'Not/A_Timezone' }]);

    await expect(getOpsCalendarTimezone()).resolves.toBe(DEFAULT_OPS_CALENDAR_TIMEZONE);
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Invalid Operations calendar timezone; using safe default',
      {
        settingKey: 'ops_calendar_timezone',
        fallbackTimezone: DEFAULT_OPS_CALENDAR_TIMEZONE,
      },
    );
  });

  it('normalizes and persists a valid timezone', async () => {
    await setSetting('ops_calendar_timezone', '  Europe/Paris  ');

    expect(mockValues).toHaveBeenCalledWith({
      key: 'ops_calendar_timezone',
      value: 'Europe/Paris',
    });
  });

  it('rejects invalid timezone writes before any database mutation', async () => {
    await expect(setSetting('ops_calendar_timezone', 'invalid-zone')).rejects.toThrow(
      'ops_calendar_timezone must be a valid IANA timezone',
    );
    expect(mockInsert).not.toHaveBeenCalled();

    await expect(setSettings({ home_mode: 'developer', ops_calendar_timezone: '' })).rejects.toThrow(
      'ops_calendar_timezone must be a valid IANA timezone',
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
