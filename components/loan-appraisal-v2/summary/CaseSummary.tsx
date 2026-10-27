import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { formatMetric } from '@/app/loan-appraisal-v2/lib/format';
import { collectExceptions, customerNameFrom, readinessMeta } from '@/app/loan-appraisal-v2/lib/selectors';
import { Badge } from '../ui/Badge';
import { Card, CardBody } from '../ui/Card';
import { KeyValue, KeyValueGrid } from '../ui/KeyValue';

export function CaseSummary({ result, operationId }: { result: AppraisalResult; operationId: string | null }) {
  const readiness = result.dossier_readiness;
  const meta = readinessMeta(readiness?.status);
  const exceptions = collectExceptions(result);
  const metrics = result.financial_metrics ?? {};
  return (
    <Card labelledBy="la2-case-title">
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="la2-case-title" className="text-lg font-semibold">{customerNameFrom(result) ?? 'Chưa xác định từ chứng từ'}</h2>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {exceptions.length > 0 && <Badge tone="warning">{exceptions.length} điểm cần xử lý</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {result.product_name || result.product_code}
              {result.flow ? ` · Luồng ${result.flow}` : ''}
              {result.workflow_version ? ` · workflow ${result.workflow_version}` : ''}
              {operationId ? ` · OP ${operationId.slice(0, 8)}` : ''}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Kết quả sơ bộ do AI tổng hợp. {`Người có thẩm quyền quyết định.`}</p>
        </div>
        <div className="mt-4">
          <KeyValueGrid columns="grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
            <KeyValue label="Độ đầy đủ hồ sơ" value={`${readiness?.completeness_percent ?? result.completeness_percent ?? 0}%`} />
            <KeyValue label="Chứng từ bắt buộc" value={readiness ? `${readiness.required_present}/${readiness.required_total}` : '—'} />
            <KeyValue label="DSCR" value={formatMetric(metrics.dscr)} />
            <KeyValue label="LTV" value={formatMetric(metrics.ltv)} />
            <KeyValue label="Số tiền đề nghị" value={formatMetric(metrics.requested_amount)} />
          </KeyValueGrid>
        </div>
      </CardBody>
    </Card>
  );
}
