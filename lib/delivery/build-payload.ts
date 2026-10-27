import { summarizeErrorBody } from '@/lib/pipelines/processors/http-client';

export type CallbackEngine = 'core' | 'workflow';
export type CallbackState = 'SUCCEEDED' | 'FAILED' | 'PAUSED';
export type CallbackPayloadMode = 'WITH_RESULT' | null;

export interface WorkflowFailurePayload {
  message: string;
  detailedMessage: string;
  errorCode: string;
  retryable: boolean;
}

export interface BuildCallbackPayloadInput {
  mode: CallbackPayloadMode;
  engine: CallbackEngine;
  operationId: string;
  state: CallbackState;
  extractedData?: unknown;
  outputContent?: string | null;
  errorMessage?: string | null;
  errorCode?: string | null;
  workflowFailure?: WorkflowFailurePayload;
  endpointSlug?: string | null;
}

function coreRetryable(errorCode: string | null | undefined): boolean {
  return errorCode !== 'PIPELINE_INVALID_JSON';
}

function buildLegacyCorePayload(input: BuildCallbackPayloadInput): Record<string, unknown> {
  if (input.state === 'SUCCEEDED') {
    return { operation_id: input.operationId, state: 'SUCCEEDED', done: true };
  }
  if (input.state === 'FAILED') {
    return { operation_id: input.operationId, state: 'FAILED', error: input.errorMessage ?? '' };
  }
  return { operation_id: input.operationId, state: 'PAUSED', done: false };
}

function buildWorkflowPayload(input: BuildCallbackPayloadInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    operation_id: input.operationId,
    state: input.state,
    done: input.state === 'SUCCEEDED' || input.state === 'FAILED',
  };

  if (input.state === 'PAUSED' && input.errorMessage) {
    payload.error = input.errorMessage;
  } else if (input.state === 'FAILED' && input.workflowFailure) {
    payload.error = input.endpointSlug === 'workflows:payroll-verify'
      ? input.workflowFailure.detailedMessage
      : input.workflowFailure.message;
    payload.error_code = input.workflowFailure.errorCode;
    payload.retryable = input.workflowFailure.retryable;
  }
  if (input.state === 'SUCCEEDED' && input.extractedData) {
    payload.extracted_data = input.extractedData;
  }
  return payload;
}

function buildWithResultCorePayload(input: BuildCallbackPayloadInput): Record<string, unknown> {
  const publicError = (raw: string): string => summarizeErrorBody(raw.replace(
    /\b(authorization\s*[:=]\s*(?:bearer|basic)\s+)[A-Za-z0-9._\-+/=]{8,}/gi,
    '$1***',
  ));

  if (input.state === 'SUCCEEDED') {
    return {
      operation_id: input.operationId,
      state: 'SUCCEEDED',
      done: true,
      extracted_data: input.extractedData ?? null,
      output_content: input.outputContent ?? null,
    };
  }
  if (input.state === 'FAILED') {
    return {
      operation_id: input.operationId,
      state: 'FAILED',
      done: true,
      error: publicError(input.errorMessage ?? ''),
      error_code: input.errorCode ?? null,
      retryable: coreRetryable(input.errorCode),
    };
  }
  return { operation_id: input.operationId, state: 'PAUSED', done: false };
}

/**
 * Builds an outbound callback body without I/O or database coupling.
 * NULL preserves each engine's frozen legacy payload exactly; WITH_RESULT is a
 * Core-API opt-in, while workflows retain their established callback contract.
 */
export function buildCallbackPayload(input: BuildCallbackPayloadInput): Record<string, unknown> {
  if (input.mode === 'WITH_RESULT' && input.engine === 'core') {
    return buildWithResultCorePayload(input);
  }
  return input.engine === 'core'
    ? buildLegacyCorePayload(input)
    : buildWorkflowPayload(input);
}
