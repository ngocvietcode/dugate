// lib/pipelines/workflows/payment-account-management/close-account/index.ts
// Runner for mode = "close" (đóng tài khoản). Sample stub — implement later.

import type { WorkflowContext } from '@/lib/pipelines/workflow-engine';
import type { PamMetadata } from '../shared/types';

export async function runCloseAccount(
  _ctx: WorkflowContext,
  _metadata: PamMetadata,
): Promise<unknown> {
  throw new Error('NOT_IMPLEMENTED: close-account runner is not implemented yet.');
}
