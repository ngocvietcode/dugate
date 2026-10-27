import { AlertTriangle, CheckCircle2, Gauge, Info } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { COPY } from '@/app/loan-appraisal-v2/copy';
import { collectExceptions } from '@/app/loan-appraisal-v2/lib/selectors';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { TONE_BOX } from '../ui/toneClasses';

function Ring({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  const circumference = 214;
  return (
    <div className="relative h-20 w-20 shrink-0" role="img" aria-label={`Độ đầy đủ hồ sơ ${safe}%`}>
      <svg width="80" height="80" viewBox="0 0 82 82" className="-rotate-90" aria-hidden>
        <circle cx="41" cy="41" r="34" fill="none" strokeWidth="8" className="stroke-muted" />
        <circle cx="41" cy="41" r="34" fill="none" strokeWidth="8" strokeLinecap="round" className="stroke-primary"
          strokeDasharray={circumference} strokeDashoffset={circumference - (circumference * safe) / 100} />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <b className="text-lg tabular-nums">{safe}%</b>
        <span className="text-[11px] text-muted-foreground">đầy đủ</span>
      </div>
    </div>
  );
}

export function DecisionPanel({ result, onGoToProfile }: { result: AppraisalResult; onGoToProfile: () => void }) {
  const readiness = result.dossier_readiness;
  const exceptions = collectExceptions(result);
  const conditional = Boolean(readiness?.appraisal_conditional);
  return (
    <Card labelledBy="la2-decision-title">
      <CardHeader id="la2-decision-title" icon={Gauge} title="Kết luận sơ bộ" />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-3">
          <Ring value={readiness?.completeness_percent ?? result.completeness_percent ?? 0} />
          <p className="text-xs leading-5 text-muted-foreground">
            {conditional
              ? 'Hồ sơ vẫn được thẩm định nhưng kết quả là tạm. Bổ sung nội dung còn thiếu để có kết quả chính thức.'
              : 'Hồ sơ đủ chứng từ và dữ liệu cần thiết cho bước thẩm định.'}
          </p>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground">Điểm cần xử lý ({exceptions.length})</h4>
          <ul className="mt-2 space-y-2">
            {exceptions.length === 0 && (
              <li className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${TONE_BOX.success}`}>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Không còn điểm cần xử lý.
              </li>
            )}
            {exceptions.slice(0, 4).map((item) => (
              <li key={`${item.id}-${item.title}`} className={`rounded-lg border p-2.5 ${TONE_BOX.warning}`}>
                <p className="flex items-start gap-1.5 text-xs font-semibold"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /><span className="font-mono">{item.id}</span><span className="min-w-0 flex-1">{item.title}</span></p>
                <p className="mt-1 break-words text-xs">{item.detail}</p>
              </li>
            ))}
          </ul>
          {exceptions.length > 4 && <Button size="sm" className="mt-2 w-full" onClick={onGoToProfile}>Xem tất cả {exceptions.length} điểm ở giai đoạn 2</Button>}
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{COPY.approvalBoundary}</p>
      </CardBody>
    </Card>
  );
}
