// lib/pipelines/workflows/financial-report/number-parse.ts
// Pure functions — nguyên tắc chốt ở PLAN rev.2: AI chỉ đọc và trả string,
// CODE làm việc parse số / đơn vị / validate. AI không được làm toán.
// Nguồn: PLAN/TASK-1-WORKFLOW.md §14 (rule parse số) và §15 (unit multiplier).

import type { CellValue, UnitInfo, TargetLang } from './types';

/** Ký hiệu âm của báo cáo Nhật. */
const NEGATIVE_MARKS = ['△', '▲', '−', '－', '‐', '‑', '˗'];

/** Chuỗi đại diện "không có số" → normalized = null, TUYỆT ĐỐI không đổi thành 0. */
const NULL_TOKENS = new Set([
  '-', '--', '—', '–', 'ー', '－', '‐', '_',
  'n/a', 'na', 'n.a.', 'n/a.', 'nil', 'none',
  '該当なし', '-.-', '.', '･',
]);

/**
 * Chuyển ký tự full-width (１２３, ，, ．, －) sang ASCII.
 * Không đổi ý nghĩa, chỉ chuẩn hóa mã ký tự để parse được.
 */
export function toAsciiDigits(input: string): string {
  return input
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\uFF0C\u3001]/g, ',')
    .replace(/[\uFF0E\u3002]/g, '.')
    .replace(/\uFF0D/g, '-')
    .replace(/[\uFF08]/g, '(')
    .replace(/[\uFF09]/g, ')')
    .replace(/[\u00A0\u3000\u2007\u202F]/g, ' ');
}

/**
 * Parse một ô số trên báo cáo tài chính về number.
 *
 * | Trên PDF   | normalized |
 * |------------|-----------|
 * | `5,288`    | 5288      |
 * | `△37`      | -37       |
 * | `▲37`      | -37       |
 * | `(1,250)`  | -1250     |
 * | `-1,250`   | -1250     |
 * | `1,234.56` | 1234.56   |
 * | `-`        | null      |
 * | `N/A`      | null      |
 * | ô trống    | null      |
 */
export function parseFinancialNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  let text = toAsciiDigits(String(raw)).trim();
  if (text === '') return null;
  if (NULL_TOKENS.has(text.toLowerCase())) return null;

  let isNegative = false;

  // Dấu âm dạng ký hiệu Nhật (có thể đứng trước hoặc sau, hoặc trong ngoặc)
  for (const mark of NEGATIVE_MARKS) {
    if (text.includes(mark)) {
      isNegative = true;
      text = text.split(mark).join('');
    }
  }

  // Dấu ngoặc = âm theo quy ước kế toán
  if (/^\(.*\)$/.test(text.trim())) {
    isNegative = true;
    text = text.trim().slice(1, -1);
  }

  // Dấu trừ ASCII
  const trimmed = text.trim();
  if (trimmed.startsWith('-')) {
    isNegative = true;
    text = trimmed.slice(1);
  }

  // Giữ lại chữ số và dấu thập phân; bỏ dấu phân cách nghìn, ký hiệu tiền tệ, %, chữ
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (cleaned === '' || !/[0-9]/.test(cleaned)) return null;

  // Nhiều dấu chấm (vd "1.234.567" kiểu EU) → coi là phân cách nghìn
  const dotCount = (cleaned.match(/\./g) || []).length;
  let numericText = cleaned;
  if (dotCount > 1) {
    numericText = cleaned.replace(/\./g, '');
  }

  const value = Number(numericText);
  if (!Number.isFinite(value)) return null;

  return isNegative ? -Math.abs(value) : value;
}

/**
 * Dựng CellValue từ giá trị AI trả về.
 * Trả null khi ô trống (caller phải BỎ KEY, không đặt 0 — §4).
 */
export function toCellValue(raw: string | number | null | undefined): CellValue | null {
  if (raw === null || raw === undefined) return null;
  const rawText = typeof raw === 'number' ? String(raw) : raw;
  if (rawText.trim() === '') return null;
  return { raw: rawText, normalized: parseFinancialNumber(rawText) };
}

// ─── Unit multiplier (§15) ────────────────────────────────────────────────────

interface UnitDefinition {
  multiplier: number;
  aliases: string[];
  vi: string;
  en: string;
}

const UNIT_DEFINITIONS: UnitDefinition[] = [
  {
    multiplier: 1_000_000_000,
    aliases: ['十億円', 'billion yen', 'billions of yen', 'bn yen', '十億'],
    vi: 'Tỷ yên',
    en: 'Billion yen',
  },
  {
    multiplier: 1_000_000,
    aliases: ['百万円', 'million yen', 'millions of yen', 'mn yen', '百万'],
    vi: 'Triệu yên',
    en: 'Million yen',
  },
  {
    multiplier: 1_000,
    aliases: ['千円', 'thousand yen', 'thousands of yen', 'k yen', '千'],
    vi: 'Nghìn yên',
    en: 'Thousand yen',
  },
  {
    multiplier: 1,
    aliases: ['円', 'yen', 'jpy'],
    vi: 'Yên',
    en: 'Yen',
  },
];

/**
 * Suy ra multiplier và nhãn dịch của đơn vị từ chuỗi in trên báo cáo.
 * `normalized` của các ô số KHÔNG nhân multiplier — quy đổi là việc của downstream.
 */
export function resolveUnit(unitSource: string | null | undefined, targetLang: TargetLang): UnitInfo {
  if (!unitSource || !unitSource.trim()) {
    return { source: null, translated: null, multiplier: null };
  }
  // Vòng #05 mục 39: AI trả nguyên cụm in trên báo cáo ("(単位:百万円)", "Unit: millions of yen").
  // Nhận diện vẫn chạy được vì dùng `includes`, nhưng `source` mang cả tiền tố khiến nhãn
  // hiển thị/Excel ra "(単位:百万円)" thay vì "百万円". Bỏ tiền tố + dấu ngoặc bao ngoài.
  const source = stripUnitPrefix(unitSource);
  const haystack = toAsciiDigits(source).toLowerCase();

  for (const def of UNIT_DEFINITIONS) {
    const hit = def.aliases.some((alias) => haystack.includes(alias.toLowerCase()));
    if (hit) {
      return {
        source,
        translated: targetLang === 'vi' ? def.vi : def.en,
        multiplier: def.multiplier,
      };
    }
  }

  // Không khớp bảng đã biết: giữ nguyên chữ nguồn, để multiplier null + caller gắn warning UNIT_NOT_FOUND
  return { source, translated: null, multiplier: null };
}

/** Tiền tố "đơn vị:" theo các ngôn ngữ nguồn đã gặp, kèm biến thể có/không dấu ngoặc. */
const UNIT_PREFIX_PATTERN = /^[(（\[]?\s*(?:単位|単位表示|unit|units|in)\s*[:：]?\s*/i;

/** Bỏ tiền tố "Unit:" / "単位:" / "(単位:" và dấu ngoặc/dấu chấm bao ngoài. */
function stripUnitPrefix(raw: string): string {
  let text = raw.trim().replace(UNIT_PREFIX_PATTERN, '');
  // Ngoặc bao trọn cụm: "(百万円)" → "百万円". Chỉ cắt khi ngoặc thực sự khớp cặp.
  const wrapped = text.match(/^[(（\[]\s*(.*?)\s*[)）\]]$/);
  if (wrapped) text = wrapped[1];
  // Ngoặc lẻ còn lại do tiền tố đã bị cắt: "百万円)" → "百万円".
  text = text.replace(/^[(（\[]+/, '').replace(/[)）\]]+$/, '');
  return text.replace(/[.,;、。\s]+$/, '').trim();
}

/**
 * Chuẩn hóa mã tiền tệ về dạng ISO 3 ký tự khi nhận diện được.
 *
 * Vòng #05 mục 39 — thứ tự kiểm TRA ĐỔI: bảng alias TRƯỚC, passthrough 3 ký tự SAU.
 * Trước đây "YEN" khớp `^[A-Za-z]{3}$` nên trả về "YEN" (không phải mã ISO) và không bao giờ
 * chạm tới nhánh nhận diện JPY. Tương tự "Yen"/"yen" viết hoa/thường.
 */
export function normalizeCurrency(input: string | null | undefined): string | null {
  if (!input || !input.trim()) return null;
  const text = toAsciiDigits(input).trim();
  const lower = text.toLowerCase();

  if (lower.includes('円') || lower.includes('yen') || lower.includes('¥') || lower.includes('jpy')) return 'JPY';
  if (lower.includes('usd') || lower.includes('dollar') || lower.includes('$')) return 'USD';
  if (lower.includes('vnd') || lower.includes('đồng') || lower.includes('dong')) return 'VND';
  if (lower.includes('eur') || lower.includes('€')) return 'EUR';

  if (/^[A-Za-z]{3}$/.test(text)) return text.toUpperCase();
  return text;
}

/**
 * Tên tháng tiếng Anh (đầy đủ + viết tắt) → số tháng.
 * Vòng #05 mục 38: mẫu Air Water (tiếng Anh) in kỳ dạng "April 1, 2025" / "1 April 2025";
 * trước đây không parse được nên `fromDate`/`toDate` giữ nguyên chuỗi tiếng Anh, làm hệ
 * tích hợp không so sánh/lọc được theo ngày.
 */
const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_NAME_GROUP = Object.keys(EN_MONTHS)
  .sort((a, b) => b.length - a.length) // dài trước để "june" không bị "jun" cắt ngắn
  .join('|');

/** "April 1, 2025" / "Apr 1 2025" / "March 31st, 2026" */
const EN_MDY = new RegExp(`\\b(${MONTH_NAME_GROUP})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})\\b`, 'i');
/** "1 April 2025" / "31st March, 2026" */
const EN_DMY = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAME_GROUP})\\.?\\s*,?\\s*(\\d{4})\\b`, 'i');

/**
 * Chuẩn hóa ngày về ISO yyyy-MM-dd khi nhận diện được, ngược lại giữ nguyên chuỗi gốc.
 * Hỗ trợ: 2025-03-31, 2025/03/31, 2025年3月31日, 31/03/2025, "April 1, 2025", "1 April 2025".
 *
 * KHÔNG bao giờ đoán ngày khi thiếu thành phần (ví dụ chỉ có "March 2025") — giữ nguyên
 * chuỗi gốc để BU nhìn thấy đúng những gì in trên tài liệu.
 */
export function normalizeDate(input: string | null | undefined): string | null {
  if (!input || !input.trim()) return null;
  const text = toAsciiDigits(input).trim();

  const iso = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;

  const jp = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (jp) return `${jp[1]}-${pad2(jp[2])}-${pad2(jp[3])}`;

  const dmy = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) return `${dmy[3]}-${pad2(dmy[2])}-${pad2(dmy[1])}`;

  // Dạng "1 April 2025" phải thử TRƯỚC "April 1, 2025": chuỗi "1 April 2025" cũng khớp
  // EN_MDY ở đoạn "April 2025" nếu ngày rơi vào vị trí năm — kiểm dmy trước là an toàn.
  const enDmy = text.match(EN_DMY);
  if (enDmy) {
    const month = EN_MONTHS[enDmy[2].toLowerCase()];
    if (month) return `${enDmy[3]}-${pad2(String(month))}-${pad2(enDmy[1])}`;
  }

  const enMdy = text.match(EN_MDY);
  if (enMdy) {
    const month = EN_MONTHS[enMdy[1].toLowerCase()];
    if (month) return `${enMdy[3]}-${pad2(String(month))}-${pad2(enMdy[2])}`;
  }

  return text;
}

function pad2(value: string): string {
  return value.padStart(2, '0');
}
