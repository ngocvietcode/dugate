// T-FS-04 (D-109): gộp `s3_matcher_summary` của nhiều Operation. Chỉ số đếm và mã; không chiếu trường văn bản nào ra báo cáo.
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
const id = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v) ? v : 'INVALID_ID');

export const FS_COUNTS = ['parties', 'same', 'rules_only', 'fs_only', 'different_person', 'fs_possible', 'fs_ambiguous'] as const;
export type FsCounts = Record<(typeof FS_COUNTS)[number], number>;
export interface FsRow { operation: string; params_version: string; counts: FsCounts | null }

export function parseOperations(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => id(v) === 'INVALID_ID')) throw new Error('operations must be an array of identifier-only operation ids');
  return value as string[];
}

/** Một Operation: vắng `s3_matcher_summary` (chạy `rules`, chưa xong, kết quả cũ) → `counts = null`. */
export function readOperation(operation: string, raw: unknown): FsRow {
  const op = obj(raw);
  const summary = obj(obj(obj(op.result).extracted_data).s3_matcher_summary);
  if (obj(op.metadata).state !== 'SUCCEEDED' || summary.mode !== 'shadow') return { operation, params_version: 'NONE', counts: null };
  return { operation, params_version: id(summary.params_version), counts: Object.fromEntries(FS_COUNTS.map((k) => [k, count(summary[k])])) as FsCounts };
}

export function renderFsReport(rows: readonly FsRow[]) {
  const used = rows.filter((r): r is FsRow & { counts: FsCounts } => r.counts !== null);
  const total = Object.fromEntries(FS_COUNTS.map((k) => [k, used.reduce((n, r) => n + r.counts[k], 0)])) as FsCounts;
  const versions = [...new Set(used.map((r) => r.params_version))];
  const header = `| operation | params_version | ${FS_COUNTS.join(' | ')} |`;
  const markdown = [
    '# Fellegi-Sunter shadow report',
    '',
    `Operations: ${rows.length}; with shadow summary: ${used.length}; params_version: ${versions.join(', ') || 'none'}`,
    '',
    header,
    `|${' --- |'.repeat(FS_COUNTS.length + 2)}`,
    ...rows.map((r) => `| ${r.operation} | ${r.params_version} | ${FS_COUNTS.map((k) => (r.counts ? r.counts[k] : '-')).join(' | ')} |`),
    `| TOTAL | ${versions.length === 1 ? versions[0] : 'MIXED'} | ${FS_COUNTS.map((k) => total[k]).join(' | ')} |`,
    '',
  ].join('\n');
  const csv = [['operation', 'params_version', ...FS_COUNTS].join(','), ...rows.map((r) => [r.operation, r.params_version, ...FS_COUNTS.map((k) => (r.counts ? r.counts[k] : ''))].join(','))].join('\n') + '\n';
  return { total, markdown, csv };
}
