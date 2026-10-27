'use client';

// Primitive dùng chung cho hai workspace giai đoạn (tiếp nhận hồ sơ và đánh giá).
// Tách riêng để không nhân bản style/nhãn giữa các file.

import React from 'react';
import { CheckCircle2, Circle, CircleAlert, FileCheck2, XCircle } from 'lucide-react';
import type {
  AccountOpeningResult,
  AssessmentStatus,
  ChecklistItemResult,
  ClassifiedDoc,
  DueDiligenceLevel,
  MetricResult,
  RiskLevel,
} from '../types';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export const SURFACE = 'rounded-3xl border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,.08)]';

export function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function statusToneClass(tone: StatusTone): string {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (tone === 'info') return 'border-cyan-200 bg-cyan-50 text-cyan-800';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusToneClass(tone)}`}>{label}</span>;
}

export function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-xs font-semibold text-slate-800">{value}</p>
    </div>
  );
}

export function EmptyInline({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-600"><Icon className="h-4 w-4" />{text}</div>;
}

export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
      <p className="text-[9px] leading-3 text-slate-600">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}

// ─── Định dạng giá trị nghiệp vụ ─────────────────────────────────────────────

export function formatCurrency(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Chưa đủ dữ liệu' : `${new Intl.NumberFormat('vi-VN').format(value)} đ`;
}

/**
 * Hiển thị một chỉ tiêu điều kiện. NOT_APPLICABLE và INSUFFICIENT_DATA phải đọc
 * ra khác nhau: một cái là "không áp dụng cho phân khúc", cái kia là "thiếu dữ liệu".
 */
export function formatMetric(metric: MetricResult | undefined): string {
  if (!metric) return '—';
  if (metric.status === 'NOT_APPLICABLE') return 'Không áp dụng';
  if (metric.status !== 'CALCULATED' || metric.value === null) return 'Chưa đủ dữ liệu';
  const value = metric.value;
  if (metric.unit === 'VND') return `${new Intl.NumberFormat('vi-VN').format(value)} đ`;
  if (metric.unit === 'PERCENT') return `${Math.round(value)}%`;
  if (metric.unit === 'YEARS') return `${value} tuổi`;
  if (metric.unit === 'MONTHS') return `${value} tháng`;
  if (metric.unit === 'DAYS') return value < 0 ? `Hết hạn ${Math.abs(value)} ngày` : `Còn ${value} ngày`;
  if (metric.unit === 'COUNT') return `${value} người`;
  return String(value);
}

export function metricTone(metric: MetricResult | undefined): StatusTone {
  if (!metric) return 'neutral';
  if (metric.status === 'NOT_APPLICABLE') return 'neutral';
  if (metric.status !== 'CALCULATED') return 'warning';
  // Giấy tờ đã hết hạn là vấn đề chặn, phải nổi bật khác với "thiếu dữ liệu".
  if (metric.unit === 'DAYS' && (metric.value ?? 0) < 0) return 'danger';
  return 'success';
}

const RISK_META: Record<RiskLevel, { label: string; tone: StatusTone }> = {
  LOW: { label: 'Rủi ro thấp', tone: 'success' },
  MEDIUM: { label: 'Rủi ro trung bình', tone: 'warning' },
  HIGH: { label: 'Rủi ro cao', tone: 'danger' },
  UNDETERMINED: { label: 'Chưa xác định', tone: 'neutral' },
};

export function riskMeta(level: RiskLevel | undefined): { label: string; tone: StatusTone } {
  return RISK_META[level ?? 'UNDETERMINED'];
}

const DUE_DILIGENCE_META: Record<DueDiligenceLevel, { label: string; caption: string; tone: StatusTone }> = {
  SDD: { label: 'Rà soát đơn giản (SDD)', caption: 'Hồ sơ rủi ro thấp, đủ căn cứ', tone: 'success' },
  CDD: { label: 'Rà soát chuẩn (CDD)', caption: 'Mức rà soát mặc định', tone: 'info' },
  EDD: { label: 'Rà soát tăng cường (EDD)', caption: 'Phải rà soát sâu trước khi kích hoạt', tone: 'warning' },
};

export function dueDiligenceMeta(level: DueDiligenceLevel | undefined): { label: string; caption: string; tone: StatusTone } {
  return DUE_DILIGENCE_META[level ?? 'CDD'];
}

export function assessmentTone(status: AssessmentStatus | undefined): StatusTone {
  if (status === 'PASS') return 'success';
  if (status === 'FAIL') return 'danger';
  if (status === 'REVIEW' || status === 'PASS_WITH_CONDITIONS') return 'warning';
  return 'neutral';
}

export function assessmentLabel(status: AssessmentStatus | undefined): string {
  if (status === 'PASS') return 'Đạt';
  if (status === 'FAIL') return 'Không đạt';
  if (status === 'REVIEW') return 'Cần rà soát';
  if (status === 'PASS_WITH_CONDITIONS') return 'Đạt có điều kiện';
  return 'Không áp dụng';
}

const RULE_RESULT_META: Record<string, { label: string; tone: StatusTone }> = {
  PASS: { label: 'Đạt', tone: 'success' },
  FAIL: { label: 'Không đạt', tone: 'danger' },
  REVIEW: { label: 'Cần rà soát', tone: 'warning' },
  INSUFFICIENT_DATA: { label: 'Thiếu dữ liệu', tone: 'warning' },
  NOT_RUN: { label: 'Chưa chạy', tone: 'neutral' },
  NOT_APPLICABLE: { label: 'Không áp dụng', tone: 'neutral' },
};

export function ruleResultMeta(result: string | undefined): { label: string; tone: StatusTone } {
  return RULE_RESULT_META[result ?? ''] ?? { label: humanizeKey(result ?? ''), tone: 'neutral' };
}

const READINESS_META: Record<string, { label: string; tone: StatusTone; headline: string }> = {
  READY_FOR_ASSESSMENT: {
    label: 'Đủ điều kiện đánh giá',
    tone: 'success',
    headline: 'Hồ sơ đã đủ chứng từ và dữ liệu để đánh giá mở tài khoản',
  },
  NEEDS_DOCUMENTS: {
    label: 'Cần bổ sung',
    tone: 'warning',
    headline: 'Hồ sơ còn thiếu chứng từ bắt buộc của phân khúc',
  },
  NEEDS_VERIFICATION: {
    label: 'Cần xác minh',
    tone: 'warning',
    headline: 'Hồ sơ cần làm rõ một số chứng từ hoặc dữ liệu',
  },
  NOT_PROCESSABLE: {
    label: 'Không xử lý được',
    tone: 'danger',
    headline: 'Không đọc được dữ liệu từ bộ hồ sơ',
  },
};

export function readinessMeta(status: string | undefined): { label: string; tone: StatusTone; headline: string } {
  return READINESS_META[status ?? ''] ?? {
    label: 'Chưa xác định',
    tone: 'neutral',
    headline: 'Chưa có kết quả tiếp nhận hồ sơ',
  };
}

const REVIEW_ROUTE_META: Record<string, { label: string; caption: string; tone: StatusTone }> = {
  STRAIGHT_THROUGH: { label: 'Xử lý tự động', caption: 'Không cần can thiệp thủ công', tone: 'success' },
  KYC_REVIEW: { label: 'Chuyển KYC rà soát', caption: 'Chuyên viên KYC kiểm tra lại hồ sơ', tone: 'warning' },
  COMPLIANCE_REVIEW: { label: 'Chuyển Tuân thủ', caption: 'Bộ phận tuân thủ xử lý trước khi mở', tone: 'danger' },
  REQUEST_DOCUMENTS: { label: 'Yêu cầu bổ sung hồ sơ', caption: 'Liên hệ khách hàng hoàn thiện chứng từ', tone: 'warning' },
};

export function reviewRouteMeta(route: string | undefined): { label: string; caption: string; tone: StatusTone } {
  return REVIEW_ROUTE_META[route ?? ''] ?? { label: 'Chưa xác định', caption: 'Chưa có tuyến xử lý', tone: 'neutral' };
}

const RECOMMENDATION_META: Record<string, { label: string; tone: StatusTone }> = {
  ELIGIBLE_TO_OPEN: { label: 'Đủ điều kiện mở', tone: 'success' },
  REFER: { label: 'Chuyển rà soát', tone: 'warning' },
  INSUFFICIENT_DATA: { label: 'Chưa đủ dữ liệu', tone: 'neutral' },
};

export function recommendationMeta(value: string | undefined): { label: string; tone: StatusTone } {
  return RECOMMENDATION_META[value ?? ''] ?? { label: 'Chưa có kết luận', tone: 'neutral' };
}

// ─── Checklist chứng từ ───────────────────────────────────────────────────────

export function filesForKey(
  key: string,
  classification: ClassifiedDoc[] | null,
  result: AccountOpeningResult | null,
): string[] {
  const resultItem = safeArray(result?.checklist).find((item) => item.key === key);
  if (resultItem) return resultItem.found_in ?? [];
  return safeArray(classification)
    .filter((document) => document.matches?.some((match) => match.key === key))
    .map((document) => document.file_name);
}

export function checklistTone(status: ChecklistItemResult['status'] | undefined): StatusTone {
  if (status === 'present') return 'success';
  if (status === 'missing') return 'danger';
  if (status === 'review') return 'warning';
  return 'neutral';
}

export function checklistStatusLabel(status: ChecklistItemResult['status'] | undefined, hasFile: boolean): string {
  if (status === 'present') return 'Đã có';
  if (status === 'missing') return 'Thiếu';
  if (status === 'review') return 'Cần rà soát';
  return hasFile ? 'Đã nhận tài liệu' : 'Chưa có';
}

export function ChecklistStatusIcon({ status, hasFile }: { status?: ChecklistItemResult['status']; hasFile: boolean }) {
  if (status === 'present') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === 'missing') return <XCircle className="h-4 w-4 text-rose-600" />;
  if (status === 'review') return <CircleAlert className="h-4 w-4 text-amber-700" />;
  if (hasFile) return <FileCheck2 className="h-4 w-4 text-cyan-700" />;
  return <Circle className="h-4 w-4 text-slate-400" />;
}

// ─── Nhãn nghiệp vụ cho reason code ──────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  DOSSIER_SUPPLEMENT_REQUIRED: 'Cần bổ sung hồ sơ trước khi kết luận',
  DOSSIER_READINESS_UNKNOWN: 'Chưa xác định được mức sẵn sàng của hồ sơ',
  REQUIRED_DOCUMENTS_MISSING: 'Thiếu chứng từ bắt buộc của phân khúc',
  REQUIRED_DOCUMENTS_INCOMPLETE: 'Chứng từ bắt buộc chưa hoàn tất',
  DOCUMENTS_NEED_REVIEW: 'Có chứng từ cần rà soát lại',
  UNCLASSIFIED_DOCUMENTS: 'Có tài liệu chưa nhận dạng được loại',
  EXTRACTION_ERRORS: 'Có tài liệu không đọc được dữ liệu',
  CROSS_DOCUMENT_CONFLICT: 'Dữ liệu giữa các chứng từ không khớp',
  POLICY_REVIEW_REQUIRED: 'Có tiêu chí policy cần rà soát',
  CDD_REVIEW_REQUIRED: 'Kết quả rà soát khách hàng cần xem lại',
  ENHANCED_DUE_DILIGENCE_REQUIRED: 'Phải rà soát tăng cường (EDD)',
  IDENTITY_DATA_INSUFFICIENT: 'Thiếu dữ liệu định danh chủ tài khoản',
  SCREENING_PROVIDER_NOT_CONFIGURED: 'Chưa cấu hình hệ thống sàng lọc danh sách cảnh báo',
  EDD_SCREENING_REQUIRED: 'Cần sàng lọc bổ sung theo yêu cầu EDD',
  ID_DOCUMENT_EXPIRED: 'Giấy tờ định danh đã hết hạn',
  ID_VALIDITY_BELOW_MINIMUM: 'Hiệu lực giấy tờ còn lại dưới mức yêu cầu',
  ID_EXPIRY_NOT_FOUND: 'Không đọc được ngày hết hạn giấy tờ',
  APPLICANT_BELOW_MINIMUM_AGE: 'Chủ tài khoản chưa đủ tuổi',
  APPLICANT_ABOVE_MAXIMUM_AGE: 'Chủ tài khoản vượt tuổi tối đa',
  DATE_OF_BIRTH_MISSING: 'Không xác định được ngày sinh',
  BENEFICIAL_OWNER_DISCLOSURE_INCOMPLETE: 'Kê khai chủ sở hữu hưởng lợi chưa đủ',
  BENEFICIAL_OWNER_DECLARATION_MISSING: 'Thiếu kê khai chủ sở hữu hưởng lợi',
  SIGNATORY_COUNT_BELOW_MINIMUM: 'Chưa đủ người ký đăng ký trên tài khoản',
  SIGNATORY_LIST_MISSING: 'Không đọc được danh sách người ký',
};

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? humanizeKey(reason.replace(/^[A-Z_]+:/, ''));
}
