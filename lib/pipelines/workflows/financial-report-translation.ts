// lib/pipelines/workflows/financial-report-translation.ts
// Workflow: OCR + dịch báo cáo tài chính nước ngoài (chuẩn Nhật) → JSON song ngữ.
//
// DAG:
//   Step 0: Preflight   — đọc PDF, đếm trang, corrupt/password/blank   [code-only]
//   Step 1: Classify    — mỗi loại báo cáo nằm ở trang nào (JA + EN)   [AI theo cửa sổ trang]
//   Step 2: Extract     — OCR + bóc bảng theo report/chunk             [AI, stagger + retry]
//   Step 3: Translate   — rẽ nhánh targetLang, chỉ dịch text           [AI theo danh sách id]
//   Step 4: Merge+Valid — gộp chunk, gán status/warnings, validate      [code-only]
//
// SCOPE (SRS §3.2): DU CHỈ trả JSON. Không sinh Excel/Word, không UI, không lưu trữ/hiển thị.
// Kế hoạch chi tiết: handover-report/OCRBctcJapan/PLAN/TASK-1-WORKFLOW.md
//
// GHI CHÚ CONTRACT (lệch SRS, đã ghi rõ lý do — xem TASK-1-WORKFLOW.md §12):
//   SRS mô tả HTTP 200/207 trả kết quả ngay. DU chạy async (202 + polling) vì
//   PDF 24–100+ trang không thể xử lý trong trần ~300s của endpoint sync.
//   Payload BÊN TRONG operation giữ đúng envelope SRS để BLOS chỉ parse 1 kiểu.
//   → Open question Q6 đang chờ BA/BU xác nhận.

import {
  type WorkflowContext,
  updateProgress,
  updateWorkflowProgressDetails,
  completeWorkflow,
  failWorkflow,
} from '@/lib/pipelines/workflow-engine';

import {
  ERROR_MESSAGES,
  NOTES_REPORT_TYPE,
  REPORT_TYPES,
  createEmptyBilingual,
  createEmptyPayload,
  createNotFoundNotesReport,
  createNotFoundTabularReport,
  parseSupplementalReportTitleAliases,
  resolveErrorCode,
  type FileProcessingInfo,
  type FileResult,
  type FinancialReportConfig,
  type FinancialReportEnvelope,
  type FinancialReportProgressDetails,
  type FinancialReportErrorCode,
  type FinancialReportPayload,
  type InternalFinancialReportPayload,
  type NotesReport,
  type ReportExtractionTrace,
  type ReportStatus,
  type ReportType,
  type TabularReport,
  type TargetLang,
  type TranslationStatus,
} from './financial-report/types';

import { normalizeCurrency, normalizeDate, resolveUnit } from './financial-report/number-parse';
import {
  DEFAULT_RENDER_SCALE,
  cleanupChunks,
  preflightPdf,
  readWorkflowFile,
  type WorkflowFile,
} from './financial-report/pdf-utils';
import {
  classifyDocument,
  detectPeriodScope,
  detectStatementKind,
  type ReportLocation,
} from './financial-report/classify';
import { extractReports, summarizeNotesOutputLimits, type ExtractOutcome, type TableChunkOutcome } from './financial-report/extract';
import { makeWarning, mergeNotesReport, mergePageRanges, mergeTabularReport } from './financial-report/merge';
import { applySgaFallback } from './financial-report/sga-fallback';
import { translatePayload } from './financial-report/translate';
import { REPORT_ALIASES, TITLE_PREFIXES_TO_IGNORE } from './prompts/financial-report-prompts';

const LOG = '[FINANCIAL-REPORT]';
const PDF_EXTENSIONS = ['.pdf'];
/** UAT #04 / T9 — thiếu các báo cáo này cùng nhiều trang chưa classify là lỗi coverage nghiêm trọng. */
const CORE_REPORT_TYPES: readonly ReportType[] = [
  'balanceSheet',
  'incomeStatement',
  'cashFlowStatement',
  'equityChangeStatement',
] as const;
/** Cover pages, contents and separators are expected; escalate only material coverage gaps. */
const UNASSIGNED_PAGE_WARNING_RATIO = 0.25;
const WORKFLOW_TIMEOUT_FILE_DIAGNOSTIC = 'Workflow deadline exceeded before processing this file.';

/**
 * BA 2026-08-14: CI remains an internal routing bucket so it cannot contaminate P&L,
 * but it is not part of the outward six-report contract. Remove its member to re-enable.
 */
export const OUTPUT_SUPPRESSED_REPORT_TYPES = new Set<ReportType>(['comprehensiveIncome']);

// ─── Cấu hình (Profile §7) ────────────────────────────────────────────────────

const DEFAULTS = {
  pagesPerChunk: 2,
  /**
   * UAT #01 / I3 — Thuyết minh phải chunk NHỎ HƠN bảng số liệu. Prompt notes yêu cầu trả
   * `sourceText` là TOÀN VĂN từng mục; notes IFRS tiếng Nhật rất dài nên phản hồi JSON dễ bị
   * cắt theo giới hạn token đầu ra và `parseDeep()` trả null. Đo trên Sony: 3/12 chunk lỗi
   * và cả 3 đều là chunk notes 2 trang, trong khi MỌI chunk bảng đều thành công.
   */
  notesPagesPerChunk: 1,
  classifyPagesPerCall: 1,
  // UAT #04 / T4: chỉ soi lại vùng chưa gán để cứu trang bị classify bỏ sót, không gọi lại toàn bộ PDF.
  classifyRecheckUnassigned: true,
  // Round 11B / T2.3: chỉ recheck trang bảng chưa gán; tăng giới hạn dải cứu từ 2 lên 4.
  classifyRecheckMaxWindows: 4,
  /** Round 11B / T2.5: classify là bước nhẹ, dùng scheduler nhanh hơn extract/translate. */
  classifyMaxConcurrency: 4,
  classifyStaggerDelayMs: 1000,
  // UAT JFE: bù sai số ±1 trang của classify khi gửi trang cho extract (xem extract.ts).
  extractPageMargin: 1,
  /**
   * 2 → 3: đo trên Air Water 24 trang, chunk trang 21-22 rớt sau 2 lần trong khi 8 chunk còn
   * lại xong bình thường — lỗi lẻ tẻ do tải, thêm 1 lần nữa là đủ. Ngoài số này còn có lượt 2
   * chạy lại chunk lỗi sau khi mọi chunk khác đã xong (xem `retryFailedChunks`).
   */
  maxRetries: 3,
  /** CODE-REVIEW-01 mục 6: số lần gọi AI đồng thời. 3 là mức an toàn theo ghi chú stress test. */
  maxConcurrency: 3,
  staggerDelayMs: 5000,
  etaSecondsPerPage: 13,
  workflowDeadlineMs: 7_200_000,
} as const;
const RUNNING_STALL_MS_VALUE = 9_000_000;

export function resolveConfig(ctx: WorkflowContext): FinancialReportConfig {
  const vars = ctx.pipelineVars;

  // `targetLang` là field của request theo SRS; `target_lang` là fallback cấu hình trên Profile.
  const requested = firstString(vars.targetLang, vars.target_lang);
  const targetLang: TargetLang = requested?.toLowerCase() === 'en' ? 'en' : 'vi';
  const maxConcurrency = positiveInt(vars.max_concurrency, DEFAULTS.maxConcurrency);
  const staggerDelayMs = nonNegativeInt(vars.stagger_delay_ms, DEFAULTS.staggerDelayMs);
  // Profile cũ có thể đã lưu key mới là chuỗi trống; trường hợp đó giữ scheduler chung.
  // Key không tồn tại (Profile mới) dùng default classify riêng 4 / 1000 đã chốt ở T2.5.
  const classifyMaxConcurrency = isBlankProfileValue(vars.classify_max_concurrency)
    ? maxConcurrency
    : positiveInt(vars.classify_max_concurrency, DEFAULTS.classifyMaxConcurrency);
  const classifyStaggerDelayMs = isBlankProfileValue(vars.classify_stagger_delay_ms)
    ? staggerDelayMs
    : nonNegativeInt(vars.classify_stagger_delay_ms, DEFAULTS.classifyStaggerDelayMs);
  const extractInterChunkDelayMs = isBlankProfileValue(vars.extract_inter_chunk_delay_ms)
    ? staggerDelayMs
    : nonNegativeInt(vars.extract_inter_chunk_delay_ms, staggerDelayMs);
  const workflowDeadlineMs = positiveInt(vars.workflow_deadline_ms, DEFAULTS.workflowDeadlineMs);
  if (workflowDeadlineMs >= RUNNING_STALL_MS_VALUE) {
    ctx.logger?.warn?.(
      `[WORKFLOW] ⚠ workflow_deadline_ms (${workflowDeadlineMs}) >= RUNNING_STALL_MS (${RUNNING_STALL_MS_VALUE}): reaper có thể giết trước deadline`,
    );
  }

  return {
    targetLang,
    requestId: firstString(vars.requestId, vars.request_id) ?? ctx.operationId,
    pagesPerChunk: positiveInt(vars.pages_per_chunk, DEFAULTS.pagesPerChunk),
    notesPagesPerChunk: positiveInt(vars.notes_pages_per_chunk, DEFAULTS.notesPagesPerChunk),
    classifyPagesPerCall: positiveInt(vars.classify_pages_per_call, DEFAULTS.classifyPagesPerCall),
    classifyRecheckUnassigned: vars.classify_recheck_unassigned === undefined
      ? DEFAULTS.classifyRecheckUnassigned
      : parseBoolean(vars.classify_recheck_unassigned),
    classifyRecheckMaxWindows: positiveInt(vars.classify_recheck_max_windows, DEFAULTS.classifyRecheckMaxWindows),
    // Cho phép ops đặt 0 để tắt biên → dùng nonNegativeInt, không dùng positiveInt.
    extractPageMargin: vars.extract_page_margin === undefined || vars.extract_page_margin === ''
      ? DEFAULTS.extractPageMargin
      : Math.max(0, Math.floor(Number(vars.extract_page_margin) || 0)),
    maxRetries: positiveInt(vars.max_retries, DEFAULTS.maxRetries),
    maxConcurrency,
    staggerDelayMs,
    extractInterChunkDelayMs,
    translateBatchItems: positiveInt(vars.translate_batch_items, 40),
    translateBatchChars: positiveInt(vars.translate_batch_chars, 20_000),
    classifyMaxConcurrency,
    classifyStaggerDelayMs,
    enableTranslation: vars.enable_translation === undefined ? true : parseBoolean(vars.enable_translation),
    renderScale: boundedFloat(vars.render_scale, DEFAULT_RENDER_SCALE, 1, 4),
    etaSecondsPerPage: positiveInt(vars.eta_seconds_per_page, DEFAULTS.etaSecondsPerPage),
    workflowDeadlineMs,
    outputSuppressedReportTypes: parseOutputSuppressedReportTypes(vars.output_suppressed_report_types),
    supplementalReportTitleAliases: parseSupplementalReportTitleAliases(vars.supplemental_report_title_aliases),
    reportTypes: parseReportTypes(vars.report_types),
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Entry point đăng ký trong WORKFLOW_REGISTRY (`financial-report-translation`).
 * Xử lý từng file tuần tự để không làm quá tải AI backend (tiền lệ: server
 * serialize nặng, batch an toàn ~30 request — xem .agent/brain journal).
 */
export async function runFinancialReportTranslation(ctx: WorkflowContext): Promise<void> {
  const { logger } = ctx;
  const config = resolveConfig(ctx);
  // Keep the deadline in memory: no contract or persisted workflow-context change is required.
  const workflowStartedAt = Date.now();
  const workflowDeadlineMs = config.workflowDeadlineMs ?? DEFAULTS.workflowDeadlineMs;
  const uploadedKeys: string[] = [];

  logger.info(
    `${LOG} Bắt đầu workflow: targetLang=${config.targetLang}, files=${ctx.filesData.length}, ` +
    `pagesPerChunk=${config.pagesPerChunk}, classifyWindow=${config.classifyPagesPerCall}, ` +
    `maxRetries=${config.maxRetries}, maxConcurrency=${config.maxConcurrency}, ` +
    `stagger=${config.staggerDelayMs}ms, classifyConcurrency=${config.classifyMaxConcurrency ?? config.maxConcurrency}, ` +
    `classifyStagger=${config.classifyStaggerDelayMs ?? config.staggerDelayMs}ms, deadline=${workflowDeadlineMs}ms, ` +
    `translation=${config.enableTranslation}`,
  );

  const results: FileResult[] = [];
  const fileCount = ctx.filesData.length;

  try {
    if (fileCount === 0) {
      throw new Error('INVALID_INPUT: Không có file nào để xử lý.');
    }

    for (let index = 0; index < fileCount; index++) {
      assertWorkflowWithinDeadline(workflowStartedAt, workflowDeadlineMs);
      const file = ctx.filesData[index];
      const base = Math.round((index / fileCount) * 90);
      const span = Math.round(90 / fileCount);

      await updateProgress(ctx, Math.max(2, base), `File ${index + 1}/${fileCount}: bắt đầu xử lý "${file.name}"`);

      const fileResult = await processSingleFile(
        ctx, file, index, config, uploadedKeys, base, span, workflowStartedAt, workflowDeadlineMs,
      );
      results.push(fileResult);
    }

    const envelope = buildEnvelope(config, results);

    await updateProgress(ctx, 95, `Hoàn tất ${results.length} file. Đang tổng hợp kết quả.`);
    logger.info(`${LOG} Kết quả: code=${envelope.code}, ${results.filter((r) => r.status === 'SUCCESS').length}/${results.length} file SUCCESS`);

    await completeWorkflow(ctx, JSON.stringify({ code: envelope.code, message: envelope.message }), envelope);
  } catch (error) {
    if (isWorkflowTimeoutError(error) && results.length > 0) {
      const completedCount = results.length;
      results.push(...buildWorkflowTimeoutFileResults(ctx.filesData, completedCount));
      const envelope = buildEnvelope(config, results);
      logger.warn(`${LOG} Workflow deadline reached after ${completedCount}/${fileCount} completed file(s); returning partial batch envelope.`);
      await completeWorkflow(ctx, JSON.stringify({ code: envelope.code, message: envelope.message }), envelope);
      return;
    }
    await failWorkflow(ctx, error);
  } finally {
    // §23 — cleanup file tạm khi split PDF
    try {
      await cleanupChunks(uploadedKeys);
    } catch (err) {
      logger.warn(`${LOG} Không cleanup được ${uploadedKeys.length} chunk tạm`, undefined, err);
    }
  }
}

// ─── Xử lý 1 file ─────────────────────────────────────────────────────────────

async function processSingleFile(
  ctx: WorkflowContext,
  file: WorkflowFile,
  index: number,
  config: FinancialReportConfig,
  uploadedKeys: string[],
  progressBase: number,
  progressSpan: number,
  workflowStartedAt: number,
  workflowDeadlineMs: number,
): Promise<FileResult> {
  const { logger } = ctx;
  const fileId = `GRP-${index + 1}`;

  try {
    if (!isPdf(file)) {
      throw new Error(`UNSUPPORTED_DOCUMENT_EXT: "${file.name}" không phải PDF.`);
    }

    // ── Step 0: Preflight ────────────────────────────────────────────────
    await beginFinancialReportStage(
      ctx, file, index, 'preflight', progressBase + Math.round(progressSpan * 0.01),
      `"${file.name}": đang kiểm tra file...`,
    );
    assertWorkflowWithinDeadline(workflowStartedAt, workflowDeadlineMs);
    const buffer = await readWorkflowFile(file.path, ctx.operationId);
    const source = await preflightPdf(buffer, file.name, config.renderScale);
    assertWorkflowWithinDeadline(workflowStartedAt, workflowDeadlineMs);
    const totalPages = source.totalPages;
    const progressDetails: FinancialReportProgressDetails = {
      total_pages: totalPages,
      current_file: index + 1,
      file_count: ctx.filesData.length,
      seconds_per_page: config.etaSecondsPerPage ?? DEFAULTS.etaSecondsPerPage,
    };
    await updateWorkflowProgressDetails(ctx, progressDetails);
    logger.info(
      `${LOG} Preflight "${file.name}": ${totalPages} trang, ${buffer.length} byte, ` +
      `encrypted=${source.encrypted}, pageSource=${source.mode}` +
      // Vòng #05 mục 34: 3/7 file mẫu (JFE/Marubeni/Sony) là owner-password-only.
      // Ghi rõ ở log để khi so độ chính xác biết file nào đi đường ảnh.
      (source.mode === 'image'
        ? ` (PDF mã hoá → render trang thành PNG, scale=${source.renderScale} ≈ ${Math.round(72 * source.renderScale)} DPI)`
        : ''),
    );
    await beginFinancialReportStage(
      ctx, file, index, 'classify', progressBase + Math.round(progressSpan * 0.05),
      `"${file.name}": ${totalPages} trang. Đang phân loại báo cáo...`,
    );

    // ── Step 1: Classify ─────────────────────────────────────────────────
    const chunkKeyPrefix = `f${index + 1}`;
    assertWorkflowWithinDeadline(workflowStartedAt, workflowDeadlineMs);
    const classified = await classifyDocument(ctx, file.name, source, config, chunkKeyPrefix, uploadedKeys);
    assertWorkflowWithinDeadline(workflowStartedAt, workflowDeadlineMs);
    const foundTypes = [...new Set(classified.locations.map((l) => l.reportType))];
    await beginFinancialReportStage(
      ctx, file, index, 'extract', progressBase + Math.round(progressSpan * 0.25),
      `"${file.name}": nhận diện ${foundTypes.length}/7 loại báo cáo (${foundTypes.join(', ') || 'none'}). Đang bóc tách...`,
    );

    // ── Step 2: Extract ──────────────────────────────────────────────────
    assertWorkflowWithinDeadline(workflowStartedAt, workflowDeadlineMs);
    const extractOutcome = await extractReports(
      ctx,
      file.name,
      source,
      classified.locations,
      config,
      chunkKeyPrefix,
      uploadedKeys,
      async (done, total) => {
        await updateProgress(
          ctx,
          progressBase + Math.round(progressSpan * (0.25 + 0.4 * (done / total))),
          `"${file.name}": bóc tách ${done}/${total} chunk`,
        );
      },
    );
    assertWorkflowWithinDeadline(workflowStartedAt, workflowDeadlineMs);

    await beginFinancialReportStage(
      ctx, file, index, 'merge', progressBase + Math.round(progressSpan * 0.65),
      `"${file.name}": đang chuẩn hóa và gộp kết quả trước dịch...`,
    );

    // T3.2: route theo metadata từng bảng một lần để merge và processingInfo cùng dùng một kết quả.
    // Round 12 / T12.4: callback chỉ ghi quan sát Notes (title/type/strong-alias), không đổi routing.
    const tableRouting = routeExtractedTables(
      extractOutcome,
      (message) => logger.info(`${LOG} "${file.name}" ${message}`),
    );

    // ── Step 4a: Merge (trước dịch, để dịch theo danh sách id đã chuẩn hóa) ──
    const payloadBuild = buildPayloadWithRouting(
      config,
      classified,
      extractOutcome,
      (message) => logger.info(`${LOG} "${file.name}" ${message}`),
      tableRouting,
      totalPages,
    );
    const payload = payloadBuild.payload;

    // ── Step 3: Translate ────────────────────────────────────────────────
    // Q7: dịch KHÔNG còn là điều kiện sống/chết của cả file. Dịch chết → giữ nguyên kết quả
    // OCR (chữ nguồn), gắn warning, file thành PARTIAL_SUCCESS. Không bỏ công đã tốn token.
    let translationStatus: TranslationStatus = 'SKIPPED';
    let untranslatedItems = 0;
    let translationFailureReasons: string[] = [];
    let translateOutputLimitSuspected = 0;

    if (config.enableTranslation) {
      await beginFinancialReportStage(
        ctx, file, index, 'translate', progressBase + Math.round(progressSpan * 0.7),
        `"${file.name}": đang dịch sang ${LANG_NAME[config.targetLang]}...`,
      );
      try {
        assertWorkflowWithinDeadline(workflowStartedAt, workflowDeadlineMs);
        const translateOutcome = await translatePayload(ctx, payload, config);
        assertWorkflowWithinDeadline(workflowStartedAt, workflowDeadlineMs);
        untranslatedItems = translateOutcome.untranslatedItems;
        translationFailureReasons = translateOutcome.failureReasons;
        translateOutputLimitSuspected = translateOutcome.translateOutputLimitSuspected;
        translationStatus = translateOutcome.translatedItems === translateOutcome.totalItems
          ? 'DONE'
          : translateOutcome.translatedItems === 0
            ? 'FAILED'
            : 'PARTIAL';

        for (const [reportType, count] of translateOutcome.untranslatedByReport) {
          const report = payload[reportType] as TabularReport | NotesReport;
          report.warnings.push(makeWarning('TRANSLATION_PARTIAL', `${count} nội dung chưa dịch được.`));
        }

        if (translationStatus === 'FAILED') {
          const kept = summarizeExtractedVolume(payload);
          logger.error(
            `${LOG} Dịch thất bại cho "${file.name}": ${translationFailureReasons.join(' | ').substring(0, 200)}\n` +
            `${LOG} [Q7] GIỮ LẠI kết quả OCR (status = PARTIAL_SUCCESS): ` +
            `${kept.reportsWithData} báo cáo có dữ liệu, ${kept.tableCount} bảng, ${kept.rowCount} dòng, ` +
            `${kept.noteSectionCount} mục thuyết minh, ${kept.pagesCovered} trang. Chỉ thiếu bản dịch.`,
          );
          for (const reportType of REPORT_TYPES) {
            const report = payload[reportType] as TabularReport | NotesReport;
            if (report.status === 'NOT_FOUND') continue;
            report.warnings.push(makeWarning('TRANSLATION_FAILED'));
          }
        }
      } catch (err) {
        if (isWorkflowTimeoutError(err)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        translationStatus = 'FAILED';
        untranslatedItems = translatableItemCount(payload);
        translationFailureReasons = [`translate lô 1/1 (${untranslatedItems} mục): ${msg.substring(0, 160)}`];

        const kept = summarizeExtractedVolume(payload);
        logger.error(
          `${LOG} Dịch thất bại cho "${file.name}": ${msg.substring(0, 200)}\n` +
          `${LOG} [Q7] GIỮ LẠI kết quả OCR (status = PARTIAL_SUCCESS): ` +
          `${kept.reportsWithData} báo cáo có dữ liệu, ${kept.tableCount} bảng, ${kept.rowCount} dòng, ` +
          `${kept.noteSectionCount} mục thuyết minh, ${kept.pagesCovered} trang. Chỉ thiếu bản dịch.`,
        );

        for (const reportType of REPORT_TYPES) {
          const report = payload[reportType] as TabularReport | NotesReport;
          if (report.status === 'NOT_FOUND') continue;
          report.warnings.push(makeWarning('TRANSLATION_FAILED'));
        }
      }
    } else {
      await beginFinancialReportStage(
        ctx, file, index, 'translate', progressBase + Math.round(progressSpan * 0.7),
        `"${file.name}": bỏ qua dịch theo cấu hình.`,
      );
      logger.info(`${LOG} Bỏ qua bước dịch (enable_translation=false)`);
    }

    // ── Q7: dựng processingInfo + quyết định status cấp file ──────────────
    const failedChunks = [
      ...extractOutcome.tableChunks.filter((c) => c.result === null),
      ...extractOutcome.notesChunks.filter((c) => c.result === null),
    ];
    const notesOutputLimits = summarizeNotesOutputLimits(extractOutcome.notesChunks);
    const tableOutputLimitSuspected = extractOutcome.tableChunks.filter((chunk) => chunk.outputLimitSuspected).length;
    const processingInfo: FileProcessingInfo = {
      totalPages,
      pageSourceMode: source.mode,
      encrypted: source.encrypted,
      reportsFound: foundTypes.length,
      classifyWindowsTotal: classified.classifiedWindows + classified.failedWindows,
      classifyWindowsFailed: classified.failedWindows,
      extractChunksTotal: extractOutcome.tableChunks.length + extractOutcome.notesChunks.length,
      extractChunksFailed: failedChunks.length,
      tablesDiscardedAsOther: payloadBuild.tablesDiscardedAsOther,
      notesTablesFound: payloadBuild.notesTablesFound,
      notesTablesRejected: payloadBuild.notesTablesRejected,
      failedPageRanges: mergePageRanges(failedChunks.map((c) => ({ from: c.pageFrom, to: c.pageTo }))),
      // UAT #04 / T1: giữ dấu vết classify trong response để chẩn đoán Sony không cần đọc log container.
      //
      // Hai trường dưới TRƯỚC ĐÂY bị hardcode 'UNKNOWN'/'OTHER' từ vòng T1 và không được cập nhật
      // khi T5 bổ sung hàm suy thật → chẩn đoán luôn báo UNKNOWN/OTHER kể cả khi lõi phân loại
      // đúng, khiến UAT 2026-08-06 kết luận sai là "phân loại hỏng". Nay suy thật từ tiêu đề.
      //
      // LƯU Ý KHI ĐỌC KẾT QUẢ: đây là kỳ suy ĐƯỢC TỪ TIÊU ĐỀ. Tài liệu ghi kỳ ở tiêu đề CỘT
      // (Sony) thì trường này vẫn là UNKNOWN một cách trung thực. Kỳ có hiệu lực dùng cho R1 nằm ở
      // `report.<type>.tables[].periodScope` — đó mới là trường để nghiệm thu R1.
      classifyLocations: classified.locations.map((location) => ({
        reportType: location.reportType,
        pageFrom: location.pageFrom,
        pageTo: location.pageTo,
        titleSource: location.titleSource,
        periodScope: detectPeriodScope(location.titleSource),
        statementKind: detectStatementKind(location.titleSource),
        consolidation: location.consolidation ?? null,
        fromRecheckPass: location.fromRecheckPass ?? false,
      })),
      unassignedPages: classified.unassignedPages ?? [],
      unassignedPageReasons: classified.unassignedPageReasons ?? [],
      titlesRejectedAsProse: classified.titlesRejectedAsProse,
      pageNumberCorrections: classified.pageNumberCorrections ?? 0,
      pageNumberBasis: 'PDF_INDEX',
      // T7: một chunk có thể chạm trần rồi phục hồi ở lần gọi thứ hai; vì vậy đếm CALL,
      // không chỉ đếm chunk cuối cùng thất bại.
      aiOutputLimitHits: notesOutputLimits.aiOutputLimitHits,
      tableOutputLimitSuspected,
      translateOutputLimitSuspected,
      deterministicChunkFailures: notesOutputLimits.deterministicChunkFailures,
      translationStatus,
      untranslatedItems,
      reportTrace: buildReportTrace(classified, extractOutcome, payload),
      // Lý do THẬT của từng cửa sổ/chunk lỗi. Trước đây chỉ có trong log container nên không
      // phân biệt được "AI quá tải" với "PDF mờ" — hai việc cần cách xử lý khác nhau.
      failureReasons: [
        ...classified.failureReasons,
        ...failedChunks.map((c) => c.failureReason).filter((r): r is string => !!r),
        ...translationFailureReasons,
      ],
    };

    const degraded = resolveDegradation(payload, processingInfo);

    await updateProgress(
      ctx,
      progressBase + Math.round(progressSpan * 0.95),
      `"${file.name}": ${degraded ? 'hoàn tất một phần' : 'hoàn tất'}.`,
    );

    return {
      fileId,
      fileName: file.name,
      status: degraded ? 'PARTIAL_SUCCESS' : 'SUCCESS',
      errorCode: degraded?.errorCode ?? null,
      // errorMessage giữ ĐÚNG câu SRS 6.5, không thêm bớt — đây là câu cho người dùng cuối.
      errorMessage: degraded ? ERROR_MESSAGES[degraded.errorCode] : null,
      // Lý do cụ thể đi riêng: "1/9 chunk bóc tách lỗi (trang 21-22)". Không có nó thì
      // PARTIAL_SUCCESS chỉ hiện "ảnh có thể bị mờ, nghiêng" cho một PDF số sạch.
      diagnostic: degraded ? degraded.reason : null,
      // T13.5: only project after all internal routing, translation, diagnostics, and merge work.
      report: projectOutputPayload(payload, config.outputSuppressedReportTypes),
      processingInfo,
    };
  } catch (error) {
    // A deadline is a parent-workflow failure, not a per-file 207 result.
    if (isWorkflowTimeoutError(error)) throw error;
    // Q7: chỉ vào nhánh này khi KHÔNG CÓ GÌ để trả — preflight fail, classify fail toàn bộ,
    // hoặc file không phải BCTC. Lỗi từng phần đã được xử lý ở trên thành PARTIAL_SUCCESS.
    const errorCode = resolveFileErrorCode(error);
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`${LOG} File "${file.name}" FAILED (${errorCode}): ${detail.substring(0, 300)}`);
    return {
      fileId,
      fileName: file.name,
      status: 'FAILED',
      errorCode,
      errorMessage: ERROR_MESSAGES[errorCode],
      // FAILED thì processingInfo = null nên không còn chỗ nào chở lý do. Đưa vào `diagnostic`
      // để không phải vào container đọc log mới biết nguyên nhân — đúng ca đã gặp:
      // errorCode là ENCRYPTED_PDF_UNSUPPORTED nhưng nguyên nhân thật là image thiếu pdfjs-dist.
      diagnostic: detail.substring(0, 300),
      report: null,
      processingInfo: null,
    };
  }
}

/** Throws the exact parent-workflow failure contract once its elapsed time reaches the configured cap. */
export function assertWorkflowWithinDeadline(startedAt: number, workflowDeadlineMs: number, now: number = Date.now()): void {
  if (now - startedAt >= workflowDeadlineMs) {
    throw new Error(`WORKFLOW_TIMEOUT: exceeded ${workflowDeadlineMs}ms`);
  }
}

export function isWorkflowTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('WORKFLOW_TIMEOUT: exceeded ');
}

async function beginFinancialReportStage(
  ctx: WorkflowContext,
  file: WorkflowFile,
  index: number,
  stage: 'preflight' | 'classify' | 'extract' | 'merge' | 'translate',
  percent: number,
  message: string,
): Promise<void> {
  ctx.currentStep = ctx.stepsResult.length;
  ctx.stepsResult.push({
    step: ctx.currentStep,
    stepName: `File ${index + 1}/${ctx.filesData.length}: ${stage}`,
    processor: stage === 'classify' ? 'ext-classifier' : stage === 'extract' ? 'ext-doc-layout' : stage === 'translate' ? 'ext-translator' : 'workflow',
    content_preview: { file_name: file.name, stage },
  });
  await updateProgress(ctx, percent, message);
}

const LANG_NAME: Record<TargetLang, string> = { vi: 'tiếng Việt', en: 'tiếng Anh' };

/**
 * Build the public payload without mutating the internal payload used by the workflow.
 * Passing an empty set is the reversible, testable switch for restoring comprehensive income.
 */
export function projectOutputPayload(
  payload: InternalFinancialReportPayload,
  suppressedReportTypes: ReadonlySet<ReportType> = OUTPUT_SUPPRESSED_REPORT_TYPES,
): FinancialReportPayload {
  const output: FinancialReportPayload = {
    generalInformation: payload.generalInformation,
  };

  if (!suppressedReportTypes.has('balanceSheet')) output.balanceSheet = payload.balanceSheet;
  if (!suppressedReportTypes.has('incomeStatement')) output.incomeStatement = payload.incomeStatement;
  if (!suppressedReportTypes.has('comprehensiveIncome')) output.comprehensiveIncome = payload.comprehensiveIncome;
  if (!suppressedReportTypes.has('cashFlowStatement')) output.cashFlowStatement = payload.cashFlowStatement;
  if (!suppressedReportTypes.has('equityChangeStatement')) output.equityChangeStatement = payload.equityChangeStatement;
  if (!suppressedReportTypes.has('sgaBreakdown')) output.sgaBreakdown = payload.sgaBreakdown;
  if (!suppressedReportTypes.has('notesToFinancialStatements')) {
    output.notesToFinancialStatements = payload.notesToFinancialStatements;
  }

  return output;
}

/**
 * Q7 — Xác định file có bị suy giảm chất lượng hay không, và mã lỗi ĐẠI DIỆN.
 * Trả null nghĩa là trọn vẹn → status = SUCCESS.
 *
 * Thứ tự ưu tiên mã lỗi: mất dữ liệu OCR nặng hơn mất bản dịch.
 */
export function resolveDegradation(
  payload: InternalFinancialReportPayload,
  info: FileProcessingInfo,
): { errorCode: FinancialReportErrorCode; reason: string } | null {
  const statuses = REPORT_TYPES.map((t) => (payload[t] as TabularReport | NotesReport).status);

  if (statuses.includes('UNREADABLE')) {
    return { errorCode: 'OCR_LOW_CONFIDENCE', reason: 'Có báo cáo không đọc được (UNREADABLE).' };
  }
  // T9: hai hay nhiều trang chưa classify đồng thời thiếu báo cáo cốt lõi không phải là
  // NOT_FOUND đáng tin cậy (Sony). Ưu tiên lỗi cấu trúc này trước lỗi extract lẻ tẻ để
  // caller nhìn đúng nguyên nhân gốc và không dùng kết quả như một báo cáo hoàn chỉnh.
  const missingCoreReports = findMissingCoreReports(payload);
  const unassignedPages = info.unassignedPages ?? [];
  if (missingCoreReports.length > 0 && hasMaterialUnassignedPageCoverage(unassignedPages.length, info.totalPages)) {
    const reason = `Thiếu ${missingCoreReports.join(', ')} trong khi còn ${unassignedPages.length} trang chưa phân loại `
      + `(${unassignedPages.join(', ')}).`;
    // TODO(D12): BA/SRS D13.11 phải chốt mã đại diện cuối cùng. Trong lúc chờ, payload đã
    // có dữ liệu không được tự mâu thuẫn bằng UNRECOGNIZED_REPORT_STRUCTURE; giữ nguyên
    // coverage detector và diagnostic chi tiết, chỉ dùng OCR_LOW_CONFIDENCE làm mã tạm thời.
    return {
      errorCode: statuses.includes('FOUND') ? 'OCR_LOW_CONFIDENCE' : 'UNRECOGNIZED_REPORT_STRUCTURE',
      reason,
    };
  }
  if (info.extractChunksFailed > 0 || info.classifyWindowsFailed > 0) {
    // Reason phải NÊU SỐ và NÊU TRANG. Câu chung "có chunk không xử lý được" cộng với
    // errorMessage mặc định của OCR_LOW_CONFIDENCE ("ảnh có thể bị mờ, nghiêng...") khiến
    // người đọc kết luận sai là tại chất lượng file, trong khi PDF số hoàn toàn sạch và
    // nguyên nhân thật là một lời gọi AI thất bại.
    const parts: string[] = [];
    if (info.extractChunksFailed > 0) {
      const pages = info.failedPageRanges
        .map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`))
        .join(', ');
      parts.push(`${info.extractChunksFailed}/${info.extractChunksTotal} chunk bóc tách lỗi` +
        (pages ? ` (trang ${pages})` : ''));
    }
    if (info.classifyWindowsFailed > 0) {
      parts.push(`${info.classifyWindowsFailed}/${info.classifyWindowsTotal} cửa sổ phân loại lỗi`);
    }
    return { errorCode: 'OCR_LOW_CONFIDENCE', reason: parts.join('; ') };
  }
  if (info.translationStatus === 'FAILED') {
    return { errorCode: 'TRANSLATION_FAILED', reason: 'Bản dịch không có.' };
  }
  if (info.translationStatus === 'PARTIAL') {
    return { errorCode: 'TRANSLATION_PARTIAL', reason: 'Bản dịch thiếu một phần.' };
  }
  // Báo cáo PARTIAL do bản thân tài liệu chỉ có số tổng (A5) KHÔNG coi là suy giảm:
  // đó là đúng nội dung tài liệu, không phải lỗi xử lý.
  return null;
}

/** Đếm số nhãn/đoạn cần dịch — dùng khi bước dịch chết hoàn toàn. */
function translatableItemCount(payload: InternalFinancialReportPayload): number {
  let count = payload.generalInformation.companyName.source ? 1 : 0;
  for (const reportType of REPORT_TYPES) {
    const report = payload[reportType] as TabularReport | NotesReport;
    if (report.status === 'NOT_FOUND') continue;
    if (report.title?.source) count++;
    if (reportType === NOTES_REPORT_TYPE) {
      for (const section of (report as NotesReport).sections) {
        if (section.title.source) count++;
        if (section.sourceText) count++;
      }
      continue;
    }
    for (const table of (report as TabularReport).tables) {
      count += table.columns.filter((c) => c.label.source).length;
      count += table.rows.filter((r) => r.label.source).length;
    }
  }
  return count;
}

// ─── Dựng payload theo contract §4 ───────────────────────────────────────────

/** Export để unit-test được phần dựng payload (pure, không cần WorkflowContext). */
export function buildPayload(
  config: FinancialReportConfig,
  classified: Awaited<ReturnType<typeof classifyDocument>>,
  extractOutcome: Awaited<ReturnType<typeof extractReports>>,
  onDiagnostic?: (message: string) => void,
  totalPages?: number,
): InternalFinancialReportPayload {
  return buildPayloadWithRouting(config, classified, extractOutcome, onDiagnostic, undefined, totalPages).payload;
}

export interface PayloadBuildOutcome {
  payload: InternalFinancialReportPayload;
  tablesDiscardedAsOther: number;
  notesTablesFound: number;
  notesTablesRejected: number;
}

/** Dựng payload cùng số bảng bị loại và quan sát Notes để processingInfo không phải suy lại quyết định routing. */
export function buildPayloadWithRouting(
  config: FinancialReportConfig,
  classified: Awaited<ReturnType<typeof classifyDocument>>,
  extractOutcome: Awaited<ReturnType<typeof extractReports>>,
  onDiagnostic?: (message: string) => void,
  tableRouting: TableContentRoutingOutcome = routeExtractedTables(extractOutcome, onDiagnostic),
  totalPages?: number,
): PayloadBuildOutcome {
  const payload = createEmptyPayload(classified.sourceLanguage, config.targetLang);

  payload.generalInformation.companyName = createEmptyBilingual(classified.companyName);
  payload.generalInformation.fromDate = normalizeDate(classified.fromDate);
  payload.generalInformation.toDate = normalizeDate(classified.toDate);
  payload.generalInformation.currency = normalizeCurrency(classified.currency);
  payload.generalInformation.unit = resolveUnit(classified.unit, config.targetLang);

  const locationsByType = groupLocations(classified.locations);
  // CODE-REVIEW-01 mục 7: report bị cờ debug `report_types` loại bỏ KHÔNG được trông giống
  // NOT_FOUND thật (= tài liệu không có báo cáo đó). Gắn warning EXCLUDED_BY_CONFIG để phân biệt.
  const configuredTypes = config.reportTypes.length > 0 ? new Set<ReportType>(config.reportTypes) : null;
  const isExcluded = (reportType: ReportType) => !!configuredTypes && !configuredTypes.has(reportType);
  const primaryTableChunks = tableRouting.tableChunks.filter((chunk) => chunk.sourceReportType !== NOTES_REPORT_TYPE);
  const primaryStatuses = buildPrimaryReportStatuses(config, classified.locations, primaryTableChunks, isExcluded);
  const notesSafety = selectSafeNotesTableChunks(tableRouting.tableChunks, primaryStatuses);
  const notesTablesFound = extractOutcome.notesChunks.reduce(
    (count, chunk) => count + (chunk.result?.tables?.length ?? 0),
    0,
  );
  const tableChunksForPayload = [...primaryTableChunks, ...notesSafety.acceptedTableChunks];

  for (const reportType of REPORT_TYPES) {
    const excluded = isExcluded(reportType);

    if (reportType === NOTES_REPORT_TYPE) {
      // Thuyết minh KHÔNG áp R3: tiêu đề chuẩn 個別注記表 luôn mang chữ 個別 nhưng đó là tên
      // mặc định của phần thuyết minh, không phải "bộ riêng lẻ" cần loại.
      const noteLocations = locationsByType.get(reportType) ?? [];
      const notes: NotesReport = excluded || noteLocations.length === 0
        ? createNotFoundNotesReport()
        : mergeNotesReport(noteLocations, extractOutcome.notesChunks);
      if (excluded) notes.warnings.push(makeWarning('EXCLUDED_BY_CONFIG'));
      payload.notesToFinancialStatements = notes;
      continue;
    }

    // T3.2 — route từng bảng theo reportType nội dung trước merge. R3 chạy trên chính
    // location nguồn của bảng (đã đổi reportType đích), không làm thay đổi selector R3.
    const routingSelection = selectRoutedLocations(reportType, classified.locations, tableChunksForPayload);
    const selection = routingSelection.selection;
    const chunksToMerge = remapRoutedTableChunkLocationIndex(
      reportType,
      routingSelection.keptSourceLocationIndices,
      tableChunksForPayload,
    );

    const report = excluded || selection.kept.length === 0
      ? createNotFoundTabularReport()
      : mergeTabularReport(reportType, selection.kept, chunksToMerge, config.targetLang);

    if (excluded) {
      report.warnings.push(makeWarning('EXCLUDED_BY_CONFIG'));
    } else {
      addTableReassignmentWarnings(report, chunksToMerge);
      if (notesSafety.acceptedReportTypes.has(reportType)) {
        report.warnings.push(makeWarning('TABLE_FROM_NOTES_REGION'));
      }
      if (notesSafety.ignoredReportTypes.has(reportType)) {
        report.warnings.push(makeWarning('TABLE_FROM_NOTES_REGION_IGNORED'));
      }
      if (report.status !== 'NOT_FOUND') {
        if (selection.droppedSeparate.length > 0) {
          // R3: bộ riêng lẻ bị loại phải truy được trong chẩn đoán, không bỏ im lặng.
          const droppedRanges = selection.droppedSeparate
            .map((loc) => (loc.pageFrom === loc.pageTo ? `${loc.pageFrom}` : `${loc.pageFrom}-${loc.pageTo}`))
            .join(', ');
          report.warnings.push(makeWarning('SEPARATE_SET_EXCLUDED', `Bộ riêng lẻ bị loại ở trang ${droppedRanges}.`));
          onDiagnostic?.(`[R3] ${reportType}: loại bộ riêng lẻ (trang ${droppedRanges}), giữ bộ hợp nhất.`);
        } else if (selection.onlySeparate) {
          // R3 biên: chỉ có bộ riêng lẻ → giữ, nhưng đánh dấu rõ để không nhầm là hợp nhất.
          report.warnings.push(makeWarning('SEPARATE_ONLY_KEPT'));
          onDiagnostic?.(`[R3] ${reportType}: tài liệu chỉ có bộ riêng lẻ, đã giữ và đánh dấu là số riêng lẻ.`);
        }
      } else if (selection.kept.length > 0) {
        // Instrumentation #3 — báo cáo ĐƯỢC ĐỊNH VỊ nhưng ra NOT_FOUND. Phơi số chunk extract đã tới
        // merge để lần chạy sau phân định "extraction trả rỗng" với "chunk không tới merge".
        const chunkCount = chunksToMerge.length;
        const locPages = selection.kept
          .map((loc) => (loc.pageFrom === loc.pageTo ? `${loc.pageFrom}` : `${loc.pageFrom}-${loc.pageTo}`))
          .join(', ');
        report.warnings.push(makeWarning(
          'REPORT_LOCATED_BUT_NO_DATA',
          `Định vị ở trang ${locPages} nhưng không bóc được dòng nào. Số chunk extract tới merge: ${chunkCount} `
            + `(>0 = extraction trả rỗng; 0 = chunk không tới merge).`,
        ));
        onDiagnostic?.(`[#3] ${reportType}: located (trang ${locPages}) nhưng NOT_FOUND; extract chunks tới merge=${chunkCount}.`);
      }
    }

    assignTabularReport(payload, reportType, report);
  }

  // T9: Trang bìa/mục lục/báo cáo kiểm toán không có bảng số liệu là bình thường. Chỉ
  // nâng thành warning khi coverage chưa gán vượt ngưỡng, còn dưới ngưỡng ghi INFO nội bộ.
  const missingCoreReports = findMissingCoreReports(payload);
  const unassignedPages = classified.unassignedPages ?? [];
  if (missingCoreReports.length > 0 && unassignedPages.length > 0) {
    const detail = `Thiếu ${missingCoreReports.join(', ')}; còn ${unassignedPages.length} trang chưa gán `
      + `(${unassignedPages.join(', ')}).`;
    if (hasMaterialUnassignedPageCoverage(unassignedPages.length, totalPages)) {
      for (const reportType of missingCoreReports) {
        (payload[reportType] as TabularReport).warnings.push(
          makeWarning('REPORT_MISSING_WITH_UNASSIGNED_PAGES', detail),
        );
      }
    } else {
      onDiagnostic?.(`[INFO] Coverage chưa gán ${unassignedPages.length}/${totalPages ?? '?'} trang (${detail})`);
    }
  }

  promoteComprehensiveIncomeWhenIncomeMissing(payload, onDiagnostic);

  // UAT #01 / I2: tài liệu không có bảng chi tiết SG&A nhưng Báo cáo KQKD có dòng tổng
  // → dựng sgaBreakdown chỉ-có-tổng bằng CODE (không gọi thêm AI, giữ đủ mọi kỳ).
  // Phải chạy TRƯỚC vòng kiểm đơn vị bên dưới để báo cáo suy ra cũng được kiểm đơn vị.
  const sgaFallback = applySgaFallback(payload);
  onDiagnostic?.(
    sgaFallback.kind === 'derived'
      ? `[I2] sgaBreakdown suy từ Báo cáo KQKD: "${sgaFallback.label}" (trang ${sgaFallback.sourcePage ?? '?'}), `
        + `kỳ: ${sgaFallback.periods.join(', ') || 'không xác định'}`
      : `[I2] KHÔNG suy sgaBreakdown từ Báo cáo KQKD: ${sgaFallback.reason}`,
  );

  // Q10/T8: đơn vị hiệu lực của MỖI bảng = table.unit → report.unit → unit chung của file.
  // Chỉ cảnh báo khi một bảng thực sự không suy được multiplier sau đủ ba tầng fallback.
  for (const reportType of REPORT_TYPES) {
    if (reportType === NOTES_REPORT_TYPE) continue;
    const report = payload[reportType] as TabularReport;
    if (report.status === 'NOT_FOUND') continue;
    const unresolvedTables = report.tables.filter((table) =>
      (table.unit?.multiplier ?? report.unit?.multiplier ?? payload.generalInformation.unit.multiplier) == null,
    );
    if (unresolvedTables.length > 0) {
      report.warnings.push(makeWarning(
        'UNIT_NOT_FOUND',
        `Không xác định được đơn vị hiệu lực cho ${unresolvedTables.map((table) => table.tableId).join(', ')}.`,
      ));
    }
  }

  return {
    payload,
    tablesDiscardedAsOther: tableRouting.tablesDiscardedAsOther + notesSafety.tablesDiscardedAsOther,
    notesTablesFound,
    notesTablesRejected: notesSafety.notesTablesRejected,
  };
}

function promoteComprehensiveIncomeWhenIncomeMissing(
  payload: InternalFinancialReportPayload,
  onDiagnostic?: (message: string) => void,
): void {
  const comprehensiveIncome = payload.comprehensiveIncome;
  if (
    payload.incomeStatement.status !== 'NOT_FOUND'
    || !['FOUND', 'PARTIAL'].includes(comprehensiveIncome.status)
    || comprehensiveIncome.tables.length === 0
  ) {
    return;
  }

  // IFRS có thể gộp P&L và OCI vào một bảng; chỉ dùng bảng gộp khi không có P&L riêng.
  payload.incomeStatement = comprehensiveIncome;
  payload.incomeStatement.warnings.push(makeWarning('INCOME_FROM_COMPREHENSIVE_INCOME'));
  payload.comprehensiveIncome = createNotFoundTabularReport();
  onDiagnostic?.('[IFRS] incomeStatement dùng nguyên bảng comprehensiveIncome vì không có 損益計算書 riêng.');
}

function assignTabularReport(payload: InternalFinancialReportPayload, reportType: ReportType, report: TabularReport): void {
  switch (reportType) {
    case 'balanceSheet': payload.balanceSheet = report; break;
    case 'incomeStatement': payload.incomeStatement = report; break;
    case 'comprehensiveIncome': payload.comprehensiveIncome = report; break;
    case 'cashFlowStatement': payload.cashFlowStatement = report; break;
    case 'equityChangeStatement': payload.equityChangeStatement = report; break;
    case 'sgaBreakdown': payload.sgaBreakdown = report; break;
    default: break; // notes xử lý riêng
  }
}

/**
 * T3.3 + T13.3 — giữ provenance Notes nhưng route từng bảng theo metadata/tiêu đề.
 * Khi AI không khai một reportType hợp lệ, chỉ bảng Notes mới được phép suy lại từ title;
 * bảng primary tiếp tục dùng fallback classify cũ.
 */
export function routeExtractedTables(
  extractOutcome: ExtractOutcome,
  onDiagnostic?: (message: string) => void,
): TableContentRoutingOutcome {
  for (const chunk of extractOutcome.notesChunks) {
    for (const table of chunk.result?.tables ?? []) {
      const declaredReportType = typeof table.reportType === 'string' ? table.reportType : 'null';
      const targetReportType = resolveNotesTableReportType(table.reportType, table.tableTitle ?? null);
      const strongAlias = targetReportType !== 'OTHER' && targetReportType !== NOTES_REPORT_TYPE
        ? matchesAliasStrongly(table.tableTitle ?? null, targetReportType)
        : false;
      onDiagnostic?.(
        `[T12.4] Notes table tableTitle=${JSON.stringify(table.tableTitle ?? null)} `
          + `reportType=${declaredReportType} strongAlias=${strongAlias}`,
      );
    }
  }

  const noteTableChunks: TableChunkOutcome[] = extractOutcome.notesChunks.map((chunk) => ({
    reportType: NOTES_REPORT_TYPE,
    locationIndex: chunk.locationIndex,
    chunkIndex: chunk.chunkIndex,
    pageFrom: chunk.pageFrom,
    pageTo: chunk.pageTo,
    result: chunk.result === null
      ? null
      : {
          reportType: NOTES_REPORT_TYPE,
          titleSource: chunk.result.titleSource,
          notFound: chunk.result.notFound,
          warnings: chunk.result.warnings,
          tables: chunk.result.tables,
        },
    aiWarnings: chunk.aiWarnings,
    failureReason: chunk.failureReason,
    deterministicFailure: chunk.deterministicFailure,
  }));
  return routeTableChunksByContent([...extractOutcome.tableChunks, ...noteTableChunks]);
}

/**
 * T3.2 — một TableChunkOutcome ban đầu đại diện cho classify location; kết quả extract có thể
 * chứa nhiều bảng thuộc reportType khác nhau. Tách từng bảng thành chunk đích, nhưng giữ trọn
 * provenance location/trang nguồn để R1/R3/R4 vẫn chạy trong merge hiện có.
 */
export interface RoutedTableChunk extends TableChunkOutcome {
  /** Loại classify của location sinh bảng, dùng cho cảnh báo reassignment. */
  sourceReportType: ReportType;
  /** Chỉ số location TOÀN CỤC trong classified.locations. */
  sourceLocationIndex: number;
  /** Dải trang extract sinh bảng, không phải dải location đã classify. */
  sourcePageFrom: number;
  sourcePageTo: number;
}

export interface TableContentRoutingOutcome {
  tableChunks: RoutedTableChunk[];
  tablesDiscardedAsOther: number;
}

function resolveRoutedTableReportType(rawReportType: unknown, fallback: ReportType): ReportType | 'OTHER' {
  if (rawReportType === 'OTHER') return 'OTHER';
  if (typeof rawReportType === 'string' && REPORT_TYPES.some((reportType) => reportType === rawReportType)) {
    return rawReportType as ReportType;
  }
  return fallback;
}

/** T13.3 — chỉ fallback Notes vì AI không khai loại mới được suy từ tableTitle bằng alias mạnh. */
function resolveNotesTableReportType(rawReportType: unknown, tableTitle: string | null): ReportType | 'OTHER' {
  const resolved = resolveRoutedTableReportType(rawReportType, NOTES_REPORT_TYPE);
  if (resolved !== NOTES_REPORT_TYPE || rawReportType === NOTES_REPORT_TYPE) return resolved;
  return REPORT_TYPES.find(
    (reportType) => reportType !== NOTES_REPORT_TYPE && matchesAliasStrongly(tableTitle, reportType),
  ) ?? NOTES_REPORT_TYPE;
}

function toRoutedTableChunk(
  source: TableChunkOutcome,
  reportType: ReportType,
  result: TableChunkOutcome['result'],
): RoutedTableChunk {
  return {
    ...source,
    reportType,
    sourceReportType: source.reportType,
    sourceLocationIndex: source.locationIndex,
    sourcePageFrom: source.pageFrom,
    sourcePageTo: source.pageTo,
    result,
  };
}

/**
 * Route bảng theo `table.reportType`. Chunk null/rỗng vẫn đi theo classify type để giữ nguyên
 * trạng thái UNREADABLE/NOT_FOUND và instrumentation cũ. `OTHER` bị bỏ đếm một lần mỗi bảng,
 * không sinh warning theo hợp đồng T3.2.
 */
export function routeTableChunksByContent(chunks: TableChunkOutcome[]): TableContentRoutingOutcome {
  const tableChunks: RoutedTableChunk[] = [];
  let tablesDiscardedAsOther = 0;

  for (const chunk of chunks) {
    const tables = chunk.result?.tables ?? [];
    if (chunk.result === null || tables.length === 0) {
      tableChunks.push(toRoutedTableChunk(chunk, chunk.reportType, chunk.result));
      continue;
    }

    for (const table of tables) {
      const targetReportType = chunk.reportType === NOTES_REPORT_TYPE
        ? resolveNotesTableReportType(table.reportType, table.tableTitle ?? null)
        : resolveRoutedTableReportType(table.reportType, chunk.reportType);
      if (targetReportType === 'OTHER') {
        tablesDiscardedAsOther++;
        continue;
      }
      tableChunks.push(toRoutedTableChunk(chunk, targetReportType, {
        ...chunk.result,
        reportType: targetReportType,
        notFound: false,
        tables: [table],
      }));
    }
  }

  return { tableChunks, tablesDiscardedAsOther };
}

interface RoutedSourceLocation extends ReportLocation {
  sourceLocationIndex: number;
}

interface RoutedLocationSelection {
  selection: ReportLocationSelection;
  keptSourceLocationIndices: number[];
}

/**
 * R3 phải quyết định trên source location của bảng đã route, thay vì chỉ trên type classify cũ.
 * Các location cùng type đích nhưng chưa có table vẫn được giữ để không làm mất hành vi R3 và
 * diagnostic NOT_FOUND trước đây; mọi location khác chỉ làm ngữ cảnh phát hiện bộ riêng lẻ.
 */
function selectRoutedLocations(
  reportType: ReportType,
  allLocations: ReportLocation[],
  chunks: RoutedTableChunk[],
): RoutedLocationSelection {
  const sourceLocationIndices = new Set<number>();
  allLocations.forEach((location, index) => {
    if (location.reportType === reportType) sourceLocationIndices.add(index);
  });
  for (const chunk of chunks) {
    if (chunk.reportType === reportType && allLocations[chunk.sourceLocationIndex]) {
      sourceLocationIndices.add(chunk.sourceLocationIndex);
    }
  }

  const routedLocations: RoutedSourceLocation[] = [...sourceLocationIndices]
    .sort((a, b) => a - b)
    .map((sourceLocationIndex) => ({
      ...allLocations[sourceLocationIndex],
      reportType,
      sourceLocationIndex,
    }));
  const r3Inputs: ReportLocation[] = [
    ...allLocations.filter((location) => location.reportType !== reportType),
    ...routedLocations,
  ];
  const selection = selectConsolidatedLocations(reportType, r3Inputs);

  return {
    selection,
    keptSourceLocationIndices: selection.kept.map((location) =>
      (location as RoutedSourceLocation).sourceLocationIndex,
    ),
  };
}

/** Đổi source location index toàn cục sang location index cục bộ của merge đích. */
function remapRoutedTableChunkLocationIndex(
  reportType: ReportType,
  keptSourceLocationIndices: number[],
  chunks: RoutedTableChunk[],
): RoutedTableChunk[] {
  const sourceToLocal = new Map<number, number>();
  keptSourceLocationIndices.forEach((sourceLocationIndex, localIndex) => {
    sourceToLocal.set(sourceLocationIndex, localIndex);
  });

  return chunks
    .filter((chunk) => chunk.reportType === reportType && sourceToLocal.has(chunk.sourceLocationIndex))
    .map((chunk) => ({ ...chunk, locationIndex: sourceToLocal.get(chunk.sourceLocationIndex)! }));
}

/** Cảnh báo chỉ nằm ở report đích và giữ nguyên wording T3.2 đã chốt. */
function addTableReassignmentWarnings(report: TabularReport, chunks: RoutedTableChunk[]): void {
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.sourceReportType === chunk.reportType) continue;
    const message = `Bảng từ trang ${chunk.sourcePageFrom}-${chunk.sourcePageTo} `
      + `(classify: ${chunk.sourceReportType}) được nhận vào ${chunk.reportType} theo nội dung.`;
    if (seen.has(message)) continue;
    seen.add(message);
    report.warnings.push({ code: 'TABLE_REASSIGNED_BY_CONTENT', message });
  }
}

function normalizeAliasText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/g, '');
}

function normalizeTableTitleForAlias(value: string): string {
  let normalized = normalizeAliasText(value).replace(/^(?:(?:\(\d+\)|\d+[.)]))+/, '');
  let removedPrefix = true;
  while (removedPrefix) {
    removedPrefix = false;
    for (const prefix of TITLE_PREFIXES_TO_IGNORE) {
      const normalizedPrefix = normalizeAliasText(prefix);
      if (normalizedPrefix && normalized.startsWith(normalizedPrefix)) {
        normalized = normalized.slice(normalizedPrefix.length);
        removedPrefix = true;
        break;
      }
    }
  }
  return normalized;
}

/** T3.4 — chỉ nhận tiêu đề Notes chứa trọn alias chuẩn đã normalize, không suy diễn từ từ khóa lẻ. */
export function matchesAliasStrongly(tableTitle: string | null, reportType: ReportType): boolean {
  if (!tableTitle) return false;
  const normalizedTitle = normalizeTableTitleForAlias(tableTitle);
  return [...REPORT_ALIASES[reportType].ja, ...REPORT_ALIASES[reportType].en]
    .map(normalizeAliasText)
    .filter((alias) => alias.length >= 4)
    .some((alias) => normalizedTitle.includes(alias));
}

interface NotesTableSafetyOutcome {
  acceptedTableChunks: RoutedTableChunk[];
  acceptedReportTypes: Set<ReportType>;
  ignoredReportTypes: Set<ReportType>;
  tablesDiscardedAsOther: number;
  /** Round 12 / T12.4 — subset of Notes tables rejected because the alias match was not strong. */
  notesTablesRejected: number;
}

function buildPrimaryReportStatuses(
  config: FinancialReportConfig,
  locations: ReportLocation[],
  primaryTableChunks: RoutedTableChunk[],
  isExcluded: (reportType: ReportType) => boolean,
): Map<ReportType, ReportStatus> {
  const statuses = new Map<ReportType, ReportStatus>();
  for (const reportType of REPORT_TYPES) {
    if (reportType === NOTES_REPORT_TYPE || isExcluded(reportType)) continue;
    const routingSelection = selectRoutedLocations(reportType, locations, primaryTableChunks);
    const chunksToMerge = remapRoutedTableChunkLocationIndex(
      reportType,
      routingSelection.keptSourceLocationIndices,
      primaryTableChunks,
    );
    const report = routingSelection.selection.kept.length === 0
      ? createNotFoundTabularReport()
      : mergeTabularReport(reportType, routingSelection.selection.kept, chunksToMerge, config.targetLang);
    statuses.set(reportType, report.status);
  }
  return statuses;
}

function selectSafeNotesTableChunks(
  allTableChunks: RoutedTableChunk[],
  primaryStatuses: Map<ReportType, ReportStatus>,
): NotesTableSafetyOutcome {
  const acceptedTableChunks: RoutedTableChunk[] = [];
  const acceptedReportTypes = new Set<ReportType>();
  const ignoredReportTypes = new Set<ReportType>();
  let tablesDiscardedAsOther = 0;

  for (const chunk of allTableChunks) {
    if (chunk.sourceReportType !== NOTES_REPORT_TYPE) continue;
    const tableTitle = chunk.result?.tables?.[0]?.tableTitle ?? null;
    if (chunk.reportType === NOTES_REPORT_TYPE) {
      // T13.3: AI không khai loại hoặc chỉ khớp yếu title phải hiện trong số rejected,
      // thay vì bị continue im lặng. Một bảng khai rõ NOTES vẫn là văn bản Notes bình thường.
      if (chunk.result?.tables?.[0]?.reportType !== NOTES_REPORT_TYPE) tablesDiscardedAsOther++;
      continue;
    }
    if (!matchesAliasStrongly(tableTitle, chunk.reportType)) {
      tablesDiscardedAsOther++;
      continue;
    }
    if (primaryStatuses.get(chunk.reportType) === 'FOUND') {
      ignoredReportTypes.add(chunk.reportType);
      continue;
    }
    acceptedTableChunks.push(chunk);
    acceptedReportTypes.add(chunk.reportType);
  }

  return {
    acceptedTableChunks,
    acceptedReportTypes,
    ignoredReportTypes,
    tablesDiscardedAsOther,
    notesTablesRejected: tablesDiscardedAsOther,
  };
}

/** Kết quả chọn location theo R3 (hợp nhất / riêng lẻ) cho một loại báo cáo. */
export interface ReportLocationSelection {
  /** Location được giữ, theo thứ tự xuất hiện. */
  kept: ReportLocation[];
  /** Chỉ số TOÀN CỤC (trong classified.locations) của các location được giữ. */
  keptGlobalIndices: number[];
  /** Location bộ riêng lẻ bị loại vì có bộ hợp nhất. */
  droppedSeparate: ReportLocation[];
  /** true khi tài liệu CHỈ có bộ riêng lẻ (không có hợp nhất). */
  onlySeparate: boolean;
}

/**
 * R3 — Chọn location cho một loại báo cáo dạng bảng:
 *   - Có CẢ bộ hợp nhất (連結/consolidated) và riêng lẻ (個別/単体/separate) → CHỈ giữ hợp nhất,
 *     loại bộ riêng lẻ. Location không xác định được consolidation vẫn GIỮ (không đủ căn cứ để
 *     loại — ưu tiên không mất dữ liệu).
 *   - CHỈ có bộ riêng lẻ → giữ nguyên, đánh dấu `onlySeparate` để đầu ra ghi rõ là số riêng lẻ.
 *   - Không có xung đột → giữ tất cả.
 */
export function selectConsolidatedLocations(
  reportType: ReportType,
  allLocations: ReportLocation[],
): ReportLocationSelection {
  const entries = allLocations
    .map((location, globalIndex) => ({ location, globalIndex }))
    .filter((entry) => entry.location.reportType === reportType);

  const hasConsolidated = entries.some((entry) => entry.location.consolidation === 'CONSOLIDATED');
  const hasSeparate = entries.some((entry) => entry.location.consolidation === 'SEPARATE');

  if (hasConsolidated && hasSeparate) {
    const kept = entries.filter((entry) => entry.location.consolidation !== 'SEPARATE');
    const dropped = entries.filter((entry) => entry.location.consolidation === 'SEPARATE');
    return {
      kept: kept.map((entry) => entry.location),
      keptGlobalIndices: kept.map((entry) => entry.globalIndex),
      droppedSeparate: dropped.map((entry) => entry.location),
      onlySeparate: false,
    };
  }

  // R3 (bổ sung sau UAT Meidensha 2026-08-07) — bộ RIÊNG LẺ của 決算短信 J-GAAP được in với tiêu đề
  // TRẦN (「貸借対照表」, không có 「個別」); chữ 「個別」 chỉ nằm ở TIÊU ĐỀ MỤC (「４．個別財務諸表」)
  // và ở notes (「個別財務諸表に関する注記」). Vì vậy các bảng riêng lẻ ra consolidation = null và
  // R3 theo tiêu đề bảng KHÔNG loại được chúng.
  //
  // Suy diễn XÁC ĐỊNH, KHÔNG đổi prompt/không đoán theo thứ tự trang:
  //   - Tài liệu có mục riêng lẻ hay không được chứng minh bằng một location SEPARATE BẤT KỲ
  //     (kể cả notes 「個別…注記」) — tín hiệu này detectConsolidation ĐÃ bắt đúng sẵn.
  //   - CHỈ khi loại báo cáo này CÓ bảng hợp nhất rõ ràng (giữ được bản đúng) VÀ tài liệu có mục
  //     riêng lẻ, thì bảng tiêu đề trần (null) mới bị coi là bản riêng lẻ và loại.
  //   - Chỉ toàn null (không có sibling hợp nhất) → GIỮ hết: có thể là công ty chỉ có báo cáo
  //     riêng lẻ (không lập hợp nhất) — không được loại nhầm dữ liệu hợp lệ duy nhất.
  const documentHasSeparateSection = allLocations.some((location) => location.consolidation === 'SEPARATE');
  if (hasConsolidated && documentHasSeparateSection && entries.some((entry) => entry.location.consolidation == null)) {
    const kept = entries.filter((entry) => entry.location.consolidation === 'CONSOLIDATED');
    const dropped = entries.filter((entry) => entry.location.consolidation == null);
    return {
      kept: kept.map((entry) => entry.location),
      keptGlobalIndices: kept.map((entry) => entry.globalIndex),
      droppedSeparate: dropped.map((entry) => entry.location),
      onlySeparate: false,
    };
  }

  return {
    kept: entries.map((entry) => entry.location),
    keptGlobalIndices: entries.map((entry) => entry.globalIndex),
    droppedSeparate: [],
    onlySeparate: hasSeparate && !hasConsolidated,
  };
}

function groupLocations(locations: ReportLocation[]): Map<ReportType, ReportLocation[]> {
  const map = new Map<ReportType, ReportLocation[]>();
  for (const location of locations) {
    const list = map.get(location.reportType);
    if (list) list.push(location);
    else map.set(location.reportType, [location]);
  }
  return map;
}

export function buildReportTrace(
  classified: Awaited<ReturnType<typeof classifyDocument>>,
  extractOutcome: Awaited<ReturnType<typeof extractReports>>,
  payload: InternalFinancialReportPayload,
): ReportExtractionTrace[] {
  const tabularReportTypes = REPORT_TYPES.filter((reportType) => reportType !== NOTES_REPORT_TYPE);
  const ruleCodes = new Set(['MULTIPLE_VARIANTS_MERGED', 'SEPARATE_SET_EXCLUDED']);

  return tabularReportTypes.map((reportType) => {
    const locations = classified.locations.filter((location) => location.reportType === reportType);
    const chunks = extractOutcome.tableChunks.filter((chunk) => chunk.reportType === reportType);
    let rawTables = 0;
    let rawRows = 0;

    for (const chunk of chunks) {
      for (const table of chunk.result?.tables ?? []) {
        rawTables += 1;
        rawRows += (table.rows ?? []).length;
      }
    }

    const report = payload[reportType] as TabularReport;
    const keptRows = (report.tables ?? []).reduce((sum, table) => sum + (table.rows?.length ?? 0), 0);

    return {
      reportType,
      locatedCount: locations.length,
      locatedPages: locations.map((location) => ({ from: location.pageFrom, to: location.pageTo })),
      chunksTotal: chunks.length,
      chunksWithResult: chunks.filter((chunk) => chunk.result != null).length,
      chunksNotFound: chunks.filter((chunk) => chunk.result?.notFound === true).length,
      rawTables,
      rawRows,
      keptRows,
      finalStatus: report.status,
      droppedByRule: (report.warnings ?? []).some((warning) => ruleCodes.has(warning.code)),
    };
  });
}

function findMissingCoreReports(payload: InternalFinancialReportPayload): ReportType[] {
  return CORE_REPORT_TYPES.filter((reportType) => {
    const report = payload[reportType] as TabularReport;
    // Report bị loại bởi report_types không phải thiếu thật, nên không được làm coverage gate đỏ.
    return report.status === 'NOT_FOUND' && !report.warnings.some((warning) => warning.code === 'EXCLUDED_BY_CONFIG');
  });
}

function hasMaterialUnassignedPageCoverage(unassignedPageCount: number, totalPages?: number): boolean {
  return unassignedPageCount > 0 && (totalPages == null || totalPages <= 0
    || unassignedPageCount / totalPages > UNASSIGNED_PAGE_WARNING_RATIO);
}

/** Build per-file failures without introducing a new public errorCode for deadline expiry. */
export function buildWorkflowTimeoutFileResults(
  files: readonly Pick<WorkflowFile, 'name'>[],
  startIndex: number,
): FileResult[] {
  return files.slice(startIndex).map((file, offset) => ({
    fileId: `GRP-${startIndex + offset + 1}`,
    fileName: file.name,
    status: 'FAILED' as const,
    errorCode: null,
    errorMessage: null,
    diagnostic: WORKFLOW_TIMEOUT_FILE_DIAGNOSTIC,
    report: null,
    processingInfo: null,
  }));
}

// ─── Envelope SRS ─────────────────────────────────────────────────────────────

export function buildEnvelope(config: FinancialReportConfig, results: FileResult[]): FinancialReportEnvelope {
  const total = results.length;
  const fullCount = results.filter((r) => r.status === 'SUCCESS').length;
  const partialCount = results.filter((r) => r.status === 'PARTIAL_SUCCESS').length;
  const failedCount = results.filter((r) => r.status === 'FAILED').length;
  /** "Hoàn tất" = có kết quả trả về, kể cả thiếu một phần (Q7). */
  const processedCount = fullCount + partialCount;

  let code = 200;
  let message = 'Thành công';

  if (processedCount === 0) {
    // Q8 (BA đã chốt: giữ 207, chỉ sửa message): không file nào có kết quả.
    code = 207;
    message = 'Không xử lý được file nào.';
  } else if (failedCount > 0 || partialCount > 0) {
    // Wording theo mẫu 207 của SRS để BLOS chỉ parse một dạng.
    // Dùng processedCount (SUCCESS + PARTIAL_SUCCESS), KHÔNG dùng fullCount: file
    // PARTIAL_SUCCESS vẫn CÓ dữ liệu trả về nên phải tính là đã hoàn tất, đúng định nghĩa Q7
    // ngay phía trên. Trước đây dùng fullCount nên 1 file PARTIAL_SUCCESS bị báo
    // "Xử lý hoàn tất 0/1 file" — tự mâu thuẫn với chính data.status.
    code = 207;
    message = `Xử lý hoàn tất ${processedCount}/${total} file. Xem chi tiết lỗi trong từng phần tử của data.`;
  }

  return {
    requestId: config.requestId,
    code,
    message,
    timestamp: toIsoWithOffset(new Date()),
    targetLang: config.targetLang,
    data: results,
  };
}

/** ISO 8601 kèm offset +07:00 theo mẫu SRS (2026-07-08T10:17:03+07:00). */
export function toIsoWithOffset(date: Date, offsetHours = 7): string {
  const shifted = new Date(date.getTime() + offsetHours * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = offsetHours >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetHours);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(absOffset))}:${pad(Math.round((absOffset % 1) * 60))}`
  );
}

/**
 * Đếm khối lượng đã bóc được, chỉ để LOG mức thiệt hại khi dịch fail (mục 4 / Q7).
 * Không log nội dung BCTC (§23) — chỉ đếm số lượng.
 */
export function summarizeExtractedVolume(payload: InternalFinancialReportPayload): {
  reportsWithData: number;
  tableCount: number;
  rowCount: number;
  noteSectionCount: number;
  pagesCovered: number;
} {
  let reportsWithData = 0;
  let tableCount = 0;
  let rowCount = 0;
  let noteSectionCount = 0;
  const pages = new Set<number>();

  for (const reportType of REPORT_TYPES) {
    const report = payload[reportType] as TabularReport | NotesReport;
    for (const range of report.pageRanges) {
      for (let page = range.from; page <= range.to; page++) pages.add(page);
    }

    if (reportType === NOTES_REPORT_TYPE) {
      const notes = report as NotesReport;
      noteSectionCount += notes.sections.length;
      if (notes.sections.length > 0) reportsWithData++;
      continue;
    }

    const tabular = report as TabularReport;
    tableCount += tabular.tables.length;
    const rows = tabular.tables.reduce((sum, t) => sum + t.rows.length, 0);
    rowCount += rows;
    if (rows > 0) reportsWithData++;
  }

  return { reportsWithData, tableCount, rowCount, noteSectionCount, pagesCovered: pages.size };
}

export function summarizeReportStatuses(payload: FinancialReportPayload): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const reportType of REPORT_TYPES) {
    // T13.5: comprehensiveIncome (và mọi loại trong OUTPUT_SUPPRESSED_REPORT_TYPES) đã bị GỠ khỏi
    // payload ĐẦU RA. Hàm này được gọi ở cấp run() trên `fileResult.report` (payload đã chiếu), nên
    // key có thể không tồn tại. Bỏ qua an toàn thay vì đọc `.status` trên undefined (nếu không sẽ
    // ném "Cannot read properties of undefined (reading 'status')" → WORKFLOW_ERROR uncaught).
    const report = payload[reportType] as TabularReport | NotesReport | undefined;
    if (!report) continue;
    summary[reportType] = report.status;
  }
  return summary;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function isPdf(file: WorkflowFile): boolean {
  const name = (file.name || '').toLowerCase();
  const ext = name.slice(name.lastIndexOf('.'));
  return PDF_EXTENSIONS.includes(ext) || (file.mime || '').toLowerCase() === 'application/pdf';
}

function resolveFileErrorCode(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.startsWith('UNSUPPORTED_DOCUMENT_EXT')) return 'UNSUPPORTED_DOCUMENT' as const;
  return resolveErrorCode(error);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function nonNegativeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Profile UI gửi chuỗi trống cho param chưa đặt; khác với key hoàn toàn không tồn tại. */
function isBlankProfileValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '';
}

/** Số thực trong khoảng [min, max]; ngoài khoảng hoặc không phải số → fallback. */
function boundedFloat(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  return !(text === 'false' || text === '0' || text === 'no' || text === '');
}

function parseReportTypes(value: unknown): ReportType[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const allowed = new Set<string>(REPORT_TYPES);
  return raw
    .map((v) => String(v).trim())
    .filter((v) => allowed.has(v)) as ReportType[];
}

/** Undefined retains the CI-default; an explicit blank Profile value restores CI to the response. */
export function parseOutputSuppressedReportTypes(value: unknown): ReadonlySet<ReportType> {
  if (value === undefined || value === null) return new Set(OUTPUT_SUPPRESSED_REPORT_TYPES);
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const allowed = new Set<string>(REPORT_TYPES);
  return new Set(raw
    .map((entry) => String(entry).trim())
    .filter((entry): entry is ReportType => allowed.has(entry)));
}
