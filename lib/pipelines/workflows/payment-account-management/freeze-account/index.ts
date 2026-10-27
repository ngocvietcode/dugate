// lib/pipelines/workflows/payment-account-management/freeze-account/index.ts
// Runner for mode = "freeze" (phong tỏa tài khoản). Sample stub — implement later.

import type { WorkflowContext } from '@/lib/pipelines/workflow-engine';
import type { PamMetadata } from '../shared/types';

export async function runFreezeAccount(
  _ctx: WorkflowContext,
  _metadata: PamMetadata,
): Promise<unknown> {
  throw new Error('NOT_IMPLEMENTED: freeze-account runner is not implemented yet.');
}
