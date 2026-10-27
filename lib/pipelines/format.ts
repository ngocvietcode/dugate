// lib/pipelines/format.ts
// Shared utility: format a raw Operation record into the API LRO response shape.
// Kept in lib/ (not in a route file) so it can be safely imported by any route
// without causing Next.js production-build cross-route import errors.

import type { Operation } from '@/lib/db/schema';
import {
  buildLoanAppraisalIntegrationPayload,
  type StoredStageArtifact,
} from '@/lib/pipelines/workflows/loan-appraisal/integration-payload';
import type { IntegrationInclude } from '@/lib/pipelines/workflows/loan-appraisal/integration-contract';
import { compactAppraisalResult, compactLoanSteps } from '@/lib/pipelines/workflows/loan-appraisal/compact-view';

/** Endpoint hỗ trợ `view=integration`. */
export const INTEGRATION_VIEW_ENDPOINTS = new Set(['workflows:loan-appraisal']);

function safeParseJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function progressDetailsFromExtractedData(raw: string | null | undefined): Record<string, unknown> | null {
  const parsed = safeParseJson<Record<string, unknown> | null>(raw, null);
  const details = parsed?.progress_details;
  return details && typeof details === 'object' && !Array.isArray(details)
    ? details as Record<string, unknown>
    : null;
}

export interface FormatOperationResponseOptions {
  /**
   * Keep the terminal business result once and reduce completed step artifacts to
   * status/preview metadata. Intended for polling UIs that do not need to
   * download every intermediate artifact again after completion.
   */
  compact?: boolean;
}

function withoutExtractedData(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return steps.map((step) => {
    const compactStep = { ...step };
    delete compactStep.extracted_data;
    return compactStep;
  });
}

export function formatOperationResponse(op: Operation, options: FormatOperationResponseOptions = {}) {
  const pipeline = safeParseJson<Array<{ processor: string }>>(op.pipelineJson, []);
  const pipelineSteps = safeParseJson<Array<Record<string, unknown>>>(op.stepsResultJson, []);
  const progressDetails = op.done ? null : progressDetailsFromExtractedData(op.extractedData);
  // loan-appraisal: `result.pipeline_steps` trùng hệt `metadata.pipeline_steps` nên không trả hai lần (client đọc `metadata.pipeline_steps`; operation-mapper của giao diện đã ưu tiên chỗ này).
  const isLoanWorkflow = INTEGRATION_VIEW_ENDPOINTS.has(op.endpointSlug ?? '');
  // View=compact (giao diện poll 2 giây/lần) thu gọn cả khi đang chạy / tạm dừng / lỗi (xem compact-view.ts).
  const isLoanCompact = Boolean(options.compact) && isLoanWorkflow;
  const compactResult = <T>(value: T): T => (isLoanCompact ? compactAppraisalResult(value) as T : value);
  const metadataSteps = options.compact && op.done && op.state === 'SUCCEEDED'
    ? withoutExtractedData(pipelineSteps)
    : isLoanCompact ? compactLoanSteps(pipelineSteps) : pipelineSteps;

  const base: Record<string, unknown> = {
    name: `operations/${op.id}`,
    done: op.done,
    metadata: {
      state: op.state,
      pipeline: pipeline.map((s) => s.processor),
      current_step: op.currentStep,
      progress_percent: op.progressPercent,
      progress_message: op.progressMessage,
      progress_details: progressDetails,
      progress_history: safeParseJson(op.progressLogJson, []),
      create_time: op.createdAt,
      update_time: op.updatedAt,
      // Terminal-state time is distinct from update_time, which can be changed by
      // later webhook delivery/retry and retention-cleanup writes.
      complete_time: op.completedAt ?? null,
      webhook_sent_at: op.webhookSentAt ?? null,
      pipeline_steps: metadataSteps,
    },
  };

  if (op.done && op.state === 'SUCCEEDED') {
    base.result = {
      output_format:  op.outputFormat,
      content:        op.outputContent,
      extracted_data: compactResult(safeParseJson(op.extractedData, null)),
      ...(!options.compact && !isLoanWorkflow ?  { pipeline_steps: pipelineSteps } : {}),
      usage: {
        input_tokens:    op.totalInputTokens,
        output_tokens:   op.totalOutputTokens,
        pages_processed: op.pagesProcessed,
        model_used:      op.modelUsed,
        cost_usd:        op.totalCostUsd,
        breakdown:       safeParseJson(op.usageBreakdown, []),
      },
      download_url: `/api/v1/operations/${op.id}/download`,
    };
  }

  // Workflow tạm dừng chờ người dùng (VD loan-appraisal dừng sau giai đoạn 1, D-51): trả kết quả tạm nếu workflow
  // có ghi (`pauseWorkflow(..., extractedData)`); snapshot tiến độ nội bộ `{ progress_details }` không được trả ra.
  if (!op.done && op.state === 'WAITING_USER_INPUT') {
    const paused = safeParseJson<Record<string, unknown> | null>(op.extractedData, null);
    if (paused && typeof paused === 'object' && !Array.isArray(paused) && !('progress_details' in paused && Object.keys(paused).length === 1)) {
      base.result = { extracted_data: compactResult(paused) };
    }
  }

  if (op.done && op.state === 'FAILED') {
    base.error = {
      code:        op.errorCode,
      message:     op.errorMessage,
      failed_step: op.failedAtStep,
    };
    if (op.stepsResultJson) {
      base.result = {
        ...(!options.compact && !isLoanWorkflow ?  { pipeline_steps: pipelineSteps } : {}),
        usage: {
          input_tokens:  op.totalInputTokens,
          output_tokens: op.totalOutputTokens,
          cost_usd:      op.totalCostUsd,
          breakdown:     safeParseJson(op.usageBreakdown, []),
        },
      };
    }
  }

  return base;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * `view=integration` — JSON cho hệ thống ngoài (schema 5.0, xem integration-contract.ts): CHỈ kết quả cuối trong
 * `result.extracted_data`, không có evidence và không có thông tin tiến trình xử lý.
 *
 * Vỏ LRO giữ lại phần tối thiểu để client poll được (name, done, metadata.state, mốc thời gian, progress_percent/message
 * khi đang chạy). Bỏ `pipeline`, `pipeline_steps`, `progress_history`, `progress_details`, `current_step` và `usage.breakdown`.
 *
 * `options.include`: `narrative` thêm `assessment` (văn bản diễn giải), `labels` thêm nhãn hiển thị.
 */
export function formatOperationIntegrationResponse(op: Operation, options: { include?: readonly IntegrationInclude[] } = {}) {
  const base = formatOperationResponse(op, { compact: true });
  const full = base.metadata as Record<string, unknown>;
  base.metadata = {
    state: full.state,
    progress_percent: full.progress_percent,
    progress_message: full.progress_message,
    create_time: full.create_time,
    update_time: full.update_time,
    complete_time: full.complete_time,
  };
  const steps = safeParseJson<StoredStageArtifact[]>(op.stepsResultJson, []);

  if (op.done && op.state === 'SUCCEEDED') {
    const finalResult = safeParseJson<Record<string, unknown> | null>(op.extractedData, null);
    const result = base.result as Record<string, unknown>;
    result.extracted_data = finalResult
      ? buildLoanAppraisalIntegrationPayload(
        finalResult as unknown as Parameters<typeof buildLoanAppraisalIntegrationPayload>[0],
        steps,
        {
          operation_id: op.id,
          state: op.state,
          created_at: isoOrNull(op.createdAt),
          completed_at: isoOrNull(op.completedAt),
        },
        { include: options.include },
      )
      : null;
    // Chuỗi tóm tắt legacy và chi tiết usage theo bước không thuộc contract tích hợp.
    delete result.content;
    if (result.usage && typeof result.usage === 'object') {
      const { breakdown: _breakdown, ...usage } = result.usage as Record<string, unknown>;
      result.usage = usage;
    }
  }

  return base;
}
