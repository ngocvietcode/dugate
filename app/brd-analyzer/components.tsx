'use client';

// app/brd-analyzer/components.tsx
// Trình bày kết quả đánh giá chất lượng BRD (32 tiêu chí) — phong cách governance-ready.

import React from 'react';
import type { BrdEvalResult, QuestionEval, QuestionStatus, GroupSummary, ScorecardResult, BrdResult } from '@/lib/brd/types';
import { SCORECARD_CONFIG } from '@/lib/brd/scorecard.config';
import { BRD_CRITERIA, GROUP_ORDER, MAX_SCORE, PASS_PERCENT } from '@/lib/brd/criteria';

// ─── Section wrapper ─────────────────────────────────────────────────────────

export function Section({
  eyebrow,
  title,
  desc,
  children,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">{eyebrow}</div>
        <h2 className="text-xl font-bold tracking-tight mt-0.5">{title}</h2>
        {desc && <p className="text-sm text-muted-foreground mt-1">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_META: Record<QuestionStatus, { label: string; color: string; bg: string }> = {
  '✓': { label: 'Đạt', color: '#16a34a', bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  '?': { label: 'Một phần', color: '#d97706', bg: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  '✗': { label: 'Chưa có', color: '#dc2626', bg: 'bg-red-500/10 text-red-600 border-red-500/30' },
};

function percentColor(percent: number): string {
  if (percent >= 85) return '#16a34a';
  if (percent >= 60) return '#d97706';
  return '#dc2626';
}

// ─── Score Header (gauge % + Đạt/Không đạt) ──────────────────────────────────

function Gauge({ percent }: { percent: number }) {
  const size = 168;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, percent / 100));
  const color = percentColor(percent);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted/40" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold leading-none" style={{ color }}>
          {percent.toFixed(0)}%
        </span>
        <span className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">Hoàn thiện</span>
      </div>
    </div>
  );
}

export function ScoreHeaderCard({ result }: { result: BrdEvalResult }) {
  const color = result.passed ? '#16a34a' : '#dc2626';
  return (
    <div className="modern-card p-6 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${color}0d, transparent 60%)` }}>
      <div className="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl opacity-20" style={{ background: color }} />
      <div className="flex flex-col items-center text-center relative">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">Kết quả đánh giá BRD</div>
        <Gauge percent={result.percent} />
        <div className="mt-4 text-sm text-muted-foreground">
          Điểm: <b className="text-foreground">{result.totalScore}</b> / {result.maxScore}
        </div>
        <div
          className="mt-3 px-5 py-2 rounded-full text-sm font-bold border shadow-sm"
          style={{ color, borderColor: `${color}66`, backgroundColor: `${color}14` }}
        >
          {result.passed ? '✅ ĐẠT (≥ 85%)' : '❌ KHÔNG ĐẠT (< 85%)'}
        </div>
      </div>
    </div>
  );
}

// ─── Group Bars ──────────────────────────────────────────────────────────────

export function GroupBars({ groups }: { groups: GroupSummary[] }) {
  return (
    <div className="modern-card p-5">
      <h3 className="text-sm font-semibold mb-3">Điểm theo nhóm tiêu chí</h3>
      <div className="space-y-2.5">
        {groups.map((g) => {
          const pct = g.max ? (g.score / g.max) * 100 : 0;
          return (
            <div key={g.group}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">{g.group}</span>
                <span className="font-semibold">
                  {g.score} / {g.max}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: percentColor(pct) }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Question Table (32 dòng, nhóm theo group) ───────────────────────────────

function StatusPill({ status }: { status: QuestionStatus }) {
  const s = STATUS_META[status];
  return <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-full border ${s.bg}`}>{status} {s.label}</span>;
}

export function QuestionTable({ result }: { result: BrdEvalResult }) {
  // Gom theo group giữ thứ tự xuất hiện trong groups[]
  const groupOrder = result.groups.map((g) => g.group);
  const byGroup = groupOrder.map((group) => ({
    group,
    items: result.questions.filter((q) => q.group === group),
  }));

  return (
    <div className="modern-card p-0 overflow-hidden">
      <div className="p-5 pb-3">
        <h3 className="text-sm font-semibold">Bảng đánh giá chi tiết (32 tiêu chí)</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground border-y border-border bg-muted/30">
              <th className="py-2 px-3 w-10">STT</th>
              <th className="py-2 px-3 min-w-[260px]">Tiêu chí</th>
              <th className="py-2 px-2 text-center w-14">Trọng số</th>
              <th className="py-2 px-2 text-center w-24">Trạng thái</th>
              <th className="py-2 px-2 text-center w-14">Điểm</th>
              <th className="py-2 px-2 text-center w-20">Quy đổi</th>
              <th className="py-2 px-3 min-w-[160px]">Cơ sở đánh giá</th>
              <th className="py-2 px-3 min-w-[220px]">Nội dung cần hoàn thiện</th>
            </tr>
          </thead>
          <tbody>
            {byGroup.map(({ group, items }) => (
              <React.Fragment key={group}>
                <tr className="bg-primary/5">
                  <td colSpan={8} className="py-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-primary">
                    {group}
                  </td>
                </tr>
                {items.map((q) => (
                  <QuestionRow key={q.stt} q={q} />
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QuestionRow({ q }: { q: QuestionEval }) {
  return (
    <tr className="border-b border-border/40 align-top">
      <td className="py-2 px-3 text-muted-foreground">{q.stt}</td>
      <td className="py-2 px-3">{q.question}</td>
      <td className="py-2 px-2 text-center text-muted-foreground">{q.weight}</td>
      <td className="py-2 px-2 text-center">
        <StatusPill status={q.status} />
      </td>
      <td className="py-2 px-2 text-center font-semibold" style={{ color: STATUS_META[q.status].color }}>
        {q.score}
      </td>
      <td className="py-2 px-2 text-center font-semibold">{q.weightedScore}</td>
      <td className="py-2 px-3 text-xs text-muted-foreground">{q.basis || '—'}</td>
      <td className="py-2 px-3 text-xs text-muted-foreground">{q.recommendation || '—'}</td>
    </tr>
  );
}

// ─── Assessment Panel ────────────────────────────────────────────────────────

export function AssessmentPanel({ result }: { result: BrdEvalResult }) {
  return (
    <div className="modern-card p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Đánh giá tổng thể</h3>
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
          {result.overallAssessment || '—'}
        </p>
      </div>
      {result.recommendations && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Đề xuất hoàn thiện BRD</h3>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line border-l-2 border-primary/40 pl-3">
            {result.recommendations}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Step Stream (live theo bước) ────────────────────────────────────────────

export function StepStream({ steps }: { steps: Array<{ step: number; stepName: string; processor: string; data: unknown }> }) {
  if (steps.length === 0) return null;
  return (
    <div className="modern-card p-5">
      <h3 className="text-sm font-semibold mb-3">Tiến trình xử lý</h3>
      <div className="space-y-2">
        {steps.map((s) => {
          const d = (s.data ?? {}) as Record<string, unknown>;
          const sources = Array.isArray(d.sources) ? (d.sources as Array<Record<string, unknown>>) : [];
          return (
            <div key={s.step} className="border border-border/60 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-emerald-500">✓</span>
                {s.stepName}
                <span className="text-[10px] text-muted-foreground">({s.processor})</span>
              </div>
              {sources.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {sources.map((f, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full border border-border text-[11px] text-muted-foreground">
                      {String(f.file)} · {String(f.source)}
                    </span>
                  ))}
                </div>
              )}
              {typeof d.percent === 'number' && (
                <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                  {typeof d.finalScore === 'number' && (
                    <div>Scorecard: <b className="text-foreground">{Number(d.finalScore).toFixed(2)}/10</b>{d.priority ? ` — ${String(d.priority)}` : ''}</div>
                  )}
                  <div>Chi tiết BRD: <b className="text-foreground">{Number(d.percent).toFixed(0)}%</b> ({String(d.totalScore)}/{String(d.maxScore)}) — {d.passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PHẦN 1 — Prioritization Scorecard
// ════════════════════════════════════════════════════════════════════════════

const CRIT_PALETTE: Record<string, string> = {
  businessValue: '#2563eb',
  technicalEffort: '#0891b2',
  reusability: '#7c3aed',
  bonus: '#f59e0b',
};

function ScorecardGauge({ value, color }: { value: number; color: string }) {
  const size = 168;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, value / 10));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted/40" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold leading-none" style={{ color }}>
          {value.toFixed(2)}
        </span>
        <span className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">/ 10 điểm</span>
      </div>
    </div>
  );
}

export function ScorecardHeaderCard({ scorecard }: { scorecard: ScorecardResult }) {
  return (
    <div className="modern-card p-6 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${scorecard.color}0d, transparent 60%)` }}>
      <div className="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl opacity-20" style={{ background: scorecard.color }} />
      <div className="flex flex-col items-center text-center relative">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">Final Score</div>
        <ScorecardGauge value={scorecard.finalScore} color={scorecard.color} />
        <div className="mt-4 px-5 py-2 rounded-full text-sm font-bold border shadow-sm" style={{ color: scorecard.color, borderColor: `${scorecard.color}66`, backgroundColor: `${scorecard.color}14` }}>
          {scorecard.priority} · {scorecard.action}
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span>Weighted <b className="text-foreground">{scorecard.weightedSum.toFixed(2)}</b></span>
          <span className="w-px h-3 bg-border" />
          <span>Bonus <b className="text-foreground">+{scorecard.bonus}</b></span>
        </div>
      </div>
    </div>
  );
}

export function WeightDistribution({ scorecard }: { scorecard: ScorecardResult }) {
  return (
    <div className="modern-card p-5">
      <h3 className="text-sm font-semibold mb-3">Phân bổ trọng số</h3>
      <div className="flex h-3 rounded-full overflow-hidden">
        {scorecard.contributions.map((c) => (
          <div key={c.key} style={{ width: `${c.weight * 100}%`, background: CRIT_PALETTE[c.key] ?? '#64748b' }} title={`${c.label}: ${(c.weight * 100).toFixed(0)}%`} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {scorecard.contributions.map((c) => (
          <div key={c.key} className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CRIT_PALETTE[c.key] ?? '#64748b' }} />
            <span className="text-muted-foreground">{c.label}</span>
            <span className="font-semibold">{(c.weight * 100).toFixed(0)}%</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
          <span className="text-muted-foreground">Bonus</span>
          <span className="font-semibold">+1–5</span>
        </div>
      </div>
    </div>
  );
}

function SegmentBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} className="h-2 flex-1 rounded-full" style={{ background: n <= score ? color : 'rgb(var(--muted))' }} />
      ))}
    </div>
  );
}

export function CriteriaCards({ scorecard }: { scorecard: ScorecardResult }) {
  const cards = [
    ...scorecard.contributions.map((c) => ({
      key: c.key,
      label: c.label,
      score: c.rawScore,
      meta: `Weight ${c.weight} · Đóng góp ${c.contribution.toFixed(2)}`,
      rationale: scorecard.criteria[c.key]?.rationale ?? '',
    })),
    {
      key: 'bonus',
      label: 'Bonus (Mức độ chỉ đạo)',
      score: scorecard.bonus,
      meta: `Cộng thẳng +${scorecard.bonus}`,
      rationale: scorecard.criteria.bonus?.rationale ?? '',
    },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {cards.map((c) => {
        const color = CRIT_PALETTE[c.key] ?? '#64748b';
        return (
          <div key={c.key} className="modern-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">{c.label}</span>
              <span className="text-lg font-bold" style={{ color }}>
                {c.score}<span className="text-xs text-muted-foreground">/5</span>
              </span>
            </div>
            <SegmentBar score={c.score} color={color} />
            <div className="text-[11px] text-muted-foreground mt-2">{c.meta}</div>
            {c.rationale && <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{c.rationale}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Methodology Overview (giới thiệu 2 phần, render từ config)
// ════════════════════════════════════════════════════════════════════════════

export function MethodologyOverview() {
  const scKeys: Array<keyof typeof SCORECARD_CONFIG.criteria> = [
    'businessValue',
    'technicalEffort',
    'reusability',
    'bonus',
  ];
  const scPalette: Record<string, string> = {
    businessValue: '#2563eb',
    technicalEffort: '#0891b2',
    reusability: '#7c3aed',
    bonus: '#f59e0b',
  };

  // Số tiêu chí mỗi nhóm (Phần 2)
  const groupCounts = GROUP_ORDER.map((g) => ({
    group: g,
    count: BRD_CRITERIA.filter((c) => c.group === g).length,
    weight: BRD_CRITERIA.filter((c) => c.group === g).reduce((s, c) => s + c.weight, 0),
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Phần 1 — Prioritization Scorecard */}
      <div className="space-y-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">Phần 1</div>
          <h3 className="text-lg font-bold">Prioritization Scorecard</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Final Score = (Business Value × 0.6 + Technical Effort × 0.3 + Reusability × 0.1) + Bonus
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {scKeys.map((k) => {
            const c = SCORECARD_CONFIG.criteria[k];
            const color = scPalette[k] ?? '#64748b';
            const tag = k === 'bonus' ? 'Bonus 1–5' : `Weight ${c.weight}`;
            return (
              <div key={k} className="modern-card p-4 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1" style={{ background: color }} aria-hidden="true" />
                <span
                  className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded mb-2"
                  style={{ color, background: `${color}14` }}
                >
                  {tag}
                </span>
                <h4 className="text-sm font-semibold">{c.label}</h4>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{c.description}</p>
              </div>
            );
          })}
        </div>
        {/* Ngưỡng Priority */}
        <div className="modern-card p-4">
          <div className="text-xs font-semibold mb-2">Phân loại ưu tiên (Final Score 2–10)</div>
          <div className="flex flex-wrap gap-2">
            {[...SCORECARD_CONFIG.thresholds]
              .sort((a, b) => b.min - a.min)
              .map((t) => (
                <span
                  key={t.priority}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-full border"
                  style={{ color: t.color, borderColor: `${t.color}55`, background: `${t.color}12` }}
                >
                  ≥ {t.min}: {t.priority} — {t.action}
                </span>
              ))}
          </div>
        </div>
      </div>

      {/* Phần 2 — Đánh giá chi tiết BRD */}
      <div className="space-y-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">Phần 2</div>
          <h3 className="text-lg font-bold">Đánh giá chi tiết BRD ({BRD_CRITERIA.length} tiêu chí)</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Đầy đủ – Rõ ràng – Chi tiết · thang điểm 0 / 0.25 / 0.5 / 0.75 / 1 · tổng {MAX_SCORE} điểm · đạt ≥ {PASS_PERCENT}%
          </p>
        </div>
        <div className="modern-card p-4">
          <div className="text-xs font-semibold mb-2">10 nhóm tiêu chí</div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {groupCounts.map((g) => (
              <li key={g.group} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{g.group}</span>
                <span className="font-semibold">
                  {g.count} câu · {g.weight}đ
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Result Summary Strip (KPI gộp 2 phần)
// ════════════════════════════════════════════════════════════════════════════

export function ResultSummaryStrip({ result }: { result: BrdResult }) {
  const { scorecard, evaluation } = result;
  const evalColor = evaluation.passed ? '#16a34a' : '#dc2626';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <div className="modern-card p-4 flex flex-col items-center text-center">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Final Score (Phần 1)</span>
        <span className="text-2xl font-bold" style={{ color: scorecard.color }}>
          {scorecard.finalScore.toFixed(2)}<span className="text-sm text-muted-foreground">/10</span>
        </span>
        <span className="text-[11px] font-semibold mt-0.5" style={{ color: scorecard.color }}>
          {scorecard.priority}
        </span>
      </div>
      <div className="modern-card p-4 flex flex-col items-center text-center">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Chất lượng BRD (Phần 2)</span>
        <span className="text-2xl font-bold" style={{ color: evalColor }}>
          {evaluation.percent.toFixed(0)}%
        </span>
        <span className="text-[11px] text-muted-foreground mt-0.5">
          {evaluation.totalScore}/{evaluation.maxScore} điểm
        </span>
      </div>
      <div className="modern-card p-4 flex flex-col items-center text-center justify-center">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Kết luận</span>
        <span className="text-lg font-bold mt-1" style={{ color: evalColor }}>
          {evaluation.passed ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}
        </span>
        <span className="text-[11px] text-muted-foreground">Ngưỡng ≥ {PASS_PERCENT}%</span>
      </div>
    </div>
  );
}
