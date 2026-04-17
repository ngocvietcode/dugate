// lib/pipelines/workflows/lc-checker.ts
// Workflow: Kiểm tra Bộ Chứng từ LC (Letter of Credit)
//
// DAG:
//   Step 1: N files → OCR per file (ext-doc-layout)      [song song]
//   Step 2: compliance check (OCR text + PDF gốc)         [tuần tự]
//   Step 3: generate report                               [tuần tự]

import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  completeWorkflow,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';

import {
  type LCCheckResult,
  buildOcrPrompt,
  buildComplianceCheckPrompt,
  buildReportPrompt,
} from './prompts/lc-checker-prompts';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 3;

/** Progress percentage ranges for each step [start, end] */
const STEP_PROGRESS: Record<number, [number, number]> = {
  0: [5, 30],   // OCR
  1: [35, 80],  // Compliance Check
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

  const ocrTexts = new Map<string, string>();

  // Restore step-specific variables if resuming from a checkpoint
  if (resumeFromStep > 0 && ctx.stepsResult.length > 0) {
    try {
      const step0 = ctx.stepsResult.find((s: any) => s.step === 0);
      if (step0) {
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

  // ── STEP 1: Parallel OCR (per file) ───────────────────────────────────────
  if (resumeFromStep <= 0) {
    logger.info(`[LC-WORKFLOW] Step 1/${TOTAL_STEPS}: OCR ${fileCount} file(s)`);
    await updateProgress(ctx, stepProgress(0, 'start'), `Bước 1/${TOTAL_STEPS}: Đang OCR ${fileCount} chứng từ LC...`);

    const ocrPromises = filesData.map(async (file) => {
      const singleFileJson = JSON.stringify([file]);
      try {
        const result = await enqueueSubStep(
          ctx,
          'ext-doc-layout',
          buildOcrPrompt(file.name, promptOverrides.classify),
          singleFileJson,
        );
        logger.info(`[LC-WORKFLOW] Step 1 OCR response for ${file.name}: ${(result.content || '').length} chars`);
        return { fileName: file.name, content: result.content || '', subOpId: result.operation.id, status: 'success' as const };
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[LC-WORKFLOW] OCR failed for ${file.name}: ${errMsg}`);
        return { fileName: file.name, content: '', subOpId: '', status: 'error' as const, error: errMsg };
      }
    });

    const ocrResults = await Promise.all(ocrPromises);

    // Collect OCR texts
    for (const r of ocrResults) {
      if (r.status === 'success' && r.content) {
        ocrTexts.set(r.fileName, r.content);
      }
    }

    if (ocrTexts.size === 0) {
      logger.warn(`[LC-WORKFLOW] All OCR jobs failed. Compliance check will rely on PDF only.`);
    }

    ctx.stepsResult.push({
      step: 0,
      stepName: `OCR chứng từ LC (${fileCount} file)`,
      processor: 'ext-doc-layout',
      content_preview: JSON.stringify(ocrResults.map(r => ({
        file: r.fileName,
        status: r.status,
        ocr_chars: r.content.length,
      }))),
      extracted_data: null,
      ocr_texts: Object.fromEntries(ocrTexts),
      sub_results: ocrResults.map((r, idx) => ({
        doc_id: `ocr-${idx}-${r.fileName}`,
        doc_label: r.fileName,
        status: r.status,
        sub_operation_id: r.subOpId,
        content: r.status === 'success' ? `[OCR: ${r.content.length} chars]` : r.error ?? null,
      })),
    });

    const totalChars = Array.from(ocrTexts.values()).reduce((sum, t) => sum + t.length, 0);
    await updateProgress(ctx, stepProgress(0, 'end'), `Bước 1 hoàn tất. OCR ${ocrTexts.size}/${fileCount} file, ${totalChars} chars.`);
  }

  // ── STEP 2: Compliance Check (UCP 600 / ISBP 821) ─────────────────────────
  if (resumeFromStep <= 1) {
    logger.info(`[LC-WORKFLOW] Step 2/${TOTAL_STEPS}: Compliance check (UCP 600)`);
    await updateProgress(ctx, stepProgress(1, 'start'), `Bước 2/${TOTAL_STEPS}: Đang kiểm tra tuân thủ UCP 600 / ISBP 821...`);

    const step2 = await enqueueSubStep(
      ctx,
      'ext-fact-verifier',
      buildComplianceCheckPrompt(fileCount, ocrTexts, promptOverrides.compliance),
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
      buildReportPrompt(fileCount, finalCheckResult, promptOverrides.report),
      null,
    );

    ctx.stepsResult.push({
      step: 2,
      stepName: 'Báo cáo Kiểm tra Chứng từ LC',
      processor: 'ext-content-gen',
      sub_operation_id: step3.operation.id,
      content_preview: step3.content ?? null,
      extracted_data: null,
    });

    finalReport = step3.content || '';
  }

  await completeWorkflow(ctx, finalReport, finalCheckResult);
}
