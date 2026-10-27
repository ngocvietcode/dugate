'use client';

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Clock3,
  Coins,
  FileStack,
  Gauge,
  Timer,
  XCircle,
} from 'lucide-react';
import type { BusinessOperationBreakdownCard } from '../types';
import {
  NOT_AVAILABLE_DISPLAY,
  formatAverageBusinessTokens,
  formatBusinessCostUsd,
  formatBusinessDurationSeconds,
  formatBusinessRate,
  formatBusinessTokens,
  formatCompactBusinessCostUsd,
  isHighBusinessTokenCount,
  isSlowBusinessDuration,
} from '../lib/business-format';

export interface BusinessBreakdownGridProps {
  cards: BusinessOperationBreakdownCard[];
  loading?: boolean;
  onOpenOperation?: (token: string) => void;
}

/** Responsive profile/operation cards for the filtered business-operation snapshot. */
export default function BusinessBreakdownGrid({
  cards,
  loading = false,
  onOpenOperation,
}: BusinessBreakdownGridProps) {
  if (loading) return <BusinessBreakdownSkeleton />;

  if (cards.length === 0) {
    return (
      <section aria-labelledby="business-breakdown-title">
        <SectionHeading />
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center" role="status">
          <FileStack className="mx-auto h-9 w-9 text-muted-foreground/40" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">Không có breakdown phù hợp</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Không có cặp profile và loại operation trong bộ lọc hiện tại.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="business-breakdown-title">
      <SectionHeading />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {cards.map((card) => (
          <BusinessBreakdownCard
            key={`${card.profileScope.id ?? '__internal__'}:${card.operationType}`}
            card={card}
            onOpenOperation={onOpenOperation}
          />
        ))}
      </div>
    </section>
  );
}

function SectionHeading() {
  return (
    <div className="mb-3">
      <h2 id="business-breakdown-title" className="text-base font-semibold text-foreground">
        Hiệu quả theo profile và operation
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Mỗi thẻ là một cặp profile scope và loại operation.
      </p>
    </div>
  );
}

function BusinessBreakdownCard({
  card,
  onOpenOperation,
}: {
  card: BusinessOperationBreakdownCard;
  onOpenOperation?: (token: string) => void;
}) {
  const successPercentage = Number.isFinite(card.successPercentage)
    ? Math.min(100, Math.max(0, card.successPercentage))
    : 0;
  const totalTokens = card.inputTokens + card.outputTokens;

  return (
    <article className={`overflow-hidden rounded-xl border bg-card shadow-sm ${card.costIncomplete ? 'border-amber-300 dark:border-amber-800/80' : 'border-border'}`}>
      <header className="flex flex-col gap-3 border-b border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{card.profileScope.name}</p>
          <h3 className="mt-1 break-all text-base font-semibold text-foreground">{card.operationType}</h3>
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tỷ lệ thành công</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatBusinessRate(card.successPercentage)}
          </p>
        </div>
      </header>

      <div className="px-5 py-4">
        <div className="h-2 overflow-hidden rounded-full bg-red-100 dark:bg-red-950/40" aria-label={`Tỷ lệ thành công ${formatBusinessRate(card.successPercentage)}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={successPercentage}>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${successPercentage}%` }} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
          <Metric label="Cases" value={formatBusinessTokens(card.businessOperationCount)} icon={<FileStack />} />
          <Metric label="Thành công" value={formatBusinessTokens(card.succeededCount)} icon={<CheckCircle2 />} tone="success" />
          <Metric label="Thất bại" value={formatBusinessTokens(card.failedCount)} icon={<XCircle />} tone="danger" />
          <Metric label="Requests" value={formatBusinessTokens(card.requestCount)} icon={<Gauge />} />
          <Metric label="Tổng tokens" value={formatBusinessTokens(totalTokens)} icon={<Coins />} detail={`Input ${formatBusinessTokens(card.inputTokens)} · Output ${formatBusinessTokens(card.outputTokens)}`} />
          <Metric label="Tổng chi phí" value={formatCompactBusinessCostUsd(card.costUsd)} title={formatBusinessCostUsd(card.costUsd)} icon={<ArrowDownToLine />} tone={card.costIncomplete ? 'warning' : 'default'} />
          <Metric label="Tokens / case" value={formatAverageBusinessTokens(card.averageTokensPerBusinessOperation)} icon={<ArrowUpFromLine />} />
          <Metric label="Thời gian TB" value={formatBusinessDurationSeconds(card.averageDurationSeconds)} icon={<Clock3 />} />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <Extremum
            icon={<Timer className="h-4 w-4" />}
            label="Case lâu nhất"
            value={formatBusinessDurationSeconds(card.maxDurationSeconds)}
            reference={card.maxDurationOperationIdentifier}
            token={card.maxDurationOperationToken}
            highlight={isSlowBusinessDuration(card.maxDurationSeconds)}
            onOpen={onOpenOperation}
          />
          <Extremum
            icon={<Coins className="h-4 w-4" />}
            label="Case nhiều token nhất"
            value={`${formatBusinessTokens(card.maxTokenCount)} tokens`}
            reference={card.maxTokenOperationIdentifier || null}
            token={card.maxTokenOperationToken}
            highlight={isHighBusinessTokenCount(card.maxTokenCount)}
            onOpen={onOpenOperation}
          />
        </div>

        {card.costIncomplete && card.unpricedRequestCount > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Tổng chi phí chưa đầy đủ: <strong>{formatBusinessTokens(card.unpricedRequestCount)} request</strong> chưa định giá.
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
  tone = 'default',
  title,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: React.ReactElement<{ className?: string }>;
  tone?: 'default' | 'success' | 'danger' | 'warning';
  title?: string;
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-emerald-700 dark:text-emerald-400',
    danger: 'text-red-700 dark:text-red-400',
    warning: 'text-amber-700 dark:text-amber-300',
  }[tone];

  return (
    <div className="min-w-0" title={label}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </div>
      <p className={`mt-1 break-words text-base font-semibold tabular-nums ${toneClass}`} title={title}>{value}</p>
      {detail && <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

function Extremum({ icon, label, value, reference, token, highlight, onOpen }: {
  icon: React.ReactNode; label: string; value: string; reference: string | null;
  token?: string | null; highlight?: boolean; onOpen?: (token: string) => void;
}) {
  const clickable = Boolean(token && onOpen);
  const valueClass = highlight ? 'text-amber-700 dark:text-amber-300' : 'text-foreground';
  const content = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden="true">{icon}</span><span>{label}</span>
      </div>
      <p className={`mt-1 text-lg font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={reference ?? NOT_AVAILABLE_DISPLAY}>{reference ?? NOT_AVAILABLE_DISPLAY}</p>
    </>
  );
  if (clickable) {
    return (
      <button type="button" onClick={() => onOpen!(token!)} title={label} className="w-full rounded-lg bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`Mở ${label}`}>
        {content}
      </button>
    );
  }
  return <div className="rounded-lg bg-muted/40 px-3 py-2.5" title={label}>{content}</div>;
}

function BusinessBreakdownSkeleton() {
  return (
    <section aria-label="Đang tải breakdown nghiệp vụ" aria-busy="true">
      <div className="mb-3 h-5 w-64 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="h-80 animate-pulse rounded-xl border border-border bg-card p-5">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="mt-2 h-5 w-48 rounded bg-muted" />
            <div className="mt-8 grid grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((__, metricIndex) => (
                <div key={metricIndex} className="h-12 rounded bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
