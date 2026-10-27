// lib/pipelines/workflows/financial-report/extract.ts
// Step 2 — Extract: OCR + bóc bảng theo từng report / chunk trang.
// AI CHỈ trả labelSource + giá trị dạng string. Parse số do code làm (§13.3).
//
// Cấu trúc song song (CODE-REVIEW-01 mục 1 + 6):
//   - Mỗi ReportLocation là 1 NHÓM. Các nhóm chạy SONG SONG qua semaphore (max_concurrency).
//   - Các chunk TRONG CÙNG một nhóm chạy TUẦN TỰ, vì chunk sau cần columns[].id của
//     chunk trước làm `knownColumnIds` để bảng bị cắt qua trang nối lại được (§17).
//   - Không bao giờ gửi cả file dài trong 1 lần gọi AI: luôn chunk theo pages_per_chunk.

import { type WorkflowContext, enqueueSubStep, parseDeep } from '@/lib/pipelines/workflow-engine';
import { buildExtractPrompt, buildNotesExtractPrompt } from '../prompts/financial-report-prompts';
import {
  NOTES_REPORT_TYPE,
  REPORT_TYPES,
  type ExtractChunkResult,
  type ExtractedTable,
  type ExtractedTableReportType,
  type ExtractNotesChunkResult,
  type FinancialReportConfig,
  type ReportType,
} from './types';
import type { ReportLocation } from './classify';
import { runWithConcurrency, sleep } from './concurrency';
import { chunkPageRange, prepareChunkAssets, type PageSource } from './pdf-utils';

const LOG = '[FINANCIAL-REPORT]';

/**
 * Số trang đệm thêm MỖI PHÍA khi gửi trang cho extract, để bù sai số ±1 trang của classify.
 * 1 là mức tối thiểu bù đủ sai số đã đo trên JFE. Tăng lên 2 chỉ khi thấy vẫn hụt (tốn token hơn).
 */
const DEFAULT_EXTRACT_PAGE_MARGIN = 1;
const EXTRACT_CONNECTOR = 'ext-doc-layout';

/** Lý do thất bại đã cắt ngắn, để đưa lên `processingInfo.failureReasons`. */
const REASON_MAX = 160;

/** UAT #04 / T7 — phản hồi Notes chạm giới hạn token thường dài bất thường hoặc lặp ký tự vô nghĩa. */
const DEGENERATE_MIN_LENGTH = 200_000;
const DEGENERATE_RUN_LENGTH = 200;
const AI_OUTPUT_DEGENERATE = 'AI_OUTPUT_DEGENERATE';

/**
 * Nhận diện phản hồi bị lặp/cụt xác định do trần token đầu ra, trước khi gọi parseDeep().
 * Không phụ thuộc vào JSON hợp lệ vì phản hồi có thể bị cắt ngay giữa chuỗi hoặc lặp dấu '-'.
 */
export function looksDegenerateOutput(text: string): boolean {
  return text.length >= DEGENERATE_MIN_LENGTH || /([\s\S])\1{199,}/.test(text);
}

/** Round 12B / T12.8' — nhận diện heuristic JSON bị cắt mà không tác động retry hay payload. */
export function looksTruncatedOutput(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (!normalized) return false;

  const lastCharacter = normalized.at(-1);
  if (lastCharacter !== '}' && lastCharacter !== ']') return true;

  const openingCount = (normalized.match(/[\[{]/g) ?? []).length;
  const closingCount = (normalized.match(/[\]}]/g) ?? []).length;
  return openingCount > closingCount;
}

/**
 * Chặn trên cho lượt 2 (`retryFailedChunks`). Lượt 2 chạy TUẦN TỰ nên thời gian cộng dồn.
 * ~20-35s/chunk ⇒ 10 chunk ≈ 6 phút, còn an toàn dưới trần polling 20 phút của UI.
 */
const RETRY_PASS_MAX_CHUNKS = 10;
/**
 * Số chunk lỗi mà LUÔN chạy lại, bất kể tỷ lệ. File ít chunk thì tỷ lệ không có ý nghĩa
 * (PDF 2 chunk mà rớt 1 là 50%, nhưng vẫn đúng dạng lỗi lẻ tẻ), nên phải xét ngưỡng tuyệt đối
 * trước ngưỡng tỷ lệ. 3 chunk chạy lại tuần tự mất ~1,5 phút — rẻ.
 */
const RETRY_PASS_ALWAYS_BELOW = 3;
/** Lỗi vượt tỷ lệ này (khi số lỗi đã trên ngưỡng tuyệt đối) là sự cố hệ thống → bỏ lượt 2. */
const RETRY_PASS_MAX_FAILED_RATIO = 1 / 3;

function shortReason(prefix: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `${prefix}: ${msg.substring(0, REASON_MAX)}`;
}

export interface TableChunkOutcome {
  reportType: ReportType;
  /**
   * Index của ReportLocation sinh ra chunk này.
   * BẮT BUỘC để merge phân biệt hai lần xuất hiện của cùng reportType (ví dụ BS riêng lẻ
   * ở trang 3 và BS hợp nhất ở trang 40) — chỉ nối bảng khi CÙNG locationIndex.
   * CODE-REVIEW-01 mục 2.
   */
  locationIndex: number;
  /** Thứ tự chunk TRONG location (0 = chunk đầu). Dùng để xác định continuation. */
  chunkIndex: number;
  pageFrom: number;
  pageTo: number;
  /** null = chunk thất bại sau khi hết retry → report bị gán UNREADABLE nếu không chunk nào thành công. */
  result: ExtractChunkResult | null;
  aiWarnings: string[];
  /** Lý do thất bại (null khi thành công) — nổi lên `processingInfo.failureReasons`. */
  failureReason: string | null;
  /** Round 12B / T12.8' — raw response cuối cùng có dạng JSON nghi bị cắt; chỉ để chẩn đoán. */
  outputLimitSuspected?: boolean;
  /** true khi phản hồi Notes bị lặp/cụt xác định; table chunks luôn false/undefined. */
  deterministicFailure?: boolean;
}

export interface NotesChunkOutcome {
  locationIndex: number;
  chunkIndex: number;
  pageFrom: number;
  pageTo: number;
  result: ExtractNotesChunkResult | null;
  aiWarnings: string[];
  failureReason: string | null;
  /** true khi phản hồi đã được xác định lặp/cụt do trần token đầu ra. */
  deterministicFailure?: boolean;
  /** Số phản hồi của chunk này chạm trần token đầu ra, kể cả khi lần gọi sau phục hồi. */
  aiOutputLimitHits?: number;
}

export interface ExtractOutcome {
  tableChunks: TableChunkOutcome[];
  notesChunks: NotesChunkOutcome[];
}

/**
 * Bóc tất cả report đã classify được.
 * Location song song (semaphore) × chunk trong location tuần tự (để có knownColumnIds).
 */
export async function extractReports(
  ctx: WorkflowContext,
  fileName: string,
  source: PageSource,
  locations: ReportLocation[],
  config: FinancialReportConfig,
  chunkKeyPrefix: string,
  uploadedKeys: string[],
  onChunkDone?: (done: number, total: number) => Promise<void>,
): Promise<ExtractOutcome> {
  const { logger } = ctx;

  // I3 (UAT #01): thuyết minh dùng cỡ chunk RIÊNG, nhỏ hơn bảng số liệu, vì prompt notes yêu cầu
  // trả toàn văn từng mục nên phản hồi dài và dễ bị cắt token → JSON không parse được.
  // BIÊN AN TOÀN ±1 TRANG (UAT JFE 2026-08-11) — vì sao cần:
  //
  // Số trang do AI classify trả về KHÔNG chính xác tuyệt đối: đo trên JFE, cùng một tài liệu, dải
  // trang lệch ±1 tuỳ báo cáo/cửa sổ (bảng cân đối lệch sớm 1 trang → mất nửa bảng Nợ+Vốn; sau khi
  // sửa mô tả đính kèm thì bảng cân đối/KQKD đúng nhưng lưu chuyển tiền tệ lại lệch sớm 1 trang →
  // mất nửa bảng). Đây là sai số CỐ HỮU của bước phân loại bằng AI, không thể triệt tiêu bằng prompt.
  //
  // Cách làm hệ thống BỀN với sai số đó: gửi thêm 1 trang mỗi phía cho bước extract. An toàn vì
  // extract là bước BIẾT LOẠI BÁO CÁO và đã chứng minh tự bỏ qua trang không thuộc loại đang bóc
  // (bằng chứng JFE: chunk trang 2-3 với trang 2 KHÔNG phải bảng cân đối → AI chỉ trả nội dung
  // trang 3; chunk 4-5 với trang 4 là Nợ/Vốn → AI chỉ trả KQKD của trang 5).
  //
  // KHÔNG áp cho thuyết minh: dải notes vốn rất dài, thêm biên chỉ tốn token mà không cứu được gì.
  // `location.pageFrom/pageTo` giữ NGUYÊN (báo cáo/chẩn đoán vẫn theo classify); chỉ dải gửi AI rộng hơn.
  const pageMargin = Math.max(0, config.extractPageMargin ?? DEFAULT_EXTRACT_PAGE_MARGIN);

  const groups = locations.map((location, locationIndex) => {
    const isNotesLocation = location.reportType === NOTES_REPORT_TYPE;
    const margin = isNotesLocation ? 0 : pageMargin;
    const scanFrom = Math.max(1, location.pageFrom - margin);
    const scanTo = Math.min(source.totalPages, location.pageTo + margin);
    return {
      location,
      locationIndex,
      chunks: chunkPageRange(
        scanFrom,
        scanTo,
        isNotesLocation ? config.notesPagesPerChunk : config.pagesPerChunk,
      ),
    };
  });

  const totalChunks = groups.reduce((sum, g) => sum + g.chunks.length, 0);

  logger.info(
    `${LOG} Extract "${fileName}": ${groups.length} location → ${totalChunks} chunk ` +
    `(bảng ${config.pagesPerChunk} trang/chunk, thuyết minh ${config.notesPagesPerChunk} trang/chunk, ` +
    `concurrency ${config.maxConcurrency}, stagger ${config.staggerDelayMs}ms)`,
  );

  // `completed` chỉ tăng → progress percent luôn tăng đơn điệu.
  let completed = 0;
  const reportProgress = async () => {
    completed++;
    if (onChunkDone) await onChunkDone(completed, totalChunks);
  };

  const groupResults = await runWithConcurrency(
    groups,
    { limit: config.maxConcurrency, staggerDelayMs: config.staggerDelayMs },
    async (group) => {
      const isNotes = group.location.reportType === NOTES_REPORT_TYPE;
      const tableChunks: TableChunkOutcome[] = [];
      const notesChunks: NotesChunkOutcome[] = [];

      // Cột đã biết của chunk trước TRONG CÙNG location (mục 1).
      let knownColumnIds: string[] = [];

      for (let chunkIndex = 0; chunkIndex < group.chunks.length; chunkIndex++) {
        const chunk = group.chunks[chunkIndex];
        const keySuffix = `${chunkKeyPrefix}-loc${group.locationIndex}-${group.location.reportType}-${chunk.from}-${chunk.to}`;

        if (isNotes) {
          notesChunks.push(
            await extractNotesChunk(
              ctx, fileName, source, group.locationIndex, chunkIndex,
              chunk.from, chunk.to, config, keySuffix, uploadedKeys,
            ),
          );
        } else {
          const outcome = await extractTableChunk(
            ctx, fileName, source, group.location, group.locationIndex, chunkIndex,
            chunk.from, chunk.to, config, keySuffix, uploadedKeys, knownColumnIds,
          );
          tableChunks.push(outcome);

          const columnIds = collectColumnIds(outcome);
          if (columnIds.length > 0) knownColumnIds = columnIds;
        }

        await reportProgress();

        // Giãn cách giữa các chunk tuần tự của cùng location (semaphore chỉ giãn lúc khởi chạy nhóm).
        if (chunkIndex < group.chunks.length - 1 && (config.extractInterChunkDelayMs ?? config.staggerDelayMs) > 0) {
          await sleep(config.extractInterChunkDelayMs ?? config.staggerDelayMs);
        }
      }

      return { tableChunks, notesChunks };
    },
  );

  const tableChunks = groupResults.flatMap((g) => g.tableChunks);
  const notesChunks = groupResults.flatMap((g) => g.notesChunks);

  // ── Lượt 2: chạy lại các chunk lỗi, TUẦN TỰ, sau khi mọi chunk khác đã xong ──────────
  //
  // Vì sao cần lượt riêng thay vì chỉ tăng max_retries: retry trong lượt 1 xảy ra khi backend
  // AI đang gánh `max_concurrency` request khác, nên hay lỗi tiếp vì cùng một nguyên nhân
  // (timeout/quá tải). Đo trên Air Water 24 trang: lượt 1 rớt đúng 1/9 chunk (trang 21-22)
  // trong khi 8 chunk còn lại xong bình thường — dạng lỗi lẻ tẻ do tải, không phải PDF mờ.
  // Chạy lại lúc đường đã trống có tỉ lệ thành công cao hơn nhiều mà không tăng tải đỉnh.
  await retryFailedChunks(ctx, fileName, source, groups, config, chunkKeyPrefix, uploadedKeys,
    tableChunks, notesChunks);

  // Sắp theo (locationIndex, chunkIndex) để merge nối bảng đúng thứ tự trong từng location (§17).
  const byLocationThenChunk = (a: { locationIndex: number; chunkIndex: number }, b: { locationIndex: number; chunkIndex: number }) =>
    a.locationIndex - b.locationIndex || a.chunkIndex - b.chunkIndex;
  tableChunks.sort(byLocationThenChunk);
  notesChunks.sort(byLocationThenChunk);

  return { tableChunks, notesChunks };
}

interface ExtractGroup {
  location: ReportLocation;
  locationIndex: number;
  chunks: Array<{ from: number; to: number }>;
}

/**
 * Chạy lại một lượt duy nhất cho các chunk đã thất bại, tuần tự, sau khi lượt 1 kết thúc.
 * Sửa TẠI CHỖ vào `tableChunks` / `notesChunks`.
 *
 * Không đệ quy và không tăng số lượt: đúng 1 lần cho mỗi chunk lỗi. Chunk vẫn lỗi thì giữ
 * nguyên `failureReason` của lượt 2 (mới nhất, phản ánh trạng thái sau khi hệ thống đã rảnh).
 */
async function retryFailedChunks(
  ctx: WorkflowContext,
  fileName: string,
  source: PageSource,
  groups: ExtractGroup[],
  config: FinancialReportConfig,
  chunkKeyPrefix: string,
  uploadedKeys: string[],
  tableChunks: TableChunkOutcome[],
  notesChunks: NotesChunkOutcome[],
): Promise<void> {
  const { logger } = ctx;
  const totalChunks = tableChunks.length + notesChunks.length;
  let failedTables = tableChunks.filter((c) => c.result === null);
  // T7: đầu ra lặp/cụt do trần token là lỗi xác định theo nội dung phản hồi; lượt 2 chung
  // chỉ dành cho lỗi lẻ tẻ do tải, nên tuyệt đối không gọi AI thêm cho nhóm này.
  let failedNotes = notesChunks.filter((c) => c.result === null && !c.deterministicFailure);
  const totalFailed = failedTables.length + failedNotes.length;
  if (totalFailed === 0) return;

  // ── CHẶN TRÊN: lượt 2 chạy TUẦN TỰ nên phải có giới hạn, không được để nó tự do ──────
  //
  // Mỗi chunk mất ~(stagger + 1 lần gọi AI) ≈ 20-35s. JFE 85 trang = 43 chunk; nếu rớt hết
  // thì lượt 2 chạy ~25 phút, vượt cả trần polling 20 phút của UI, mà vẫn tốn token.
  //
  // Tỷ lệ lỗi cao KHÔNG phải dạng lỗi mà lượt 2 sinh ra để chữa: nó nghĩa là backend AI đang
  // sự cố hoặc storage chết, chạy lại tuần tự chỉ kéo dài thời gian rồi cũng thất bại. Lượt 2
  // chỉ để vớt lỗi LẺ TẺ do tải.
  if (
    totalFailed > RETRY_PASS_ALWAYS_BELOW &&
    totalFailed / Math.max(1, totalChunks) > RETRY_PASS_MAX_FAILED_RATIO
  ) {
    logger.warn(
      `${LOG} Extract "${fileName}": BỎ lượt 2 — ${totalFailed}/${totalChunks} chunk lỗi ` +
      `(> ${Math.round(RETRY_PASS_MAX_FAILED_RATIO * 100)}%), là dấu hiệu sự cố hệ thống chứ ` +
      `không phải lỗi lẻ tẻ; chạy lại tuần tự chỉ tốn thêm thời gian và token`,
    );
    return;
  }
  if (totalFailed > RETRY_PASS_MAX_CHUNKS) {
    logger.warn(
      `${LOG} Extract "${fileName}": ${totalFailed} chunk lỗi, lượt 2 chỉ chạy lại ` +
      `${RETRY_PASS_MAX_CHUNKS} chunk đầu để không vượt trần thời gian của caller`,
    );
    const budget = RETRY_PASS_MAX_CHUNKS;
    failedTables = failedTables.slice(0, budget);
    failedNotes = failedNotes.slice(0, Math.max(0, budget - failedTables.length));
  }

  logger.info(
    `${LOG} Extract "${fileName}": lượt 2 chạy lại ${failedTables.length + failedNotes.length}` +
    `/${totalFailed} chunk lỗi (tuần tự, sau khi ${totalChunks - totalFailed} chunk khác đã xong)`,
  );

  for (const target of failedTables) {
    const group = groups.find((g) => g.locationIndex === target.locationIndex);
    if (!group) continue;
    const keySuffix = `${chunkKeyPrefix}-loc${group.locationIndex}-${group.location.reportType}-${target.pageFrom}-${target.pageTo}-r2`;

    // knownColumnIds lấy từ chunk THÀNH CÔNG gần nhất phía trước TRONG CÙNG location,
    // để bảng cắt qua trang vẫn nối được đúng như ở lượt 1.
    const previous = tableChunks
      .filter((c) => c.locationIndex === target.locationIndex && c.chunkIndex < target.chunkIndex && c.result !== null)
      .sort((a, b) => b.chunkIndex - a.chunkIndex)[0];
    const knownColumnIds = previous ? collectColumnIds(previous) : [];

    await sleep(config.staggerDelayMs);
    const retried = await extractTableChunk(
      ctx, fileName, source, group.location, group.locationIndex, target.chunkIndex,
      target.pageFrom, target.pageTo, config, keySuffix, uploadedKeys, knownColumnIds,
    );
    Object.assign(target, retried);
    logger.info(
      `${LOG} Lượt 2 ${group.location.reportType} trang ${target.pageFrom}-${target.pageTo}: ` +
      `${retried.result ? 'THÀNH CÔNG' : 'vẫn lỗi'}`,
    );
  }

  for (const target of failedNotes) {
    const group = groups.find((g) => g.locationIndex === target.locationIndex);
    if (!group) continue;
    const keySuffix = `${chunkKeyPrefix}-loc${group.locationIndex}-${NOTES_REPORT_TYPE}-${target.pageFrom}-${target.pageTo}-r2`;

    await sleep(config.staggerDelayMs);
    const retried = await extractNotesChunk(
      ctx, fileName, source, group.locationIndex, target.chunkIndex,
      target.pageFrom, target.pageTo, config, keySuffix, uploadedKeys,
    );
    Object.assign(target, retried);
    logger.info(
      `${LOG} Lượt 2 notes trang ${target.pageFrom}-${target.pageTo}: ` +
      `${retried.result ? 'THÀNH CÔNG' : 'vẫn lỗi'}`,
    );
  }
}

/** Lấy bộ column id mà chunk vừa trả về, để chunk kế tiếp dùng làm knownColumnIds. */
function collectColumnIds(outcome: TableChunkOutcome): string[] {
  const ids = new Set<string>();
  for (const table of outcome.result?.tables ?? []) {
    for (const column of table.columns ?? []) {
      if (typeof column?.id === 'string' && column.id.trim()) ids.add(column.id.trim());
    }
  }
  return [...ids];
}

function normalizeExtractedTableMetadata(
  result: { tables?: ExtractedTable[] },
  fallbackReportType: ReportType,
): void {
  for (const table of result.tables ?? []) {
    const rawReportType = typeof table.reportType === 'string' ? table.reportType.trim() : '';
    const reportType: ExtractedTableReportType = rawReportType === 'OTHER'
      || REPORT_TYPES.some((type) => type === rawReportType)
      ? rawReportType as ExtractedTableReportType
      : fallbackReportType;
    const rawTableTitle = typeof table.tableTitle === 'string' ? table.tableTitle.trim() : '';

    table.reportType = reportType;
    table.tableTitle = rawTableTitle || null;
  }
}

async function extractTableChunk(
  ctx: WorkflowContext,
  fileName: string,
  source: PageSource,
  location: ReportLocation,
  locationIndex: number,
  chunkIndex: number,
  from: number,
  to: number,
  config: FinancialReportConfig,
  keySuffix: string,
  uploadedKeys: string[],
  knownColumnIds: string[],
): Promise<TableChunkOutcome> {
  const { logger } = ctx;
  const attempts = Math.max(1, config.maxRetries);
  const failed: TableChunkOutcome = {
    reportType: location.reportType, locationIndex, chunkIndex, pageFrom: from, pageTo: to,
    result: null, aiWarnings: [], failureReason: null,
  };
  const label = `extract ${location.reportType} trang ${from}-${to}`;
  let sawOutputLimitSuspected = false;

  // CODE-REVIEW-01 mục 19: tách trang + upload storage nằm TRONG try. Trước đây 2 bước này
  // ở ngoài nên một hiccup S3 làm throw lên tận processSingleFile → cả file thành FAILED,
  // report = null, mất toàn bộ chunk đã bóc thành công. Trái tinh thần Q7.
  let filesJson: string;
  try {
    const prepared = await prepareChunkAssets(source, ctx.operationId, fileName, keySuffix, from, to);
    filesJson = prepared.filesJson;
    uploadedKeys.push(...prepared.storageKeys);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `${LOG} Chuẩn bị chunk ${location.reportType} trang ${from}-${to} thất bại (tách trang/upload storage): ` +
      `${msg.substring(0, 200)} → bỏ chunk này, GIỮ các chunk khác`,
    );
    failed.failureReason = shortReason(`${label} (tách trang/upload storage)`, err);
    return failed;
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const promptVars = buildExtractPrompt(
        location.reportType,
        from,
        to,
        chunkIndex > 0,
        knownColumnIds,
        ctx.promptOverrides.extract,
        source.mode,
      );
      const result = await enqueueSubStep(ctx, EXTRACT_CONNECTOR, promptVars, filesJson, ctx.modelOverrides.extract, ctx.reasoningEffortOverrides.extract);
      const content = typeof result.content === 'string' ? result.content : '';
      let parsed: ExtractChunkResult | null;
      try {
        parsed = parseDeep(result.content) as ExtractChunkResult | null;
      } catch (err) {
        sawOutputLimitSuspected ||= looksTruncatedOutput(content);
        throw err;
      }

      if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.tables) && parsed.notFound !== true)) {
        sawOutputLimitSuspected ||= looksTruncatedOutput(content);
        throw new Error('JSON extract không hợp lệ');
      }

      // Round 11 / T3.1: metadata từng bảng dùng cho T3.2; wrapper chunk vẫn theo classify location.
      normalizeExtractedTableMetadata(parsed, location.reportType);

      const rowCount = (parsed.tables ?? []).reduce((sum, t) => sum + (t.rows?.length ?? 0), 0);
      logger.info(`${LOG} Extract ${location.reportType} trang ${from}-${to}: ${rowCount} dòng, ${(parsed.tables ?? []).length} bảng`);

      return {
        reportType: location.reportType,
        locationIndex,
        chunkIndex,
        pageFrom: from,
        pageTo: to,
        result: parsed,
        aiWarnings: normalizeAiWarnings(parsed.warnings),
        failureReason: null,
        outputLimitSuspected: undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < attempts) {
        logger.warn(`${LOG} Extract ${location.reportType} trang ${from}-${to} lỗi (attempt ${attempt}/${attempts}): ${msg.substring(0, 160)} → retry`);
        await sleep(2000 * attempt);
        continue;
      }
      logger.error(`${LOG} Extract ${location.reportType} trang ${from}-${to} thất bại sau ${attempts} lần: ${msg.substring(0, 200)}`);
      failed.failureReason = shortReason(`${label} (sau ${attempts} lần gọi AI)`, err);
      failed.outputLimitSuspected = sawOutputLimitSuspected || undefined;
      return failed;
    }
  }

  return failed;
}

async function extractNotesChunk(
  ctx: WorkflowContext,
  fileName: string,
  source: PageSource,
  locationIndex: number,
  chunkIndex: number,
  from: number,
  to: number,
  config: FinancialReportConfig,
  keySuffix: string,
  uploadedKeys: string[],
): Promise<NotesChunkOutcome> {
  const { logger } = ctx;
  const attempts = Math.max(1, config.maxRetries);
  const failed: NotesChunkOutcome = {
    locationIndex, chunkIndex, pageFrom: from, pageTo: to,
    result: null, aiWarnings: [], failureReason: null,
  };
  const label = `extract notes trang ${from}-${to}`;
  let aiOutputLimitHits = 0;
  let sawDegenerateOutput = false;
  let attemptLimit = attempts;

  // mục 19: lỗi tách trang / upload storage chỉ làm mất CHUNK này, không giết cả file.
  let filesJson: string;
  try {
    const prepared = await prepareChunkAssets(source, ctx.operationId, fileName, keySuffix, from, to);
    filesJson = prepared.filesJson;
    uploadedKeys.push(...prepared.storageKeys);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `${LOG} Chuẩn bị chunk notes trang ${from}-${to} thất bại (tách trang/upload storage): ` +
      `${msg.substring(0, 200)} → bỏ chunk này, GIỮ các chunk khác`,
    );
    failed.failureReason = shortReason(`${label} (tách trang/upload storage)`, err);
    return failed;
  }

  for (let attempt = 1; attempt <= attemptLimit; attempt++) {
    try {
      const promptVars = buildNotesExtractPrompt(from, to, ctx.promptOverrides.extract_notes, source.mode);
      const result = await enqueueSubStep(
        ctx,
        EXTRACT_CONNECTOR,
        promptVars,
        filesJson,
        ctx.modelOverrides.extract,
        ctx.reasoningEffortOverrides.extract,
      );

      // T7: phải chặn TRƯỚC parseDeep(). Chuỗi lặp/cụt lớn có thể làm parser tốn tài nguyên
      // vô ích, nhưng quan trọng hơn đây là dấu hiệu xác định của trần token đầu ra, không phải
      // lỗi nhất thời mà lượt retry chung có thể chữa.
      if (looksDegenerateOutput(result.content ?? '')) {
        aiOutputLimitHits++;
        sawDegenerateOutput = true;
        attemptLimit = Math.min(attempts, 2);
        throw new Error(`${AI_OUTPUT_DEGENERATE}: ${describeInvalidNotesJson(result.content)}`);
      }

      const parsed = parseDeep(result.content) as ExtractNotesChunkResult | null;
      if (
        !parsed
        || typeof parsed !== 'object'
        || (!Array.isArray(parsed.sections) && !Array.isArray(parsed.tables) && parsed.notFound !== true)
      ) {
        // I3 (UAT #01): nói rõ ĐÂY LÀ LỖI ĐỊNH DẠNG PHẢN HỒI AI, kèm dấu hiệu bị cắt token.
        // Trước đây thông điệp trần "JSON extract notes không hợp lệ" bị đọc lẫn với "ảnh mờ"
        // (errorCode OCR_LOW_CONFIDENCE) nên chẩn đoán sai nguyên nhân.
        throw new Error(describeInvalidNotesJson(result.content));
      }

      normalizeExtractedTableMetadata(parsed, NOTES_REPORT_TYPE);
      logger.info(
        `${LOG} Extract notes trang ${from}-${to}: ${(parsed.sections ?? []).length} mục, ${(parsed.tables ?? []).length} bảng`,
      );
      return {
        locationIndex,
        chunkIndex,
        pageFrom: from,
        pageTo: to,
        result: parsed,
        aiWarnings: normalizeAiWarnings(parsed.warnings),
        failureReason: null,
        deterministicFailure: false,
        aiOutputLimitHits,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < attemptLimit) {
        logger.warn(`${LOG} Extract notes trang ${from}-${to} lỗi (attempt ${attempt}/${attemptLimit}): ${msg.substring(0, 160)} → retry`);
        await sleep(2000 * attempt);
        continue;
      }
      logger.error(`${LOG} Extract notes trang ${from}-${to} thất bại sau ${attemptLimit} lần: ${msg.substring(0, 200)}`);
      failed.failureReason = shortReason(`${label} (sau ${attemptLimit} lần gọi AI)`, err);
      failed.deterministicFailure = sawDegenerateOutput;
      failed.aiOutputLimitHits = aiOutputLimitHits;
      return failed;
    }
  }

  return failed;
}

/** Tổng hợp số lần chạm trần và chunk Notes thất bại xác định để đưa ra processingInfo. */
export function summarizeNotesOutputLimits(chunks: NotesChunkOutcome[]): {
  aiOutputLimitHits: number;
  deterministicChunkFailures: number;
} {
  return {
    aiOutputLimitHits: chunks.reduce((sum, chunk) => sum + (chunk.aiOutputLimitHits ?? 0), 0),
    deterministicChunkFailures: chunks.filter((chunk) => chunk.result === null && chunk.deterministicFailure).length,
  };
}

/**
 * I3 — Mô tả lý do phản hồi notes không dùng được, có dấu hiệu phân biệt truncation.
 * Phản hồi bị cắt theo giới hạn token thường KHÔNG đóng ngoặc `}` ở cuối.
 */
export function describeInvalidNotesJson(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? null);
  const length = text?.length ?? 0;
  const tail = (text ?? '').trimEnd().slice(-1);
  if (looksDegenerateOutput(text ?? '')) {
    return `AI trả JSON thuyết minh bị lặp hoặc cụt (${length} ký tự, kết thúc bằng "${tail}") `
      + 'do chạm trần token đầu ra.';
  }
  const looksTruncated = length > 0 && tail !== '}' && tail !== ']';
  return looksTruncated
    ? `AI trả JSON thuyết minh KHÔNG hợp lệ, có dấu hiệu bị cắt giữa dòng (${length} ký tự, `
      + `kết thúc bằng "${tail}"). Phản hồi cần được kiểm tra do có thể bị giới hạn đầu ra.`
    : `AI trả JSON thuyết minh KHÔNG hợp lệ (${length} ký tự) — lỗi định dạng phản hồi, không phải lỗi chất lượng ảnh.`;
}

function normalizeAiWarnings(warnings: unknown): string[] {
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((w): w is string => typeof w === 'string' && w.trim() !== '');
}
