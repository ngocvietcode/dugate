// Gom người & tài sản (S3) ở giai đoạn 2. S3 là hàm thuần, tất định, không gọi LLM, nên chạy lại mỗi lần (kể cả resume),
// không cần checkpoint và không thêm stage vào DAG. Lỗi S3 không làm đổ workflow: trả null kèm cảnh báo không chứa PII.
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import { checkInvariants } from '@/lib/loan-dossier/s3/status';

import { consolidateParams } from './run-params';

export interface MapStageOutcome {
  /** null khi S3 lỗi hoặc không có dữ liệu. Có thể rỗng (`role_registry = []`) khi thiếu giấy đề nghị vay. */
  data: MapDossierData | null;
  status: string | null;
  status_code: string | null;
  /** Chỉ nêu loại lỗi / số lượng, không nêu tên hay số định danh. */
  warning: string | null;
}

/**
 * `dossier_submitted_at` lấy từ biến chạy (`consolidateParams`, mặc định ngày VN hôm nay): chỉ ảnh hưởng việc xác định bản hết hạn
 * (`superseded_evidences`). Resume sang ngày khác có thể cho kết quả khác ở đúng phần này.
 */
export function runMapStage(
  evidences: ReadonlyArray<EvidenceEnvelope>,
  pipelineVars: Record<string, unknown>,
  now?: () => Date,
): MapStageOutcome {
  try {
    const { dossier_submitted_at } = consolidateParams(pipelineVars, now ? now() : undefined);
    const result = runMapDossier({ evidences, dossier_submitted_at, now });
    if (!result.data) return { data: null, status: result.status, status_code: result.status_code, warning: 'MAP_DOSSIER_NO_DATA: S3 không trả dữ liệu.' };
    const violations = checkInvariants(result.data, new Set(evidences.filter((e) => e.status === 'SUCCESS').map((e) => e.evidence_id)));
    return {
      data: result.data,
      status: result.status,
      status_code: result.status_code,
      warning: violations.length > 0 ? `MAP_DOSSIER_INVARIANT: ${violations.length} vi phạm nhất quán ở kết quả gom người & tài sản.` : null,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    return { data: null, status: null, status_code: null, warning: `MAP_DOSSIER_UNAVAILABLE: không gom được người & tài sản (${name}).` };
  }
}
