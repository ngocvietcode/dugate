'use client';

import {
  Activity,
  BadgeCheck,
  BrainCircuit,
  CircleDollarSign,
  Coins,
  Timer,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { BusinessOperationsSummary } from '../types';
import {
  formatBusinessCostUsd,
  formatBusinessDurationSeconds,
  formatBusinessRate,
  formatBusinessTokens,
  formatCompactBusinessCostUsd,
} from '../lib/business-format';

export interface DashboardStatsProps {
  summary: BusinessOperationsSummary;
  loading?: boolean;
}

interface KpiCardDefinition {
  label: string;
  value: string;
  icon: LucideIcon;
  accentClassName: string;
  description: string;
  warning?: string;
  title?: string;
}

/** Five business-level KPIs from the same dashboard snapshot. */
export default function DashboardStats({ summary, loading = false }: DashboardStatsProps) {
  if (loading) return <DashboardStatsSkeleton />;

  const cards: KpiCardDefinition[] = [
    {
      label: 'Total Cases',
      value: formatBusinessTokens(summary.totalCases),
      icon: Activity,
      accentClassName: 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-950/50',
      description: 'Nghiệp vụ phân biệt',
    },
    {
      label: 'Tokens Processed',
      value: formatBusinessTokens(summary.tokensProcessed),
      icon: Coins,
      accentClassName: 'text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-950/50',
      description: 'Input + output tokens',
    },
    {
      label: 'Total Cost USD',
      value: formatCompactBusinessCostUsd(summary.totalCostUsd),
      title: formatBusinessCostUsd(summary.totalCostUsd),
      icon: CircleDollarSign,
      accentClassName: summary.costIncomplete
        ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/50'
        : 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/50',
      description: 'Chỉ gồm request đã định giá',
      warning: summary.costIncomplete && summary.unpricedRequestCount > 0
        ? `Chưa đủ chi phí · ${formatBusinessTokens(summary.unpricedRequestCount)} request chưa định giá`
        : undefined,
    },
    {
      label: 'Logic Success Rate',
      value: formatBusinessRate(summary.logicSuccessRate),
      icon: BadgeCheck,
      accentClassName: 'text-teal-600 dark:text-teal-400 bg-teal-100 dark:bg-teal-950/50',
      description: 'Trên nghiệp vụ có kết quả logic',
    },
    {
      label: 'AI Extraction Rate',
      value: formatBusinessRate(summary.aiExtractionRate),
      icon: BrainCircuit,
      accentClassName: 'text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-100 dark:bg-fuchsia-950/50',
      description: 'Trên nghiệp vụ có kết quả trích xuất',
    },
    {
      label: 'P95 Duration',
      value: formatBusinessDurationSeconds(summary.p95DurationSeconds),
      icon: Timer,
      accentClassName: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-950/50',
      description: 'P95 thời gian nghiệp vụ đã kết thúc',
    },
  ];

  return (
    <section aria-label="Chỉ số tổng quan nghiệp vụ">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <BusinessKpiCard key={card.label} card={card} />
        ))}
      </div>
    </section>
  );
}

function BusinessKpiCard({ card }: { card: KpiCardDefinition }) {
  const Icon = card.icon;

  return (
    <article className={`rounded-xl border bg-card p-4 shadow-sm ${card.warning ? 'border-amber-300 dark:border-amber-800' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
          <p className="mt-1 break-words text-2xl font-bold tabular-nums text-foreground" title={card.title}>
            {card.value}
          </p>
        </div>
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${card.accentClassName}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{card.description}</p>
      {card.warning && (
        <p className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" role="status">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{card.warning}</span>
        </p>
      )}
    </article>
  );
}

function DashboardStatsSkeleton() {
  return (
    <section aria-label="Đang tải chỉ số tổng quan" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-36 animate-pulse rounded-xl border border-border bg-card p-4">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="mt-4 h-7 w-28 rounded bg-muted" />
            <div className="mt-3 h-3 w-36 rounded bg-muted" />
          </div>
        ))}
      </div>
    </section>
  );
}
