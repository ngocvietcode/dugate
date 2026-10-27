'use client';

// app/margin-eval/components/ReviewPanel.tsx
// Renders review documents as TABS (one per file/comparison) so many files don't
// force endless scrolling. Each item has ✓/✗ tick buttons; a running score and
// per-document progress are shown. Prev/Next jumps between documents.

import React, { useState } from 'react';
import type { ReviewDocument, ReviewItem, Judgement } from '../types';

interface ReviewPanelProps {
  documents: ReviewDocument[];
  onJudge: (docId: string, key: string, judgement: Judgement) => void;
  /** Batch-judge a document in one state update. keys=null → all items;
   *  onlyUnset=true → only items still unjudged. */
  onJudgeDoc: (docId: string, keys: string[] | null, judgement: Judgement, onlyUnset?: boolean) => void;
  onSelectItem: (item: ReviewItem) => void;
  selectedKey: string | null;
  activeIndex: number;
  onActiveIndexChange: (idx: number) => void;
}

function docScore(doc: ReviewDocument) {
  let correct = 0, wrong = 0, unset = 0;
  for (const it of doc.items) {
    if (it.judgement === 'correct') correct += 1;
    else if (it.judgement === 'wrong') wrong += 1;
    else unset += 1;
  }
  return { correct, wrong, unset, total: doc.items.length };
}

function totalScore(documents: ReviewDocument[]) {
  let correct = 0, wrong = 0, total = 0;
  for (const d of documents) for (const it of d.items) {
    total += 1;
    if (it.judgement === 'correct') correct += 1;
    else if (it.judgement === 'wrong') wrong += 1;
  }
  const judged = correct + wrong;
  return { correct, wrong, total, judged, accuracy: judged === 0 ? null : (correct / judged) * 100 };
}

export function ReviewPanel({ documents, onJudge, onJudgeDoc, onSelectItem, selectedKey, activeIndex, onActiveIndexChange }: ReviewPanelProps) {
  const score = totalScore(documents);
  const active = documents[activeIndex] ?? documents[0];

  return (
    <div className="space-y-3">
      {/* Overall score */}
      <div className="modern-card p-3 flex flex-wrap items-center gap-4">
        <Stat label="Accuracy" value={score.accuracy === null ? '—' : `${score.accuracy.toFixed(1)}%`} highlight />
        <Stat label="Đúng" value={score.correct} tone="pass" />
        <Stat label="Sai" value={score.wrong} tone="fail" />
        <Stat label="Đã chấm" value={`${score.judged}/${score.total}`} />
      </div>

      {/* Document tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onActiveIndexChange(Math.max(0, activeIndex - 1))}
          disabled={activeIndex <= 0}
          className="modern-button btn-outline text-xs px-2 disabled:opacity-40"
        >‹ Trước</button>
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-1.5">
            {documents.map((d, i) => {
              const s = docScore(d);
              const complete = s.unset === 0 && s.total > 0;
              return (
                <button
                  key={d.docId}
                  onClick={() => onActiveIndexChange(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border transition-all ${
                    i === activeIndex ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border text-muted-foreground hover:border-primary/40'
                  }`}
                  title={d.title}
                >
                  <span className="mr-1">{complete ? '✅' : `${s.unset}◻`}</span>
                  {shortTitle(d.title)}
                </button>
              );
            })}
          </div>
        </div>
        <button
          onClick={() => onActiveIndexChange(Math.min(documents.length - 1, activeIndex + 1))}
          disabled={activeIndex >= documents.length - 1}
          className="modern-button btn-outline text-xs px-2 disabled:opacity-40"
        >Sau ›</button>
      </div>

      {/* Active document */}
      {active && (
        <div className="modern-card overflow-hidden">
          <div className="p-3 border-b border-border/50 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm">{active.title}</h3>
              {active.subtitle && <p className="text-xs text-muted-foreground">{active.subtitle}</p>}
            </div>
            <span className="text-[11px] text-muted-foreground">
              Doc {activeIndex + 1}/{documents.length}
            </span>
          </div>
          <div className="divide-y divide-border/40 max-h-[65vh] overflow-y-auto">
            {active.items.map((it) => {
              const rowKey = `${active.docId}::${it.key}`;
              const isSelected = selectedKey === rowKey;
              return (
                <div
                  key={it.key}
                  className={`flex items-start gap-3 px-3 py-2 transition-colors ${
                    it.judgement === 'correct' ? 'bg-emerald-500/5' : it.judgement === 'wrong' ? 'bg-red-500/5' : ''
                  } ${isSelected ? 'ring-1 ring-primary/40' : ''}`}
                >
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectItem({ ...it, key: rowKey })}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">{it.label}</span>
                      {typeof it.confidence === 'number' && <span className="text-[10px] text-muted-foreground/70">{(it.confidence * 100).toFixed(0)}%</span>}
                      {it.bbox && <span className="text-[10px] text-primary">📍</span>}
                    </div>
                    <div className="text-sm break-words whitespace-pre-wrap">{it.value}</div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <TickButton active={it.judgement === 'correct'} tone="pass" onClick={() => onJudge(active.docId, it.key, it.judgement === 'correct' ? 'unset' : 'correct')} label="✓" />
                    <TickButton active={it.judgement === 'wrong'} tone="fail" onClick={() => onJudge(active.docId, it.key, it.judgement === 'wrong' ? 'unset' : 'wrong')} label="✗" />
                  </div>
                </div>
              );
            })}
          </div>
          {/* Per-document quick actions — single batched state update each. */}
          <div className="p-2 border-t border-border/50 flex gap-2">
            <button onClick={() => onJudgeDoc(active.docId, null, 'correct')} className="modern-button btn-outline text-[11px] px-2">Doc này: tất cả Đúng</button>
            <button onClick={() => onJudgeDoc(active.docId, null, 'correct', true)} className="modern-button btn-outline text-[11px] px-2">Còn lại: Đúng</button>
          </div>
        </div>
      )}
    </div>
  );
}

function shortTitle(title: string): string {
  // Keep the file name part; drop long "· doc_type" suffix when tab space is tight.
  const main = title.split('·')[0].trim();
  return main.length > 22 ? `${main.slice(0, 20)}…` : main;
}

function TickButton({ active, tone, onClick, label }: { active: boolean; tone: 'pass' | 'fail'; onClick: () => void; label: string }) {
  const cls = active
    ? tone === 'pass' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-red-500 text-white border-red-500'
    : 'bg-transparent text-muted-foreground border-border hover:border-primary/50';
  return <button type="button" onClick={onClick} className={`w-8 h-8 rounded-lg text-sm font-bold transition-all border ${cls}`}>{label}</button>;
}

function Stat({ label, value, tone, highlight }: { label: string; value: React.ReactNode; tone?: 'pass' | 'fail'; highlight?: boolean }) {
  const color = tone === 'pass' ? 'text-emerald-600' : tone === 'fail' ? 'text-red-600' : 'text-foreground';
  return (
    <div className="text-center">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`font-bold ${highlight ? 'text-xl' : 'text-lg'} ${color}`}>{value}</div>
    </div>
  );
}
