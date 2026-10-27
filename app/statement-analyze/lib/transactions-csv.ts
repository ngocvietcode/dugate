// app/statement-analyze/lib/transactions-csv.ts
// Convert data_raw (StatementTransaction[]) → CSV gọn để nạp vào prompt Q&A.
// - Bỏ HẲN các cột mà MỌI dòng đều null/rỗng (giảm token).
// - Giữ nguyên chuỗi số tiền như in (để LLM thấy đúng giá trị gốc).
// - Escape đúng chuẩn CSV (dấu phẩy, nháy kép, xuống dòng).

import type { StatementTransaction } from '@/lib/pipelines/workflows/prompts/statement-analyze-prompts';

const COLUMNS: Array<{ key: keyof StatementTransaction; header: string }> = [
  { key: 'transaction_date', header: 'ngay' },
  { key: 'transaction_no', header: 'so_ct' },
  { key: 'remitter', header: 'doi_tac' },
  { key: 'remitter_bank', header: 'nh_doi_tac' },
  { key: 'details', header: 'noi_dung' },
  { key: 'debit', header: 'ghi_no' },
  { key: 'credit', header: 'ghi_co' },
  { key: 'fee_interest', header: 'phi_lai' },
  { key: 'tax', header: 'thue' },
  { key: 'balance', header: 'so_du' },
];

function isFilled(v: unknown): boolean {
  return v != null && String(v).trim() !== '';
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/**
 * Trả về CSV có header + cột STT (1-based, khớp index dòng để dễ tham chiếu).
 * Chỉ giữ các cột có ít nhất 1 giá trị. Trả '' nếu không có giao dịch.
 */
export function transactionsToCsv(txs: StatementTransaction[] | null | undefined): string {
  if (!Array.isArray(txs) || txs.length === 0) return '';

  const active = COLUMNS.filter(({ key }) => txs.some((t) => isFilled(t[key])));
  if (active.length === 0) return '';

  const header = ['stt', ...active.map((c) => c.header)].join(',');
  const rows = txs.map((t, i) => {
    const cells = active.map((c) => {
      const v = t[c.key];
      return isFilled(v) ? csvEscape(String(v).trim()) : '';
    });
    return [String(i + 1), ...cells].join(',');
  });
  return [header, ...rows].join('\n');
}
