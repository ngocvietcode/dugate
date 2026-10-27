'use client';

import { FileText } from 'lucide-react';
import type { DossierFile } from '@/app/loan-appraisal/types';
import { classificationCounts, classifiedFileViews, type ClassifiedDocView } from '@/app/loan-appraisal-v2/lib/classification-view';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';

/** Thông tin chính (key_facts) của một mẫu biểu: gom theo đối tượng (người vay, tài sản...), mỗi dòng nhãn → giá trị → trang. */
function KeyFacts({ doc }: { doc: ClassifiedDocView }) {
  if (doc.facts.length === 0) return null;
  return (
    <div className="mt-2 space-y-2" aria-label={`Thông tin chính: ${doc.label}`}>
      {doc.facts.map((g) => (
        <dl key={g.subject} className="rounded-md border border-border bg-muted/40">
          {doc.facts.length > 1 && <dt className="border-b border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">{g.label}</dt>}
          <dd>
            <table className="w-full text-xs">
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={`${r.key}-${i}`} className="border-b border-border/60 last:border-0">
                    <th scope="row" className="w-2/5 px-2.5 py-1 text-left align-top font-normal text-muted-foreground">{r.label}</th>
                    <td className="px-2.5 py-1 align-top font-medium break-words">{r.value}</td>
                    <td className="w-12 px-2.5 py-1 text-right align-top text-[11px] text-muted-foreground">{r.page ? `tr. ${r.page}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </dd>
        </dl>
      ))}
    </div>
  );
}

/**
 * Kết quả phân loại S1 (giai đoạn 1), theo thứ tự: tên file → tên mẫu biểu → tóm tắt → thông tin chính.
 * Tóm tắt và thông tin chính thuộc TỪNG mẫu biểu (S1 sinh theo từng bản thể), nên file nhiều mẫu biểu có nhiều khối riêng. Mở sẵn hết.
 */
export function ClassificationResults({ files }: { files: DossierFile[] }) {
  const views = classifiedFileViews(files);
  if (views.length === 0) return null;
  const counts = classificationCounts(files);
  return (
    <Card labelledBy="la2-classify-title">
      <CardHeader
        id="la2-classify-title"
        icon={FileText}
        title="Kết quả phân loại chứng từ"
        subtitle={`${counts.classified}/${counts.files} file nhận diện được · ${counts.docs} mẫu biểu`}
      />
      <CardBody>
        <div className="space-y-4">
          {views.map((f) => (
            <section key={f.file_id} aria-label={f.file_name}>
              <h4 className="flex flex-wrap items-baseline gap-x-2 border-b border-border pb-1.5 text-sm font-semibold">
                <span className="min-w-0 break-all" title={f.file_name}>{f.file_name}</span>
                <span className="text-xs font-normal text-muted-foreground">{f.page_count ? `${f.page_count} trang · ` : ''}{f.docs.length} mẫu biểu</span>
              </h4>
              <ul className="mt-2 space-y-3">
                {f.docs.map((d) => (
                  <li key={d.key} className="rounded-lg border border-border px-3 py-2.5">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-semibold">{d.label}</span>
                      <span className="text-xs text-muted-foreground">{d.pages} · {d.confidence_percent}%</span>
                      {d.needs_review && <Badge tone="warning">Cần xem lại</Badge>}
                    </p>
                    {d.summary && <p className="mt-1 text-xs leading-5 text-foreground/80">{d.summary}</p>}
                    <KeyFacts doc={d} />
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
