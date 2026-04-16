// lib/pipelines/workflows/lc-checker.ts
// Workflow: Kiểm tra Bộ Chứng từ LC (Letter of Credit)
//
// DAG:
//   Step 1: N files → classify per file  [song song]
//   Step 2: N files → extract per file   [song song]
//            ↓ HITL pause — cán bộ xác nhận dữ liệu OCR
//   Step 3: aggregate → compliance check [tuần tự, self-contained UCP 600]
//   Step 4: generate report              [tuần tự]

import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  pauseWorkflow,
  completeWorkflow,
  parseDeep,
  db,
} from '@/lib/pipelines/workflow-engine';

import {
  type ClassifyData,
  type ClassifyFileResult,
  type ClassifyResult,
  type ExtractResult,
  type ExtractFileResult,
  type LCCheckResult,
  type MergedClassifyData,
  type LogicalDocument,
  buildClassifyPrompt,
  parseClassifyResult,
  mergeClassifyResults,
  buildExtractPrompt,
  buildComplianceCheckPrompt,
  buildReportPrompt,
} from './prompts/lc-checker-prompts';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

/** Progress percentage ranges for each step [start, end] */
const STEP_PROGRESS: Record<number, [number, number]> = {
  0: [5, 25],   // Classify
  1: [30, 55],  // Extract
  2: [60, 80],  // Compliance Check
  3: [85, 95],  // Report
};

function stepProgress(stepIdx: number, phase: 'start' | 'end'): number {
  const range = STEP_PROGRESS[stepIdx];
  if (!range) return 50;
  return phase === 'start' ? range[0] : range[1];
}

// ─── Main Workflow ────────────────────────────────────────────────────────────

export async function runLcChecker(ctx: WorkflowContext): Promise<void> {
  const { logger, filesData, promptOverrides } = ctx;
  const fileCount = filesData.length;

  const resumeFromStep = ctx.currentStep;

  // Variables that span across paused states
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

      // Load Step 1 data (Extract) — includes any edits made by Human
      const step1 = ctx.stepsResult.find((s: any) => s.step === 1);
      if (step1) {
        extractionResults = (step1.extracted_data as ExtractResult[]) || [];
      }
    } catch (e) {
      logger.warn(`[LC-WORKFLOW] Failed to restore step-specific variables`, undefined, e);
    }
  }

  // ── STEP 1: Parallel Classify (per file) ──────────────────────────────────
  if (resumeFromStep <= 0) {
    logger.info(`[LC-WORKFLOW] Step 1/${TOTAL_STEPS}: Classify ${fileCount} file(s)`);
    await updateProgress(ctx, stepProgress(0, 'start'), `Bước 1/${TOTAL_STEPS}: Đang phân loại ${fileCount} chứng từ LC...`);

    const classifyPromises = filesData.map(async (file): Promise<ClassifyResult> => {
      const singleFileJson = JSON.stringify([file]);
      try {
        const result = await enqueueSubStep(
          ctx,
          'ext-classifier',
          buildClassifyPrompt(file.name, promptOverrides.classify),
          singleFileJson,
        );

        logger.info(`[LC-WORKFLOW] Step 1 raw response for ${file.name}:\n${result.content}`);

        const { classifyData, logicalDocs } = parseClassifyResult(result.content, file.name);
        return {
          fileName: file.name,
          classifyData: parseDeep(classifyData) as ClassifyData,
          logicalDocs,
          subOperationId: result.operation.id,
          status: 'success',
        };
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[LC-WORKFLOW] Classify failed for ${file.name}: ${errMsg}`);
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
      stepName: `Phân loại chứng từ LC (${fileCount} file)`,
      processor: 'ext-classifier',
      content_preview: JSON.stringify(classifyResults.map(r => ({
        file: r.fileName,
        status: r.status,
        docs: r.status === 'success' ? r.logicalDocs.length : 0,
      }))),
      extracted_data: mergedClassifyData,
      sub_results: classifyResults.map((r, idx) => ({
        doc_id: `classify-${idx}-${r.fileName}`,
        doc_label: r.fileName,
        status: r.status === 'success' ? 'success' : 'error',
        sub_operation_id: r.subOperationId,
        content: r.status === 'success'
          ? JSON.stringify(r.classifyData, null, 2)
          : r.status === 'error' ? r.error : null,
        extracted_data: r.status === 'success' ? r.classifyData : null,
        logical_documents: r.status === 'success' ? r.logicalDocs : [],
      })),
    });
    await updateProgress(ctx, stepProgress(0, 'end'), `Bước 1 hoàn tất. ${fileCount} file → ${allLogicalDocs.length} loại chứng từ LC.`);
  }

  // ── STEP 2: Parallel Extract (per file) ───────────────────────────────────
  if (resumeFromStep <= 1) {
    logger.info(`[LC-WORKFLOW] Step 2/${TOTAL_STEPS}: Extract ${fileCount} file(s)`);
    await updateProgress(ctx, stepProgress(1, 'start'), `Bước 2/${TOTAL_STEPS}: Đang bóc tách dữ liệu ${fileCount} chứng từ...`);

    const extractPromises = filesData.map(async (file): Promise<ExtractResult> => {
      const docsForFile = allLogicalDocs.filter(d => d.source_file === file.name);
      const singleFileJson = JSON.stringify([file]);
      try {
        const result = await enqueueSubStep(
          ctx,
          'ext-data-extractor',
          buildExtractPrompt(docsForFile, file.name, promptOverrides.extract),
          singleFileJson,
        );

        logger.info(`[LC-WORKFLOW] Step 2 raw response for ${file.name}:\n${result.content}`);

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
        logger.error(`[LC-WORKFLOW] Extract failed for ${file.name}: ${errMsg}`);
        return { file_name: file.name, logical_docs: docsForFile.map(d => d.label), status: 'error', error: errMsg };
      }
    });

    extractionResults = await Promise.all(extractPromises);
    const extractSuccess = extractionResults.filter(r => r.status === 'success').length;

    ctx.stepsResult.push({
      step: 1,
      stepName: `OCR & Bóc tách chứng từ LC (${fileCount} file)`,
      processor: 'ext-data-extractor',
      content_preview: JSON.stringify(extractionResults.map(r => ({
        file: r.file_name,
        docs: r.logical_docs,
        status: r.status,
      }))),
      extracted_data: extractionResults,
      sub_results: extractionResults,
    });
    await updateProgress(ctx, stepProgress(1, 'end'), `Bước 2 hoàn tất (${extractSuccess}/${fileCount} file). Chờ xác nhận HITL.`);

    // TRIGGER HITL: PAUSE WORKFLOW — Chờ cán bộ xác nhận dữ liệu OCR trước khi kiểm tra
    return pauseWorkflow(ctx, 'Vui lòng kiểm tra và xác nhận kết quả bóc tách chứng từ trước khi chạy kiểm tra UCP 600.', 2);
  }

  // ── STEP 3: Compliance Check (UCP 600 / ISBP 821) ─────────────────────────
  if (resumeFromStep <= 2) {
    logger.info(`[LC-WORKFLOW] Step 3/${TOTAL_STEPS}: Compliance check (UCP 600)`);
    await updateProgress(ctx, stepProgress(2, 'start'), `Bước 3/${TOTAL_STEPS}: Đang kiểm tra tuân thủ UCP 600 / ISBP 821...`);

    const step3 = await enqueueSubStep(
      ctx,
      'ext-fact-verifier',
      buildComplianceCheckPrompt(extractionResults, promptOverrides.compliance),
      null,
    );

    let checkResult: LCCheckResult = {
      verdict: 'PENDING',
      total_discrepancies: 0,
      major_discrepancies: 0,
      minor_discrepancies: 0,
      advisory_count: 0,
      documents_present: [],
      documents_missing: [],
      discrepancies: [],
      summary: '',
      recommendation: 'RESERVE_FOR_REVIEW',
    };

    if (step3.content) {
      checkResult = parseDeep(step3.content) as LCCheckResult;
    }

    ctx.stepsResult.push({
      step: 2,
      stepName: 'Kiểm tra tuân thủ UCP 600 / ISBP 821',
      processor: 'ext-fact-verifier',
      sub_operation_id: step3.operation.id,
      content_preview: parseDeep(step3.content),
      extracted_data: parseDeep(checkResult),
    });
    await updateProgress(ctx, stepProgress(2, 'end'), `Bước 3 hoàn tất. Verdict: ${checkResult.verdict} — ${checkResult.total_discrepancies} discrepancy.`);
  }

  // ── STEP 4: Report ────────────────────────────────────────────────────────
  let finalReport = '';
  let finalCheckResult: LCCheckResult = {
    verdict: 'PENDING',
    total_discrepancies: 0,
    major_discrepancies: 0,
    minor_discrepancies: 0,
    advisory_count: 0,
    documents_present: [],
    documents_missing: [],
    discrepancies: [],
    summary: '',
    recommendation: 'RESERVE_FOR_REVIEW',
  };

  if (resumeFromStep <= 3) {
    logger.info(`[LC-WORKFLOW] Step 4/${TOTAL_STEPS}: Generate LC Checking Report`);
    await updateProgress(ctx, stepProgress(3, 'start'), `Bước 4/${TOTAL_STEPS}: Đang soạn Báo cáo Kiểm tra Chứng từ LC...`);

    // Load check result from Step 3 (index 2)
    finalCheckResult = (ctx.stepsResult.find(s => s.step === 2)?.extracted_data as LCCheckResult) || finalCheckResult;

    const step4 = await enqueueSubStep(
      ctx,
      'ext-content-gen',
      buildReportPrompt(mergedClassifyData, extractionResults, finalCheckResult, promptOverrides.report),
      null,
    );

    ctx.stepsResult.push({
      step: 3,
      stepName: 'Báo cáo Kiểm tra Chứng từ LC',
      processor: 'ext-content-gen',
      sub_operation_id: step4.operation.id,
      content_preview: step4.content?.substring(0, 2000),
      extracted_data: null,
    });

    finalReport = step4.content || '';
  }

  await completeWorkflow(ctx, finalReport, finalCheckResult);
}
