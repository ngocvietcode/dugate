import { Route } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { COPY, recommendationLabel, routeLabel } from '@/app/loan-appraisal-v2/copy';
import { collectExceptions } from '@/app/loan-appraisal-v2/lib/selectors';
import { Badge } from '../ui/Badge';

export function StickySummaryBar({ result }: { result: AppraisalResult }) {
  const conditional = Boolean(result.dossier_readiness?.appraisal_conditional);
  const exceptions = collectExceptions(result);
  return (
    <div role="region" aria-label="Tóm tắt quyết định" className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className="min-w-[180px] flex-1">
        <p className="text-sm font-semibold">{conditional ? 'Cần bổ sung hồ sơ trước khi kết luận chính thức' : 'Hồ sơ đã đủ căn cứ để chuyển cấp thẩm định'}</p>
        <p className="text-xs text-muted-foreground">
          {exceptions.length > 0 ? `${exceptions.length} điểm cần xử lý · ` : ''}Khuyến nghị: {recommendationLabel(result.recommendation?.recommendation)}
        </p>
      </div>
      <Badge tone="info" icon={Route}>{routeLabel(result.review?.route)}</Badge>
      {result.review?.required_role && <Badge>{result.review.required_role}</Badge>}
      <span className="text-xs text-muted-foreground">{COPY.approvalBoundary}</span>
    </div>
  );
}
