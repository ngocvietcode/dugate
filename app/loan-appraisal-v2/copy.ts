// Chuỗi tiếng Việt và nhãn enum của v2. Repo chưa có framework i18n; gom về một chỗ để dễ chuyển sau.

import type { ParticipantRole } from '@/app/loan-appraisal/types';
import type { RunPhase } from './lib/run-reducer';
import { humanizeKey } from './lib/selectors';

export const COPY = {
  appName: 'Thẩm định hồ sơ vay',
  appSub: 'DUGATE Credit Intelligence',
  version: 'Phiên bản 2',
  skipToContent: 'Bỏ qua điều hướng, tới nội dung chính',
  quickRun: 'Nhập API key và tải ít nhất một tài liệu để bắt đầu.',
  stalledTitle: 'Đã ngừng tự động theo dõi sau 60 phút',
  stalledBody: 'Workflow có thể vẫn đang chạy trên máy chủ. Bấm "Mở lại kết quả" để kiểm tra lại trạng thái.',
  softTimeoutTitle: 'Workflow chạy lâu hơn dự kiến',
  softTimeoutBody: 'Hồ sơ lớn có thể mất nhiều thời gian. Hệ thống vẫn đang theo dõi, bạn không cần chạy lại.',
  needsApiKey: 'Nhập đúng API key đã dùng khi gửi hồ sơ rồi bấm "Mở lại kết quả".',
  noResult: 'Workflow đã kết thúc nhưng không có dữ liệu kết quả để hiển thị.',
  approvalBoundary: 'Quyết định cuối thuộc hệ thống hoặc người phê duyệt có thẩm quyền.',
} as const;

export const RUN_PHASE_LABEL: Record<RunPhase, string> = {
  idle: 'Sẵn sàng',
  submitting: 'Đang gửi hồ sơ',
  running: 'Đang xử lý',
  cancelling: 'Đang huỷ',
  stalled: 'Ngừng theo dõi',
  paused: 'Xong giai đoạn 1',
  resuming: 'Đang chuyển giai đoạn 2',
  succeeded: 'Hoàn tất',
  failed: 'Có lỗi',
  cancelled: 'Đã huỷ',
};

export const ACCEPTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'doc', 'docx', 'xls', 'xlsx'] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export const ROLE_LABEL: Record<ParticipantRole, string> = {
  BORROWER: 'Khách hàng vay',
  CO_BORROWER: 'Người đồng vay',
  COLLATERAL_OWNER: 'Chủ tài sản bảo đảm',
  UNRESOLVED: 'Chưa xác định vai trò',
};

const BUSINESS_REASON_LABELS: Record<string, string> = {
  REQUIRED_DOCUMENTS_INCOMPLETE: 'Bổ sung chứng từ bắt buộc còn thiếu',
  POLICY_REVIEW_REQUIRED: 'Có tiêu chí policy cần chuyên viên rà soát',
  FIVE_C_EVIDENCE_REVIEW_REQUIRED: 'Cần xác minh thêm căn cứ cho đánh giá 5C',
  FINANCIAL_INPUT_INSUFFICIENT: 'Thiếu dữ liệu tài chính để kết luận khả năng trả nợ',
  EXTERNAL_COMPLIANCE_NOT_RUN: 'Chưa hoàn tất kiểm tra AML/PEP/sanctions',
  SCORECARD_NOT_APPROVED: 'Scorecard chưa được phê duyệt để sử dụng',
  WAITING_FOR_DECISION_SIGNALS: 'Đang chờ tín hiệu thẩm định',
};

export function businessReasonLabel(reason: string): string {
  return BUSINESS_REASON_LABELS[reason] ?? humanizeKey(reason);
}

export function recommendationLabel(value: string | undefined): string {
  if (value === 'CONSIDER') return 'Có thể xem xét';
  if (value === 'REFER') return 'Chuyển thẩm định';
  if (value === 'INSUFFICIENT_DATA') return 'Chưa đủ dữ liệu';
  return 'Chờ tổng hợp';
}

export function routeLabel(route: string | undefined): string {
  if (route === 'REQUEST_DOCUMENTS') return 'Yêu cầu bổ sung hồ sơ';
  if (route === 'RISK_REVIEW') return 'Chuyển Khối Rủi ro';
  if (route === 'CREDIT_REVIEW') return 'Chuyển thẩm định tín dụng';
  if (route === 'STRAIGHT_THROUGH') return 'Luồng xử lý thẳng';
  return 'Chưa định tuyến';
}

export function processingLabel(status: string | undefined): { label: string; headline: string } {
  if (status === 'COMPLETE') return { label: 'Hoàn tất', headline: 'Hồ sơ đã hoàn tất các lớp kiểm soát' };
  if (status === 'BLOCKED') return { label: 'Bị chặn', headline: 'Hồ sơ có điều kiện chặn cần xử lý' };
  if (status === 'REVIEW_REQUIRED') return { label: 'Cần rà soát', headline: 'Hồ sơ cần cán bộ tín dụng xem xét' };
  return { label: 'Một phần', headline: 'Chưa đủ dữ liệu để hoàn tất đánh giá' };
}
