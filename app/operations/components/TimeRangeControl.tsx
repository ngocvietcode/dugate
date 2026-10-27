'use client';

import { useState } from 'react';
import { CalendarRange, Check } from 'lucide-react';
import {
  BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS,
  type BusinessOperationsTimeRange,
} from '../types';
import { TIME_PRESETS, toLocalISO, type TimePreset } from '../lib/timeRange';
import { formatBusinessOperationsTimezoneLabel } from '../lib/business-filters';

export interface BusinessOperationsTimeRangeControlProps {
  draftRange: BusinessOperationsTimeRange;
  appliedRange: BusinessOperationsTimeRange;
  calendarTimezone: string;
  onDraftRangeChange: (range: BusinessOperationsTimeRange) => void;
  disabled?: boolean;
}

/**
 * Server-calendar presets for the Business Operations dashboard. This control
 * edits draft state only; the caller applies it after server validation.
 */
export function BusinessOperationsTimeRangeControl({
  draftRange,
  appliedRange,
  calendarTimezone,
  onDraftRangeChange,
  disabled = false,
}: BusinessOperationsTimeRangeControlProps) {
  const timezoneLabel = formatBusinessOperationsTimezoneLabel(calendarTimezone);

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="sr-only">Khoảng thời gian nghiệp vụ</legend>
      <div
        className="inline-flex flex-wrap items-center rounded-lg border border-border bg-card p-0.5 text-xs"
        aria-label="Khoảng thời gian theo lịch máy chủ"
      >
        {BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS.map((option) => {
          const selected = draftRange === option.value;
          const applied = appliedRange === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onDraftRangeChange(option.value)}
              className={`px-2.5 h-7 rounded-md font-medium transition-all whitespace-nowrap ${
                selected
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              aria-pressed={selected}
              data-applied={applied ? 'true' : 'false'}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground" aria-label={`Múi giờ máy chủ: ${calendarTimezone}`}>
        {timezoneLabel.slice(0, -calendarTimezone.length)}<span className="font-medium text-foreground">{calendarTimezone}</span>
      </p>
    </fieldset>
  );
}

interface TimeRangeControlProps {
  preset: TimePreset;
  startDate: string;
  endDate: string;
  onSelectPreset: (preset: Exclude<TimePreset, 'custom'>) => void;
  onApplyCustom: (startDate: string, endDate: string) => void;
}

export default function TimeRangeControl({
  preset, startDate, endDate, onSelectPreset, onApplyCustom,
}: TimeRangeControlProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);

  const openCustom = () => {
    setDraftStart(startDate || '');
    setDraftEnd(endDate || '');
    setCustomOpen(true);
  };

  // "Đến" phải sau "Từ" (nếu có nhập). Chặn ngay tại UI để tránh query trả rỗng khó hiểu.
  const rangeInvalid = !!draftStart && !!draftEnd && new Date(draftEnd) < new Date(draftStart);

  const applyCustom = () => {
    if (!draftStart || rangeInvalid) return;
    onApplyCustom(draftStart, draftEnd);
    setCustomOpen(false);
  };

  return (
    <div className="relative">
      {/* Segmented control */}
      <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-xs">
        {TIME_PRESETS.map((p) => {
          const active = preset === p.key;
          return (
            <button
              key={p.key}
              onClick={() => onSelectPreset(p.key)}
              className={`
                px-2.5 h-7 rounded-md font-medium transition-all whitespace-nowrap
                ${active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }
              `}
              aria-pressed={active}
            >
              {p.label}
            </button>
          );
        })}

        {/* Custom */}
        <button
          onClick={openCustom}
          className={`
            inline-flex items-center gap-1 px-2.5 h-7 rounded-md font-medium transition-all
            ${preset === 'custom'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }
          `}
          aria-pressed={preset === 'custom'}
        >
          <CalendarRange className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Tùy chỉnh</span>
        </button>
      </div>

      {/* Custom range popover */}
      {customOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCustomOpen(false)} />
          <div className="absolute top-full right-0 mt-2 z-50 w-[300px] rounded-xl border border-border bg-card shadow-lg p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground">Khoảng thời gian tùy chỉnh</p>

            {/* From */}
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Từ</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  className="flex-1 h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={draftStart ? draftStart.split('T')[0] : ''}
                  onChange={(e) => {
                    const time = draftStart?.split('T')[1] || '00:00';
                    setDraftStart(e.target.value ? `${e.target.value}T${time}` : '');
                  }}
                />
                <input
                  type="time"
                  className="w-24 h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={draftStart ? draftStart.split('T')[1] || '00:00' : '00:00'}
                  onChange={(e) => {
                    const date = draftStart?.split('T')[0] || toLocalISO(new Date()).split('T')[0];
                    setDraftStart(`${date}T${e.target.value}`);
                  }}
                />
              </div>
            </div>

            {/* To */}
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Đến (để trống = hiện tại)</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  className="flex-1 h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={draftEnd ? draftEnd.split('T')[0] : ''}
                  onChange={(e) => {
                    const time = draftEnd?.split('T')[1] || '23:59';
                    setDraftEnd(e.target.value ? `${e.target.value}T${time}` : '');
                  }}
                />
                <input
                  type="time"
                  className="w-24 h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={draftEnd ? draftEnd.split('T')[1] || '23:59' : ''}
                  onChange={(e) => {
                    const date = draftEnd?.split('T')[0] || toLocalISO(new Date()).split('T')[0];
                    setDraftEnd(`${date}T${e.target.value}`);
                  }}
                />
              </div>
            </div>

            {rangeInvalid && (
              <p className="text-[11px] text-red-600 dark:text-red-400">
                "Đến" phải sau "Từ". Vui lòng chọn lại.
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setCustomOpen(false)}
                className="px-3 h-8 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={applyCustom}
                disabled={!draftStart || rangeInvalid}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Áp dụng
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
