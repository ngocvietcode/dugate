'use client';

import { AlertCircle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import type { IntakeAssessment } from '@/lib/pipelines/workflows/loan-appraisal/intake-assessment';
import { criterionViews, type CriterionView } from '@/app/loan-appraisal-v2/lib/intake-view';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { TONE_BOX } from '../ui/toneClasses';

function Lines({ groups, icon: Icon, iconClass, label }: {
  groups: CriterionView['findings'] | CriterionView['passed'];
  icon: typeof CheckCircle2;
  iconClass: string;
  label: string;
}) {
  return (
    <section aria-label={label} className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      {groups.map((g) => (
        <div key={g.group ?? '_'} className="mt-1">
          {g.group && <p className="text-[11px] font-medium opacity-80">{g.group}</p>}
          <ul className="space-y-0.5">
            {g.lines.map((l) => (
              <li key={l.code} className={`flex items-start gap-1.5 text-xs ${'accepted' in l && l.accepted ? 'opacity-70' : ''}`}>
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconClass}`} aria-hidden />
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * Kết quả tiếp nhận theo 4 tiêu chí của Sale (D-47, D-50): mỗi tiêu chí liệt kê ĐỦ điểm chưa đạt, bên dưới là các
 * điểm đã đạt để Sale có cái nhìn tổng quan. D-91: dựng sau S2 nên thuộc giai đoạn 2 (tab Hồ sơ khách hàng).
 */
export function IntakeCriteria({ assessment }: { assessment: IntakeAssessment }) {
  const views = criterionViews(assessment);
  return (
    <Card labelledBy="la2-criteria-title">
      <CardHeader
        id="la2-criteria-title"
        icon={ClipboardCheck}
        title="Kết quả tiếp nhận hồ sơ"
        subtitle={assessment.review ? '4 tiêu chí trước khi chuyển CBQL/CO · dựng từ kiểm tra sơ bộ, chỉ để tham khảo' : '4 tiêu chí trước khi chuyển CBQL/CO'}
        actions={<Badge tone={assessment.ready_for_handover ? 'success' : 'warning'}>{assessment.ready_for_handover ? 'Sẵn sàng chuyển thẩm định' : 'Chưa sẵn sàng'}</Badge>}
      />
      <CardBody>
        <ol className="space-y-3">
          {views.map((v) => (
            <li key={v.key} className={`rounded-lg border px-3 py-2 ${TONE_BOX[v.tone]}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold">{v.title}</p>
                <Badge tone={v.tone}>{v.status_label}</Badge>
              </div>
              <p className="mt-0.5 text-[11px] opacity-80">{v.goal}</p>
              <p className="mt-1 text-xs">{v.summary}</p>
              {v.findings_count > 0 && <Lines groups={v.findings} icon={AlertCircle} iconClass="text-[rgb(var(--la2-warning))]" label={`Chưa đạt (${v.findings_count})`} />}
              {v.passed_count > 0 && <Lines groups={v.passed} icon={CheckCircle2} iconClass="text-[rgb(var(--la2-success))]" label={`Đã đạt (${v.passed_count})`} />}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
