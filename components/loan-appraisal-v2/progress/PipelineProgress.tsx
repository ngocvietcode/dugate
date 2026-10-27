import { Activity, Loader2 } from 'lucide-react';
import type { LoanPhaseKey } from '@/app/loan-appraisal/types';
import type { RunState } from '@/app/loan-appraisal-v2/lib/run-reducer';
import { STAGES, completedStageCount } from '@/app/loan-appraisal-v2/lib/stages';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { RunStatusBadge } from './RunStatusBadge';
import { StageList } from './StageList';

export function PipelineProgress({ state, onSelectPhase }: { state: RunState; onSelectPhase: (phase: LoanPhaseKey) => void }) {
  const busy = state.phase === 'submitting' || state.phase === 'running' || state.phase === 'cancelling' || state.phase === 'resuming';
  const done = completedStageCount(state.stages);
  return (
    <Card labelledBy="la2-progress-title">
      <CardHeader
        id="la2-progress-title"
        icon={Activity}
        title="Luồng thẩm định tín dụng"
        subtitle={`2 giai đoạn · ${STAGES.length} bước · ${done}/${STAGES.length} hoàn tất`}
        actions={<RunStatusBadge phase={state.phase} result={state.result} />}
      />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1"><ProgressBar value={state.progressPercent} label="Tiến độ credit decision pipeline" /></div>
          <span className="w-10 text-right text-xs font-semibold tabular-nums">{Math.round(state.progressPercent)}%</span>
        </div>
        <div aria-live="polite" role="status" className="min-h-5 text-xs text-muted-foreground">
          {busy && (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              {state.progressMessage || (state.phase === 'cancelling' ? 'Đang gửi yêu cầu huỷ…' : 'Đang khởi tạo workflow và chuẩn bị tài liệu…')}
            </span>
          )}
          {!busy && state.progressMessage}
        </div>
        <StageList stages={state.stages} onSelectPhase={onSelectPhase} />
      </CardBody>
    </Card>
  );
}
