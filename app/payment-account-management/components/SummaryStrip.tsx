'use client';

// app/payment-account-management/components/SummaryStrip.tsx
// Counts across all document cards + overall decision from the envelope status.

import React from 'react';
import type { DocCard } from '../types';
import { EYEBROW } from './ui';

interface SummaryStripProps {
  cards: DocCard[];
  /** Envelope-level status from the runner: SUCCESS / REVIEW_REQUIRED / FAILED. */
  envelopeStatus?: string;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex flex-col items-center px-3">
      <span className={`text-xl font-bold tabular-nums ${tone ?? ''}`}>{value}</span>
      <span className={`${EYEBROW} whitespace-nowrap`}>{label}</span>
    </div>
  );
}

export function SummaryStrip({ cards, envelopeStatus }: SummaryStripProps) {
  const total = cards.length;
  const classified = cards.filter(c => c.classification && c.classification.code !== 'unknown').length;
  const extracted = cards.filter(c => c.extracted && Object.keys(c.extracted).length > 0).length;
  const unknown = cards.filter(c => !c.classification || c.classification.code === 'unknown').length;

  // Split mode: cards carry `source`. Count the distinct parent scan files the
  // documents were split out of, so "3 tài liệu / from 2 files" reads clearly.
  const isSplit = cards.some(c => c.source);
  const parentFiles = isSplit
    ? new Set(cards.filter(c => c.source).map(c => c.source!.file_id)).size
    : 0;

  // Reconciliation rollup (mode=update): total mismatches across every document,
  // so a multi-doc run doesn't require opening each card to find the problem.
  const validated = cards.filter(c => c.validation && !c.validation.error);
  const totalFail = validated.reduce((n, c) => n + c.validation!.summary.fail, 0);
  const hasValidation = validated.length > 0;

  const decision = envelopeStatus ?? '—';
  const decisionTone =
    decision === 'SUCCESS'
      ? 'text-emerald-600 bg-emerald-500/10'
      : decision === 'REVIEW_REQUIRED'
      ? 'text-amber-600 bg-amber-500/10'
      : decision === 'FAILED'
      ? 'text-red-600 bg-red-500/10'
      : 'text-muted-foreground bg-muted';

  return (
    <div className="modern-card p-4 flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center divide-x divide-border">
        <Stat label="Tài liệu" value={total} />
        {isSplit && <Stat label="Từ số file" value={parentFiles} tone="text-muted-foreground" />}
        <Stat label="Đã nhận diện" value={classified} tone="text-emerald-600" />
        <Stat label="Đã trích xuất" value={extracted} tone="text-primary" />
        <Stat label="Chưa nhận diện" value={unknown} tone={unknown > 0 ? 'text-amber-600' : ''} />
        {hasValidation && (
          <Stat label="Trường lệch" value={totalFail} tone={totalFail > 0 ? 'text-red-600' : 'text-emerald-600'} />
        )}
      </div>
      <span className={`text-sm font-bold px-3 py-1.5 rounded-lg ${decisionTone}`}>
        {decision}
      </span>
    </div>
  );
}
