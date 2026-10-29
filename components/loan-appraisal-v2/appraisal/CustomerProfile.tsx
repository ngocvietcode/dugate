'use client';

import dynamic from 'next/dynamic';
import { AlertTriangle, ListChecks, Sparkles } from 'lucide-react';
import type { AppraisalResult, DossierEvidence } from '@/app/loan-appraisal/types';
import { borrowerName } from '@/app/loan-appraisal-v2/lib/dossier-view';
import { hasDossierCheckResults, safeArray } from '@/app/loan-appraisal-v2/lib/selectors';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { TONE_BOX } from '../ui/toneClasses';
import { DossierChecklist } from '../intake/DossierChecklist';
import { DossierCrossCheck } from '../intake/DossierCrossCheck';
import { DossierSummaryCard } from '../intake/DossierSummaryCard';
import { IntakeCriteria } from '../intake/IntakeCriteria';
import { OcrResults } from '../intake/OcrResults';
import { Customer360Panel } from './Customer360Panel';

// Thư viện đồ thị (@xyflow/react, dagre) chỉ nạp khi kết quả có khối dossier_graph; chỉ chạy ở trình duyệt.
const DossierGraphPanel = dynamic(
  () => import('./DossierGraphPanel').then((m) => m.DossierGraphPanel),
  { ssr: false, loading: () => <p className="text-xs text-muted-foreground">Đang tải sơ đồ quan hệ…</p> },
);

/** Tóm tắt bằng quy tắc: dự phòng cho kết quả cũ chưa có `intake_assessment`. */
function RuleSummary({ result }: { result: AppraisalResult }) {
  const name = borrowerName(result.customer_360);
  const docCount = safeArray(result.documents?.classify?.files).length;
  const notes = [...safeArray(result.risk_notes), ...safeArray(result.system_notes)];
  return (
    <Card labelledBy="la2-summary-title">
      <CardHeader id="la2-summary-title" icon={Sparkles} title="Tóm tắt hồ sơ" subtitle="Tổng hợp bằng quy tắc từ chứng từ đã bóc tách" actions={<Badge tone="info">Rule-based</Badge>} />
      <CardBody>
        <p className="text-sm leading-6">
          Bộ hồ sơ vay <strong>{result.product_name || result.product_code}</strong>
          {name ? <> của khách hàng <strong>{name}</strong></> : ' (chưa xác định được khách hàng vay từ giấy đề nghị vay vốn)'}
          {docCount > 0 ? <>, gồm <strong>{docCount}</strong> tài liệu</> : ''}, độ đầy đủ <strong>{result.completeness_percent}%</strong>.
        </p>
        {notes.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
            {notes.map((note, index) => (
              <li key={`${note}-${index}`} className="flex items-start gap-2 text-xs leading-5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[rgb(var(--la2-warning))]" aria-hidden />{note}</li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Việc cần hoàn tất — dự phòng cho kết quả cũ chưa có `intake_assessment`. */
function TodoCard({ supplements }: { supplements: string[] }) {
  return (
    <Card labelledBy="la2-todo-title">
      <CardHeader id="la2-todo-title" icon={ListChecks} title="Việc cần hoàn tất" subtitle={`${supplements.length} nội dung cần bổ sung hoặc làm rõ`} />
      <CardBody>
        {supplements.length > 0 ? (
          <ol className="space-y-2">
            {supplements.map((item, index) => (
              <li key={item} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${TONE_BOX.warning}`}>
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--la2-warning))] text-[11px] font-bold text-background">{index + 1}</span>
                <p className="text-xs leading-5">{item}</p>
              </li>
            ))}
          </ol>
        ) : <p className={`rounded-lg border px-3 py-4 text-center text-xs ${TONE_BOX.success}`}>Không còn nội dung cần bổ sung.</p>}
      </CardBody>
    </Card>
  );
}

/**
 * Tab "Hồ sơ khách hàng" của giai đoạn 2 (D-91). Hiện tại các bước kiểm tra hồ sơ (kiểm tra nháp và tổng kết, người & tài sản, checklist,
 * đối chiếu chéo, master data) tạm tắt nên tab chỉ có kết quả OCR. Kết quả cũ còn đủ dữ liệu vẫn hiện các khối đó như trước (xem hasDossierCheckResults).
 */
export function CustomerProfile({ result, evidences }: { result: AppraisalResult; evidences?: DossierEvidence[] }) {
  const docs = evidences ?? safeArray(result.documents?.evidences);
  const assessment = result.intake_assessment ?? null;
  const checks = hasDossierCheckResults(result);
  const showAssessment = Boolean(assessment);
  return (
    <div className="space-y-4">
      {showAssessment && assessment && (
        <>
          <DossierSummaryCard assessment={assessment} />
          <IntakeCriteria assessment={assessment} />
        </>
      )}
      {/* Kết quả cũ chưa có intake_assessment nhưng có checklist: tóm tắt bằng quy tắc + việc cần hoàn tất như trước. */}
      {!showAssessment && checks && (
        <>
          <RuleSummary result={result} />
          <TodoCard supplements={safeArray(result.dossier_readiness?.supplement_requests)} />
        </>
      )}
      {/* D-114: Customer 360 đọc hồ sơ 360 — nguồn sự thật duy nhất; tự báo khi kết quả chưa có. */}
      <Customer360Panel result={result} />
      {/* Sơ đồ quan hệ: có khi S3 chạy (kể cả khi checklist / đối chiếu chéo tạm tắt); nạp động vì thư viện đồ thị khá nặng. */}
      {result.dossier_graph && <ErrorBoundary label="Sơ đồ quan hệ hồ sơ"><DossierGraphPanel result={result} /></ErrorBoundary>}
      {checks && <DossierChecklist checklist={result.checklist} people={result.customer_360} />}
      {checks && <DossierCrossCheck crossCheck={result.cross_check} people={result.customer_360} evidences={docs} />}
      <OcrResults evidences={docs} />
    </div>
  );
}
