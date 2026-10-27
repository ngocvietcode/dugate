// Segment Pack (ARCHITECTURE §9): phần khác nhau giữa các phân khúc khách hàng (HKD, SME…) của 3 stage tính toán.
// Lõi workflow (S1, precheck, S2, S3, rule LLM, lưu kết quả) không biết phân khúc; nó gọi pack của sản phẩm đang chạy.
// Pack thuần (không I/O), output cùng hình dạng (`FinancialMetrics`, `PolicyComplianceResult`, khuyến nghị) nên UI và
// payload tích hợp không phải biết phân khúc.
//
// Phạm vi v1 (D-100) chỉ gồm 3 điểm workflow từng gắn cứng HKD. Danh mục chứng từ, anchor, vai trò của S3 chưa vào pack:
// chưa có pack thứ hai cần chúng (thêm khi xây SME pack).
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import type { LoanProductConfig } from '@/lib/loan-dossier/catalog/products';

import type { LoanCheckSet } from '../check-set';
import type { LoanProductPolicy } from '../product-policy';
import type { FinancialMetrics, LoanRecommendation, PolicyComplianceResult, ReviewResult, RuleResult } from '../types';

export type Segment = LoanProductConfig['segment'];

export interface FinancialStageInput {
  /** Output S2 (`extract_evidence`), nguyên trạng. */
  evidences: ReadonlyArray<EvidenceEnvelope>;
  /** Output S3; null khi S3 lỗi (pack phải tự quyết chỉ số nào không đánh giá được). */
  s3: MapDossierData | null;
}

export interface PolicyStageInput {
  policy: LoanProductPolicy;
  checkSet: LoanCheckSet;
  financial: FinancialMetrics;
  /** Kết quả rule LLM đã qua rào an toàn của lõi (`parsePromptCheckResults`). */
  promptResults: RuleResult[];
}

export interface DecisionStageInput {
  policy: LoanProductPolicy;
  financial: FinancialMetrics;
  compliance: PolicyComplianceResult;
}

export interface SegmentPack {
  /** Định danh ổn định, ghi vào `config_snapshot.segment_pack`. */
  pack_id: string;
  /** semver; tăng khi logic tính của pack đổi (kết quả cũ vẫn truy được pack đã dùng). */
  pack_version: string;
  /** Stage 2 `calculate_financials`. */
  calculateFinancials(input: FinancialStageInput): FinancialMetrics;
  /** Stage 3 `evaluate_policy_compliance`: rule engine của pack + gộp kết quả rule LLM. */
  evaluatePolicy(input: PolicyStageInput): PolicyComplianceResult;
  /** Stage 4 `synthesize_recommendation`. */
  recommend(input: DecisionStageInput): { recommendation: LoanRecommendation; review: ReviewResult };
}

/** Pack đã dùng cho một lần chạy (ghi vào `config_snapshot`). */
export interface SegmentPackSnapshot {
  pack_id: string;
  pack_version: string;
  segment: Segment;
}
