// app/operations/lib/timeRange.ts
// Shared time-range presets that drive BOTH the stats cards and the table,
// so the numbers always match. "Tất cả" uses a far-past sentinel start date
// because the /stats API defaults to "today" when no start_date is provided.

export type TimePreset = 'today' | '3d' | '7d' | '30d' | 'all' | 'custom';

export const DEFAULT_TIME_PRESET: TimePreset = '7d';

/** Far-past sentinel — makes /stats cover "all time" without a backend change */
export const FAR_PAST = '2000-01-01T00:00';

export const TIME_PRESETS: { key: Exclude<TimePreset, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: '3d', label: '3 ngày' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: 'all', label: 'Tất cả' },
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date → "YYYY-MM-DDTHH:mm" in LOCAL time (minute precision = stable within a minute) */
export function toLocalISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Convert a browser-local datetime value to an explicit UTC instant for APIs. */
export function toApiDate(value: string): string {
  if (!value) return '';
  if (value === FAR_PAST) return '2000-01-01T00:00:00.000Z';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** Compute concrete { startDate, endDate } for a preset. endDate = '' means "up to now". */
export function presetRange(preset: Exclude<TimePreset, 'custom'>): { startDate: string; endDate: string } {
  const now = new Date();
  switch (preset) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { startDate: toLocalISO(start), endDate: '' };
    }
    case '3d':
      return { startDate: toLocalISO(new Date(now.getTime() - 3 * 86_400_000)), endDate: '' };
    case '7d':
      return { startDate: toLocalISO(new Date(now.getTime() - 7 * 86_400_000)), endDate: '' };
    case '30d':
      return { startDate: toLocalISO(new Date(now.getTime() - 30 * 86_400_000)), endDate: '' };
    case 'all':
      return { startDate: FAR_PAST, endDate: '' };
  }
}

/** Human-readable label for the current time selection. */
export function timeRangeLabel(preset: TimePreset, startDate: string, endDate: string): string {
  if (preset === 'all') return 'Tất cả thời gian';
  if (preset === 'custom') {
    const fmt = (d: string) => (d ? d.replace('T', ' ').slice(0, 16) : '...');
    return `${fmt(startDate)} → ${endDate ? fmt(endDate) : 'Hiện tại'}`;
  }
  const found = TIME_PRESETS.find((p) => p.key === preset);
  return found ? found.label : '7 ngày';
}
