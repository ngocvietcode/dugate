// lib/pipelines/workflows/lc-checker.ts
// Workflow: Kiểm tra Bộ Chứng từ LC (Letter of Credit)
//
// DAG:
//   Step 1: N files → classify + OCR per file  [song song]
//   Step 2: aggregate → compliance check        [tuần tự, hybrid: OCR text + PDF gốc]
//   Step 3: generate report                     [tuần tự]

import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  completeWorkflow,
  parseDeep,
  db,
} from '@/lib/pipelines/workflow-engine';

import {
  type ClassifyData,
  type ClassifyFileResult,
  type ClassifyResult,
  type LCCheckResult,
  type MergedClassifyData,
  type LogicalDocument,
  buildClassifyPrompt,
  buildOcrPrompt,
  parseClassifyResult,
  mergeClassifyResults,
  buildComplianceCheckPrompt,
  buildReportPrompt,
} from './prompts/lc-checker-prompts';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 3;

/** Progress percentage ranges for each step [start, end] */
const STEP_PROGRESS: Record<number, [number, number]> = {
  0: [5, 35],   // Classify + OCR (parallel but more work)
  1: [40, 80],  // Compliance Check
  2: [85, 95],  // Report
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


  let mergedClassifyData: MergedClassifyData = {
    files_analyzed: 0,
    total_logical_documents: 0,
    per_file: [],
    logical_documents: [],
  };
  let allLogicalDocs: LogicalDocument[] = [];
  const ocrTexts = new Map<string, string>();

  // Restore step-specific variables if resuming from a checkpoint
  if (resumeFromStep > 0 && ctx.stepsResult.length > 0) {
    try {
      // Load Step 0 data (Classify + OCR)
      const step0 = ctx.stepsResult.find((s: any) => s.step === 0);
      if (step0) {
        mergedClassifyData = (step0.extracted_data as MergedClassifyData) || mergedClassifyData;
        allLogicalDocs = step0.sub_results?.flatMap((r: any) => r.logical_documents || []) || [];
        // Restore OCR texts
        const ocrData = step0.ocr_texts as Record<string, string> | undefined;
        if (ocrData) {
          for (const [k, v] of Object.entries(ocrData)) {
            ocrTexts.set(k, v);
          }
        }
      }
    } catch (e) {
      logger.warn(`[LC-WORKFLOW] Failed to restore step-specific variables`, undefined, e);
    }
  }

  // ── STEP 1: Parallel Classify + OCR (per file) ────────────────────────────
  if (resumeFromStep <= 0) {
    logger.info(`[LC-WORKFLOW] Step 1/${TOTAL_STEPS}: Classify + OCR ${fileCount} file(s)`);
    await updateProgress(ctx, stepProgress(0, 'start'), `Bước 1/${TOTAL_STEPS}: Đang phân loại & OCR ${fileCount} chứng từ LC...`);

    const classifyAndOcrPromises = filesData.map(async (file): Promise<{ classify: ClassifyResult; ocrText: string }> => {
      const singleFileJson = JSON.stringify([file]);
      let classifyResult: ClassifyResult;
      let ocrText = '';

      // Run classify + OCR in parallel for each file
      const [classifyResponse, ocrResponse] = await Promise.allSettled([
        // 1A: Classify
        (async () => {
          const result = await enqueueSubStep(
            ctx,
            'ext-classifier',
            buildClassifyPrompt(file.name, promptOverrides.classify),
            singleFileJson,
          );
          logger.info(`[LC-WORKFLOW] Step 1A classify response for ${file.name}:\n${result.content}`);
          return result;
        })(),
        // 1B: OCR Full-text
        (async () => {
          const result = await enqueueSubStep(
            ctx,
            'ext-doc-layout',
            buildOcrPrompt(file.name),
            singleFileJson,
          );
          logger.info(`[LC-WORKFLOW] Step 1B OCR response for ${file.name}: ${(result.content || '').length} chars`);
          return result;
        })(),
      ]);

      // Process classify result
      if (classifyResponse.status === 'fulfilled') {
        try {
          const { classifyData, logicalDocs } = parseClassifyResult(classifyResponse.value.content, file.name);
          classifyResult = {
            fileName: file.name,
            classifyData: parseDeep(classifyData) as ClassifyData,
            logicalDocs,
            subOperationId: classifyResponse.value.operation.id,
            status: 'success',
          };
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          logger.error(`[LC-WORKFLOW] Classify parse failed for ${file.name}: ${errMsg}`);
          classifyResult = { fileName: file.name, classifyData: {}, logicalDocs: [], subOperationId: '', status: 'error', error: errMsg };
        }
      } else {
        const errMsg = classifyResponse.reason?.message || String(classifyResponse.reason);
        logger.error(`[LC-WORKFLOW] Classify failed for ${file.name}: ${errMsg}`);
        classifyResult = { fileName: file.name, classifyData: {}, logicalDocs: [], subOperationId: '', status: 'error', error: errMsg };
      }

      // Process OCR result
      if (ocrResponse.status === 'fulfilled' && ocrResponse.value.content) {
        ocrText = ocrResponse.value.content;
      } else {
        const reason = ocrResponse.status === 'rejected' ? ocrResponse.reason?.message : 'empty response';
        logger.warn(`[LC-WORKFLOW] OCR failed/empty for ${file.name}: ${reason}. Compliance check will rely on PDF only.`);
      }

      return { classify: classifyResult, ocrText };
    });

    const results = await Promise.all(classifyAndOcrPromises);
    const classifyResults = results.map(r => r.classify);

    // Collect OCR texts
    results.forEach(r => {
      const fileName = r.classify.fileName;
      if (r.ocrText) {
        ocrTexts.set(fileName, r.ocrText);
      }
    });

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
      stepName: `Phân loại & OCR chứng từ LC (${fileCount} file)`,
      processor: 'ext-classifier + ext-doc-layout',
      content_preview: JSON.stringify(classifyResults.map(r => ({
        file: r.fileName,
        status: r.status,
        docs: r.status === 'success' ? r.logicalDocs.length : 0,
        ocr_chars: ocrTexts.get(r.fileName)?.length ?? 0,
      }))),
      extracted_data: mergedClassifyData,
      ocr_texts: Object.fromEntries(ocrTexts),
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

    const ocrSummary = ocrTexts.size > 0
      ? ` OCR: ${ocrTexts.size} file(s), ${Array.from(ocrTexts.values()).reduce((sum, t) => sum + t.length, 0)} chars.`
      : ' OCR: không có dữ liệu (sẽ dùng PDF trực tiếp).';
    await updateProgress(ctx, stepProgress(0, 'end'), `Bước 1 hoàn tất. ${fileCount} file → ${allLogicalDocs.length} loại chứng từ LC.${ocrSummary}`);
  }

  // ── STEP 2: Compliance Check (UCP 600 / ISBP 821) ─────────────────────────
  if (resumeFromStep <= 1) {
    logger.info(`[LC-WORKFLOW] Step 2/${TOTAL_STEPS}: Compliance check (UCP 600)`);
    await updateProgress(ctx, stepProgress(1, 'start'), `Bước 2/${TOTAL_STEPS}: Đang kiểm tra tuân thủ UCP 600 / ISBP 821...`);

    const step2 = await enqueueSubStep(
      ctx,
      'ext-fact-verifier',
      buildComplianceCheckPrompt(mergedClassifyData, ocrTexts, promptOverrides.compliance),
      JSON.stringify(filesData),  // PDF gốc vẫn đính kèm (visual backup cho chữ ký/dấu)
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

    if (step2.content) {
      checkResult = parseDeep(step2.content) as LCCheckResult;
    }

    ctx.stepsResult.push({
      step: 1,
      stepName: 'Kiểm tra tuân thủ UCP 600 / ISBP 821',
      processor: 'ext-fact-verifier',
      sub_operation_id: step2.operation.id,
      content_preview: parseDeep(step2.content),
      extracted_data: parseDeep(checkResult),
    });
    await updateProgress(ctx, stepProgress(1, 'end'), `Bước 2 hoàn tất. Verdict: ${checkResult.verdict} — ${checkResult.total_discrepancies} discrepancy.`);
  }

  // ── STEP 3: Report ────────────────────────────────────────────────────────
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

  if (resumeFromStep <= 2) {
    logger.info(`[LC-WORKFLOW] Step 3/${TOTAL_STEPS}: Generate LC Checking Report`);
    await updateProgress(ctx, stepProgress(2, 'start'), `Bước 3/${TOTAL_STEPS}: Đang soạn Báo cáo Kiểm tra Chứng từ LC...`);

    // Load check result from Step 2 (index 1)
    finalCheckResult = (ctx.stepsResult.find(s => s.step === 1)?.extracted_data as LCCheckResult) || finalCheckResult;

    const step3 = await enqueueSubStep(
      ctx,
      'ext-content-gen',
      buildReportPrompt(mergedClassifyData, finalCheckResult, promptOverrides.report),
      null,
    );

    ctx.stepsResult.push({
      step: 2,
      stepName: 'Báo cáo Kiểm tra Chứng từ LC',
      processor: 'ext-content-gen',
      sub_operation_id: step3.operation.id,
      content_preview: step3.content ?? null,  // Full content — no truncation (report may be long)
      extracted_data: null,
    });

    finalReport = step3.content || '';
  }

  await completeWorkflow(ctx, finalReport, finalCheckResult);
}
