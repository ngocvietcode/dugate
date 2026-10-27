// lib/operations/detail-view.ts
//
// Metadata-only projection of an Operation for the Operations detail page
// (GET /api/internal/operations/[id]). The page shows WHAT a request carried and
// HOW it ran — endpoint, parameter names, files, steps, sub-steps, connectors,
// states, timings, tokens, cost, errors — never the customer values themselves.
// The cut is made here, at the API, because anything shipped to the browser can
// be read or downloaded regardless of what the UI renders.
//
// Exception: while an operation is WAITING_USER_INPUT the operator must review and
// may edit the extracted data of the waiting step, so that one payload is returned.

import { extractTrustedChildOperationIds } from '@/lib/operations/backfill';
import { sha256Hex, stripUrlQuery } from '@/lib/operations/content-retention';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

export function safeParseJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

// ─── Request definition ──────────────────────────────────────────────────────

export interface PipelineStepView {
  processor: string | null;
  stepId?: string;
  /** Request/business parameters the step carried. Values are never returned. */
  parameterNames: string[];
}

export interface OriginalFileUrlView {
  filename: string | null;
  mime_type: string | null;
  /** Query string and fragment removed (signed-URL credentials live there). */
  url: string | null;
}

/** Engine-internal variables are not request parameters. */
const isInternalVariable = (key: string) => key.startsWith('_');

export function toPipelineStepViews(pipeline: unknown): PipelineStepView[] {
  if (!Array.isArray(pipeline)) return [];
  return pipeline.map((step) => {
    if (!isRecord(step)) return { processor: null, parameterNames: [] };
    const variables = isRecord(step.variables) ? step.variables : {};
    return {
      processor: typeof step.processor === 'string' ? step.processor : null,
      ...(typeof step.stepId === 'string' ? { stepId: step.stepId } : {}),
      parameterNames: Object.keys(variables).filter((key) => !isInternalVariable(key)).sort(),
    };
  });
}

export function toOriginalFileUrls(pipeline: unknown): OriginalFileUrlView[] {
  if (!Array.isArray(pipeline) || !isRecord(pipeline[0]) || !isRecord(pipeline[0].variables)) return [];
  const raw = pipeline[0].variables._original_file_urls;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((entry) => ({
    filename: typeof entry.filename === 'string' ? entry.filename : null,
    mime_type: typeof entry.mime_type === 'string' ? entry.mime_type : null,
    url: typeof entry.url === 'string' ? stripUrlQuery(entry.url) : null,
  }));
}

export interface FileView {
  name: string;
  mime: string | null;
  size: number | null;
  isRemoteUrl: boolean;
  url: string | null;
}

export function toFileViews(files: unknown): FileView[] {
  if (!Array.isArray(files)) return [];
  return files.filter(isRecord).map((file) => {
    const name = typeof file.name === 'string'
      ? file.name
      : typeof file.filename === 'string' ? file.filename : 'file';
    const mime = typeof file.mime === 'string'
      ? file.mime
      : typeof file.mime_type === 'string' ? file.mime_type : null;
    return {
      name,
      mime,
      size: typeof file.size === 'number' ? file.size : null,
      isRemoteUrl: file.isRemoteUrl === true,
      url: typeof file.url === 'string' ? stripUrlQuery(file.url) : null,
    };
  });
}

// ─── Steps ───────────────────────────────────────────────────────────────────

const STEP_KEYS = [
  'step',
  'stepName',
  'processor',
  'sub_operation_id',
  'output_format',
  'is_human_edited',
  'stage_key',
  'artifact_version',
  'status',
] as const;

export interface StepView {
  step: number;
  stepName?: string;
  processor: string;
  sub_operation_id?: string;
  output_format?: string;
  is_human_edited?: boolean;
  stage_key?: string;
  artifact_version?: string;
  status?: string;
  /** Number of nested sub-results the step produced (content not returned). */
  sub_result_count?: number;
}

export function toStepViews(steps: unknown): StepView[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((step, index) => {
    if (!isRecord(step)) return { step: index, processor: '' };
    const out: Record<string, unknown> = {};
    for (const key of STEP_KEYS) {
      if (key in step && isPrimitive(step[key]) && step[key] !== null) out[key] = step[key];
    }
    if (typeof out.step !== 'number') out.step = index;
    if (typeof out.processor !== 'string') out.processor = '';
    if (Array.isArray(step.sub_results)) out.sub_result_count = step.sub_results.length;
    return out as unknown as StepView;
  });
}

export interface WaitingInputView {
  step: number;
  extracted_data: unknown;
}

/** The single content exception: the payload an operator must review before resume. */
export function toWaitingInput(
  state: string,
  currentStep: number,
  steps: unknown,
  extractedData: unknown,
): WaitingInputView | null {
  if (state !== 'WAITING_USER_INPUT') return null;
  const waiting = Array.isArray(steps)
    ? steps.find((step) => isRecord(step) && step.step === currentStep)
    : undefined;
  const data = isRecord(waiting) && 'extracted_data' in waiting ? waiting.extracted_data : extractedData;
  return { step: currentStep, extracted_data: data ?? null };
}

// ─── Workflow sub-steps ──────────────────────────────────────────────────────

export interface SubStepSourceRow {
  id: string;
  endpointSlug: string | null;
  pipelineJson: string;
  filesJson: string | null;
  state: string;
  createdAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  done: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  errorCode: string | null;
  errorMessage: string | null;
  contentPurgedAt: Date | null;
  correlationId: string | null;
  /** Model thực tế connector báo về (`ext:<model>`); dùng khi không có override `_model`. */
  modelUsed?: string | null;
}

export interface SubStepView {
  id: string;
  processor: string | null;
  model: string | null;
  reasoningEffort: string | null;
  fileName: string | null;
  state: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  errorCode: string | null;
  errorMessage: string | null;
  /** Length / sha256 of the prompt actually sent; the text itself is never returned. */
  promptLength: number | null;
  promptSha256: string | null;
  contentPurged: boolean;
  /** Chỉ có khi `WORKFLOW_SUBSTEP_KEEP_CONTENT` bật, người xem là ADMIN và nội dung chưa bị xoá. Không bao giờ có file. */
  prompt?: string | null;
  output?: string | null;
}

export interface SubStepSourceContent {
  outputContent: string | null;
  extractedData: string | null;
}

/** Prompt gốc (chưa bị scrub) của bước con; null nếu đã thành `[purged]` hoặc không có. */
function readPrompt(variables: Record<string, unknown>): string | null {
  const prompt = variables._prompt;
  return typeof prompt === 'string' && prompt !== '[purged]' ? prompt : null;
}

/**
 * Model hiển thị cho bước con: override `_model` (profile/workflow) nếu có, nếu không thì model thực tế
 * connector trả về (`operations.modelUsed` = `ext:<model>`). `ext:<slug>` (response không có model) và
 * `internal:*` không phải tên model nên bỏ.
 */
function resolveSubStepModel(override: unknown, modelUsed: string | null | undefined, processor: string | null): string | null {
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (typeof modelUsed !== 'string' || !modelUsed.startsWith('ext:')) return null;
  const name = modelUsed.slice('ext:'.length).trim();
  return name && name !== processor ? name : null;
}

export function toSubStepView(row: SubStepSourceRow & Partial<SubStepSourceContent>, includeContent = false): SubStepView {
  const pipeline = safeParseJson<unknown[]>(row.pipelineJson, []);
  const variables = Array.isArray(pipeline) && isRecord(pipeline[0]) && isRecord(pipeline[0].variables)
    ? pipeline[0].variables
    : {};
  const files = safeParseJson<unknown[]>(row.filesJson, []);
  const firstFile = Array.isArray(files) && isRecord(files[0]) ? files[0] : null;

  let promptLength: number | null = null;
  let promptSha256: string | null = null;
  if (typeof variables._prompt_length === 'number') {
    promptLength = variables._prompt_length;
    promptSha256 = typeof variables._prompt_sha256 === 'string' ? variables._prompt_sha256 : null;
  } else if (typeof variables._prompt === 'string' && variables._prompt.length > 0) {
    promptLength = variables._prompt.length;
    promptSha256 = sha256Hex(variables._prompt);
  }

  const finishedAt = row.done ? (row.completedAt ?? row.updatedAt) : null;
  return {
    id: row.id,
    processor: row.endpointSlug,
    model: resolveSubStepModel(variables._model, row.modelUsed, row.endpointSlug),
    reasoningEffort: typeof variables._reasoning_effort === 'string' ? variables._reasoning_effort : null,
    // `display_name`: tên gốc để theo dõi khi file gửi model mang tên trung tính (VD loan-appraisal, S1-R03).
    fileName: firstFile && typeof firstFile.display_name === 'string' && firstFile.display_name
      ? firstFile.display_name
      : firstFile && typeof firstFile.name === 'string' ? firstFile.name : null,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    completedAt: finishedAt ? finishedAt.toISOString() : null,
    durationMs: finishedAt ? Math.max(0, finishedAt.getTime() - row.createdAt.getTime()) : null,
    inputTokens: row.totalInputTokens,
    outputTokens: row.totalOutputTokens,
    costUsd: Number(row.totalCostUsd) || 0,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    promptLength,
    promptSha256,
    contentPurged: row.contentPurgedAt !== null,
    ...(includeContent && row.contentPurgedAt === null
      ? { prompt: readPrompt(variables), output: row.outputContent ?? row.extractedData ?? null }
      : {}),
  };
}

/** Child IDs named by the parent's own artifacts (survive a resume's new correlationId). */
export function referencedChildIds(stepsResultJson: string | null, extractedData: string | null): string[] {
  return extractTrustedChildOperationIds(stepsResultJson, extractedData);
}

/**
 * Keeps connector sub-steps of this run: rows named by the parent, plus rows that
 * share its correlationId and started at/after it (guards correlationId reuse).
 */
export function selectRunSubSteps(
  parent: { id: string; createdAt: Date },
  rows: Array<SubStepSourceRow & Partial<SubStepSourceContent>>,
  referencedIds: ReadonlySet<string>,
  includeContent = false,
): SubStepView[] {
  return rows
    .filter((row) => row.id !== parent.id && !row.endpointSlug?.startsWith('workflows:'))
    .filter((row) => referencedIds.has(row.id) || row.createdAt.getTime() >= parent.createdAt.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((row) => toSubStepView(row, includeContent));
}

// ─── Typed operational result summaries ──────────────────────────────────────

const FINANCIAL_REPORT_TYPES = [
  'balanceSheet',
  'incomeStatement',
  'comprehensiveIncome',
  'cashFlowStatement',
  'equityChangeStatement',
  'sgaBreakdown',
  'notesToFinancialStatements',
] as const;

const numberOr = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * OCR & translation of financial reports: per-file status, error codes and
 * processing counters only. Report figures, titles, notes and classify traces
 * are dropped. Shape matches components/financial-report/FinancialReportOperationsSummary.
 */
export function toFinancialReportSummary(extracted: unknown): Record<string, unknown> | null {
  if (!isRecord(extracted)
    || !Number.isFinite(extracted.code)
    || typeof extracted.requestId !== 'string'
    || typeof extracted.message !== 'string'
    || typeof extracted.timestamp !== 'string'
    || typeof extracted.targetLang !== 'string') {
    return null;
  }
  if (extracted.data !== null && !Array.isArray(extracted.data)) return null;

  const files = (Array.isArray(extracted.data) ? extracted.data : []).filter(isRecord);
  if (files.some((file) => typeof file.fileId !== 'string' || typeof file.fileName !== 'string' || typeof file.status !== 'string')) {
    return null;
  }

  return {
    requestId: extracted.requestId,
    code: extracted.code,
    message: extracted.message,
    timestamp: extracted.timestamp,
    targetLang: extracted.targetLang,
    data: extracted.data === null ? null : files.map((file) => {
      const info = isRecord(file.processingInfo) ? file.processingInfo : null;
      const report = isRecord(file.report) ? file.report : null;
      return {
        fileId: file.fileId,
        fileName: file.fileName,
        status: file.status,
        errorCode: typeof file.errorCode === 'string' ? file.errorCode : null,
        errorMessage: typeof file.errorMessage === 'string' ? file.errorMessage : null,
        diagnostic: typeof file.diagnostic === 'string' ? file.diagnostic : null,
        processingInfo: info ? {
          totalPages: numberOr(info.totalPages),
          extractChunksTotal: numberOr(info.extractChunksTotal),
          extractChunksFailed: numberOr(info.extractChunksFailed),
          classifyWindowsTotal: numberOr(info.classifyWindowsTotal),
          classifyWindowsFailed: numberOr(info.classifyWindowsFailed),
          failedPageRanges: Array.isArray(info.failedPageRanges)
            ? info.failedPageRanges.filter(isRecord).map((range) => ({ from: numberOr(range.from), to: numberOr(range.to) }))
            : [],
          translationStatus: typeof info.translationStatus === 'string' ? info.translationStatus : '—',
          untranslatedItems: numberOr(info.untranslatedItems),
          failureReasons: Array.isArray(info.failureReasons)
            ? info.failureReasons.filter((reason): reason is string => typeof reason === 'string')
            : [],
        } : null,
        report: report ? Object.fromEntries(FINANCIAL_REPORT_TYPES.flatMap((reportType) => {
          const section = report[reportType];
          if (!isRecord(section)) return [];
          return [[reportType, {
            status: typeof section.status === 'string' ? section.status : '—',
            warnings: Array.isArray(section.warnings)
              // Warning text can quote extracted content (AI-produced); keep only the code.
              ? section.warnings.filter(isRecord).map((warning) => ({
                code: typeof warning.code === 'string' ? warning.code : 'WARNING',
                message: '',
              }))
              : [],
          }]];
        })) : null,
      };
    }),
  };
}
