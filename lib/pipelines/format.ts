// lib/pipelines/format.ts
// Shared utility: format a raw Prisma Operation into the API LRO response shape.
// Kept in lib/ (not in a route file) so it can be safely imported by any route
// without causing Next.js production-build cross-route import errors.

import type { Operation } from '@prisma/client';

function safeParseJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export function formatOperationResponse(op: Operation) {
  const pipeline = safeParseJson<Array<{ processor: string }>>(op.pipelineJson, []);

  const base: Record<string, unknown> = {
    name: `operations/${op.id}`,
    done: op.done,
    metadata: {
      state: op.state,
      pipeline: pipeline.map((s) => s.processor),
      current_step: op.currentStep,
      progress_percent: op.progressPercent,
      progress_message: op.progressMessage,
      create_time: op.createdAt,
      update_time: op.updatedAt,
      pipeline_steps: safeParseJson(op.stepsResultJson, []),
    },
  };

  if (op.done && op.state === 'SUCCEEDED') {
    base.result = {
      output_format:  op.outputFormat,
      content:        op.outputContent,
      extracted_data: safeParseJson(op.extractedData, null),
      pipeline_steps: safeParseJson(op.stepsResultJson, []),
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

  if (op.done && op.state === 'FAILED') {
    base.error = {
      code:        op.errorCode,
      message:     op.errorMessage,
      failed_step: op.failedAtStep,
    };
    if (op.stepsResultJson) {
      base.result = {
        pipeline_steps: safeParseJson(op.stepsResultJson, []),
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
