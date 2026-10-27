import { CheckCircle2, LockKeyhole, Route } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { businessReasonLabel, recommendationLabel, routeLabel } from '@/app/loan-appraisal-v2/copy';
import { formatCurrencyVnd } from '@/app/loan-appraisal-v2/lib/format';
import { safeArray } from '@/app/loan-appraisal-v2/lib/selectors';
import { Badge } from '../ui/Badge';
import { Card, CardBody } from '../ui/Card';
import { Disclosure } from '../ui/Disclosure';
import { EmptyState } from '../ui/EmptyState';
import { KeyValue } from '../ui/KeyValue';

function Conditions({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-xl border border-border bg-muted/30 p-4">
      <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
      <ul className="mt-3 space-y-2">
        {items.length > 0 ? items.map((item, i) => <li key={i} className="flex items-start gap-2 text-xs leading-5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />{item}</li>)
          : <li className="text-xs text-muted-foreground">Không có điều kiện.</li>}
      </ul>
    </section>
  );
}

export function RecommendationPanel({ result }: { result: AppraisalResult }) {
  const rec = result.recommendation;
  const review = result.review;
  if (!rec && !review) return <EmptyState icon={Route} title="Artifact recommendation/review chưa sẵn sàng" />;
  const shownRec = rec?.recommendation;
  const shownRoute = review?.route;
  const reviewRequired = rec?.review_required || review?.required;
  const reasons = [...new Set([...safeArray(review?.reasons), ...safeArray(rec?.reason_codes)])];
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card labelledBy="la2-rec-title">
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs text-muted-foreground">Khuyến nghị khoản vay</p><h3 id="la2-rec-title" className="mt-1 text-xl font-semibold">{recommendationLabel(shownRec)}</h3></div>
              <Badge tone={reviewRequired ? 'warning' : 'success'}>{reviewRequired ? 'Cần thẩm định' : 'Đủ điều kiện xử lý'}</Badge>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2">
              <KeyValue label="Hạn mức đề xuất" value={formatCurrencyVnd(rec?.suggested_amount_vnd ?? null)} />
              <KeyValue label="Kỳ hạn đề xuất" value={rec?.suggested_tenor_months ? `${rec.suggested_tenor_months} tháng` : 'Chưa đủ dữ liệu'} />
            </dl>
            <Disclosure defaultOpen lazy={false} summary={`Chi tiết kiểm soát · ${reasons.length} mã hệ thống`}>
              <ul className="flex flex-wrap gap-2">{reasons.map((r) => <li key={r} className="rounded-md border border-border bg-card px-2 py-1 font-mono text-xs">{r}</li>)}</ul>
            </Disclosure>
          </CardBody>
        </Card>
        <Card labelledBy="la2-route-title">
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs text-muted-foreground">Tuyến xử lý hồ sơ</p><h3 id="la2-route-title" className="mt-1 text-xl font-semibold">{routeLabel(shownRoute)}</h3></div>
              <Badge tone={reviewRequired ? 'warning' : 'success'}>{reviewRequired ? 'Bắt buộc review' : 'Không bắt buộc'}</Badge>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2">
              <KeyValue label="Mã tuyến xử lý" value={shownRoute ?? '—'} />
              <KeyValue label="Vai trò xử lý" value={review?.required_role ?? 'Không chỉ định'} />
            </dl>
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground">Lý do định tuyến</h4>
              <ul className="mt-2 space-y-2">{reasons.length > 0 ? reasons.map((r) => (
                <li key={r} className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs"><Route className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />{businessReasonLabel(r)}</li>
              )) : <li className="text-xs italic text-muted-foreground">Không có lý do định tuyến.</li>}</ul>
            </div>
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Conditions title="Điều kiện trước giải ngân" items={safeArray(rec?.conditions_precedent)} />
        <Conditions title="Cam kết cần duy trì" items={safeArray(rec?.covenants)} />
      </div>
      <p className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span><strong className="text-foreground">Ranh giới quyết định:</strong> đây là khuyến nghị và định tuyến workflow. Quyền phê duyệt cuối thuộc hệ thống hoặc người có thẩm quyền bên ngoài.</span></p>
    </div>
  );
}
