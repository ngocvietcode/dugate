'use client';

import { ListChecks, Sparkles } from 'lucide-react';
import type { IntakeAssessment } from '@/lib/pipelines/workflows/loan-appraisal/intake-assessment';
import { summaryView } from '@/app/loan-appraisal-v2/lib/intake-view';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';

/**
 * Tổng kết tóm tắt bộ hồ sơ (D-59): bản nháp cho Sale nắm nhanh tình trạng hồ sơ trước khi nộp lên bước sau.
 * Có kết quả do AI viết hoặc dự phòng theo quy tắc.
 */
export function DossierSummaryCard({ assessment }: { assessment: IntakeAssessment }) {
  const view = summaryView(assessment);
  if (!view) return null;
  return (
    <Card labelledBy="la2-dossier-summary-title">
      <CardHeader
        id="la2-dossier-summary-title"
        icon={Sparkles}
        title="Tổng kết hồ sơ"
        subtitle="Bản nháp để tham khảo trước khi nộp lên bước sau"
        actions={<Badge tone={view.source === 'LLM' ? 'info' : 'neutral'}>{view.source_label}</Badge>}
      />
      <CardBody>
        <p className="text-sm leading-6">{view.overview}</p>
        {view.highlights.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5">
            {view.highlights.map((h, i) => <li key={`${i}-${h}`}>{h}</li>)}
          </ul>
        )}
        {view.next_actions.length > 0 && (
          <section aria-label="Việc nên làm trước khi nộp" className="mt-3 border-t border-border pt-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-80">
              <ListChecks className="h-3.5 w-3.5" aria-hidden />Việc nên làm trước khi nộp
            </p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs leading-5">
              {view.next_actions.map((a, i) => <li key={`${i}-${a}`}>{a}</li>)}
            </ol>
          </section>
        )}
        {view.warning && <p className="mt-3 text-[11px] opacity-70">{view.warning}</p>}
      </CardBody>
    </Card>
  );
}
