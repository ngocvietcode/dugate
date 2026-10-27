'use client';

// app/payment-account-management/components/DocumentCard.tsx
// One document's card: classification (code + filled title + confidence),
// extracted fields, and validation verdict. Stage-aware — the parent only fills
// the parts a given stage produced.

import React, { useState } from 'react';
import type { BankData, DocCard } from '../types';
import { ExtractedFields } from './ExtractedFields';
import { ValidationSummary } from './ValidationSummary';
import { T, Badge, CONFIDENCE_HIGH, CONFIDENCE_MID } from './ui';

interface DocumentCardProps {
  card: DocCard;
  /**
   * The core-bank payload the backend echoed back (result.bank_data). Used by the
   * reconciliation panel to spot bank people that produced no check at all.
   */
  bankData?: BankData | null;
}

/**
 * Confidence colors for the classification score, on the SAME thresholds as
 * ConfidenceBadge (this used 0.8/0.5 while the badge used 0.85/0.6, so the same
 * score could read green here and amber two lines below).
 */
function confidenceStyle(score: number): { bar: string; text: string } {
  if (score >= CONFIDENCE_HIGH) return { bar: 'bg-emerald-500', text: 'text-emerald-600' };
  if (score >= CONFIDENCE_MID) return { bar: 'bg-amber-500', text: 'text-amber-600' };
  return { bar: 'bg-red-500', text: 'text-red-600' };
}

// Compact page-list label: contiguous runs collapse to "1-3"; gaps stay separate.
// [1,2,3] → "p.1-3" · [4,6] → "p.4,6" · [1,2,4,5] → "p.1-2,4-5".
function formatPages(pages: number[]): string {
  if (pages.length === 0) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) { prev = cur; continue; }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return `p.${runs.join(',')}`;
}

function StatusDot({ card }: { card: DocCard }) {
  if (card.status === 'processing') {
    return <span className="w-4 h-4 inline-block rounded-full border-2 border-primary/30 border-t-primary animate-spin" />;
  }
  if (card.status === 'error') return <span className="text-red-500">⚠</span>;
  if (card.status === 'pending') return <span className="text-muted-foreground">○</span>;
  return <span className="text-emerald-500">✓</span>;
}

export function DocumentCard({ card, bankData }: DocumentCardProps) {
  const [expanded, setExpanded] = useState(false);

  const cls = card.classification;
  const isUnknown = !cls || cls.code === 'unknown';
  const conf = cls ? confidenceStyle(cls.confidence) : null;
  const pct = cls ? Math.round(cls.confidence * 100) : 0;

  const hasFields = card.extracted && Object.keys(card.extracted).length > 0;
  // Per-field results live inside `extracted` (attached by the runner to the
  // leaves they apply to); ValidationSummary walks that tree and renders them as
  // named rows, keyed off each entry's stable `code`.
  const val = card.validation;

  return (
    /* One `gap` owns the vertical rhythm. The card previously mixed per-element
       bottom margins with gaps, so blocks sat at different distances depending
       on which optional pieces happened to render. */
    <div
      className={`modern-card p-4 flex flex-col gap-2 transition-all ${
        card.status === 'error' ? 'ring-1 ring-red-400/40' : ''
      } ${card.status === 'processing' ? 'ring-1 ring-primary/30' : ''}`}
    >
      {/* Header: filename + status */}
      <div className="flex items-center gap-2.5">
        <span className="text-xl flex-shrink-0">{card.fileIcon}</span>
        <p className="text-sm font-semibold truncate flex-1" title={card.fileName}>
          {card.fileName}
        </p>
        <StatusDot card={card} />
      </div>

      {/* Split provenance: which pages of which parent scan this segment came from */}
      {card.source && (
        <div className={`flex items-center gap-1.5 ${T.micro} text-muted-foreground`}>
          <span className="font-semibold px-1.5 py-0.5 rounded bg-muted">
            {formatPages(card.source.pages)}
          </span>
          <span className="truncate" title={card.source.name}>
            ← {card.source.name}
          </span>
        </div>
      )}

      {/* Split auto-repair note (page partition was fixed after retries) */}
      {card.warning && (
        <p className={`${T.micro} text-amber-600 leading-snug`}>⚠ {card.warning}</p>
      )}

      {/* Classification: code chip + title */}
      {cls && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge tone={isUnknown ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}>
              🏷 {isUnknown ? 'chưa nhận diện' : cls.code}
            </Badge>
            {conf && !isUnknown && (
              <span className={`${T.micro} font-semibold tabular-nums ${conf.text}`}>{pct}%</span>
            )}
          </div>
          {!isUnknown && (
            <p className={`${T.body} text-foreground/90 leading-snug`}>{cls.title}</p>
          )}
          {conf && !isUnknown && (
            <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${conf.bar}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Error / skip reason */}
      {card.error && (
        <p className={`${T.meta} text-red-500 leading-snug`}>{card.error}</p>
      )}

      {/* Reconciliation panel (e2e, mode=update). Always visible — not behind the
          "xem chi tiết" toggle — because a mismatch is the reason this run exists.
          Its header carries the counts, so no separate badge is needed. */}
      {val && (
        <ValidationSummary
          extracted={card.extracted}
          validation={val}
          bankData={bankData ?? null}
        />
      )}

      {/* Expandable detail: fields (per-field validations render inline) + reason */}
      {(hasFields || (cls && !isUnknown && cls.reason)) && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
            className={`${T.body} text-primary hover:underline font-medium text-left self-start rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50`}
          >
            {expanded ? '▾ Ẩn chi tiết' : '▸ Xem chi tiết'}
            {hasFields ? ` (${Object.keys(card.extracted!).length} trường)` : ''}
          </button>

          {expanded && (
            <div className="flex flex-col gap-3">
              {cls && !isUnknown && cls.reason && (
                <p className={`${T.meta} text-muted-foreground italic leading-snug`}>
                  Lý do phân loại: {cls.reason}
                </p>
              )}

              {hasFields && (
                <ExtractedFields fields={card.extracted!} docCode={cls?.code} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
