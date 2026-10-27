import { AlertTriangle, ArrowRight, Circle } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { safeArray } from '@/app/loan-appraisal-v2/lib/selectors';
import { Button } from '../ui/Button';
import { TONE_BOX } from '../ui/toneClasses';

export function ProvisionalBanner({ result, onGoToProfile }: { result: AppraisalResult; onGoToProfile: () => void }) {
  const readiness = result.dossier_readiness;
  if (!readiness?.appraisal_conditional) return null;
  const supplements = safeArray(readiness.supplement_requests);
  return (
    <section role="status" aria-label="Kết quả tạm" className={`rounded-xl border p-4 ${TONE_BOX.warning}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-2xl items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="text-sm font-semibold">Kết quả tạm trên hồ sơ chưa đầy đủ</p>
            <p className="mt-1 text-xs leading-5">Hồ sơ vẫn được thẩm định để có cái nhìn sớm, nhưng đây chưa phải kết luận cuối. Bổ sung các nội dung dưới đây rồi chạy lại để có kết quả chính thức.</p>
          </div>
        </div>
        <Button size="sm" onClick={onGoToProfile}>Xem hồ sơ khách hàng<ArrowRight className="h-3.5 w-3.5" aria-hidden /></Button>
      </div>
      {supplements.length > 0 && (
        <ul className="mt-3 grid gap-1.5 border-t border-current/20 pt-3 sm:grid-cols-2">
          {supplements.slice(0, 6).map((item) => <li key={item} className="flex items-start gap-1.5 text-xs"><Circle className="mt-1 h-2 w-2 shrink-0 fill-current" aria-hidden />{item}</li>)}
          {supplements.length > 6 && <li className="text-xs italic">và {supplements.length - 6} nội dung khác</li>}
        </ul>
      )}
    </section>
  );
}
