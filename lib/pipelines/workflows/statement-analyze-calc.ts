// lib/pipelines/workflows/statement-analyze-calc.ts
// Pure calculation engine cho workflow Statement Analyze.
// KHÔNG phụ thuộc DB/queue/AI — nhận StatementJSON (kết quả OCR đã gộp) và trả
// StatementAnalysisResult. Nhờ vậy có thể unit-test / chạy demo độc lập.
//
// Quy tắc nghiệp vụ đã chốt với BU:
//   1. Số dư thấp/cao nhất của tháng lấy từ SỐ DƯ SAU MỖI GIAO DỊCH (cột Balance).
//   2. SDBQ_tháng = (min + max) / 2.
//   3. Nếu sao kê > 6 tháng: tính SDBQ từng tháng rồi chọn ra 6 THÁNG có SDBQ
//      CAO NHẤT (KHÔNG bắt buộc liên tiếp). ≤ 6 tháng: lấy hết các tháng.
//   4. Cực trị (tháng + thời gian số dư cao/thấp nhất) tính TRONG 6 tháng được chọn.
//   5. Thời gian phát sinh = ngày giao dịch (mẫu không có giờ).
//   6. total_transactions / total_days / total_pages tính trên TOÀN BỘ file.

import type {
  StatementJSON,
  StatementTransaction,
  StatementAnalysisResult,
  MonthlyBalance,
  BalanceBreak,
} from './prompts/statement-analyze-prompts';

// ─── Tie-break cho khoảng 6 tháng đồng SDBQ ────────────────────────────────────
// 'latest' = ưu tiên khoảng gần hiện tại nhất; 'earliest' = khoảng sớm nhất.
// Chốt mặc định 'latest' (ưu tiên hoạt động gần đây), có thể chỉnh qua option.
export type WindowTieBreak = 'latest' | 'earliest';

export interface CalcOptions {
  /** Số tháng tối đa của chu kỳ. Mặc định 6. */
  windowSize?: number;
  tieBreak?: WindowTieBreak;
  /** Sai số tuyệt đối khi kiểm tra chuỗi số dư (VND). Mặc định 1. */
  balanceEpsilon?: number;
}

const DEFAULT_OPTS: Required<CalcOptions> = {
  windowSize: 6,
  tieBreak: 'latest',
  balanceEpsilon: 1,
};

// ─── Money parsing ────────────────────────────────────────────────────────────
// Statement-specific parser. Unlike the generic payroll parser, a LONE dot with
// a 3-digit trailing group is treated as a THOUSANDS separator ("800.000" →
// 800000), because Vietnamese bank statement amounts use dot-thousands and
// almost never carry sub-unit decimals. A separator is the decimal point ONLY
// when the trailing group is not exactly 3 digits ("12,50" → 12.5, "1.234,56" →
// 1234.56). Both-separator inputs use the rightmost as the decimal.

const CURRENCY_TOKENS = /(vnđ|vnd|đồng|dong|đ|usd|\$)/gi;

export function parseAmount(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null;
  }

  let s = String(input).trim();
  if (s === '') return null;
  s = s.replace(/\u2212/g, '-').replace(CURRENCY_TOKENS, '').replace(/\s+/g, '');
  if (s === '') return null;

  let sign = 1;
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); }
  else if (s.startsWith('+')) { s = s.slice(1); }

  if (!/\d/.test(s)) return null;
  if (!/^[0-9.,]+$/.test(s)) return null;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let normalized: string;

  if (hasDot && hasComma) {
    const decimalSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    const parts = s.split(decimalSep);
    const decimalPart = parts.pop() ?? '';
    const intPart = parts.join('').split(thousandsSep).join('');
    normalized = decimalPart ? `${intPart}.${decimalPart}` : intPart;
  } else if (hasDot || hasComma) {
    const sep: '.' | ',' = hasDot ? '.' : ',';
    const groups = s.split(sep);
    const lastGroup = groups[groups.length - 1];
    // Decimal only when the last group is not a full 3-digit thousands group.
    const lastIsDecimal = lastGroup.length !== 3;
    if (lastIsDecimal) {
      const decimalPart = groups.pop() as string;
      normalized = `${groups.join('')}.${decimalPart}`;
    } else {
      normalized = groups.join('');
    }
  } else {
    normalized = s;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? sign * value : null;
}

// ─── Date helpers ───────────────────────────────────────────────────────────────

interface ParsedDate {
  year: number;
  month: number; // 1-12
  day: number;
  /** Chỉ số tháng tuyệt đối = year*12 + (month-1) — để so sánh khoảng liên tiếp. */
  monthIndex: number;
  /** 'MM/yyyy'. */
  monthKey: string;
  /** Số ngày kể từ epoch (UTC) — để tính tổng số ngày. */
  epochDay: number;
}

/** Parse ngày dd/mm/yyyy (chấp nhận d/m/yyyy, dấu '.' hoặc '-'). Trả null nếu sai. */
export function parseVNDate(raw: string | null | undefined): ParsedDate | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const monthIndex = year * 12 + (month - 1);
  const monthKey = `${String(month).padStart(2, '0')}/${year}`;
  const epochDay = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return { year, month, day, monthIndex, monthKey, epochDay };
}

function monthKeyFromIndex(monthIndex: number): string {
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return `${String(month).padStart(2, '0')}/${year}`;
}

/** Ngày chỉ có ngày/tháng ("dd/mm"), thiếu năm — chấp nhận dấu '/', '.', '-'. */
const DAY_MONTH_ONLY = /^(\d{1,2})[\/.\-](\d{1,2})$/;

/**
 * Suy ra NĂM cho một cặp (day, month) chỉ có ngày/tháng, dựa vào kỳ sao kê.
 * - Có cả start & end: chọn năm trong [startYear, endYear] sao cho ngày rơi vào
 *   khoảng [start, end]. Nếu không năm nào lọt khoảng (OCR lệch mép) → heuristic
 *   theo tháng so với tháng bắt đầu (sao kê chạy tiến theo thời gian).
 * - Chỉ có start: tháng ≥ tháng bắt đầu → cùng năm start; nhỏ hơn → năm sau.
 * - Chỉ có end: tháng ≤ tháng kết thúc → cùng năm end; lớn hơn → năm trước.
 * - Không có mốc nào → null (để tầng gọi thử fallback khác).
 */
function inferYearFromPeriod(
  day: number,
  month: number,
  startD: ParsedDate | null,
  endD: ParsedDate | null,
): number | null {
  if (startD && endD) {
    for (let y = startD.year; y <= endD.year; y++) {
      const ep = Math.floor(Date.UTC(y, month - 1, day) / 86_400_000);
      if (ep >= startD.epochDay && ep <= endD.epochDay) return y;
    }
    return month >= startD.month ? startD.year : endD.year;
  }
  if (startD) return month >= startD.month ? startD.year : startD.year + 1;
  if (endD) return month <= endD.month ? endD.year : endD.year - 1;
  return null;
}

/**
 * Chuẩn hoá transaction_date: bổ sung NĂM cho các giao dịch chỉ có ngày/tháng.
 *
 * Nguồn năm ưu tiên: kỳ sao kê (statement_start_date / statement_end_date).
 * Nếu header thiếu năm, fallback lấy năm của giao dịch ĐÃ CÓ NĂM gần nhất
 * (ưu tiên dòng liền trước, vì giao dịch được sắp theo thứ tự thời gian).
 *
 * KHÔNG mutate input. Trả về mảng transaction mới; giao dịch không suy ra được
 * năm sẽ giữ nguyên chuỗi gốc (không bịa năm).
 */
export function normalizeTransactionYears(
  transactions: StatementTransaction[],
  startDate: string | null,
  endDate: string | null,
): StatementTransaction[] {
  const startD = parseVNDate(startDate);
  const endD = parseVNDate(endDate);

  // Năm của các giao dịch đã có đủ ngày/tháng/năm (theo thứ tự gốc) — dùng fallback.
  const fullYears: Array<number | null> = transactions.map((tx) => {
    const p = parseVNDate(tx.transaction_date);
    return p ? p.year : null;
  });
  const resolveFallbackYear = (idx: number): number | null => {
    for (let i = idx - 1; i >= 0; i--) if (fullYears[i] != null) return fullYears[i];
    for (let i = idx + 1; i < fullYears.length; i++) if (fullYears[i] != null) return fullYears[i];
    return null;
  };

  return transactions.map((tx, idx) => {
    const raw = tx.transaction_date ? String(tx.transaction_date).trim() : '';
    const m = raw.match(DAY_MONTH_ONLY);
    if (!m) return tx; // đã đủ năm hoặc không parse được → giữ nguyên.

    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return tx;

    let year = inferYearFromPeriod(day, month, startD, endD);
    if (year == null) year = resolveFallbackYear(idx);
    if (year == null) return tx; // không có mốc nào để suy → giữ nguyên.

    const filled = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    return { ...tx, transaction_date: filled };
  });
}

// ─── Aggregation per month ────────────────────────────────────────────────────────

interface MonthAgg {
  monthIndex: number;
  min: number;
  max: number;
  dataPoints: number;
  /** Giao dịch có số dư = max (giữ lần xuất hiện đầu tiên theo thứ tự). */
  maxDate: string | null;
  minDate: string | null;
}

/**
 * Gom giao dịch theo tháng, tính min/max của SỐ DƯ SAU GIAO DỊCH.
 * Bỏ qua giao dịch có balance không parse được, ngày không hợp lệ, hoặc nằm trong
 * excludeIndices (dòng số dư KHÔNG khớp chuỗi — nghi đọc sai, không dùng để tính).
 * Lưu lại ngày phát sinh cực trị (lần đầu xuất hiện giá trị đó).
 */
export function aggregateByMonth(
  transactions: StatementTransaction[],
  excludeIndices?: Set<number>,
): Map<number, MonthAgg> {
  const map = new Map<number, MonthAgg>();

  for (let i = 0; i < transactions.length; i++) {
    if (excludeIndices?.has(i)) continue;
    const tx = transactions[i];
    const d = parseVNDate(tx.transaction_date);
    if (!d) continue;
    const bal = parseAmount(tx.balance);
    if (bal == null) continue;

    const agg = map.get(d.monthIndex);
    if (!agg) {
      map.set(d.monthIndex, {
        monthIndex: d.monthIndex,
        min: bal,
        max: bal,
        dataPoints: 1,
        maxDate: tx.transaction_date,
        minDate: tx.transaction_date,
      });
      continue;
    }
    agg.dataPoints++;
    if (bal > agg.max) {
      agg.max = bal;
      agg.maxDate = tx.transaction_date;
    }
    if (bal < agg.min) {
      agg.min = bal;
      agg.minDate = tx.transaction_date;
    }
  }

  return map;
}

/** SDBQ của một tháng = (min + max) / 2. */
function sdbqOf(agg: MonthAgg): number {
  return (agg.min + agg.max) / 2;
}

// ─── Window selection ──────────────────────────────────────────────────────────────

interface WindowSelection {
  /** Các monthIndex ĐƯỢC CHỌN, đã sort tăng dần theo thời gian. KHÔNG bắt buộc liên tiếp. */
  selectedMonthIndices: number[];
  /** Trung bình SDBQ của các tháng được chọn. */
  avgSdbq: number | null;
  monthsCount: number;
}

/**
 * Chọn tối đa windowSize tháng có SDBQ CAO NHẤT (KHÔNG cần liên tiếp).
 *
 * - Nếu số tháng CÓ DỮ LIỆU ≤ windowSize → lấy hết các tháng có dữ liệu.
 * - Ngược lại → xếp các tháng theo SDBQ giảm dần, lấy top windowSize tháng.
 *   Khi SDBQ bằng nhau, tie-break theo thời gian ('latest' = ưu tiên tháng gần đây).
 * - Kết quả trả về sort tăng dần theo thời gian để hiển thị bảng.
 */
export function selectBestWindow(
  monthAggs: Map<number, MonthAgg>,
  opts: Required<CalcOptions>,
): WindowSelection | null {
  const indices = [...monthAggs.keys()].sort((a, b) => a - b);
  if (indices.length === 0) return null;

  let selected: number[];
  if (indices.length <= opts.windowSize) {
    // ≤ windowSize tháng có dữ liệu → lấy hết.
    selected = indices;
  } else {
    // Xếp theo SDBQ giảm dần (tie-break theo thời gian) → lấy top windowSize tháng.
    const byScore = [...indices].sort((a, b) => {
      const sa = sdbqOf(monthAggs.get(a)!);
      const sb = sdbqOf(monthAggs.get(b)!);
      if (sb !== sa) return sb - sa;
      return opts.tieBreak === 'latest' ? b - a : a - b;
    });
    selected = byScore.slice(0, opts.windowSize).sort((a, b) => a - b);
  }

  const vals = selected.map((i) => sdbqOf(monthAggs.get(i)!));
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { selectedMonthIndices: selected, avgSdbq: avg, monthsCount: selected.length };
}

// ─── OCR success ratio ───────────────────────────────────────────────────────────

interface OcrQuality {
  totalTransactions: number;
  balanceChecked: number;
  balanceConsistent: number;
  balanceConsistencyRatio: number;
  headerCompleteness: number;
  pageParseRatio: number;
  ratio: number;
  /** Các dòng số dư không khớp chuỗi (giới hạn số lượng để tránh payload lớn). */
  breaks: BalanceBreak[];
  /** Chỉ số 0-based MỌI dòng số dư không khớp chuỗi (không giới hạn) — để loại khỏi thống kê. */
  discrepantIndices: Set<number>;
}

/** Số điểm gãy tối đa lưu lại (tránh payload quá lớn khi OCR hỏng nặng). */
const MAX_BALANCE_BREAKS = 200;

interface BalanceChain {
  checked: number;
  consistent: number;
  breaks: BalanceBreak[];
  /** Chỉ số 0-based các dòng số dư KHÔNG khớp chuỗi (đầy đủ, không giới hạn). */
  discrepantIndices: Set<number>;
}

/**
 * Duyệt chuỗi số dư theo thứ tự mảng và đánh dấu dòng KHÔNG khớp:
 *   balance[i] ≈ balance[i-1] + credit − debit − fee − tax (sai số ≤ epsilon).
 * Dòng có balance không parse được sẽ NGẮT chuỗi (không tính là break, không check tiếp
 * cho tới khi gặp balance hợp lệ). Trả về danh sách break (giới hạn payload) và tập
 * chỉ số dòng sai lệch (đầy đủ) để loại khỏi min/max/SDBQ.
 */
function computeBalanceChain(txs: StatementTransaction[], epsilon: number): BalanceChain {
  let checked = 0;
  let consistent = 0;
  const breaks: BalanceBreak[] = [];
  const discrepantIndices = new Set<number>();
  let prev: number | null = null;
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const bal = parseAmount(tx.balance);
    if (bal == null) {
      prev = null; // đứt chuỗi
      continue;
    }
    if (prev != null) {
      const credit = parseAmount(tx.credit) ?? 0;
      const debit = parseAmount(tx.debit) ?? 0;
      const fee = parseAmount(tx.fee_interest) ?? 0;
      const tax = parseAmount(tx.tax) ?? 0;
      const movement = credit - debit - fee - tax;
      const expected = prev + movement;
      const delta = bal - expected;
      checked++;
      if (Math.abs(delta) <= epsilon) {
        consistent++;
      } else {
        discrepantIndices.add(i);
        if (breaks.length < MAX_BALANCE_BREAKS) {
          breaks.push({
            index: i + 1,
            date: tx.transaction_date,
            details: tx.details ? tx.details.slice(0, 80) : null,
            prev_balance: prev,
            movement: round2(movement),
            expected_balance: round2(expected),
            actual_balance: bal,
            delta: round2(delta),
          });
        }
      }
    }
    prev = bal;
  }
  return { checked, consistent, breaks, discrepantIndices };
}

interface BalanceReconstruction {
  transactions: StatementTransaction[];
  /** 'statement' = số dư đọc trực tiếp; 'computed' = tự tính từ số dư đầu kỳ. */
  source: 'statement' | 'computed';
  /** true khi sao kê KHÔNG có số dư VÀ cũng không có số dư đầu kỳ để tính. */
  noBalanceNoOpening: boolean;
}

/**
 * CHỈ khi sao kê HOÀN TOÀN không có trường số dư (mọi dòng đều null/rỗng) mới tự dựng
 * lại số dư sau từng giao dịch từ SỐ DƯ ĐẦU KỲ + biến động (credit − debit − fee − tax).
 * Trả về mảng transaction mới với balance đã điền (không mutate input).
 *
 * - Có ÍT NHẤT 1 dòng in số dư (kể cả giá trị chưa parse được) → giữ nguyên (source='statement').
 * - Hoàn toàn không có trường số dư nhưng có opening_balance → tính (source='computed').
 * - Không có trường số dư và cũng không có opening_balance → giữ nguyên, đánh dấu để cảnh báo.
 */
export function reconstructBalancesIfMissing(
  transactions: StatementTransaction[],
  openingBalance: string | null,
): BalanceReconstruction {
  // CHỈ tự tính khi sao kê HOÀN TOÀN không có trường số dư (mọi dòng đều null/rỗng).
  // Nếu có BẤT KỲ dòng nào in số dư — kể cả giá trị OCR chưa parse được — coi như sao
  // kê ĐÃ có thông tin số dư → giữ nguyên, KHÔNG tự tính đè.
  const hasBalanceField = transactions.some(
    (tx) => tx.balance != null && String(tx.balance).trim() !== '',
  );
  if (hasBalanceField) {
    return { transactions, source: 'statement', noBalanceNoOpening: false };
  }
  if (transactions.length === 0) {
    return { transactions, source: 'statement', noBalanceNoOpening: false };
  }

  const opening = parseAmount(openingBalance);
  if (opening == null) {
    return { transactions, source: 'statement', noBalanceNoOpening: true };
  }

  let running = opening;
  const rebuilt = transactions.map((tx) => {
    const credit = parseAmount(tx.credit) ?? 0;
    const debit = parseAmount(tx.debit) ?? 0;
    const fee = parseAmount(tx.fee_interest) ?? 0;
    const tax = parseAmount(tx.tax) ?? 0;
    running = round2(running + credit - debit - fee - tax);
    // Format theo chuẩn VN (dấu chấm ngăn nghìn, dấu phẩy thập phân) để hiển thị đồng
    // bộ với số dư đọc trực tiếp từ sao kê. parseAmount vẫn parse lại đúng giá trị.
    return { ...tx, balance: formatVNAmount(running) };
  });
  return { transactions: rebuilt, source: 'computed', noBalanceNoOpening: false };
}

/**
 * Định dạng số theo chuẩn Việt Nam: dấu '.' ngăn cách hàng nghìn, dấu ',' cho phần
 * thập phân (chỉ hiện khi khác 0). Thuần tính toán, không phụ thuộc locale/ICU.
 */
function formatVNAmount(n: number): string {
  const rounded = round2(n);
  const neg = rounded < 0;
  const abs = Math.abs(rounded);
  const intPart = Math.floor(abs);
  const cents = Math.round((abs - intPart) * 100);
  let s = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (cents > 0) s += `,${String(cents).padStart(2, '0')}`;
  return (neg ? '-' : '') + s;
}

interface SwapCorrection {
  transactions: StatementTransaction[];
  /** Chỉ số 0-based các dòng đã được đảo cột Nợ/Có. */
  correctedIndexes: number[];
}

/**
 * Sửa các dòng OCR đọc NHẦM cột Nợ/Có, NHẬN DIỆN CHẶT bằng quy tắc số học:
 * khi nhầm cột, số dư đọc được lệch so với kỳ vọng ĐÚNG BẰNG 2× số tiền giao dịch
 * (một khoản đáng lẽ +amt lại tính −amt → lệch 2·amt).
 *
 * CHỈ đảo cột khi:
 *   - Dòng có số dư parse được và có dòng trước để so chuỗi.
 *   - Dòng chỉ có tiền ở ĐÚNG MỘT trong hai cột (Nợ hoặc Có).
 *   - |delta| ≈ 2 × số tiền (trong sai số epsilon) VÀ dấu delta khớp chiều đảo:
 *       delta > 0 (số dư thực CAO hơn kỳ vọng) + dòng đang ghi NỢ → chuyển sang CÓ.
 *       delta < 0 (số dư thực THẤP hơn kỳ vọng) + dòng đang ghi CÓ → chuyển sang NỢ.
 * Mọi trường hợp khác giữ nguyên (không ảnh hưởng). Giữ nguyên CHUỖI số tiền gốc,
 * chỉ chuyển sang cột đúng. Prev dùng để so là SỐ DƯ THỰC (không lan lỗi sang dòng sau).
 */
function correctDebitCreditSwaps(
  transactions: StatementTransaction[],
  epsilon: number,
): SwapCorrection {
  const out = transactions.slice();
  const correctedIndexes: number[] = [];
  let prev: number | null = null;

  for (let i = 0; i < out.length; i++) {
    const tx = out[i];
    const bal = parseAmount(tx.balance);
    if (bal == null) { prev = null; continue; }

    if (prev != null) {
      const credit = parseAmount(tx.credit) ?? 0;
      const debit = parseAmount(tx.debit) ?? 0;
      const fee = parseAmount(tx.fee_interest) ?? 0;
      const tax = parseAmount(tx.tax) ?? 0;
      const movement = credit - debit - fee - tax;
      const delta = bal - (prev + movement);

      const hasDebit = debit !== 0;
      const hasCredit = credit !== 0;
      // Chỉ xét khi lệch VÀ đúng một cột có giá trị.
      if (Math.abs(delta) > epsilon && hasDebit !== hasCredit) {
        const amt = hasDebit ? debit : credit;
        const isTwiceAmount = amt > 0 && Math.abs(Math.abs(delta) - 2 * amt) <= epsilon;
        if (isTwiceAmount && delta > 0 && hasDebit) {
          // Đang ghi NỢ nhưng thực chất là GHI CÓ → đảo sang cột Có (giữ chuỗi gốc).
          out[i] = { ...tx, credit: tx.debit, debit: null };
          correctedIndexes.push(i);
        } else if (isTwiceAmount && delta < 0 && hasCredit) {
          // Đang ghi CÓ nhưng thực chất là GHI NỢ → đảo sang cột Nợ (giữ chuỗi gốc).
          out[i] = { ...tx, debit: tx.credit, credit: null };
          correctedIndexes.push(i);
        }
      }
    }
    prev = bal; // luôn dùng số dư THỰC làm mốc cho dòng kế tiếp.
  }

  return { transactions: out, correctedIndexes };
}

/**
 * Đánh giá chất lượng OCR bằng tín hiệu tự kiểm chứng, không cần đối chiếu ngoài:
 *
 *   1. Balance chain consistency (trọng số 0.6): với các giao dịch liên tiếp,
 *      kỳ vọng  balance[i] ≈ balance[i-1] + credit - debit - fee - tax.
 *      Tỉ lệ dòng thoả trong sai số epsilon phản ánh OCR số có đọc đúng không.
 *   2. Header completeness (0.2): tỉ lệ 6 field header quan trọng đọc được
 *      (customer_name, account_no, bank_name, start, end, currency).
 *   3. Page parse ratio (0.2): tỉ lệ trang OCR ra được ít nhất 1 giao dịch.
 *
 * pageParseRatio truyền vào từ workflow (không suy ra được từ StatementJSON gộp).
 */
export function computeOcrQuality(
  data: StatementJSON,
  pageParseRatio: number,
  epsilon: number,
): OcrQuality {
  const txs = data.transactions;
  const total = txs.length;

  // 1) Balance chain — theo thứ tự mảng (giả định đã sort theo trang/dòng).
  const { checked, consistent, breaks, discrepantIndices } = computeBalanceChain(txs, epsilon);
  const balanceConsistencyRatio = checked > 0 ? consistent / checked : 1;

  // 2) Header completeness.
  const info = data.account_info;
  const headerFields = [
    info.customer_name,
    info.account_no,
    info.bank_name,
    info.statement_start_date,
    info.statement_end_date,
    info.currency,
  ];
  const headerFilled = headerFields.filter((v) => v != null && String(v).trim() !== '').length;
  const headerCompleteness = headerFilled / headerFields.length;

  // 3) Page parse ratio (đã tính ở tầng workflow).
  const pageRatio = clamp01(pageParseRatio);

  const ratio = clamp01(
    0.6 * balanceConsistencyRatio + 0.2 * headerCompleteness + 0.2 * pageRatio,
  );

  return {
    totalTransactions: total,
    balanceChecked: checked,
    balanceConsistent: consistent,
    balanceConsistencyRatio: round4(balanceConsistencyRatio),
    headerCompleteness: round4(headerCompleteness),
    pageParseRatio: round4(pageRatio),
    ratio: round4(ratio),
    breaks,
    discrepantIndices,
  };
}

// ─── Main entry ────────────────────────────────────────────────────────────────────

/**
 * Tính toàn bộ StatementAnalysisResult từ dữ liệu OCR đã gộp.
 * @param pageParseRatio tỉ lệ trang OCR thành công (0..1) — từ workflow.
 */
export function analyzeStatement(
  data: StatementJSON,
  pageParseRatio = 1,
  options: CalcOptions = {},
): StatementAnalysisResult {
  const opts = { ...DEFAULT_OPTS, ...options };
  const info = data.account_info;
  const warnings: string[] = [];

  // Bổ sung năm cho các giao dịch chỉ có ngày/tháng trước khi tính toán & xuất.
  let txs = normalizeTransactionYears(
    data.transactions,
    info.statement_start_date,
    info.statement_end_date,
  );

  // Sửa NHẦM cột Nợ/Có: chỉ áp dụng khi số dư lệch ĐÚNG 2× số tiền giao dịch (dấu hiệu
  // chắc chắn của việc đảo Nợ↔Có). Chạy TRƯỚC reconstruct để chỉ tác động lên sao kê CÓ
  // cột số dư (đối chiếu được); ca không có số dư sẽ không bị ảnh hưởng.
  const swap = correctDebitCreditSwaps(txs, opts.balanceEpsilon);
  txs = swap.transactions;
  if (swap.correctedIndexes.length > 0) {
    warnings.push(
      `${swap.correctedIndexes.length} giao dịch được tự động chỉnh cột Ghi nợ/Ghi có do số dư ` +
        'lệch đúng 2× số tiền (nghi OCR đọc nhầm loại giao dịch); đã đảo về đúng cột.',
    );
  }

  // Sao kê không có cột số dư → tự dựng số dư từ số dư đầu kỳ + biến động.
  const recon = reconstructBalancesIfMissing(txs, data.opening_balance);
  txs = recon.transactions;
  const balanceSource = recon.source;
  if (recon.source === 'computed') {
    warnings.push(
      'Sao kê KHÔNG có cột số dư (Balance). Số dư từng giao dịch là do hệ thống TÍNH TOÁN ' +
        'từ số dư đầu kỳ và biến động ghi nợ/ghi có, KHÔNG phải số dư in trên sao kê.',
    );
    // Đối chiếu với số dư cuối kỳ (nếu có in) để phát hiện bút toán nhầm cột Nợ/Có:
    // một lần nhầm cột làm lệch toàn bộ số dư từ dòng đó đến hết → tổng cuối sẽ sai.
    const closing = parseAmount(data.closing_balance);
    const computedFinal = txs.length > 0 ? parseAmount(txs[txs.length - 1].balance) : null;
    if (closing != null && computedFinal != null && Math.abs(computedFinal - closing) > opts.balanceEpsilon) {
      warnings.push(
        `Số dư cuối kỳ TÍNH TOÁN (${formatVNAmount(computedFinal)}) KHÔNG khớp số dư cuối kỳ ` +
          `in trên sao kê (${formatVNAmount(closing)}), lệch ${formatVNAmount(computedFinal - closing)}. ` +
          'Có thể có bút toán bị nhầm cột Ghi nợ/Ghi có hoặc thiếu dòng — cần kiểm tra lại.',
      );
    }
  } else if (recon.noBalanceNoOpening) {
    warnings.push(
      'Sao kê không có cột số dư và cũng không có số dư đầu kỳ để tính toán — ' +
        'không thể xác định số dư từng giao dịch, kết quả min/max/SDBQ có thể trống.',
    );
  }

  // Ghi chú OCR (trang bị bỏ qua vì gấp góc / đóng dấu MẪU...) → hiển thị cho user.
  for (const n of data.ocr_notes || []) {
    const note = String(n).trim();
    if (note) warnings.push(note);
  }

  const normalizedData: StatementJSON = { ...data, transactions: txs };

  // ── OCR quality + xác định dòng số dư sai lệch (loại khỏi thống kê) ──
  const quality = computeOcrQuality(normalizedData, pageParseRatio, opts.balanceEpsilon);

  // ── Aggregation + chọn chu kỳ (CHỈ dùng các dòng đã qua kiểm tra số dư) ──
  const monthAggs = aggregateByMonth(txs, quality.discrepantIndices);
  const window = selectBestWindow(monthAggs, opts);

  const monthlyBalances: MonthlyBalance[] = [];
  let monthOfMax: string | null = null;
  let monthOfMin: string | null = null;
  let timeOfMax: string | null = null;
  let timeOfMin: string | null = null;
  let maxValue: number | null = null;
  let minValue: number | null = null;

  if (window) {
    // Chỉ duyệt các tháng ĐƯỢC CHỌN (đã sort tăng dần). Không chèn tháng trống vì
    // các tháng được chọn theo SDBQ nên luôn có dữ liệu.
    for (const mi of window.selectedMonthIndices) {
      const agg = monthAggs.get(mi)!;
      monthlyBalances.push({
        month: monthKeyFromIndex(mi),
        min_balance: agg.min,
        min_balance_date: agg.minDate,
        max_balance: agg.max,
        max_balance_date: agg.maxDate,
        sdbq: sdbqOf(agg),
        data_points: agg.dataPoints,
      });
      if (maxValue == null || agg.max > maxValue) {
        maxValue = agg.max;
        monthOfMax = monthKeyFromIndex(mi);
        timeOfMax = agg.maxDate;
      }
      if (minValue == null || agg.min < minValue) {
        minValue = agg.min;
        monthOfMin = monthKeyFromIndex(mi);
        timeOfMin = agg.minDate;
      }
    }
  }

  // ── Thống kê toàn file ──
  const totalDays = computeTotalDays(info.statement_start_date, info.statement_end_date, txs);
  const startBalance = parseAmount(data.opening_balance);
  const endBalance = parseAmount(data.closing_balance);

  return {
    ocr_success_ratio: quality.ratio,
    balance_source: balanceSource,
    warnings,

    customer_name: info.customer_name,
    account_no: info.account_no,
    bank_name: info.bank_name,
    statement_start_date: info.statement_start_date,
    statement_end_date: info.statement_end_date,

    total_pages: info.total_pages_label,
    total_days: totalDays,
    total_transactions: txs.length,
    account_start_balance: startBalance,
    account_end_balance: endBalance,

    selected_window: {
      start_month: window ? monthKeyFromIndex(window.selectedMonthIndices[0]) : null,
      end_month: window
        ? monthKeyFromIndex(window.selectedMonthIndices[window.selectedMonthIndices.length - 1])
        : null,
      avg_sdbq: window ? window.avgSdbq : null,
      months_count: window ? window.monthsCount : 0,
    },
    monthly_balances: monthlyBalances,

    month_of_max_balance: monthOfMax,
    month_of_min_balance: monthOfMin,
    time_of_max_balance: timeOfMax,
    time_of_min_balance: timeOfMin,
    max_balance_value: maxValue,
    min_balance_value: minValue,

    data_raw: txs,

    ocr_quality_detail: {
      total_transactions: quality.totalTransactions,
      balance_checked: quality.balanceChecked,
      balance_consistent: quality.balanceConsistent,
      balance_consistency_ratio: quality.balanceConsistencyRatio,
      header_completeness: quality.headerCompleteness,
      page_parse_ratio: quality.pageParseRatio,
      balance_breaks: quality.breaks,
      balance_excluded_indexes: [...quality.discrepantIndices].map((index) => index + 1),
    },
  };
}

/**
 * Tổng số ngày sao kê (bao gồm cả ngày đầu & ngày cuối → +1).
 * Ưu tiên khoảng ngày ghi ở header; nếu thiếu, suy ra từ ngày giao dịch min/max.
 */
export function computeTotalDays(
  startDate: string | null,
  endDate: string | null,
  transactions: StatementTransaction[],
): number | null {
  let start = parseVNDate(startDate);
  let end = parseVNDate(endDate);

  if (!start || !end) {
    // Suy ra từ giao dịch.
    let minEpoch = Infinity;
    let maxEpoch = -Infinity;
    for (const tx of transactions) {
      const d = parseVNDate(tx.transaction_date);
      if (!d) continue;
      if (d.epochDay < minEpoch) minEpoch = d.epochDay;
      if (d.epochDay > maxEpoch) maxEpoch = d.epochDay;
    }
    if (minEpoch === Infinity) return null;
    return maxEpoch - minEpoch + 1;
  }

  return end.epochDay - start.epochDay + 1;
}

// ─── small utils ────────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
