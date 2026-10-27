// lib/pipelines/workflows/payment-account-management/index.ts
// Workflow entry point — dispatches to the mode runner selected by metadata.mode.
//
// Registered in WORKFLOW_REGISTRY as 'payment-account-management'
// (see lib/pipelines/workflow-engine.ts).

import {
  type WorkflowContext,
  updateProgress,
  completeWorkflow,
  failWorkflow,
} from '@/lib/pipelines/workflow-engine';

import { parseMetadata } from './shared/metadata';
import type { PamMetadata, PamMode } from './shared/types';
import { buildPamWebhookTransform } from './shared/webhook-transform';

import { runOpenAccount } from './open-account';
import { runCloseAccount } from './close-account';
import { runFreezeAccount } from './freeze-account';
import { runUpdateAccount } from './update-account';

const MODE_REGISTRY: Record<PamMode, (ctx: WorkflowContext, metadata: PamMetadata) => Promise<unknown>> = {
  open: runOpenAccount,
  close: runCloseAccount,
  freeze: runFreezeAccount,
  update: runUpdateAccount,
};

/**
 * Entry point registered in WORKFLOW_REGISTRY.
 * Parses metadata → picks runner → wraps the result in the standard envelope
 * and calls completeWorkflow. Errors bubble to failWorkflow.
 */
export async function runPaymentAccountManagement(ctx: WorkflowContext): Promise<void> {
  const { logger } = ctx;

  try {
    await updateProgress(ctx, 1, 'Bước 0: Đọc metadata và chọn feature...');

    const metadata = parseMetadata(ctx.pipelineVars.metadata);
    logger.info(`[PAM] Dispatching mode=${metadata.mode}`);

    const runner = MODE_REGISTRY[metadata.mode];
    if (!runner) {
      // Should never hit — parseMetadata already validates mode.
      throw new Error(`INVALID_METADATA: mode="${metadata.mode}" không có runner tương ứng.`);
    }

    await updateProgress(ctx, 3, `Bước 0 hoàn tất. Bắt đầu chạy mode=${metadata.mode}.`);

    // Attach PAM-specific webhook transform (encrypt if partner_public_key is set on Profile)
    ctx.transformWebhookPayload = buildPamWebhookTransform(ctx);

    const result = await runner(ctx, metadata);

    await completeWorkflow(ctx, JSON.stringify({ mode: metadata.mode }), {
      request_id: ctx.operationId,
      skill_code: 'payment-account-management',
      status: 'SUCCESS',
      metadata,
      result,
    });
  } catch (error) {
    await failWorkflow(ctx, error);
  }
}
