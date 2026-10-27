// tests/financial-report/extract-storage-failure.test.ts
// CODE-REVIEW-01 mục 19 — lỗi tách trang / upload storage chỉ được làm mất CHUNK đó,
// KHÔNG throw lên orchestrator (throw = cả file thành FAILED + report null, mất hết
// công OCR đã tốn token, trái tinh thần Q7).

const prepareChunkAssetsMock = jest.fn();
const enqueueSubStepMock = jest.fn();

jest.mock('@/lib/pipelines/workflow-engine', () => ({
  enqueueSubStep: (...args: unknown[]) => enqueueSubStepMock(...args),
  parseDeep: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
}));

// Vòng #05 mục 34: extract/classify chỉ còn 1 điểm vào `prepareChunkAssets` (che khác biệt
// giữa chunk PDF và chunk ảnh). Mock ở đúng hàm đó — mock `buildPageRangePdf`/
// `uploadChunkAndBuildFilesJson` không còn tác dụng vì `prepareChunkAssets` gọi chúng qua
// tham chiếu nội bộ module, không đi qua export đã bị mock.
jest.mock('@/lib/pipelines/workflows/financial-report/pdf-utils', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflows/financial-report/pdf-utils');
  return {
    ...actual,
    prepareChunkAssets: (...args: unknown[]) => prepareChunkAssetsMock(...args),
  };
});

import { extractReports } from '@/lib/pipelines/workflows/financial-report/extract';
import { mergeTabularReport } from '@/lib/pipelines/workflows/financial-report/merge';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { PageSource } from '@/lib/pipelines/workflows/financial-report/pdf-utils';
import type { FinancialReportConfig } from '@/lib/pipelines/workflows/financial-report/types';

/** PageSource chế độ 'pdf' (đường mặc định) với `pages` trang giả. */
function pdfSource(pages: number): PageSource {
  return {
    mode: 'pdf',
    totalPages: pages,
    pageBuffers: Array.from({ length: pages }, (_, i) => Buffer.from(`p${i + 1}`)),
    originalBuffer: null,
    encrypted: false,
    renderScale: 2.5,
  };
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const ctx = {
  operationId: 'op-test',
  logger,
  promptOverrides: {},
  modelOverrides: {},
  reasoningEffortOverrides: {},
  pipelineVars: {},
} as never;

const config: FinancialReportConfig = {
  targetLang: 'vi',
  requestId: 'REQ-1',
  pagesPerChunk: 1,
  notesPagesPerChunk: 1,
  classifyPagesPerCall: 8,
  classifyRecheckUnassigned: true,
  classifyRecheckMaxWindows: 2,
  maxRetries: 1,
  maxConcurrency: 2,
  staggerDelayMs: 0,
  enableTranslation: false,
  renderScale: 2.5,
  reportTypes: [],
};

const location: ReportLocation = {
  reportType: 'balanceSheet',
  pageFrom: 1,
  pageTo: 2,
  titleSource: '貸借対照表',
};

function extractResponse(page: number, label: string, value: string) {
  return {
    content: JSON.stringify({
      reportType: 'balanceSheet',
      notFound: false,
      tables: [
        {
          tableId: `bs-${page}`,
          isContinuation: page > 1,
          columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
          rows: [
            {
              rowId: `r${page}`,
              parentRowId: null,
              level: 1,
              rowType: 'DETAIL',
              labelSource: label,
              sourcePage: page,
              values: { currentPeriod: value },
            },
          ],
        },
      ],
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prepareChunkAssetsMock.mockResolvedValue({ filesJson: '[]', storageKeys: ['k-default'] });
});

describe('Round 11 T3.1 — table-level metadata and location fallback', () => {
  const onePageLocation: ReportLocation = { ...location, pageTo: 1 };

  it('giữ reportType/tableTitle khai báo cho từng bảng nhưng wrapper vẫn theo classify location', async () => {
    const raw = JSON.parse(extractResponse(1, '営業活動によるキャッシュ・フロー', '29,112').content);
    raw.tables[0].reportType = 'cashFlowStatement';
    raw.tables[0].tableTitle = '連結キャッシュ・フロー計算書';
    enqueueSubStepMock.mockResolvedValue({ content: JSON.stringify(raw) });

    const outcome = await extractReports(ctx, 'metadata.pdf', pdfSource(1), [onePageLocation], config, 'f1', []);
    const table = outcome.tableChunks[0].result?.tables?.[0];

    expect(outcome.tableChunks[0].reportType).toBe('balanceSheet');
    expect(table).toMatchObject({
      reportType: 'cashFlowStatement',
      tableTitle: '連結キャッシュ・フロー計算書',
    });
  });

  it('khi model bỏ reportType, fallback về classify location và vẫn merge như hành vi cũ', async () => {
    enqueueSubStepMock.mockResolvedValue(extractResponse(1, '現金及び預金', '29,112'));

    const outcome = await extractReports(ctx, 'fallback.pdf', pdfSource(1), [onePageLocation], config, 'f1', []);
    const table = outcome.tableChunks[0].result?.tables?.[0];
    const report = mergeTabularReport('balanceSheet', [onePageLocation], outcome.tableChunks, 'vi');

    expect(table).toMatchObject({ reportType: 'balanceSheet', tableTitle: null });
    expect(report.status).toBe('FOUND');
    expect(report.tables[0].rows[0].label.source).toBe('現金及び預金');
  });
});

/**
 * Cho chunk cua mot dai trang cu the LUON loi, khong phu thuoc thu tu goi.
 *
 * `extractReports` co LUOT 2 chay lai chunk loi voi keySuffix co hau to `-r2`, nen
 * `mockRejectedValueOnce` chi chan duoc luot 1 roi luot 2 di qua. Muon mo phong loi DAI DANG
 * thi phai chan theo keySuffix (tham so thu 4 cua prepareChunkAssets).
 */
function failChunkPages(pages: string, error: string) {
  prepareChunkAssetsMock.mockImplementation(async (...args: unknown[]) => {
    if (String(args[3] ?? '').includes(`balanceSheet-${pages}`)) throw new Error(error);
    return { filesJson: '[]', storageKeys: ['k2'] };
  });
}

describe('extractReports — lỗi storage ở 1 chunk', () => {
  it('KHÔNG throw; chunk lỗi trả result = null, chunk còn lại vẫn có dữ liệu', async () => {
    // Chunk trang 1: upload S3 hiccup. Chunk trang 2: bình thường.
    // Loi DAI DANG o chunk trang 1: ca luot 1 va luot 2 deu that bai.
    failChunkPages('1-1', 'S3 SlowDown: please reduce your request rate');
    enqueueSubStepMock.mockResolvedValue(extractResponse(2, '売掛金', '29,112'));

    const uploadedKeys: string[] = [];
    const outcome = await extractReports(ctx, 'og.pdf', pdfSource(2), [location], config, 'f1', uploadedKeys);

    expect(outcome.tableChunks).toHaveLength(2);
    expect(outcome.tableChunks[0].result).toBeNull();
    expect(outcome.tableChunks[1].result).not.toBeNull();

    // Ly do phai noi len duoc, khong chi nam trong log container.
    expect(outcome.tableChunks[0].failureReason).toContain('S3 SlowDown');
    expect(outcome.tableChunks[0].failureReason).toContain('trang 1-1');

    // Không gọi AI cho chunk lỗi → không tốn token vô ích.
    expect(enqueueSubStepMock).toHaveBeenCalledTimes(1);

    // Chỉ chunk upload THÀNH CÔNG mới được đưa vào danh sách cleanup.
    expect(uploadedKeys).toEqual(['k2']);

    // Có log lỗi rõ ràng, không im lặng.
    expect(logger.error).toHaveBeenCalled();
  });

  it('merge vẫn giữ dữ liệu chunk còn lại → PARTIAL, không phải UNREADABLE', async () => {
    failChunkPages('1-1', 'S3 down');
    enqueueSubStepMock.mockResolvedValue(extractResponse(2, '売掛金', '29,112'));

    const outcome = await extractReports(ctx, 'og.pdf', pdfSource(2), [location], config, 'f1', []);
    const report = mergeTabularReport('balanceSheet', [location], outcome.tableChunks, 'vi');

    expect(report.status).toBe('PARTIAL');
    expect(report.tables[0].rows).toHaveLength(1);
    expect(report.tables[0].rows[0].values.currentPeriod).toEqual({ raw: '29,112', normalized: 29112 });
    expect(report.warnings.map((w) => w.code)).toContain('LOW_CONFIDENCE_PAGE');
  });

  it('MỌI chunk lỗi storage → UNREADABLE (giữ nguyên rule §18), vẫn không throw', async () => {
    prepareChunkAssetsMock.mockRejectedValue(new Error('S3 down'));

    const outcome = await extractReports(ctx, 'og.pdf', pdfSource(2), [location], config, 'f1', []);
    expect(outcome.tableChunks.every((c) => c.result === null)).toBe(true);
    expect(enqueueSubStepMock).not.toHaveBeenCalled();

    const report = mergeTabularReport('balanceSheet', [location], outcome.tableChunks, 'vi');
    expect(report.status).toBe('UNREADABLE');
    expect(report.tables).toEqual([]);
  });

  it('lỗi tách trang PDF cũng chỉ mất chunk đó', async () => {
    failChunkPages('1-1', 'PDF_SPLIT_FAILED');
    enqueueSubStepMock.mockResolvedValue(extractResponse(2, '売掛金', '29,112'));

    const outcome = await extractReports(ctx, 'og.pdf', pdfSource(2), [location], config, 'f1', []);
    expect(outcome.tableChunks[0].result).toBeNull();
    expect(outcome.tableChunks[1].result).not.toBeNull();
    // 2 chunk o luot 1 + 1 lan chay lai chunk loi o luot 2.
    expect(prepareChunkAssetsMock).toHaveBeenCalledTimes(3);
  });

  // ── Luot 2: chay lai chunk loi sau khi moi chunk khac da xong ────────────────────────
  //
  // Do tren Air Water 24 trang: luot 1 rot dung 1/9 chunk (trang 21-22) trong khi 8 chunk con
  // lai xong binh thuong — loi le te do tai, khong phai PDF mo. Chay lai luc duong da trong
  // thi qua duoc.

  it('loi AI NHAT THOI o 1 chunk: luot 2 chay lai va cuu duoc, khong con chunk null', async () => {
    // Lan goi AI dau tien timeout, cac lan sau binh thuong.
    enqueueSubStepMock
      .mockRejectedValueOnce(new Error('sub-step timeout sau 120000ms'))
      .mockResolvedValue(extractResponse(2, 'x', '29,112'));

    const outcome = await extractReports(ctx, 'og.pdf', pdfSource(2), [location], config, 'f1', []);

    expect(outcome.tableChunks).toHaveLength(2);
    expect(outcome.tableChunks.every((c) => c.result !== null)).toBe(true);
    expect(outcome.tableChunks.every((c) => c.failureReason === null)).toBe(true);
  });

  it('loi AI DAI DANG: sau luot 2 van null, va failureReason ghi ro so lan da goi', async () => {
    enqueueSubStepMock.mockRejectedValue(new Error('429 Too Many Requests'));

    const outcome = await extractReports(ctx, 'og.pdf', pdfSource(2), [location], config, 'f1', []);

    expect(outcome.tableChunks.every((c) => c.result === null)).toBe(true);
    for (const chunk of outcome.tableChunks) {
      expect(chunk.failureReason).toContain('429 Too Many Requests');
      expect(chunk.failureReason).toContain(`sau ${config.maxRetries} lần gọi AI`);
    }
  });

  it('luot 2 giu nguyen chunkIndex va dai trang, khong lam lech thu tu merge', async () => {
    let call = 0;
    enqueueSubStepMock.mockImplementation(async () => {
      call++;
      // Chunk trang 2 (goi thu 2) that bai o luot 1, thanh cong o luot 2.
      if (call === 2) throw new Error('timeout');
      return extractResponse(2, 'x', '29,112');
    });

    const outcome = await extractReports(ctx, 'og.pdf', pdfSource(2), [location], config, 'f1', []);

    expect(outcome.tableChunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
    expect(outcome.tableChunks.map((c) => c.pageFrom)).toEqual([1, 2]);
    expect(outcome.tableChunks.every((c) => c.result !== null)).toBe(true);
  });

  it('chế độ ảnh (PDF mã hoá): 1 chunk = nhiều PNG, mọi storageKey đều vào danh sách cleanup', async () => {
    prepareChunkAssetsMock.mockResolvedValue({
      filesJson: '[]',
      storageKeys: ['op-test/financial-report/f1-bs-1-p1.png', 'op-test/financial-report/f1-bs-1-p2.png'],
    });
    enqueueSubStepMock.mockResolvedValue(extractResponse(1, '売掛金', '29,112'));

    const imageSource: PageSource = {
      mode: 'image',
      totalPages: 2,
      pageBuffers: [],
      originalBuffer: Buffer.from('%PDF-encrypted'),
      encrypted: true,
      renderScale: 2.5,
    };
    const uploadedKeys: string[] = [];
    const outcome = await extractReports(ctx, 'jfe.pdf', imageSource, [location], config, 'f1', uploadedKeys);

    expect(outcome.tableChunks).toHaveLength(2);
    // 2 chunk × 2 PNG = 4 key phải được cleanup, không rơi rớt trên storage.
    expect(uploadedKeys).toHaveLength(4);
    // `source` được truyền nguyên object xuống pdf-utils, không bị rút thành pageBuffers rỗng.
    expect(prepareChunkAssetsMock.mock.calls[0][0]).toBe(imageSource);
  });

  it('notes: lỗi storage cũng trả failed outcome, không throw', async () => {
    prepareChunkAssetsMock.mockRejectedValue(new Error('S3 down'));

    const notesLocation: ReportLocation = {
      reportType: 'notesToFinancialStatements',
      pageFrom: 5,
      pageTo: 5,
      titleSource: '個別注記表',
    };
    const outcome = await extractReports(ctx, 'og.pdf', pdfSource(5), [notesLocation], config, 'f1', []);

    expect(outcome.notesChunks).toHaveLength(1);
    expect(outcome.notesChunks[0].result).toBeNull();
    expect(enqueueSubStepMock).not.toHaveBeenCalled();
  });
});


// ── Chan tren cua luot 2 ────────────────────────────────────────────────────────────────
//
// Luot 2 chay TUAN TU nen thoi gian cong don. JFE 85 trang = 43 chunk; neu rot het thi chay
// lai ~25 phut, vuot tran polling 20 phut cua UI ma cuoi cung cung that bai. Ty le loi cao
// nghia la su co he thong, khong phai dang loi ma luot 2 sinh ra de chua.

describe('retryFailedChunks - chan tren', () => {
  /** Location 12 trang, pagesPerChunk = 1 => 12 chunk. */
  const bigLocation: ReportLocation = {
    reportType: 'balanceSheet',
    pageFrom: 1,
    pageTo: 12,
    titleSource: 'T',
  };

  it('ty le loi > 1/3 => BO han luot 2, khong goi lai lan nao', async () => {
    prepareChunkAssetsMock.mockResolvedValue({ filesJson: '[]', storageKeys: ['k'] });
    // Moi chunk deu that bai => 12/12 = 100% > 1/3.
    enqueueSubStepMock.mockRejectedValue(new Error('backend down'));

    const outcome = await extractReports(ctx, 'jfe.pdf', pdfSource(12), [bigLocation], config, 'f1', []);

    expect(outcome.tableChunks).toHaveLength(12);
    expect(outcome.tableChunks.every((c) => c.result === null)).toBe(true);
    // 12 chunk x maxRetries(1 trong config test) = 12 lan goi, KHONG co lan thu 13 cua luot 2.
    expect(enqueueSubStepMock).toHaveBeenCalledTimes(12);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('BỎ lượt 2'));
  });

  it('so loi <= 3 thi VAN chay lai du ty le cao (file it chunk)', async () => {
    // 2 chunk, 1 loi = 50% > 1/3 nhung chi 1 loi => duoi nguong tuyet doi, phai chay lai.
    enqueueSubStepMock
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(extractResponse(2, 'x', '29,112'));

    const outcome = await extractReports(ctx, 'og.pdf', pdfSource(2), [location], config, 'f1', []);

    expect(outcome.tableChunks.every((c) => c.result !== null)).toBe(true);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('BỎ lượt 2'));
  });

  it('loi le te nhung vuot 10 chunk => chi chay lai 10, co canh bao', async () => {
    prepareChunkAssetsMock.mockResolvedValue({ filesJson: '[]', storageKeys: ['k'] });

    // 36 chunk, 11 chunk dau that bai o luot 1 (11/36 < 1/3), cac lan sau thanh cong.
    const wideLocation: ReportLocation = { ...bigLocation, pageTo: 36 };
    let call = 0;
    enqueueSubStepMock.mockImplementation(async () => {
      call++;
      if (call <= 11) throw new Error('timeout');
      return extractResponse(1, 'x', '29,112');
    });

    const outcome = await extractReports(ctx, 'jfe.pdf', pdfSource(36), [wideLocation], config, 'f1', []);

    // 10 chunk duoc cuu, 1 chunk con lai giu nguyen null.
    expect(outcome.tableChunks.filter((c) => c.result === null)).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('lượt 2 chỉ chạy lại'));
  });
});
