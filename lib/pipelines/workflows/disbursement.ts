// lib/pipelines/workflows/disbursement.ts
// Workflow: Kiểm tra & Giải ngân (Disbursement Check)
//
// DAG:
//   Step 1: N files → classify per file [song song]
//   Step 2: N files → extract per file  [song song]
//   Step 3: aggregate → crosscheck      [tuần tự]
//   Step 4: generate report             [tuần tự]

import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  pauseWorkflow,
  completeWorkflow,
  parseDeep,
  prisma,
} from '@/lib/pipelines/workflow-engine';

import {
  type ClassifyData,
  type ClassifyFileResult,
  type ClassifyResult,
  type ExtractResult,
  type ExtractFileResult,
  type CrosscheckResult,
  type MergedClassifyData,
  type LogicalDocument,
  buildClassifyPrompt,
  parseClassifyResult,
  mergeClassifyResults,
  buildExtractPrompt,
  buildCrosscheckPrompt,
  buildReportPrompt,
} from './prompts/disbursement-prompts';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

/** Progress percentage ranges for each step [start, end] */
const STEP_PROGRESS: Record<number, [number, number]> = {
  0: [5, 25],    // Classify
  1: [30, 55],   // Extract
  2: [60, 80],   // Crosscheck
  3: [85, 95],   // Report
};

function stepProgress(stepIdx: number, phase: 'start' | 'end'): number {
  const range = STEP_PROGRESS[stepIdx];
  if (!range) return 50;
  return phase === 'start' ? range[0] : range[1];
}

// ─── Main Workflow ────────────────────────────────────────────────────────────

export async function runDisbursement(ctx: WorkflowContext): Promise<void> {
  const { logger, filesData, pipelineVars } = ctx;
  const fileCount = filesData.length;

  const resumeFromStep = ctx.currentStep;

  // Variables that need to span across paused states
  let extractionResults: ExtractResult[] = [];
  let mergedClassifyData: MergedClassifyData = {
    files_analyzed: 0,
    total_logical_documents: 0,
    per_file: [],
    logical_documents: [],
  };
  let allLogicalDocs: LogicalDocument[] = [];

  // Restore step-specific variables if resuming from a checkpoint
  if (resumeFromStep > 0 && ctx.stepsResult.length > 0) {
    try {
      // Load Step 0 data (Classify)
      const step0 = ctx.stepsResult.find((s: any) => s.step === 0);
      if (step0) {
         mergedClassifyData = (step0.extracted_data as MergedClassifyData) || mergedClassifyData;
         allLogicalDocs = step0.sub_results?.flatMap((r: any) => r.logical_documents || []) || [];
      }
      
      // Load Step 1 data (Extract) - This includes any edits made by the Human user!
      const step1 = ctx.stepsResult.find((s: any) => s.step === 1);
      if (step1) {
         extractionResults = (step1.extracted_data as ExtractResult[]) || [];
      }
    } catch (e) {
      logger.warn(`[WORKFLOW] Failed to restore step-specific variables`, undefined, e);
    }
  }

  // ── STEP 1: Parallel Classify (per file) ──────────────────────────────────
  if (resumeFromStep <= 0) {
    logger.info(`[WORKFLOW] Step 1/${TOTAL_STEPS}: Classify ${fileCount} file(s)`);
    await updateProgress(ctx, stepProgress(0, 'start'), `Bước 1/${TOTAL_STEPS}: Đang phân loại ${fileCount} tài liệu...`);

    const classifyPromises = filesData.map(async (file): Promise<ClassifyResult> => {
      const singleFileJson = JSON.stringify([file]);
      try {
        const result = await enqueueSubStep(ctx, 'ext-classifier', buildClassifyPrompt(file.name, ctx.promptOverrides.classify), singleFileJson);
        const { classifyData, logicalDocs } = parseClassifyResult(result.content, file.name);
        return { fileName: file.name, classifyData: parseDeep(classifyData) as ClassifyData, logicalDocs, subOperationId: result.operation.id, status: 'success' };
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[WORKFLOW] Classify failed for ${file.name}: ${errMsg}`);
        return { fileName: file.name, classifyData: {}, logicalDocs: [], subOperationId: '', status: 'error', error: errMsg };
      }
    });

    const classifyResults = await Promise.all(classifyPromises);
    const successfulClassifies = classifyResults.filter(
      (r): r is ClassifyFileResult => r.status === 'success',
    );

    if (successfulClassifies.length === 0) {
      const errors = classifyResults
        .filter((r): r is Extract<ClassifyResult, { status: 'error' }> => r.status === 'error')
        .map(r => `${r.fileName}: ${r.error}`)
        .join('; ');
      throw new Error(`All ${fileCount} classify jobs failed. Errors: ${errors}`);
    }

    const mergeOutput = mergeClassifyResults(successfulClassifies);
    allLogicalDocs = mergeOutput.allLogicalDocs;
    mergedClassifyData = mergeOutput.mergedClassifyData;

    ctx.stepsResult.push({
      step: 0,
      stepName: `Phân loại tài liệu (${fileCount} file)`,
      processor: 'ext-classifier',
      content_preview: JSON.stringify(classifyResults.map(r => ({
        file: r.fileName,
        status: r.status,
        docs: r.status === 'success' ? r.logicalDocs.length : 0,
      }))),
      extracted_data: mergedClassifyData,
      sub_results: classifyResults.map(r => ({
        file: r.fileName,
        status: r.status,
        sub_operation_id: r.subOperationId,
        logical_documents: r.status === 'success' ? r.logicalDocs : [],
      })),
    });
    await updateProgress(ctx, stepProgress(0, 'end'), `Bước 1 hoàn tất. ${fileCount} file → ${allLogicalDocs.length} loại tài liệu.`);
  }

  // ── STEP 2: Parallel Extract (per file) ───────────────────────────────────
  if (resumeFromStep <= 1) {
    logger.info(`[WORKFLOW] Step 2/${TOTAL_STEPS}: Extract ${fileCount} file(s)`);
    await updateProgress(ctx, stepProgress(1, 'start'), `Bước 2/${TOTAL_STEPS}: Đang bóc tách ${fileCount} file...`);

    const extractPromises = filesData.map(async (file): Promise<ExtractResult> => {
      const docsForFile = allLogicalDocs.filter(d => d.source_file === file.name);
      const singleFileJson = JSON.stringify([file]);
      try {
        const result = await enqueueSubStep(ctx, 'ext-data-extractor', buildExtractPrompt(docsForFile, file.name, ctx.promptOverrides.extract), singleFileJson);
        
        // Clean up double-escaping: Deeply parse recursive stringified content
        const cleanedResult = parseDeep(result) as { content: unknown; extractedData: unknown; operation: typeof result.operation };

        return {
          file_name: file.name,
          logical_docs: docsForFile.map(d => d.label),
          status: 'success',
          sub_operation_id: result.operation.id,
          content: cleanedResult.content,
          extracted_data: cleanedResult.extractedData,
        } as ExtractFileResult;
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[WORKFLOW] Extract failed for ${file.name}: ${errMsg}`);
        return { file_name: file.name, logical_docs: docsForFile.map(d => d.label), status: 'error', error: errMsg };
      }
    });

    extractionResults = await Promise.all(extractPromises);
    const extractSuccess = extractionResults.filter(r => r.status === 'success').length;

    ctx.stepsResult.push({
      step: 1,
      stepName: `OCR & Bóc tách (${fileCount} file)`,
      processor: 'ext-data-extractor',
      content_preview: JSON.stringify(extractionResults.map(r => ({
        file: r.file_name,
        docs: r.logical_docs,
        status: r.status,
      }))),
      extracted_data: extractionResults,
      sub_results: extractionResults,
    });
    await updateProgress(ctx, stepProgress(1, 'end'), `Bước 2 hoàn tất. Bắt đầu pause chờ duyệt.`);

    // TRIGGER HITL: PAUSE WORKFLOW AND WAIT FOR HUMAN APPROVAL
    return pauseWorkflow(ctx, 'Vui lòng kiểm tra và phê duyệt kết quả OCR trước khi tiếp tục.', 2);
  }

  // ── STEP 3: Cross-Check ───────────────────────────────────────────────────
  if (resumeFromStep <= 2) {
    logger.info(`[WORKFLOW] Step 3/${TOTAL_STEPS}: Cross-check`);
    await updateProgress(ctx, stepProgress(2, 'start'), `Bước 3/${TOTAL_STEPS}: Đang đối chiếu...`);

    const referenceData = pipelineVars.resolution_data ? String(pipelineVars.resolution_data) : undefined;
    const step3 = await enqueueSubStep(ctx, 'ext-fact-verifier', buildCrosscheckPrompt(extractionResults, referenceData, ctx.promptOverrides.crosscheck), null);

    let crosscheckData: CrosscheckResult = {};
    if (step3.content) {
      crosscheckData = parseDeep(step3.content) as CrosscheckResult;
    }

    ctx.stepsResult.push({
      step: 2,
      stepName: 'Đối chiếu Nghị quyết',
      processor: 'ext-fact-verifier',
      sub_operation_id: step3.operation.id,
      content_preview: parseDeep(step3.content),
      extracted_data: parseDeep(crosscheckData),
    });
    await updateProgress(ctx, stepProgress(2, 'end'), 'Bước 3 hoàn tất.');
  }

  // ── STEP 4: Report ────────────────────────────────────────────────────────
  let finalReport = '';
  let finalCrosscheckData: CrosscheckResult = {};
  
  if (resumeFromStep <= 3) {
    logger.info(`[WORKFLOW] Step 4/${TOTAL_STEPS}: Generate report`);
    await updateProgress(ctx, stepProgress(3, 'start'), `Bước 4/${TOTAL_STEPS}: Đang soạn Tờ trình...`);

    // Always load crosscheck data from its specific step index for safety.
    finalCrosscheckData = (ctx.stepsResult.find(s => s.step === 2)?.extracted_data as CrosscheckResult) || {};

    const step4 = await enqueueSubStep(ctx, 'ext-content-gen', buildReportPrompt(mergedClassifyData, extractionResults, finalCrosscheckData, ctx.promptOverrides.report), null);

    ctx.stepsResult.push({
      step: 3,
      stepName: 'Soạn Tờ trình',
      processor: 'ext-content-gen',
      sub_operation_id: step4.operation.id,
      content_preview: step4.content?.substring(0, 2000),
      extracted_data: null,
    });
    
    finalReport = step4.content || '';
  }

  await completeWorkflow(ctx, finalReport, finalCrosscheckData);
}
