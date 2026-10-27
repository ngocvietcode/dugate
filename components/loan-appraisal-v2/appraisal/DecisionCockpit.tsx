import { Fingerprint, Info } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { COPY, businessReasonLabel, processingLabel, recommendationLabel, routeLabel } from '@/app/loan-appraisal-v2/copy';
import { processingTone } from '@/app/loan-appraisal-v2/lib/tone';
import { Badge } from '../ui/Badge';
import { Card, CardBody } from '../ui/Card';
import { TONE_BOX } from '../ui/toneClasses';
import { MetricGrid } from './MetricGrid';

/** Tổng hợp từ chỉ số tài chính và bộ rule (engine + LLM); không còn đánh giá 5C. */
export function DecisionCockpit({ result }: { result: AppraisalResult }) {
  const meta = processingLabel(result.processing_status);
  const tone = processingTone(result.processing_status);
  const recommendation = result.recommendation?.recommendation;
  const route = result.review?.route;
  const reasons = [...new Set(result.recommendation?.reason_codes ?? result.review?.reasons ?? [])];
  return (
    <Card labelledBy="la2-cockpit-title">
      <CardBody className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={tone}>{meta.label}</Badge>
              <span className="text-xs text-muted-foreground">Mô hình kiểm soát v{result.output_version}</span>
            </div>
            <h3 id="la2-cockpit-title" className="mt-3 text-xl font-semibold">{meta.headline}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Kết quả được tổng hợp từ evidence, financial metrics và các rule engine / rule LLM.</p>
          </div>
          <div className={`rounded-xl border p-4 ${TONE_BOX[tone]}`}>
            <p className="text-xs font-semibold">Khuyến nghị nghiệp vụ</p>
            <p className="mt-2 text-xl font-semibold">{recommendationLabel(recommendation)}</p>
            <div className="mt-3 border-t border-current/20 pt-3">
              <p className="text-xs">Tuyến tiếp theo</p>
              <p className="text-sm font-semibold">{routeLabel(route)}</p>
            </div>
          </div>
        </div>
        <MetricGrid metrics={result.financial_metrics} />
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground">Trọng tâm cần xử lý</h4>
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {(reasons.length > 0 ? reasons.slice(0, 4) : ['WAITING_FOR_DECISION_SIGNALS']).map((reason) => (
              <li key={reason} className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs"><Fingerprint className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />{businessReasonLabel(reason)}</li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{COPY.approvalBoundary}</p>
        </div>
      </CardBody>
    </Card>
  );
}
