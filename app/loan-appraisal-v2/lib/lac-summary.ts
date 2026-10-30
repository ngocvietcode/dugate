import type { LoanApplicationContextSummary } from '@/lib/pipelines/workflows/loan-appraisal/types';

export interface LacSummaryView {
  rows: Array<{ label: string; value: string }>;
  gaps: string[];
}

const GAP_LABELS: Record<string, string> = {
  NO_LOAN_APPLICATION: 'Không có giấy đề nghị vay đọc được',
  S3_UNAVAILABLE: 'Chưa gom được người & tài sản',
  PARTY_NOT_MAPPED: 'Người trên chứng từ chưa gắn được vào hồ sơ',
  ASSET_NOT_MAPPED: 'Tài sản trên chứng từ chưa gắn được vào hồ sơ',
  EVIDENCE_READ_ERROR: 'Chứng từ không đọc được',
  SUPERSEDED_EVIDENCE: 'Bản đã bị thay thế bởi bản mới hơn',
  LOAN_APPLICATION_DUPLICATE: 'Nhiều giấy đề nghị vay ghi khác nhau về khoản vay',
};

export function lacSummaryView(summary?: LoanApplicationContextSummary | null): LacSummaryView | null {
  if (!summary) return null;
  return {
    rows: [
      { label: 'Phiên bản', value: summary.lac_version },
      { label: 'Đã dùng trong prompt', value: summary.used_in_prompt ? 'Có' : 'Không' },
      { label: 'Mã nguồn dữ liệu', value: summary.source_hash.slice(0, 12) },
      { label: 'Số dữ kiện', value: String(summary.fact_count) },
      { label: 'Số dữ kiện đưa vào prompt', value: summary.rendered_fact_count === null ? 'Không áp dụng' : String(summary.rendered_fact_count) },
      { label: 'Số mâu thuẫn', value: String(summary.conflicts) },
    ],
    gaps: summary.gaps.map(({ code, count }) => `${Object.prototype.hasOwnProperty.call(GAP_LABELS, code) ? GAP_LABELS[code] : code}: ${count}`),
  };
}
