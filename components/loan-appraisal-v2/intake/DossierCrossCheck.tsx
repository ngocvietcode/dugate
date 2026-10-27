'use client';

import { useState } from 'react';
import { GitCompareArrows } from 'lucide-react';
import type { DossierEvidence, DossierOutputV3 } from '@/app/loan-appraisal/types';
import { crossCheckFilter, crossCheckSourceText, formatVnd, groupCrossCheckValues, MATCH_LABELS, matchTone, personName } from '@/app/loan-appraisal-v2/lib/dossier-view';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { TONE_BOX } from '../ui/toneClasses';

function valueText(v: unknown): string {
  if (v && typeof v === 'object' && 'full_text' in (v as object)) return String((v as { full_text: unknown }).full_text ?? '');
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1000 ? formatVnd(v) : String(v);
  return v === null || v === undefined ? '' : String(v);
}

const FILTERS: Array<{ key: 'MISMATCH' | 'NEAR_MATCH' | 'MATCH' | 'ALL'; label: string }> = [
  { key: 'MISMATCH', label: 'Cần xem' }, { key: 'NEAR_MATCH', label: 'Gần khớp' }, { key: 'MATCH', label: 'Khớp' }, { key: 'ALL', label: 'Tất cả' },
];

/** Đối chiếu chéo theo `results[]` của S5 + logic rule (V2-R10). Mặc định "Cần xem": mọi dòng chưa khớp, lệch thật trước (S5-R17). */
export function DossierCrossCheck({ crossCheck, people, evidences = [] }: {
  crossCheck: DossierOutputV3['cross_check'];
  people: DossierOutputV3['customer_360'];
  /** Để hiện mẫu biểu của từng nguồn (tra theo evidence_id). */
  evidences?: ReadonlyArray<Pick<DossierEvidence, 'evidence_id' | 'doc_type_label'>>;
}) {
  const [mode, setMode] = useState<'MISMATCH' | 'NEAR_MATCH' | 'MATCH' | 'ALL'>('MISMATCH');
  const rows = crossCheckFilter(crossCheck.results, mode);
  const violated = crossCheck.logic_findings.filter((f) => f.violated);
  const count = (s: string) => crossCheck.results.filter((r) => r.match_status === s).length;
  const near = count('NEAR_MATCH');
  const subtitle = crossCheck.status_code === 'ROLE_REGISTRY_UNAVAILABLE'
    ? 'Chưa xác định được người trong hồ sơ nên chưa đối chiếu.'
    : `${crossCheck.results.length} phép so · ${count('MISMATCH') + count('UNDETERMINED')} không khớp/chưa kết luận${near ? ` · ${near} gần khớp` : ''}`;
  return (
    <Card labelledBy="la2-xck-title">
      <CardHeader
        id="la2-xck-title"
        icon={GitCompareArrows}
        title="Đối chiếu chéo giữa chứng từ"
        subtitle={subtitle}
        actions={(
          <div role="group" aria-label="Lọc kết quả đối chiếu" className="flex gap-1">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" aria-pressed={mode === f.key} onClick={() => setMode(f.key)}
                className={`rounded-md border px-2 py-1 text-xs ${mode === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                {f.label}
              </button>
            ))}
          </div>
        )}
      />
      <CardBody>
        {violated.length > 0 && (
          <ul className="mb-3 space-y-2">
            {violated.map((f) => (
              <li key={f.finding_id} className={`rounded-lg border px-3 py-2 text-xs ${f.severity === 'HIGH' ? TONE_BOX.warning : TONE_BOX.warning}`}>
                {f.message}{f.needs_ba_confirmation && <span className="ml-1 font-semibold">(Chờ BA xác nhận)</span>}
              </li>
            ))}
          </ul>
        )}
        {rows.length === 0
          ? <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Không có dòng nào theo bộ lọc.</p>
          : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.result_id} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold">
                      {r.field_label}
                      <span className="font-normal text-muted-foreground"> · {r.person_id ? personName(people, r.person_id) : r.asset_id}{r.person_id && r.asset_id ? ` · ${r.asset_id}` : ''}</span>
                    </p>
                    <Badge tone={matchTone(r.match_status)}>{MATCH_LABELS[r.match_status] ?? r.match_status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                  <ul className="mt-1 space-y-1">
                    {groupCrossCheckValues(r.values, evidences).map((g) => (
                      <li key={g.key} className="text-[11px]">
                        <span className="font-medium">{valueText(g.value)}</span>
                        {g.sources.length > 1 && <span className="ml-1 text-muted-foreground">({g.sources.length} nguồn)</span>}
                        <span className="block text-muted-foreground">
                          {g.sources.map(crossCheckSourceText).join('; ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}
