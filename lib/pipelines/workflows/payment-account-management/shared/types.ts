// lib/pipelines/workflows/payment-account-management/shared/types.ts
// Structural types shared across all payment-account-management modes.
// Domain-specific fields live inside each mode folder — do NOT add them here.

/**
 * Supported feature modes. Each maps to a runner in ../index.ts MODE_REGISTRY.
 * - open   → mở tài khoản
 * - close  → đóng tài khoản
 * - freeze → phong tỏa tài khoản
 * - update → cập nhật tài khoản
 */
export type PamMode = 'open' | 'close' | 'freeze' | 'update';

export const PAM_MODES: readonly PamMode[] = ['open', 'close', 'freeze', 'update'] as const;

/**
 * Metadata contract for the payment-account-management workflow.
 * `mode` is required and selects the runner. `stage` and `data` are known,
 * flattened fields read directly by the runners. Any OTHER caller-supplied keys
 * are preserved on `extra` so we never lose forward-compatible data.
 */
export interface PamMetadata {
  mode: PamMode;
  /** Processing stage (classification | extraction | e2e). Defaults handled by the runner. */
  stage?: string;
  /** Caller-supplied data object (e.g. core-bank account data for mode=update). */
  data?: Record<string, unknown>;
  /** Any additional caller-supplied metadata, forwarded through as-is. */
  extra: Record<string, unknown> | null;
}

/**
 * Envelope returned to completeWorkflow(). Mode-specific `result` payload lives
 * under `result` so downstream renderers can dispatch on `metadata.mode`.
 */
export interface PamEnvelope<TResult> {
  request_id: string;
  skill_code: 'payment-account-management';
  status: 'SUCCESS' | 'FAILED' | 'REVIEW_REQUIRED';
  metadata: PamMetadata;
  result: TResult;
}

/**
 * Shared runner contract every mode must implement.
 */
export type PamModeRunner<TResult> = (
  ctx: import('@/lib/pipelines/workflow-engine').WorkflowContext,
  metadata: PamMetadata,
) => Promise<TResult>;
