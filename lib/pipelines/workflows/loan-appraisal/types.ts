import type {
  AppraisalResult,
  ChecklistItemResult,
  ClassifiedDoc,
  CrossCheckFinding,
  Customer360,
  ExtractedDoc,
} from '../prompts/loan-appraisal-prompts';
import type { CheckChecklistData, CrossCheckData, MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { ClassifyData } from '@/lib/loan-dossier/contracts/stage-result';
import type { MasterDossier } from '@/lib/loan-dossier/contracts/master-dossier';
import type { StoredClaims } from '@/lib/loan-dossier/graph/claims-store';
import type { DossierGraphView } from '@/lib/loan-dossier/graph/view-contract';
import type { IntakeAssessment } from './intake-assessment';
import type { DossierPrecheck } from './dossier-precheck';
import type { ReproducibilitySnapshot } from './reproducibility';
import type { SegmentPackSnapshot } from './segment-packs/types';
import type { RuleGroupKey } from './rule-groups';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

/** 3.0: kết quả hồ sơ theo spec-v3 (V2-R09) — documents/customer_360/checklist/cross_check đổi cấu trúc. */
export const LOAN_APPRAISAL_OUTPUT_VERSION = '3.0' as const;
/**
 * 2.1.0: risk_notes chỉ còn nội dung AI (ghi chú hệ thống sang system_notes);
 * checklist "present" cần phân loại + bóc tách thành công; DSCR/LTV theo nguồn
 * mới; nhiều bản cùng loại nằm dưới `instances[]`. `output_version` giữ '2.0'
 * vì cấu trúc kết quả chỉ bổ sung field, không đổi field cũ.
 */
export const LOAN_APPRAISAL_WORKFLOW_VERSION = '2.1.0' as const;

export type LoanStageKey =
  | 'classify'
  | 'extract_evidence'
  /** Đã gỡ khỏi DAG (giai đoạn 2 tạm tắt các bước kiểm tra hồ sơ); chỉ còn trong checkpoint của operation cũ. */
  | 'consolidate_dossier'
  | 'calculate_financials'
  | 'evaluate_policy_compliance'
  | 'synthesize_recommendation';

/**
 * Hai giai đoạn nghiệp vụ. Phase là lớp nhóm đặt trên stage hiện có; stage_key
 * và thứ tự stage không đổi để polling/resume của operation cũ vẫn hoạt động.
 */
export type LoanPhaseKey = 'DOSSIER_INTAKE' | 'CREDIT_APPRAISAL';

export type PhaseStatus = 'PENDING' | 'RUNNING' | 'PARTIAL' | 'COMPLETE' | 'BLOCKED';

export type ProcessingStatus = 'COMPLETE' | 'PARTIAL' | 'REVIEW_REQUIRED' | 'BLOCKED';
export type AssessmentStatus = 'PASS' | 'PASS_WITH_CONDITIONS' | 'FAIL' | 'REVIEW' | 'NOT_RUN';
export type RuleStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'NOT_APPLICABLE' | 'NOT_RUN' | 'INSUFFICIENT_DATA';

export interface EvidenceRecord {
  evidence_id: string;
  field_path: string;
  value: unknown;
  normalized_value: string | number | boolean | null;
  file_name: string;
  doc_type_key: string;
  doc_type_label: string;
  /** @deprecated Luôn null và không ai đọc; không còn ghi. Chỉ có ở kết quả cũ. */
  classification_confidence?: number | null;
  /**
   * Độ tin cậy TRÍCH XUẤT của trường này (0..1) do bước extract trả về theo
   * từng field cấp cao. null nếu model không cung cấp. Khi có giá trị, nó được
   * ưu tiên hơn classification_confidence để quyết định review_status.
   */
  extraction_confidence?: number | null;
  extraction_method: 'AI_EXTRACT';
  evidence_kind?: 'EXTRACTED_FIELD' | 'CHECKLIST_STATUS';
  source_evidence_ids?: string[];
  /**
   * Chỉ có ở bản ghi dựng từ `master_dossier` (MD-R11): phạm vi để lọc theo `input[]` của rule —
   * `item:<item_key>`, `master:person`, `master:asset`.
   */
  master_scope?: string;
  review_status: 'ACCEPTED' | 'REVIEW';
}

export interface EvidenceRegistry {
  records: EvidenceRecord[];
  by_file: Array<{ file_name: string; doc_types: string[]; evidence_ids: string[] }>;
  by_document_type: Array<{ doc_type_key: string; file_names: string[]; evidence_ids: string[] }>;
}

/**
 * Evidence như được LƯU trong kết quả cuối: chỉ `records` của trường bóc tách. Chỉ mục ngược (`by_file`, `by_document_type`) và
 * bản ghi trạng thái checklist (`CHECKLIST_STATUS`) chỉ dùng trong bộ nhớ khi chạy workflow nên không ghi ra; kết quả cũ vẫn có chúng.
 */
export interface StoredEvidenceRegistry {
  records: EvidenceRecord[];
  by_file?: EvidenceRegistry['by_file'];
  by_document_type?: EvidenceRegistry['by_document_type'];
}

export interface IntakeResult {
  required_present: number;
  required_total: number;
  completeness_percent: number;
  checklist: ChecklistItemResult[];
  missing_required_keys: string[];
  review_required_keys: string[];
  extraction_errors: Array<{ file_name: string; doc_type_key: string; error: string }>;
  /**
   * File OCR lỗi / không nhận dạng được, kèm hướng xử lý đề xuất (US1 AC#5):
   * REQUEST_SUPPLEMENT (yêu cầu bổ sung) khi thuộc chứng từ bắt buộc, REVIEW khi
   * cần soát thủ công.
   */
  error_files: Array<{
    file_name: string;
    doc_type_key: string;
    reason: string;
    suggested_action: 'REQUEST_SUPPLEMENT' | 'REVIEW';
  }>;
  /**
   * Các trường bị bỏ trống trong chứng từ BẮT BUỘC đã bóc tách được (US1 AC#4:
   * liệt kê trường không có thông tin).
   */
  blank_fields: Array<{ file_name: string; doc_type_key: string; missing_fields: string[] }>;
}

/**
 * Kết quả giai đoạn tiếp nhận hồ sơ. Đây là khuyến cáo, KHÔNG phải điều kiện
 * chạy: workflow vẫn đi hết các stage thẩm định khi hồ sơ chưa đầy đủ, vì chứng
 * từ có thể bổ sung ở giai đoạn sau. Chỉ NOT_PROCESSABLE phản ánh lỗi kỹ thuật.
 */
export interface DossierReadinessResult {
  status: 'READY_FOR_APPRAISAL' | 'NEEDS_DOCUMENTS' | 'NEEDS_VERIFICATION' | 'NOT_PROCESSABLE';
  completeness_percent: number;
  required_present: number;
  required_total: number;
  missing_required_keys: string[];
  review_required_keys: string[];
  unclassified_files: Array<{ file_name: string; reason: string }>;
  extraction_errors: Array<{ file_name: string; doc_type_key: string; error: string }>;
  conflicts: Array<{
    severity: 'error' | 'warning' | 'info';
    title: string;
    message: string;
    documents: string[];
    evidence_ids: string[];
  }>;
  supplement_requests: string[];
  blocking_reasons: string[];
  appraisal_conditional: boolean;
}

export interface MetricResult {
  status: 'CALCULATED' | 'INSUFFICIENT_DATA' | 'NOT_APPLICABLE';
  value: number | null;
  unit: 'VND' | 'RATIO' | 'PERCENT' | 'MONTHS';
  formula: string;
  inputs: Record<string, number | null>;
  evidence_ids: string[];
  warnings: string[];
  /** MD-R13: thiếu vì các bản của cùng chứng từ ghi khác nhau (master_dossier CONFLICT) — rule ra REVIEW, không FAIL. */
  input_conflict?: boolean;
  /**
   * E9 / D-101: đã tính được nhưng ít nhất một đầu vào đọc với độ tin cậy thấp (field cấp 1 < 0.80 hoặc không có) — cần
   * rà soát trước khi dùng. `review_evidence_ids` là các nguồn đó. Vắng = mọi đầu vào đã ACCEPTED.
   */
  needs_review?: boolean;
  review_evidence_ids?: string[];
}

export interface FinancialMetrics {
  requested_amount: MetricResult;
  annual_revenue: MetricResult;
  annual_operating_profit: MetricResult;
  annual_debt_service: MetricResult;
  cfads: MetricResult;
  dscr: MetricResult;
  collateral_value: MetricResult;
  ltv: MetricResult;
  operating_margin: MetricResult;
}

export interface AssessmentFinding {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  evidence_ids: string[];
}

export interface FiveCFactorAssessment {
  code: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  name: 'Character' | 'Capacity' | 'Capital' | 'Collateral' | 'Conditions';
  status: AssessmentStatus;
  strengths: AssessmentFinding[];
  weaknesses: AssessmentFinding[];
  evidence_ids: string[];
  review_required: boolean;
}

export interface FiveCAssessment {
  factors: FiveCFactorAssessment[];
  overall_status: AssessmentStatus;
}

export interface RuleResult {
  rule_id: string;
  rule_version: string;
  severity: 'BLOCKER' | 'EXCEPTION' | 'REVIEW' | 'INFO';
  result: RuleStatus;
  expected?: unknown;
  actual?: unknown;
  reason_code: string;
  message: string;
  evidence_ids: string[];
  exception_allowed: boolean;
  /** Rule engine (so sánh bằng code) hay rule LLM (phán đoán trên nội dung chứng từ). */
  check_kind?: 'DETERMINISTIC' | 'PROMPT';
  /** Tên hiển thị của kiểm tra theo cấu hình. */
  check_name?: string;
  /** Nhóm hiển thị của rule (xem rule-groups.ts). Kết quả cũ không có: UI suy từ rule_id. */
  group?: RuleGroupKey;
  /** Mã kết quả ĐÓNG do rule LLM/Agent chọn trong `outputs.codes` của rule (xem check-contract.ts). Vắng = model không trả mã. */
  model_code?: string;
  /** Độ tin cậy do rule LLM trả về. */
  confidence?: number | null;
  /** Ngưỡng confidence áp dụng cho rule LLM. */
  threshold?: number | null;
}

export interface PolicyComplianceResult {
  policy_id: string;
  policy_version: string;
  status: AssessmentStatus;
  rule_results: RuleResult[];
  exceptions: string[];
  external_checks: Array<{
    check: 'AML' | 'PEP' | 'SANCTIONS' | 'ADVERSE_MEDIA';
    status: 'NOT_RUN' | 'PASS' | 'FAIL';
    reason_code: string;
  }>;
}

export interface CreditScoreResult {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  scorecard_id: string | null;
  scorecard_version: string | null;
  rating: string | null;
  pd: number | null;
  lgd: number | null;
  reason_codes: string[];
}

export interface StressTestResult {
  status: 'NOT_CONFIGURED' | 'CALCULATED';
  scenarios: Array<{
    scenario_id: string;
    assumptions: Record<string, number>;
    dscr: MetricResult;
  }>;
}

export interface LoanRecommendation {
  recommendation: 'CONSIDER' | 'REFER' | 'INSUFFICIENT_DATA';
  suggested_amount_vnd: number | null;
  suggested_tenor_months: number | null;
  conditions_precedent: string[];
  covenants: string[];
  reason_codes: string[];
  review_required: boolean;
}

export interface ReviewResult {
  required: boolean;
  route: 'STRAIGHT_THROUGH' | 'CREDIT_REVIEW' | 'RISK_REVIEW' | 'REQUEST_DOCUMENTS';
  reasons: string[];
  required_role: string | null;
}

export interface LoanConfigSnapshot {
  product_code: string;
  product_config_version: string;
  policy_id: string;
  policy_version: string;
  scorecard_id: string | null;
  scorecard_version: string | null;
  thresholds: {
    minimum_dscr: number;
    maximum_ltv: number;
    maximum_amount_vnd: number;
  };
  /** Ngưỡng của lần chạy này đến từ mặc định sản phẩm hay cấu hình Profile. */
  threshold_source?: 'DEFAULT' | 'PROFILE';
  /** Bộ kiểm tra đã áp dụng (rule engine + rule LLM). */
  check_set?: {
    program: string;
    version: string;
    source: 'DEFAULT' | 'PROFILE';
    output_schema: string;
    /** Luồng mà bộ kiểm tra đã được lọc theo (phạm vi rule). */
    flow?: LoanFlow;
    deterministic_count: number;
    prompt_count: number;
  };
  /** Cảnh báo cấu hình của lần chạy (VD prompt ghi đè bị bỏ qua — V2-R08, input rule khóa cũ — V2-R07). */
  warnings?: string[];
  /** Segment pack đã tính stage 2–4 (D-100). Kết quả cũ không có (tương đương hkd-secured). */
  segment_pack?: SegmentPackSnapshot;
  /** Danh mục, template prompt (sha256), model / reasoning ghi đè của các bước AI (ARCHITECTURE E1). Kết quả cũ không có. */
  reproducibility?: ReproducibilitySnapshot;
}

export interface AppraisalAudit {
  workflow_version: string;
  generated_at: string;
  stages: Array<{ stage_key: LoanStageKey; phase: LoanPhaseKey; status: 'SUCCESS' | 'PARTIAL_SUCCESS' }>;
  config_snapshot: LoanConfigSnapshot;
  deterministic_calculations: boolean;
  final_authority: 'EXTERNAL_APPROVAL_SYSTEM';
}

export interface LoanStrategyInput {
  productCode: string;
  productName: string;
  classification: ClassifiedDoc[];
  extraction: ExtractedDoc[];
  customer360: Customer360;
  checklist: ChecklistItemResult[];
}

/** Khóa luồng của chương trình checklist của sản phẩm (S4-R24), VD FULL/FAST/SIMPLE (HKD) hoặc A/B. */
export type LoanFlow = string;

/** Phần kết quả hồ sơ theo spec-v3 (V2-R09). */
export interface DossierOutputV3 {
  product_code: string;
  product_name: string;
  /** S1 + S2. */
  documents: { classify: ClassifyData; evidences: EvidenceEnvelope[] };
  /** S3 (null khi S3 không có dữ liệu). */
  customer_360: MapDossierData | null;
  /**
   * Quan hệ giữa người, tài sản và chứng từ dạng nodes + edges (id và nhãn, KHÔNG chứa tên / số định danh). Dựng từ cùng dữ liệu S3 của
   * `customer_360`; chi tiết của từng node tra bằng id ở `customer_360` / `documents.evidences`. Không có khi S3 không dựng được graph
   * hoặc ở kết quả cũ.
   */
  dossier_graph?: DossierGraphView | null;
  /**
   * Claim ĐÁNG CHÚ Ý (đồng thuận, tranh chấp, nghi lỗi đọc, cách viết khác, chưa gắn chủ thể) kèm nguồn từng claim. CÓ GIÁ TRỊ (có thể là PII).
   * Claim thường (đơn vay khai, một nguồn) không lưu: còn nguyên ở documents.evidences[].data, dựng lại bằng buildClaimLedger.
   * leaf_count = lá đã lưu + omitted_leaves (bất biến lossless). Không có ở kết quả cũ hoặc khi S3 lỗi.
   */
  claims?: StoredClaims | null;
  /**
   * D-103 (LAC-R18): tóm tắt Loan Application Context của lần chạy — chỉ số đếm và mã, KHÔNG có giá trị dữ kiện. LAC đầy đủ
   * không lưu: dựng lại được từ documents.evidences + S3 (`source_hash` để đối chiếu). Vắng khi lac_mode = off hoặc kết quả cũ.
   */
  loan_application_context_summary?: LoanApplicationContextSummary | null;
  /** S4. `items` rỗng khi S4 FAILED (VD flow sai). */
  checklist: {
    status: string;
    status_code: string;
    flow: string | null;
    items: CheckChecklistData['items'];
    summary_by_group: CheckChecklistData['summary_by_group'];
    completeness_percent: number | null;
    /** Chỉ có ở view=compact: số mục NOT_APPLICABLE đã được bỏ khỏi `items` (giao diện vốn ẩn chúng). */
    not_applicable_count?: number;
  };
  /** S5. */
  cross_check: {
    status: string;
    status_code: string;
    results: CrossCheckData['results'];
    logic_findings: CrossCheckData['logic_findings'];
    skipped_evidences: CrossCheckData['skipped_evidences'];
  };
  completeness_percent: number;
}

export interface LoanApplicationContextSummary {
  lac_version: string;
  mode: 'shadow' | 'on';
  /** LAC đã vào prompt rule LLM của lần chạy này. */
  used_in_prompt: boolean;
  source_hash: string;
  fact_count: number;
  /** null khi stage rule không chạy lại ở lần này (resume sau stage 3) hoặc không có rule LLM. */
  rendered_fact_count: number | null;
  conflicts: number;
  gaps: Array<{ code: string; count: number }>;
}

export interface AppraisalResultV2 extends DossierOutputV3 {
  risk_notes: string[];
  output_version: typeof LOAN_APPRAISAL_OUTPUT_VERSION;
  workflow_version: typeof LOAN_APPRAISAL_WORKFLOW_VERSION;
  processing_status: ProcessingStatus;
  /**
   * Ghi chú do hệ thống sinh (kết quả tạm, AML/scorecard chưa cấu hình...).
   * Tách khỏi `risk_notes` để `risk_notes` giữ nguyên đúng nội dung AI tổng hợp
   * ở stage hợp nhất hồ sơ.
   */
  system_notes?: string[];
  config_snapshot: LoanConfigSnapshot;
  /** Master data chuẩn hóa theo checklist (master_dossier.md); null khi không dựng được (MD-AC12). */
  master_dossier?: MasterDossier | null;
  /** Kết quả tiếp nhận theo 4 tiêu chí của Sale (D-47). */
  intake_assessment?: IntakeAssessment;
  /** Kiểm tra sơ bộ bằng LLM ngay sau S1 (D-73); null khi chưa có (kết quả cũ). */
  dossier_precheck?: DossierPrecheck | null;
  /** Luồng thẩm định áp dụng cho phạm vi bộ kiểm tra (Full/Fast/Simple). */
  flow?: LoanFlow;
  /** @deprecated Bản sao nội bộ của checklist + readiness, không ghi nữa (strategy vẫn tính trong bộ nhớ). Chỉ có ở kết quả cũ. */
  intake?: IntakeResult;
  /** Mức sẵn sàng thẩm định (từ S4). Không có khi các bước kiểm tra hồ sơ tạm tắt ở giai đoạn 2; kết quả cũ và giai đoạn 1 vẫn có. */
  dossier_readiness?: DossierReadinessResult;
  evidence: StoredEvidenceRegistry;
  financial_metrics: FinancialMetrics;
  /** @deprecated Không còn tính từ khi bỏ 5C; chỉ có ở kết quả cũ. Căn cứ nằm ở policy_compliance.rule_results (theo `group`). */
  five_c?: FiveCAssessment;
  policy_compliance: PolicyComplianceResult;
  /** @deprecated Đã bỏ stage stress/score; chỉ có ở kết quả cũ. */
  stress_test?: StressTestResult;
  /** @deprecated Đã bỏ stage stress/score; chỉ có ở kết quả cũ. */
  credit_score?: CreditScoreResult;
  recommendation: LoanRecommendation;
  review: ReviewResult;
  /** @deprecated Toàn hằng số hoặc bản sao (config_snapshot, workflow_version, stage suy ra từ pipeline_steps). Không ghi nữa; chỉ có ở kết quả cũ. */
  audit?: AppraisalAudit;
}
