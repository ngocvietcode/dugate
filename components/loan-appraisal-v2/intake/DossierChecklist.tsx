'use client';

import { ClipboardList } from 'lucide-react';
import type { DossierOutputV3 } from '@/app/loan-appraisal/types';
import { CHECKLIST_STATUS_LABELS, checklistGroups, checklistStatusTone, hiddenChecklistCount, personName } from '@/app/loan-appraisal-v2/lib/dossier-view';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';

/** Checklist 46 mục theo nhóm của S4 (V2-R10). Dòng PERSON ghi rõ người, dòng ASSET ghi rõ tài sản. */
export function DossierChecklist({ checklist, people }: { checklist: DossierOutputV3['checklist']; people: DossierOutputV3['customer_360'] }) {
  if (checklist.items.length === 0) {
    return (
      <Card labelledBy="la2-checklist-title">
        <CardHeader id="la2-checklist-title" icon={ClipboardList} title="Checklist hồ sơ" subtitle={checklist.status_code === 'INVALID_FLOW' ? 'Thiếu hoặc sai luồng hồ sơ (FAST/FULL/SIMPLE) nên chưa chấm checklist.' : 'Chưa có kết quả checklist.'} />
      </Card>
    );
  }
  const groups = checklistGroups(checklist);
  const hidden = hiddenChecklistCount(checklist);
  return (
    <Card labelledBy="la2-checklist-title">
      <CardHeader
        id="la2-checklist-title"
        icon={ClipboardList}
        title="Checklist hồ sơ"
        subtitle={`Luồng ${checklist.flow ?? '—'} · đầy đủ ${checklist.completeness_percent ?? 0}%${hidden > 0 ? ` · đã ẩn ${hidden} mục không áp dụng` : ''}`}
      />
      <CardBody>
        <div className="space-y-4">
          {groups.filter((g) => g.items.length > 0).map((g) => (
            <section key={g.group} aria-label={g.label}>
              <h4 className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
                {g.label}
                {g.summary && <span className="font-normal text-muted-foreground">{g.summary.present_count + g.summary.substituted_count}/{g.summary.total_required} mục bắt buộc{g.summary.completeness_percent !== null ? ` · ${g.summary.completeness_percent}%` : ''}</span>}
              </h4>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {g.items.map((it, i) => (
                  <li key={`${it.item_key}-${it.person_id ?? it.asset_id ?? i}`} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">
                        {it.item_label}
                        {it.person_id && <span className="text-muted-foreground"> · {personName(people, it.person_id)}</span>}
                        {it.asset_id && <span className="text-muted-foreground"> · {it.asset_id}</span>}
                        {!it.required && <span className="text-muted-foreground"> · không bắt buộc</span>}
                      </p>
                      {it.message && it.status !== 'PRESENT' && <p className="text-xs text-muted-foreground">{it.message}</p>}
                      {it.note && <p className="text-xs text-muted-foreground">{it.note}</p>}
                      {it.found_in.length > 0 && <p className="truncate text-[11px] text-muted-foreground" title={it.found_in.map((f) => f.file_name).join(', ')}>Nguồn: {[...new Set(it.found_in.map((f) => f.file_name))].join(', ')}</p>}
                    </div>
                    <Badge tone={checklistStatusTone(it.status)}>{CHECKLIST_STATUS_LABELS[it.status] ?? it.status}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
