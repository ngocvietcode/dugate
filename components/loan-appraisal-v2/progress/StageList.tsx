import { CheckCircle2, Circle, CircleAlert, Loader2 } from 'lucide-react';
import type { LoanPhaseKey, StepStatus } from '@/app/loan-appraisal/types';
import { PHASES, STAGES, phaseStatusOf, type StageMap } from '@/app/loan-appraisal-v2/lib/stages';
import { TONE_TEXT } from '../ui/toneClasses';

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: 'chờ xử lý',
  running: 'đang chạy',
  done: 'hoàn tất',
  error: 'lỗi',
};

function StageIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <CheckCircle2 className={`h-4 w-4 ${TONE_TEXT.success}`} aria-hidden />;
  if (status === 'error') return <CircleAlert className={`h-4 w-4 ${TONE_TEXT.danger}`} aria-hidden />;
  if (status === 'running') return <Loader2 className={`h-4 w-4 animate-spin ${TONE_TEXT.info}`} aria-hidden />;
  return <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />;
}

export function StageList({ stages, onSelectPhase }: { stages: StageMap; onSelectPhase?: (phase: LoanPhaseKey) => void }) {
  return (
    <div className="space-y-4">
      {PHASES.map((phase) => {
        const status = phaseStatusOf(stages, phase.key);
        return (
          <section key={phase.key} aria-label={`Giai đoạn ${phase.order}: ${phase.label}`}>
            <h4 className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
              <span>Giai đoạn {phase.order} · {phase.label}</span>
              {onSelectPhase && (
                <button type="button" onClick={() => onSelectPhase(phase.key)} className="rounded px-1 text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  Xem
                </button>
              )}
            </h4>
            <ol className="space-y-1" data-phase-status={status}>
              {STAGES.filter((stage) => stage.phase === phase.key).map((stage) => {
                const stageStatus = stages[stage.id];
                return (
                  <li
                    key={stage.id}
                    aria-current={stageStatus === 'running' ? 'step' : undefined}
                    aria-label={`${stage.label}: ${STATUS_LABEL[stageStatus]}`}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                  >
                    <StageIcon status={stageStatus} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-xs font-medium ${stageStatus === 'pending' ? 'text-muted-foreground' : 'text-foreground'}`}>{stage.label}</span>
                      <span className="block text-xs text-muted-foreground">{stage.caption}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{STATUS_LABEL[stageStatus]}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
