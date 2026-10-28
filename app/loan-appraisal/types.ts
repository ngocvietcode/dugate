// Client-side mirror of the Loan Appraisal public contract (output 3.0, spec-v3).
// Phần hồ sơ (documents/customer_360/checklist/cross_check) dùng thẳng kiểu của backend (type-only import).
import type { DossierOutputV3, LoanApplicationContextSummary } from '@/lib/pipelines/workflows/loan-appraisal/types';
import type { IntakeAssessment } from '@/lib/pipelines/workflows/loan-appraisal/intake-assessment';
import type { DossierPrecheck } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';

export type { DossierOutputV3 };
export type DossierChecklistItem = DossierOutputV3['checklist']['items'][number];
export type DossierCrossCheckResult = DossierOutputV3['cross_check']['results'][number];
export type DossierLogicFinding = DossierOutputV3['cross_check']['logic_findings'][number];
export type DossierEvidence = DossierOutputV3['documents']['evidences'][number];
export type DossierFile = DossierOutputV3['documents']['classify']['files'][number];
export type DossierMap = NonNullable<DossierOutputV3['customer_360']>;

export type StepStatus = 'pending' | 'running' | 'done' | 'error';
export type LoanStageKey =
  | 'classify'
  | 'dossier_precheck'
  | 'extract_evidence'
  /** Đã gỡ khỏi DAG; chỉ còn trong kết quả của operation cũ. */
  | 'consolidate_dossier'
  | 'calculate_financials'
  | 'evaluate_policy_compliance'
  | 'synthesize_recommendation';

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  icon: string;
}

export interface PipelineStep {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  status: StepStatus;
  progress: number;
  output: string | null;
}

export interface BackendWorkflowStep {
  step?: number;
  stage_key?: LoanStageKey | string;
  artifact_version?: string;
  status?: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'WAITING_REVIEW';
  processor?: string;
  extracted_data?: unknown;
}

export interface DocMatch {
  key: string;
  label: string;
  confidence: number;
}

export interface ClassifiedDoc {
  file_name: string;
  matches: DocMatch[];
  status: 'classified' | 'unknown' | 'error';
  reason?: string;
}

export interface ExtractedDoc {
  file_name: string;
  doc_type_key: string;
  doc_type_label: string;
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
  /** Tên mẫu biểu OCR nhận diện được (US1) — chỉ có ở kết quả mới. */
  detected_form_name?: string;
  /** Confidence theo từng field cấp cao do bước bóc tách trả về. */
  field_confidences?: Record<string, number>;
}

export interface ChecklistItemResult {
  key: string;
  label: string;
  required: boolean;
  status: 'present' | 'missing' | 'review';
  found_in: string[];
  note?: string;
}

export interface CrossCheckFinding {
  severity: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  documents?: string[];
}

export interface Customer360 {
  identity?: Record<string, unknown>;
  income?: Record<string, unknown>;
  collateral?: Record<string, unknown>;
  relationship?: Record<string, unknown>;
  legal?: Record<string, unknown>;
}

export interface EvidenceRecord {
  evidence_id: string;
  field_path: string;
  value: unknown;
  normalized_value: string | number | boolean | null;
  file_name: string;
  doc_type_key: string;
  doc_type_label: string;
  /** @deprecated Luôn null; không còn ghi. */
  classification_confidence?: number | null;
  extraction_method: 'AI_EXTRACT';
  evidence_kind?: 'EXTRACTED_FIELD' | 'CHECKLIST_STATUS';
  source_evidence_ids?: string[];
  review_status: 'ACCEPTED' | 'REVIEW';
}

export interface EvidenceRegistry {
  records: EvidenceRecord[];
  /** Chỉ có ở kết quả cũ. */
  by_file?: Array<{ file_name: string; doc_types: string[]; evidence_ids: string[] }>;
  /** Chỉ có ở kết quả cũ. */
  by_document_type?: Array<{ doc_type_key: string; file_names: string[]; evidence_ids: string[] }>;
}

export interface MetricResult {
  needs_review?: true;
  review_evidence_ids?: string[];
  input_conflict?: true;
  status: 'CALCULATED' | 'INSUFFICIENT_DATA' | 'NOT_APPLICABLE';
  value: number | null;
  unit: 'VND' | 'RATIO' | 'PERCENT' | 'MONTHS';
  formula: string;
  inputs?: Record<string, number | null>;
  evidence_ids?: string[];
  warnings: string[];
}

export interface AssessmentFinding {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  evidence_ids: string[];
}

export interface FiveCFactor {
  code: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  name: 'Character' | 'Capacity' | 'Capital' | 'Collateral' | 'Conditions';
  status: 'PASS' | 'PASS_WITH_CONDITIONS' | 'FAIL' | 'REVIEW' | 'NOT_RUN';
  strengths: AssessmentFinding[];
  weaknesses: AssessmentFinding[];
  evidence_ids: string[];
  review_required: boolean;
}

export interface PolicyRuleResult {
  rule_id: string;
  rule_version: string;
  severity: 'BLOCKER' | 'EXCEPTION' | 'REVIEW' | 'INFO';
  result: 'PASS' | 'FAIL' | 'REVIEW' | 'NOT_APPLICABLE' | 'NOT_RUN' | 'INSUFFICIENT_DATA';
  expected?: unknown;
  actual?: unknown;
  reason_code: string;
  message: string;
  evidence_ids: string[];
  exception_allowed: boolean;
  /** Rule engine (so sánh bằng code) hay rule LLM (chạy prompt cấu hình được). */
  check_kind?: 'DETERMINISTIC' | 'PROMPT';
  check_name?: string;
  /** Nhóm hiển thị; kết quả cũ không có thì UI suy từ rule_id. */
  group?: 'DOSSIER' | 'CAPACITY' | 'COLLATERAL' | 'LOAN_PLAN' | 'OTHER';
  confidence?: number | null;
  threshold?: number | null;
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
  threshold_source?: 'DEFAULT' | 'PROFILE';
  check_set?: {
    program: string;
    version: string;
    source: 'DEFAULT' | 'PROFILE';
    output_schema: string;
    flow?: LoanFlow;
    deterministic_count: number;
    prompt_count: number;
  };
}

export interface StressTestResult {
  status: 'NOT_CONFIGURED' | 'CALCULATED';
  scenarios: Array<{
    scenario_id: string;
    assumptions: Record<string, number>;
    dscr: MetricResult;
  }>;
}

export type LoanPhaseKey = 'DOSSIER_INTAKE' | 'CREDIT_APPRAISAL';

export type PhaseStatus = 'PENDING' | 'RUNNING' | 'PARTIAL' | 'COMPLETE' | 'BLOCKED';

export interface DossierReadiness {
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

// ─── VPBAI-6842: luồng vay, bảng file-first, party/asset, ma trận đối chiếu ────

/** Khóa luồng của chương trình checklist của sản phẩm (S4-R24), VD FULL/FAST/SIMPLE (HKD) hoặc A/B. */
export type LoanFlow = string;

export type ParticipantRole = 'BORROWER' | 'CO_BORROWER' | 'COLLATERAL_OWNER' | 'UNRESOLVED';

export type IntakeFileStatus = 'SUFFICIENT' | 'NEEDS_REVIEW' | 'UNRECOGNIZED' | 'OUT_OF_SCOPE' | 'MISSING';

export interface IntakeTableRow {
  file_name: string | null;
  doc_type_key: string | null;
  doc_type_label: string | null;
  detected_form_name?: string | null;
  group: string;
  party_label?: string | null;
  status: IntakeFileStatus;
  note?: string;
  substitute_of?: string | null;
}

export interface IntakeTable {
  flow: LoanFlow;
  rows: IntakeTableRow[];
  summary: {
    sufficient: number;
    needs_review: number;
    unrecognized: number;
    out_of_scope: number;
    missing: number;
  };
}

export type CrossCheckResult = 'MATCH' | 'MISMATCH' | 'INSUFFICIENT';

export interface CrossCheckValueSide {
  value: string;
  documents: string[];
  evidence_ids: string[];
}

export interface CrossCheckFieldResult {
  field_id: string;
  field_label: string;
  group: string;
  dimension: 'party' | 'asset' | 'single';
  party_id?: string | null;
  subject_label?: string | null;
  result: CrossCheckResult;
  sides: CrossCheckValueSide[];
  evidence_ids: string[];
}

export interface CrossCheckMatrixResult {
  fields: CrossCheckFieldResult[];
  summary: { compared: number; matched: number; mismatched: number };
}

export interface DocumentFieldValue {
  field_path: string;
  value: string | number | boolean | null;
  evidence_id: string;
}

export interface DocumentPartySegment {
  party_id: string | null;
  party_name: string | null;
  roles: ParticipantRole[];
  fields: DocumentFieldValue[];
}

export interface DocumentPartyView {
  file_name: string;
  doc_type_key: string;
  doc_type_label: string;
  detected_form_name?: string | null;
  total_fields: number;
  segments: DocumentPartySegment[];
}

export interface ParticipantGroup {
  role: ParticipantRole;
  roles: ParticipantRole[];
  full_name: string | null;
  id_number: string | null;
  source_documents: string[];
  doc_type_keys: string[];
  evidence_ids: string[];
}

export interface CollateralGroup {
  asset_kind: 'VEHICLE' | 'REAL_ESTATE';
  identifier_type: 'ENGINE_OR_CHASSIS' | 'CERTIFICATE' | 'LAND_PARCEL';
  identifier: string;
  source_documents: string[];
  doc_type_keys: string[];
  evidence_ids: string[];
}

export interface DossierGrouping {
  participants: ParticipantGroup[];
  collateral_groups: CollateralGroup[];
  document_views: DocumentPartyView[];
  notes: string[];
}

export interface AppraisalResult {
  loan_application_context_summary?: LoanApplicationContextSummary;
  product_code: string;
  product_name: string;
  /** V2-R09 (output 3.0): S1 + S2. */
  documents: DossierOutputV3['documents'];
  /** S3: người, tài sản, quan hệ, Customer 360. */
  customer_360: DossierOutputV3['customer_360'];
  /** Quan hệ người – tài sản – chứng từ dạng nodes + edges (id và nhãn, không PII). Không có ở kết quả cũ. */
  dossier_graph?: DossierOutputV3['dossier_graph'];
  /** Hồ sơ 360 — nguồn sự thật duy nhất của giao diện Customer 360 (D-114). null khi S3 / LAC lỗi; vắng ở kết quả trước D-114. */
  profile_360?: DossierOutputV3['profile_360'];
  /** S4: checklist 46 mục theo nhóm. */
  checklist: DossierOutputV3['checklist'];
  completeness_percent: number;
  /** S5: đối chiếu chéo theo ma trận + logic rule. */
  cross_check: DossierOutputV3['cross_check'];
  risk_notes: string[];

  /** Ghi chú do hệ thống sinh. */
  system_notes?: string[];
  output_version?: '3.0';
  workflow_version?: string;
  processing_status?: 'COMPLETE' | 'PARTIAL' | 'REVIEW_REQUIRED' | 'BLOCKED';
  config_snapshot?: LoanConfigSnapshot;
  /** 4 tiêu chí tiếp nhận (D-47). */
  intake_assessment?: IntakeAssessment;
  /** D-73: kiểm tra sơ bộ checklist + quan hệ hồ sơ bằng LLM ngay sau S1 (nháp). */
  dossier_precheck?: DossierPrecheck | null;
  /** D-51: có giá trị khi workflow dừng sau giai đoạn 1 — chưa có kết quả giai đoạn 2. */
  result_phase?: 'DOSSIER_INTAKE';
  flow?: LoanFlow;
  dossier_readiness?: DossierReadiness;
  evidence?: EvidenceRegistry;
  financial_metrics?: Record<string, MetricResult>;
  /** @deprecated Chỉ có ở kết quả cũ; UI không còn hiển thị 5C. */
  five_c?: { factors: FiveCFactor[]; overall_status: FiveCFactor['status'] };
  policy_compliance?: {
    policy_id: string;
    policy_version: string;
    status: FiveCFactor['status'];
    rule_results: PolicyRuleResult[];
    exceptions: string[];
    external_checks: Array<{ check: string; status: string; reason_code: string }>;
  };
  /** @deprecated Đã bỏ stage stress/score; chỉ có ở kết quả cũ. */
  stress_test?: StressTestResult;
  /** @deprecated Đã bỏ stage stress/score; chỉ có ở kết quả cũ. */
  credit_score?: {
    status: 'AVAILABLE' | 'UNAVAILABLE';
    scorecard_id: string | null;
    scorecard_version: string | null;
    rating: string | null;
    pd: number | null;
    lgd: number | null;
    reason_codes: string[];
  };
  recommendation?: {
    recommendation: 'CONSIDER' | 'REFER' | 'INSUFFICIENT_DATA';
    suggested_amount_vnd: number | null;
    suggested_tenor_months: number | null;
    conditions_precedent: string[];
    covenants: string[];
    reason_codes: string[];
    review_required: boolean;
  };
  review?: {
    required: boolean;
    route: 'STRAIGHT_THROUGH' | 'CREDIT_REVIEW' | 'RISK_REVIEW' | 'REQUEST_DOCUMENTS';
    reasons: string[];
    required_role: string | null;
  };
}

export interface LoanCase {
  id: string;
  customerName: string;
  loanAmount: string;
  productCode: string;
  productName: string;
  createdAt: number;
}
