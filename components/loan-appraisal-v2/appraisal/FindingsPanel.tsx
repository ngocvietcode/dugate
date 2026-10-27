import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { CHECKLIST_STATUS_LABELS, checklistStatusTone, personName } from '@/app/loan-appraisal-v2/lib/dossier-view';
import { safeArray } from '@/app/loan-appraisal-v2/lib/selectors';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { TONE_BOX } from '../ui/toneClasses';
import { DossierCrossCheck } from '../intake/DossierCrossCheck';

export function FindingsPanel({ result }: { result: AppraisalResult }) {
  const risks = [...safeArray(result.risk_notes), ...safeArray(result.system_notes)];
  const exceptions = safeArray(result.checklist?.items).filter((item) => item.required && item.status !== 'PRESENT' && item.status !== 'SUBSTITUTED');
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <DossierCrossCheck crossCheck={result.cross_check} people={result.customer_360} evidences={result.documents?.evidences ?? []} />
      <div className="space-y-5">
        <section aria-labelledby="la2-exceptions-title">
          <div className="mb-3 flex items-center justify-between"><h3 id="la2-exceptions-title" className="text-sm font-semibold">Ngoại lệ hồ sơ</h3><span className="text-xs text-muted-foreground">{exceptions.length}</span></div>
          {exceptions.length > 0 ? (
            <ul className="space-y-2">{exceptions.map((item, i) => (
              <li key={`${item.item_key}-${item.person_id ?? item.asset_id ?? i}`} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">{item.item_label}{item.person_id && <span className="text-muted-foreground"> · {personName(result.customer_360, item.person_id)}</span>}</p>
                  <Badge tone={checklistStatusTone(item.status)}>{CHECKLIST_STATUS_LABELS[item.status] ?? item.status}</Badge>
                </div>
                {item.message && <p className="mt-2 text-xs text-muted-foreground">{item.message}</p>}
              </li>
            ))}</ul>
          ) : <EmptyState icon={CheckCircle2} title="Không có ngoại lệ hồ sơ" />}
        </section>
        <section aria-labelledby="la2-risks-title">
          <h3 id="la2-risks-title" className="mb-3 text-sm font-semibold">Lưu ý rủi ro</h3>
          {risks.length > 0 ? (
            <ul className="space-y-2">{risks.map((risk, i) => (
              <li key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${TONE_BOX.warning}`}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{risk}</li>
            ))}</ul>
          ) : <EmptyState icon={ShieldCheck} title="Chưa ghi nhận lưu ý rủi ro" />}
        </section>
      </div>
    </div>
  );
}
