// tests/financial-report/uat01-fixes.test.ts
// Vòng UAT #01 (2026-08-03) — regression guard cho 4 lỗi phát hiện khi chạy thật Sony + Air Water.
// Chi tiết: handover-report/OCRBctcJapan/PLAN/UAT-01-FINDINGS-AND-UPDATE-PLAN.md
//
//   I1  alias IFRS tiếng Nhật (財政状態計算書) + warning REPORT_TYPE_SUSPECT
//   I2  suy sgaBreakdown từ dòng tổng SG&A trong Báo cáo KQKD
//   I8  statementSection: khớp mốc khối CHÍNH XÁC, không dùng "chứa chuỗi"

import { mergeTabularReport, normalizeSectionLabel } from '@/lib/pipelines/workflows/financial-report/merge';
import { applySgaFallback } from '@/lib/pipelines/workflows/financial-report/sga-fallback';
import { REPORT_ALIASES } from '@/lib/pipelines/workflows/prompts/financial-report-prompts';
import { createEmptyPayload } from '@/lib/pipelines/workflows/financial-report/types';
import type { TableChunkOutcome } from '@/lib/pipelines/workflows/financial-report/extract';
import type { ReportLocation } from '@/lib/pipelines/workflows/financial-report/classify';
import type {
  ExtractChunkResult,
  InternalFinancialReportPayload,
  ReportType,
  TabularReport,
} from '@/lib/pipelines/workflows/financial-report/types';

function location(reportType: ReportType, from: number, to: number, title: string | null = null): ReportLocation {
  return { reportType, pageFrom: from, pageTo: to, titleSource: title };
}

function tableChunk(reportType: ReportType, from: number, to: number, result: ExtractChunkResult): TableChunkOutcome {
  return {
    reportType,
    locationIndex: 0,
    chunkIndex: 0,
    pageFrom: from,
    pageTo: to,
    result,
    aiWarnings: [],
    failureReason: null,
  };
}

type RowInput = { label: string; rowType?: string; value?: string };

function rowsChunk(reportType: ReportType, page: number, rows: RowInput[], columnCount = 1): ExtractChunkResult {
  const columns = Array.from({ length: columnCount }, (_, index) => ({
    id: index === 0 ? 'currentPeriod' : `period${index + 1}`,
    labelSource: index === 0 ? '当期' : '前期',
    dataType: 'number',
    period: index === 0 ? '2025-09-30' : '2025-03-31',
  }));

  return {
    reportType,
    titleSource: null,
    notFound: false,
    tables: [
      {
        tableId: `${reportType}-1`,
        columns,
        rows: rows.map((row, index) => ({
          rowId: `r${index + 1}`,
          parentRowId: null,
          level: 1,
          rowType: row.rowType ?? 'DETAIL',
          labelSource: row.label,
          sourcePage: page,
          values: row.value === undefined ? {} : { currentPeriod: row.value },
        })),
      },
    ],
  } as ExtractChunkResult;
}

// ─── I1: alias IFRS tiếng Nhật ────────────────────────────────────────────────

describe('I1 — alias nhận diện BCTC Nhật lập theo IFRS', () => {
  it('balanceSheet nhận 財政状態計算書 (Statement of Financial Position)', () => {
    // IFRS chuẩn: Marubeni/Sony thật sự in 連結財政状態計算書, không được xoá theo cách gọi J-GAAP.
    expect(REPORT_ALIASES.balanceSheet.ja).toContain('連結財政状態計算書');
    expect(REPORT_ALIASES.balanceSheet.ja).toContain('財政状態計算書');
  });

  it('nhận các alias IFRS/BU đã xác thực và vẫn tách CI khỏi Báo cáo KQKD', () => {
    expect(REPORT_ALIASES.equityChangeStatement.ja).toEqual(expect.arrayContaining([
      '連結持分変動計算書',
      '持分変動計算書',
    ]));
    expect(REPORT_ALIASES.incomeStatement.ja).toContain('要約損益計算書');
    expect(REPORT_ALIASES.sgaBreakdown.ja).toContain('販売費及び一般管理費の費目別内訳');
    expect(REPORT_ALIASES.notesToFinancialStatements.ja).toContain('連結財務諸表に関する注記事項');
    expect(REPORT_ALIASES.comprehensiveIncome.ja).toContain('連結包括利益計算書');
    expect(REPORT_ALIASES.incomeStatement.ja).not.toContain('連結包括利益計算書');
  });

  it('không nhận tên cả bộ tài liệu như một báo cáo con', () => {
    const prohibitedDocumentTitles = ['決算書', '財務諸表', '有価証券報告書', '決算短信'];
    for (const alias of Object.values(REPORT_ALIASES)) {
      for (const title of prohibitedDocumentTitles) {
        expect(alias.ja).not.toContain(title);
      }
    }
  });

  it('KHÔNG thêm dòng khoản mục 販売費及び一般管理費 vào alias của sgaBreakdown', () => {
    // Thêm vào sẽ khiến classify coi cả trang KQKD là location của sgaBreakdown.
    expect(REPORT_ALIASES.sgaBreakdown.ja).not.toContain('販売費及び一般管理費');
  });
});

describe('I1 — warning REPORT_TYPE_SUSPECT', () => {
  it('incomeStatement chứa mốc khối bảng cân đối → gắn REPORT_TYPE_SUSPECT', () => {
    // Đúng ca Sony: 連結財政状態計算書 bị gán vào incomeStatement, dòng đầu là (資産の部).
    const chunk = tableChunk('incomeStatement', 5, 5, rowsChunk('incomeStatement', 5, [
      { label: '(資産の部)', rowType: 'SECTION' },
      { label: '現金及び現金同等物', value: '73,886' },
    ]));
    const report = mergeTabularReport('incomeStatement', [location('incomeStatement', 5, 5)], [chunk]);

    expect(report.warnings.map((w) => w.code)).toContain('REPORT_TYPE_SUSPECT');
  });

  it('báo cáo KQKD bình thường KHÔNG bị gắn warning', () => {
    const chunk = tableChunk('incomeStatement', 11, 11, rowsChunk('incomeStatement', 11, [
      { label: 'Revenue', value: '516,639' },
      { label: 'Cost of sales', value: '-400,208' },
    ]));
    const report = mergeTabularReport('incomeStatement', [location('incomeStatement', 11, 11)], [chunk]);

    expect(report.warnings.map((w) => w.code)).not.toContain('REPORT_TYPE_SUSPECT');
  });

  it('balanceSheet KHÔNG bao giờ tự nghi chính mình', () => {
    const chunk = tableChunk('balanceSheet', 8, 8, rowsChunk('balanceSheet', 8, [
      { label: 'Assets', rowType: 'SECTION' },
      { label: 'Cash and cash equivalents', value: '63,787' },
    ]));
    const report = mergeTabularReport('balanceSheet', [location('balanceSheet', 8, 8)], [chunk]);

    expect(report.warnings.map((w) => w.code)).not.toContain('REPORT_TYPE_SUSPECT');
  });
});

// ─── I8: statementSection ─────────────────────────────────────────────────────

describe('I8 — statementSection khớp mốc khối chính xác', () => {
  /** Đúng thứ tự dòng của Air Water (rút gọn) — ca đã sai thật trên UAT. */
  const airWaterRows: RowInput[] = [
    { label: 'Assets', rowType: 'SECTION' },
    { label: 'Current assets', rowType: 'SECTION' },
    { label: 'Cash and cash equivalents', value: '63,787' },
    { label: 'Non-current assets', rowType: 'SECTION' },
    { label: 'Intangible assets', value: '15,000' },
    { label: 'Investments accounted for using equity method', value: '37,837' },
    { label: 'Retirement benefit asset', value: '4,406' },
    { label: 'Other financial assets', value: '7,258' },
    { label: 'Total assets', rowType: 'TOTAL', value: '900,000' },
    { label: 'Liabilities and equity', rowType: 'SECTION' },
    { label: 'Liabilities', rowType: 'SECTION' },
    { label: 'Trade and other payables', value: '141,979' },
    { label: 'Total liabilities', rowType: 'TOTAL', value: '500,000' },
    { label: 'Equity', rowType: 'SECTION' },
    { label: 'Share capital', value: '20,000' },
    { label: 'Total equity attributable to owners of parent', rowType: 'SUBTOTAL', value: '380,000' },
    { label: 'Non-controlling interests', value: '20,000' },
    { label: 'Total liabilities and equity', rowType: 'TOTAL', value: '900,000' },
  ];

  const report = mergeTabularReport(
    'balanceSheet',
    [location('balanceSheet', 8, 9)],
    [tableChunk('balanceSheet', 8, 9, rowsChunk('balanceSheet', 8, airWaterRows))],
  );
  const sectionOf = (label: string) =>
    report.tables[0].rows.find((row) => row.label.source === label)?.statementSection;

  it('tên khoản mục chứa chữ "equity" KHÔNG bị coi là mốc khối', () => {
    expect(sectionOf('Investments accounted for using equity method')).toBe('ASSETS');
  });

  it('dòng ngay sau đó không bị thừa hưởng khối sai', () => {
    expect(sectionOf('Retirement benefit asset')).toBe('ASSETS');
  });

  it('"Liabilities and equity" mở khối PHẢI (LIABILITIES), không phải EQUITY', () => {
    expect(sectionOf('Liabilities and equity')).toBe('LIABILITIES');
  });

  it('khối Nợ và khối Vốn chủ sở hữu vẫn đúng', () => {
    expect(sectionOf('Trade and other payables')).toBe('LIABILITIES');
    expect(sectionOf('Share capital')).toBe('EQUITY');
    expect(sectionOf('Non-controlling interests')).toBe('EQUITY');
  });

  it('không dòng nào bị bỏ trống khối → không gắn SECTION_DETECTION_WEAK', () => {
    expect(report.tables[0].rows.every((row) => row.statementSection !== null)).toBe(true);
    expect(report.warnings.map((w) => w.code)).not.toContain('SECTION_DETECTION_WEAK');
  });

  it('bảng cân đối tiếng Nhật J-GAAP vẫn chia khối đúng', () => {
    const jaReport = mergeTabularReport(
      'balanceSheet',
      [location('balanceSheet', 1, 1)],
      [tableChunk('balanceSheet', 1, 1, rowsChunk('balanceSheet', 1, [
        { label: '資産の部', rowType: 'SECTION' },
        { label: '現金及び預金', value: '5,288' },
        { label: 'その他の負債性引当金', value: '100' },
        { label: '負債の部', rowType: 'SECTION' },
        { label: '買掛金', value: '25,400' },
        { label: '純資産の部', rowType: 'SECTION' },
        { label: '資本金', value: '1,110' },
      ]))],
    );
    const jaSectionOf = (label: string) =>
      jaReport.tables[0].rows.find((row) => row.label.source === label)?.statementSection;

    expect(jaSectionOf('現金及び預金')).toBe('ASSETS');
    // Dòng DETAIL chứa chữ 負債 nằm trong khối Tài sản → KHÔNG được đổi khối.
    expect(jaSectionOf('その他の負債性引当金')).toBe('ASSETS');
    expect(jaSectionOf('買掛金')).toBe('LIABILITIES');
    expect(jaSectionOf('資本金')).toBe('EQUITY');
  });
});

describe('normalizeSectionLabel', () => {
  it('bỏ ngoặc bao ngoài và số thứ tự đầu dòng', () => {
    expect(normalizeSectionLabel('(資産の部)')).toBe('資産の部');
    expect(normalizeSectionLabel('I. 流動資産')).toBe('流動資産');
    expect(normalizeSectionLabel('1. Current assets')).toBe('current assets');
  });

  it('KHÔNG cắt chữ đầu của nhãn không phải số thứ tự', () => {
    // Bẫy đã tránh: "income taxes receivable" bắt đầu bằng "i" (số La Mã) nhưng không có dấu ngăn.
    expect(normalizeSectionLabel('Income taxes receivable')).toBe('income taxes receivable');
    expect(normalizeSectionLabel('Vốn chủ sở hữu')).toBe('vốn chủ sở hữu');
  });
});

// ─── I2: fallback SG&A ────────────────────────────────────────────────────────

function payloadWithIncomeStatement(rows: RowInput[], columnCount = 1): InternalFinancialReportPayload {
  const payload = createEmptyPayload('en', 'vi');
  payload.incomeStatement = mergeTabularReport(
    'incomeStatement',
    [location('incomeStatement', 11, 11)],
    [tableChunk('incomeStatement', 11, 11, rowsChunk('incomeStatement', 11, rows, columnCount))],
  );
  return payload;
}

describe('I2 — suy sgaBreakdown từ dòng tổng trong Báo cáo KQKD', () => {
  it('nhãn tiếng Anh của Air Water → PARTIAL + 2 warning, giữ số tổng', () => {
    const payload = payloadWithIncomeStatement([
      { label: 'Revenue', value: '516,639' },
      { label: 'Selling, general and administrative expenses', value: '-87,007' },
    ]);

    const outcome = applySgaFallback(payload);
    const sga = payload.sgaBreakdown as TabularReport;

    expect(outcome.kind).toBe('derived');
    expect(sga.status).toBe('PARTIAL');
    expect(sga.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['DETAIL_NOT_FOUND', 'SGA_DERIVED_FROM_INCOME_STATEMENT']),
    );
    expect(sga.tables[0].rows).toHaveLength(1);
    expect(sga.tables[0].rows[0].rowType).toBe('TOTAL');
    expect(sga.tables[0].rows[0].values.currentPeriod).toEqual({ raw: '-87,007', normalized: -87007 });
    expect(sga.pageRanges).toEqual([{ from: 11, to: 11 }]);
  });

  it('nhãn tiếng Nhật J-GAAP của OG Corp cũng nhận được', () => {
    const payload = payloadWithIncomeStatement([
      { label: '売上高', value: '124,732' },
      { label: '販売費及び一般管理費', value: '7,915' },
    ]);

    expect(applySgaFallback(payload).kind).toBe('derived');
    expect(payload.sgaBreakdown.tables[0].rows[0].values.currentPeriod?.normalized).toBe(7915);
  });

  it('giữ ĐỦ mọi kỳ của bảng KQKD (quyết định của BU)', () => {
    const payload = payloadWithIncomeStatement(
      [{ label: 'Selling, general and administrative expenses', value: '-87,007' }],
      2,
    );

    applySgaFallback(payload);
    expect(payload.sgaBreakdown.tables[0].columns.map((c) => c.period)).toEqual(['2025-09-30', '2025-03-31']);
  });

  it('normalized KHÔNG bị nhân multiplier đơn vị', () => {
    const payload = payloadWithIncomeStatement([
      { label: 'Selling, general and administrative expenses', value: '87,007' },
    ]);
    payload.generalInformation.unit = { source: '百万円', translated: 'Triệu yên', multiplier: 1_000_000 };

    applySgaFallback(payload);
    expect(payload.sgaBreakdown.tables[0].rows[0].values.currentPeriod?.normalized).toBe(87007);
  });

  it('dòng không có số → KHÔNG suy diễn', () => {
    const payload = payloadWithIncomeStatement([
      { label: 'Selling, general and administrative expenses', rowType: 'SECTION' },
    ]);

    expect(applySgaFallback(payload).kind).toBe('skipped');
    expect(payload.sgaBreakdown.status).toBe('NOT_FOUND');
  });

  it('nhiều dòng SG&A khớp → KHÔNG suy diễn', () => {
    const payload = payloadWithIncomeStatement([
      { label: 'Selling, general and administrative expenses', value: '-87,007' },
      { label: 'Selling, general and administrative expenses', value: '-82,982' },
    ]);

    const outcome = applySgaFallback(payload);
    expect(outcome.kind).toBe('skipped');
    expect(payload.sgaBreakdown.status).toBe('NOT_FOUND');
  });

  it('bỏ qua nhãn là TIÊU ĐỀ bảng chi tiết (…内訳書)', () => {
    const payload = payloadWithIncomeStatement([
      { label: '販売費及び一般管理費内訳書', value: '7,915' },
    ]);

    expect(applySgaFallback(payload).kind).toBe('skipped');
  });

  it('đã có bảng SGA thật → fallback KHÔNG chạy, không ghi đè', () => {
    const payload = payloadWithIncomeStatement([
      { label: 'Selling, general and administrative expenses', value: '-87,007' },
    ]);
    payload.sgaBreakdown = mergeTabularReport(
      'sgaBreakdown',
      [location('sgaBreakdown', 4, 4)],
      [tableChunk('sgaBreakdown', 4, 4, rowsChunk('sgaBreakdown', 4, [
        { label: '給料手当', value: '163,540' },
      ]))],
    );

    const outcome = applySgaFallback(payload);
    expect(outcome.kind).toBe('skipped');
    expect(payload.sgaBreakdown.tables[0].rows[0].label.source).toBe('給料手当');
    expect(payload.sgaBreakdown.warnings.map((w) => w.code))
      .not.toContain('SGA_DERIVED_FROM_INCOME_STATEMENT');
  });

  it('sgaBreakdown bị loại bởi report_types → KHÔNG tự dựng lại', () => {
    const payload = payloadWithIncomeStatement([
      { label: 'Selling, general and administrative expenses', value: '-87,007' },
    ]);
    payload.sgaBreakdown.warnings.push({ code: 'EXCLUDED_BY_CONFIG', message: 'test' });

    expect(applySgaFallback(payload).kind).toBe('skipped');
    expect(payload.sgaBreakdown.status).toBe('NOT_FOUND');
  });
});
