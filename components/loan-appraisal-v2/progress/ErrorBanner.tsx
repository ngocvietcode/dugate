import { CircleAlert, KeyRound } from 'lucide-react';
import { COPY } from '@/app/loan-appraisal-v2/copy';
import type { RunError } from '@/app/loan-appraisal-v2/lib/run-reducer';
import { TONE_BOX } from '../ui/toneClasses';
import type { ReactNode } from 'react';

export function ErrorBanner({ error, needsApiKey, action }: { error: RunError; needsApiKey: boolean; action?: ReactNode }) {
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-xl border p-4 ${TONE_BOX.danger}`}>
      {needsApiKey ? <KeyRound className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Không thể hoàn tất phiên thẩm định</p>
        <p className="mt-1 break-words text-xs leading-5">{error.message}</p>
        {needsApiKey && <p className="mt-1 text-xs leading-5">{COPY.needsApiKey}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
