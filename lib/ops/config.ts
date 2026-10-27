// lib/ops/config.ts
// Operations-monitoring configuration, backed by the AppSetting key-value table.
// Values are user-editable via the Settings page (ADMIN only). All getters are
// defensive: invalid/missing values fall back to sane defaults.

import { getSetting } from '@/lib/settings';

export interface StuckThresholds {
  runningMin: number;
  pendingMin: number;
}

/** Parse a positive integer with a fallback + upper clamp to avoid absurd values. */
function parsePositiveInt(raw: string, fallback: number, max = 100_000): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/** Thresholds (minutes) for flagging RUNNING/PENDING operations as "stuck". */
export async function getStuckThresholds(): Promise<StuckThresholds> {
  const [running, pending] = await Promise.all([
    getSetting('ops_stuck_running_min'),
    getSetting('ops_stuck_pending_min'),
  ]);
  return {
    runningMin: parsePositiveInt(running, 10),
    pendingMin: parsePositiveInt(pending, 5),
  };
}

/** Maximum date-range span (days) allowed for CSV summary export. */
export async function getExportMaxDays(): Promise<number> {
  const raw = await getSetting('ops_export_max_days');
  return parsePositiveInt(raw, 31, 366);
}
