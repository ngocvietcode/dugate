// lib/pipelines/workflows/tracing-portal/index.ts
// Workflow: Tracing Portal — OCR & trích xuất BBKQ CDM/ATM.
//
// Registered in WORKFLOW_REGISTRY as 'tracing-portal'
// (see lib/pipelines/workflow-engine.ts).
//
// Input: 1+ file BBKQ (PDF/image), nhận qua file upload hoặc file_urls.
// Output: JSON array kết quả trích xuất per-file, gửi qua webhook.

import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  completeWorkflow,
  failWorkflow,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';
import { buildExtractPrompt } from '@/lib/pipelines/workflows/prompts/tracing-portal-prompts';

/**
 * Entry point registered in WORKFLOW_REGISTRY.
 * Processes each BBKQ file in parallel → returns extracted data via webhook.
 */
export async function runTracingPortal(ctx: WorkflowContext): Promise<void> {
  const { logger, filesData } = ctx;

  try {
    if (!filesData || filesData.length === 0) {
      throw new Error('INVALID_INPUT: Không có file nào được gửi. Vui lòng đính kèm BBKQ (PDF/image).');
    }

    logger.info(`[TRACING-PORTAL] Processing ${filesData.length} file(s)`);

    // ── Step 1: OCR & Extract each file in parallel ───────────────────────────
    await updateProgress(ctx, 10, `Bước 1: Đang OCR & trích xuất ${filesData.length} file BBKQ...`);

    const rawResults = await Promise.all(
      filesData.map(async (file, idx) => {
        const singleFileJson = JSON.stringify([file]);
        try {
          const result = await enqueueSubStep(
            ctx,
            'ext-data-extractor',
            buildExtractPrompt(ctx.promptOverrides.extract),
            singleFileJson,
            ctx.modelOverrides.extract,
          );

          const parsed = parseDeep(result.content);
          // AI trả { tong_so_tai_lieu, danh_sach_tai_lieu: [...] } per file.
          // 1 file có thể chứa nhiều biên bản → flatten tất cả thành items riêng.
          let items: unknown[] = [];
          if (parsed && typeof parsed === 'object' && 'danh_sach_tai_lieu' in (parsed as Record<string, unknown>)) {
            const list = (parsed as Record<string, unknown>).danh_sach_tai_lieu;
            if (Array.isArray(list)) {
              items = list;
            }
          }
          if (items.length === 0) {
            // Fallback: AI trả object phẳng (không có wrapper)
            items = [parsed];
          }
          logger.info(`[TRACING-PORTAL] File ${idx + 1}/${filesData.length} extracted: ${file.name} (${items.length} biên bản)`);

          return items.map((item) => ({
            file_id: file.file_id ?? null,
            file_name: file.name,
            status: 'success' as const,
            extracted_data: item,
          }));
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[TRACING-PORTAL] Extract failed for ${file.name}: ${errMsg}`);
          return [{
            file_id: file.file_id ?? null,
            file_name: file.name,
            status: 'error' as const,
            error: errMsg,
            extracted_data: null,
          }];
        }
      }),
    );

    // Flatten: mỗi file có thể trả nhiều biên bản → gộp tất cả thành 1 mảng phẳng
    const extractResults = rawResults.flat();

    // ── Step 2: Build result ──────────────────────────────────────────────────
    const successCount = extractResults.filter(r => r.status === 'success').length;

    ctx.stepsResult.push({
      step: 0,
      stepName: `OCR & Trích xuất BBKQ (${filesData.length} file)`,
      processor: 'ext-data-extractor',
      content_preview: JSON.stringify({
        total_files: filesData.length,
        success: successCount,
        error: filesData.length - successCount,
      }),
      extracted_data: extractResults,
    });

    await updateProgress(ctx, 95, `Hoàn tất. ${successCount}/${filesData.length} file thành công.`);

    // ── Complete — extracted_data goes into webhook payload ────────────────────
    await completeWorkflow(ctx, null, {
      request_id: ctx.operationId,
      skill_code: 'tracing-portal',
      status: successCount === extractResults.length ? 'SUCCESS' : 'PARTIAL',
      tong_so_tai_lieu: extractResults.length,
      danh_sach_tai_lieu: extractResults,
    });
  } catch (error) {
    await failWorkflow(ctx, error);
  }
}
