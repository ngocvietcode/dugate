// app/statement-analyze/lib/risk-flags.ts
// Phát hiện dấu hiệu rủi ro TẤT ĐỊNH (client-side, thuần, không AI) từ data_raw.
// Mục tiêu: hỗ trợ chuyên gia rủi ro soi nhanh — mọi phát hiện đều truy ngược được
// về dòng giao dịch cụ thể (txIndexes 1-based). Đây là TÍN HIỆU để rà, không phải kết luận.

import { parseVndAmount, parseDMY } from './money';

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface RiskFinding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** STT (1-based) các dòng liên quan trong data_raw. */
  txIndexes?: number[];
}

export interface TopTxn {
  index: number;          // 1-based
  date: string | null;
  direction: 'in' | 'out';
  amount: number;
  details: string | null;
}

export interface RiskReport {
  findings: RiskFinding[];
  topInflows: TopTxn[];
  topOutflows: TopTxn[];
  totals: { inflow: number; outflow: number; net: number; txCount: number };
}

interface TxLike {
  transaction_date?: string | null;
  details?: string | null;
  debit?: string | null;
  credit?: string | null;
}

interface AnalysisLike {
  data_raw?: TxLike[];
  statement_end_date?: string | null;
  balance_source?: 'statement' | 'computed';
  ocr_success_ratio?: number;
  ocr_quality_detail?: { balance_breaks?: Array<{ index: number }> };
  fraud_detection?: {
    findings?: Array<{
      id: string;
      severity: Severity;
      title: string;
      detail: string;
      txIndexes?: number[];
    }>;
  };
}

// ─── Ngưỡng heuristic (có thể chỉnh) ────────────────────────────────────────────
const ROUND_MIN = 10_000_000;          // Số tròn "lớn" đáng chú ý (≥ 10 triệu)
const ROUND_UNIT = 1_000_000;          // Tròn tới hàng triệu
const HIGH_VELOCITY_PER_DAY = 10;      // Số GD/ngày coi là mật độ cao
const PASSTHROUGH_LOOKAHEAD = 3;       // Số dòng nhìn trước để bắt vào–ra nhanh
const PASSTHROUGH_DAY_GAP = 1;         // Chênh lệch ngày tối đa (vào rồi ra)
const PASSTHROUGH_TOL_RATE = 0.01;     // Sai số khớp số tiền (1%)
const WINDOW_DRESSING_DAYS = 3;        // "Bơm" số dư sát cuối kỳ (≤ 3 ngày cuối)
const TOP_N = 5;

interface Row {
  index: number;      // 1-based
  date: string | null;
  epochDay: number | null;
  debit: number;      // 0 nếu không có
  credit: number;     // 0 nếu không có
  details: string | null;
}

function buildRows(txs: TxLike[]): Row[] {
  return txs.map((t, i) => {
    const d = parseDMY(t.transaction_date ?? null);
    return {
      index: i + 1,
      date: t.transaction_date ?? null,
      epochDay: d ? d.epochDay : null,
      debit: parseVndAmount(t.debit ?? null) ?? 0,
      credit: parseVndAmount(t.credit ?? null) ?? 0,
      details: t.details ?? null,
    };
  });
}

function isRound(amount: number): boolean {
  return amount >= ROUND_MIN && amount % ROUND_UNIT === 0;
}

export function computeRiskReport(analysis: AnalysisLike | null | undefined): RiskReport {
  const txs = Array.isArray(analysis?.data_raw) ? analysis!.data_raw! : [];
  const rows = buildRows(txs);

  const findings: RiskFinding[] = [];
  const hasServerFraud = !!analysis?.fraud_detection;

  // ── Tổng dòng tiền ──
  let inflow = 0;
  let outflow = 0;
  for (const r of rows) { inflow += r.credit; outflow += r.debit; }
  const totals = { inflow, outflow, net: inflow - outflow, txCount: rows.length };

  // ── Top giao dịch vào/ra ──
  const topInflows: TopTxn[] = rows
    .filter((r) => r.credit > 0)
    .sort((a, b) => b.credit - a.credit)
    .slice(0, TOP_N)
    .map((r) => ({ index: r.index, date: r.date, direction: 'in', amount: r.credit, details: r.details }));
  const topOutflows: TopTxn[] = rows
    .filter((r) => r.debit > 0)
    .sort((a, b) => b.debit - a.debit)
    .slice(0, TOP_N)
    .map((r) => ({ index: r.index, date: r.date, direction: 'out', amount: r.debit, details: r.details }));

  // ── 1. Số tròn lớn (nghi chia nhỏ / cấu trúc hoá) ──
  const roundIdx = rows.filter((r) => isRound(r.debit) || isRound(r.credit)).map((r) => r.index);
  if (roundIdx.length > 0) {
    findings.push({
      id: 'round-amounts',
      severity: roundIdx.length >= 5 ? 'medium' : 'low',
      title: `Giao dịch số tròn lớn (${roundIdx.length})`,
      detail: `Có ${roundIdx.length} giao dịch số tiền tròn ≥ ${ROUND_MIN.toLocaleString('vi-VN')} (chia hết ${ROUND_UNIT.toLocaleString('vi-VN')}). Cần soi khả năng chia nhỏ / cấu trúc hoá giao dịch.`,
      txIndexes: roundIdx,
    });
  }

  // ── 2. Ngày mật độ cao ──
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.date) continue;
    const arr = byDay.get(r.date) ?? [];
    arr.push(r.index);
    byDay.set(r.date, arr);
  }
  const busyDays = [...byDay.entries()].filter(([, idx]) => idx.length >= HIGH_VELOCITY_PER_DAY);
  if (busyDays.length > 0) {
    const allIdx = busyDays.flatMap(([, idx]) => idx);
    const dayList = busyDays.map(([d, idx]) => `${d} (${idx.length} GD)`).join('; ');
    findings.push({
      id: 'high-velocity',
      severity: 'medium',
      title: `Ngày mật độ giao dịch cao (${busyDays.length} ngày)`,
      detail: `Các ngày dồn nhiều giao dịch: ${dayList}. Có thể là hoạt động luân chuyển tiền dày đặc.`,
      txIndexes: allIdx,
    });
  }

  // ── 3. Vào–ra nhanh (pass-through) ──
  const passIdx: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const inRow = rows[i];
    if (inRow.credit <= 0) continue;
    for (let j = i + 1; j <= Math.min(i + PASSTHROUGH_LOOKAHEAD, rows.length - 1); j++) {
      const outRow = rows[j];
      if (outRow.debit <= 0) continue;
      const tol = Math.max(1000, inRow.credit * PASSTHROUGH_TOL_RATE);
      const amountClose = Math.abs(outRow.debit - inRow.credit) <= tol;
      const dayClose = inRow.epochDay != null && outRow.epochDay != null
        ? Math.abs(outRow.epochDay - inRow.epochDay) <= PASSTHROUGH_DAY_GAP
        : true;
      if (amountClose && dayClose) {
        passIdx.push(inRow.index, outRow.index);
        break;
      }
    }
  }
  if (!hasServerFraud && passIdx.length > 0) {
    const uniq = [...new Set(passIdx)].sort((a, b) => a - b);
    findings.push({
      id: 'pass-through',
      severity: 'medium',
      title: `Dòng tiền vào–ra nhanh (${uniq.length} dòng)`,
      detail: `Phát hiện tiền vào rồi ra gần bằng trong ≤ ${PASSTHROUGH_DAY_GAP + 1} ngày — dấu hiệu tài khoản trung chuyển (pass-through). Cần đối chiếu mục đích.`,
      txIndexes: uniq,
    });
  }

  // ── 4. Bơm số dư sát cuối kỳ (window dressing) ──
  const end = parseDMY(analysis?.statement_end_date ?? null);
  if (!hasServerFraud && end && topInflows.length > 0) {
    const nearEndBigIn = rows.filter((r) =>
      r.credit > 0 &&
      r.epochDay != null &&
      r.epochDay >= end.epochDay - WINDOW_DRESSING_DAYS &&
      r.epochDay <= end.epochDay &&
      r.credit >= topInflows[0].amount * 0.5, // đủ lớn (≥ 50% khoản vào lớn nhất)
    ).map((r) => r.index);
    if (nearEndBigIn.length > 0) {
      findings.push({
        id: 'window-dressing',
        severity: 'medium',
        title: `Dòng tiền vào lớn sát cuối kỳ (${nearEndBigIn.length})`,
        detail: `Có khoản tiền vào lớn trong ${WINDOW_DRESSING_DAYS} ngày cuối kỳ sao kê — cần kiểm tra khả năng "làm đẹp" số dư (window dressing).`,
        txIndexes: nearEndBigIn,
      });
    }
  }

  // ── 5. Chất lượng dữ liệu ảnh hưởng độ tin cậy phân tích ──
  const breaks = analysis?.ocr_quality_detail?.balance_breaks;
  if (!hasServerFraud && Array.isArray(breaks) && breaks.length > 0) {
    findings.push({
      id: 'balance-breaks',
      severity: 'high',
      title: `Số dư không khớp chuỗi (${breaks.length} dòng)`,
      detail: `${breaks.length} dòng có số dư lệch so với chuỗi tính toán — nghi OCR đọc sai chữ số hoặc thiếu dòng. Số liệu phân tích có thể sai; cần đối chiếu bản gốc.`,
      txIndexes: breaks.map((b) => b.index),
    });
  }
  if (analysis?.balance_source === 'computed') {
    findings.push({
      id: 'computed-balance',
      severity: 'medium',
      title: 'Số dư do hệ thống tính',
      detail: 'Sao kê không có cột số dư — số dư được tính từ số dư đầu kỳ và biến động. Các chỉ số dựa trên số dư là ước tính.',
    });
  }
  const ocr = analysis?.ocr_success_ratio;
  if (typeof ocr === 'number' && ocr < 0.8) {
    findings.push({
      id: 'low-ocr',
      severity: ocr < 0.6 ? 'high' : 'medium',
      title: `Chất lượng OCR thấp (${Math.round(ocr * 100)}%)`,
      detail: 'Độ tin cậy OCR thấp — dữ liệu trích xuất có thể thiếu/sai. Cần kiểm tra kỹ trước khi kết luận.',
    });
  }

  // Server-side findings là artifact có version/evidence; ưu tiên chúng khi trùng id,
  // đồng thời giữ các heuristic UI cũ để tương thích với kết quả Operation trước đây.
  for (const serverFinding of analysis?.fraud_detection?.findings ?? []) {
    const existingIndex = findings.findIndex((item) => item.id === serverFinding.id);
    const normalized: RiskFinding = {
      id: serverFinding.id,
      severity: serverFinding.severity,
      title: serverFinding.title,
      detail: serverFinding.detail,
      txIndexes: serverFinding.txIndexes,
    };
    if (existingIndex >= 0) findings[existingIndex] = normalized;
    else findings.push(normalized);
  }

  // Sắp theo mức độ nghiêm trọng.
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return { findings, topInflows, topOutflows, totals };
}
