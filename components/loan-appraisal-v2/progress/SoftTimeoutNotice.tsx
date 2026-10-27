import { Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { COPY } from '@/app/loan-appraisal-v2/copy';
import { TONE_BOX } from '../ui/toneClasses';

/** Cảnh báo mềm (không phải lỗi). `stalled` = đã dừng tự động theo dõi sau 60 phút. */
export function SoftTimeoutNotice({ stalled, action }: { stalled: boolean; action?: ReactNode }) {
  return (
    <div role="status" className={`flex items-start gap-3 rounded-xl border p-4 ${TONE_BOX.warning}`}>
      <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="flex-1">
        <p className="text-sm font-semibold">{stalled ? COPY.stalledTitle : COPY.softTimeoutTitle}</p>
        <p className="mt-1 text-xs leading-5">{stalled ? COPY.stalledBody : COPY.softTimeoutBody}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
