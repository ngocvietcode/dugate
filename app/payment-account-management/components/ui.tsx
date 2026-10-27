'use client';

// app/payment-account-management/components/ui.tsx
// Shared visual primitives for the PAM result view.
//
// These existed three times over — VALIDATION_TONE was declared in both
// FieldRenderer and ValidationSummary with matching colors but different sizes,
// and the panel's counts row hand-rolled a third variant. Six ad-hoc font sizes
// (9/10/11/12/14px) were scattered across four files with no rule for which to
// use where. One definition each, so a status always looks the same wherever it
// appears and the hierarchy is decided once.

import React from 'react';
import type { FieldValidationEntry } from '../types';

// ─── Type scale ─────────────────────────────────────────────────────────────

/**
 * Four steps, by ROLE rather than by size, so the choice at each call site is
 * "what is this?" instead of "which px looked right?".
 *
 *   body  12px — field values, row labels: the content being read
 *   meta  11px — supporting text: bank comparisons, reasons, list items
 *   micro 10px — badges, chips, counts
 *   nano   9px — dense annotations: paths, confidence percentages
 *
 * Sizes are unchanged from what shipped; the scale just names them and removes
 * the arbitrary picks between them.
 */
export const T = {
  body: 'text-xs',
  meta: 'text-[11px]',
  micro: 'text-[10px]',
  nano: 'text-[9px]',
} as const;

/** Uppercase section eyebrow — one definition, was repeated in four files. */
export const EYEBROW =
  'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

// ─── Status vocabulary ──────────────────────────────────────────────────────

/**
 * Every status a reconciliation row can carry. `missing` is UI-only — it marks a
 * bank record the verifier never produced an entry for (see
 * findUnmatchedBankPeople), which is not one of the LLM's three statuses.
 */
export type RowStatus = FieldValidationEntry['status'] | 'missing';

interface StatusTone {
  /** Text + background pair. Semantic color, deliberately not the blue accent. */
  chip: string;
  icon: string;
  label: string;
}

/**
 * The single source of truth for how a status looks and what it is called.
 * Ordered by how much attention it wants, which is also the panel's sort order.
 */
export const STATUS: Record<RowStatus, StatusTone> = {
  fail: { chip: 'text-red-600 bg-red-500/10', icon: '✗', label: 'Lệch' },
  missing: { chip: 'text-orange-600 bg-orange-500/10', icon: '?', label: 'Không đối chiếu' },
  skip: { chip: 'text-muted-foreground bg-muted', icon: '⊘', label: 'Bỏ qua' },
  pass: { chip: 'text-emerald-600 bg-emerald-500/10', icon: '✓', label: 'Khớp' },
};

// ─── Badge ──────────────────────────────────────────────────────────────────

const BADGE_BASE = 'shrink-0 inline-flex items-center gap-1 font-semibold rounded px-1.5 py-0.5';

/**
 * One badge for every pill in this view: status chips, confidence scores, counts,
 * fail markers. `size` picks a step off the type scale; `tone` is the color pair.
 */
export function Badge({
  tone,
  size = 'micro',
  title,
  children,
}: {
  tone: string;
  size?: keyof typeof T;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`${BADGE_BASE} ${T[size]} ${tone}`} title={title}>
      {children}
    </span>
  );
}

/**
 * A status badge: icon + Vietnamese label, colored per STATUS. `compact` drops
 * the label where the surrounding text already says what the field is (inline on
 * a leaf, or on a collapsed container header).
 */
export function StatusBadge({
  status,
  size = 'micro',
  compact = false,
  title,
}: {
  status: RowStatus;
  size?: keyof typeof T;
  compact?: boolean;
  title?: string;
}) {
  const tone = STATUS[status] ?? STATUS.skip;
  return (
    <Badge tone={tone.chip} size={size} title={title ?? tone.label}>
      <span aria-hidden="true">{tone.icon}</span>
      {!compact && <span>{tone.label}</span>}
    </Badge>
  );
}

/**
 * Confidence bucket boundaries, shared so a score can't read green on one badge
 * and amber on another (DocumentCard used 0.8/0.5 against this file's 0.85/0.6).
 * CONFIDENCE_MID also matches the "chỉ hiện < 60%" review filter, so what the
 * badge calls amber-or-red is exactly what that filter surfaces.
 */
export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_MID = 0.6;

/**
 * Confidence score badge. Uses the same emerald/amber/red family as STATUS so the
 * two badge kinds read as one system — this previously used `green-600` while
 * statuses used `emerald-600`.
 */
export function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const tone =
    score >= CONFIDENCE_HIGH
      ? 'text-emerald-600 bg-emerald-500/10'
      : score >= CONFIDENCE_MID
        ? 'text-amber-600 bg-amber-500/10'
        : 'text-red-600 bg-red-500/10';
  return (
    <Badge tone={tone} size="nano" title={`Độ tin cậy: ${pct}%`}>
      <span className="tabular-nums">{pct}%</span>
    </Badge>
  );
}

/**
 * Marker on a collapsed container header when something beneath it failed
 * reconciliation, so a mismatch is visible without expanding every section.
 */
export function FailMarker() {
  return (
    <Badge
      tone={STATUS.fail.chip}
      size="nano"
      title="Có trường lệch so với dữ liệu core bank"
    >
      <span aria-hidden="true">{STATUS.fail.icon}</span> lệch
    </Badge>
  );
}

// ─── Bank ↔ MB03 comparison ─────────────────────────────────────────────────

/**
 * The bank-vs-document value pair, rendered identically wherever it appears —
 * inline under a field and as a summary row both used to build this by hand, with
 * different separators and label styles.
 *
 * Omitting `docValue` renders the bank side alone, for a bank record that has no
 * document counterpart to compare against.
 */
export function ComparePair({
  bankValue,
  docValue,
  showDoc = true,
}: {
  bankValue: string | null;
  docValue?: string;
  showDoc?: boolean;
}) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 flex-wrap ${T.meta} text-muted-foreground`}>
      <span>
        bank: <span className="text-foreground/85 font-medium">{bankValue ?? '—'}</span>
      </span>
      {showDoc && (
        <>
          <span className="text-muted-foreground/50" aria-hidden="true">→</span>
          <span>
            MB03: <span className="text-foreground/85 font-medium">{docValue ?? '—'}</span>
          </span>
        </>
      )}
    </span>
  );
}
