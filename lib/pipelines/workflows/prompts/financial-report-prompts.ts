// lib/pipelines/workflows/prompts/financial-report-prompts.ts
// Prompt cho workflow `financial-report-translation`.
// Tách file riêng theo tiền lệ payroll-verify-prompts.ts.
// Nguồn: PLAN/TASK-1-WORKFLOW.md §13 (output schema từng prompt) + §2 (alias JA/EN).
//
// Model dùng là dòng Gemini Flash → prompt phải chặt, yêu cầu JSON hợp lệ,
// cấm suy diễn, cấm làm toán. Orchestrator validate + retry khi JSON sai.

import {
  REPORT_TYPES,
  ROW_TYPES,
  type ReportType,
  type SupplementalReportTitleAliases,
  type TargetLang,
  type TranslateItem,
} from '../financial-report/types';

// ─── Alias nhận diện 6 loại báo cáo (JA + EN) ────────────────────────────────
// BẮT BUỘC có cả EN: mẫu Air Water trong AI-Processed là tiếng Anh.
// Tiền tố Condensed / Quarterly / Consolidated / Interim / Non-consolidated
// phải được BỎ QUA khi so khớp tiêu đề.

export const REPORT_ALIASES: Record<ReportType, { ja: string[]; en: string[] }> = {
  balanceSheet: {
    // IFRS chuẩn (Marubeni/Sony) gọi bảng cân đối là 財政状態計算書; phải giữ các alias này
    // dù J-GAAP thường gọi 貸借対照表, để tránh gán sai Statement of Financial Position.
    ja: [
      '貸借対照表', '連結貸借対照表', '要約貸借対照表',
      '財政状態計算書', '連結財政状態計算書', '要約四半期連結財政状態計算書',
    ],
    en: ['Balance Sheet', 'Statement of Financial Position', 'Balance Sheets'],
  },
  incomeStatement: {
    ja: [
      '損益計算書', '連結損益計算書', '要約四半期連結損益計算書', '要約損益計算書',
    ],
    en: [
      'Income Statement',
      'Statement of Profit or Loss',
      'Statement of Income',
      'Statement of Operations',
      'Profit and Loss Statement',
    ],
  },
  comprehensiveIncome: {
    ja: [
      '包括利益計算書', '連結包括利益計算書', '純損益及びその他の包括利益計算書',
    ],
    en: [
      'Statement of Comprehensive Income',
      'Statements of Comprehensive Income',
    ],
  },
  cashFlowStatement: {
    ja: ['キャッシュ・フロー計算書', 'キャッシュフロー計算書', '連結キャッシュ・フロー計算書'],
    en: ['Statement of Cash Flows', 'Cash Flow Statement', 'Statements of Cash Flows'],
  },
  equityChangeStatement: {
    ja: [
      '株主資本等変動計算書', '純資産変動計算書', '連結株主資本等変動計算書',
      '連結持分変動計算書', '持分変動計算書',
    ],
    en: ['Statement of Changes in Equity', 'Statement of Shareholders\' Equity', 'Statement of Changes in Net Assets'],
  },
  // CHÚ Ý (UAT #01 / I2): chỉ để alias của BẢNG CHI TIẾT ĐỘC LẬP ở đây.
  // TUYỆT ĐỐI KHÔNG thêm `販売費及び一般管理費` (một DÒNG khoản mục trong Báo cáo KQKD):
  // classify sẽ đánh dấu cả trang KQKD là location của sgaBreakdown → extract bóc lẫn các dòng
  // khác của KQKD thành chi phí bán hàng/quản lý (sai số liệu) và tốn thêm lời gọi AI mỗi file.
  // Trường hợp chỉ có số tổng trong KQKD được xử lý bằng CODE ở `sga-fallback.ts`.
  sgaBreakdown: {
    ja: [
      '販売費・一般管理費内訳書', '販売費及び一般管理費明細書', '販売費及び一般管理費内訳',
      '販売費及び一般管理費の内訳', '販売費及び一般管理費の費目別内訳',
    ],
    en: [
      'Selling, General and Administrative Expenses',
      'SG&A Breakdown',
      'Schedule of Selling, General and Administrative Expenses',
      'Breakdown of Selling, General and Administrative Expenses',
    ],
  },
  notesToFinancialStatements: {
    ja: ['個別注記表', '注記事項', '財務諸表に対する注記', '連結財務諸表に関する注記事項'],
    en: ['Notes to Financial Statements', 'Notes to the Financial Statements', 'Notes'],
  },
};

// UAT #01 / I1: bổ sung tiền tố tiếng Nhật. Trước đây chỉ có tiền tố tiếng Anh nên tiêu đề
// dạng 要約四半期連結財政状態計算書 khó khớp với alias gốc.
export const TITLE_PREFIXES_TO_IGNORE = [
  'Condensed', 'Quarterly', 'Consolidated', 'Non-consolidated', 'Interim', 'Summarized',
  '要約', '四半期', '中間', '連結', '個別',
];

/**
 * Nhãn mặc định cho tiêu đề báo cáo (fallback khi AI không dịch được).
 * Q1/Q2 — generic theo mã ngôn ngữ đích: thêm ngôn ngữ mới = thêm key vào từng entry,
 * không phải sửa logic. Thiếu key → dùng `en` làm dự phòng cuối.
 */
export const REPORT_TITLE_FALLBACK: Record<ReportType, Record<string, string>> = {
  balanceSheet: { vi: 'Bảng cân đối kế toán', en: 'Balance Sheet' },
  incomeStatement: { vi: 'Báo cáo kết quả hoạt động kinh doanh', en: 'Income Statement' },
  comprehensiveIncome: { vi: 'Báo cáo thu nhập toàn diện', en: 'Statement of Comprehensive Income' },
  cashFlowStatement: { vi: 'Báo cáo lưu chuyển tiền tệ', en: 'Statement of Cash Flows' },
  equityChangeStatement: { vi: 'Báo cáo biến động vốn chủ sở hữu', en: 'Statement of Changes in Equity' },
  sgaBreakdown: { vi: 'Bảng chi tiết chi phí bán hàng và quản lý doanh nghiệp', en: 'SG&A Expenses Breakdown' },
  notesToFinancialStatements: { vi: 'Bảng thuyết minh báo cáo tài chính', en: 'Notes to Financial Statements' },
};

/** Lấy nhãn tiêu đề mặc định theo ngôn ngữ đích; không có thì lùi về `en`. */
export function resolveReportTitleFallback(reportType: ReportType, lang: string): string {
  const entry = REPORT_TITLE_FALLBACK[reportType];
  return entry[lang] ?? entry.en;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Thay {{var}} trong prompt override bằng giá trị tương ứng. */
function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? '');
}

/**
 * Mô tả ĐÚNG đính kèm cho từng chế độ nguồn trang.
 *
 * Vì sao cần: PDF mã hoá (JFE / Sony / Marubeni) đi đường `pageSourceMode='image'` — mỗi trang là
 * MỘT file PNG riêng, tên `..._p<số trang tuyệt đối>.png` (xem `prepareChunkAssets`). Trước đây mọi
 * prompt vẫn ghi "File PDF gửi kèm là các trang X–Y", nên model phải TỰ ĐOÁN ảnh nào là trang nào và
 * gán sai số trang. Hệ quả đo được trên JFE: classify trả dải trang lệch một trang (SGA gán p60 trong
 * khi nội dung ở p61 → extract trả 0 dòng; bảng cân đối gán p2-3 trong khi Tài sản ở p3 và Nợ/Vốn ở
 * p4 → mất nửa bảng). Vì vậy prompt PHẢI nói rõ số trang nằm trong TÊN FILE.
 */
function buildAttachmentBlock(pageFrom: number, pageTo: number, sourceMode?: string): string {
  if (sourceMode === 'image') {
    const pages: number[] = [];
    for (let page = pageFrom; page <= pageTo; page++) pages.push(page);
    return `Đính kèm là ${pages.length} ẢNH PNG, MỖI ẢNH LÀ MỘT TRANG của tài liệu gốc (không phải file PDF).
Tên mỗi file có dạng \`..._p<số trang>.png\`, trong đó <số trang> là SỐ TRANG TUYỆT ĐỐI của tài liệu gốc.
Các trang gửi kèm: ${pages.join(', ')}.
BẮT BUỘC:
- Đọc HẾT tất cả ${pages.length} ảnh, không chỉ ảnh đầu tiên.
- Khi trả số trang, DÙNG ĐÚNG số trang trong TÊN FILE của ảnh chứa nội dung đó.
  TUYỆT ĐỐI KHÔNG suy số trang theo thứ tự ảnh, không tự cộng/trừ, không đoán.`;
  }
  return `File PDF gửi kèm là các trang ${pageFrom}–${pageTo} của tài liệu gốc.
QUAN TRỌNG: trang thứ nhất của file gửi kèm tương ứng với trang ${pageFrom} của tài liệu gốc.
Mọi số trang bạn trả về PHẢI theo số trang của tài liệu GỐC. Đọc HẾT các trang trong file.`;
}

function aliasIdentity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000\p{P}\p{S}]+/gu, '');
}

/** Classifier-only table: Profile aliases append to the immutable core aliases. */
function buildAliasTable(supplementalAliases: SupplementalReportTitleAliases = {}): string {
  return REPORT_TYPES.map((type) => {
    const alias = REPORT_ALIASES[type];
    const coreAliases = [...alias.ja, ...alias.en];
    const seen = new Set(coreAliases.map(aliasIdentity));
    const supplemental = (supplementalAliases[type] ?? []).filter((value) => {
      const identity = aliasIdentity(value);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    const suffix = supplemental.length > 0
      ? ` | Supplemental = ${supplemental.map((value) => `「${value}」`).join(', ')}`
      : '';
    return `- "${type}": JA = ${alias.ja.map((a) => `「${a}」`).join(', ')} | EN = ${alias.en.map((a) => `"${a}"`).join(', ')}${suffix}`;
  }).join('\n');
}

const NO_HALLUCINATION_RULES = `### QUY TẮC TUYỆT ĐỐI
- CHỈ đọc những gì THỰC SỰ IN TRÊN TRANG. KHÔNG suy diễn, KHÔNG tự tính, KHÔNG bịa số liệu.
- KHÔNG được tự cộng/trừ/kiểm tra số học. Bạn chỉ ĐỌC và COPY nguyên văn.
- Số phải copy y hệt như in, GIỮ NGUYÊN ký hiệu △, ▲, dấu ngoặc ( ), dấu phẩy phân cách nghìn.
- KHÔNG đổi △ thành dấu trừ. KHÔNG bỏ dấu phẩy. KHÔNG làm tròn.
- Ô trống thì BỎ QUA (không ghi key đó), TUYỆT ĐỐI KHÔNG điền 0.
- CHỈ trả JSON hợp lệ, không kèm giải thích, không kèm markdown fence.`;

// ─── Step 1: Classify (§13.1) ────────────────────────────────────────────────

/**
 * Prompt phân loại: xác định mỗi loại báo cáo nằm ở trang nào.
 * Gọi theo cửa sổ trang (không gọi 1 lần cho cả file 100 trang).
 *
 * @param pageFrom số trang đầu của cửa sổ (1-based, theo file GỐC)
 * @param pageTo   số trang cuối của cửa sổ (1-based, theo file GỐC)
 */
export function buildClassifyPrompt(
  pageFrom: number,
  pageTo: number,
  totalPages: number,
  promptOverride?: string,
  sourceMode?: string,
  supplementalAliases: SupplementalReportTitleAliases = {},
): Record<string, unknown> {
  const aliasTable = buildAliasTable(supplementalAliases);
  const vars = {
    page_from: String(pageFrom),
    page_to: String(pageTo),
    total_pages: String(totalPages),
    alias_table: aliasTable,
    report_types: REPORT_TYPES.join(', '),
  };

  if (promptOverride) {
    return { _prompt: interpolatePrompt(promptOverride, vars) };
  }

  return {
    _prompt: `Bạn là chuyên gia phân loại báo cáo tài chính (chuẩn kế toán Nhật Bản). Đây là nghiệp vụ thẩm định tín dụng hợp pháp của ngân hàng.

Đây là một phần của bộ báo cáo tài chính dài ${totalPages} trang.
${buildAttachmentBlock(pageFrom, pageTo, sourceMode)}

### NHIỆM VỤ
Xác định trong khoảng trang này có xuất hiện những loại báo cáo nào, và mỗi loại nằm ở trang nào.

### BẢNG NHẬN DIỆN TIÊU ĐỀ (nguồn có thể là tiếng Nhật HOẶC tiếng Anh)
${aliasTable}

Bỏ qua các tiền tố khi so khớp: ${TITLE_PREFIXES_TO_IGNORE.join(', ')}.
Nếu tiêu đề chỉ khác biệt về tiền tố/số nhiều/dấu câu thì vẫn coi là khớp.

${NO_HALLUCINATION_RULES}

### GÁN NHÃN THEO TỪNG TRANG — BẮT BUỘC
- Trả một entry trong "pages" cho MỖI trang từ ${pageFrom} đến ${pageTo}, không được bỏ trang nào.
- MỖI entry phải có field "hasTable" dạng boolean thật: true chỉ khi trang có bảng số liệu gồm nhãn khoản mục + cột số; false với trang không có bảng số liệu.
- MỖI entry phải có field "blank" dạng boolean thật: true chỉ khi chính trang đó hoàn toàn trống, false nếu có bất kỳ nội dung nào.
- Trang có tiêu đề báo cáo khớp bảng alias: basis = "TITLE", reportType đúng loại, titleFound = tiêu đề nguyên văn.
- Trang không có tiêu đề nhưng tiếp nối báo cáo ở trang trước trong CÙNG khoảng (ví dụ chỉ in 「（負債の部）」,
  「（資本の部）」, 「負債の部」, 「純資産の部」 hoặc tiếp tục đúng bộ cột kỳ): basis = "CONTINUATION",
  reportType = báo cáo đó, titleFound = null.
- Nếu trang có vẻ tiếp nối nhưng tiêu đề nằm trước khoảng đang soi: basis = "CONTINUATION_UNKNOWN",
  reportType = null, titleFound = null. KHÔNG đoán loại báo cáo.
- Bìa, mục lục và trang tóm lược chỉ số: reportType = null, basis = "NONE". Dấu hiệu tóm lược:
  có cột 「％」 hoặc 「円 銭」, có 「連結経営成績」/「連結財政状態」/「業績予想」, số nằm ngang thay vì bảng khoản mục dọc.
- Trang thuyết minh có tiêu đề dạng 「…に関する注記」 (ví dụ 「貸借対照表に関する注記」,
  「損益計算書に関する注記」) là notesToFinancialStatements, KHÔNG gán Bảng cân đối hoặc KQKD.
- T10 / R5: Tên báo cáo CHỈ là TIÊU ĐỀ khi đứng RIÊNG như một dòng đầu đề trên trang. Nếu tên
  báo cáo nằm TRONG một câu văn thì đó là câu tham chiếu, KHÔNG phải tiêu đề: reportType = null,
  basis = "NONE". Dấu hiệu câu văn: có dấu 「。」 hoặc 「、」, có 「参照」/「ください」/「ページ」/
  「については」, tên báo cáo không ở đầu dòng, hoặc dòng dài hơn khoảng 60 ký tự.
- T10 / R5: Trang có nội dung chính là đoạn văn xuôi, KHÔNG có bảng số liệu gồm nhãn khoản mục và
  cột số tiền, thì KHÔNG BAO GIỜ là một trong sáu báo cáo.
- T10 / R4: Nếu một trang có cả tiêu đề bao nhiều báo cáo (có 「及び」 hoặc "and" nối hai tên báo
  cáo) VÀ một tiêu đề con trong ngoặc chỉ một báo cáo, trả TIÊU ĐỀ CON làm titleFound.
- Chỉ dùng 「資産の部」/「負債の部」/「純資産の部」/「資本の部」 làm mốc Bảng cân đối.
  TUYỆT ĐỐI KHÔNG dùng riêng 「資産合計」 hay 「負債合計」 vì trang tóm lược cũng có các dòng này.
- "reports" là trường tương thích cũ: vẫn trả đủ 6 reportType, nhưng hệ thống sẽ ưu tiên suy location từ "pages".
- BẮT BUỘC trả field "isFinancialReport" dạng boolean thật (true hoặc false), KHÔNG được bỏ trống,
  KHÔNG được để null. true = các trang này thuộc một bộ báo cáo tài chính; false = không phải
  (ví dụ hợp đồng, hoá đơn, thư từ, bảng lương, tài liệu marketing...).
- BẮT BUỘC trả field "blank" dạng boolean thật.

### OUTPUT JSON (đúng cấu trúc này)
{
  "sourceLanguage": "mã ISO 639-1 gồm 2 chữ cái thường của ngôn ngữ chính (ja, en, ko, zh, th...), hoặc \\"unknown\\"",
  "documentType": "STANDALONE" | "CONSOLIDATED" | "OTHER",
  "blank": false,
  "isFinancialReport": true,
  "companyName": "tên công ty in trên tài liệu hoặc null",
  "fromDate": "ngày bắt đầu kỳ báo cáo như in trên tài liệu hoặc null",
  "toDate": "ngày kết thúc kỳ báo cáo như in trên tài liệu hoặc null",
  "currency": "mã/tên tiền tệ như in trên tài liệu hoặc null",
  "unit": "đơn vị số liệu như in trên tài liệu (ví dụ 百万円, Million Yen, 千円) hoặc null",
  "pages": [
    { "page": ${pageFrom}, "reportType": "balanceSheet", "basis": "TITLE", "titleFound": "貸借対照表", "hasTable": true, "blank": false }
  ],
  "reports": [
    { "reportType": "balanceSheet", "pageFrom": ${pageFrom}, "pageTo": ${pageFrom}, "confidence": "high", "titleFound": "貸借対照表" },
    { "reportType": "incomeStatement", "pageFrom": null, "pageTo": null, "confidence": "high", "titleFound": null }
  ]
}

Giải thích thêm:
- "blank" = true chỉ khi TOÀN BỘ các trang gửi kèm đều trống, không có nội dung nào.
- "isFinancialReport": true nếu đây là báo cáo tài chính (kể cả khi khoảng trang này chỉ có
  bìa, mục lục hay phần thuyết minh của bộ báo cáo); false nếu là loại tài liệu khác.
  Đây là field BẮT BUỘC, phải là true hoặc false.
- "sourceLanguage" là ngôn ngữ chính của tài liệu, trả bằng MÃ ISO 639-1 2 chữ cái thường
  (tiếng Nhật = "ja", tiếng Anh = "en", tiếng Hàn = "ko", tiếng Trung = "zh"). Không trả tên ngôn ngữ.`,
  };
}

/**
 * UAT #04 / T4 — soi lại riêng những trang đã bị bỏ sót sau lượt classify đầu.
 * Giữ prompt classify chuẩn làm nền để quy tắc T3 không bị lệch giữa hai lượt.
 */
export function buildClassifyRecheckPrompt(
  pageFrom: number,
  pageTo: number,
  totalPages: number,
  knownTitles: string[],
  promptOverride?: string,
  sourceMode?: string,
  supplementalAliases: SupplementalReportTitleAliases = {},
): Record<string, unknown> {
  const base = buildClassifyPrompt(pageFrom, pageTo, totalPages, promptOverride, sourceMode, supplementalAliases);
  const prompt = typeof base._prompt === 'string' ? base._prompt : '';
  const titles = knownTitles.length > 0 ? knownTitles.map((title) => `「${title}」`).join(', ') : 'chưa có';

  return {
    _prompt: `${prompt}

### SOI LẠI TRANG BỊ BỎ SÓT — UAT #04 / T4
Các trang ${pageFrom}–${pageTo} đã bị bỏ sót ở lượt phân loại trước. Hãy soi kỹ lại.
Báo cáo có thể KHÔNG in tiêu đề trên chính trang này vì tiêu đề nằm ở trang trước.
Tiêu đề đã tìm thấy ở lượt 1: ${titles}.
KHÔNG gán loại báo cáo cho trang tóm lược chỉ số (có cột ％ hoặc 円 銭, 連結経営成績 / 連結財政状態 / 業績予想).
KHÔNG gán Bảng cân đối hay KQKD cho trang có tiêu đề dạng …に関する注記; đó là notesToFinancialStatements.
T10 / R5: tên báo cáo trong câu văn tham chiếu (dấu 。/、, 参照/ください/ページ/については,
không ở đầu dòng, hoặc dài hơn khoảng 60 ký tự) phải trả reportType = null, basis = "NONE".
T10 / R4: khi có tiêu đề cha chứa 「及び」/"and" và tiêu đề con trong ngoặc chỉ một báo cáo,
trả tiêu đề con làm titleFound.`,
  };
}

// ─── Step 2: Extract báo cáo dạng bảng (§13.3) ───────────────────────────────

export function buildExtractPrompt(
  reportType: ReportType,
  pageFrom: number,
  pageTo: number,
  isContinuationChunk: boolean,
  knownColumnIds: string[],
  promptOverride?: string,
  sourceMode?: string,
): Record<string, unknown> {
  const alias = REPORT_ALIASES[reportType];
  const vars = {
    report_type: reportType,
    page_from: String(pageFrom),
    page_to: String(pageTo),
    alias_ja: alias.ja.join(', '),
    alias_en: alias.en.join(', '),
    row_types: ROW_TYPES.join(' | '),
    known_columns: knownColumnIds.join(', '),
    is_continuation: isContinuationChunk ? 'true' : 'false',
  };

  if (promptOverride) {
    return { _prompt: interpolatePrompt(promptOverride, vars) };
  }

  const continuationBlock = isContinuationChunk
    ? `\n### LƯU Ý PHẦN TIẾP NỐI — QUAN TRỌNG
Đây là phần TIẾP NỐI của bảng đã bóc ở các trang trước.
Các column id ĐÃ DÙNG cho bảng này: ${knownColumnIds.length > 0 ? knownColumnIds.map((id) => `"${id}"`).join(', ') : '(chưa có)'}

- BẮT BUỘC DÙNG LẠI ĐÚNG các column id trên, KHÔNG đặt id mới, KHÔNG đổi cách viết
  (không đổi hoa/thường, không thêm/bớt hậu tố), miễn là bố cục cột của bảng KHÔNG đổi.
  Đặt id mới trong khi cột vẫn như cũ sẽ làm bảng bị tách rời và số liệu rơi sai cột.
- CHỈ tạo column id mới khi trang này thực sự xuất hiện THÊM một cột số liệu chưa từng có.
  Khi đó vẫn phải giữ nguyên các id cũ cho những cột cũ.
- Nếu trang này in lại dòng tiêu đề của bảng (header lặp khi sang trang) thì KHÔNG trả dòng đó thành row.
- Đặt "isContinuation": true cho table tương ứng.\n`
    : '';

  return {
    _prompt: `Bạn là chuyên gia số hóa báo cáo tài chính (chuẩn kế toán Nhật Bản). Đây là nghiệp vụ thẩm định tín dụng hợp pháp của ngân hàng VPBank.

Các trang gửi kèm có classify context là báo cáo loại "${reportType}".
${buildAttachmentBlock(pageFrom, pageTo, sourceMode)}
Tiêu đề tương ứng: JA = ${alias.ja.join(' / ')} | EN = ${alias.en.join(' / ')}.
Mọi "sourcePage" bạn trả về PHẢI dùng số trang của tài liệu GỐC (trang đầu của file gửi kèm là trang ${pageFrom}).
${continuationBlock}
### NHIỆM VỤ
Bóc MỌI bảng số liệu trên các trang này thành cấu trúc columns + rows, kể cả bảng có nội dung khác với classify context.

Với MỖI phần tử trong "tables":
- "reportType" BẮT BUỘC là đúng một trong: ${REPORT_TYPES.join(' | ')} | OTHER. Chọn theo NỘI DUNG của chính bảng; OTHER khi không thuộc bảy loại trên.
- "tableTitle" là tiêu đề bảng nguyên văn như in trên tài liệu, hoặc null nếu bảng không in tiêu đề.
- "reportType" ở ROOT chỉ là classify context "${reportType}" để tương thích; KHÔNG dùng nó thay cho reportType từng bảng.

### ĐỌC ĐỦ — CHỐNG BỎ SÓT DÒNG (BẮT BUỘC)
- ĐỌC HẾT mọi trang từ ${pageFrom} đến ${pageTo}. TUYỆT ĐỐI KHÔNG dừng sau trang đầu hay sau một khối.
  Báo cáo tài chính thường trải QUA NHIỀU TRANG: phần sau (trang thứ hai trở đi) cũng phải bóc đủ.
- Với BẢNG CÂN ĐỐI KẾ TOÁN: phải bóc đủ CẢ BA khối, kể cả khi Nợ/Vốn nằm ở TRANG SAU:
  Tài sản (資産の部 / Assets), Nợ phải trả (負債の部 / Liabilities), Vốn chủ sở hữu
  (純資産の部 / 資本の部 / Equity) — cùng các dòng tổng (負債合計, 純資産合計, 負債純資産合計, Total equity...).
- Với BÁO CÁO BIẾN ĐỘNG VỐN CHỦ SỞ HỮU (ma trận): bóc đủ MỌI CỘT thành phần vốn (mỗi thành phần là 1 column),
  không gộp, không bỏ cột nào; và đủ mọi dòng biến động.
- Với các báo cáo khác: bóc đến dòng TỔNG cuối cùng, không dừng giữa chừng.
- Tự kiểm trước khi trả: nếu bảng lẽ ra có phần tổng (Total ...) mà bạn chưa bóc tới, nghĩa là còn thiếu — đọc tiếp.

- "columns": mỗi cột số liệu là 1 phần tử. id viết camelCase không dấu (ví dụ currentPeriod, previousPeriod, capitalStock).
  - "labelSource" = nhãn cột ĐÚNG NHƯ IN trên tài liệu (ví dụ 当期, 前期, Current Period).
  - "period" = kỳ của cột như in trên tài liệu, hoặc null nếu không ghi.
- "rows": mỗi dòng khoản mục là 1 phần tử, theo đúng thứ tự in trên tài liệu.
  - "labelSource" = tên khoản mục ĐÚNG NHƯ IN (giữ nguyên ngôn ngữ nguồn, KHÔNG dịch).
  - "rowType" ∈ ${ROW_TYPES.join(' | ')}.
    SECTION = dòng tiêu đề nhóm (thường không có số). DETAIL = khoản mục chi tiết.
    SUBTOTAL = tổng nhóm con. TOTAL = tổng lớn.
    OPENING_BALANCE / CHANGE / CLOSING_BALANCE chỉ dùng cho báo cáo biến động vốn chủ sở hữu.
  - "level" = cấp thụt lề, bắt đầu từ 1.
  - "parentRowId" = rowId của dòng cha, hoặc null nếu là cấp 1.
  - "values" = { "<column id>": "<giá trị dạng string, copy y hệt như in>" }.

${NO_HALLUCINATION_RULES}
- KHÔNG DỊCH bất cứ chữ gì ở bước này. Chỉ đọc và copy chữ nguồn.
- Nếu các trang này KHÔNG có bất kỳ bảng số liệu nào → trả { "reportType": "${reportType}", "tables": [], "notFound": true, "warnings": [] }.
- Nếu chỉ thấy DÒNG TỔNG mà không có bảng chi tiết → vẫn trả dòng tổng đó (rowType = "TOTAL") và thêm "DETAIL_NOT_FOUND" vào warnings.

### ĐƠN VỊ SỐ LIỆU — BẮT BUỘC TÌM
Trước khi bóc bảng, hãy TÌM đơn vị số liệu của CHÍNH báo cáo này. Nơi cần soi, theo thứ tự:

1. Dòng ngay dưới hoặc ngay cạnh TIÊU ĐỀ báo cáo.
2. Góc TRÊN BÊN PHẢI của bảng (chỗ hay in 「単位：百万円」).
3. Trong ngoặc ngay sau tiêu đề, ví dụ \`(百万円)\`, \`(Millions of yen)\`.
4. Ngay trên dòng header cột số tiền.

Các dạng thường gặp: 「単位：円」「単位：千円」「単位：百万円」「(百万円)」
"Unit: Millions of yen", "(Thousands of yen)", "(Yen)", "in millions of JPY".

Quy tắc:
- Trả NGUYÊN VĂN chuỗi đọc được vào "unitSource" (ví dụ \`百万円\`, \`Millions of yen\`).
  KHÔNG dịch, KHÔNG chuẩn hoá, KHÔNG tự quy đổi.
- Các báo cáo trong CÙNG một bộ CÓ THỂ dùng đơn vị KHÁC NHAU (bảng cân đối theo 百万円 nhưng
  bảng chi phí bán hàng theo 円). PHẢI đọc đơn vị của riêng báo cáo này, TUYỆT ĐỐI không
  suy từ báo cáo khác hay từ trang bìa.
- Soi hết 4 chỗ trên mà không thấy → trả \`null\`. KHÔNG suy đoán, KHÔNG tự điền.

### OUTPUT JSON (đúng cấu trúc này)
{
  "reportType": "${reportType}",
  "titleSource": "tiêu đề báo cáo như in trên tài liệu hoặc null",
  "unitSource": "đơn vị in trên báo cáo này như 百万円 / Millions of yen, hoặc null",
  "notFound": false,
  "warnings": [],
  "tables": [
    {
      "tableId": "${reportType}-1",
      "reportType": "${reportType}",
      "tableTitle": "tiêu đề bảng nguyên văn hoặc null",
      "isContinuation": ${isContinuationChunk ? 'true' : 'false'},
      "columns": [
        { "id": "currentPeriod", "labelSource": "当期", "dataType": "number", "period": "2025-03-31" }
      ],
      "rows": [
        { "rowId": "r1", "parentRowId": null, "level": 1, "rowType": "SECTION", "labelSource": "資産の部", "sourcePage": ${pageFrom}, "values": {} },
        { "rowId": "r2", "parentRowId": "r1", "level": 2, "rowType": "DETAIL", "labelSource": "現金及び預金", "sourcePage": ${pageFrom}, "values": { "currentPeriod": "5,288" } },
        { "rowId": "r3", "parentRowId": "r1", "level": 2, "rowType": "DETAIL", "labelSource": "貸倒引当金", "sourcePage": ${pageFrom}, "values": { "currentPeriod": "△37" } },
        { "rowId": "r4", "parentRowId": null, "level": 1, "rowType": "SECTION", "labelSource": "負債の部", "sourcePage": ${pageTo}, "values": {} },
        { "rowId": "r5", "parentRowId": "r4", "level": 2, "rowType": "TOTAL", "labelSource": "負債合計", "sourcePage": ${pageTo}, "values": { "currentPeriod": "3,120" } },
        { "rowId": "r6", "parentRowId": null, "level": 1, "rowType": "SECTION", "labelSource": "純資産の部", "sourcePage": ${pageTo}, "values": {} },
        { "rowId": "r7", "parentRowId": "r6", "level": 2, "rowType": "TOTAL", "labelSource": "純資産合計", "sourcePage": ${pageTo}, "values": { "currentPeriod": "2,168" } }
      ]
    }
  ]
}`,
  };
}

// ─── Step 2b: Extract thuyết minh (notes) ────────────────────────────────────

export function buildNotesExtractPrompt(
  pageFrom: number,
  pageTo: number,
  promptOverride?: string,
  sourceMode?: string,
): Record<string, unknown> {
  const alias = REPORT_ALIASES.notesToFinancialStatements;
  const vars = {
    page_from: String(pageFrom),
    page_to: String(pageTo),
    alias_ja: alias.ja.join(', '),
    alias_en: alias.en.join(', '),
  };

  if (promptOverride) {
    return { _prompt: interpolatePrompt(promptOverride, vars) };
  }

  return {
    _prompt: `Bạn là chuyên gia số hóa báo cáo tài chính (chuẩn kế toán Nhật Bản). Đây là nghiệp vụ thẩm định tín dụng hợp pháp của ngân hàng VPBank.

Các trang gửi kèm chứa phần thuyết minh báo cáo tài chính.
${buildAttachmentBlock(pageFrom, pageTo, sourceMode)}
Tiêu đề tương ứng: JA = ${alias.ja.join(' / ')} | EN = ${alias.en.join(' / ')}.
Mọi "sourcePage" PHẢI dùng số trang của tài liệu GỐC (trang đầu của file gửi kèm là trang ${pageFrom}).

### NHIỆM VỤ
Bóc phần thuyết minh thành danh sách sections theo đúng thứ tự in trên tài liệu.
- Mỗi mục thuyết minh (có tiêu đề riêng) là 1 section.
- "titleSource" = tiêu đề mục như in trên tài liệu.
- "sourceText" = toàn bộ nội dung của mục, copy nguyên văn theo ngôn ngữ nguồn. Cho phép dùng markdown để giữ bảng/gạch đầu dòng.
- Đồng thời bóc MỌI bảng số liệu nằm trong vùng thuyết minh vào "tables" theo đúng schema bảng chuẩn:
  "reportType" phải là một trong ${REPORT_TYPES.join(' | ')} | OTHER, "tableTitle" là tiêu đề nguyên văn hoặc null,
  và mỗi bảng có đầy đủ "columns" + "rows". Giữ sections và tables trong CÙNG MỘT phản hồi, không bỏ section vì có bảng.

${NO_HALLUCINATION_RULES}
- KHÔNG DỊCH, KHÔNG TÓM TẮT, KHÔNG diễn giải lại. Copy nguyên văn.
- Nếu các trang này không có phần thuyết minh → trả { "sections": [], "notFound": true, "warnings": [] }.

### OUTPUT JSON (đúng cấu trúc này)
{
  "titleSource": "個別注記表",
  "notFound": false,
  "warnings": [],
  "sections": [
    { "sectionId": "s1", "sourcePage": ${pageFrom}, "titleSource": "重要な会計方針", "sourceText": "..." }
  ],
  "tables": [
    {
      "tableId": "note-table-1",
      "reportType": "sgaBreakdown",
      "tableTitle": "販売費及び一般管理費の内訳",
      "columns": [{ "id": "currentPeriod", "labelSource": "当期", "dataType": "number", "period": null }],
      "rows": [{ "rowId": "r1", "parentRowId": null, "level": 1, "rowType": "DETAIL", "labelSource": "給料手当", "sourcePage": ${pageFrom}, "values": { "currentPeriod": "1,200" } }]
    }
  ]
}`,
  };
}

// ─── Step 3: Translate (§13.4) ───────────────────────────────────────────────

const LANG_LABEL: Record<TargetLang, string> = {
  vi: 'tiếng Việt',
  en: 'tiếng Anh (English)',
};

/**
 * Prompt dịch theo danh sách id → tránh AI trả lại cả bảng và làm hỏng số.
 * Chỉ dịch text; TUYỆT ĐỐI không đổi số, ngày, mã, đơn vị.
 */
export function buildTranslatePrompt(
  targetLang: TargetLang,
  items: TranslateItem[],
  promptOverride?: string,
): Record<string, unknown> {
  const itemsJson = JSON.stringify(items.map((i) => ({ id: i.id, text: i.text })), null, 0);
  const vars = {
    target_lang: targetLang,
    target_lang_label: LANG_LABEL[targetLang],
    items_json: itemsJson,
    item_count: String(items.length),
  };

  if (promptOverride) {
    return { _prompt: interpolatePrompt(promptOverride, vars) };
  }

  return {
    _prompt: `Bạn là chuyên gia dịch thuật tài chính - kế toán Nhật/Anh sang ${LANG_LABEL[targetLang]}, phục vụ nghiệp vụ thẩm định tín dụng của ngân hàng.

### NHIỆM VỤ
Dịch sang ${LANG_LABEL[targetLang]} phần "text" của từng phần tử trong danh sách dưới đây. Trả kết quả theo đúng "id".

### QUY TẮC TUYỆT ĐỐI
- CHỈ dịch chữ. TUYỆT ĐỐI KHÔNG thay đổi, không thêm, không bớt: số, ngày, mã số, ký hiệu △ ▲, dấu ngoặc, đơn vị tiền tệ.
- Nếu "text" có chứa số liệu, giữ nguyên y hệt các số đó trong bản dịch.
- KHÔNG thêm phần tử, KHÔNG bớt phần tử, KHÔNG đổi "id". Số phần tử trả về phải đúng ${items.length}.
- Dùng thuật ngữ kế toán chuẩn (ví dụ 現金及び預金 → "Tiền và các khoản tương đương tiền gửi", 資産合計 → "Tổng tài sản").
- Nếu không dịch được một phần tử, trả lại nguyên văn "text" gốc cho id đó.
- CHỈ trả JSON hợp lệ, không kèm giải thích, không kèm markdown fence.

### DANH SÁCH CẦN DỊCH
${itemsJson}

### OUTPUT JSON (đúng cấu trúc này)
{
  "translations": [
    { "id": "<id giữ nguyên>", "translated": "<bản dịch>" }
  ]
}`,
  };
}

export { interpolatePrompt };
