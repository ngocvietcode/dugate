import {
  OperationNotFoundError,
  transitionOperationState,
} from '@/lib/operations/state-transition';

/** Marks a job's parent failed only while it is still an active operation. */
export async function markDlqOperationFailed(
  operationId: string | undefined,
  errorMessage: string,
): Promise<void> {
  if (!operationId) return;

  try {
    await transitionOperationState({
      operationId,
      state: 'FAILED',
      changes: {
        errorCode: 'WORKER_CRASH',
        errorMessage,
      },
      onlyIf: { state: 'RUNNING', done: false },
    });
  } catch (error) {
    // Preserve the old conditional-update semantics when a queued job refers to
    // an Operation that was removed before its DLQ event was handled.
    if (error instanceof OperationNotFoundError) return;
    throw error;
  }
}
