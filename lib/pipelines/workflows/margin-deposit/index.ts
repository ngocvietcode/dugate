// lib/pipelines/workflows/margin-deposit/index.ts
// Workflow entry point — dispatches to the mode runner selected by metadata.mode.
// Registered in WORKFLOW_REGISTRY as 'margin-deposit-profile' (workflow-engine.ts).
// Mirrors payment-account-management/index.ts's MODE_REGISTRY dispatch pattern.

import {
  type WorkflowContext,
  completeWorkflow,
  failWorkflow,
} from '@/lib/pipelines/workflow-engine';

import { parseRawMetadata, resolveMarginMode } from './shared/metadata';
import type { MarginMetadata, MarginMode } from './shared/types';

import { runClassify } from './classify';
import { runExtraction } from './extraction';
import { runFramework } from './framework';
import { runValidation } from './validation';

const MODE_REGISTRY: Record<MarginMode, (ctx: WorkflowContext, metadata: MarginMetadata) => Promise<unknown>> = {
  classify: runClassify,
  extraction: runExtraction,
  framework: runFramework,
  validation: runValidation,
};

/**
 * Entry point registered in WORKFLOW_REGISTRY. Resolves `metadata.mode` (no
 * default — must be one of classify/extraction/framework/validation), routes
 * to the matching runner, wraps the result via completeWorkflow. Errors bubble
 * to failWorkflow.
 */
export async function runMarginDeposit(ctx: WorkflowContext): Promise<void> {
  const { logger } = ctx;

  try {
    // Parse once and reuse: pipelineVars.metadata arrives as the raw JSON string
    // sent by the client. resolveMarginMode() used to parse it internally just to
    // read `mode` and discard the result, while the runner below was still handed
    // the original unparsed string — every mode runner other than `classify`
    // (which ignores its metadata argument) then failed with
    // "metadata.file_meta must be a JSON array" because `metadata.file_meta` on
    // a string is always undefined. Parsing once here and passing the resulting
    // object to both resolveMarginMode and the runner fixes that for all modes.
    const metadata: MarginMetadata = parseRawMetadata(ctx.pipelineVars.metadata);
    const mode = resolveMarginMode(metadata);
    logger.info(`[MARGIN-DEPOSIT] Dispatching mode=${mode}`);

    const runner = MODE_REGISTRY[mode];
    const result = await runner(ctx, metadata);

    await completeWorkflow(ctx, JSON.stringify({ mode }), { mode, result });
  } catch (error) {
    await failWorkflow(ctx, error);
  }
}
