import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { RUN_PHASE_LABEL } from '@/app/loan-appraisal-v2/copy';
import type { RunPhase } from '@/app/loan-appraisal-v2/lib/run-reducer';
import type { Tone } from '@/app/loan-appraisal-v2/lib/tone';
import { Badge } from '../ui/Badge';

export function runStatus(phase: RunPhase, result: AppraisalResult | null): { label: string; tone: Tone } {
  if (phase === 'succeeded') {
    if (result && result.output_version !== '3.0') return { label: 'Kết quả phiên bản cũ', tone: 'info' };
    if (result?.processing_status === 'REVIEW_REQUIRED' || result?.processing_status === 'PARTIAL') return { label: 'Cần review', tone: 'warning' };
    if (result?.processing_status === 'BLOCKED') return { label: 'Bị chặn', tone: 'warning' };
    return { label: RUN_PHASE_LABEL.succeeded, tone: 'success' };
  }
  if (phase === 'paused') return { label: RUN_PHASE_LABEL.paused, tone: 'success' };
  if (phase === 'failed') return { label: RUN_PHASE_LABEL.failed, tone: 'danger' };
  if (phase === 'cancelled') return { label: RUN_PHASE_LABEL.cancelled, tone: 'neutral' };
  if (phase === 'stalled') return { label: RUN_PHASE_LABEL.stalled, tone: 'warning' };
  if (phase === 'idle') return { label: RUN_PHASE_LABEL.idle, tone: 'neutral' };
  return { label: RUN_PHASE_LABEL[phase], tone: 'info' };
}

export function RunStatusBadge({ phase, result }: { phase: RunPhase; result: AppraisalResult | null }) {
  const status = runStatus(phase, result);
  return <Badge tone={status.tone}>{status.label}</Badge>;
}
