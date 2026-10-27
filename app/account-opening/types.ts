// Client-side mirror của public contract Account Opening V1.
// Mọi field V1 mở rộng đều optional để operation đang chạy (chưa tới stage cuối)
// vẫn render được bằng phần kết quả cơ bản.

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export type AccountStageKey =
  | 'classify'
  | 'extract_evidence'
  | 'consolidate_profile'
  | 'evaluate_eligibility'
  | 'assess_cdd_risk'
  | 'evaluate_policy_compliance'
  | 'screen_watchlists'
  | 'synthesize_decision';

export type AccountPhaseKey = 'DOSSIER_INTAKE' | 'ONBOARDING_ASSESSMENT';

export type CustomerSegmentKey = 'KHCN' | 'HKD' | 'SME' | 'KHDN';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNDETERMINED';
export type DueDiligenceLevel = 'SDD' | 'CDD' | 'EDD';
export type AssessmentStatus = 'PASS' | 'PASS_WITH_CONDITIONS' | 'FAIL' | 'REVIEW' | 'NOT_RUN';

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  icon: string;
}

export interface BackendWorkflowStep {
  step?: number;
  stage_key?: AccountStageKey | string;
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

export interface CustomerProfile {
  identity?: Record<string, unknown>;
  contact?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  authorization?: Record<string, unknown>;
  ownership?: Record<string, unknown>;
  compliance?: Record<string, unknown>;
  account?: Record<string, unknown>;
}

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

export interface MetricResult {
  status: 'CALCULATED' | 'INSUFFICIENT_DATA' | 'NOT_APPLICABLE';
  value: number | null;
  unit: 'VND' | 'PERCENT' | 'RATIO' | 'YEARS' | 'MONTHS' | 'DAYS' | 'COUNT';
  formula: string;
  inputs?: Record<string, number | string | null>;
  evidence_ids?: string[];
  warnings: string[];
}

/** Khoá của 10 chỉ tiêu điều kiện; dùng để render theo thứ tự nghiệp vụ. */
export type EligibilityMetricKey =
  | 'applicant_age'
  | 'primary_id_validity_days'
  | 'residency_permit_validity_days'
  | 'organization_age_months'
  | 'charter_capital'
  | 'declared_annual_revenue'
  | 'beneficial_owner_coverage_percent'
  | 'authorized_signatory_count'
  | 'mandatory_profile_coverage_percent'
  | 'document_completeness_percent';

export type EligibilityMetrics = Record<EligibilityMetricKey, MetricResult>;

export interface AssessmentFinding {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  evidence_ids: string[];
}

export interface CddFactor {
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
  factors: CddFactor[];
  overall_status: AssessmentStatus;
  risk_rating: RiskLevel;
  due_diligence_level: DueDiligenceLevel;
  escalation_reasons: string[];
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
  /** Phạm vi phân khúc/sản phẩm mà rule này áp dụng. */
  check_scope?: { segments: CustomerSegmentKey[]; products: string[] };
  confidence?: number | null;
  threshold?: number | null;
}

export interface ProfileFieldProvenance {
  group: string;
  group_label: string;
  field_path: string;
  label: string;
  value: string;
  provenance: 'VERIFIED' | 'NEEDS_REVIEW' | 'UNVERIFIED';
  evidence_ids: string[];
  source_documents: string[];
}

export interface ProfileProvenance {
  fields: ProfileFieldProvenance[];
  summary: {
    total: number;
    verified: number;
    needs_review: number;
    unverified: number;
    traceable_percent: number;
  };
  mandatory_fields: Array<{
    field_path: string;
    label: string;
    status: 'VERIFIED' | 'NEEDS_REVIEW' | 'UNVERIFIED' | 'MISSING';
  }>;
  mandatory_coverage_percent: number;
}

export interface ScreeningResult {
  status: 'NOT_CONFIGURED' | 'COMPLETED';
  provider_id: string | null;
  provider_version: string | null;
  checks: Array<{
    check: 'AML' | 'PEP' | 'SANCTIONS' | 'ADVERSE_MEDIA' | 'CIF_DUPLICATE' | 'BLACKLIST' | string;
    subject: string | null;
    status: 'NOT_RUN' | 'PASS' | 'FAIL';
    reason_code: string;
  }>;
  reason_codes: string[];
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
  threshold_source?: 'DEFAULT' | 'PROFILE';
  check_set?: {
    program: string;
    version: string;
    source: 'DEFAULT' | 'PROFILE';
    output_schema: string;
    deterministic_count: number;
    prompt_count: number;
  };
}

export interface DossierReadiness {
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
  assessment_conditional: boolean;
}

export interface AccountOpeningResult {
  segment_key: CustomerSegmentKey;
  segment_name: string;
  product_code: string;
  product_name: string;
  documents: ClassifiedDoc[];
  customer_profile: CustomerProfile;
  checklist: ChecklistItemResult[];
  completeness_percent: number;
  cross_check: CrossCheckFinding[];
  risk_notes: string[];
  overall_assessment: string;

  // Các field V1 mở rộng — optional để artifact stage giữa vẫn render được.
  output_version?: '1.0';
  workflow_version?: string;
  processing_status?: 'COMPLETE' | 'PARTIAL' | 'REVIEW_REQUIRED' | 'BLOCKED';
  config_snapshot?: AccountConfigSnapshot;
  profile_provenance?: ProfileProvenance;
  intake?: {
    required_present: number;
    required_total: number;
    completeness_percent: number;
    missing_required_keys: string[];
    review_required_keys: string[];
    extraction_errors: Array<{ file_name: string; doc_type_key: string; error: string }>;
  };
  dossier_readiness?: DossierReadiness;
  evidence?: EvidenceRegistry;
  eligibility_metrics?: EligibilityMetrics;
  cdd_assessment?: CddAssessment;
  policy_compliance?: {
    policy_id: string;
    policy_version: string;
    status: AssessmentStatus;
    rule_results: PolicyRuleResult[];
    exceptions: string[];
  };
  screening?: ScreeningResult;
  recommendation?: {
    recommendation: 'ELIGIBLE_TO_OPEN' | 'REFER' | 'INSUFFICIENT_DATA';
    proposed_account_type: string | null;
    risk_rating: RiskLevel;
    due_diligence_level: DueDiligenceLevel;
    conditions_precedent: string[];
    restrictions: string[];
    reason_codes: string[];
    review_required: boolean;
  };
  review?: {
    required: boolean;
    route: 'STRAIGHT_THROUGH' | 'KYC_REVIEW' | 'COMPLIANCE_REVIEW' | 'REQUEST_DOCUMENTS';
    reasons: string[];
    required_role: string | null;
  };
  audit?: {
    workflow_version: string;
    generated_at: string;
    stages: Array<{ stage_key: AccountStageKey; phase: AccountPhaseKey; status: 'SUCCESS' | 'PARTIAL_SUCCESS' }>;
    deterministic_calculations: boolean;
    final_authority: 'EXTERNAL_ONBOARDING_SYSTEM';
  };
}
