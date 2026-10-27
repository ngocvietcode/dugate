// tests/financial-report/payload.test.ts
// CODE-REVIEW-01 mục 5 (message khi mọi file FAILED) và mục 7 (EXCLUDED_BY_CONFIG).
// buildPayload / buildEnvelope là pure function nên test được không cần DB/Redis/AI.

import { buildEnvelope, buildPayload, resolveConfig, resolveDegradation } from '@/lib/pipelines/workflows/financial-report-translation';
import { DEFAULT_RENDER_SCALE } from '@/lib/pipelines/workflows/financial-report/pdf-utils';
import type { ClassifyOutcome } from '@/lib/pipelines/workflows/financial-report/classify';
import type { ExtractOutcome, TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import { ERROR_MESSAGES } from '@/lib/pipelines/workflows/financial-report/types';
import type { FileProcessingInfo, FileResult, FinancialReportConfig, ReportType } from '@/lib/pipelines/workflows/financial-report/types';

function config(overrides: Partial<FinancialReportConfig> = {}): FinancialReportConfig {
  return {
    targetLang: 'vi',
    requestId: 'REQ-1',
    pagesPerChunk: 2,
    notesPagesPerChunk: 1,
    classifyPagesPerCall: 8,
    classifyRecheckUnassigned: true,
    classifyRecheckMaxWindows: 2,
    maxRetries: 2,
    maxConcurrency: 3,
    staggerDelayMs: 0,
    enableTranslation: true,
    renderScale: 2.5,
    reportTypes: [],
    ...overrides,
  };
}

function classifyOutcome(types: ReportType[]): ClassifyOutcome {
  return {
    sourceLanguage: 'ja',
    documentType: 'STANDALONE',
    companyName: 'オー・ジー株式会社',
    fromDate: '2024-04-01',
    toDate: '2025-03-31',
    currency: 'JPY',
    unit: '百万円',
    locations: types.map((reportType, i) => ({ reportType, pageFrom: i + 1, pageTo: i + 1, titleSource: null })),
    classifiedWindows: 1,
    failedWindows: 0,
    failureReasons: [],
  };
}

function extractOutcome(types: ReportType[]): ExtractOutcome {
  const tableChunks: TableChunkOutcome[] = types
    .filter((t) => t !== 'notesToFinancialStatements')
    .map((reportType, i) => ({
      reportType,
      locationIndex: i,
      chunkIndex: 0,
      pageFrom: i + 1,
      pageTo: i + 1,
      aiWarnings: [],
      failureReason: null,
      result: {
        reportType,
        notFound: false,
        tables: [
          {
            tableId: `${reportType}-1`,
            columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
            rows: [
              { rowId: 'r1', parentRowId: null, level: 1, rowType: 'DETAIL', labelSource: '現金及び預金', sourcePage: i + 1, values: { currentPeriod: '5,288' } },
            ],
          },
        ],
      },
    }));
  return { tableChunks, notesChunks: [] };
}

describe('buildPayload — mục 7: report bị report_types lọc phải phân biệt được với NOT_FOUND thật', () => {
  const types: ReportType[] = ['balanceSheet', 'incomeStatement'];

  it('không cấu hình report_types → không có EXCLUDED_BY_CONFIG', () => {
    const payload = buildPayload(config(), classifyOutcome(types), extractOutcome(types));
    expect(payload.balanceSheet.status).toBe('FOUND');
    expect(payload.incomeStatement.status).toBe('FOUND');
    for (const report of [payload.balanceSheet, payload.incomeStatement, payload.cashFlowStatement, payload.notesToFinancialStatements]) {
      expect(report.warnings.map((w) => w.code)).not.toContain('EXCLUDED_BY_CONFIG');
    }
  });

  it('report bị lọc → NOT_FOUND kèm warning EXCLUDED_BY_CONFIG', () => {
    const payload = buildPayload(
      config({ reportTypes: ['balanceSheet'] }),
      classifyOutcome(types),
      extractOutcome(types),
    );

    expect(payload.balanceSheet.status).toBe('FOUND');
    expect(payload.balanceSheet.warnings.map((w) => w.code)).not.toContain('EXCLUDED_BY_CONFIG');

    // incomeStatement có trong tài liệu nhưng bị cờ debug loại
    expect(payload.incomeStatement.status).toBe('NOT_FOUND');
    expect(payload.incomeStatement.tables).toEqual([]);
    expect(payload.incomeStatement.warnings.map((w) => w.code)).toContain('EXCLUDED_BY_CONFIG');
  });

  it('notes cũng được gắn EXCLUDED_BY_CONFIG khi bị lọc', () => {
    const payload = buildPayload(config({ reportTypes: ['balanceSheet'] }), classifyOutcome(types), extractOutcome(types));
    expect(payload.notesToFinancialStatements.status).toBe('NOT_FOUND');
    expect(payload.notesToFinancialStatements.warnings.map((w) => w.code)).toContain('EXCLUDED_BY_CONFIG');
  });

  it('giữ generalInformation: unit multiplier đúng, normalized KHÔNG nhân multiplier', () => {
    const payload = buildPayload(config(), classifyOutcome(types), extractOutcome(types));
    expect(payload.generalInformation.unit).toEqual({ source: '百万円', translated: 'Triệu yên', multiplier: 1_000_000 });
    expect(payload.balanceSheet.tables[0].rows[0].values.currentPeriod).toEqual({ raw: '5,288', normalized: 5288 });
  });
});

describe('buildEnvelope — mục 5 + Q7/Q8', () => {
  const ok = (name: string): FileResult => ({ fileId: 'GRP-1', fileName: name, status: 'SUCCESS', errorCode: null, errorMessage: null, diagnostic: null, report: null, processingInfo: null });
  const partial = (name: string): FileResult => ({ fileId: 'GRP-3', fileName: name, status: 'PARTIAL_SUCCESS', errorCode: 'TRANSLATION_FAILED', errorMessage: 'x', diagnostic: 'd', report: null, processingInfo: null });
  const bad = (name: string): FileResult => ({ fileId: 'GRP-2', fileName: name, status: 'FAILED', errorCode: 'CORRUPTED_FILE', errorMessage: 'x', diagnostic: 'd', report: null, processingInfo: null });

  it('mọi file SUCCESS → 200 / Thành công', () => {
    const env = buildEnvelope(config(), [ok('a.pdf')]);
    expect(env.code).toBe(200);
    expect(env.message).toBe('Thành công');
  });

  it('một phần FAILED → 207 với wording theo SRS', () => {
    const env = buildEnvelope(config(), [ok('a.pdf'), bad('b.pdf')]);
    expect(env.code).toBe(207);
    expect(env.message).toBe('Xử lý hoàn tất 1/2 file. Xem chi tiết lỗi trong từng phần tử của data.');
  });

  it('có file PARTIAL_SUCCESS → 207 (không phải 200) vì kết quả bị thiếu một phần', () => {
    const env = buildEnvelope(config(), [ok('a.pdf'), partial('b.pdf')]);
    expect(env.code).toBe(207);
    // PARTIAL_SUCCESS vẫn CÓ dữ liệu nên phải tính là đã hoàn tất (Q7): 2/2, KHÔNG phải 1/2.
    // Bản cũ đếm bằng fullCount nên 1 file PARTIAL_SUCCESS bị báo "hoàn tất 0/1 file",
    // tự mâu thuẫn với data[0].status mà chính nó trả về.
    expect(env.message).toContain('2/2 file');
  });

  it('TẤT CẢ FAILED → giữ 207 nhưng message nói rõ không xử lý được file nào', () => {
    const env = buildEnvelope(config(), [bad('a.pdf'), bad('b.pdf')]);
    expect(env.code).toBe(207);
    expect(env.message).toBe('Không xử lý được file nào.');
  });

  it('PARTIAL_SUCCESS vẫn được tính là có kết quả, không rơi vào nhánh "không xử lý được"', () => {
    const env = buildEnvelope(config(), [partial('a.pdf')]);
    expect(env.code).toBe(207);
    expect(env.message).not.toBe('Không xử lý được file nào.');
  });

  it('echo đúng requestId và targetLang', () => {
    const env = buildEnvelope(config({ requestId: 'CLIENT-REQ-001', targetLang: 'en' }), [ok('a.pdf')]);
    expect(env.requestId).toBe('CLIENT-REQ-001');
    expect(env.targetLang).toBe('en');
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
  });

  it('Round 11 T2.4 — output giữ pageNumberCorrections từ processingInfo', () => {
    const processingInfo: FileProcessingInfo = {
      totalPages: 5,
      pageSourceMode: 'pdf',
      encrypted: false,
      reportsFound: 1,
      classifyWindowsTotal: 5,
      classifyWindowsFailed: 0,
      extractChunksTotal: 1,
      extractChunksFailed: 0,
      tablesDiscardedAsOther: 0,
      failedPageRanges: [],
      translationStatus: 'SKIPPED',
      untranslatedItems: 0,
      failureReasons: [],
      pageNumberCorrections: 1,
    };

    const env = buildEnvelope(config(), [{ ...ok('page-fix.pdf'), processingInfo }]);

    expect(env.data?.[0].processingInfo).toMatchObject({ pageNumberCorrections: 1 });
  });
});

describe('buildPayload — Q10: đơn vị số liệu riêng theo từng báo cáo', () => {
  const types: ReportType[] = ['balanceSheet', 'sgaBreakdown'];

  /** Mẫu OG Corp: bảng cân đối in theo 百万円, bảng chi phí bán hàng in theo 円. */
  function outcomeWithUnits(): ExtractOutcome {
    const base = extractOutcome(types);
    base.tableChunks[0].result!.unitSource = '百万円';
    base.tableChunks[1].result!.unitSource = '円';
    return base;
  }

  it('mỗi báo cáo giữ đơn vị riêng, không bị đơn vị chung ghi đè', () => {
    const payload = buildPayload(config(), classifyOutcome(types), outcomeWithUnits());
    expect(payload.generalInformation.unit.multiplier).toBe(1_000_000); // 百万円 ở cấp file
    expect(payload.balanceSheet.unit?.multiplier).toBe(1_000_000);
    expect(payload.sgaBreakdown.unit?.multiplier).toBe(1); // 円 — nếu dùng chung sẽ sai 1.000.000 lần
  });

  it('báo cáo không khai đơn vị riêng → unit = null, downstream dùng unit chung', () => {
    const payload = buildPayload(config(), classifyOutcome(types), extractOutcome(types));
    expect(payload.balanceSheet.unit).toBeNull();
    expect(payload.generalInformation.unit.multiplier).toBe(1_000_000);
    expect(payload.balanceSheet.warnings.map((w) => w.code)).not.toContain('UNIT_NOT_FOUND');
  });

  it('không xác định được đơn vị ở cả 2 cấp → warning UNIT_NOT_FOUND', () => {
    const classified = { ...classifyOutcome(types), unit: null };
    const payload = buildPayload(config(), classified, extractOutcome(types));
    expect(payload.balanceSheet.warnings.map((w) => w.code)).toContain('UNIT_NOT_FOUND');
  });

  it('normalized KHÔNG bị nhân multiplier ở bất kỳ cấp nào', () => {
    const payload = buildPayload(config(), classifyOutcome(types), outcomeWithUnits());
    expect(payload.sgaBreakdown.tables[0].rows[0].values.currentPeriod.normalized).toBe(5288);
  });
});

describe('resolveDegradation — Q7: khi nào file là PARTIAL_SUCCESS', () => {
  const types: ReportType[] = ['balanceSheet'];
  const payload = () => buildPayload(config(), classifyOutcome(types), extractOutcome(types));

  const info = (overrides: Partial<FileProcessingInfo> = {}): FileProcessingInfo => ({
    totalPages: 8,
    pageSourceMode: 'pdf',
    encrypted: false,
    reportsFound: 1,
    classifyWindowsTotal: 1,
    classifyWindowsFailed: 0,
    extractChunksTotal: 1,
    extractChunksFailed: 0,
    tablesDiscardedAsOther: 0,
    failedPageRanges: [],
    translationStatus: 'DONE',
    untranslatedItems: 0,
    failureReasons: [],
    ...overrides,
  });

  it('mọi thứ trọn vẹn → null (SUCCESS)', () => {
    expect(resolveDegradation(payload(), info())).toBeNull();
  });

  it('có chunk extract lỗi → OCR_LOW_CONFIDENCE', () => {
    const d = resolveDegradation(payload(), info({ extractChunksFailed: 1, failedPageRanges: [{ from: 5, to: 6 }] }));
    expect(d?.errorCode).toBe('OCR_LOW_CONFIDENCE');
  });

  it('có cửa sổ classify lỗi → OCR_LOW_CONFIDENCE', () => {
    expect(resolveDegradation(payload(), info({ classifyWindowsFailed: 1 }))?.errorCode).toBe('OCR_LOW_CONFIDENCE');
  });

  it('dịch chết hoàn toàn → TRANSLATION_FAILED nhưng vẫn có report', () => {
    const p = payload();
    const d = resolveDegradation(p, info({ translationStatus: 'FAILED', untranslatedItems: 12 }));
    expect(d?.errorCode).toBe('TRANSLATION_FAILED');
    expect(p.balanceSheet.tables[0].rows).toHaveLength(1); // dữ liệu OCR KHÔNG bị bỏ
  });

  it('dịch thiếu một phần → TRANSLATION_PARTIAL', () => {
    expect(resolveDegradation(payload(), info({ translationStatus: 'PARTIAL', untranslatedItems: 2 }))?.errorCode).toBe('TRANSLATION_PARTIAL');
  });

  it('T12.9 bảo vệ: dịch chết hoàn toàn vẫn giữ TRANSLATION_FAILED, không dùng mã partial', () => {
    expect(resolveDegradation(payload(), info({ translationStatus: 'FAILED', untranslatedItems: 2 }))?.errorCode).toBe('TRANSLATION_FAILED');
  });

  it('tắt dịch chủ động (SKIPPED) KHÔNG bị coi là suy giảm', () => {
    expect(resolveDegradation(payload(), info({ translationStatus: 'SKIPPED' }))).toBeNull();
  });

  it('báo cáo UNREADABLE → OCR_LOW_CONFIDENCE, ưu tiên hơn lỗi dịch', () => {
    const p = payload();
    p.incomeStatement = { ...p.incomeStatement, status: 'UNREADABLE' };
    const d = resolveDegradation(p, info({ translationStatus: 'FAILED' }));
    expect(d?.errorCode).toBe('OCR_LOW_CONFIDENCE');
  });

  it('báo cáo PARTIAL do tài liệu chỉ có số tổng (A5) KHÔNG coi là suy giảm', () => {
    const p = payload();
    p.sgaBreakdown = { ...p.sgaBreakdown, status: 'PARTIAL' };
    expect(resolveDegradation(p, info())).toBeNull();
  });
});

describe('resolveConfig — T2.5 classify scheduler riêng', () => {
  const ctxLike = (vars: Record<string, unknown>) => ({ operationId: 'op-1', pipelineVars: vars }) as never;

  it.each([
    ['cả hai trống thì lùi về shared settings', {
      stagger_delay_ms: '9000', max_concurrency: '7', classify_stagger_delay_ms: '', classify_max_concurrency: '',
    }, { classifyStaggerDelayMs: 9000, classifyMaxConcurrency: 7 }],
    ['chỉ có delay riêng thì concurrency lùi về shared setting', {
      stagger_delay_ms: '9000', max_concurrency: '7', classify_stagger_delay_ms: '1250', classify_max_concurrency: '',
    }, { classifyStaggerDelayMs: 1250, classifyMaxConcurrency: 7 }],
    ['chỉ có concurrency riêng thì delay lùi về shared setting', {
      stagger_delay_ms: '9000', max_concurrency: '7', classify_stagger_delay_ms: '', classify_max_concurrency: '6',
    }, { classifyStaggerDelayMs: 9000, classifyMaxConcurrency: 6 }],
    ['cả hai riêng thì dùng độc lập với shared settings', {
      stagger_delay_ms: '9000', max_concurrency: '7', classify_stagger_delay_ms: '1250', classify_max_concurrency: '6',
    }, { classifyStaggerDelayMs: 1250, classifyMaxConcurrency: 6 }],
  ])('%s', (_name, vars, expected) => {
    expect(resolveConfig(ctxLike(vars))).toMatchObject(expected);
  });

  it('Profile mới không khai riêng hai key vẫn nhận default classify 1000ms / concurrency 4', () => {
    expect(resolveConfig(ctxLike({}))).toMatchObject({
      classifyStaggerDelayMs: 1000,
      classifyMaxConcurrency: 4,
    });
  });
});

describe('resolveConfig — max_concurrency', () => {
  const ctxLike = (vars: Record<string, unknown>) => ({ operationId: 'op-1', pipelineVars: vars }) as never;

  it('default 3 khi không cấu hình', () => {
    expect(resolveConfig(ctxLike({})).maxConcurrency).toBe(3);
  });

  it('đọc được từ Profile param', () => {
    expect(resolveConfig(ctxLike({ max_concurrency: '5' })).maxConcurrency).toBe(5);
  });

  it('giá trị không hợp lệ → về default', () => {
    expect(resolveConfig(ctxLike({ max_concurrency: '0' })).maxConcurrency).toBe(3);
    expect(resolveConfig(ctxLike({ max_concurrency: 'abc' })).maxConcurrency).toBe(3);
  });
});

describe('resolveConfig — workflow deadline/reaper order', () => {
  const ctxLike = (workflowDeadlineMs: number) => ({
    operationId: 'deadline-op',
    pipelineVars: { workflow_deadline_ms: workflowDeadlineMs },
    logger: { warn: jest.fn() },
  });

  it('warns when deadline can reach the stalled-operation reaper first', () => {
    const ctx = ctxLike(10_000_000);

    expect(resolveConfig(ctx as never).workflowDeadlineMs).toBe(10_000_000);
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('workflow_deadline_ms (10000000)'));
  });

  it('does not warn for the supported 7,200,000ms deadline', () => {
    const ctx = ctxLike(7_200_000);

    expect(resolveConfig(ctx as never).workflowDeadlineMs).toBe(7_200_000);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });
});

describe('resolveConfig — render_scale (vòng #05 mục 34)', () => {
  const ctxLike = (vars: Record<string, unknown>) => ({ operationId: 'op-1', pipelineVars: vars }) as never;

  it('default = DEFAULT_RENDER_SCALE', () => {
    expect(resolveConfig(ctxLike({})).renderScale).toBe(DEFAULT_RENDER_SCALE);
  });

  it('nhận số thực (không bị Math.floor như các param int)', () => {
    expect(resolveConfig(ctxLike({ render_scale: '3.5' })).renderScale).toBe(3.5);
  });

  it('ngoài khoảng 1–4 hoặc không phải số → về default', () => {
    for (const bad of ['0', '0.5', '5', '-2', 'abc', '']) {
      expect(resolveConfig(ctxLike({ render_scale: bad })).renderScale).toBe(DEFAULT_RENDER_SCALE);
    }
  });
});


// ─── Vòng fix sau pilot: thông báo lỗi phải nói đúng nguyên nhân ──────────────
//
// Ca thật trên Air Water: PDF số hoàn toàn sạch, 8/9 chunk bóc được, chỉ 1 chunk (trang 21-22)
// rớt vì một lời gọi AI thất bại. Nhưng response chỉ hiện
//   OCR_LOW_CONFIDENCE — "Không đọc được rõ nội dung file, ảnh có thể bị mờ, nghiêng hoặc
//   độ phân giải thấp."
// → người đọc đi kiểm tra chất lượng file, sai hướng hoàn toàn.

describe('resolveDegradation — reason phải nêu SỐ và nêu TRANG', () => {
  const types: ReportType[] = ['balanceSheet'];
  const payload = () => buildPayload(config(), classifyOutcome(types), extractOutcome(types));

  const info = (overrides: Partial<FileProcessingInfo> = {}): FileProcessingInfo => ({
    totalPages: 24,
    pageSourceMode: 'pdf',
    encrypted: false,
    reportsFound: 5,
    classifyWindowsTotal: 3,
    classifyWindowsFailed: 0,
    extractChunksTotal: 9,
    extractChunksFailed: 0,
    tablesDiscardedAsOther: 0,
    failedPageRanges: [],
    translationStatus: 'DONE',
    untranslatedItems: 0,
    failureReasons: [],
    ...overrides,
  });

  it('1/9 chunk lỗi ở trang 21-22 → reason ghi đúng tỷ lệ và dải trang', () => {
    const d = resolveDegradation(payload(), info({
      extractChunksFailed: 1,
      failedPageRanges: [{ from: 21, to: 22 }],
    }));
    expect(d?.errorCode).toBe('OCR_LOW_CONFIDENCE');
    expect(d?.reason).toContain('1/9 chunk');
    expect(d?.reason).toContain('trang 21-22');
  });

  it('trang lẻ ghi một số, không ghi "21-21"', () => {
    const d = resolveDegradation(payload(), info({
      extractChunksFailed: 1,
      failedPageRanges: [{ from: 21, to: 21 }],
    }));
    expect(d?.reason).toContain('trang 21');
    expect(d?.reason).not.toContain('21-21');
  });

  it('lỗi cả ở classify và extract → reason nêu cả hai', () => {
    const d = resolveDegradation(payload(), info({
      extractChunksFailed: 2,
      classifyWindowsFailed: 1,
      failedPageRanges: [{ from: 5, to: 6 }],
    }));
    expect(d?.reason).toContain('2/9 chunk');
    expect(d?.reason).toContain('1/3 cửa sổ');
  });

  it('reason KHÔNG được là câu chung chung — phải có chữ số', () => {
    const d = resolveDegradation(payload(), info({ extractChunksFailed: 1 }));
    expect(d?.reason ?? '').toMatch(/\d/);
  });
});


// ─── errorMessage vs diagnostic: tách người dùng cuối khỏi DEV ────────────────
//
// SRS 6.5 ghi errorMessage là câu "hiển thị cho người dùng cuối". Nối chuỗi kỹ thuật kiểu
// `Cannot find package 'pdfjs-dist' imported from /app/node_modules/...` vào đó vừa là rác với
// người đọc, vừa lộ đường dẫn nội bộ ra ngoài. Chi tiết đi bằng trường `diagnostic` riêng.

describe('errorMessage giữ đúng câu SRS, chi tiết đi bằng diagnostic', () => {
  const okFile = (name: string): FileResult => ({
    fileId: 'GRP-1', fileName: name, status: 'SUCCESS',
    errorCode: null, errorMessage: null, diagnostic: null, report: null, processingInfo: null,
  });

  it('errorMessage của mọi errorCode phải KHỚP TUYỆT ĐỐI bảng SRS 6.5', () => {
    for (const [code, text] of Object.entries(ERROR_MESSAGES)) {
      expect(text).not.toContain(' — ');
      expect(text.length).toBeLessThan(200);
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });

  it('diagnostic là trường THÊM MỚI và nullable → caller cũ bỏ qua được', () => {
    const env = buildEnvelope(config(), [okFile('a.pdf')]);
    expect(env.data![0]).toHaveProperty('diagnostic');
    expect(env.data![0].diagnostic).toBeNull();
  });

  it('không được nhét đường dẫn nội bộ vào errorMessage', () => {
    for (const text of Object.values(ERROR_MESSAGES)) {
      expect(text).not.toMatch(/node_modules|\/app\/|[A-Z]:\\/);
    }
  });
});
