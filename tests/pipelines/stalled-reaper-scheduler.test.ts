const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const recoverStalledOperations = jest.fn();

jest.mock('@/lib/logger', () => ({
  Logger: jest.fn(() => logger),
}));
jest.mock('@/lib/stalled-reaper', () => ({
  RUNNING_STALL_MS: 9_000_000,
  recoverStalledOperations: (...args: unknown[]) => recoverStalledOperations(...args),
}));

import { ensureStalledReaperScheduled } from '@/lib/stalled-reaper-scheduler';

describe('stalled reaper scheduler — Round 14.5 P6', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('logs its startup heartbeat when scheduling the five-minute reaper', () => {
    ensureStalledReaperScheduled();

    expect(logger.info).toHaveBeenCalledWith('[Scheduled] Stalled-operation reaper started — interval 5 min');
  });
});
