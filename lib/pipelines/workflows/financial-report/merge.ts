// lib/pipelines/workflows/financial-report/merge.ts
// Step 4 — Merge + Validate.
//   §17 gộp chunk / continuation / chống dòng header lặp
//   §18 gán FOUND | PARTIAL | NOT_FOUND | UNREADABLE + warning codes
//   §19 validate bằng CODE (chỉ sinh warning, KHÔNG tự sửa số liệu của khách hàng)

import {
  ROW_ID_PREFIX,
  ROW_TYPES,
  createEmptyBilingual,
  createNotFoundNotesReport,
  createNotFoundTabularReport,
  type CellValue,
  type Consolidation,
  type NoteSection,
  type NotesReport,
  type PageRange,
  type PeriodScope,
  type ReportTable,
  type ReportType,
  type ReportWarning,
  type RowType,
  type TableColumn,
  type TableRow,
  type TabularReport,
  type StatementKind,
  type WarningCode,
} from './types';
import { DEFAULT_TARGET_LANG, type StatementSection, type TargetLang } from './types';
import { resolveUnit, toCellValue } from './number-parse';
import type { NotesChunkOutcome, TableChunkOutcome } from './extract';
import {
  detectConsolidation,
  detectPeriodScope,
  detectPeriodScopeFromColumns,
  detectStatementKind,
  type ReportLocation,
} from './classify';

/**
 * T10 / R2 — Sai số cho phép khi kiểm tổng, tính theo SỐ KHOẢN MỤC.
 *
 * BCTC Nhật thường ghi 「百万円未満を切り捨て」: mỗi dòng bị cắt phần dư, nên tổng in ra lệch
 * so với tổng cộng các dòng, và độ lệch cộng dồn theo số dòng. OG Corp lệch 4 đơn vị ở nhóm
 * tài sản ngắn hạn. Ngưỡng cố định 1 tạo cảnh báo dương tính giả cho mọi báo cáo dạng này.
 */
const TOLERANCE_PER_ITEM = 1;
const TOTAL_TOLERANCE_MIN = 1;

function totalTolerance(itemCount: number): number {
  const items = Number.isFinite(itemCount) && itemCount > 0 ? Math.floor(itemCount) : 0;
  return Math.max(TOTAL_TOLERANCE_MIN, items * TOLERANCE_PER_ITEM);
}

const WARNING_MESSAGES: Record<WarningCode, string> = {
  DETAIL_NOT_FOUND: 'Chỉ tìm thấy số tổng, không có bảng chi tiết trong tài liệu.',
  PERIOD_AMBIGUOUS: 'Không xác định được kỳ báo cáo của một hoặc nhiều cột.',
  UNIT_NOT_FOUND: 'Không xác định được đơn vị số liệu của báo cáo.',
  TABLE_CONTINUATION_UNCERTAIN: 'Không chắc chắn về việc nối bảng bị cắt qua trang.',
  TOTAL_MISMATCH: 'Số tổng trên tài liệu không khớp với tổng các khoản mục (giữ nguyên số gốc, không tự sửa).',
  LOW_CONFIDENCE_PAGE: 'Một hoặc nhiều trang không đọc được chắc chắn, kết quả có thể thiếu.',
  ORPHAN_PARENT_ROW: 'Có dòng tham chiếu tới dòng cha không tồn tại; đã chuyển thành dòng cấp gốc.',
  UNKNOWN_COLUMN_DROPPED: 'Có giá trị thuộc cột không khai báo trong bảng; đã loại bỏ khỏi kết quả.',
  TRANSLATION_PARTIAL: 'Một phần nội dung chưa được dịch sang ngôn ngữ đích.',
  // Q7: dịch chết nhưng vẫn giữ kết quả OCR, không đánh FAILED toàn bộ file.
  TRANSLATION_FAILED: 'Bước dịch thất bại; kết quả chỉ có chữ nguồn, chưa có bản dịch.',
  // Vòng #03 — làm code bền với các giả định về AI.
  REPORT_UNIT_ASSUMED_FROM_DOCUMENT:
    'Không đọc được đơn vị riêng in trên báo cáo này; đang dùng đơn vị chung của tài liệu. '
    + 'Tự kiểm tra đơn vị trên PDF gốc trước khi dùng số.',
  SECTION_DETECTION_WEAK:
    'Không xác định được khối (Tài sản / Nợ phải trả / Vốn chủ sở hữu) cho phần lớn các dòng; '
    + 'cách chia 2 khối của bảng cân đối có thể không đúng.',
  COLUMN_ID_REMAPPED:
    'Phần tiếp nối của bảng khai báo mã cột khác phần trước nhưng cùng số cột; '
    + 'đã ghép theo vị trí cột. Kiểm tra lại nếu số liệu lệch cột.',
  TABLE_SPLIT_HORIZONTALLY:
    'Bảng rộng bị cắt dọc: các phần có nhãn dòng trùng nhau được giữ thành bảng riêng để không lệch cột.',
  DUPLICATE_TABLE_DROPPED:
    'Đã loại bảng trùng lặp bị chứa hoàn toàn bởi bảng có dữ liệu phong phú hơn.',
  COLUMN_SET_UNIONED:
    'Các bảng biến động vốn chủ sở hữu có cùng cấu trúc dòng đã được hợp nhất cột.',
  // CODE-REVIEW-01 mục 7: phân biệt "bị tắt bằng cấu hình" với NOT_FOUND thật.
  EXCLUDED_BY_CONFIG: 'Báo cáo này bị loại khỏi phạm vi xử lý bởi cấu hình report_types, KHÔNG phải do tài liệu không có.',
  // UAT #01 — I2 và I1.
  SGA_DERIVED_FROM_INCOME_STATEMENT:
    'Tài liệu không có bảng chi tiết chi phí bán hàng và quản lý; số tổng dưới đây được lấy từ '
    + 'dòng tương ứng trong Báo cáo kết quả kinh doanh.',
  REPORT_TYPE_SUSPECT:
    'Báo cáo này chứa mốc khối của bảng cân đối kế toán nên có thể đã bị nhận diện sai loại. '
    + 'Kiểm tra lại tiêu đề báo cáo trên PDF gốc trước khi dùng số.',
  // UAT #04 / T5: giữ biến thể năm/quý riêng để không hiển thị số quý như số năm.
  MULTIPLE_VARIANTS_MERGED:
    'Báo cáo chứa nhiều biến thể kỳ hoặc loại báo cáo; kiểm tra đúng bảng trước khi sử dụng số liệu.',
  FULL_YEAR_VARIANT_MISSING:
    'Báo cáo có dữ liệu nhưng không tìm thấy biến thể kỳ cả năm.',
  REPORT_MISSING_WITH_UNASSIGNED_PAGES:
    'Báo cáo cốt lõi không tìm thấy trong khi vẫn còn trang chưa được gán loại báo cáo.',
  NOTES_PAGE_AI_OUTPUT_LIMIT:
    'Một hoặc nhiều trang thuyết minh nhận phản hồi bị lặp hoặc cụt do chạm trần token đầu ra.',
  UNIT_VARIES_WITHIN_REPORT:
    'Các bảng trong cùng báo cáo dùng đơn vị số liệu khác nhau; kiểm tra đơn vị của từng bảng trước khi dùng số.',
  // R3 — chọn bộ hợp nhất khi có xung đột hợp nhất/riêng lẻ.
  SEPARATE_SET_EXCLUDED:
    'Tài liệu có cả bộ hợp nhất và riêng lẻ; đã loại bộ riêng lẻ theo quy tắc chỉ giữ hợp nhất.',
  SEPARATE_ONLY_KEPT:
    'Tài liệu chỉ có bộ báo cáo riêng lẻ (không có hợp nhất); số liệu dưới đây là báo cáo RIÊNG LẺ.',
  TABLE_REASSIGNED_BY_CONTENT:
    'Bảng được chuyển sang loại báo cáo đích theo nội dung đã bóc tách.',
  TABLE_FROM_NOTES_REGION:
    'Bảng từ vùng thuyết minh được dùng để bổ sung báo cáo vì báo cáo chính chưa có dữ liệu đầy đủ.',
  TABLE_FROM_NOTES_REGION_IGNORED:
    'Bảng từ vùng thuyết minh đã bị bỏ vì báo cáo chính đã có dữ liệu đầy đủ.',
  INCOME_FROM_COMPREHENSIVE_INCOME:
    'Tài liệu không có Báo cáo kết quả kinh doanh riêng; dùng nguyên bảng Báo cáo thu nhập toàn diện.',
  REPORT_LOCATED_BUT_NO_DATA:
    'Báo cáo được định vị ở classify nhưng không bóc được dòng nào; xem chi tiết số chunk extract để chẩn đoán.',
};

export function makeWarning(code: WarningCode, detail?: string): ReportWarning {
  return { code, message: detail ? `${WARNING_MESSAGES[code]} ${detail}` : WARNING_MESSAGES[code] };
}

function addWarning(warnings: ReportWarning[], code: WarningCode, detail?: string): void {
  if (warnings.some((w) => w.code === code)) return;
  warnings.push(makeWarning(code, detail));
}

// ─── Merge báo cáo dạng bảng ─────────────────────────────────────────────────

/**
 * Gộp các chunk của 1 reportType thành TabularReport hoàn chỉnh.
 * KHÔNG bịa dữ liệu: chunk nào không đọc được thì thiếu phần đó + gắn warning.
 */
export function mergeTabularReport(
  reportType: ReportType,
  locations: ReportLocation[],
  chunks: TableChunkOutcome[],
  /** Dùng để dịch nhãn đơn vị riêng của báo cáo (Q10). */
  targetLang: TargetLang = DEFAULT_TARGET_LANG,
): TabularReport {
  if (locations.length === 0) return createNotFoundTabularReport();

  const warnings: ReportWarning[] = [];
  // Sắp theo (locationIndex, chunkIndex): chunk của cùng location phải liền nhau và
  // đúng thứ tự để nối bảng; hai location khác nhau không được xen kẽ (mục 2).
  const ownChunks = chunks
    .filter((c) => c.reportType === reportType)
    .sort((a, b) => a.locationIndex - b.locationIndex || a.chunkIndex - b.chunkIndex || a.pageFrom - b.pageFrom);

  if (ownChunks.length === 0) return createNotFoundTabularReport();

  const failedChunks = ownChunks.filter((c) => c.result === null);
  const okChunks = ownChunks.filter((c) => c.result !== null);

  const titleSource =
    okChunks.map((c) => c.result?.titleSource).find((t): t is string => typeof t === 'string' && !!t.trim())
    ?? locations.map((l) => l.titleSource).find((t): t is string => !!t)
    ?? null;

  if (okChunks.length === 0) {
    return {
      status: 'UNREADABLE',
      title: titleSource ? createEmptyBilingual(titleSource) : null,
      pageRanges: mergePageRanges(locations.map((l) => ({ from: l.pageFrom, to: l.pageTo }))),
      unit: null,
      warnings: [makeWarning('LOW_CONFIDENCE_PAGE', `Không bóc được nội dung ở ${ownChunks.length} chunk.`)],
      tables: [],
    };
  }

  // Toàn bộ chunk đọc được đều báo notFound → báo cáo không tồn tại trong tài liệu
  const allNotFound = okChunks.every((c) => c.result?.notFound === true && (c.result?.tables?.length ?? 0) === 0);
  if (allNotFound) return createNotFoundTabularReport();

  if (failedChunks.length > 0) {
    addWarning(
      warnings,
      'LOW_CONFIDENCE_PAGE',
      `Thiếu ${failedChunks.length}/${ownChunks.length} chunk: trang ${failedChunks.map((c) => `${c.pageFrom}-${c.pageTo}`).join(', ')}.`,
    );
  }

  for (const chunk of okChunks) {
    for (const raw of chunk.aiWarnings) {
      const code = mapAiWarning(raw);
      if (!code) continue;
      // Vòng #05 mục 36: KHÔNG lấy UNIT_NOT_FOUND từ warning của AI. Đơn vị được quyết
      // bởi code (`resolveUnit` ở dưới + fallback `generalInformation.unit` ở orchestrator);
      // AI nói "không thấy đơn vị" trong 1 chunk không có nghĩa cả báo cáo thiếu đơn vị.
      // Trường hợp thiếu thật đã có REPORT_UNIT_ASSUMED_FROM_DOCUMENT / UNIT_NOT_FOUND
      // gắn theo điều kiện thật ở dưới.
      if (code === 'UNIT_NOT_FOUND') continue;
      addWarning(warnings, code);
    }
  }

  // ── Gộp bảng theo thứ tự (locationIndex, chunkIndex) (§17) ──────────────
  interface WorkingTable {
    /** Location sinh ra bảng này — chỉ nối chunk cùng locationIndex (mục 2). */
    locationIndex: number;
    /** UAT #04 / T5: metadata biến thể phải đi cùng bảng, không chỉ nằm ở report cha. */
    variantTitleSource: string | null;
    periodScope: PeriodScope;
    statementKind: StatementKind;
    /** R3 — bộ báo cáo của bảng này (suy từ location). */
    consolidation: Consolidation | null;
    pageFrom: number;
    pageTo: number;
    /** UAT #04 / T8: đơn vị in trên chunk tạo bảng; khác đơn vị thì không được nối bảng. */
    unitSource: string | null;
    columns: TableColumn[];
    columnIds: Set<string>;
    rows: Array<{ row: TableRow; originalId: string | null; originalParentId: string | null }>;
  }

  const workingTables: WorkingTable[] = [];
  const pageRangeInputs: PageRange[] = [];
  let droppedColumnValues = 0;
  // T13.1/T13.2 — khoá nhãn duy nhất dùng trong merge: trim-only, giữ nguyên ngữ nghĩa cũ.
  const mergeRowLabelKey = (label: string | null): string => label?.trim() ?? '';
  const labelOverlapWithPrevious = (
    previous: WorkingTable,
    incomingRows: Array<{ labelSource?: string }> | undefined,
  ): number => {
    const previousLabels = new Set(
      previous.rows.map((entry) => mergeRowLabelKey(entry.row.label.source)).filter(Boolean),
    );
    const incomingLabels = new Set(
      (incomingRows ?? [])
        .map((row) => mergeRowLabelKey(typeof row.labelSource === 'string' ? row.labelSource : null))
        .filter(Boolean),
    );
    if (previousLabels.size === 0 || incomingLabels.size === 0) return 0;
    const overlap = [...previousLabels].filter((label) => incomingLabels.has(label)).length;
    return overlap / Math.min(previousLabels.size, incomingLabels.size);
  };
  for (const chunk of okChunks) {
    pageRangeInputs.push({ from: chunk.pageFrom, to: chunk.pageTo });

    const chunkUnitSource = normalizeUnitSource(chunk.result?.unitSource);
    for (const table of chunk.result?.tables ?? []) {
      const columns = normalizeColumns(table.columns ?? []);
      const columnIds = new Set(columns.map((c) => c.id));

      const previous = workingTables[workingTables.length - 1];
      const aiMarkedContinuation = table.isContinuation === true;
      // Continuation chỉ hợp lệ khi CÙNG location VÀ CÙNG đơn vị. Hai trang cùng report có
      // đơn vị khác nhau (Sony: 百万円 rồi 円) là hai bảng độc lập, không được nối giá trị.
      const sameLocation = !!previous && previous.locationIndex === chunk.locationIndex;
      const sameUnitSource = !!previous && previous.unitSource === chunkUnitSource;
      // Chunk không khai báo cột chỉ được coi là phần tiếp nối khi AI nói rõ isContinuation (mục 3).
      const columnsCompatible = sameLocation
        && sameUnitSource
        && sameColumnSet(previous!.columnIds, columnIds, aiMarkedContinuation)
        && (columnIds.size > 0 || aiMarkedContinuation);

      // B4 (vòng #03): AI có thể đặt column.id MỚI cho phần tiếp nối dù bố cục cột không đổi
      // (dù prompt đã truyền knownColumnIds). Khi cùng location và cùng SỐ LƯỢNG cột thì coi là
      // cùng bộ cột theo VỊ TRÍ, map id mới → id cũ, thay vì im lặng tạo bảng rời làm số liệu
      // của phần sau rơi ra khỏi bảng.
      let columnIdRemap: Map<string, string> | null = null;
      if (sameLocation && sameUnitSource && !columnsCompatible && columnIds.size > 0
          && columnIds.size === previous!.columnIds.size) {
        const remapResult = buildColumnRemap(previous!.columns, columns);

        if (remapResult.kind === 'remap') {
          const labelOverlap = remapResult.strategy === 'position'
            ? labelOverlapWithPrevious(previous!, table.rows)
            : 0;
          if (remapResult.strategy === 'position' && labelOverlap >= 0.5) {
            addWarning(
              warnings,
              'TABLE_SPLIT_HORIZONTALLY',
              `Trang ${chunk.pageFrom}: nhãn dòng trùng ${(labelOverlap * 100).toFixed(0)}%; đã tách bảng thay vì ghép theo vị trí cột.`,
            );
          } else {
            columnIdRemap = remapResult.remap;
            const mapping = [...remapResult.remap.entries()].map(([from, to]) => `${from}→${to}`).join(', ');
            addWarning(
              warnings,
              'COLUMN_ID_REMAPPED',
              `Trang ${chunk.pageFrom}: khớp theo ${remapResult.strategy === 'period' ? 'KỲ báo cáo' : 'VỊ TRÍ cột'} — ${mapping}.`,
            );
          }
        } else if (remapResult.kind === 'conflict') {
          // Vòng #04 mục 1: thà tách bảng còn hơn ghép sai kỳ báo cáo.
          addWarning(
            warnings,
            'TABLE_CONTINUATION_UNCERTAIN',
            `Trang ${chunk.pageFrom}: không nối được vào bảng trước vì ${remapResult.reason}. Đã tách thành bảng riêng.`,
          );
        }
      }

      const isContinuation = sameLocation
        && sameUnitSource
        && (chunk.chunkIndex > 0 || aiMarkedContinuation)
        && (columnsCompatible || columnIdRemap !== null);

      const tableTitle = typeof table.tableTitle === 'string' && table.tableTitle.trim()
        ? table.tableTitle.trim()
        : null;
      const target = isContinuation
        ? previous!
        : pushNewTable(
          workingTables,
          chunk.locationIndex,
          columns,
          columnIds,
          locations[chunk.locationIndex],
          chunkUnitSource,
          tableTitle,
        );

      if (isContinuation) {
        if (columns.length === 0) {
          addWarning(warnings, 'TABLE_CONTINUATION_UNCERTAIN', `Bảng tiếp nối ở trang ${chunk.pageFrom} không khai báo cột.`);
        } else if (columnIdRemap) {
          // B4: cột đã được map lại — bổ sung field thiếu theo id CŨ tương ứng.
          fillMissingColumnFields(
            target.columns,
            columns.map((c) => ({ ...c, id: columnIdRemap!.get(c.id) ?? c.id })),
          );
        } else {
          // mục 11: chunk sau có thể khai báo period/label mà chunk đầu thiếu → bổ sung,
          // KHÔNG ghi đè giá trị đã có.
          fillMissingColumnFields(target.columns, columns);
        }
      }

      for (const rawRow of table.rows ?? []) {
        const labelSource = typeof rawRow.labelSource === 'string' ? rawRow.labelSource.trim() : '';
        if (!labelSource) continue;

        // B4: nếu đã map lại cột thì key của `values` cũng phải đổi sang id cũ,
        // nếu không toàn bộ giá trị của phần tiếp nối sẽ bị loại vì "cột không khai báo".
        const rawValues = columnIdRemap ? remapValueKeys(rawRow.values, columnIdRemap) : rawRow.values;
        const { values, dropped } = buildValues(rawValues, target.columnIds);
        droppedColumnValues += dropped;

        // Chống dòng header trang được in lại: giống hệt dòng cuối đã gộp
        const last = target.rows[target.rows.length - 1];
        if (
          isContinuation &&
          last &&
          last.row.label.source === labelSource &&
          sameValues(last.row.values, values)
        ) {
          continue;
        }

        target.rows.push({
          row: {
            rowId: '', // gán lại ở bước re-index
            parentRowId: null,
            level: normalizeLevel(rawRow.level),
            rowType: normalizeRowType(rawRow.rowType),
            statementSection: null, // gán ở bước derive (Q9)
            label: createEmptyBilingual(labelSource),
            sourcePage: normalizeSourcePage(rawRow.sourcePage, chunk.pageFrom, chunk.pageTo),
            values,
          },
          originalId: typeof rawRow.rowId === 'string' ? rawRow.rowId : null,
          originalParentId: typeof rawRow.parentRowId === 'string' ? rawRow.parentRowId : null,
        });
      }
    }
  }

  if (droppedColumnValues > 0) {
    // Nói luôn HỆ QUẢ ở đây vì `addWarning` dedupe theo code: thêm warning thứ hai cùng code
    // sẽ bị bỏ, và người đọc sẽ không biết vì sao mất phần kiểm tra lệch tổng.
    addWarning(
      warnings,
      'UNKNOWN_COLUMN_DROPPED',
      `${droppedColumnValues} giá trị bị loại. Bỏ kiểm tra lệch tổng vì số liệu không còn đủ để đối chiếu.`,
    );
  }

  const nonEmptyTables = workingTables.filter((table) => table.rows.length > 0 || table.columns.length > 0);

  // Round 12 / T12.1 + Round 13 / T13.2 — chỉ bỏ bảng nghèo hơn khi nhãn và
  // R14-B: duplicate coverage has a dedicated value multiset unrelated to extractor IDs.
  // It retains multiplicity so repeated labels with the same rounded amount are not collapsed.
  const numericValuesOf = (table: WorkingTable): number[] => table.rows.flatMap((entry) =>
    Object.values(entry.row.values)
      .map((cell) => cell.normalized)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
  );
  const numericCellMultisetOf = (table: WorkingTable): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const entry of table.rows) {
      const label = mergeRowLabelKey(entry.row.label.source);
      if (!label) continue;
      for (const cell of Object.values(entry.row.values)) {
        const value = cell.normalized;
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const key = `${reportType}\u0000${label}\u0000${Math.round(value)}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  };
  const numericCellCountOf = (table: WorkingTable): number =>
    [...numericCellMultisetOf(table).values()].reduce((total, count) => total + count, 0);
  const labelContainment = (contained: WorkingTable, container: WorkingTable): number => {
    const containedLabels = new Set(contained.rows.map((entry) => mergeRowLabelKey(entry.row.label.source)).filter(Boolean));
    if (containedLabels.size === 0) return 0;
    const containerLabels = new Set(container.rows.map((entry) => mergeRowLabelKey(entry.row.label.source)).filter(Boolean));
    const overlap = [...containedLabels].filter((label) => containerLabels.has(label)).length;
    return overlap / containedLabels.size;
  };
  const valueCoverage = (contained: WorkingTable, container: WorkingTable): number => {
    const containedCells = numericCellMultisetOf(contained);
    const total = [...containedCells.values()].reduce((sum, count) => sum + count, 0);
    if (total === 0) return 0;
    const containerCells = numericCellMultisetOf(container);
    const matched = [...containedCells].reduce(
      (sum, [key, count]) => sum + Math.min(count, containerCells.get(key) ?? 0),
      0,
    );
    return matched / total;
  };
  const isContainedDuplicate = (contained: WorkingTable, container: WorkingTable): boolean =>
    // Unit is a semantic boundary: equal printed figures in JPY and million JPY must both survive.
    contained.unitSource === container.unitSource
    && labelContainment(contained, container) >= 0.9
    && valueCoverage(contained, container) >= 0.9;
  const duplicatePriority = (left: { table: WorkingTable; index: number }, right: { table: WorkingTable; index: number }): number => {
    const columnDifference = right.table.columns.length - left.table.columns.length;
    if (columnDifference !== 0) return columnDifference;
    const distinctCellDifference = numericCellCountOf(right.table) - numericCellCountOf(left.table);
    if (distinctCellDifference !== 0) return distinctCellDifference;
    const rowDifference = right.table.rows.length - left.table.rows.length;
    return rowDifference !== 0 ? rowDifference : left.index - right.index;
  };

  const indexedNonEmptyTables = nonEmptyTables.map((table, index) => ({ table, index }));
  const prioritizedTables = [...indexedNonEmptyTables].sort(duplicatePriority);
  const droppedTableIndices = new Set<number>();
  const duplicateDrops: Array<{ dropped: WorkingTable; kept: WorkingTable }> = [];

  for (const keeper of prioritizedTables) {
    if (droppedTableIndices.has(keeper.index)) continue;
    for (const candidate of indexedNonEmptyTables) {
      if (candidate.index === keeper.index || droppedTableIndices.has(candidate.index)) continue;
      if (!isContainedDuplicate(candidate.table, keeper.table)) continue;
      droppedTableIndices.add(candidate.index);
      duplicateDrops.push({ dropped: candidate.table, kept: keeper.table });
    }
  }

  if (duplicateDrops.length > 0) {
    const keptTables = nonEmptyTables.filter((_, index) => !droppedTableIndices.has(index));
    nonEmptyTables.splice(0, nonEmptyTables.length, ...keptTables);
    const details = duplicateDrops
      .map(({ dropped, kept }) => `bỏ trang ${dropped.pageFrom}-${dropped.pageTo} (${dropped.rows.length} dòng/${numericValuesOf(dropped).length} giá trị), `
        + `giữ trang ${kept.pageFrom}-${kept.pageTo} (${kept.rows.length} dòng/${numericValuesOf(kept).length} giá trị)`)
      .join('; ');
    addWarning(warnings, 'DUPLICATE_TABLE_DROPPED', `Đã bỏ ${duplicateDrops.length} bảng: ${details}.`);
  }

  // R1 (bổ sung sau UAT Sony 2026-08-06) — kỳ báo cáo KHÔNG luôn nằm ở tiêu đề báo cáo.
  // Sony dùng tiêu đề trần `連結損益計算書` cho cả bảng cả năm và bảng quý 4, kỳ chỉ có ở tiêu đề
  // CỘT. Suy kỳ chỉ từ tiêu đề nên cả 4 bảng ra UNKNOWN → R1 không có căn cứ và giữ luôn bảng quý.
  // Phải chạy Ở ĐÂY, sau khi mọi chunk đã gộp: `fillMissingColumnFields` có thể bổ sung
  // `period`/`label` của cột từ chunk sau, nên suy sớm lúc tạo bảng sẽ đọc cột chưa đủ dữ liệu.
  for (const table of nonEmptyTables) {
    if (table.periodScope !== 'UNKNOWN') continue;
    table.periodScope = detectPeriodScopeFromColumns(table.columns);
  }

  // R1 — Khi CÙNG một loại báo cáo có ĐỒNG THỜI biến thể kỳ NĂM và kỳ QUÝ thì CHỈ giữ kỳ năm,
  // LOẠI hẳn bảng kỳ quý (không chỉ sắp thứ tự như trước). Chỉ kích hoạt khi hai loại kỳ CÙNG
  // tồn tại, nên báo cáo một biến thể (kể cả chỉ có kỳ quý) không bị đụng tới.
  //
  // R1 là quy tắc CHỌN khi XUNG ĐỘT phạm vi kỳ, KHÔNG phải quy tắc bỏ dữ liệu:
  //   - có cả năm và quý  → giữ năm, bỏ quý (tránh trình bày số quý như số năm)
  //   - CHỈ có quý         → giữ quý (dữ liệu hợp lệ duy nhất) + FULL_YEAR_VARIANT_MISSING
  //   - nhiều kỳ CÙNG loại → giữ hết (R2), không nằm trong diện R1
  const hasFullYearVariant = nonEmptyTables.some((table) => table.periodScope === 'FULL_YEAR');
  const hasQuarterVariant = nonEmptyTables.some((table) => table.periodScope === 'QUARTER');
  const droppedQuarterTables = hasFullYearVariant && hasQuarterVariant
    ? nonEmptyTables.filter((table) => table.periodScope === 'QUARTER')
    : [];
  const keptTables = droppedQuarterTables.length > 0
    ? nonEmptyTables.filter((table) => table.periodScope !== 'QUARTER')
    : nonEmptyTables;

  // UAT #04 / T5: cả năm phải đứng trước để caller cũ đọc bảng đầu tiên không lấy nhầm số quý.
  const orderedWorkingTables = keptTables
    .map((table, originalIndex) => ({ table, originalIndex }))
    .sort((a, b) => {
      const periodDifference = variantPeriodRank(a.table.periodScope) - variantPeriodRank(b.table.periodScope);
      if (periodDifference !== 0) return periodDifference;
      const statementDifference = variantStatementRank(a.table.statementKind) - variantStatementRank(b.table.statementKind);
      return statementDifference !== 0 ? statementDifference : a.originalIndex - b.originalIndex;
    });

  const describeVariants = (tables: WorkingTable[]): string =>
    tables
      .map((table, index) => `bảng ${index + 1}: ${table.periodScope}/${table.statementKind} (trang ${table.pageFrom}-${table.pageTo})`)
      .join('; ');

  // R1 — bảng kỳ quý bị loại PHẢI được ghi vào chẩn đoán để truy được, không bỏ im lặng.
  if (droppedQuarterTables.length > 0) {
    addWarning(
      warnings,
      'MULTIPLE_VARIANTS_MERGED',
      `R1 — đã loại ${droppedQuarterTables.length} bảng kỳ quý, chỉ giữ kỳ năm. `
        + `Bảng bị loại: ${describeVariants(droppedQuarterTables)}. Bảng giữ lại: ${describeVariants(keptTables)}.`,
    );
  }

  if ((reportType === 'incomeStatement' || reportType === 'comprehensiveIncome') && orderedWorkingTables.length > 0) {
    const periodScopes = new Set(keptTables.map((table) => table.periodScope).filter((scope) => scope !== 'UNKNOWN'));
    const statementKinds = new Set(keptTables.map((table) => table.statementKind).filter((kind) => kind !== 'OTHER'));

    // Chỉ cảnh báo "nhiều biến thể bị gộp" khi KHÔNG rơi vào R1 (R1 đã có cảnh báo riêng ở trên).
    if (droppedQuarterTables.length === 0 && (periodScopes.size > 1 || statementKinds.size > 1)) {
      addWarning(warnings, 'MULTIPLE_VARIANTS_MERGED', describeVariants(keptTables));
    }
    if (!keptTables.some((table) => table.periodScope === 'FULL_YEAR')) {
      addWarning(warnings, 'FULL_YEAR_VARIANT_MISSING', describeVariants(keptTables));
    }
  }

  // Round 11B / T4.2 — chạy SAU R1/R3 (R3 đã chọn locations trước khi vào merge)
  // nhưng TRƯỚC final tableId/rowId. Không nới continuation: chỉ matrix equity mới đi qua nhánh này.
  const equityUnionDetails: Array<{
    basePosition: number;
    candidatePosition: number;
    addedColumnIds: string[];
  }> = [];
  const unionedWorkingTables = reportType === 'equityChangeStatement'
    ? (() => {
      const tablesForUnion = [...orderedWorkingTables];
      const sourcePositions = new Map(orderedWorkingTables.map(({ table }, index) => [table, index + 1] as const));
      const rowLabelKey = (label: string | null): string => label?.trim() ?? '';
      const columnLabelKey = (label: string | null): string => label
        ? label.normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/g, '')
        : '';
      const columnOverlapRatio = (left: WorkingTable, right: WorkingTable): number => {
        if (left.columns.length === 0 || right.columns.length === 0) return 1;
        const matchedLeftIndexes = new Set<number>();
        for (const rightColumn of right.columns) {
          const rightLabel = columnLabelKey(rightColumn.label.source);
          const matchingIndex = left.columns.findIndex((leftColumn, index) =>
            !matchedLeftIndexes.has(index)
            && (leftColumn.id === rightColumn.id
              || (rightLabel !== '' && columnLabelKey(leftColumn.label.source) === rightLabel)),
          );
          if (matchingIndex >= 0) matchedLeftIndexes.add(matchingIndex);
        }
        return matchedLeftIndexes.size / Math.min(left.columns.length, right.columns.length);
      };

      for (let baseIndex = 0; baseIndex < tablesForUnion.length; baseIndex++) {
        const base = tablesForUnion[baseIndex];
        for (let candidateIndex = baseIndex + 1; candidateIndex < tablesForUnion.length;) {
          const candidate = tablesForUnion[candidateIndex];
          if (
            base.table.consolidation !== candidate.table.consolidation
            || base.table.unitSource !== candidate.table.unitSource
            || base.table.periodScope !== candidate.table.periodScope
            || base.table.rows.length === 0
            || candidate.table.rows.length === 0
          ) {
            candidateIndex++;
            continue;
          }

          const baseRowsByLabel = new Map(
            base.table.rows.map((entry) => [rowLabelKey(entry.row.label.source), entry] as const),
          );
          const candidateLabels = new Set(candidate.table.rows.map((entry) => rowLabelKey(entry.row.label.source)));
          const intersection = [...candidateLabels].filter((label) => label && baseRowsByLabel.has(label)).length;
          if (intersection / Math.min(base.table.rows.length, candidate.table.rows.length) < 0.5) {
            candidateIndex++;
            continue;
          }
          if (columnOverlapRatio(base.table, candidate.table) > 0.2) {
            candidateIndex++;
            continue;
          }

          const columnIdMap = new Map<string, string>();
          const addedColumnIds: string[] = [];
          for (const incomingColumn of candidate.table.columns) {
            const existingColumn = base.table.columns.find((column) => column.id === incomingColumn.id);
            let targetId = incomingColumn.id;
            if (!existingColumn) {
              base.table.columns.push({ ...incomingColumn, label: { ...incomingColumn.label } });
              base.table.columnIds.add(targetId);
              addedColumnIds.push(targetId);
            } else if (existingColumn.label.source !== incomingColumn.label.source) {
              let suffix = 2;
              targetId = `${incomingColumn.id}_${suffix}`;
              while (base.table.columnIds.has(targetId)) {
                suffix++;
                targetId = `${incomingColumn.id}_${suffix}`;
              }
              base.table.columns.push({ ...incomingColumn, id: targetId, label: { ...incomingColumn.label } });
              base.table.columnIds.add(targetId);
              addedColumnIds.push(targetId);
            }
            columnIdMap.set(incomingColumn.id, targetId);
          }

          const usedOriginalIds = new Set(
            base.table.rows.map((entry) => entry.originalId).filter((id): id is string => !!id),
          );
          const originalIdMap = new Map<string, string>();
          for (const incomingEntry of candidate.table.rows) {
            if (!incomingEntry.originalId) continue;
            const matchingBaseEntry = baseRowsByLabel.get(rowLabelKey(incomingEntry.row.label.source));
            if (matchingBaseEntry) {
              if (!matchingBaseEntry.originalId) {
                let generatedId = `union-base-${sourcePositions.get(base.table) ?? baseIndex + 1}-${incomingEntry.originalId}`;
                let suffix = 2;
                while (usedOriginalIds.has(generatedId)) generatedId = `${generatedId}_${suffix++}`;
                matchingBaseEntry.originalId = generatedId;
                usedOriginalIds.add(generatedId);
              }
              originalIdMap.set(incomingEntry.originalId, matchingBaseEntry.originalId);
              continue;
            }

            let targetId = incomingEntry.originalId;
            let suffix = 2;
            while (usedOriginalIds.has(targetId)) targetId = `${incomingEntry.originalId}_${suffix++}`;
            originalIdMap.set(incomingEntry.originalId, targetId);
            usedOriginalIds.add(targetId);
          }

          const remapValues = (values: Record<string, CellValue>): Record<string, CellValue> => {
            const remapped: Record<string, CellValue> = {};
            for (const [columnId, value] of Object.entries(values)) {
              const targetId = columnIdMap.get(columnId);
              if (targetId) remapped[targetId] = { ...value };
            }
            return remapped;
          };

          for (const incomingEntry of candidate.table.rows) {
            const matchingBaseEntry = baseRowsByLabel.get(rowLabelKey(incomingEntry.row.label.source));
            const remappedValues = remapValues(incomingEntry.row.values);
            if (matchingBaseEntry) {
              // Không ghi đè số đã có: chỉ lấp ô trống của dòng chung.
              for (const [columnId, value] of Object.entries(remappedValues)) {
                if (matchingBaseEntry.row.values[columnId] === undefined) matchingBaseEntry.row.values[columnId] = value;
              }
              continue;
            }

            base.table.rows.push({
              row: {
                ...incomingEntry.row,
                label: { ...incomingEntry.row.label },
                values: remappedValues,
              },
              originalId: incomingEntry.originalId
                ? originalIdMap.get(incomingEntry.originalId) ?? incomingEntry.originalId
                : null,
              originalParentId: incomingEntry.originalParentId
                ? originalIdMap.get(incomingEntry.originalParentId) ?? incomingEntry.originalParentId
                : null,
            });
          }

          equityUnionDetails.push({
            basePosition: sourcePositions.get(base.table) ?? baseIndex + 1,
            candidatePosition: sourcePositions.get(candidate.table) ?? candidateIndex + 1,
            addedColumnIds,
          });
          tablesForUnion.splice(candidateIndex, 1);
        }
      }
      return tablesForUnion;
    })()
    : orderedWorkingTables;

  // ── Re-index rowId unique sau merge (§17) ───────────────────────────────
  const prefix = ROW_ID_PREFIX[reportType];
  let seq = 0;
  const tables: ReportTable[] = unionedWorkingTables
    .map(({ table: workingTable }, tableIndex) => {
      const idMap = new Map<string, string>();
      for (const entry of workingTable.rows) {
        seq++;
        const newId = `${prefix}-${String(seq).padStart(3, '0')}`;
        entry.row.rowId = newId;
        if (entry.originalId) idMap.set(entry.originalId, newId);
      }
      for (const entry of workingTable.rows) {
        if (!entry.originalParentId) continue;
        const mapped = idMap.get(entry.originalParentId);
        if (mapped && mapped !== entry.row.rowId) {
          entry.row.parentRowId = mapped;
        } else if (!mapped) {
          addWarning(warnings, 'ORPHAN_PARENT_ROW');
        }
      }
      return {
        tableId: `${reportType}-${tableIndex + 1}`,
        columns: workingTable.columns,
        rows: workingTable.rows.map((entry) => entry.row),
        variantTitle: workingTable.variantTitleSource
          ? createEmptyBilingual(workingTable.variantTitleSource)
          : null,
        periodScope: workingTable.periodScope,
        statementKind: workingTable.statementKind,
        consolidation: workingTable.consolidation,
        unit: workingTable.unitSource ? resolveUnit(workingTable.unitSource, targetLang) : null,
      };
    });

  if (equityUnionDetails.length > 0) {
    const details = equityUnionDetails
      .map((detail) => `equityChangeStatement-${detail.basePosition} + equityChangeStatement-${detail.candidatePosition}; `
        + `cột thêm: ${detail.addedColumnIds.join(', ') || '(không có)'}`)
      .join('; ');
    addWarning(warnings, 'COLUMN_SET_UNIONED', details);
  }

  if (tables.every((t) => t.rows.length === 0)) return createNotFoundTabularReport();

  const pageRanges = mergePageRanges(pageRangeInputs);

  // ── Validate bằng code — chỉ sinh warning (§19) ────────────────────────
  // CODE-REVIEW-01 mục 9: BỎ validateSourcePages. Lý do chọn hướng này:
  // `normalizeSourcePage` cố tình kẹp sourcePage về dải trang của chunk đã gửi cho AI
  // (Gemini Flash thường trả số trang tương đối trong chunk thay vì số trang gốc).
  // Giữ việc kẹp → giá trị trong contract §4 luôn đúng dải trang; check "ngoài dải" vì thế
  // không bao giờ đúng nên hàm validate là dead code, đã xoá thay vì bỏ kẹp.
  validateColumnPeriods(reportType, tables, warnings);
  // I1 (UAT #01): báo cáo khác balanceSheet mà chứa mốc khối của bảng cân đối → nghi gán sai loại.
  warnIfLooksLikeBalanceSheet(reportType, tables, warnings);
  if (reportType === 'balanceSheet') {
    // Q9: gán khối ASSETS / LIABILITIES / EQUITY cho từng dòng, do code suy ra.
    const sectionStats = deriveStatementSections(tables);
    // B2: quá nhiều dòng không suy được khối → layout 2 khối không đáng tin, phải nói ra.
    if (
      sectionStats.total > 0 &&
      sectionStats.unresolved / sectionStats.total > SECTION_NULL_RATIO_THRESHOLD
    ) {
      addWarning(
        warnings,
        'SECTION_DETECTION_WEAK',
        `${sectionStats.unresolved}/${sectionStats.total} dòng không xác định được khối.`,
      );
    }
    validateBalanceSheetTotals(tables, warnings);
  }
  if (reportType === 'equityChangeStatement') {
    // KHÔNG kiểm lệch tổng khi CHÍNH CODE đã loại giá trị (UNKNOWN_COLUMN_DROPPED) hoặc khi
    // có chunk bị thiếu: lúc đó phép tính chắc chắn không cân, nhưng lỗi là do dữ liệu bị mất
    // ở phía mình, không phải AI đọc sai số. Đã gặp thật trên Air Water: 1 giá trị bị loại →
    // "số dư đầu kỳ 298517 + biến động -7661 ≠ số dư cuối kỳ 308032" (thiếu đúng 17176), báo
    // TOTAL_MISMATCH khiến người đọc đi soi lại số của AI một cách vô ích.
    // Hệ quả đã được ghi vào detail của UNKNOWN_COLUMN_DROPPED phía trên.
    if (droppedColumnValues === 0) validateEquityMovement(tables, warnings);
  }

  // T8: đơn vị có thể thay đổi giữa các bảng trong cùng report. Bảng luôn giữ đơn vị đã
  // đọc tại chunk của nó; report.unit chỉ được gán khi mọi bảng có cùng một đơn vị rõ ràng.
  const tableUnitSources = tables
    .map((table) => normalizeUnitSource(table.unit?.source))
    .filter((source): source is string => source !== null);
  const distinctUnitSources = [...new Set(tableUnitSources)];
  const unit = distinctUnitSources.length === 1 ? resolveUnit(distinctUnitSources[0], targetLang) : null;

  if (distinctUnitSources.length > 1) {
    const affectedTables = tables
      .filter((table) => table.unit?.source)
      .map((table) => `${table.tableId} (${table.unit!.source})`)
      .join('; ');
    addWarning(warnings, 'UNIT_VARIES_WITHIN_REPORT', `Bảng/đơn vị bị ảnh hưởng: ${affectedTables}.`);
  }
  if (unit && unit.multiplier == null) {
    addWarning(warnings, 'UNIT_NOT_FOUND', `Không nhận diện được đơn vị "${unit.source}" của báo cáo này.`);
  }
  // B1 (vòng #03): không có đơn vị ở BẤT KỲ bảng nào → downstream mới phải fallback về
  // generalInformation.unit. Có table.unit thì không gắn warning giả chỉ vì report.unit = null.
  if (tableUnitSources.length === 0) {
    addWarning(warnings, 'REPORT_UNIT_ASSUMED_FROM_DOCUMENT');
  }

  // ── Gán status (§18) ───────────────────────────────────────────────────
  const allRows = tables.flatMap((t) => t.rows);
  const hasDetail = allRows.some((r) => r.rowType === 'DETAIL');
  const hasTotal = allRows.some((r) => r.rowType === 'TOTAL' || r.rowType === 'SUBTOTAL');
  let status: TabularReport['status'] = 'FOUND';

  if (!hasDetail && hasTotal) {
    // A5: chỉ có tổng, thiếu chi tiết (ví dụ SGA của mẫu OG Corp)
    status = 'PARTIAL';
    addWarning(warnings, 'DETAIL_NOT_FOUND');
  } else if (failedChunks.length > 0) {
    status = 'PARTIAL';
  } else if (okChunks.some((c) => c.aiWarnings.some((w) => mapAiWarning(w) === 'DETAIL_NOT_FOUND'))) {
    status = 'PARTIAL';
    addWarning(warnings, 'DETAIL_NOT_FOUND');
  }

  return {
    status,
    title: titleSource ? createEmptyBilingual(titleSource) : null,
    pageRanges,
    unit,
    warnings,
    tables,
  };
}

// ─── Q9: suy ra khối của bảng cân đối kế toán (ASSETS / LIABILITIES / EQUITY) ──

/**
 * Chuẩn hoá nhãn trước khi so mốc khối: bỏ ngoặc bao ngoài, số thứ tự đầu dòng, dấu câu cuối,
 * khoảng trắng toàn phần. Nhờ vậy `(資産の部)` và `I. 流動資産` vẫn khớp đúng mốc.
 */
export function normalizeSectionLabel(label: string | null): string {
  if (!label) return '';
  return label
    .toLowerCase()
    .replace(/[\u3000\u00a0]/g, ' ')
    .replace(/^[（(\[【\s]+/, '')
    .replace(/[）)\]】\s]+$/, '')
    // Số thứ tự đầu dòng: BẮT BUỘC có dấu ngăn cách, nếu không "income..." sẽ bị cắt mất chữ "i".
    .replace(/^(?:[ivxlcdm]+|[0-9０-９]+|[一二三四五六七八九十]+)[.．、)）:：]\s*/, '')
    .replace(/[.．、,，:：;；]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nhãn CẤU TRÚC của bảng cân đối — khớp CHÍNH XÁC theo nhãn đã chuẩn hoá, KHÔNG dùng
 * kiểu "chứa chuỗi". Gặp nhãn này thì đổi khối BẤT KỂ `rowType` mà AI gán.
 *
 * Lý do đổi sang khớp chính xác (UAT #01 / I8): bản cũ dùng `includes()` với các từ trần
 * `equity` / `assets` / `liabilities`, nên tên khoản mục thật cũng bị hiểu là mốc khối.
 * Đã gặp trên Air Water: `Investments accounted for using equity method` (tài sản dài hạn)
 * bị gán EQUITY vì chứa chữ `equity`, kéo theo dòng `Retirement benefit asset` ngay sau đó
 * cũng vào EQUITY → hai dòng tài sản bị in sang cột NỢ PHẢI TRẢ và bị compare tính là lệch.
 *
 * `liabilities and equity` mở khối PHẢI nên gán LIABILITIES, không phải EQUITY.
 */
const EXACT_SECTION_LABELS: Array<{ section: StatementSection; labels: string[] }> = [
  {
    section: 'ASSETS',
    labels: [
      'assets', 'total assets', 'current assets', 'non-current assets', 'noncurrent assets',
      'fixed assets',
      '資産', '資産の部', '流動資産', '固定資産', '非流動資産', '資産合計', '総資産',
    ],
  },
  {
    section: 'LIABILITIES',
    labels: [
      'liabilities', 'total liabilities', 'current liabilities', 'non-current liabilities',
      'noncurrent liabilities', 'liabilities and equity', 'liabilities and net assets',
      '負債', '負債の部', '流動負債', '固定負債', '非流動負債', '負債合計',
      '負債及び純資産', '負債純資産の部',
    ],
  },
  {
    section: 'EQUITY',
    labels: [
      'equity', 'total equity', 'net assets', 'total net assets',
      "shareholders' equity", "total shareholders' equity", 'stockholders equity',
      '純資産', '純資産の部', '資本の部', '株主資本', '純資産合計', '資本合計',
    ],
  },
];

/**
 * Mốc khối tiếng Nhật khớp theo kiểu chứa chuỗi — an toàn vì đều mang hậu tố `の部` / `合計`
 * nên không thể là tên một khoản mục lẻ.
 *
 * Thứ tự quan trọng: 純資産 khớp TRƯỚC 負債 vì có dòng "負債及び純資産合計".
 */
const JA_STRUCTURAL_MARKERS: Array<{ section: StatementSection; markers: string[] }> = [
  { section: 'EQUITY', markers: ['純資産の部', '資本の部', '純資産合計', '資本合計'] },
  { section: 'LIABILITIES', markers: ['負債の部', '負債合計'] },
  { section: 'ASSETS', markers: ['資産の部', '資産合計', '総資産'] },
];

/**
 * Nhãn khớp YẾU: có thể nằm trong tên khoản mục thường (ví dụ 'その他の負債' đứng trong
 * khối Tài sản, hay 'equity method' trong khối Tài sản). Vì vậy CHỈ đổi khối ở dòng
 * `rowType !== 'DETAIL'` — dòng chi tiết luôn thừa hưởng khối đang hiện hành.
 */
const WEAK_SECTION_KEYWORDS: Array<{ section: StatementSection; keywords: string[] }> = [
  { section: 'EQUITY', keywords: ['純資産', '株主資本', 'stockholders', 'net assets', 'equity'] },
  { section: 'LIABILITIES', keywords: ['負債', 'liabilities'] },
  { section: 'ASSETS', keywords: ['資産', 'assets'] },
];

/** Vượt tỷ lệ này mà không suy được khối → gắn warning SECTION_DETECTION_WEAK. */
const SECTION_NULL_RATIO_THRESHOLD = 0.3;

/**
 * Gán `statementSection` cho từng dòng của bảng cân đối kế toán.
 *
 * Đi tuần tự theo thứ tự in trên tài liệu; gặp nhãn khối thì đổi khối hiện hành và gán
 * cho các dòng tiếp theo. Đây là CODE suy ra, KHÔNG hỏi AI — nhưng vẫn phụ thuộc AI đọc
 * đúng NHÃN dòng, nên có ngưỡng cảnh báo ở caller.
 *
 * Dòng đứng trước nhãn khối đầu tiên để `null` (thường là dòng tiêu đề bảng).
 * Dòng tổng chung như 負債及び純資産合計 giữ khối đang hiện hành.
 *
 * Trả về số dòng và số dòng KHÔNG suy được khối để caller quyết định gắn warning.
 */
export function deriveStatementSections(tables: ReportTable[]): { total: number; unresolved: number } {
  let total = 0;
  let unresolved = 0;

  for (const table of tables) {
    let current: StatementSection | null = null;
    for (const row of table.rows) {
      const structural = detectStructuralSection(row.label.source);
      if (structural) {
        current = structural;
      } else if (row.rowType !== 'DETAIL') {
        const weak = detectWeakSection(row.label.source);
        if (weak) current = weak;
      }
      row.statementSection = current;
      total++;
      if (current === null) unresolved++;
    }
  }

  return { total, unresolved };
}

/** Mốc khối chắc chắn: nhãn chuẩn hoá khớp CHÍNH XÁC, hoặc mốc tiếng Nhật có `の部`/`合計`. */
function detectStructuralSection(label: string | null): StatementSection | null {
  const text = normalizeSectionLabel(label);
  if (!text) return null;

  for (const { section, labels } of EXACT_SECTION_LABELS) {
    if (labels.some((candidate) => candidate.toLowerCase() === text)) return section;
  }
  for (const { section, markers } of JA_STRUCTURAL_MARKERS) {
    if (markers.some((marker) => text.includes(marker))) return section;
  }
  return null;
}

function detectWeakSection(label: string | null): StatementSection | null {
  const text = normalizeSectionLabel(label);
  if (!text) return null;
  for (const { section, keywords } of WEAK_SECTION_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword.toLowerCase()))) return section;
  }
  return null;
}

// ─── I1 (UAT #01): phát hiện báo cáo có thể bị gán SAI loại ───────────────────

/**
 * Mốc khối của BẢNG CÂN ĐỐI. Xuất hiện trong một báo cáo KHÁC balanceSheet là dấu hiệu
 * classify đã gán sai loại — đã gặp trên Sony: `連結財政状態計算書` (bảng cân đối theo IFRS)
 * bị đưa vào `incomeStatement`, dòng đầu bảng là `(資産の部)`.
 *
 * Chỉ dùng nhãn khớp CHÍNH XÁC để tránh báo động giả.
 */
const BALANCE_SHEET_MARKER_LABELS = [
  'assets', 'liabilities', 'equity', 'liabilities and equity', 'total assets',
  '資産の部', '負債の部', '純資産の部', '資本の部', '資産合計', '負債合計', '純資産合計',
];

/**
 * Gắn `REPORT_TYPE_SUSPECT` khi bảng của báo cáo (không phải balanceSheet) chứa mốc khối
 * của bảng cân đối. CHỈ cảnh báo — KHÔNG tự đổi `reportType` để không phá case đang đúng.
 */
function warnIfLooksLikeBalanceSheet(
  reportType: ReportType,
  tables: ReportTable[],
  warnings: ReportWarning[],
): void {
  if (reportType === 'balanceSheet') return;

  const hits: string[] = [];
  for (const table of tables) {
    for (const row of table.rows) {
      const text = normalizeSectionLabel(row.label.source);
      if (!text) continue;
      if (BALANCE_SHEET_MARKER_LABELS.includes(text)) {
        hits.push(`"${row.label.source}" (trang ${row.sourcePage ?? '?'})`);
      }
    }
  }

  if (hits.length === 0) return;
  addWarning(
    warnings,
    'REPORT_TYPE_SUSPECT',
    `Tìm thấy mốc khối của bảng cân đối kế toán trong báo cáo "${reportType}": ${hits.slice(0, 3).join(', ')}.`,
  );
}

// ─── Merge thuyết minh ───────────────────────────────────────────────────────

export function mergeNotesReport(
  locations: ReportLocation[],
  chunks: NotesChunkOutcome[],
): NotesReport {
  if (locations.length === 0 || chunks.length === 0) return createNotFoundNotesReport();

  const warnings: ReportWarning[] = [];
  const sorted = [...chunks].sort((a, b) => a.pageFrom - b.pageFrom);
  const okChunks = sorted.filter((c) => c.result !== null);
  const failedChunks = sorted.filter((c) => c.result === null);
  const deterministicFailures = sorted.filter((c) => c.result === null && c.deterministicFailure);

  if (deterministicFailures.length > 0) {
    addWarning(
      warnings,
      'NOTES_PAGE_AI_OUTPUT_LIMIT',
      `Trang ${deterministicFailures.map((c) => `${c.pageFrom}-${c.pageTo}`).join(', ')} bị lặp/cụt sau tối đa 2 lần gọi AI.`,
    );
  }

  const titleSource =
    okChunks.map((c) => c.result?.titleSource).find((t): t is string => typeof t === 'string' && !!t.trim())
    ?? locations.map((l) => l.titleSource).find((t): t is string => !!t)
    ?? null;

  if (okChunks.length === 0) {
    return {
      status: 'UNREADABLE',
      title: titleSource ? createEmptyBilingual(titleSource) : null,
      pageRanges: mergePageRanges(locations.map((l) => ({ from: l.pageFrom, to: l.pageTo }))),
      unit: null,
      warnings: [
        makeWarning('LOW_CONFIDENCE_PAGE', `Không bóc được nội dung ở ${sorted.length} chunk.`),
        ...warnings,
      ],
      sections: [],
    };
  }

  const allNotFound = okChunks.every((c) => c.result?.notFound === true && (c.result?.sections?.length ?? 0) === 0);
  if (allNotFound) return createNotFoundNotesReport();

  if (failedChunks.length > 0) {
    addWarning(
      warnings,
      'LOW_CONFIDENCE_PAGE',
      `Thiếu ${failedChunks.length}/${sorted.length} chunk: trang ${failedChunks.map((c) => `${c.pageFrom}-${c.pageTo}`).join(', ')}.`,
    );
  }

  const sections: NoteSection[] = [];
  const pageRangeInputs: PageRange[] = [];
  /** Location của section cuối đã thêm — không nối section giữa 2 location khác nhau (mục 2). */
  let lastLocationIndex: number | null = null;

  for (const chunk of okChunks) {
    pageRangeInputs.push({ from: chunk.pageFrom, to: chunk.pageTo });
    for (const raw of chunk.result?.sections ?? []) {
      const sourceText = typeof raw.sourceText === 'string' ? raw.sourceText.trim() : '';
      const title = typeof raw.titleSource === 'string' ? raw.titleSource.trim() : '';
      if (!sourceText && !title) continue;

      const previous = sections[sections.length - 1];
      const sameLocation = lastLocationIndex === chunk.locationIndex;
      // Mục bị cắt qua trang: cùng location + cùng tiêu đề → nối tiếp nội dung, không tạo section mới
      if (previous && sameLocation && title && previous.title.source === title) {
        previous.sourceText = `${previous.sourceText}\n${sourceText}`.trim();
        continue;
      }

      sections.push({
        sectionId: `note-${String(sections.length + 1).padStart(3, '0')}`,
        sourcePage: normalizeSourcePage(raw.sourcePage, chunk.pageFrom, chunk.pageTo),
        title: createEmptyBilingual(title || null),
        sourceText,
        translatedText: null,
      });
      lastLocationIndex = chunk.locationIndex;
    }
  }

  if (sections.length === 0) return createNotFoundNotesReport();

  return {
    status: failedChunks.length > 0 ? 'PARTIAL' : 'FOUND',
    title: titleSource ? createEmptyBilingual(titleSource) : null,
    pageRanges: mergePageRanges(pageRangeInputs),
    unit: null,
    warnings,
    sections,
  };
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function pushNewTable(
  tables: Array<{
    locationIndex: number;
    variantTitleSource: string | null;
    periodScope: PeriodScope;
    statementKind: StatementKind;
    consolidation: Consolidation | null;
    pageFrom: number;
    pageTo: number;
    unitSource: string | null;
    columns: TableColumn[];
    columnIds: Set<string>;
    rows: Array<{ row: TableRow; originalId: string | null; originalParentId: string | null }>;
  }>,
  locationIndex: number,
  columns: TableColumn[],
  columnIds: Set<string>,
  location: ReportLocation | undefined,
  unitSource: string | null,
  tableTitle: string | null,
) {
  const variantTitleSource = tableTitle ?? location?.titleSource ?? null;
  const periodScopeFromTableTitle = detectPeriodScope(tableTitle);
  const periodScope = periodScopeFromTableTitle !== 'UNKNOWN'
    ? periodScopeFromTableTitle
    : detectPeriodScope(location?.titleSource ?? null);
  const statementKindFromTableTitle = detectStatementKind(tableTitle);
  const statementKind = statementKindFromTableTitle !== 'OTHER'
    ? statementKindFromTableTitle
    : detectStatementKind(location?.titleSource ?? null);
  const table = {
    locationIndex,
    variantTitleSource,
    periodScope,
    statementKind,
    consolidation: location?.consolidation ?? detectConsolidation(variantTitleSource),
    pageFrom: location?.pageFrom ?? 0,
    pageTo: location?.pageTo ?? 0,
    unitSource,
    columns,
    columnIds,
    rows: [] as Array<{ row: TableRow; originalId: string | null; originalParentId: string | null }>,
  };
  tables.push(table);
  return table;
}

/** UAT #04 / T5: xếp kỳ năm trước các biến thể khác mà không làm xáo trộn cùng hạng. */
function variantPeriodRank(scope: PeriodScope): number {
  return scope === 'FULL_YEAR' ? 0 : 1;
}

/** UAT #04 / T5: thứ tự nghiệp vụ trong cùng kỳ của họ Báo cáo kết quả kinh doanh. */
function variantStatementRank(kind: StatementKind): number {
  switch (kind) {
    case 'PROFIT_LOSS': return 0;
    case 'COMBINED': return 1;
    case 'COMPREHENSIVE_INCOME': return 2;
    default: return 3;
  }
}

/**
 * mục 11 — Khi nối bảng, chunk sau có thể khai báo `period` / `labelSource` mà chunk đầu
 * thiếu. Bổ sung field CÒN THIẾU vào cột đã tồn tại, không ghi đè giá trị đã có.
 */
function fillMissingColumnFields(existing: TableColumn[], incoming: TableColumn[]): void {
  for (const column of incoming) {
    const target = existing.find((c) => c.id === column.id);
    if (!target) continue;
    if (!target.period && column.period) target.period = column.period;
    if (!target.label.source && column.label.source) target.label.source = column.label.source;
  }
}

function normalizeUnitSource(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeColumns(raw: Array<{ id?: string; labelSource?: string; dataType?: string; period?: string | null }>): TableColumn[] {
  const seen = new Set<string>();
  const columns: TableColumn[] = [];
  for (const col of raw) {
    const id = typeof col?.id === 'string' ? col.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    columns.push({
      id,
      label: createEmptyBilingual(typeof col.labelSource === 'string' && col.labelSource.trim() ? col.labelSource.trim() : null),
      dataType: col.dataType === 'text' ? 'text' : 'number',
      period: typeof col.period === 'string' && col.period.trim() ? col.period.trim() : null,
    });
  }
  return columns;
}

/** `values` chỉ chứa key có trong `columns`; ô trống thì BỎ KEY (không đặt 0). */
function buildValues(
  raw: Record<string, string | number | null> | undefined,
  columnIds: Set<string>,
): { values: Record<string, CellValue>; dropped: number } {
  const values: Record<string, CellValue> = {};
  let dropped = 0;
  if (!raw || typeof raw !== 'object') return { values, dropped };

  for (const [key, value] of Object.entries(raw)) {
    if (!columnIds.has(key)) {
      if (value !== null && value !== undefined && String(value).trim() !== '') dropped++;
      continue;
    }
    const cell = toCellValue(value);
    if (cell) values[key] = cell;
  }
  return { values, dropped };
}

/**
 * mục 3 — Trước đây `b.size === 0` luôn trả true nên MỌI bảng không khai báo cột đều bị
 * nối vào bảng trước. Giờ trường hợp rỗng chỉ được chấp nhận khi AI đánh dấu
 * `isContinuation === true` (caller đã kiểm tra thêm điều kiện cùng locationIndex).
 */
/**
 * Kết quả map lại `column.id` giữa 2 chunk (B4).
 *   none     — id đã trùng hoàn toàn, không cần map (caller không gắn warning vô ích).
 *   remap    — map được; `strategy` cho biết khớp theo `period` hay theo VỊ TRÍ.
 *   conflict — hai bên đều khai `period` nhưng tập giá trị KHÔNG khớp được → KHÔNG ĐƯỢC nối.
 */
type ColumnRemapResult =
  | { kind: 'none' }
  | { kind: 'remap'; remap: Map<string, string>; strategy: 'period' | 'position' }
  | { kind: 'conflict'; reason: string };

/**
 * B4 + vòng #04 mục 1 — Map `column.id` của chunk tiếp nối sang id của bảng trước.
 *
 * Chỉ gọi khi cùng location và cùng SỐ LƯỢNG cột.
 *
 * Vì sao KHÔNG map thuần theo vị trí: bản cũ giả định ngầm rằng chunk sau giữ đúng thứ tự cột
 * như chunk trước. Nếu model trả `[previousPeriod, currentPeriod]` ở chunk 2 trong khi chunk 1
 * là `[currentPeriod, previousPeriod]` thì map theo index sẽ ĐỔI CHỖ hai kỳ — số kỳ trước bị
 * ghi vào cột kỳ hiện tại. Sai kỳ báo cáo là lỗi nghiêm trọng về nghiệp vụ, warning không cứu được.
 *
 * Thứ tự ưu tiên:
 *   1. Cả hai bên khai `period` cho MỌI cột và `period` là duy nhất trong từng bên
 *      → khớp theo GIÁ TRỊ `period`, bỏ qua thứ tự.
 *   2. Không đủ điều kiện trên (thiếu `period` ở một bên, hoặc `period` trùng lặp)
 *      → fallback map theo VỊ TRÍ như trước.
 *   3. Cả hai bên đủ `period` nhưng tập giá trị không khớp → `conflict`: thà TÁCH BẢNG
 *      còn hơn ghép sai kỳ.
 */
function buildColumnRemap(
  previousColumns: TableColumn[],
  incomingColumns: TableColumn[],
): ColumnRemapResult {
  if (previousColumns.length !== incomingColumns.length || incomingColumns.length === 0) {
    return { kind: 'none' };
  }

  const previousPeriods = previousColumns.map((c) => (c.period ?? '').trim());
  const incomingPeriods = incomingColumns.map((c) => (c.period ?? '').trim());
  const hasAllPeriods = [...previousPeriods, ...incomingPeriods].every((p) => p !== '');
  const uniqueOnBothSides =
    new Set(previousPeriods).size === previousPeriods.length &&
    new Set(incomingPeriods).size === incomingPeriods.length;

  if (hasAllPeriods && uniqueOnBothSides) {
    const previousByPeriod = new Map<string, string>();
    previousColumns.forEach((column, i) => previousByPeriod.set(previousPeriods[i], column.id));

    const remap = new Map<string, string>();
    for (let i = 0; i < incomingColumns.length; i++) {
      const target = previousByPeriod.get(incomingPeriods[i]);
      if (!target) {
        return {
          kind: 'conflict',
          reason:
            `kỳ [${incomingPeriods.join(', ')}] không khớp kỳ của bảng trước [${previousPeriods.join(', ')}]`,
        };
      }
      remap.set(incomingColumns[i].id, target);
    }
    return isIdentityRemap(remap) ? { kind: 'none' } : { kind: 'remap', remap, strategy: 'period' };
  }

  const remap = new Map<string, string>();
  for (let i = 0; i < incomingColumns.length; i++) {
    remap.set(incomingColumns[i].id, previousColumns[i].id);
  }
  return isIdentityRemap(remap) ? { kind: 'none' } : { kind: 'remap', remap, strategy: 'position' };
}

function isIdentityRemap(remap: Map<string, string>): boolean {
  for (const [from, to] of remap) {
    if (from !== to) return false;
  }
  return true;
}

/** Đổi key của `values` theo bảng map id (B4). Giữ nguyên key không có trong map. */
function remapValueKeys(
  raw: Record<string, string | number | null> | undefined,
  remap: Map<string, string>,
): Record<string, string | number | null> | undefined {
  if (!raw || typeof raw !== 'object') return raw;
  const out: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[remap.get(key) ?? key] = value;
  }
  return out;
}

function sameColumnSet(a: Set<string>, b: Set<string>, allowEmptyIncoming: boolean): boolean {
  if (b.size === 0) return allowEmptyIncoming;
  if (a.size !== b.size) return false;
  for (const id of b) if (!a.has(id)) return false;
  return true;
}

function sameValues(a: Record<string, CellValue>, b: Record<string, CellValue>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => b[k] && a[k].raw === b[k].raw);
}

function normalizeLevel(level: unknown): number {
  const n = Number(level);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.round(n), 10);
}

function normalizeRowType(value: unknown): RowType {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return (ROW_TYPES as readonly string[]).includes(text) ? (text as RowType) : 'DETAIL';
}

function normalizeSourcePage(value: unknown, from: number, to: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return from;
  const rounded = Math.round(n);
  if (rounded < from || rounded > to) return from;
  return rounded;
}

export function mergePageRanges(ranges: PageRange[]): PageRange[] {
  const valid = ranges
    .filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to) && r.to >= r.from)
    .sort((a, b) => a.from - b.from);
  if (valid.length === 0) return [];

  const merged: PageRange[] = [{ ...valid[0] }];
  for (let i = 1; i < valid.length; i++) {
    const last = merged[merged.length - 1];
    if (valid[i].from <= last.to + 1) {
      last.to = Math.max(last.to, valid[i].to);
    } else {
      merged.push({ ...valid[i] });
    }
  }
  return merged;
}

/**
 * Ánh xạ warning do AI trả về sang mã của contract.
 *
 * Vòng #05 mục 36 — BỎ suy diễn bằng `includes`. Lý do: nó biến mọi chuỗi có chữ "unit"
 * (kể cả "unit is stated in millions of yen" = đọc ĐƯỢC đơn vị) thành UNIT_NOT_FOUND,
 * mọi chuỗi có "period" thành PERIOD_AMBIGUOUS… → warning dương tính giả tràn output,
 * BU mất niềm tin vào cột cảnh báo. Nay chỉ nhận mã CHÍNH XÁC, cộng một bảng alias
 * tường minh cho các biến thể prompt thực sự có thể sinh ra.
 */
const AI_WARNING_ALIASES: Record<string, WarningCode> = {
  DETAIL_ROWS_NOT_FOUND: 'DETAIL_NOT_FOUND',
  DETAILS_NOT_FOUND: 'DETAIL_NOT_FOUND',
  NO_DETAIL_ROWS: 'DETAIL_NOT_FOUND',
  UNIT_UNKNOWN: 'UNIT_NOT_FOUND',
  UNIT_MISSING: 'UNIT_NOT_FOUND',
  PERIOD_UNCLEAR: 'PERIOD_AMBIGUOUS',
  PERIOD_UNKNOWN: 'PERIOD_AMBIGUOUS',
  CONTINUATION_UNCERTAIN: 'TABLE_CONTINUATION_UNCERTAIN',
  TABLE_CONTINUATION_UNKNOWN: 'TABLE_CONTINUATION_UNCERTAIN',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE_PAGE',
  BLURRY_PAGE: 'LOW_CONFIDENCE_PAGE',
  PAGE_BLURRY: 'LOW_CONFIDENCE_PAGE',
};

function mapAiWarning(raw: string): WarningCode | null {
  const upper = raw.trim().toUpperCase();
  const known = Object.keys(WARNING_MESSAGES) as WarningCode[];
  const direct = known.find((code) => code === upper);
  if (direct) return direct;
  return AI_WARNING_ALIASES[upper] ?? null;
}

// ─── Validate (§19) — chỉ warning, không sửa số ──────────────────────────────

/**
 * Cột số liệu thiếu `period` → PERIOD_AMBIGUOUS.
 *
 * Vòng #05 mục 37 — KHÔNG áp cho `equityChangeStatement`: ở báo cáo biến động vốn chủ sở hữu,
 * cột là THÀNH PHẦN vốn (vốn góp, thặng dư, lợi nhuận giữ lại, lợi ích cổ đông không kiểm
 * soát…), không phải kỳ báo cáo — thiếu `period` là đúng bản chất bảng, cảnh báo là dương
 * tính giả 100% số lần.
 */
function validateColumnPeriods(
  reportType: ReportType,
  tables: ReportTable[],
  warnings: ReportWarning[],
): void {
  if (reportType === 'equityChangeStatement') return;
  const hasNumericColumn = tables.some((t) => t.columns.some((c) => c.dataType === 'number'));
  if (!hasNumericColumn) return;
  const missingPeriod = tables.some((t) => t.columns.some((c) => c.dataType === 'number' && !c.period));
  if (missingPeriod) addWarning(warnings, 'PERIOD_AMBIGUOUS');
}

/**
 * Đặc tả cách tìm dòng tổng: `keywords` để khớp, `exclude` để loại nhãn gần giống.
 *
 * Vòng #05 mục 35 — `includes` một chiều tạo 2 lỗi thật trên file mẫu:
 *   1. 「純資産合計」 và 「負債純資産合計」 CHỨA chuỗi con 「資産合計」 → dòng vốn chủ sở hữu
 *      (hoặc dòng tổng cuối bảng) bị nhận là "tổng tài sản" → TOTAL_MISMATCH dương tính giả.
 *   2. "Total equity attributable to owners of parent" đứng TRƯỚC "Total equity" trong bảng
 *      IFRS → `rows.find` lấy đúng dòng phần-của-công-ty-mẹ (đã trừ lợi ích cổ đông không
 *      kiểm soát) làm tổng vốn chủ sở hữu → A ≠ L + E.
 *   3. "Total liabilities and equity" chứa "total liabilities" → bị nhận là tổng nợ.
 */
interface TotalRowSpec {
  keywords: string[];
  exclude: string[];
}

const TOTAL_ASSET_SPEC: TotalRowSpec = {
  keywords: ['資産合計', '総資産', 'total assets'],
  exclude: ['負債', '純資産', 'liabilit', 'equity', 'net assets'],
};

const TOTAL_LIABILITY_SPEC: TotalRowSpec = {
  keywords: ['負債合計', 'total liabilities'],
  exclude: ['純資産', '資本', 'and equity', 'and net assets', "and shareholders' equity", 'and total equity'],
};

const TOTAL_EQUITY_SPEC: TotalRowSpec = {
  keywords: ['純資産合計', '資本合計', 'total net assets', 'total equity', "total shareholders' equity"],
  exclude: [
    '負債',
    'attributable', 'owners of parent', 'owners of the parent',
    'non-controlling', 'noncontrolling', 'minority',
    '親会社', '非支配',
  ],
};

/** Tổng tài sản vs Tổng nợ + Vốn chủ sở hữu. Lệch → TOTAL_MISMATCH (không sửa số). */
function validateBalanceSheetTotals(tables: ReportTable[], warnings: ReportWarning[]): void {
  for (const table of tables) {
    const itemCount = table.rows.filter((row) => row.rowType === 'DETAIL').length;
    const tolerance = totalTolerance(itemCount);
    const assets = findRowByKeywords(table, TOTAL_ASSET_SPEC);
    const liabilities = findRowByKeywords(table, TOTAL_LIABILITY_SPEC);
    const equity = findRowByKeywords(table, TOTAL_EQUITY_SPEC);
    if (!assets || !liabilities || !equity) continue;

    for (const column of table.columns) {
      const a = assets.values[column.id]?.normalized;
      const l = liabilities.values[column.id]?.normalized;
      const e = equity.values[column.id]?.normalized;
      if (a == null || l == null || e == null) continue;
      const difference = Math.abs(a - (l + e));
      if (difference > tolerance) {
        addWarning(
          warnings,
          'TOTAL_MISMATCH',
          `Cột "${column.id}": tổng tài sản ${a} ≠ tổng nợ ${l} + vốn chủ sở hữu ${e}; `
            + `lệch ${difference}, ngưỡng cho phép ${tolerance} (${itemCount} khoản mục).`,
        );
        return;
      }
    }
  }
}

/**
 * Nhãn của dòng "tổng biến động trong kỳ" — bản thân nó là TỔNG của các dòng CHANGE khác.
 * Nếu AI gắn rowType = CHANGE cho dòng này (rất dễ, vì nó cũng là biến động) thì phép
 * cộng ở `validateEquityMovement` đếm đôi và luôn ra TOTAL_MISMATCH. Vòng #05 mục 35.
 */
const CHANGE_SUBTOTAL_KEYWORDS = [
  '当期変動額合計', '変動額合計', '当期変動額',
  '当期包括利益', '包括利益',
  'total changes', 'total change', 'net changes', 'net change during',
  'total transactions', 'changes during the',
  'comprehensive income', 'total comprehensive income',
];

/** Số dư đầu kỳ + biến động trong kỳ = số dư cuối kỳ. Lệch → TOTAL_MISMATCH. */
function validateEquityMovement(tables: ReportTable[], warnings: ReportWarning[]): void {
  for (const table of tables) {
    const opening = table.rows.find((r) => r.rowType === 'OPENING_BALANCE');
    const closing = table.rows.find((r) => r.rowType === 'CLOSING_BALANCE');
    const changes = table.rows.filter(
      (r) => r.rowType === 'CHANGE' && !isChangeSubtotalLabel(r.label.source),
    );
    const itemCount = table.rows.filter((row) => row.rowType === 'CHANGE').length;
    const tolerance = totalTolerance(itemCount);
    if (!opening || !closing || changes.length === 0) continue;

    for (const column of table.columns) {
      const start = opening.values[column.id]?.normalized;
      const end = closing.values[column.id]?.normalized;
      if (start == null || end == null) continue;
      const delta = changes.reduce((sum, row) => {
        const v = row.values[column.id]?.normalized;
        return v == null ? sum : sum + v;
      }, 0);
      const difference = Math.abs(start + delta - end);
      if (difference > tolerance) {
        addWarning(
          warnings,
          'TOTAL_MISMATCH',
          `Cột "${column.id}": số dư đầu kỳ ${start} + biến động ${delta} ≠ số dư cuối kỳ ${end}; `
            + `lệch ${difference}, ngưỡng cho phép ${tolerance} (${itemCount} khoản mục).`,
        );
        return;
      }
    }
  }
}

function isChangeSubtotalLabel(label: string | null): boolean {
  const text = (label ?? '').trim().toLowerCase();
  if (!text) return false;
  return CHANGE_SUBTOTAL_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

/**
 * Tìm dòng tổng theo đặc tả: loại nhãn trong `exclude`, rồi ưu tiên KHỚP CHÍNH XÁC,
 * sau đó nhãn NGẮN NHẤT (nhãn dài hơn thường là biến thể có điều kiện phụ).
 */
function findRowByKeywords(table: ReportTable, spec: TotalRowSpec): TableRow | undefined {
  const keywords = spec.keywords.map((k) => k.toLowerCase());
  const excludes = spec.exclude.map((k) => k.toLowerCase());

  const candidates = table.rows
    .map((row) => ({ row, label: (row.label.source ?? '').trim().toLowerCase() }))
    .filter(({ label }) => label !== '')
    .filter(({ label }) => keywords.some((kw) => label.includes(kw)))
    .filter(({ label }) => !excludes.some((ex) => label.includes(ex)));

  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => {
    const exactA = keywords.includes(a.label) ? 0 : 1;
    const exactB = keywords.includes(b.label) ? 0 : 1;
    if (exactA !== exactB) return exactA - exactB;
    return a.label.length - b.label.length;
  });

  return candidates[0].row;
}
