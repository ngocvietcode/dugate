// lib/pipelines/engine.ts
// Core Pipeline Engine — runs a chain of ExternalApiConnection steps sequentially.
// v2: Local processors removed. All processing done via External API connectors.

import { prisma } from '@/lib/prisma';
import { runExternalApiProcessor } from '@/lib/pipelines/processors/external-api';
import { Logger } from '@/lib/logger';

export interface PipelineStep {
  processor: string;  // ExternalApiConnection slug
  variables?: Record<string, unknown>;
}

export interface ProcessorContext {
  operationId: string;
  stepIndex: number;
  totalSteps: number;
  // Input — all uploaded files
  filePaths: string[];    // Absolute paths to uploaded files on disk
  fileNames: string[];    // Original file names
  // Chained input from previous step
  inputText?: string;
  // Processor config
  processorSlug: string;
  variables: Record<string, unknown>;
  outputFormat: string;
  // Logging
  correlationId?: string;
  logger: Logger;
}

export interface ProcessorResult {
  content?: string;           // Text/JSON output
  extractedData?: unknown;    // Structured JSON
  outputFilePath?: string;
  inputTokens: number;
  outputTokens: number;
  pagesProcessed: number;
  modelUsed: string;
  costUsd: number;
}

/**
 * Main pipeline runner. Called async after Operation is created.
 */
export async function runPipeline(operationId: string, correlationId?: string): Promise<void> {
  const logger = new Logger({ correlationId, operationId });

  const operation = await prisma.operation.findUnique({ where: { id: operationId } });
  if (!operation) {
    logger.error(`Operation ${operationId} not found`);
    return;
  }

  const pipeline: PipelineStep[] = JSON.parse(operation.pipelineJson);

  // Parse filesJson → filePaths / fileNames
  const filesData: Array<{ name: string; path: string; mime: string; size: number }> =
    operation.filesJson ? JSON.parse(operation.filesJson) : [];
  const filePaths = filesData.map((f) => f.path);
  const fileNames = filesData.map((f) => f.name);

  const stepsResult: Array<{
    step: number;
    processor: string;
    output_format: string;
    content_preview?: string | null;
    extracted_data?: unknown;
  }> = [];

  let currentText: string | undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let totalPages = 0;
  let lastModelUsed = '';
  const usageBreakdown: Array<{
    processor: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }> = [];

  try {
    for (let i = 0; i < pipeline.length; i++) {
      const step = pipeline[i];

      // Update progress
      await prisma.operation.update({
        where: { id: operationId },
        data: {
          currentStep: i,
          progressPercent: Math.round((i / pipeline.length) * 100),
          progressMessage: `Đang xử lý bước ${i + 1}/${pipeline.length}: ${step.processor}...`,
        },
      });

      const variables = step.variables ?? {};

      // Inject chained text from previous step
      if (currentText) {
        variables['input_content'] = currentText;
      }

      // Load ExternalApiConnection
      const connection = await prisma.externalApiConnection.findUnique({
        where: { slug: step.processor },
      });
      if (!connection) {
        throw new Error(`ExternalApiConnection '${step.processor}' not found in database.`);
      }
      if (connection.state !== 'ENABLED') {
        throw new Error(`ExternalApiConnection '${connection.slug}' is DISABLED.`);
      }

      // Load per-client prompt override
      const extOverride = operation.apiKeyId
        ? await prisma.externalApiOverride.findUnique({
            where: {
              connectionId_apiKeyId: {
                connectionId: connection.id,
                apiKeyId: operation.apiKeyId,
              },
            },
          })
        : null;

      if (extOverride) {
        logger.info(`Applied ExtApiOverride for '${connection.slug}' (key: ${operation.apiKeyId})`);
      }

      const ctx: ProcessorContext = {
        operationId,
        stepIndex: i,
        totalSteps: pipeline.length,
        filePaths: i === 0 ? filePaths : [],   // Only first step gets original files
        fileNames: i === 0 ? fileNames : [],
        inputText: currentText,
        processorSlug: connection.slug,
        variables,
        outputFormat: operation.outputFormat,
        correlationId,
        logger,
      };

      logger.info(`[STEP_STARTED] Starting processor ${connection.slug}`);
      const result = await runExternalApiProcessor(ctx, connection, extOverride);
      logger.info(`[STEP_COMPLETED] Processor ${connection.slug} done in ${result.costUsd > 0 ? result.costUsd + '$' : ''}`, {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });

      // Record step result
      stepsResult.push({
        step: i,
        processor: ctx.processorSlug,
        output_format: operation.outputFormat,
        content_preview: result.content ? result.content.substring(0, 2000) : null,
        extracted_data: result.extractedData,
      });

      // Track usage
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
      totalCost += result.costUsd;
      totalPages += result.pagesProcessed;
      lastModelUsed = result.modelUsed;
      usageBreakdown.push({
        processor: ctx.processorSlug,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: result.costUsd,
      });

      // Pass output to next step
      currentText = result.content ?? (result.extractedData ? JSON.stringify(result.extractedData) : undefined);

      // Save intermediate progress
      await prisma.operation.update({
        where: { id: operationId },
        data: { stepsResultJson: JSON.stringify(stepsResult) },
      });
    }

    // Pipeline completed successfully
    const lastStep = stepsResult[stepsResult.length - 1];
    await prisma.operation.update({
      where: { id: operationId },
      data: {
        done: true,
        state: 'SUCCEEDED',
        progressPercent: 100,
        progressMessage: null,
        currentStep: pipeline.length - 1,
        outputContent: currentText,
        extractedData: lastStep?.extracted_data ? JSON.stringify(lastStep.extracted_data) : null,
        stepsResultJson: JSON.stringify(stepsResult),
        totalInputTokens,
        totalOutputTokens,
        pagesProcessed: totalPages,
        modelUsed: lastModelUsed,
        totalCostUsd: totalCost,
        usageBreakdown: JSON.stringify(usageBreakdown),
      },
    });

    // Webhook notification
    if (operation.webhookUrl) {
      try {
        await fetch(operation.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation_id: operationId, state: 'SUCCEEDED', done: true }),
        });
        await prisma.operation.update({
          where: { id: operationId },
          data: { webhookSentAt: new Date() },
        });
      } catch (e) {
        logger.warn(`Webhook failed for ${operationId}`, undefined, e);
      }
    }

    logger.info(`[PIPELINE_COMPLETED] Operation ${operationId} completed.`, {
      pagesProcessed: totalPages,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCost,
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[PIPELINE_FAILED] Operation ${operationId} failed at step ${stepsResult.length}`, undefined, error);

    await prisma.operation.update({
      where: { id: operationId },
      data: {
        done: true,
        state: 'FAILED',
        failedAtStep: stepsResult.length,
        errorCode: 'PIPELINE_ERROR',
        errorMessage: msg,
        stepsResultJson: JSON.stringify(stepsResult),
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd: totalCost,
        usageBreakdown: JSON.stringify(usageBreakdown),
      },
    });

    if (operation.webhookUrl) {
      try {
        await fetch(operation.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation_id: operationId, state: 'FAILED', error: msg }),
        });
      } catch {}
    }
  }
}
