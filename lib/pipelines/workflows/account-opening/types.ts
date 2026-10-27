import type {
  AccountOpeningResult,
  ChecklistItemResult,
  ClassifiedDoc,
  CustomerProfile,
  CustomerSegmentKey,
  ExtractedDoc,
} from '../prompts/account-opening-prompts';

export const ACCOUNT_OPENING_OUTPUT_VERSION = '1.0' as const;
export const ACCOUNT_OPENING_WORKFLOW_VERSION = '1.0.0' as const;

export type AccountStageKey =
  | 'classify'
  | 'extract_evidence'
  | 'consolidate_profile'
  | 'evaluate_eligibility'
  | 'assess_cdd_risk'
  | 'evaluate_policy_compliance'
  | 'screen_watchlists'
  | 'synthesize_decision';

/**
 * Hai giai đoạn nghiệp vụ. Phase là lớp nhóm đặt trên stage; stage_key và thứ tự
 * stage không đổi để polling/resume của operation cũ vẫn hoạt động.
 */
export type AccountPhaseKey = 'DOSSIER_INTAKE' | 'ONBOARDING_ASSESSMENT';

export type PhaseStatus = 'PENDING' | 'RUNNING' | 'PARTIAL' | 'COMPLETE' | 'BLOCKED';

export type ProcessingStatus = 'COMPLETE' | 'PARTIAL' | 'REVIEW_REQUIRED' | 'BLOCKED';
export type AssessmentStatus = 'PASS' | 'PASS_WITH_CONDITIONS' | 'FAIL' | 'REVIEW' | 'NOT_RUN';
export type RuleStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'NOT_APPLICABLE' | 'NOT_RUN' | 'INSUFFICIENT_DATA';

/** Mức rủi ro KYC/CDD của khách hàng. */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNDETERMINED';

/** Mức độ rà soát khách hàng: đơn giản · chuẩn · tăng cường. */
export type DueDiligenceLevel = 'SDD' | 'CDD' | 'EDD';

export interface EvidenceRecord {
  evidence_id: string;
  field_path: string;
  value: unknown;
  normalized_value: string | number | boolean | null;
  file_name: string;
  doc_type_key: string;
  doc_type_label: string;
  classification_confidence: number | null;
  extraction_method: 'AI_EXTRACT';
  evidence_kind?: 'EXTRACTED_FIELD' | 'CHECKLIST_STATUS';
  source_evidence_ids?: string[];
  review_status: 'ACCEPTED' | 'REVIEW';
}

export interface EvidenceRegistry {
  records: EvidenceRecord[];
  by_file: Array<{ file_name: string; doc_types: string[]; evidence_ids: string[] }>;
  by_document_type: Array<{ doc_type_key: string; file_names: string[]; evidence_ids: string[] }>;
}

export interface IntakeResult {
  required_present: number;
  required_total: number;
  completeness_percent: number;
  checklist: ChecklistItemResult[];
  missing_required_keys: string[];
  review_required_keys: string[];
  extraction_errors: Array<{ file_name: string; doc_type_key: string; error: string }>;
}

/**
 * Kết quả giai đoạn tiếp nhận hồ sơ. Đây là khuyến cáo, KHÔNG phải điều kiện
 * chạy: workflow vẫn đi hết các stage đánh giá khi hồ sơ chưa đầy đủ, vì chứng
 * từ có thể bổ sung sau. Chỉ NOT_PROCESSABLE phản ánh lỗi kỹ thuật.
 */
export interface DossierReadinessResult {
  status: 'READY_FOR_ASSESSMENT' | 'NEEDS_DOCUMENTS' | 'NEEDS_VERIFICATION' | 'NOT_PROCESSABLE';
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
  /** Kết quả đánh giá chỉ là tạm vì hồ sơ chưa đầy đủ/chưa xác thực. */
  assessment_conditional: boolean;
}

export interface MetricResult {
  status: 'CALCULATED' | 'INSUFFICIENT_DATA' | 'NOT_APPLICABLE';
  value: number | null;
  unit: 'VND' | 'PERCENT' | 'RATIO' | 'YEARS' | 'MONTHS' | 'DAYS' | 'COUNT';
  formula: string;
  inputs: Record<string, number | string | null>;
  evidence_ids: string[];
  warnings: string[];
}

/**
 * Chỉ tiêu điều kiện mở tài khoản tính bằng code. Mỗi phân khúc dùng một tập
 * con: NOT_APPLICABLE nghĩa là chỉ tiêu không áp dụng cho phân khúc đó (VD chủ
 * sở hữu hưởng lợi với KHCN), khác hẳn INSUFFICIENT_DATA là thiếu dữ liệu.
 */
export interface EligibilityMetrics {
  applicant_age: MetricResult;
  primary_id_validity_days: MetricResult;
  residency_permit_validity_days: MetricResult;
  organization_age_months: MetricResult;
  charter_capital: MetricResult;
  declared_annual_revenue: MetricResult;
  beneficial_owner_coverage_percent: MetricResult;
  authorized_signatory_count: MetricResult;
  mandatory_profile_coverage_percent: MetricResult;
  document_completeness_percent: MetricResult;
}

export interface AssessmentFinding {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  evidence_ids: string[];
}

/** 5 yếu tố rà soát khách hàng (CDD) của hồ sơ mở tài khoản. */
export interface CddFactorAssessment {
  code: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  name: 'Identity' | 'Geography' | 'Structure' | 'Purpose' | 'Authorization';
  label: string;
  status: AssessmentStatus;
  risk_level: RiskLevel;
  strengths: AssessmentFinding[];
  weaknesses: AssessmentFinding[];
  evidence_ids: string[];
  review_required: boolean;
}

export interface CddAssessment {
  factors: CddFactorAssessment[];
  overall_status: AssessmentStatus;
  risk_rating: RiskLevel;
  due_diligence_level: DueDiligenceLevel;
  /** Lý do nâng mức rà soát (baseline phân khúc, yếu tố rủi ro cao...). */
  escalation_reasons: string[];
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
  /** Phân khúc/sản phẩm mà kiểm tra này áp dụng (ghi lại để audit). */
  check_scope?: { segments: CustomerSegmentKey[]; products: string[] };
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
}

/**
 * Sàng lọc danh sách cảnh báo. Không có provider nào được cấu hình trong phạm vi
 * workflow này nên toàn bộ trả NOT_RUN — tuyệt đối không sinh kết quả "sạch" giả.
 */
export interface ScreeningResult {
  status: 'NOT_CONFIGURED' | 'COMPLETED';
  provider_id: string | null;
  provider_version: string | null;
  checks: Array<{
    check: 'AML' | 'PEP' | 'SANCTIONS' | 'ADVERSE_MEDIA' | 'CIF_DUPLICATE' | 'BLACKLIST';
    subject: string | null;
    status: 'NOT_RUN' | 'PASS' | 'FAIL';
    reason_code: string;
  }>;
  reason_codes: string[];
}

export interface AccountOpeningRecommendation {
  recommendation: 'ELIGIBLE_TO_OPEN' | 'REFER' | 'INSUFFICIENT_DATA';
  proposed_account_type: string | null;
  risk_rating: RiskLevel;
  due_diligence_level: DueDiligenceLevel;
  conditions_precedent: string[];
  /** Hạn chế đề xuất áp cho tài khoản khi mở có điều kiện. */
  restrictions: string[];
  reason_codes: string[];
  review_required: boolean;
}

export interface ReviewResult {
  required: boolean;
  route: 'STRAIGHT_THROUGH' | 'KYC_REVIEW' | 'COMPLIANCE_REVIEW' | 'REQUEST_DOCUMENTS';
  reasons: string[];
  required_role: string | null;
}

export interface AccountConfigSnapshot {
  segment_key: CustomerSegmentKey;
  segment_name: string;
  product_code: string;
  product_config_version: string;
  policy_id: string;
  policy_version: string;
  screening_provider_id: string | null;
  screening_provider_version: string | null;
  /** Ngưỡng THỰC DÙNG của lần chạy này để kết quả luôn tái lập được. */
  thresholds: {
    minimum_age_years: number;
    maximum_age_years: number | null;
    minimum_id_validity_days: number;
    beneficial_owner_threshold_percent: number;
    minimum_beneficial_owner_coverage_percent: number;
    minimum_authorized_signatories: number;
  };
  baseline_risk_level: RiskLevel;
  maximum_risk_without_edd: RiskLevel;
  /** Ngưỡng của lần chạy này đến từ mặc định sản phẩm hay cấu hình Profile. */
  threshold_source?: 'DEFAULT' | 'PROFILE';
  /** Bộ kiểm tra đã áp dụng (rule engine + rule LLM). */
  check_set?: {
    program: string;
    version: string;
    source: 'DEFAULT' | 'PROFILE';
    output_schema: string;
    deterministic_count: number;
    prompt_count: number;
  };
}

export interface AccountOpeningAudit {
  workflow_version: string;
  generated_at: string;
  stages: Array<{ stage_key: AccountStageKey; phase: AccountPhaseKey; status: 'SUCCESS' | 'PARTIAL_SUCCESS' }>;
  config_snapshot: AccountConfigSnapshot;
  deterministic_calculations: boolean;
  final_authority: 'EXTERNAL_ONBOARDING_SYSTEM';
}

/**
 * Provenance của một trường trên Customer Profile. Chỉ truy nguồn, KHÔNG tạo
 * golden record: giá trị vẫn là giá trị đã hợp nhất ở stage 2, ở đây chỉ trả lời
 * "giá trị này lấy từ chứng từ nào".
 */
export interface ProfileFieldProvenance {
  group: string;
  group_label: string;
  field_path: string;
  label: string;
  value: string;
  /** VERIFIED: khớp evidence đã chấp nhận · NEEDS_REVIEW: chỉ khớp evidence cần rà soát · UNVERIFIED: không truy được nguồn. */
  provenance: 'VERIFIED' | 'NEEDS_REVIEW' | 'UNVERIFIED';
  evidence_ids: string[];
  source_documents: string[];
}

export interface ProfileProvenanceResult {
  fields: ProfileFieldProvenance[];
  summary: {
    total: number;
    verified: number;
    needs_review: number;
    unverified: number;
    /** Tỷ lệ trường Customer Profile truy xuất được về chứng từ. */
    traceable_percent: number;
  };
  /** Các trường CIF bắt buộc của phân khúc còn thiếu hoặc không truy được nguồn. */
  mandatory_fields: Array<{
    field_path: string;
    label: string;
    status: 'VERIFIED' | 'NEEDS_REVIEW' | 'UNVERIFIED' | 'MISSING';
  }>;
  mandatory_coverage_percent: number;
}

export interface AccountStrategyInput {
  segmentKey: CustomerSegmentKey;
  productCode: string;
  classification: ClassifiedDoc[];
  extraction: ExtractedDoc[];
  customerProfile: CustomerProfile;
  checklist: ChecklistItemResult[];
}

export interface AccountOpeningResultV1 extends AccountOpeningResult {
  output_version: typeof ACCOUNT_OPENING_OUTPUT_VERSION;
  workflow_version: typeof ACCOUNT_OPENING_WORKFLOW_VERSION;
  processing_status: ProcessingStatus;
  config_snapshot: AccountConfigSnapshot;
  /** Provenance Customer Profile; optional để output cũ vẫn parse được. */
  profile_provenance?: ProfileProvenanceResult;
  intake: IntakeResult;
  dossier_readiness: DossierReadinessResult;
  evidence: EvidenceRegistry;
  eligibility_metrics: EligibilityMetrics;
  cdd_assessment: CddAssessment;
  policy_compliance: PolicyComplianceResult;
  screening: ScreeningResult;
  recommendation: AccountOpeningRecommendation;
  review: ReviewResult;
  audit: AccountOpeningAudit;
}
