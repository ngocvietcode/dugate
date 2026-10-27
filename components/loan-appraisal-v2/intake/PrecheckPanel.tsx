'use client';

import { CircleAlert, FileWarning, GitCompareArrows, ListChecks, ScanSearch } from 'lucide-react';
import type { DossierFile } from '@/app/loan-appraisal/types';
import type { DossierPrecheck } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';
import {
  LINE_STATUS_LABEL, RELATION_STATUS_LABEL, byUrgency, lineTone, lineViews, linesWithStatus, relationDocs, relationTone,
  type LineView,
} from '@/app/loan-appraisal-v2/lib/precheck-view';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Disclosure } from '../ui/Disclosure';
import { TONE_BOX } from '../ui/toneClasses';

const lineKey = (l: LineView, i: number) => `${l.item_key}-${l.subject ?? ''}-${i}`;
const lineTitle = (l: LineView) => `${l.label}${l.subject ? ` — ${l.subject}` : ''}${l.requirement === 'CONDITIONAL' ? ' (theo điều kiện)' : ''}`;

/** Danh sách đầy đủ các mục cùng một trạng thái (VD tất cả mục thiếu), luôn mở, không cắt bớt. */
function ActionList({ title, lines, tone, icon: Icon }: { title: string; lines: LineView[]; tone: 'warning' | 'info'; icon: typeof CircleAlert }) {
  if (lines.length === 0) return null;
  return (
    <section aria-label={title} className={`rounded-lg border px-3 py-2.5 ${TONE_BOX[tone]}`}>
      <p className="flex items-center gap-1.5 text-sm font-semibold"><Icon className="h-4 w-4" aria-hidden />{title} ({lines.length})</p>
      <ol className="mt-2 space-y-2">
        {lines.map((l, i) => (
          <li key={lineKey(l, i)} className="flex items-start gap-2 text-xs leading-5 text-foreground">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-current/15 text-[10px] font-bold text-current">{i + 1}</span>
            <span className="min-w-0">
              <span className="font-semibold">{lineTitle(l)}</span>
              <span className="text-muted-foreground"> · {l.group_label}</span>
              {l.note && <span className="block text-foreground/80">{l.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Chi tiết kiểm tra sơ bộ (D-73) sau thẻ tổng quan, xếp theo mức cần hành động: việc nên làm → mục thiếu → mục cần kiểm tra →
 * quan hệ giữa chứng từ → checklist theo nhóm. Mọi khối gập mở sẵn. Bản nháp cho Sale; không có mục "không áp dụng".
 */
export function PrecheckPanel({ precheck, files }: { precheck: DossierPrecheck; files: DossierFile[] }) {
  const groups = lineViews(precheck, files);
  const done = precheck.status === 'COMPLETED';
  const missing = linesWithStatus(precheck, files, 'MISSING');
  const uncertain = linesWithStatus(precheck, files, 'UNCERTAIN');
  const relations = precheck.relations.filter((r) => r.status !== 'CONSISTENT');
  const consistent = precheck.relations.filter((r) => r.status === 'CONSISTENT');
  return (
    <Card labelledBy="la2-precheck-title">
      <CardHeader
        id="la2-precheck-title"
        icon={ScanSearch}
        title="Kiểm tra sơ bộ"
        subtitle="AI đánh giá trên tóm tắt và dữ kiện chính của từng chứng từ"
        actions={<Badge tone="info">Bản nháp</Badge>}
      />
      <CardBody>
        {precheck.warning && <p className="mb-3 rounded-lg border border-[rgb(var(--la2-warning)/0.35)] bg-[rgb(var(--la2-warning)/0.10)] px-3 py-2 text-xs leading-5">{precheck.warning}</p>}
        {done && precheck.overview && <p className="text-sm leading-6">{precheck.overview}</p>}

        {done && (
          <div className="mt-3 space-y-3">
            {precheck.next_actions.length > 0 && (
              <section aria-label="Việc nên làm" className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><ListChecks className="h-4 w-4" aria-hidden />Việc nên làm</p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-xs leading-5">{precheck.next_actions.map((a, i) => <li key={`${i}-${a}`}>{a}</li>)}</ol>
              </section>
            )}

            <ActionList title="Mục còn thiếu" lines={missing} tone="warning" icon={CircleAlert} />
            <ActionList title="Mục cần kiểm tra" lines={uncertain} tone="warning" icon={FileWarning} />

            {relations.length > 0 && (
              <section aria-label="Điểm lệch giữa các chứng từ" className="space-y-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><GitCompareArrows className="h-4 w-4" aria-hidden />Quan hệ cần xem lại ({relations.length})</p>
                <ul className="space-y-2">
                  {relations.map((r, i) => (
                    <li key={`${i}-${r.topic}`} className={`rounded-lg border px-3 py-2 ${TONE_BOX[relationTone(r.status)]}`}>
                      <p className="text-xs font-semibold">{r.topic} — {RELATION_STATUS_LABEL[r.status]}</p>
                      <p className="text-xs leading-5 text-foreground">{r.message}</p>
                      {r.evidence.length > 0 && <p className="mt-0.5 text-[11px] text-muted-foreground">Căn cứ: {relationDocs(r.evidence, files).join('; ')}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {consistent.length > 0 && (
              <Disclosure defaultOpen lazy={false} summary={`Quan hệ đã khớp (${consistent.length})`}>
                <ul className="space-y-1.5">
                  {consistent.map((r, i) => (
                    <li key={`${i}-${r.topic}`} className="text-xs leading-5"><span className="font-medium">{r.topic}</span> — {r.message}</li>
                  ))}
                </ul>
              </Disclosure>
            )}

            {groups.length > 0 && (
              <section aria-label="Checklist theo nhóm" className="space-y-2">
                <p className="text-sm font-semibold">Checklist theo nhóm</p>
                {groups.map((g) => {
                  const provided = g.lines.filter((l) => l.status === 'PROVIDED').length;
                  return (
                    <Disclosure key={g.group} defaultOpen lazy={false} summary={`${g.label} — ${provided}/${g.lines.length} đã có`}>
                      <ul className="space-y-1.5">
                        {byUrgency(g.lines).map((l, i) => (
                          <li key={lineKey(l, i)} className="flex items-start justify-between gap-3 text-xs leading-5">
                            <div className="min-w-0">
                              <p className="font-medium">{lineTitle(l)}</p>
                              {l.note && l.status !== 'PROVIDED' && <p className="text-muted-foreground">{l.note}</p>}
                              {l.docs.length > 0 && <p className="truncate text-[11px] text-muted-foreground" title={l.docs.join('; ')}>Căn cứ: {l.docs.join('; ')}</p>}
                            </div>
                            <Badge tone={lineTone(l.status)} className="shrink-0">{LINE_STATUS_LABEL[l.status]}{l.adjusted ? ' *' : ''}</Badge>
                          </li>
                        ))}
                      </ul>
                    </Disclosure>
                  );
                })}
                <p className="text-[11px] text-muted-foreground">* Hệ thống tự hạ về &quot;Cần kiểm tra&quot; vì AI không nêu được chứng từ làm căn cứ hợp lệ hoặc bỏ sót mục này.</p>
              </section>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
