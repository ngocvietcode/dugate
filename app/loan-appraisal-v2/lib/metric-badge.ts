import type { MetricResult } from '@/app/loan-appraisal/types';
import type { Tone } from './tone';

export function metricBadge(metric?: MetricResult): { label: string; tone: Tone } {
  if (metric?.status === 'CALCULATED') return metric.needs_review
    ? { label: 'Cần soát', tone: 'warning' }
    : { label: 'Đã tính', tone: 'success' };
  if (metric?.status === 'INSUFFICIENT_DATA') return { label: 'Thiếu dữ liệu', tone: 'neutral' };
  if (metric?.status === 'NOT_APPLICABLE') return { label: 'Không áp dụng', tone: 'neutral' };
  return { label: 'Đang chờ', tone: 'neutral' };
}
