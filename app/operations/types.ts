// app/operations/types.ts
// TypeScript interfaces, utility functions, and constants for Operations UI

// ═══════════════════════════════════════════════
// Types & Interfaces
// ═══════════════════════════════════════════════

export type OperationState =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PENDING'
  | 'WAITING_USER_INPUT'
  | 'CANCELLED';

/** Item trong danh sách operations (lightweight) */
export interface OperationListItem {
  id: string;
  done: boolean;
  state: OperationState;
  endpointSlug: string | null;
  progressPercent: number;
  progressMessage: string | null;
  /** Chỉ route DETAIL trả field này; LIST không trả nên để optional (tránh type-lie). */
  progressHistory?: ProgressLogEntry[];
  currentStep: number;
  errorCode: string | null;
  errorMessage: string | null;
  failedAtStep: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  apiKeyId: string | null;
  profileName: string | null;
  correlationId: string | null;
  clientReference: string | null;
  createdAt: string;
  updatedAt: string;
  /** Terminal-state timestamp (SUCCEEDED/FAILED/CANCELLED). Null while still running.
   *  Legacy rows without it fall back to `updatedAt` for duration display. */
  completedAt: string | null;
}

/** Additive list view fields used by the Operations dashboard. */
export interface OperationListItemView extends OperationListItem {
  idempotencyKey: string | null;
  /** True only when usageBreakdown explicitly marks an unpriced model. */
  hasUnpricedCost: boolean;
}

/** Response từ list API (offset pagination) */
export interface OperationsListResponse {
  operations: OperationListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  filter_options: {
    endpoints: string[];
    profiles: { id: string; name: string }[];
  };
}

/**
 * Full detail của một operation — CHỈ METADATA (xem app/api/internal/operations/[id]/route.ts).
 * Giá trị parameter, prompt, kết quả trích xuất, output và chi tiết từng bước không
 * được API trả về; riêng `waitingInput` là ngoại lệ khi WAITING_USER_INPUT.
 */
export interface OperationDetail extends OperationListItem {
  idempotencyKey: string | null;
  pipelineJson: PipelineStep[];
  /** file_urls gốc của request workflow (URL đã bỏ query string). */
  originalFileUrls: OriginalFileUrl[];
  stepsResultJson: StepResult[];
  /** Dữ liệu bước đang chờ xác nhận — chỉ có khi state = WAITING_USER_INPUT. */
  waitingInput: { step: number; extracted_data: unknown } | null;
  /** Tóm tắt vận hành có cấu trúc (hiện chỉ OCR & dịch BCTC), không chứa số liệu nghiệp vụ. */
  resultSummary: unknown;
  outputFormat: string;
  filesJson: FileInfo[];
  usageBreakdown: UsageBreakdownItem[];
  webhookUrl: string | null;
  webhookSentAt: string | null;
  /** Null means a legacy sender did not record delivery diagnostics. */
  webhookAttempts: number | null;
  webhookLastError: string | null;
  pagesProcessed: number;
  modelUsed: string | null;
  filesDeleted: boolean;
  /** Thời điểm nội dung request/kết quả bị xóa theo chính sách lưu trữ; null = còn. */
  contentPurgedAt: string | null;
  /** Các sub-step (mỗi lần gọi connector) của workflow. */
  subSteps: SubStep[];
}

export interface OriginalFileUrl {
  filename: string | null;
  mime_type: string | null;
  url: string | null;
}

/** Một sub-step (một lần gọi connector) của workflow — metadata, không có prompt. */
export interface SubStep {
  id: string;
  processor: string | null;   // connector slug (ext-classifier, ext-data-extractor, ...)
  model: string | null;       // model override theo bước (nếu có)
  reasoningEffort: string | null;
  fileName: string | null;    // file đính kèm sub-step (nếu có)
  state: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  errorCode: string | null;
  errorMessage: string | null;
  /** Độ dài / sha256 của prompt đã gửi — nội dung prompt không được lưu hiển thị. */
  promptLength: number | null;
  promptSha256: string | null;
  contentPurged: boolean;
  /** Prompt / kết quả của bước con (không có file). Chỉ có khi server bật WORKFLOW_SUBSTEP_KEEP_CONTENT và người xem là ADMIN. */
  prompt?: string | null;
  output?: string | null;
}

export interface ProgressLogEntry {
  t: string;
  percent: number;
  message: string;
}

export interface PipelineStep {
  processor: string | null;
  stepId?: string;
  /** Tên parameter request mang theo — giá trị không được trả về. */
  parameterNames: string[];
}

export interface StepResult {
  step: number;
  stepName?: string;
  processor: string;
  sub_operation_id?: string;
  output_format?: string;
  is_human_edited?: boolean;
  stage_key?: string;
  status?: string;
  /** Số kết quả con của bước (nội dung không trả về). */
  sub_result_count?: number;
}

export interface FileInfo {
  name: string;
  mime: string | null;
  size: number | null;
  isRemoteUrl: boolean;
  /** URL đã bỏ query string. */
  url: string | null;
}

/** Where a cost figure came from (mirrors lib/pricing CostSource) */
export type CostSourceLabel = 'provider' | 'estimate' | 'unpriced' | 'none';

export interface UsageBreakdownItem {
  processor: string;
  model?: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cost_source?: CostSourceLabel;
}

/** Trạng thái hiển thị của mỗi pipeline step */
export type StepDisplayStatus = 'completed' | 'running' | 'pending' | 'failed';

/** Filter state cho danh sách */
export interface OperationFiltersState {
  state: OperationState | 'ALL';
  endpoint: string | 'ALL';
  profile: string | 'ALL'; // chỉ ADMIN mới dùng
  searchQuery: string;
  startDate: string;
  endDate: string;
}

// ═══════════════════════════════════════════════
// Business Operations dashboard contracts
// ═══════════════════════════════════════════════

/** Four server-authoritative calendar presets supported by the dashboard API. */
export type BusinessOperationsTimeRange =
  | 'today'
  | 'this_month'
  | 'last_month'
  | 'three_month_trend';

export type BusinessStatus = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'N/A';
export type BusinessStatusFilter = BusinessStatus | 'ALL';
export type BusinessOperationSearchMode = 'exact' | 'contains';
export type BusinessTrendStatus = Exclude<BusinessStatus, 'N/A'>;
export type BusinessOperationSort = 'recent' | 'duration' | 'tokens' | 'cost';

export const BUSINESS_OPERATION_SORT_OPTIONS: ReadonlyArray<{ value: BusinessOperationSort; label: string }> = [
  { value: 'recent', label: 'Mới cập nhật' },
  { value: 'duration', label: 'Thời gian lâu nhất' },
  { value: 'tokens', label: 'Nhiều token nhất' },
  { value: 'cost', label: 'Chi phí cao nhất' },
];

export interface BusinessOperationSearchFilter {
  query: string;
  mode: BusinessOperationSearchMode;
}

/** Canonical filter returned as `appliedFilter` after server validation. */
export interface BusinessOperationsDashboardFilter {
  range: BusinessOperationsTimeRange;
  profile: string; // ALL | __internal__ | an authorized profile id
  operationType: string; // ALL | endpoint slug
  status: BusinessStatusFilter;
  search: BusinessOperationSearchFilter | null;
  sort: BusinessOperationSort;
  page: number;
}

/** Editable client filter state before a successful response commits it. */
export interface BusinessOperationsFilterState {
  range: BusinessOperationsTimeRange;
  profile: string;
  operationType: string;
  status: BusinessStatusFilter;
  query: string;
  searchMode: BusinessOperationSearchMode;
  sort: BusinessOperationSort;
  page: number;
}

export interface BusinessOperationsResolvedWindow {
  start: string;
  end: string;
  startInclusive: true;
  endInclusive: boolean;
  preset: BusinessOperationsTimeRange;
}

export interface BusinessOperationProfileScope {
  id: string | null;
  name: string;
}

export interface BusinessOperationsSummary {
  totalCases: number;
  tokensProcessed: number;
  totalCostUsd: string;
  logicSuccessRate: number | null;
  aiExtractionRate: number | null;
  p95DurationSeconds: number | null;
  unpricedRequestCount: number;
  costIncomplete: boolean;
}

/** One profile/operation-type card in the approved business dashboard. */
export interface BusinessOperationBreakdownCard {
  profileScope: BusinessOperationProfileScope;
  operationType: string;
  businessOperationCount: number;
  succeededCount: number;
  failedCount: number;
  successPercentage: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  averageTokensPerBusinessOperation: number;
  averageDurationSeconds: number | null;
  maxDurationOperationIdentifier: string | null;
  maxTokenOperationIdentifier: string;
  maxDurationOperationToken: string | null;
  maxTokenOperationToken: string | null;
  maxDurationSeconds: number | null;
  maxTokenCount: number;
  unpricedRequestCount: number;
  costIncomplete: boolean;
}

export interface BusinessOperationTrendPoint {
  unit: 'hour' | 'day';
  localKey: string;
  occurrence: number;
  start: string;
  end: string;
  startInclusive: true;
  endInclusive: boolean;
  clippedStart: boolean;
  clippedEnd: boolean;
  counts: Record<BusinessTrendStatus, number>;
  total: number;
}

export interface BusinessOperationListItem {
  token: string;
  operationIdentifier: string;
  normalizedReference: string | null;
  profileScope: BusinessOperationProfileScope;
  operationTypes: string[];
  businessStatus: BusinessStatus;
  invalidData: boolean;
  requestCount: number;
  startTime: string;
  updatedTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  totalTokens: number;
  totalCostUsd: string;
  unpricedRequestCount: number;
  missingData: boolean;
}

export interface BusinessOperationListPage {
  items: BusinessOperationListItem[];
  page: number;
  pageSize: 50;
  total: number;
  totalPages: number;
}

export interface BusinessOperationsDashboardResponse {
  queryTimestamp: string;
  calendarTimezone: string;
  resolvedWindow: BusinessOperationsResolvedWindow;
  appliedFilter: BusinessOperationsDashboardFilter;
  summary: BusinessOperationsSummary;
  breakdownCards: BusinessOperationBreakdownCard[];
  trend: {
    bucket: 'hour' | 'day';
    points: BusinessOperationTrendPoint[];
  };
  list: BusinessOperationListPage;
}

export interface BusinessOperationDetailItem extends BusinessOperationListItem {
  endTime: string | null;
  durationSeconds: number | null;
}

export interface ConstituentRequestItem {
  id: string;
  operationType: string | null;
  state: string;
  startedAt: string;
  completedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  missingData: boolean;
  unpricedCost: boolean;
}

export interface ConstituentRequestPage {
  items: ConstituentRequestItem[];
  page: number;
  pageSize: 100;
  total: number;
  totalPages: number;
}

export interface BusinessOperationDetailResponse {
  queryTimestamp: string;
  operation: BusinessOperationDetailItem;
  requests: ConstituentRequestPage;
}

export const BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS: ReadonlyArray<{
  value: BusinessOperationsTimeRange;
  label: string;
}> = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'this_month', label: 'Tháng này' },
  { value: 'last_month', label: 'Tháng trước' },
  { value: 'three_month_trend', label: 'Xu hướng 3 tháng' },
];

export type BusinessDashboardKpiKey =
  | 'totalCases'
  | 'tokensProcessed'
  | 'totalCostUsd'
  | 'logicSuccessRate'
  | 'aiExtractionRate';

export const BUSINESS_DASHBOARD_KPIS: ReadonlyArray<{
  key: BusinessDashboardKpiKey;
  label: string;
}> = [
  { key: 'totalCases', label: 'Total Cases' },
  { key: 'tokensProcessed', label: 'Tokens Processed' },
  { key: 'totalCostUsd', label: 'Total Cost USD' },
  { key: 'logicSuccessRate', label: 'Logic Success Rate' },
  { key: 'aiExtractionRate', label: 'AI Extraction Rate' },
];

export const BUSINESS_STATUS_BADGE_CONFIG: Record<
  BusinessStatus,
  { label: string; className: string }
> = {
  IN_PROGRESS: {
    label: 'Đang xử lý',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  SUCCEEDED: {
    label: 'Thành công',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  FAILED: {
    label: 'Thất bại',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  },
  'N/A': {
    label: 'N/A',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  },
};

// ═══════════════════════════════════════════════
// Dashboard v2 types (Overview / Cost / Stuck) — additive
// ═══════════════════════════════════════════════

/** Tabs of the Operations page */
export type OperationsTab = 'overview' | 'requests' | 'cost';

/** A single "stuck" (nghi treo) operation */
export interface StuckItem {
  id: string;
  state: OperationState;
  endpointSlug: string | null;
  profileName: string | null;
  clientReference: string | null;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
  stuckMinutes: number;
}

export interface StuckResponse {
  thresholds: { running_min: number; pending_min: number };
  count: number;
  items: StuckItem[];
}

/** One row of the profile/endpoint breakdown aggregation */
export interface BreakdownRow {
  key: string;   // apiKeyId or endpointSlug ('__none__' when null)
  name: string;
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  /** Requests with tokens but $0 cost (model price not configured) */
  unpricedCount: number;
}

export interface BreakdownResponse {
  group_by: 'profile' | 'endpoint';
  rows: BreakdownRow[];
}

/** One time bucket of the trend chart */
export interface TimeseriesPoint {
  ts: string;
  total: number;
  succeeded: number;
  failed: number;
  cost: number;
  tokensIn: number;
  tokensOut: number;
}

export interface TimeseriesResponse {
  bucket: 'hour' | 'day';
  points: TimeseriesPoint[];
  /** True when chart coverage was capped to the newest 300 buckets. */
  truncated?: boolean;
  coverageStart?: string;
}

/** Throughput (requests received per bucket) — for rate-limit sizing */
export interface ThroughputProfile {
  key: string;
  name: string;
  total: number;
  peak: number;  // max requests in a single bucket
  avg: number;   // average requests per bucket
}

export interface ThroughputResponse {
  bucket: 'minute' | 'hour';
  points: { ts: string; total: number }[];
  perProfile: ThroughputProfile[];
  /** True when server-side safety limits shortened the requested coverage. */
  truncated?: boolean;
  coverageStart?: string;
}

// ═══════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════

export const STATE_BADGE_CONFIG: Record<OperationState, { label: string; className: string }> = {
  SUCCEEDED:          { label: 'Thành công',   className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  FAILED:             { label: 'Thất bại',     className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  RUNNING:            { label: 'Đang chạy',    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  WAITING_USER_INPUT: { label: 'Chờ xác nhận', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  CANCELLED:          { label: 'Đã hủy',       className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400' },
  PENDING:            { label: 'Chờ xử lý',    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400' },
};

// ═══════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════

/** Safely parse a JSON string with a fallback value */
export function safeParseJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Determine the display status of a pipeline step.
 *
 * Priority:
 * 1. Step has a result in stepsResult → 'completed'
 * 2. Step index matches failedAtStep → 'failed'
 * 3. Step index matches currentStep AND operation is RUNNING → 'running'
 * 4. Otherwise → 'pending'
 */
export function getStepDisplayStatus(
  stepIndex: number,
  stepsResult: StepResult[],
  currentStep: number,
  failedAtStep: number | null,
  operationState: OperationState,
): StepDisplayStatus {
  const hasResult = stepsResult.some((r) => r.step === stepIndex);
  if (hasResult) return 'completed';
  if (failedAtStep !== null && stepIndex === failedAtStep) return 'failed';
  if (stepIndex === currentStep && operationState === 'RUNNING') return 'running';
  return 'pending';
}
