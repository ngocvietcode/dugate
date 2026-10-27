// lib/pipelines/workflows/financial-report/translate.ts
// Step 3 — Translate: rẽ nhánh theo targetLang (vi | en).
// Chỉ dịch TEXT (tiêu đề, nhãn cột, tên khoản mục, thuyết minh).
// TUYỆT ĐỐI không đổi số, ngày, mã, đơn vị → dịch theo danh sách id (§13.4),
// AI không bao giờ nhìn thấy hay ghi lại bảng số liệu.

import { type WorkflowContext, enqueueSubStep, parseDeep } from '@/lib/pipelines/workflow-engine';
import { buildTranslatePrompt, resolveReportTitleFallback } from '../prompts/financial-report-prompts';
import { runWithConcurrency, sleep } from './concurrency';
import { looksTruncatedOutput } from './extract';
import {
  NOTES_REPORT_TYPE,
  REPORT_TYPES,
  type FinancialReportConfig,
  type InternalFinancialReportPayload,
  type NotesReport,
  type ReportType,
  type TabularReport,
  type TranslateItem,
  type TranslateResult,
} from './types';

const LOG = '[FINANCIAL-REPORT]';
const TRANSLATE_CONNECTOR = 'ext-translator';
const DEFAULT_TRANSLATE_BATCH_ITEMS = 40;
const DEFAULT_TRANSLATE_BATCH_CHARS = 20_000;

interface TranslationTarget {
  reportType: ReportType | null;
  text: string;
  apply: (translated: string) => void;
}

interface TranslationBatchEntry {
  item: TranslateItem;
  refs: TranslationTarget[];
}

interface BatchTranslationResult {
  translations: Map<string, string> | null;
  failureReason: string | null;
  /** true khi bất kỳ attempt nào trong lô có raw JSON nghi bị cắt. */
  outputLimitSuspected: boolean;
}

export interface TranslateOutcome {
  /** Số mục hiển thị cần dịch, không phải số chuỗi nguồn sau dedupe. */
  totalItems: number;
  translatedItems: number;
  /** Số mục hiển thị không nhận được bản dịch, kể cả companyName. */
  untranslatedItems: number;
  failedBatches: number;
  totalBatches: number;
  /** Một chẩn đoán kỹ thuật đã cắt ngắn cho từng lô thất bại. */
  failureReasons: string[];
  /** Round 12B / T12.8' — số lô có raw output nghi bị cắt, kể cả khi retry sau đó phục hồi. */
  translateOutputLimitSuspected: number;
  /** Số nhãn/đoạn chưa dịch được, theo từng report → orchestrator gắn TRANSLATION_PARTIAL. */
  untranslatedByReport: Map<ReportType, number>;
}

/**
 * Dịch toàn bộ payload tại chỗ (mutate). Dedupe theo chuỗi nguồn trên TOÀN file,
 * sau đó fan-out kết quả về mọi target id sử dụng cùng chuỗi đó.
 */
export async function translatePayload(
  ctx: WorkflowContext,
  payload: InternalFinancialReportPayload,
  config: FinancialReportConfig,
): Promise<TranslateOutcome> {
  const { logger } = ctx;
  const targets: TranslationTarget[] = [];

  collectTargets(payload, targets);

  const outcome: TranslateOutcome = {
    totalItems: targets.length,
    translatedItems: 0,
    untranslatedItems: 0,
    failedBatches: 0,
    totalBatches: 0,
    failureReasons: [],
    translateOutputLimitSuspected: 0,
    untranslatedByReport: new Map(),
  };

  if (outcome.totalItems === 0) {
    applyTitleFallback(payload, config);
    return outcome;
  }

  logger.info(`${LOG} Translate → ${config.targetLang}: ${outcome.totalItems} mục hiển thị`);

  await runBatches(ctx, targets, config, outcome);

  applyTitleFallback(payload, config);
  logger.info(
    `${LOG} Translate xong: ${outcome.translatedItems}/${outcome.totalItems} item, ` +
    `${outcome.failedBatches}/${outcome.totalBatches} batch lỗi`,
  );
  return outcome;
}

async function runBatches(
  ctx: WorkflowContext,
  targets: TranslationTarget[],
  config: FinancialReportConfig,
  outcome: TranslateOutcome,
): Promise<void> {
  // Gộp theo chuỗi nguồn trên toàn bộ labels, companyName và Notes prose để giảm token
  // đồng thời giữ bản dịch nhất quán giữa các vị trí khác nhau trong file.
  const uniqueTexts = new Map<string, TranslationTarget[]>();
  for (const target of targets) {
    const refs = uniqueTexts.get(target.text);
    if (refs) refs.push(target);
    else uniqueTexts.set(target.text, [target]);
  }

  const entries: TranslationBatchEntry[] = [...uniqueTexts.entries()].map(([text, refs], index) => ({
    item: { id: `t${index + 1}`, text },
    refs,
  }));
  const batches = partitionTranslationBatches(
    entries,
    config.translateBatchItems ?? DEFAULT_TRANSLATE_BATCH_ITEMS,
    config.translateBatchChars ?? DEFAULT_TRANSLATE_BATCH_CHARS,
  );
  outcome.totalBatches = batches.length;

  const results = await runWithConcurrency(
    batches,
    { limit: config.maxConcurrency, staggerDelayMs: config.staggerDelayMs },
    (batch) => translateBatch(ctx, batch.map((entry) => entry.item), config),
  );

  results.forEach((result, batchIndex) => {
    const batch = batches[batchIndex];
    if (result.outputLimitSuspected) outcome.translateOutputLimitSuspected++;
    if (result.translations === null) {
      outcome.failedBatches++;
      outcome.failureReasons.push(formatBatchFailureReason(
        batchIndex + 1,
        batches.length,
        batch.length,
        result.failureReason ?? 'Lỗi dịch không xác định',
      ));
      for (const entry of batch) {
        for (const ref of entry.refs) countUntranslated(outcome, ref.reportType);
      }
      return;
    }

    for (const entry of batch) {
      const translated = result.translations.get(entry.item.id);
      if (translated?.trim()) {
        for (const ref of entry.refs) {
          ref.apply(translated.trim());
          outcome.translatedItems++;
        }
      } else {
        // Response thiếu id là thiếu từng mục, không biến cả lô thành một lỗi.
        for (const ref of entry.refs) countUntranslated(outcome, ref.reportType);
      }
    }
  });
}

function partitionTranslationBatches(
  entries: TranslationBatchEntry[],
  configuredItemLimit: number,
  configuredCharacterLimit: number,
): TranslationBatchEntry[][] {
  const itemLimit = Math.max(1, Math.floor(configuredItemLimit) || DEFAULT_TRANSLATE_BATCH_ITEMS);
  const characterLimit = Math.max(1, Math.floor(configuredCharacterLimit) || DEFAULT_TRANSLATE_BATCH_CHARS);
  const batches: TranslationBatchEntry[][] = [];
  let currentBatch: TranslationBatchEntry[] = [];
  let currentCharacters = 0;

  const closeCurrentBatch = () => {
    if (currentBatch.length === 0) return;
    batches.push(currentBatch);
    currentBatch = [];
    currentCharacters = 0;
  };

  for (const entry of entries) {
    const itemCharacters = entry.item.text.length;
    const exceedsItemLimit = currentBatch.length >= itemLimit;
    const exceedsCharacterLimit = currentBatch.length > 0
      && currentCharacters + itemCharacters > characterLimit;

    if (exceedsItemLimit || exceedsCharacterLimit) closeCurrentBatch();

    currentBatch.push(entry);
    currentCharacters += itemCharacters;

    // Mục dài hơn giới hạn là singleton nguyên vẹn; không cắt source text.
    if (currentBatch.length >= itemLimit || currentCharacters >= characterLimit) closeCurrentBatch();
  }

  closeCurrentBatch();
  return batches;
}

function formatBatchFailureReason(
  batchNumber: number,
  totalBatches: number,
  itemCount: number,
  reason: string,
): string {
  return `translate lô ${batchNumber}/${totalBatches} (${itemCount} mục): ${reason.substring(0, 160)}`;
}

async function translateBatch(
  ctx: WorkflowContext,
  items: TranslateItem[],
  config: FinancialReportConfig,
): Promise<BatchTranslationResult> {
  const { logger } = ctx;
  const attempts = Math.max(1, config.maxRetries);
  let outputLimitSuspected = false;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const promptVars = buildTranslatePrompt(config.targetLang, items, ctx.promptOverrides.translate);
      const result = await enqueueSubStep(ctx, TRANSLATE_CONNECTOR, promptVars, null, ctx.modelOverrides.translate, ctx.reasoningEffortOverrides.translate);
      const content = typeof result.content === 'string' ? result.content : '';
      let parsed: TranslateResult | null = null;
      try {
        parsed = parseDeep(result.content) as TranslateResult | null;
      } catch {
        // Cùng đường invalid-JSON bên dưới để thông điệp cũ được giữ nguyên tiền tố.
      }

      if (!parsed || !Array.isArray(parsed.translations)) {
        const suspectedThisAttempt = looksTruncatedOutput(content);
        outputLimitSuspected ||= suspectedThisAttempt;
        const suffix = suspectedThisAttempt
          ? ` (nghi bị cắt do trần token đầu ra, len=${content.length})`
          : '';
        throw new Error(`JSON translate không hợp lệ${suffix}`);
      }

      const translations = new Map<string, string>();
      for (const entry of parsed.translations) {
        const id = entry?.id ?? entry?.rowId ?? entry?.columnId;
        if (typeof id === 'string' && typeof entry?.translated === 'string') {
          translations.set(id, entry.translated);
        }
      }
      if (translations.size === 0) throw new Error('translate trả về 0 kết quả');
      return { translations, failureReason: null, outputLimitSuspected };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < attempts) {
        logger.warn(`${LOG} Translate batch ${items.length} item lỗi (attempt ${attempt}/${attempts}): ${message.substring(0, 160)} → retry`);
        await sleep(2000 * attempt);
        continue;
      }
      logger.error(`${LOG} Translate batch ${items.length} item thất bại sau ${attempts} lần: ${message.substring(0, 200)}`);
      return { translations: null, failureReason: message, outputLimitSuspected };
    }
  }

  return { translations: null, failureReason: 'Lỗi dịch không xác định', outputLimitSuspected };
}

// ─── Thu thập điểm cần dịch ──────────────────────────────────────────────────

function collectTargets(
  payload: InternalFinancialReportPayload,
  targets: TranslationTarget[],
): void {
  const generalInformation = payload.generalInformation;
  if (generalInformation.companyName.source) {
    targets.push({
      reportType: null,
      text: generalInformation.companyName.source,
      apply: (translated) => { generalInformation.companyName.translated = translated; },
    });
  }

  for (const reportType of REPORT_TYPES) {
    if (reportType === NOTES_REPORT_TYPE) {
      collectNotesTargets(payload.notesToFinancialStatements, targets, targets);
      continue;
    }
    collectTabularTargets(reportType, payload[reportType] as TabularReport, targets);
  }
}

function collectTabularTargets(
  reportType: ReportType,
  report: TabularReport,
  targets: TranslationTarget[],
): void {
  if (report.status === 'NOT_FOUND') return;

  if (report.title?.source) {
    const title = report.title;
    targets.push({ reportType, text: title.source as string, apply: (translated) => { title.translated = translated; } });
  }

  for (const table of report.tables) {
    for (const column of table.columns) {
      if (!column.label.source) continue;
      const label = column.label;
      targets.push({ reportType, text: label.source as string, apply: (translated) => { label.translated = translated; } });
    }
    for (const row of table.rows) {
      if (!row.label.source) continue;
      const label = row.label;
      targets.push({ reportType, text: label.source as string, apply: (translated) => { label.translated = translated; } });
    }
  }
}

function collectNotesTargets(
  report: NotesReport,
  labelTargets: TranslationTarget[],
  textTargets: TranslationTarget[],
): void {
  if (report.status === 'NOT_FOUND') return;

  if (report.title?.source) {
    const title = report.title;
    labelTargets.push({ reportType: NOTES_REPORT_TYPE, text: title.source as string, apply: (translated) => { title.translated = translated; } });
  }

  for (const section of report.sections) {
    if (section.title.source) {
      const title = section.title;
      labelTargets.push({ reportType: NOTES_REPORT_TYPE, text: title.source as string, apply: (translated) => { title.translated = translated; } });
    }
    if (section.sourceText) {
      textTargets.push({
        reportType: NOTES_REPORT_TYPE,
        text: section.sourceText,
        apply: (translated) => { section.translatedText = translated; },
      });
    }
  }
}

function countUntranslated(outcome: TranslateOutcome, reportType: ReportType | null): void {
  outcome.untranslatedItems++;
  if (!reportType) return;
  outcome.untranslatedByReport.set(reportType, (outcome.untranslatedByReport.get(reportType) ?? 0) + 1);
}

/** Tiêu đề báo cáo là thuật ngữ chuẩn → có bảng fallback, không cần phụ thuộc AI. */
function applyTitleFallback(payload: InternalFinancialReportPayload, config: FinancialReportConfig): void {
  for (const reportType of REPORT_TYPES) {
    const report = payload[reportType] as TabularReport | NotesReport;
    if (report.status === 'NOT_FOUND') continue;
    const fallback = resolveReportTitleFallback(reportType, config.targetLang);
    if (!report.title) {
      report.title = { source: null, translated: fallback };
      continue;
    }
    if (!report.title.translated) report.title.translated = fallback;
  }
}
