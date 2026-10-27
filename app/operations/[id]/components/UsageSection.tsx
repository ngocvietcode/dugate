'use client';

import type { OperationDetail, CostSourceLabel } from '../../types';
import { formatCost, formatTokens } from '../../lib/format';

interface UsageSectionProps {
  operation: OperationDetail;
}

export default function UsageSection({ operation }: UsageSectionProps) {
  const hasUsage =
    operation.totalInputTokens > 0 ||
    operation.totalOutputTokens > 0 ||
    operation.totalCostUsd > 0;

  if (!hasUsage) return null;

  const hasUnpriced = operation.usageBreakdown?.some((i) => i.cost_source === 'unpriced');

  return (
    <div className="modern-card p-6 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Usage &amp; Chi phí</h3>

      {/* Summary stats — exact numbers, no rounding/abbreviation */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatItem label="Input Tokens" value={formatTokens(operation.totalInputTokens)} />
        <StatItem label="Output Tokens" value={formatTokens(operation.totalOutputTokens)} />
        <StatItem label="Chi phí" value={formatCost(operation.totalCostUsd)} />
        <StatItem label="Số trang" value={String(operation.pagesProcessed)} />
        <StatItem label="Model" value={
          typeof operation.modelUsed === 'string'
            ? operation.modelUsed.replace(/^ext:/, '')
            : '—'
        } />
      </div>

      {hasUnpriced && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          ⚠ Có bước chưa cấu hình giá model — chi phí hiển thị có thể chưa đầy đủ.
        </p>
      )}

      {/* Breakdown table */}
      {operation.usageBreakdown && operation.usageBreakdown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Processor</th>
                <th className="pb-2 pr-4 font-medium">Model</th>
                <th className="pb-2 pr-4 font-medium text-right">Input Tokens</th>
                <th className="pb-2 pr-4 font-medium text-right">Output Tokens</th>
                <th className="pb-2 pr-4 font-medium text-right">Cost (USD)</th>
                <th className="pb-2 font-medium">Nguồn giá</th>
              </tr>
            </thead>
            <tbody>
              {operation.usageBreakdown.map((item, idx) => (
                <tr key={idx} className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-foreground">{typeof item.processor === 'string' ? item.processor : String(item.processor)}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{item.model ? item.model.replace(/^ext:/, '') : '—'}</td>
                  <td className="py-2 pr-4 text-right text-foreground">{formatTokens(item.input_tokens)}</td>
                  <td className="py-2 pr-4 text-right text-foreground">{formatTokens(item.output_tokens)}</td>
                  <td className="py-2 pr-4 text-right text-foreground">
                    {item.cost_source === 'unpriced'
                      ? <span className="text-amber-600 dark:text-amber-400 font-medium">N/A</span>
                      : formatCost(item.cost_usd)}
                  </td>
                  <td className="py-2"><CostSourceBadge source={item.cost_source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CostSourceBadge({ source }: { source?: CostSourceLabel }) {
  if (!source || source === 'none') return <span className="text-muted-foreground/50">—</span>;
  const cfg: Record<Exclude<CostSourceLabel, 'none'>, { label: string; cls: string }> = {
    provider: { label: 'Provider', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' },
    estimate: { label: 'Ước lượng', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400' },
    unpriced: { label: 'Chưa có giá', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
  };
  const c = cfg[source as Exclude<CostSourceLabel, 'none'>];
  if (!c) return <span className="text-muted-foreground/50">—</span>;
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${c.cls}`}>{c.label}</span>;
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
