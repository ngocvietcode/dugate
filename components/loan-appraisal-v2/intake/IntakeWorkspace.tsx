'use client';

import { FileQuestion, ScanSearch } from 'lucide-react';
import type { AppraisalResult, DossierFile } from '@/app/loan-appraisal/types';
import { pickPrecheck } from '@/app/loan-appraisal-v2/lib/precheck-view';
import type { DossierPrecheck } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';
import { safeArray } from '@/app/loan-appraisal-v2/lib/selectors';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { TONE_BOX } from '../ui/toneClasses';
import { ClassificationResults } from './ClassificationResults';
import { PrecheckPanel } from './PrecheckPanel';
import { Phase1Overview } from './Phase1Overview';

/** File chưa phân loại được (S1) — kèm hướng xử lý. */
function UnclassifiedFiles({ files }: { files: DossierFile[] }) {
  const bad = files.filter((f) => f.status !== 'CLASSIFIED');
  if (bad.length === 0) return null;
  return (
    <Card labelledBy="la2-unclassified-title">
      <CardHeader id="la2-unclassified-title" icon={FileQuestion} title="Tài liệu chưa nhận diện được" subtitle={`${bad.length} file`} />
      <CardBody>
        <ul className="space-y-2">
          {bad.map((f) => (
            <li key={f.file_id} className={`rounded-lg border px-3 py-2 ${TONE_BOX.warning}`}>
              <p className="truncate text-xs font-medium" title={f.file_name}>{f.file_name}</p>
              <p className="text-xs">{f.message ?? f.reason_code ?? f.status}</p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/**
 * Giai đoạn 1 (D-90, D-91): chỉ kết quả của S1 phân loại và kiểm tra sơ bộ bằng AI, xếp theo mức cần hành động:
 * tổng quan (kết luận + 4 con số + nút chuyển giai đoạn) → kiểm tra sơ bộ → tài liệu chưa nhận diện → kết quả phân loại.
 * OCR, tổng kết, 4 tiêu chí tiếp nhận, người & tài sản, checklist 46 mục, đối chiếu chéo thuộc giai đoạn 2 (tab "Hồ sơ khách hàng").
 */
export function IntakeWorkspace({ classification, precheck: midRunPrecheck = null, result, running = false, onGoToAppraisal, appraisalPending = false, appraisalStarting = false }: {
  classification: DossierFile[] | null;
  /** D-73: kiểm tra sơ bộ giữa chừng (từ checkpoint bước 0); kết quả cuối ưu tiên hơn. */
  precheck?: DossierPrecheck | null;
  result: AppraisalResult | null;
  /** Đang chạy giai đoạn 1 (chưa dừng): thẻ tổng quan báo "đang kiểm tra" nếu chưa có kết quả. */
  running?: boolean;
  onGoToAppraisal: () => void;
  /** D-51: giai đoạn 2 chưa chạy (workflow dừng sau giai đoạn 1). */
  appraisalPending?: boolean;
  appraisalStarting?: boolean;
}) {
  const files = result ? safeArray(result.documents?.classify?.files) : safeArray(classification);
  const precheck = pickPrecheck(result?.dossier_precheck, midRunPrecheck);

  if (!result && files.length === 0 && !precheck) {
    return <EmptyState icon={ScanSearch} title="Chưa có kết quả tiếp nhận">Tải hồ sơ và bắt đầu để xem kết quả phân loại và kiểm tra sơ bộ.</EmptyState>;
  }

  return (
    <div className="space-y-4">
      <Phase1Overview
        precheck={precheck}
        files={files}
        running={running && !precheck}
        onGoToAppraisal={onGoToAppraisal}
        appraisalPending={appraisalPending}
        appraisalStarting={appraisalStarting}
      />
      {precheck && <PrecheckPanel precheck={precheck} files={files} />}
      <UnclassifiedFiles files={files} />
      <ClassificationResults files={files} />
    </div>
  );
}
