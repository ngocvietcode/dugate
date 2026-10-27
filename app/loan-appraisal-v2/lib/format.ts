import type { MetricResult } from '@/app/loan-appraisal/types';

const NO_DATA = 'Chưa đủ dữ liệu';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(value);
}

/** Tiền VND; null/undefined hiển thị "Chưa đủ dữ liệu" (không bao giờ là 0 giả). */
export function formatCurrencyVnd(value: number | null | undefined): string {
  return value === null || value === undefined ? NO_DATA : `${formatNumber(value)} đ`;
}

export function formatProbability(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Không khả dụng' : `${formatNumber(value * 100, 2)}%`;
}

/** Hiển thị chỉ số theo đơn vị: RATIO `0,70×`, PERCENT `70%`, VND `x đ`, MONTHS `n tháng`. */
export function formatMetric(metric: MetricResult | undefined | null): string {
  if (!metric || metric.status !== 'CALCULATED' || metric.value === null || metric.value === undefined) return NO_DATA;
  switch (metric.unit) {
    case 'VND': return `${formatNumber(metric.value)} đ`;
    case 'PERCENT': return `${formatNumber(metric.value * 100, 1)}%`;
    case 'RATIO': return `${formatNumber(metric.value, 2)}×`;
    case 'MONTHS': return `${formatNumber(metric.value)} tháng`;
    default: return String(metric.value);
  }
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const digits = Math.abs(value) < 1 ? 4 : 2;
  return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value)}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} giây`;
  return `${minutes} phút ${String(seconds).padStart(2, '0')} giây`;
}

export function fileExtension(name: string): string {
  const extension = name.includes('.') ? name.split('.').pop() : '';
  return extension ? extension.toUpperCase().slice(0, 5) : 'FILE';
}
