// lib/pipelines/workflows/financial-report/classify.ts
// Step 1 — Split + Classify: xác định mỗi loại báo cáo nằm ở trang nào.
//
// Không gọi AI 1 lần cho cả file (PDF có thể 100+ trang): chia thành cửa sổ
// `classifyPagesPerCall` trang, gọi song song có stagger, rồi gộp page range.
// Alias nhận diện có CẢ tiếng Nhật VÀ tiếng Anh (mẫu Air Water là tiếng Anh).

import { type WorkflowContext, enqueueSubStep, parseDeep } from '@/lib/pipelines/workflow-engine';
import { buildClassifyPrompt, buildClassifyRecheckPrompt } from '../prompts/financial-report-prompts';
import {
  REPORT_TYPES,
  FinancialReportError,
  UNKNOWN_LANGUAGE,
  type ClassifyPageLabel,
  type ClassifyResult,
  type FinancialReportConfig,
  type Consolidation,
  type PeriodScope,
  type ReportType,
  type SourceLanguage,
  type StatementKind,
  type TableColumn,
  type UnassignedPageReason,
} from './types';
import { runWithConcurrency, sleep } from './concurrency';
import { chunkPageRange, prepareChunkAssets, type PageSource } from './pdf-utils';

const LOG = '[FINANCIAL-REPORT]';
const CLASSIFY_CONNECTOR = 'ext-classifier';

export interface ReportLocation {
  reportType: ReportType;
  pageFrom: number;
  pageTo: number;
  titleSource: string | null;
  /** R3 — bộ báo cáo là hợp nhất (連結) hay riêng lẻ (個別/単体); null nếu không suy được. */
  consolidation?: Consolidation | null;
  /** UAT #04 / T4 — true khi location được phát hiện trong lượt soi lại trang chưa gán. */
  fromRecheckPass?: boolean;
}

export interface ClassifyOutcome {
  sourceLanguage: SourceLanguage;
  documentType: string | null;
  companyName: string | null;
  fromDate: string | null;
  toDate: string | null;
  currency: string | null;
  unit: string | null;
  /** Chỉ chứa report thực sự tìm thấy. Report không có → orchestrator gán NOT_FOUND. */
  locations: ReportLocation[];
  /** Số trang đã soi thành công (dùng để phát hiện file không đọc được). */
  classifiedWindows: number;
  failedWindows: number;
  /** Lý do từng cửa sổ thất bại → `processingInfo.failureReasons`. */
  failureReasons: string[];
  /** UAT #04 / T1 — các trang chưa có location để không phải đoán từ log container. */
  unassignedPages?: number[];
  /** Round 11B / T2.3 — taxonomy CODE cho từng trang chưa gán sau lượt classify/recheck. */
  unassignedPageReasons?: UnassignedPageReason[];
  /** UAT #04 / T4 — số cửa sổ đã soi lại trang chưa được gán. */
  recheckWindows?: number;
  /** T10 / R5 — số nhãn TITLE bị loại vì thực chất là câu văn tham chiếu. */
  titlesRejectedAsProse?: number;
  /** Round 11 / T2.1 — số nhãn một-trang được CODE sửa số trang AI trả sai. */
  pageNumberCorrections?: number;
}

interface ClassifyNormalizationStats {
  titlesRejectedAsProse: number;
  /** Optional để caller/unit test cũ chỉ theo dõi prose counter vẫn tương thích. */
  pageNumberCorrections?: number;
}

/**
 * Gọi classify theo từng cửa sổ trang rồi gộp kết quả.
 * @param source nguồn trang đã preflight (chunk PDF hoặc ảnh render — xem `prepareChunkAssets`)
 */
export async function classifyDocument(
  ctx: WorkflowContext,
  fileName: string,
  source: PageSource,
  config: FinancialReportConfig,
  chunkKeyPrefix: string,
  uploadedKeys: string[],
): Promise<ClassifyOutcome> {
  const { logger } = ctx;
  const totalPages = source.totalPages;
  const windows = chunkPageRange(1, totalPages, config.classifyPagesPerCall);
  const classifyMaxConcurrency = config.classifyMaxConcurrency ?? config.maxConcurrency;
  const classifyStaggerDelayMs = config.classifyStaggerDelayMs ?? config.staggerDelayMs;

  logger.info(
    `${LOG} Classify "${fileName}": ${totalPages} trang → ${windows.length} cửa sổ ` +
    `(${config.classifyPagesPerCall} trang/lần, concurrency ${classifyMaxConcurrency}, stagger ${classifyStaggerDelayMs}ms, nguồn ${source.mode})`,
  );

  // CODE-REVIEW-01 mục 6: semaphore thay cho delay tuyến tính + Promise.all.
  const failureReasons: string[] = [];
  // T10 / R5: đếm xuyên cả lượt classify đầu và soi lại để surface trong response.
  const normalizationStats: ClassifyNormalizationStats = {
    titlesRejectedAsProse: 0,
    pageNumberCorrections: 0,
  };
  const results = await runWithConcurrency(
    windows,
    { limit: classifyMaxConcurrency, staggerDelayMs: classifyStaggerDelayMs },
    (win) => classifyWindow(ctx, fileName, source, win, totalPages, config, `${chunkKeyPrefix}-classify-${win.from}-${win.to}`, uploadedKeys, failureReasons, undefined, normalizationStats),
  );

  const rawSuccessResults = results.filter((r): r is ClassifyResult => r !== null);
  // Round 11B / T2.2: sau khi mọi cửa sổ độc lập đã hoàn tất, CODE nối trang bảng kế tiếp
  // theo số trang tăng dần. Không phụ thuộc thứ tự Promise hoàn tất và không hỏi AI ngữ cảnh trang trước.
  const successResults = applyDeterministicContinuationsToResults(rawSuccessResults);
  const failedWindows = results.length - successResults.length;

  if (successResults.length === 0) {
    // Kèm lý do thật vào message: nhánh này cho ra file FAILED (processingInfo = null) nên
    // nếu không đính kèm ở đây thì nguyên nhân chỉ còn trong log container.
    throw new FinancialReportError(
      'OCR_LOW_CONFIDENCE',
      `Không phân loại được nội dung file "${fileName}". ${failureReasons.join(' | ')}`.trim(),
    );
  }

  const allBlank = successResults.every((r) => r.blank === true);
  if (allBlank) {
    throw new FinancialReportError('EMPTY_OR_BLANK_PAGES', `File "${fileName}" không có nội dung để đọc.`);
  }

  // CODE-REVIEW-01 mục 12 + B3 (vòng #03) — phân biệt 2 errorCode của SRS khi không tìm thấy
  // báo cáo nào. Bài toán: `isFinancialReport` do AI trả, model CÓ THỂ bỏ trống field này.
  //
  //   - AI nói rõ `false`               → chắc chắn không phải BCTC.
  //   - AI bỏ trống NHƯNG có tín hiệu tài chính (tiền tệ / đơn vị số liệu / kỳ báo cáo)
  //     → đúng là BCTC, chỉ là cấu trúc lạ → UNRECOGNIZED_REPORT_STRUCTURE.
  //   - AI bỏ trống VÀ không có tín hiệu nào → UNSUPPORTED_DOCUMENT.
  //
  // Không dùng `companyName` làm tín hiệu: hợp đồng / hoá đơn cũng có tên công ty.
  const confirmedFinancial = successResults.some((r) => r.isFinancialReport === true);
  const explicitlyNotFinancial = !confirmedFinancial && successResults.some((r) => r.isFinancialReport === false);
  const hasFinancialSignal = confirmedFinancial || successResults.some(
    (r) => !!r.currency || !!r.unit || !!r.fromDate || !!r.toDate,
  );

  let locations = mergeLocations(successResults, totalPages, config.reportTypes);
  let recheckWindows = 0;
  const initialUnassignedPages = findUnassignedPages(locations, totalPages);
  const initialUnassignedPageReasons = deriveUnassignedPageReasons(
    initialUnassignedPages,
    mergePageLabelsByLatestResult(successResults),
  );
  const recheckResults: ClassifyResult[] = [];

  // Round 11B / T2.3: chỉ gọi lại AI cho trang có bảng nhưng chưa được gán.
  // Bìa/mục lục, văn xuôi và trang trắng không phải dấu hiệu mất báo cáo nên không recheck.
  if (config.classifyRecheckUnassigned && !explicitlyNotFinancial && hasFinancialSignal && initialUnassignedPages.length >= 2) {
    const recheckRanges = selectRecheckRanges(initialUnassignedPageReasons, config.classifyRecheckMaxWindows);
    const knownTitles = locations
      .map((location) => location.titleSource)
      .filter((title): title is string => !!title);

    for (const range of recheckRanges) {
      recheckWindows++;
      logger.info(`${LOG} Soi lại classify trang chưa gán ${range.from}-${range.to} (${recheckWindows}/${recheckRanges.length}).`);
      const result = await classifyWindow(
        ctx,
        fileName,
        source,
        range,
        totalPages,
        config,
        `${chunkKeyPrefix}-classify-recheck-${range.from}-${range.to}`,
        uploadedKeys,
        failureReasons,
        () => buildClassifyRecheckPrompt(
          range.from,
          range.to,
          totalPages,
          knownTitles,
          ctx.promptOverrides.classify,
          source.mode,
          config.supplementalReportTitleAliases,
        ),
        normalizationStats,
      );
      if (result) recheckResults.push(result);
    }

    if (recheckResults.length > 0) {
      const recoveredLocations = mergeLocations(recheckResults, totalPages, config.reportTypes)
        .map((location) => ({ ...location, fromRecheckPass: true }));
      locations = mergeLocationsWithRecheckPass([...locations, ...recoveredLocations], totalPages, config.reportTypes);
    }
  }

  const anyReportFound = locations.length > 0;
  if (!anyReportFound && (explicitlyNotFinancial || !hasFinancialSignal)) {
    throw new FinancialReportError('UNSUPPORTED_DOCUMENT', `Nội dung file "${fileName}" không phải báo cáo tài chính.`);
  }
  if (!anyReportFound) {
    throw new FinancialReportError(
      'UNRECOGNIZED_REPORT_STRUCTURE',
      `Không nhận diện được loại báo cáo nào trong file "${fileName}".`,
    );
  }

  const unassignedPages = findUnassignedPages(locations, totalPages);
  const unassignedPageReasons = deriveUnassignedPageReasons(
    unassignedPages,
    mergePageLabelsByLatestResult([...successResults, ...recheckResults]),
  );
  logger.info(
    `${LOG} Classify "${fileName}": phủ ${totalPages - unassignedPages.length}/${totalPages} trang; ` +
    `chưa gán: ${unassignedPages.join(', ') || 'không'}`,
  );

  return {
    sourceLanguage: pickSourceLanguage(successResults),
    documentType: pickFirstString(successResults.map((r) => r.documentType)),
    companyName: pickFirstString(successResults.map((r) => r.companyName)),
    fromDate: pickFirstString(successResults.map((r) => r.fromDate)),
    toDate: pickFirstString(successResults.map((r) => r.toDate)),
    currency: pickFirstString(successResults.map((r) => r.currency)),
    unit: pickFirstString(successResults.map((r) => r.unit)),
    locations,
    classifiedWindows: successResults.length,
    failedWindows,
    failureReasons,
    unassignedPages,
    unassignedPageReasons,
    recheckWindows,
    titlesRejectedAsProse: normalizationStats.titlesRejectedAsProse,
    pageNumberCorrections: normalizationStats.pageNumberCorrections ?? 0,
  };
}

async function classifyWindow(
  ctx: WorkflowContext,
  fileName: string,
  source: PageSource,
  win: { from: number; to: number },
  totalPages: number,
  config: FinancialReportConfig,
  keySuffix: string,
  uploadedKeys: string[],
  failureReasons: string[],
  promptBuilder?: () => Record<string, unknown>,
  normalizationStats?: ClassifyNormalizationStats,
): Promise<ClassifyResult | null> {
  const { logger } = ctx;
  const attempts = Math.max(1, config.maxRetries);
  const label = `classify trang ${win.from}-${win.to}`;
  const pushReason = (suffix: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    failureReasons.push(`${label} (${suffix}): ${msg.substring(0, 160)}`);
  };

  // CODE-REVIEW-01 mục 19: lỗi tách trang / upload storage chỉ làm mất CỬA SỔ này,
  // không throw lên orchestrator để giết cả file. Nếu MỌI cửa sổ đều fail thì
  // classifyDocument vẫn ném OCR_LOW_CONFIDENCE như trước (lúc đó thật sự không có gì để trả).
  let filesJson: string;
  try {
    const prepared = await prepareChunkAssets(source, ctx.operationId, fileName, keySuffix, win.from, win.to);
    filesJson = prepared.filesJson;
    uploadedKeys.push(...prepared.storageKeys);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `${LOG} Chuẩn bị cửa sổ classify trang ${win.from}-${win.to} thất bại ` +
      `(tách trang/upload storage): ${msg.substring(0, 200)}`,
    );
    pushReason('tách trang/upload storage', err);
    return null;
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const promptVars = promptBuilder
        ? promptBuilder()
        : buildClassifyPrompt(
          win.from,
          win.to,
          totalPages,
          ctx.promptOverrides.classify,
          source.mode,
          config.supplementalReportTitleAliases,
        );
      const result = await enqueueSubStep(
        ctx,
        CLASSIFY_CONNECTOR,
        promptVars,
        filesJson,
        ctx.modelOverrides.classify,
        ctx.reasoningEffortOverrides.classify,
      );
      const parsed = parseDeep(result.content) as Partial<ClassifyResult> | null;

      const hasLegacyReports = Array.isArray(parsed?.reports);
      const hasPageLabels = Array.isArray(parsed?.pages);
      if (!parsed || typeof parsed !== 'object' || (!hasLegacyReports && !hasPageLabels)) {
        throw new Error(`JSON classify không hợp lệ (attempt ${attempt})`);
      }

      const rejectedBefore = normalizationStats?.titlesRejectedAsProse ?? 0;
      const normalized = normalizeClassifyResult(parsed, win, totalPages, normalizationStats);
      if ((normalizationStats?.titlesRejectedAsProse ?? 0) > rejectedBefore) {
        const proseEntry = Array.isArray(parsed.pages)
          ? parsed.pages.find((page) => looksLikeProseTitle(nullableString(page?.titleFound)))
          : undefined;
        logger.warn(
          `${LOG} Loại nhãn TITLE câu văn ở trang ${Number(proseEntry?.page) || '?'}: ` +
          `"${(nullableString(proseEntry?.titleFound) ?? '').slice(0, 60)}"`,
        );
      }
      const classifyPath = normalized.pages?.length ? 'pages[]' : 'reports[]';
      logger.info(
        `${LOG} Classify trang ${win.from}-${win.to} (${classifyPath}): lang=${normalized.sourceLanguage}, ` +
        `tìm thấy ${normalized.reports.filter((r) => r.pageFrom != null).map((r) => r.reportType).join(', ') || 'none'}`,
      );
      return normalized;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < attempts) {
        logger.warn(`${LOG} Classify trang ${win.from}-${win.to} lỗi (attempt ${attempt}/${attempts}): ${msg.substring(0, 160)} → retry`);
        await sleep(2000 * attempt);
        continue;
      }
      logger.error(`${LOG} Classify trang ${win.from}-${win.to} thất bại sau ${attempts} lần: ${msg.substring(0, 200)}`);
      pushReason(`sau ${attempts} lần gọi AI`, err);
      return null;
    }
  }

  return null;
}

/** UAT #04 / T3 — chuẩn hoá đầu ra pages[] mới, vẫn giữ reports[] cho Profile override cũ. */
export function normalizeClassifyResult(
  raw: Partial<ClassifyResult>,
  win: { from: number; to: number },
  totalPages: number,
  normalizationStats?: ClassifyNormalizationStats,
): ClassifyResult {
  const pages = normalizePageLabels(raw.pages, win, normalizationStats);
  const reports = pages.length > 0
    ? reportsFromPageLabels(pages)
    : normalizeLegacyReports(raw.reports, win, totalPages);

  return {
    sourceLanguage: normalizeLanguage(raw.sourceLanguage),
    documentType: typeof raw.documentType === 'string' ? raw.documentType : undefined,
    blank: raw.blank === true,
    // Giữ tri-state: true / false / undefined (AI không trả) — mục 12.
    isFinancialReport: raw.isFinancialReport === true ? true : raw.isFinancialReport === false ? false : undefined,
    companyName: nullableString(raw.companyName),
    fromDate: nullableString(raw.fromDate),
    toDate: nullableString(raw.toDate),
    currency: nullableString(raw.currency),
    unit: nullableString(raw.unit),
    pages: pages.length > 0 ? pages : undefined,
    reports,
  };
}

function normalizeLegacyReports(
  entries: unknown,
  win: { from: number; to: number },
  totalPages: number,
): ClassifyResult['reports'] {
  const rawReports = Array.isArray(entries) ? entries : [];
  return REPORT_TYPES.map((reportType) => {
    const entry = rawReports.find((item) => item?.reportType === reportType);
    if (!entry || entry.pageFrom == null) {
      return { reportType, pageFrom: null, pageTo: null, titleFound: null };
    }
    const from = clamp(Number(entry.pageFrom), win.from, win.to);
    const rawTo = entry.pageTo == null ? from : Number(entry.pageTo);
    const to = clamp(Number.isFinite(rawTo) ? rawTo : from, from, Math.min(win.to, totalPages));
    return {
      reportType,
      pageFrom: from,
      pageTo: to,
      confidence: entry.confidence,
      titleFound: nullableString(entry.titleFound),
    };
  });
}

function normalizePageLabels(
  rawPages: unknown,
  win: { from: number; to: number },
  normalizationStats?: ClassifyNormalizationStats,
): NonNullable<ClassifyResult['pages']> {
  if (!Array.isArray(rawPages)) return [];

  const validBases = new Set(['TITLE', 'CONTINUATION', 'CONTINUATION_UNKNOWN', 'NONE']);
  const pages: NonNullable<ClassifyResult['pages']> = [];

  for (const rawPage of rawPages) {
    if (!rawPage || typeof rawPage !== 'object') continue;
    const entry = rawPage as Record<string, unknown>;
    const reportedPage = Number(entry.page);
    let basis = typeof entry.basis === 'string' && validBases.has(entry.basis) ? entry.basis : null;
    const rawReportType = entry.reportType;
    let reportType = typeof rawReportType === 'string' && REPORT_TYPES.includes(rawReportType as ReportType)
      ? rawReportType as ReportType
      : rawReportType === null ? null : undefined;

    if (!Number.isInteger(reportedPage) || !basis || reportType === undefined) continue;

    // Round 11 / T2.1: window một trang do CODE cấp có số trang chắc chắn; giữ entry hợp lệ
    // dù AI trả nhầm số trang và ghi nhận correction. Window nhiều trang giữ nguyên hành vi loại nhãn ngoài phạm vi.
    const page = win.from === win.to ? win.from : reportedPage;
    if (win.from === win.to && reportedPage !== page && normalizationStats) {
      normalizationStats.pageNumberCorrections = (normalizationStats.pageNumberCorrections ?? 0) + 1;
    }
    if (page < win.from || page > win.to) continue;

    const existing = pages.find((candidate) => candidate.page === page);
    if (existing) {
      // T10 / R4: model đôi khi trả tiêu đề cha và con thành hai nhãn cùng trang.
      // Chỉ gộp hai TITLE cùng loại, không tự hoà giải hai reportType mâu thuẫn.
      if (existing.basis === 'TITLE' && basis === 'TITLE' && existing.reportType === reportType) {
        const titleFound = pickMostSpecificTitle([existing.titleFound, nullableString(entry.titleFound)]);
        existing.titleFound = titleFound;
        if (looksLikeProseTitle(titleFound)) {
          existing.reportType = null;
          existing.basis = 'NONE';
          existing.titleFound = null;
          if (normalizationStats) normalizationStats.titlesRejectedAsProse++;
        }
      }
      continue;
    }

    const titleFound = nullableString(entry.titleFound);
    const hasTable = entry.hasTable === true;
    const blank = entry.blank === true;
    let preserveTitleEvidence = true;
    // T10 / R5: không để một câu văn trong thuyết minh tạo location báo cáo giả.
    if (basis === 'TITLE' && looksLikeProseTitle(titleFound)) {
      reportType = null;
      basis = 'NONE';
      // Giữ nguyên hành vi cũ: một TITLE bị bác vì là câu văn không trở thành evidence mục lục.
      preserveTitleEvidence = false;
      if (normalizationStats) normalizationStats.titlesRejectedAsProse++;
    }
    pages.push({
      page,
      reportType,
      basis: basis as NonNullable<ClassifyResult['pages']>[number]['basis'],
      // T2.3 cần title mục lục (目次 / contents) khi model trả basis=NONE; chỉ title bị T10 bác bỏ mới bị xoá.
      titleFound: preserveTitleEvidence ? titleFound : null,
      ...(hasTable ? { hasTable: true } : {}),
      ...(blank ? { blank: true } : {}),
    });
  }

  return pages.sort((a, b) => a.page - b.page);
}

/**
 * Round 11B / T2.2 — nối trang tiếp nối bằng CODE sau khi classify song song đã trả đủ nhãn.
 * Chỉ page P có bảng, chưa có reportType và có predecessor P-1 đã được gán mới được nhận loại đó.
 */
export function applyDeterministicContinuations(labels: readonly ClassifyPageLabel[]): ClassifyPageLabel[] {
  const ordered = [...labels]
    .map((label) => ({ ...label }))
    .sort((a, b) => a.page - b.page);
  const resolvedByPage = new Map<number, ClassifyPageLabel>();

  for (const label of ordered) {
    const predecessor = resolvedByPage.get(label.page - 1);
    if (label.reportType === null && label.hasTable && predecessor?.reportType) {
      label.reportType = predecessor.reportType;
      label.basis = 'CONTINUATION';
    }
    resolvedByPage.set(label.page, label);
  }

  return ordered;
}

function applyDeterministicContinuationsToResults(results: ClassifyResult[]): ClassifyResult[] {
  const resolvedByPage = new Map(
    applyDeterministicContinuations(results.flatMap((result) => result.pages ?? []))
      .map((label) => [label.page, label] as const),
  );

  return results.map((result) => {
    if (!result.pages) return result;
    const pages = result.pages.map((label) => resolvedByPage.get(label.page) ?? label);
    return { ...result, pages, reports: reportsFromPageLabels(pages) };
  });
}

/**
 * Gộp nhãn cùng trang theo lượt mới nhất (lượt recheck ghi đè lượt đầu), rồi mới áp T2.2.
 * Nhờ vậy taxonomy cuối phản ánh nhãn đã recheck nhưng vẫn nối continuation hoàn toàn tất định.
 */
function mergePageLabelsByLatestResult(results: readonly ClassifyResult[]): ClassifyPageLabel[] {
  const labelsByPage = new Map<number, ClassifyPageLabel>();
  for (const result of results) {
    for (const label of result.pages ?? []) labelsByPage.set(label.page, label);
  }
  return applyDeterministicContinuations([...labelsByPage.values()]);
}

function reportsFromPageLabels(pages: NonNullable<ClassifyResult['pages']>): ClassifyResult['reports'] {
  const reports: ClassifyResult['reports'] = [];
  let current: ClassifyResult['reports'][number] | null = null;

  const flush = () => {
    if (current) reports.push(current);
    current = null;
  };

  for (const page of pages) {
    if (!page.reportType) {
      flush();
      continue;
    }

    // UAT #04 / T3: TITLE cùng loại nhưng ở trang kế là biến thể mới; không được nuốt vào location cũ.
    const continuesCurrent = current
      && current.reportType === page.reportType
      && current.pageTo != null
      && page.page === current.pageTo + 1
      && page.basis !== 'TITLE';

    if (continuesCurrent && current) {
      current.pageTo = page.page;
      continue;
    }

    flush();
    current = {
      reportType: page.reportType,
      pageFrom: page.page,
      pageTo: page.page,
      titleFound: page.basis === 'TITLE' ? page.titleFound : null,
    };
  }
  flush();

  return reports;
}

/** UAT #04 / T1 — trang 1..totalPages không nằm trong location nào. */
export function findUnassignedPages(locations: ReportLocation[], totalPages: number): number[] {
  const covered = new Set<number>();
  for (const location of locations) {
    for (let page = location.pageFrom; page <= location.pageTo; page++) covered.add(page);
  }

  const unassigned: number[] = [];
  for (let page = 1; page <= totalPages; page++) {
    if (!covered.has(page)) unassigned.push(page);
  }
  return unassigned;
}

/**
 * Round 11B / T2.3 — suy taxonomy trang chưa gán hoàn toàn từ label đã chuẩn hoá.
 *
 * Điều kiện BLANK và TABLE_UNCLASSIFIED được xét trước để một trang có bảng chưa gán
 * không bị che bởi dấu hiệu bìa/mục lục. Cover/index đứng trước prose vì điều khoản
 * quy định trang 1–3 hoặc title 目次/contents là bìa/mục lục; các trang còn lại không
 * có bảng và basis NONE là văn xuôi.
 */
export function deriveUnassignedPageReasons(
  unassignedPages: readonly number[],
  pageLabels: readonly ClassifyPageLabel[],
): UnassignedPageReason[] {
  const labelsByPage = new Map<number, ClassifyPageLabel>();
  for (const label of pageLabels) labelsByPage.set(label.page, label);

  const pages = [...new Set(unassignedPages)]
    .filter((page) => Number.isInteger(page) && page >= 1)
    .sort((a, b) => a - b);

  return pages.map((page) => {
    const label = labelsByPage.get(page);
    const hasTable = label?.hasTable === true;

    if (label?.blank === true) return { page, reason: 'BLANK' };
    if (hasTable && label?.reportType === null) return { page, reason: 'TABLE_UNCLASSIFIED' };
    if (!hasTable && (page <= 3 || /目次|contents/i.test(label?.titleFound ?? ''))) {
      return { page, reason: 'COVER_OR_INDEX' };
    }
    if (!hasTable && label?.basis === 'NONE') return { page, reason: 'PROSE_ONLY' };
    return { page, reason: 'OTHER' };
  });
}

/** Round 11B / T2.3 — chỉ gom các trang có bảng nhưng chưa được phân loại để soi lại. */
export function selectRecheckRanges(
  unassignedPageReasons: readonly UnassignedPageReason[],
  maxWindows: number,
): Array<{ from: number; to: number }> {
  const pages = [...new Set(
    unassignedPageReasons
      .filter((entry) => entry.reason === 'TABLE_UNCLASSIFIED')
      .map((entry) => entry.page),
  )]
    .filter((page) => Number.isInteger(page) && page >= 1)
    .sort((a, b) => a - b);
  const ranges: Array<{ from: number; to: number }> = [];

  for (const page of pages) {
    const current = ranges[ranges.length - 1];
    if (current && page === current.to + 1) current.to = page;
    else ranges.push({ from: page, to: page });
  }

  return ranges
    .sort((a, b) => (b.to - b.from) - (a.to - a.from) || a.from - b.from)
    .slice(0, Math.max(0, Math.floor(maxWindows)));
}

/**
 * T10 / R5 — Tiêu đề do AI trả về có phải chỉ là câu văn tham chiếu?
 *
 * Trang chính sách kế toán của Sony (trang in 22-23) nhắc tên báo cáo nhiều lần trong câu.
 * Nếu nhận nhầm thành tiêu đề thì sinh ra location Bảng cân đối giả nằm trong thuyết minh,
 * và kết quả báo FOUND với nội dung rác — tệ hơn NOT_FOUND.
 */
export function looksLikeProseTitle(title: string | null): boolean {
  const text = (title ?? '').trim();
  if (!text) return false;
  if (text.length > 60) return true;
  if (/[。、]/.test(text)) return true;
  return /参照|ください|については|ページ/.test(text);
}

/**
 * T10 / R4 — Trong nhiều tiêu đề tìm thấy trên CÙNG một trang, chọn tiêu đề cụ thể nhất.
 * Tokyu trang in 7: tiêu đề cha 「連結損益計算書及び連結包括利益計算書」 bao hai báo cáo,
 * tiêu đề con 「（連結損益計算書）」 mới là báo cáo thật của trang đó.
 */
export function pickMostSpecificTitle(titles: Array<string | null>): string | null {
  const valid = titles.filter((t): t is string => !!t && t.trim() !== '').map((t) => t.trim());
  if (valid.length === 0) return null;
  const notCombined = valid.filter((t) => !/及び|\band\b/i.test(t));
  const pool = notCombined.length > 0 ? notCombined : valid;
  // Ngắn hơn = ít bao trùm hơn = cụ thể hơn.
  return pool.reduce((best, cur) => (cur.length < best.length ? cur : best), pool[0]);
}

/** UAT #04 / T5 — suy phạm vi kỳ từ tiêu đề để ưu tiên số liệu cả năm trước số liệu quý. */
export function detectPeriodScope(title: string | null): PeriodScope {
  const normalizedTitle = (title ?? '').toLowerCase();
  if (!normalizedTitle) return 'UNKNOWN';

  // UAT #04 / T5: `第４四半期連結会計期間` có cả 四半期 và 年度, nên quý phải xét trước.
  if (normalizedTitle.includes('四半期') || normalizedTitle.includes('quarter') || normalizedTitle.includes('three months')) {
    return 'QUARTER';
  }
  if (normalizedTitle.includes('中間') || normalizedTitle.includes('six months') || normalizedTitle.includes('interim') || normalizedTitle.includes('half')) {
    return 'HALF_YEAR';
  }
  if (normalizedTitle.includes('年度') || normalizedTitle.includes('通期') || normalizedTitle.includes('year ended') || normalizedTitle.includes('fiscal year')) {
    return 'FULL_YEAR';
  }
  return 'UNKNOWN';
}

/**
 * Cột chênh lệch giữa hai kỳ — KHÔNG mang kỳ báo cáo nào, phải loại trước khi suy kỳ từ cột.
 * Sony để cột `増減` cạnh hai cột kỳ; tính cả cột này vào sẽ làm nhiễu kết quả suy.
 */
const VARIANCE_COLUMN_PATTERN = /増減|変動|variance|change|diff/i;

/**
 * R1 (bổ sung sau UAT Sony 2026-08-06) — suy phạm vi kỳ từ TIÊU ĐỀ CỘT khi tiêu đề báo cáo
 * không có dấu hiệu kỳ.
 *
 * Sony ghi tiêu đề trần `連結損益計算書` cho CẢ bảng cả năm và bảng quý 4; kỳ chỉ xuất hiện ở
 * tiêu đề cột (`2024年度(自 … 至 …)` so với `第４四半期連結会計期間`). Nếu chỉ suy từ tiêu đề thì
 * mọi bảng ra UNKNOWN và R1 mất căn cứ chọn, dẫn tới giữ cả bảng quý — đúng lỗi UAT đã gặp.
 *
 * Nhiều loại kỳ khác nhau trong CÙNG một bảng thì trả UNKNOWN: không đủ chắc để R1 loại bảng,
 * và thà giữ thừa dữ liệu còn hơn bỏ mất bảng hợp lệ.
 */
export function detectPeriodScopeFromColumns(columns: TableColumn[]): PeriodScope {
  const scopes = new Set<PeriodScope>();

  for (const column of columns) {
    const labelSource = column.label?.source ?? '';
    if (VARIANCE_COLUMN_PATTERN.test(labelSource)) continue;

    const scope = detectPeriodScope(`${labelSource} ${column.period ?? ''}`);
    if (scope !== 'UNKNOWN') scopes.add(scope);
  }

  return scopes.size === 1 ? [...scopes][0] : 'UNKNOWN';
}

/** UAT #04 / T5 — phân biệt lãi lỗ và thu nhập toàn diện trong cùng họ incomeStatement. */
export function detectStatementKind(title: string | null): StatementKind {
  const sourceTitle = title ?? '';
  const hasProfitLoss = sourceTitle.includes('損益計算書')
    || /income statement|statement of (income|operations|profit)/i.test(sourceTitle);
  const hasComprehensiveIncome = sourceTitle.includes('包括利益') || /comprehensive income/i.test(sourceTitle);

  if (hasProfitLoss && hasComprehensiveIncome) return 'COMBINED';
  if (hasComprehensiveIncome) return 'COMPREHENSIVE_INCOME';
  if (hasProfitLoss) return 'PROFIT_LOSS';
  return 'OTHER';
}

/**
 * R3 — Suy bộ báo cáo là HỢP NHẤT hay RIÊNG LẺ từ tiêu đề.
 *
 * Xét RIÊNG LẺ TRƯỚC vì các mốc phủ định chứa chuỗi con của mốc hợp nhất:
 * `非連結`/`non-consolidated`/`unconsolidated` đều chứa `連結`/`consolidated` nhưng nghĩa là KHÔNG
 * hợp nhất. Mục lục kiểu `４．個別財務諸表` / `３．連結財務諸表` cũng khớp qua các mốc này.
 * Không suy được → null (không đủ căn cứ, ưu tiên không loại nhầm dữ liệu).
 */
export function detectConsolidation(title: string | null): Consolidation | null {
  const text = title ?? '';
  if (!text) return null;
  if (/非連結|個別|単体|separate|standalone|stand-alone|non[-\s]?consolidated|unconsolidated/i.test(text)) {
    return 'SEPARATE';
  }
  if (/連結|consolidated/i.test(text)) return 'CONSOLIDATED';
  return null;
}

function mergeLocationsWithRecheckPass(
  locations: ReportLocation[],
  totalPages: number,
  allowedTypes: ReportType[],
): ReportLocation[] {
  const merged = mergeLocations(
    locations.map((location) => ({
      sourceLanguage: UNKNOWN_LANGUAGE,
      reports: [{
        reportType: location.reportType,
        pageFrom: location.pageFrom,
        pageTo: location.pageTo,
        titleFound: location.titleSource,
      }],
    })),
    totalPages,
    allowedTypes,
  );

  return merged.map((location) => ({
    ...location,
    fromRecheckPass: locations.some((candidate) => candidate.fromRecheckPass
      && candidate.reportType === location.reportType
      && candidate.pageFrom <= location.pageTo
      && candidate.pageTo >= location.pageFrom),
  }));
}

/** Gộp page range của cùng reportType từ nhiều cửa sổ thành một dải liền. */
export function mergeLocations(
  results: ClassifyResult[],
  totalPages: number,
  allowedTypes: ReportType[],
): ReportLocation[] {
  const filter = allowedTypes.length > 0 ? new Set(allowedTypes) : null;
  const locations: ReportLocation[] = [];

  for (const reportType of REPORT_TYPES) {
    if (filter && !filter.has(reportType)) continue;

    const hits = results
      .flatMap((r) => r.reports)
      .filter((entry) => entry.reportType === reportType && entry.pageFrom != null)
      .map((entry) => ({
        from: entry.pageFrom as number,
        to: entry.pageTo ?? (entry.pageFrom as number),
        title: entry.titleFound ?? null,
      }))
      .sort((a, b) => a.from - b.from);

    if (hits.length === 0) continue;

    // Gộp các dải liền kề / chồng nhau (bảng bị cắt qua trang giữa 2 cửa sổ classify)
    let current = { from: hits[0].from, to: hits[0].to, title: hits[0].title };
    const merged: typeof current[] = [];
    for (let i = 1; i < hits.length; i++) {
      const next = hits[i];
      // UAT #04 / T2: chỉ nối khi dải sau không có tiêu đề riêng, hoặc lặp lại đúng tiêu đề.
      // Dải có tiêu đề khác là báo cáo biến thể khác (Sony: KQKD năm và quý 4), không được trộn số liệu.
      const isContinuation = next.title == null || next.title === current.title;
      if (next.from <= current.to + 1 && isContinuation) {
        current.to = Math.max(current.to, next.to);
        current.title = current.title ?? next.title;
      } else {
        merged.push(current);
        current = { from: next.from, to: next.to, title: next.title };
      }
    }
    merged.push(current);

    for (const range of merged) {
      locations.push({
        reportType,
        pageFrom: clamp(range.from, 1, totalPages),
        pageTo: clamp(range.to, range.from, totalPages),
        titleSource: range.title,
        consolidation: detectConsolidation(range.title),
      });
    }
  }

  return locations;
}

function pickSourceLanguage(results: ClassifyResult[]): SourceLanguage {
  const votes = new Map<SourceLanguage, number>();
  for (const r of results) {
    if (r.sourceLanguage === UNKNOWN_LANGUAGE) continue;
    votes.set(r.sourceLanguage, (votes.get(r.sourceLanguage) ?? 0) + 1);
  }
  let best: SourceLanguage = UNKNOWN_LANGUAGE;
  let bestCount = 0;
  for (const [lang, count] of votes) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  return best;
}

/** Tên ngôn ngữ hay gặp → mã ISO 639-1, dùng khi model trả tên thay vì mã. */
const LANGUAGE_NAME_TO_ISO: Array<{ iso: string; hints: string[] }> = [
  { iso: 'ja', hints: ['japan', 'nihongo', '日本語', '日本'] },
  { iso: 'en', hints: ['english', 'anh'] },
  { iso: 'ko', hints: ['korean', 'hangul', '한국', '韓国'] },
  { iso: 'zh', hints: ['chinese', 'mandarin', '中文', '中国語'] },
  { iso: 'vi', hints: ['vietnamese', 'tiếng việt'] },
  { iso: 'th', hints: ['thai', 'ไทย'] },
];

/**
 * Q1 — Chuẩn hoá về mã ISO 639-1 chữ thường, KHÔNG giới hạn danh sách đóng.
 * Model trả đúng mã 2 chữ cái → dùng luôn (hỗ trợ ngôn ngữ mới không cần sửa code).
 * Model trả tên ngôn ngữ → map qua bảng trên. Không nhận diện được → `unknown`.
 */
function normalizeLanguage(value: unknown): SourceLanguage {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) return UNKNOWN_LANGUAGE;

  // Mã ISO 639-1 thuần (ja, en, ko...) hoặc dạng có vùng (ja-jp, en_US)
  const isoMatch = text.match(/^([a-z]{2})(?:[-_][a-z]{2,4})?$/);
  if (isoMatch) return isoMatch[1];

  for (const { iso, hints } of LANGUAGE_NAME_TO_ISO) {
    if (hints.some((h) => text.includes(h))) return iso;
  }
  return UNKNOWN_LANGUAGE;
}

function pickFirstString(values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}
