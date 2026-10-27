import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, FileWarning, GitCompareArrows, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DossierFile } from '@/app/loan-appraisal/types';
import { phase1Counts, phase1Verdict } from '@/app/loan-appraisal-v2/lib/precheck-view';
import type { Tone } from '@/app/loan-appraisal-v2/lib/tone';
import type { DossierPrecheck } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';
import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { TONE_BOX, TONE_TEXT } from '../ui/toneClasses';

const BAR: Record<Tone, string> = {
  success: 'bg-[rgb(var(--la2-success))]', warning: 'bg-[rgb(var(--la2-warning))]', danger: 'bg-[rgb(var(--la2-danger))]',
  info: 'bg-[rgb(var(--la2-info))]', neutral: 'bg-muted-foreground',
};

/** Một con số lớn: icon + số + nhãn. Số 0 mờ đi để mắt dừng ở chỗ có vấn đề. */
function Stat({ icon: Icon, value, label, tone }: { icon: LucideIcon; value: number | string; label: string; tone: Tone }) {
  const dim = value === 0;
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${dim ? 'border-border bg-muted/40 text-muted-foreground' : TONE_BOX[tone]}`}>
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-xl font-bold leading-none tabular-nums">{value}</p>
        <p className="mt-1 truncate text-[11px] font-medium">{label}</p>
      </div>
    </div>
  );
}

/**
 * Thẻ đầu giai đoạn 1: kết luận một dòng + 4 con số (đã có, thiếu, cần kiểm tra, lệch giữa chứng từ) + thanh độ phủ checklist
 * + nút chuyển giai đoạn 2. Sale nhìn qua là biết hồ sơ đang ở tình trạng nào, cần làm gì tiếp.
 */
export function Phase1Overview({ precheck, files, running = false, onGoToAppraisal, appraisalPending = false, appraisalStarting = false }: {
  precheck: DossierPrecheck | null;
  files: DossierFile[];
  /** Đang chạy giai đoạn 1 nhưng chưa có kết quả kiểm tra sơ bộ. */
  running?: boolean;
  onGoToAppraisal: () => void;
  /** D-51: giai đoạn 2 chưa chạy → nút chạy tiếp (resume); ngược lại chỉ chuyển tab. */
  appraisalPending?: boolean;
  appraisalStarting?: boolean;
}) {
  const verdict = phase1Verdict(precheck, files, running);
  const c = phase1Counts(precheck, files);
  const completed = precheck?.status === 'COMPLETED';
  const VerdictIcon = verdict.tone === 'success' ? CheckCircle2 : verdict.tone === 'info' ? Loader2 : AlertTriangle;
  return (
    <Card labelledBy="la2-phase1-title" className={`border ${TONE_BOX[verdict.tone]}`}>
      <CardBody>
        <div className="flex items-start gap-3">
          <VerdictIcon className={`mt-0.5 h-7 w-7 shrink-0 ${verdict.tone === 'info' ? 'animate-spin' : ''}`} aria-hidden />
          <div className="min-w-0">
            <h3 id="la2-phase1-title" className="text-lg font-bold leading-tight">{verdict.label}</h3>
            <p className="mt-0.5 text-sm text-foreground">{verdict.headline}</p>
          </div>
        </div>

        {completed && (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-foreground lg:grid-cols-4" aria-label="Tình trạng hồ sơ">
              <Stat icon={CheckCircle2} value={c.provided} label="Đã có" tone="success" />
              <Stat icon={CircleAlert} value={c.missing} label="Thiếu" tone="warning" />
              <Stat icon={FileWarning} value={c.uncertain} label="Cần kiểm tra" tone="warning" />
              <Stat icon={GitCompareArrows} value={c.relations_attention} label="Lệch giữa chứng từ" tone="warning" />
            </dl>
            {c.coverage_percent !== null && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-foreground">
                  <span>Độ phủ checklist</span>
                  <span className="font-semibold tabular-nums">{c.provided}/{c.total} mục · {c.coverage_percent}%</span>
                </div>
                <div role="progressbar" aria-label="Độ phủ checklist" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.coverage_percent} className="mt-1 h-2 overflow-hidden rounded-full bg-background/60">
                  <div className={`h-full rounded-full ${BAR[verdict.tone]}`} style={{ width: `${c.coverage_percent}%` }} />
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={onGoToAppraisal} disabled={appraisalStarting || running}>
            {appraisalPending ? (appraisalStarting ? 'Đang chuyển sang giai đoạn 2…' : 'Chuyển sang giai đoạn 2') : 'Xem kết quả giai đoạn 2'}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
          <span className={`text-xs ${TONE_TEXT.neutral}`}>
            {appraisalPending
              ? 'Giai đoạn 2: OCR, đối chiếu và thẩm định. Có thể chuyển kể cả khi hồ sơ chưa đầy đủ.'
              : 'Giai đoạn 2 luôn xem được, kể cả khi hồ sơ chưa đầy đủ.'}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
