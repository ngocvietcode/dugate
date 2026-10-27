import { Building2, Gauge, House, Landmark, type LucideIcon } from 'lucide-react';
import type { MetricResult } from '@/app/loan-appraisal/types';
import { formatMetric } from '@/app/loan-appraisal-v2/lib/format';
import { Badge } from '../ui/Badge';

function MetricCard({ label, metric, icon: Icon }: { label: string; metric?: MetricResult; icon: LucideIcon }) {
  const available = metric?.status === 'CALCULATED' && metric.value !== null;
  const status = available ? 'Đã tính'
    : metric?.status === 'INSUFFICIENT_DATA' ? 'Thiếu dữ liệu'
      : metric?.status === 'NOT_APPLICABLE' ? 'Không áp dụng' : 'Đang chờ';
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        <Badge tone={available ? 'success' : 'neutral'}>{status}</Badge>
      </div>
      <dt className="mt-3 text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-base font-semibold tabular-nums ${available ? '' : 'text-muted-foreground'}`}>{formatMetric(metric)}</dd>
      {metric?.warnings?.[0] && <p className="mt-2 text-xs text-[rgb(var(--la2-warning))]">{metric.warnings[0]}</p>}
    </div>
  );
}

export function MetricGrid({ metrics }: { metrics: Record<string, MetricResult> | undefined }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="DSCR · Khả năng trả nợ" metric={metrics?.dscr} icon={Gauge} />
      <MetricCard label="LTV · Tỷ lệ vay/TSBĐ" metric={metrics?.ltv} icon={House} />
      <MetricCard label="Số tiền khách hàng đề nghị" metric={metrics?.requested_amount} icon={Landmark} />
      <MetricCard label="Giá trị tài sản bảo đảm" metric={metrics?.collateral_value} icon={Building2} />
    </dl>
  );
}
