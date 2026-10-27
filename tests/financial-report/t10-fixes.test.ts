// tests/financial-report/t10-fixes.test.ts
// T10 — regression guard cho R5 (title câu văn), R4 (title cụ thể) và R2 (ngưỡng tổng).

import {
  detectStatementKind,
  looksLikeProseTitle,
  normalizeClassifyResult,
  pickMostSpecificTitle,
} from '@/lib/pipelines/workflows/financial-report/classify';
import { mergeTabularReport } from '@/lib/pipelines/workflows/financial-report/merge';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type { ExtractChunkResult, ExtractedRow, ReportType } from '@/lib/pipelines/workflows/financial-report/types';

function location(reportType: ReportType): ReportLocation {
  return { reportType, pageFrom: 1, pageTo: 1, titleSource: 'テスト報告書' };
}

function chunk(reportType: ReportType, rows: ExtractedRow[]): {
  reportType: ReportType;
  locationIndex: number;
  chunkIndex: number;
  pageFrom: number;
  pageTo: number;
  result: ExtractChunkResult;
  aiWarnings: string[];
  failureReason: null;
} {
  return {
    reportType,
    locationIndex: 0,
    chunkIndex: 0,
    pageFrom: 1,
    pageTo: 1,
    result: {
      reportType,
      notFound: false,
      tables: [{
        columns: [{ id: 'currentPeriod', labelSource: '当期', dataType: 'number', period: '2025-03-31' }],
        rows,
      }],
    },
    aiWarnings: [],
    failureReason: null,
  };
}

function detailRows(count: number): ExtractedRow[] {
  return Array.from({ length: count }, (_, index) => ({
    rowId: `detail-${index + 1}`,
    labelSource: `明細 ${index + 1}`,
    rowType: 'DETAIL',
    sourcePage: 1,
    values: { currentPeriod: '1' },
  }));
}

describe('T10.1 / R5 — loại tên báo cáo nằm trong câu văn', () => {
  it('phân biệt tiêu đề Sony thật với câu văn thuyết minh và null', () => {
    expect(looksLikeProseTitle('（１）連結財政状態計算書')).toBe(false);
    expect(looksLikeProseTitle('（２）連結損益計算書［連結会計年度（３月31日に終了した１年間）］')).toBe(false);
    expect(looksLikeProseTitle('2024年度末に係る連結財政状態計算書において、独立掲記しています。')).toBe(true);
    expect(looksLikeProseTitle('詳細は添付資料24ページ「連結損益計算書」をご参照ください')).toBe(true);
    expect(looksLikeProseTitle(null)).toBe(false);
  });

  it('hạ nhãn Sony PDF 25 bị nhận nhầm thành NONE, tăng counter và không loại tiêu đề thật', () => {
    const stats = { titlesRejectedAsProse: 0 };
    const normalized = normalizeClassifyResult({
      sourceLanguage: 'ja',
      reports: [],
      pages: [
        {
          page: 25,
          reportType: 'balanceSheet',
          basis: 'TITLE',
          titleFound: '2024年度末に係る連結財政状態計算書において、独立掲記しています。',
        },
        { page: 26, reportType: 'balanceSheet', basis: 'TITLE', titleFound: '（１）連結財政状態計算書' },
      ],
    }, { from: 25, to: 26 }, 29, stats);

    expect(normalized.pages?.[0]).toEqual({ page: 25, reportType: null, basis: 'NONE', titleFound: null });
    expect(normalized.pages?.[1]).toMatchObject({ reportType: 'balanceSheet', basis: 'TITLE' });
    expect(stats.titlesRejectedAsProse).toBe(1);
    // processSingleFile chép trực tiếp giá trị này ra processingInfo.titlesRejectedAsProse.
    expect({ titlesRejectedAsProse: stats.titlesRejectedAsProse }).toEqual({ titlesRejectedAsProse: 1 });
  });
});

describe('T10.2 / R4 — ưu tiên tiêu đề cụ thể nhất', () => {
  const parent = '（２）連結損益計算書及び連結包括利益計算書';
  const child = '（連結損益計算書）';

  it('chọn tiêu đề con Tokyu, vẫn giữ title gộp khi không có lựa chọn khác', () => {
    expect(pickMostSpecificTitle([parent, child])).toBe(child);
    expect(pickMostSpecificTitle(['（連結包括利益計算書）'])).toBe('（連結包括利益計算書）');
    expect(pickMostSpecificTitle(['A及びB'])).toBe('A及びB');
    expect(pickMostSpecificTitle([])).toBeNull();
    expect(detectStatementKind(pickMostSpecificTitle([parent, child]))).toBe('PROFIT_LOSS');
  });

  it('chọn title con khi model trả hai TITLE trùng trang', () => {
    const normalized = normalizeClassifyResult({
      sourceLanguage: 'ja',
      reports: [],
      pages: [
        { page: 7, reportType: 'incomeStatement', basis: 'TITLE', titleFound: parent },
        { page: 7, reportType: 'incomeStatement', basis: 'TITLE', titleFound: child },
      ],
    }, { from: 7, to: 7 }, 8);

    expect(normalized.pages?.[0]?.titleFound).toBe(child);
    expect(normalized.reports[0]).toMatchObject({ reportType: 'incomeStatement', titleFound: child });
  });
});

describe('T10.3 / R2 — ngưỡng lệch tổng theo số khoản mục', () => {
  it('bảng cân đối 10 DETAIL chấp nhận lệch 4, nhưng cảnh báo lệch 15 kèm ngưỡng', () => {
    const rows = detailRows(10);
    const withinTolerance = mergeTabularReport('balanceSheet', [location('balanceSheet')], [chunk('balanceSheet', [
      ...rows,
      { labelSource: '資産合計', rowType: 'TOTAL', sourcePage: 1, values: { currentPeriod: '100' } },
      { labelSource: '負債合計', rowType: 'TOTAL', sourcePage: 1, values: { currentPeriod: '60' } },
      { labelSource: '純資産合計', rowType: 'TOTAL', sourcePage: 1, values: { currentPeriod: '36' } },
    ])]);
    const mismatch = mergeTabularReport('balanceSheet', [location('balanceSheet')], [chunk('balanceSheet', [
      ...rows,
      { labelSource: '資産合計', rowType: 'TOTAL', sourcePage: 1, values: { currentPeriod: '100' } },
      { labelSource: '負債合計', rowType: 'TOTAL', sourcePage: 1, values: { currentPeriod: '60' } },
      { labelSource: '純資産合計', rowType: 'TOTAL', sourcePage: 1, values: { currentPeriod: '25' } },
    ])]);

    expect(withinTolerance.warnings.map((warning) => warning.code)).not.toContain('TOTAL_MISMATCH');
    expect(mismatch.warnings).toContainEqual(expect.objectContaining({
      code: 'TOTAL_MISMATCH',
      message: expect.stringContaining('lệch 15, ngưỡng cho phép 10 (10 khoản mục)'),
    }));
  });

  it('bảng cân đối một DETAIL vẫn cảnh báo lệch 2 vì ngưỡng tối thiểu là 1', () => {
    const report = mergeTabularReport('balanceSheet', [location('balanceSheet')], [chunk('balanceSheet', [
      ...detailRows(1),
      { labelSource: '資産合計', rowType: 'TOTAL', sourcePage: 1, values: { currentPeriod: '100' } },
      { labelSource: '負債合計', rowType: 'TOTAL', sourcePage: 1, values: { currentPeriod: '60' } },
      { labelSource: '純資産合計', rowType: 'TOTAL', sourcePage: 1, values: { currentPeriod: '38' } },
    ])]);

    expect(report.warnings.map((warning) => warning.code)).toContain('TOTAL_MISMATCH');
  });

  it('báo cáo biến động vốn cũng tính ngưỡng từ số dòng CHANGE', () => {
    const changeRows = Array.from({ length: 10 }, (_, index) => ({
      labelSource: `Biến động ${index + 1}`,
      rowType: 'CHANGE',
      sourcePage: 1,
      values: { currentPeriod: '0' },
    }));
    const withinTolerance = mergeTabularReport('equityChangeStatement', [location('equityChangeStatement')], [chunk('equityChangeStatement', [
      { labelSource: 'Số dư đầu kỳ', rowType: 'OPENING_BALANCE', sourcePage: 1, values: { currentPeriod: '100' } },
      ...changeRows,
      { labelSource: 'Số dư cuối kỳ', rowType: 'CLOSING_BALANCE', sourcePage: 1, values: { currentPeriod: '104' } },
    ])]);
    const mismatch = mergeTabularReport('equityChangeStatement', [location('equityChangeStatement')], [chunk('equityChangeStatement', [
      { labelSource: 'Số dư đầu kỳ', rowType: 'OPENING_BALANCE', sourcePage: 1, values: { currentPeriod: '100' } },
      ...changeRows,
      { labelSource: 'Số dư cuối kỳ', rowType: 'CLOSING_BALANCE', sourcePage: 1, values: { currentPeriod: '115' } },
    ])]);

    expect(withinTolerance.warnings.map((warning) => warning.code)).not.toContain('TOTAL_MISMATCH');
    expect(mismatch.warnings).toContainEqual(expect.objectContaining({
      code: 'TOTAL_MISMATCH',
      message: expect.stringContaining('lệch 15, ngưỡng cho phép 10 (10 khoản mục)'),
    }));
  });
});
