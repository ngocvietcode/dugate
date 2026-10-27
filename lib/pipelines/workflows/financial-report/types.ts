// lib/pipelines/workflows/financial-report/types.ts
// JSON contract cho workflow `financial-report-translation`.
// Nguồn: handover-report/OCRBctcJapan/PLAN/TASK-1-WORKFLOW.md §4, §5, §13, §16, §18
//        handover-report/OCRBctcJapan/BRD/SRS.md mục III.4 (envelope)
//
// GIẢ ĐỊNH TẠM (chưa có trả lời BA — Q1..Q6 trong PLAN/00-OVERVIEW.md §5, §8):
//   A1: hỗ trợ nguồn JA và EN, tự detect `sourceLanguage`.
//   A2: output giữ chữ nguồn + bản dịch theo `targetLang` (tách `source` / `translated`).
//   A3: báo cáo không có trong nguồn → status = NOT_FOUND, tables = [] (KHÔNG bịa số).
//   A4: giữ tất cả kỳ tìm thấy, khai báo trong `columns`.
//   A5: chỉ có số tổng, không có bảng chi tiết → status = PARTIAL + warning DETAIL_NOT_FOUND.
//
// LỆCH SRS ĐÃ GHI CHÚ:
//   - SRS gõ sai errorCode `RANSLATION_FAILED` → dùng `TRANSLATION_FAILED`.
//   - Thân báo cáo của SRS cố định theo từng loại (assets/liabilities/value1/value2...).
//     Ở đây dùng dạng generic `tables[].columns[]` + `tables[].rows[]` để hỗ trợ
//     báo cáo nhiều kỳ so sánh (mẫu Air Water) và equity có cột động. Envelope +
//     6 report key của SRS được giữ nguyên.

// ─── Enum & hằng số ───────────────────────────────────────────────────────────

/**
 * Ngôn ngữ đích. Q1/Q2 — BA chọn phương án (a): giữ `vi | en` như SRS đã công bố,
 * default `vi`. Thêm ngôn ngữ đích mới sau này = thêm giá trị vào union này +
 * 1 entry trong REPORT_TITLE_FALLBACK, không phải sửa logic.
 */
export type TargetLang = 'vi' | 'en';

export const TARGET_LANGS: readonly TargetLang[] = ['vi', 'en'] as const;
export const DEFAULT_TARGET_LANG: TargetLang = 'vi';

/**
 * Ngôn ngữ nguồn — mã ISO 639-1 chữ thường (`ja`, `en`, `ko`, `zh`...) hoặc `unknown`.
 * Q1: cố tình KHÔNG dùng union đóng để hỗ trợ nguồn ngôn ngữ mới mà không phải
 * đổi contract (trước đây là `'ja' | 'en' | 'unknown'`).
 */
export type SourceLanguage = string;

export const UNKNOWN_LANGUAGE = 'unknown';

export type ReportType =
  | 'balanceSheet'
  | 'incomeStatement'
  | 'comprehensiveIncome'
  | 'cashFlowStatement'
  | 'equityChangeStatement'
  | 'sgaBreakdown'
  | 'notesToFinancialStatements';

/** UAT #04 / T5 — phạm vi kỳ của một báo cáo, suy từ TIÊU ĐỀ bằng code. */
export type PeriodScope = 'FULL_YEAR' | 'HALF_YEAR' | 'QUARTER' | 'UNKNOWN';

/** UAT #04 / T5 — loại báo cáo trong họ "kết quả kinh doanh". */
export type StatementKind = 'PROFIT_LOSS' | 'COMPREHENSIVE_INCOME' | 'COMBINED' | 'OTHER';

/** Thứ tự khai báo = thứ tự xuất hiện trong JSON output. */
export const REPORT_TYPES: readonly ReportType[] = [
  'balanceSheet',
  'incomeStatement',
  'comprehensiveIncome',
  'cashFlowStatement',
  'equityChangeStatement',
  'sgaBreakdown',
  'notesToFinancialStatements',
] as const;

/** Report duy nhất trả `sections[]` thay vì `tables[]` (§4). */
export const NOTES_REPORT_TYPE: ReportType = 'notesToFinancialStatements';

/** Prefix dùng khi re-index rowId sau merge (§17). */
export const ROW_ID_PREFIX: Record<ReportType, string> = {
  balanceSheet: 'bs',
  incomeStatement: 'is',
  comprehensiveIncome: 'ci',
  cashFlowStatement: 'cf',
  equityChangeStatement: 'eq',
  sgaBreakdown: 'sga',
  notesToFinancialStatements: 'note',
};

export type ReportStatus = 'FOUND' | 'PARTIAL' | 'NOT_FOUND' | 'UNREADABLE';

/** §16 — enum rowType. */
export type RowType =
  | 'SECTION'
  | 'DETAIL'
  | 'SUBTOTAL'
  | 'TOTAL'
  | 'OPENING_BALANCE'
  | 'CHANGE'
  | 'CLOSING_BALANCE';

export const ROW_TYPES: readonly RowType[] = [
  'SECTION',
  'DETAIL',
  'SUBTOTAL',
  'TOTAL',
  'OPENING_BALANCE',
  'CHANGE',
  'CLOSING_BALANCE',
] as const;

/** §18 — warning codes. */
export type WarningCode =
  | 'DETAIL_NOT_FOUND'
  | 'PERIOD_AMBIGUOUS'
  | 'UNIT_NOT_FOUND'
  | 'TABLE_CONTINUATION_UNCERTAIN'
  | 'TOTAL_MISMATCH'
  | 'LOW_CONFIDENCE_PAGE'
  | 'ORPHAN_PARENT_ROW'
  | 'UNKNOWN_COLUMN_DROPPED'
  | 'TRANSLATION_PARTIAL'
  /** Bước dịch thất bại hoàn toàn; chữ nguồn vẫn được giữ (Q7). */
  | 'TRANSLATION_FAILED'
  /**
   * AI không đọc được đơn vị RIÊNG của báo cáo → đang dùng `generalInformation.unit`.
   * Phân biệt với trường hợp đơn vị riêng thật sự đọc được (B1, vòng #03).
   */
  | 'REPORT_UNIT_ASSUMED_FROM_DOCUMENT'
  /**
   * Hơn 30% dòng không suy được `statementSection` → layout 2 khối của bảng cân đối
   * có thể không đáng tin (B2, vòng #03).
   */
  | 'SECTION_DETECTION_WEAK'
  /**
   * Chunk tiếp nối trả `column.id` khác chunk trước nhưng cùng SỐ LƯỢNG cột → đã map lại
   * theo VỊ TRÍ để nối bảng thay vì tạo bảng rời (B4, vòng #03).
   */
  | 'COLUMN_ID_REMAPPED'
  /** Round 13 / T13.1 — bảng rộng bị cắt dọc; giữ từng phần để không dán giá trị vào sai cột. */
  | 'TABLE_SPLIT_HORIZONTALLY'
  /** Báo cáo bị loại bởi cấu hình `report_types`, không phải NOT_FOUND thật (CODE-REVIEW-01 mục 7). */
  | 'EXCLUDED_BY_CONFIG'
  /**
   * UAT #01 / I2 — tài liệu KHÔNG có bảng chi tiết chi phí bán hàng và quản lý; số tổng được
   * lấy từ dòng SG&A trong Báo cáo kết quả kinh doanh. Đi kèm `DETAIL_NOT_FOUND`.
   */
  | 'SGA_DERIVED_FROM_INCOME_STATEMENT'
  /**
   * UAT #01 / I1 — bảng của báo cáo này chứa dòng mốc khối của BẢNG CÂN ĐỐI
   * (`資産の部` / `負債の部` / `Liabilities and equity`...) nên có thể đã bị gán sai loại báo cáo.
   * Chỉ CẢNH BÁO, code KHÔNG tự đổi `reportType`.
   */
  | 'REPORT_TYPE_SUSPECT'
  /** UAT #04 / T5 — KQKD chứa nhiều biến thể kỳ hoặc loại báo cáo, cần người dùng chọn đúng bảng. */
  | 'MULTIPLE_VARIANTS_MERGED'
  /** UAT #04 / T5 — KQKD có dữ liệu nhưng không tìm thấy biến thể kỳ cả năm. */
  | 'FULL_YEAR_VARIANT_MISSING'
  /** UAT #04 / T9 — báo cáo cốt lõi thiếu trong khi vẫn còn nhiều trang chưa được phân loại. */
  | 'REPORT_MISSING_WITH_UNASSIGNED_PAGES'
  /** UAT #04 / T7 — phản hồi Notes bị lặp/cụt do chạm trần token đầu ra. */
  | 'NOTES_PAGE_AI_OUTPUT_LIMIT'
  /** UAT #04 / T8 — cùng báo cáo có các bảng dùng đơn vị số liệu khác nhau. */
  | 'UNIT_VARIES_WITHIN_REPORT'
  /** R3 — tài liệu có cả bộ hợp nhất và riêng lẻ; đã LOẠI bộ riêng lẻ, chỉ giữ hợp nhất. */
  | 'SEPARATE_SET_EXCLUDED'
  /** R3 (biên) — tài liệu CHỈ có bộ riêng lẻ; số liệu là báo cáo riêng lẻ, KHÔNG phải hợp nhất. */
  | 'SEPARATE_ONLY_KEPT'
  /** Round 11B / T3.4 — bảng từ Notes được dùng khi báo cáo chính chưa có dữ liệu đầy đủ. */
  | 'TABLE_FROM_NOTES_REGION'
  /** Round 11B / T3.4 — bảng từ Notes bị bỏ vì báo cáo chính đã FOUND. */
  | 'TABLE_FROM_NOTES_REGION_IGNORED'
  /** Round 11B / T3.2 — bảng được định tuyến lại theo loại nội dung AI khai báo. */
  | 'TABLE_REASSIGNED_BY_CONTENT'
  /** Round 12 / T12.1 — bảng bị chứa hoàn toàn bởi bảng giàu dữ liệu hơn đã được loại. */
  | 'DUPLICATE_TABLE_DROPPED'
  /** Round 11B / T4.2 — ma trận vốn chủ sở hữu đủ điều kiện đã union thêm cột/dòng. */
  | 'COLUMN_SET_UNIONED'
  /** IFRS chỉ có bảng 包括利益計算書: dùng nguyên bảng làm KQKD khi không có 損益計算書 riêng. */
  | 'INCOME_FROM_COMPREHENSIVE_INCOME'
  /**
   * Instrumentation (UAT Meidensha 2026-08-07) — báo cáo ĐƯỢC ĐỊNH VỊ ở classify nhưng kết thúc
   * NOT_FOUND (không bóc ra dòng nào). Phơi số chunk extract đã tới merge để phân định:
   *   chunk > 0  → extraction chạy nhưng trả rỗng (ví dụ ma trận vốn chủ sở hữu quá rộng);
   *   chunk == 0 → chunk không tới merge (lệch locationIndex / extract không sinh chunk).
   * Chỉ để chẩn đoán, KHÔNG đổi hành vi.
   */
  | 'REPORT_LOCATED_BUT_NO_DATA';

/** §5 — error codes theo SRS (đã sửa lỗi chính tả RANSLATION_FAILED). */
export type FinancialReportErrorCode =
  | 'OCR_LOW_CONFIDENCE'
  | 'CORRUPTED_FILE'
  | 'PASSWORD_PROTECTED_FILE'
  | 'EMPTY_OR_BLANK_PAGES'
  | 'UNSUPPORTED_DOCUMENT'
  | 'UNRECOGNIZED_REPORT_STRUCTURE'
  | 'TRANSLATION_FAILED'
  | 'TRANSLATION_PARTIAL'
  /**
   * VÒNG #05 mục 34 — LỆCH SRS (mã mới, cần BA bổ sung vào tài liệu).
   * PDF có /Encrypt, MỞ ĐƯỢC bằng mật khẩu rỗng (owner-password-only) nhưng hệ thống
   * không dựng được dữ liệu trang để gửi AI (render thất bại).
   * TUYỆT ĐỐI KHÔNG dùng lại PASSWORD_PROTECTED_FILE cho case này — file thực tế
   * mở được bình thường, báo "có mật khẩu" khiến người dùng đi tìm mật khẩu không tồn tại.
   */
  | 'ENCRYPTED_PDF_UNSUPPORTED';

/** errorMessage tiếng Việt hiển thị cho người dùng cuối (SRS mục 6.5). */
export const ERROR_MESSAGES: Record<FinancialReportErrorCode, string> = {
  OCR_LOW_CONFIDENCE: 'Không đọc được rõ nội dung file, ảnh có thể bị mờ, nghiêng hoặc độ phân giải thấp.',
  CORRUPTED_FILE: 'File bị lỗi hoặc không thể mở được.',
  PASSWORD_PROTECTED_FILE: 'File đang được bảo vệ bằng mật khẩu.',
  EMPTY_OR_BLANK_PAGES: 'File không có nội dung để đọc (trang trống hoặc không có dữ liệu).',
  UNSUPPORTED_DOCUMENT: 'File không phải báo cáo tài chính hoặc không thuộc các loại báo cáo được hỗ trợ.',
  UNRECOGNIZED_REPORT_STRUCTURE: 'Không nhận diện được cấu trúc báo cáo tài chính trong file này.',
  TRANSLATION_FAILED: 'Đã đọc được nội dung file nhưng xảy ra lỗi khi dịch sang ngôn ngữ đích.',
  TRANSLATION_PARTIAL: 'Đã dịch phần lớn nội dung nhưng còn một số mục chưa dịch được.',
  ENCRYPTED_PDF_UNSUPPORTED: 'File được mã hoá theo cách hệ thống chưa xử lý được. File vẫn mở bình thường bằng trình đọc PDF, không cần mật khẩu.',
};

// ─── Contract §4 ──────────────────────────────────────────────────────────────

/** Chữ nguồn và bản dịch tách riêng — KHÔNG ghép "JA / VI" vào 1 string. */
export interface BilingualText {
  source: string | null;
  translated: string | null;
}

export interface ReportWarning {
  code: WarningCode;
  message: string;
}

/**
 * `raw` giữ đúng như in trên PDF (kể cả △, ▲, dấu ngoặc, dấu phẩy).
 * `normalized` là số đã parse (số âm là số âm thật), KHÔNG nhân unit multiplier.
 */
export interface CellValue {
  raw: string;
  normalized: number | null;
}

export interface TableColumn {
  id: string;
  label: BilingualText;
  dataType: 'number' | 'text';
  /** Kỳ báo cáo của cột (ISO date hoặc chuỗi kỳ như in trên PDF). null nếu không xác định. */
  period: string | null;
}

/**
 * Q9 — Khối của bảng cân đối kế toán. Template BU xếp Tài sản một bên, Nợ + Vốn chủ
 * sở hữu một bên; contract §4 trả `rows[]` một chiều nên downstream không biết dòng nào
 * thuộc khối nào. Field này do CODE suy ra từ dòng tiêu đề khối (資産の部 / 負債の部 /
 * 純資産の部 / Assets / Liabilities / Equity), KHÔNG nhờ AI.
 * `null` = không suy được, hoặc báo cáo không phải bảng cân đối.
 */
export type StatementSection = 'ASSETS' | 'LIABILITIES' | 'EQUITY';

/**
 * R3 — Bộ báo cáo là HỢP NHẤT (連結 / consolidated) hay RIÊNG LẺ
 * (個別 / 単体 / separate / standalone / non-consolidated). `null` = không suy được từ tiêu đề.
 */
export type Consolidation = 'CONSOLIDATED' | 'SEPARATE';

export interface TableRow {
  rowId: string;
  parentRowId: string | null;
  level: number;
  rowType: RowType;
  /** Chỉ có giá trị với `balanceSheet`; các báo cáo khác luôn null (Q9). */
  statementSection: StatementSection | null;
  label: BilingualText;
  sourcePage: number | null;
  /** Chỉ chứa key tồn tại trong `columns[].id` của cùng table. Không có giá trị → bỏ key. */
  values: Record<string, CellValue>;
}

export interface ReportTable {
  tableId: string;
  columns: TableColumn[];
  rows: TableRow[];
  /** UAT #04 / T5 — tiêu đề của biến thể báo cáo sinh ra bảng này. */
  variantTitle?: BilingualText | null;
  /** UAT #04 / T5 — phạm vi kỳ suy từ tiêu đề biến thể, giúp không nhầm số quý là số năm. */
  periodScope?: PeriodScope;
  /** UAT #04 / T5 — loại KQKD: lãi lỗ, toàn diện hoặc cả hai. */
  statementKind?: StatementKind;
  /** UAT #04 / T8 — đơn vị riêng của bảng, ưu tiên hơn đơn vị cấp báo cáo khi có. */
  unit?: UnitInfo | null;
  /** R3 — bộ báo cáo sinh ra bảng này là hợp nhất hay riêng lẻ; null nếu không suy được. */
  consolidation?: Consolidation | null;
}

export interface PageRange {
  from: number;
  to: number;
}

/**
 * Round 07 — Trace theo tầng cho MỖI báo cáo dạng bảng, để định vị tầng phát sinh lỗi mà không đoán.
 * Thuần chẩn đoán, KHÔNG ảnh hưởng dữ liệu nghiệp vụ.
 */
export interface ReportExtractionTrace {
  reportType: ReportType;
  /** Số location classify tìm được cho loại này (0 = classify không định vị). */
  locatedCount: number;
  /** Dải trang các location (theo classify). */
  locatedPages: PageRange[];
  /** Số chunk extract của loại này (mọi location). */
  chunksTotal: number;
  /** Số chunk có result != null (extract chạy được). */
  chunksWithResult: number;
  /** Số chunk mà AI báo notFound = true. */
  chunksNotFound: number;
  /** Tổng số BẢNG thô AI trả về (trước merge). */
  rawTables: number;
  /** Tổng số DÒNG thô AI trả về (trước khi merge lọc nhãn rỗng / áp R1/R3). */
  rawRows: number;
  /** Số dòng còn lại trong báo cáo cuối (sau merge + R1/R3). */
  keptRows: number;
  /** Status cuối của báo cáo. */
  finalStatus: ReportStatus;
  /** true nếu có warning R1/R3 loại bảng (MULTIPLE_VARIANTS_MERGED / SEPARATE_SET_EXCLUDED). */
  droppedByRule: boolean;
}

/** 5 báo cáo dạng bảng. */
export interface TabularReport {
  status: ReportStatus;
  title: BilingualText | null;
  pageRanges: PageRange[];
  /**
   * Q10 — Đơn vị số liệu RIÊNG của báo cáo này, khi khác đơn vị chung của file.
   * Ví dụ mẫu OG Corp: bảng cân đối in theo 百万円 (triệu yên) còn bảng chi tiết chi phí
   * bán hàng in theo 円 (yên). Nếu chỉ có 1 chỗ khai đơn vị thì sai 1.000.000 lần.
   * `null` = dùng `generalInformation.unit`.
   */
  unit: UnitInfo | null;
  warnings: ReportWarning[];
  tables: ReportTable[];
}

export interface NoteSection {
  sectionId: string;
  sourcePage: number | null;
  title: BilingualText;
  sourceText: string;
  translatedText: string | null;
}

/** notesToFinancialStatements — dùng sections[], không ép thành bảng. */
export interface NotesReport {
  status: ReportStatus;
  title: BilingualText | null;
  pageRanges: PageRange[];
  /** Luôn null — phần thuyết minh là văn bản, không có đơn vị số liệu riêng. Giữ để đồng shape. */
  unit: UnitInfo | null;
  warnings: ReportWarning[];
  sections: NoteSection[];
}

export interface UnitInfo {
  source: string | null;
  translated: string | null;
  multiplier: number | null;
}

export interface GeneralInformation {
  companyName: BilingualText;
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLang;
  fromDate: string | null;
  toDate: string | null;
  currency: string | null;
  unit: UnitInfo;
}

/**
 * Output contract. Comprehensive income stays optional because it is intentionally suppressed
 * at the final response boundary while remaining a required internal routing bucket.
 */
export interface FinancialReportPayload {
  generalInformation: GeneralInformation;
  balanceSheet?: TabularReport;
  incomeStatement?: TabularReport;
  comprehensiveIncome?: TabularReport;
  cashFlowStatement?: TabularReport;
  equityChangeStatement?: TabularReport;
  sgaBreakdown?: TabularReport;
  notesToFinancialStatements?: NotesReport;
}

/** Internal workflow payload: every routing bucket must exist until projection at the response boundary. */
export interface InternalFinancialReportPayload extends Required<FinancialReportPayload> {}

/**
 * Q7 — Trạng thái xử lý của 1 file.
 *   SUCCESS         : đọc trọn vẹn, dịch xong.
 *   PARTIAL_SUCCESS : CÓ dữ liệu trả về nhưng thiếu/không dịch được một phần.
 *                     `report` vẫn có dữ liệu — KHÔNG bỏ công OCR đã làm.
 *   FAILED          : không có gì để trả (corrupt / password / trang trắng / không phải BCTC).
 *
 * LỆCH SRS: SRS mục 6.3 chỉ định nghĩa `SUCCESS | FAILED`, và `FAILED` → `report: null`.
 * Bổ sung `PARTIAL_SUCCESS` theo quyết định của BA (2026-07-29) để không mất toàn bộ
 * kết quả OCR khi chỉ vài trang lỗi hoặc riêng bước dịch chết. Cần BA cập nhật SRS.
 */
export type FileStatus = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';

export type TranslationStatus = 'DONE' | 'SKIPPED' | 'PARTIAL' | 'FAILED';

/**
 * Cách lấy dữ liệu từng trang để gửi cho AI (khai ở types để tránh phụ thuộc vòng
 * types → pdf-utils; `pdf-utils.ts` re-export lại type này).
 *   'pdf'   — tách trang bằng pdf-lib rồi gửi chunk PDF (đường mặc định).
 *   'image' — PDF có /Encrypt: pdf-lib không parse được cấu trúc (kể cả `ignoreEncryption`),
 *             nên render từng trang thành PNG rồi gửi ảnh. Xem mục 34 của CODE-REVIEW-01.
 */
export type PageSourceMode = 'pdf' | 'image';

/** Round 11B / T2.3 — lý do CODE suy ra cho từng trang không thuộc location báo cáo nào. */
export type UnassignedReason =
  | 'BLANK'
  | 'TABLE_UNCLASSIFIED'
  | 'PROSE_ONLY'
  | 'COVER_OR_INDEX'
  | 'OTHER';

export interface UnassignedPageReason {
  page: number;
  reason: UnassignedReason;
}

/** UAT #04 / T1 — một location đã classify, ghi ra ngoài để chẩn đoán. */
export interface ClassifyLocationInfo {
  reportType: ReportType;
  pageFrom: number;
  pageTo: number;
  titleSource: string | null;
  periodScope: PeriodScope;
  statementKind: StatementKind;
  /** R3 — bộ báo cáo là hợp nhất hay riêng lẻ; null nếu không suy được từ tiêu đề. */
  consolidation?: Consolidation | null;
  /** true khi location này do lượt soi lại (T4) tìm ra, không phải lượt classify đầu. */
  fromRecheckPass: boolean;
}

/**
 * Q7 — Thông tin quá trình xử lý, để BU biết THIẾU Ở ĐÂU mà đọc bù bằng mắt.
 * Mô hình theo `pdf_processing_info` của workflow payroll-verify.
 */
export interface FileProcessingInfo {
  totalPages: number;
  /**
   * Vòng #05 mục 34 — cách lấy dữ liệu trang gửi cho AI:
   *   'pdf'   : tách trang bằng pdf-lib (đường mặc định).
   *   'image' : PDF có /Encrypt nên phải render trang thành PNG.
   * Ghi ra ngoài để khi độ chính xác lệch giữa 2 nhóm file thì truy được nguyên nhân.
   */
  pageSourceMode: PageSourceMode;
  /** PDF có dictionary /Encrypt hay không (owner-password-only vẫn xử lý được). */
  encrypted: boolean;
  /** Số loại báo cáo (trong 6 loại) nhận diện được trong file. */
  reportsFound: number;
  classifyWindowsTotal: number;
  classifyWindowsFailed: number;
  extractChunksTotal: number;
  extractChunksFailed: number;
  /** Round 11B / T3.2 — số bảng AI gán OTHER nên bị loại trước merge, không phát sinh warning riêng. */
  tablesDiscardedAsOther: number;
  /** Round 12 / T12.4 — tổng số bảng AI trả về trong mọi chunk Notes. */
  notesTablesFound?: number;
  /** Round 12 / T12.4 — số bảng Notes bị loại riêng vì tiêu đề không khớp mạnh alias đích. */
  notesTablesRejected?: number;
  /** Dải trang không bóc được sau khi hết retry — BU cần đọc tay đúng các trang này. */
  failedPageRanges: PageRange[];
  /** UAT #04 / T1 — kết quả classify; optional để caller contract cũ vẫn hợp lệ. */
  classifyLocations?: ClassifyLocationInfo[];
  /** UAT #04 / T1 — trang chưa thuộc location nào; rỗng nghĩa là đã phủ toàn bộ. */
  unassignedPages?: number[];
  /** Round 11B / T2.3 — lý do xác định theo nhãn của từng trang chưa gán. */
  unassignedPageReasons?: UnassignedPageReason[];
  /** T10 / R5 — số nhãn tiêu đề bị loại vì thực chất là câu văn tham chiếu. */
  titlesRejectedAsProse?: number;
  /** Round 11 / T2.4 — số nhãn classify một-trang được CODE sửa số trang AI trả sai. */
  pageNumberCorrections?: number;
  /** UAT #04 / T1 — mọi số trang payload đếm theo thứ tự trang PDF, không phải số in. */
  pageNumberBasis?: 'PDF_INDEX';
  /** UAT #04 / T7 — tổng số phản hồi Notes chạm trần token đầu ra, kể cả khi lần gọi sau phục hồi. */
  aiOutputLimitHits?: number;
  /** Round 12B / T12.8' — số table chunk cuối cùng thất bại với raw output nghi bị cắt. */
  tableOutputLimitSuspected?: number;
  /** Round 12B / T12.8' — số lô dịch có raw output nghi bị cắt do trần token. */
  translateOutputLimitSuspected?: number;
  /** UAT #04 / T7 — số chunk Notes thất bại xác định do phản hồi lặp/cụt, không retry ở lượt 2 chung. */
  deterministicChunkFailures?: number;
  translationStatus: TranslationStatus;
  /** Số nhãn/đoạn không dịch được (0 khi translationStatus = DONE hoặc SKIPPED). */
  untranslatedItems: number;
  /**
   * LÝ DO cụ thể của từng cửa sổ/chunk thất bại, ví dụ
   * `extract balanceSheet trang 21-22: sub-step timeout sau 120000ms`.
   *
   * Vì sao cần: `errorCode` cấp file chỉ nói "có gì đó không đọc được", còn nguyên nhân thật
   * (timeout / 429 / JSON không hợp lệ / lỗi storage) trước đây CHỈ có trong log container.
   * Không đọc được log thì không phân biệt được "AI quá tải" với "PDF thực sự mờ" — hai việc
   * cần cách xử lý hoàn toàn khác nhau. Ghi ra đây để đọc được ngay từ response.
   *
   * Chỉ chứa thông điệp lỗi kỹ thuật đã cắt ngắn; KHÔNG chứa nội dung tài liệu.
   */
  failureReasons: string[];
  /** Round 07 — trace theo tầng cho từng báo cáo dạng bảng; optional để contract cũ vẫn hợp lệ. */
  reportTrace?: ReportExtractionTrace[];
}

export interface FileResult {
  fileId: string;
  fileName: string;
  status: FileStatus;
  /**
   * Khi `FAILED`: mã lỗi theo SRS.
   * Khi `PARTIAL_SUCCESS`: mã lỗi ĐẠI DIỆN cho phần bị thiếu (ví dụ `TRANSLATION_FAILED`,
   * `OCR_LOW_CONFIDENCE`) để BLOS log/alert; chi tiết nằm trong `report.*.warnings`.
   * Khi `SUCCESS`: null.
   */
  errorCode: FinancialReportErrorCode | null;
  /**
   * Câu tiếng Việt HIỂN THỊ CHO NGƯỜI DÙNG CUỐI, đúng bảng SRS 6.5 — KHÔNG thêm bớt gì.
   *
   * Tuyệt đối không nối thông tin kỹ thuật vào đây: SRS 6.5 ghi rõ trường này để hiển thị cho
   * người dùng cuối, nên nhét `Cannot find package 'pdfjs-dist' imported from /app/node_modules/…`
   * vào vừa là rác với người đọc, vừa là lộ đường dẫn nội bộ ra ngoài. Chi tiết kỹ thuật đi
   * bằng `diagnostic`.
   */
  errorMessage: string | null;
  /**
   * Chi tiết kỹ thuật cho DEV/DevOps, KHÔNG hiển thị cho người dùng cuối. null khi SUCCESS.
   *
   * Vì sao cần một trường riêng: `errorCode` chỉ nói "có gì đó không đọc được", còn nguyên nhân
   * thật (timeout / 429 / JSON không hợp lệ / thiếu package trong image) trước đây CHỈ có trong
   * log container. Không đọc được log thì không phân biệt được "AI quá tải" với "PDF thực sự mờ"
   * — hai việc cần cách xử lý hoàn toàn khác nhau.
   *
   * Trường THÊM MỚI, nullable ⇒ caller cũ bỏ qua được, không phá tích hợp đang chạy.
   */
  diagnostic: string | null;
  /** null CHỈ khi status = FAILED. PARTIAL_SUCCESS luôn có dữ liệu. */
  report: FinancialReportPayload | null;
  processingInfo: FileProcessingInfo | null;
}

/** Envelope của SRS mục III.4 — payload này nằm trong `extracted_data` của operation. */
export interface FinancialReportEnvelope {
  requestId: string;
  code: number;
  message: string;
  timestamp: string;
  targetLang: TargetLang;
  data: FileResult[] | null;
}

// ─── Internal: schema các prompt AI (§13) — KHÔNG phải response API ───────────

export interface ClassifyReportEntry {
  reportType: ReportType;
  pageFrom: number | null;
  pageTo: number | null;
  confidence?: 'high' | 'medium' | 'low';
  titleFound?: string | null;
}

/** UAT #04 / T3 — căn cứ nhận diện của một trang. */
export type PageLabelBasis = 'TITLE' | 'CONTINUATION' | 'CONTINUATION_UNKNOWN' | 'NONE';

/** UAT #04 / T3 — nhãn classify theo từng trang để không mất trang tiếp nối không in tiêu đề. */
export interface ClassifyPageLabel {
  page: number;
  /** null = trang không thuộc 6 loại báo cáo (bìa, mục lục, tóm lược hoặc phân tích). */
  reportType: ReportType | null;
  basis: PageLabelBasis;
  titleFound: string | null;
  /** Round 11B / T2.2 — AI xác nhận trang có bảng số liệu (nhãn khoản mục + cột số) hay không. Vắng mặt từ Profile/model cũ được coi là false. */
  hasTable?: boolean;
  /** Round 11B / T2.3 — AI xác nhận chính trang này trống hoàn toàn; vắng mặt tương thích model cũ. */
  blank?: boolean;
}

export interface ClassifyResult {
  sourceLanguage: SourceLanguage;
  documentType?: string;
  /** true khi toàn bộ trang được soi đều trống. */
  blank?: boolean;
  /** false khi nội dung không phải BCTC. */
  isFinancialReport?: boolean;
  companyName?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  currency?: string | null;
  unit?: string | null;
  /** T3: có thì là nguồn dữ liệu ưu tiên; reports giữ để tương thích Profile override cũ. */
  pages?: ClassifyPageLabel[];
  reports: ClassifyReportEntry[];
}

/** Row do AI trả về ở bước extract: chỉ `labelSource` + giá trị dạng string. */
export interface ExtractedRow {
  rowId?: string;
  parentRowId?: string | null;
  level?: number;
  rowType?: string;
  labelSource?: string;
  sourcePage?: number | null;
  values?: Record<string, string | number | null>;
}

export interface ExtractedColumn {
  id: string;
  labelSource?: string;
  dataType?: string;
  period?: string | null;
}

export type ExtractedTableReportType = ReportType | 'OTHER';

export interface ExtractedTable {
  tableId?: string;
  /** Round 11 / T3.1 — loại nội dung của bảng; `OTHER` không phải output report key. */
  reportType?: ExtractedTableReportType;
  /** Round 11 / T3.1 — tiêu đề bảng nguyên văn, null khi tài liệu không in tiêu đề. */
  tableTitle?: string | null;
  columns?: ExtractedColumn[];
  rows?: ExtractedRow[];
  /** AI đánh dấu bảng này là phần tiếp nối của bảng ở chunk trước (§17). */
  isContinuation?: boolean;
}

export interface ExtractChunkResult {
  reportType?: string;
  tables?: ExtractedTable[];
  notFound?: boolean;
  warnings?: string[];
  titleSource?: string | null;
  /** Q10 — đơn vị số liệu in trên chính báo cáo này (千円 / 百万円 / Yen...). */
  unitSource?: string | null;
}

export interface ExtractedNoteSection {
  sectionId?: string;
  sourcePage?: number | null;
  titleSource?: string | null;
  sourceText?: string;
}

export interface ExtractNotesChunkResult {
  sections?: ExtractedNoteSection[];
  /** Round 11B / T3.3 — bảng số liệu xuất hiện trong Notes, dùng cùng schema ExtractedTable. */
  tables?: ExtractedTable[];
  notFound?: boolean;
  warnings?: string[];
  titleSource?: string | null;
}

export interface TranslateItem {
  id: string;
  text: string;
}

export interface TranslateResultEntry {
  id?: string;
  rowId?: string;
  columnId?: string;
  translated?: string;
}

export interface TranslateResult {
  translations?: TranslateResultEntry[];
}

// ─── Cấu hình workflow (đăng ký trên registry, override qua Profile §7) ───────

export interface FinancialReportConfig {
  targetLang: TargetLang;
  requestId: string;
  /** Số trang/lần gọi AI ở bước extract. */
  pagesPerChunk: number;
  /** Số trang/lần gọi AI ở bước classify. */
  classifyPagesPerCall: number;
  /** UAT #04 / T4 — soi lại các dải trang chưa được classify khi lượt đầu bỏ sót. */
  classifyRecheckUnassigned: boolean;
  /** UAT #04 / T4 — số dải chưa gán tối đa được soi lại, ưu tiên dải dài hơn. */
  classifyRecheckMaxWindows: number;
  /**
   * UAT JFE — số trang đệm MỖI PHÍA khi gửi trang cho extract, bù sai số ±1 trang của classify.
   * Không áp cho thuyết minh. 0 = tắt biên (hành vi cũ). Optional để config cũ vẫn hợp lệ;
   * thiếu → dùng DEFAULT_EXTRACT_PAGE_MARGIN trong extract.ts.
   */
  extractPageMargin?: number;
  /** Retry khi AI trả JSON không hợp lệ. */
  maxRetries: number;
  /**
   * Số lần gọi AI đồng thời tối đa (semaphore) — CODE-REVIEW-01 mục 6.
   * Thay cho cơ chế delay tuyến tính cũ để không dồn timeout ở file dài.
   */
  maxConcurrency: number;
  /**
   * T2.5 — giới hạn song song dành riêng cho classify. Thiếu ở config tay/legacy thì
   * classify dùng `maxConcurrency` chung để tương thích ngược.
   */
  classifyMaxConcurrency?: number;
  /** T2.5 — giãn lệnh dành riêng cho classify; thiếu thì dùng `staggerDelayMs` chung. */
  classifyStaggerDelayMs?: number;
  /** Khoảng nghỉ tối thiểu giữa 2 lần khởi chạy gọi AI (tiền lệ payroll-verify: 5000ms). */
  staggerDelayMs: number;
  /** Wait between sequential chunks in one report location; retries retain staggerDelayMs. */
  extractInterChunkDelayMs?: number;
  /** Round 11B / T4.1 — số chuỗi nguồn duy nhất tối đa trong một lời gọi dịch (default 40). */
  translateBatchItems?: number;
  /** Round 11B / T4.1 — tổng ký tự source tối đa trong một lời gọi dịch (default 20.000). */
  translateBatchChars?: number;

  /**
   * UAT #01 / I3 — Số trang mỗi lần gọi AI cho riêng phần THUYẾT MINH (default 1).
   * Nhỏ hơn `pagesPerChunk` vì notes trả toàn văn nên phản hồi dễ vượt giới hạn token đầu ra,
   * làm JSON bị cắt và không parse được.
   */
  notesPagesPerChunk: number;
  enableTranslation: boolean;
  /**
   * Hệ số render trang khi PDF có /Encrypt (buộc gửi ảnh). DPI = 72 × scale.
   * Xem `DEFAULT_RENDER_SCALE` trong pdf-utils để biết số đo dung lượng/DPI.
   */
  renderScale: number;
  /** Seconds per PDF page used for the initial client ETA. Profile may override; default is 13. */
  etaSecondsPerPage?: number;
  /** Hard cap for one parent workflow execution; exceedance fails the parent operation. */
  workflowDeadlineMs?: number;
  /** Report types omitted only from the projected public response. */
  outputSuppressedReportTypes?: ReadonlySet<ReportType>;
  /** Additive Profile aliases consumed only by classifier title prompts. */
  supplementalReportTitleAliases?: SupplementalReportTitleAliases;
  /** Giới hạn loại báo cáo cần bóc (debug). Rỗng = cả 6 loại. */
  reportTypes: ReportType[];
}

export type SupplementalReportTitleAliases = Partial<Record<ReportType, string[]>>;

const MAX_SUPPLEMENTAL_ALIASES_PER_REPORT = 20;
const MAX_SUPPLEMENTAL_ALIASES_TOTAL = 80;
const MAX_SUPPLEMENTAL_ALIAS_LENGTH = 160;

export type SupplementalReportTitleAliasesValidation =
  | { ok: true; value: SupplementalReportTitleAliases }
  | { ok: false; error: string };

/** Validates Profile-only classifier title aliases before they can enter an AI prompt. */
export function validateSupplementalReportTitleAliases(value: unknown): SupplementalReportTitleAliasesValidation {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { ok: false, error: 'supplemental_report_title_aliases must be a JSON object' };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'supplemental_report_title_aliases must be a JSON object' };
  }

  const aliases: SupplementalReportTitleAliases = {};
  const seen = new Set<string>();
  let total = 0;
  for (const [rawReportType, rawAliases] of Object.entries(parsed as Record<string, unknown>)) {
    if (!REPORT_TYPES.includes(rawReportType as ReportType)) {
      return { ok: false, error: `supplemental_report_title_aliases has an unknown report type: ${rawReportType}` };
    }
    if (!Array.isArray(rawAliases) || rawAliases.length === 0 || rawAliases.length > MAX_SUPPLEMENTAL_ALIASES_PER_REPORT) {
      return { ok: false, error: `supplemental_report_title_aliases.${rawReportType} must be a non-empty array with at most ${MAX_SUPPLEMENTAL_ALIASES_PER_REPORT} aliases` };
    }

    const cleaned: string[] = [];
    for (const rawAlias of rawAliases) {
      if (typeof rawAlias !== 'string') {
        return { ok: false, error: `supplemental_report_title_aliases.${rawReportType} contains a non-string alias` };
      }
      const alias = rawAlias.trim();
      if (!alias || alias.length > MAX_SUPPLEMENTAL_ALIAS_LENGTH || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(rawAlias)) {
        return { ok: false, error: `supplemental_report_title_aliases.${rawReportType} contains an empty, overlong, or control-character alias` };
      }
      const identity = alias.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000\p{P}\p{S}]+/gu, '');
      const meaningful = identity.replace(/[\p{N}]/gu, '');
      if (meaningful.length < 4) {
        return { ok: false, error: `supplemental_report_title_aliases.${rawReportType} contains an alias with fewer than four meaningful characters` };
      }
      if (seen.has(identity)) {
        return { ok: false, error: 'supplemental_report_title_aliases contains a duplicate normalized alias' };
      }
      seen.add(identity);
      cleaned.push(alias);
      if (++total > MAX_SUPPLEMENTAL_ALIASES_TOTAL) {
        return { ok: false, error: `supplemental_report_title_aliases has more than ${MAX_SUPPLEMENTAL_ALIASES_TOTAL} aliases` };
      }
    }
    aliases[rawReportType as ReportType] = cleaned;
  }
  return { ok: true, value: aliases };
}

/** Fails closed for malformed legacy/runtime Profile data. */
export function parseSupplementalReportTitleAliases(value: unknown): SupplementalReportTitleAliases {
  const result = validateSupplementalReportTitleAliases(value);
  return result.ok ? result.value : {};
}

/** Additive in-flight progress returned by the existing operation polling response. */
export interface FinancialReportProgressDetails {
  total_pages: number;
  current_file: number;
  file_count: number;
  seconds_per_page: number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createEmptyBilingual(source: string | null = null): BilingualText {
  return { source, translated: null };
}

/** Báo cáo dạng bảng chưa tìm thấy — A3: KHÔNG bịa số liệu. */
export function createNotFoundTabularReport(): TabularReport {
  return { status: 'NOT_FOUND', title: null, pageRanges: [], unit: null, warnings: [], tables: [] };
}

export function createNotFoundNotesReport(): NotesReport {
  return { status: 'NOT_FOUND', title: null, pageRanges: [], unit: null, warnings: [], sections: [] };
}

export function createEmptyPayload(
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLang,
): InternalFinancialReportPayload {
  return {
    generalInformation: {
      companyName: createEmptyBilingual(),
      sourceLanguage,
      targetLanguage,
      fromDate: null,
      toDate: null,
      currency: null,
      unit: { source: null, translated: null, multiplier: null },
    },
    balanceSheet: createNotFoundTabularReport(),
    incomeStatement: createNotFoundTabularReport(),
    comprehensiveIncome: createNotFoundTabularReport(),
    cashFlowStatement: createNotFoundTabularReport(),
    equityChangeStatement: createNotFoundTabularReport(),
    sgaBreakdown: createNotFoundTabularReport(),
    notesToFinancialStatements: createNotFoundNotesReport(),
  };
}

/** Lỗi có errorCode SRS — throw từ preflight/extract để orchestrator map ra `data[].errorCode`. */
export class FinancialReportError extends Error {
  readonly errorCode: FinancialReportErrorCode;

  constructor(errorCode: FinancialReportErrorCode, detail?: string) {
    super(detail ? `${errorCode}: ${detail}` : errorCode);
    this.name = 'FinancialReportError';
    this.errorCode = errorCode;
  }
}

/** Map một lỗi bất kỳ về errorCode SRS. Mặc định coi là cấu trúc không nhận diện được. */
export function resolveErrorCode(error: unknown): FinancialReportErrorCode {
  if (error instanceof FinancialReportError) return error.errorCode;
  const msg = error instanceof Error ? error.message : String(error);
  const upper = msg.toUpperCase();
  if (upper.includes('ENCRYPT') || upper.includes('PASSWORD')) return 'PASSWORD_PROTECTED_FILE';
  if (upper.includes('CORRUPT') || upper.includes('PDF_SPLIT_FAILED')) return 'CORRUPTED_FILE';
  if (upper.includes('TRANSLAT')) return 'TRANSLATION_FAILED';
  return 'UNRECOGNIZED_REPORT_STRUCTURE';
}
