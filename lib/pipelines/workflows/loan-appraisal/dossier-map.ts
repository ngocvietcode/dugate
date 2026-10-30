// Gom người & tài sản (S3) ở giai đoạn 2. S3 là hàm thuần, tất định, không gọi LLM, nên chạy lại mỗi lần (kể cả resume),
// không cần checkpoint và không thêm stage vào DAG. Lỗi S3 không làm đổ workflow: trả null kèm cảnh báo không chứa PII.
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { loadAssetFsParams } from '@/lib/loan-dossier/s3/fs/asset-params';
import { loadFsParams } from '@/lib/loan-dossier/s3/fs/params';
import { fsShadow, resolveS3Matcher, type FsShadowSummary } from '@/lib/loan-dossier/s3/fs/shadow';
import { resolveS3AssetMatcher, runMapDossier, type MapDossierInput } from '@/lib/loan-dossier/s3/run';
import { checkInvariants } from '@/lib/loan-dossier/s3/status';

import { consolidateParams } from './run-params';

export interface MapStageOutcome {
  /** null khi S3 lỗi hoặc không có dữ liệu. Có thể rỗng (`role_registry = []`) khi thiếu giấy đề nghị vay. */
  data: MapDossierData | null;
  status: string | null;
  status_code: string | null;
  /** Chỉ nêu loại lỗi / số lượng, không nêu tên hay số định danh. */
  warning: string | null;
  /** D-109: chỉ khi `s3_matcher = shadow` và catalog tham số hợp lệ. `data` luôn là kết quả luật. */
  fs_shadow?: FsShadowSummary;
}

/**
 * `dossier_submitted_at` lấy từ biến chạy (`consolidateParams`, mặc định ngày VN hôm nay): chỉ ảnh hưởng việc xác định bản hết hạn
 * (`superseded_evidences`). Resume sang ngày khác có thể cho kết quả khác ở đúng phần này.
 */
export function runMapStage(
  evidences: ReadonlyArray<EvidenceEnvelope>,
  pipelineVars: Record<string, unknown>,
  now?: () => Date,
  /** COR-R08: liên kết chủ thể của lần tính lại và nơi nhận báo cáo áp. */
  corrections?: Pick<MapDossierInput, 'links' | 'onLinkReport'>,
): MapStageOutcome {
  try {
    const { dossier_submitted_at } = consolidateParams(pipelineVars, now ? now() : undefined);
    const asset_matcher = resolveS3AssetMatcher(pipelineVars.s3_asset_matcher);
    const result = runMapDossier({ evidences, dossier_submitted_at, now, asset_matcher, ...corrections });
    if (!result.data) return { data: null, status: result.status, status_code: result.status_code, warning: 'MAP_DOSSIER_NO_DATA: S3 không trả dữ liệu.' };
    const violations = checkInvariants(result.data, new Set(evidences.filter((e) => e.status === 'SUCCESS').map((e) => e.evidence_id)));
    const warnings = violations.length > 0 ? [`MAP_DOSSIER_INVARIANT: ${violations.length} vi phạm nhất quán ở kết quả gom người & tài sản.`] : [];
    // D-117: catalog FS tài sản hỏng → runMapDossier đã chạy luật cũ; báo để không âm thầm đổi cách nối.
    if (asset_matcher === 'fs' && !loadAssetFsParams().ok) warnings.push('ASSET_FS_PARAMS_INVALID: catalog asset_fs_params.json không hợp lệ, nối tài sản theo luật cũ.');
    let fs_shadow: FsShadowSummary | undefined;
    if (resolveS3Matcher(pipelineVars.s3_matcher) === 'shadow') {
      // FS-R09: catalog hỏng thì bỏ shadow, không đoán tham số.
      const params = loadFsParams();
      if (params.ok) fs_shadow = fsShadow(evidences, result.data, params.params);
      else warnings.push('FS_PARAMS_INVALID: catalog fs_params.json không hợp lệ, bỏ chạy shadow.');
    }
    return {
      data: result.data,
      status: result.status,
      status_code: result.status_code,
      warning: warnings.length > 0 ? warnings.join(' ') : null,
      ...(fs_shadow ? { fs_shadow } : {}),
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    return { data: null, status: null, status_code: null, warning: `MAP_DOSSIER_UNAVAILABLE: không gom được người & tài sản (${name}).` };
  }
}
