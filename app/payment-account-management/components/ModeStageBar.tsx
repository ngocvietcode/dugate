'use client';

// app/payment-account-management/components/ModeStageBar.tsx
// Mode tabs (open + update enabled; close/freeze shown as "sắp có") + stage toggle.

import React from 'react';
import type { PamMode, PamStage } from '../types';

interface ModeStageBarProps {
  mode: PamMode;
  stage: PamStage;
  onModeChange: (mode: PamMode) => void;
  onStageChange: (stage: PamStage) => void;
  disabled: boolean;
}

const MODES: Array<{ value: PamMode; label: string; enabled: boolean }> = [
  { value: 'open', label: 'Mở tài khoản', enabled: true },
  { value: 'update', label: 'Cập nhật tài khoản', enabled: true },
  { value: 'close', label: 'Đóng tài khoản', enabled: false },
  { value: 'freeze', label: 'Phong tỏa', enabled: false },
];

const STAGES: Array<{ value: PamStage; label: string; hint: string }> = [
  { value: 'e2e', label: 'E2E', hint: 'Phân loại + Trích xuất' },
  { value: 'classification', label: 'Chỉ phân loại', hint: 'Dừng sau khi nhận diện loại tài liệu' },
  { value: 'extraction', label: 'Phân loại + Trích xuất', hint: 'Trích xuất trường sau khi phân loại' },
];

export function ModeStageBar({ mode, stage, onModeChange, onStageChange, disabled }: ModeStageBarProps) {
  return (
    <div className="modern-card p-4 space-y-4">
      {/* Mode tabs */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Nghiệp vụ
        </p>
        <div className="flex flex-wrap gap-2">
          {MODES.map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => m.enabled && onModeChange(m.value)}
              disabled={!m.enabled || disabled}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                mode === m.value && m.enabled
                  ? 'bg-primary text-primary-foreground border-primary'
                  : m.enabled
                  ? 'border-border hover:border-primary/40'
                  : 'border-dashed border-border/50 text-muted-foreground/60 cursor-not-allowed'
              } disabled:opacity-60`}
            >
              {m.label}
              {!m.enabled && <span className="ml-1.5 text-[9px] uppercase">sắp có</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Stage toggle */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Giai đoạn (stage)
        </p>
        <div className="flex flex-wrap gap-2">
          {STAGES.map(s => (
            <button
              key={s.value}
              onClick={() => onStageChange(s.value)}
              disabled={disabled}
              title={s.hint}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                stage === s.value
                  ? 'bg-primary/10 text-primary border-primary/40'
                  : 'border-border hover:border-primary/30'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          {STAGES.find(s => s.value === stage)?.hint}
        </p>
      </div>
    </div>
  );
}
