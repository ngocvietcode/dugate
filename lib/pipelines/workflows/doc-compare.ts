// lib/pipelines/workflows/doc-compare.ts
// Workflow: So sánh Văn bản Nâng cao (Advanced Document Comparison)
//
// DAG:
//   Step 0: 2 files → OCR per file (ext-doc-layout)              [song song]
//   Step 1: Trích xuất Mục lục cả 2 văn bản (ext-doc-compare)    [tuần tự]
//   Step 2: So sánh từng mục (ext-doc-compare)                   [tuần tự]
//   Step 3: Tạo báo cáo (ext-content-gen)                        [tuần tự]

import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  completeWorkflow,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';

import {
  type TocExtractionResult,
  type DocCompareResult,
  buildOcrPrompt,
  buildTocExtractionPrompt,
  buildSectionComparePrompt,
  buildReportPrompt,
} from './prompts/doc-compare-prompts';

// ─── Constants ─────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

const STEP_PROGRESS: Record<number, [number, number]> = {
  0: [5, 25],   // OCR
  1: [30, 55],  // TOC Extraction
  2: [60, 80],  // Section Comparison
  3: [85, 95],  // Report
};

function stepProgress(stepIdx: number, phase: 'start' | 'end'): number {
  const range = STEP_PROGRESS[stepIdx];
  if (!range) return 50;
  return phase === 'start' ? range[0] : range[1];
}

// ─── Main Workflow ──────────────────────────────────────────────────────────

export async function runDocCompare(ctx: WorkflowContext): Promise<void> {
  const { logger, filesData, promptOverrides } = ctx;
  const fileCount = filesData.length;
  const resumeFromStep = ctx.currentStep;

  if (fileCount < 2) {
    throw new Error('doc-compare requires exactly 2 documents. Got: ' + fileCount);
  }

  const doc1 = filesData[0];
  const doc2 = filesData[1];

  const ocrTexts = new Map<string, string>();
  let tocResult: TocExtractionResult | null = null;
  let compareResult: DocCompareResult | null = null;

  // Restore checkpoints when resuming
  if (resumeFromStep > 0 && ctx.stepsResult.length > 0) {
    try {
      const step0 = ctx.stepsResult.find((s: any) => s.step === 0);
      if (step0?.ocr_texts) {
        for (const [k, v] of Object.entries(step0.ocr_texts as Record<string, string>)) {
          ocrTexts.set(k, v);
        }
      }
      const step1 = ctx.stepsResult.find((s: any) => s.step === 1);
      if (step1?.extracted_data) {
        tocResult = step1.extracted_data as TocExtractionResult;
      }
      const step2 = ctx.stepsResult.find((s: any) => s.step === 2);
      if (step2?.extracted_data) {
        compareResult = step2.extracted_data as DocCompareResult;
      }
    } catch (e) {
      logger.warn(`[DOC-COMPARE] Failed to restore checkpoint`, undefined, e);
    }
  }

  // ── STEP 0: Parallel OCR ─────────────────────────────────────────────────
  if (resumeFromStep <= 0) {
    logger.info(`[DOC-COMPARE] Step 1/${TOTAL_STEPS}: OCR ${fileCount} file(s)`);
    await updateProgress(ctx, stepProgress(0, 'start'), `Bước 1/${TOTAL_STEPS}: Đang OCR ${fileCount} văn bản...`);

    const ocrPromises = filesData.map(async (file) => {
      try {
        const result = await enqueueSubStep(
          ctx,
          'ext-doc-layout',
          buildOcrPrompt(file.name, promptOverrides.classify),
          JSON.stringify([file]),
        );
        return { fileName: file.name, content: result.content || '', subOpId: result.operation.id, status: 'success' as const };
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[DOC-COMPARE] OCR failed for ${file.name}: ${errMsg}`);
        return { fileName: file.name, content: '', subOpId: '', status: 'error' as const, error: errMsg };
      }
    });

    const ocrResults = await Promise.all(ocrPromises);
    for (const r of ocrResults) {
      if (r.status === 'success' && r.content) {
        ocrTexts.set(r.fileName, r.content);
      }
    }

    ctx.stepsResult.push({
      step: 0,
      stepName: `OCR văn bản (${fileCount} file)`,
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
        content: r.status === 'success' ? `[OCR: ${r.content.length} chars]` : (r.error ?? null),
      })),
    });

    const totalChars = Array.from(ocrTexts.values()).reduce((s, t) => s + t.length, 0);
    await updateProgress(ctx, stepProgress(0, 'end'), `Bước 1 hoàn tất. OCR ${ocrTexts.size}/${fileCount} file, ${totalChars} ký tự.`);
  }

  // ── STEP 1: TOC Extraction ───────────────────────────────────────────────
  if (resumeFromStep <= 1) {
    logger.info(`[DOC-COMPARE] Step 2/${TOTAL_STEPS}: TOC Extraction`);
    await updateProgress(ctx, stepProgress(1, 'start'), `Bước 2/${TOTAL_STEPS}: Đang phân tích Mục lục 2 văn bản...`);

    const doc1Text = ocrTexts.get(doc1.name) || '';
    const doc2Text = ocrTexts.get(doc2.name) || '';

    const step1 = await enqueueSubStep(
      ctx,
      'ext-doc-compare',
      buildTocExtractionPrompt(doc1.name, doc2.name, doc1Text, doc2Text, promptOverrides.toc),
      JSON.stringify({ mode: 'toc', doc1_name: doc1.name, doc2_name: doc2.name }),
    );

    tocResult = parseDeep(step1.content) as TocExtractionResult;

    ctx.stepsResult.push({
      step: 1,
      stepName: 'Phân tích Mục lục 2 văn bản',
      processor: 'ext-doc-compare',
      sub_operation_id: step1.operation.id,
      content_preview: step1.content,
      extracted_data: parseDeep(tocResult),
    });
    await updateProgress(ctx, stepProgress(1, 'end'), `Bước 2 hoàn tất. Mục lục VB1: ${tocResult?.doc1_toc?.length ?? 0} mục, VB2: ${tocResult?.doc2_toc?.length ?? 0} mục.`);
  }

  // ── STEP 2: Section Comparison ───────────────────────────────────────────
  if (resumeFromStep <= 2) {
    logger.info(`[DOC-COMPARE] Step 3/${TOTAL_STEPS}: Section Comparison`);
    await updateProgress(ctx, stepProgress(2, 'start'), `Bước 3/${TOTAL_STEPS}: Đang so sánh từng mục giữa 2 văn bản...`);

    if (!tocResult) {
      throw new Error('TOC result not available for section comparison');
    }

    const doc1Text = ocrTexts.get(doc1.name) || '';
    const doc2Text = ocrTexts.get(doc2.name) || '';

    const step2 = await enqueueSubStep(
      ctx,
      'ext-doc-compare',
      buildSectionComparePrompt(tocResult, doc1Text, doc2Text, promptOverrides.compare),
      JSON.stringify({ mode: 'compare', toc: tocResult }),
    );

    compareResult = parseDeep(step2.content) as DocCompareResult;

    ctx.stepsResult.push({
      step: 2,
      stepName: 'So sánh từng mục 2 văn bản',
      processor: 'ext-doc-compare',
      sub_operation_id: step2.operation.id,
      content_preview: step2.content,
      extracted_data: parseDeep(compareResult),
    });
    await updateProgress(ctx, stepProgress(2, 'end'), `Bước 3 hoàn tất. ${compareResult?.modified_count ?? 0} mục sửa đổi, ${compareResult?.added_count ?? 0} thêm, ${compareResult?.removed_count ?? 0} xóa.`);
  }

  // ── STEP 3: Report ───────────────────────────────────────────────────────
  let finalReport = '';
  if (resumeFromStep <= 3) {
    logger.info(`[DOC-COMPARE] Step 4/${TOTAL_STEPS}: Generate Report`);
    await updateProgress(ctx, stepProgress(3, 'start'), `Bước 4/${TOTAL_STEPS}: Đang soạn Báo cáo So sánh Văn bản...`);

    const resultForReport = (ctx.stepsResult.find(s => s.step === 2)?.extracted_data as DocCompareResult) || compareResult;
    if (!resultForReport) throw new Error('Compare result not available for report generation');

    const step3 = await enqueueSubStep(
      ctx,
      'ext-content-gen',
      buildReportPrompt(resultForReport, promptOverrides.report),
      null,
    );

    ctx.stepsResult.push({
      step: 3,
      stepName: 'Báo cáo So sánh Văn bản',
      processor: 'ext-content-gen',
      sub_operation_id: step3.operation.id,
      content_preview: step3.content ?? null,
      extracted_data: null,
    });

    finalReport = step3.content || '';
  }

  await completeWorkflow(ctx, finalReport, compareResult);
}
