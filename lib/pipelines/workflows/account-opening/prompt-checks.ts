// Thực thi rule LLM của check set mở tài khoản.
//
// Nguyên tắc an toàn (nhất quán với cách siết CDD):
//   - Mọi kết luận phải kèm evidence_ids tồn tại trong registry.
//   - PASS chỉ hợp lệ khi evidence đi kèm ở trạng thái ACCEPTED.
//   - confidence < threshold ⇒ REVIEW, không bao giờ FAIL.
//   - Rule khai báo nhưng model không trả ⇒ NOT_RUN, không suy đoán là đạt.

import type { CustomerProfile, CustomerSegmentKey } from '../prompts/account-opening-prompts';
import { ACCOUNT_CHECK_OUTPUT_SCHEMA, type AccountCheckDefinition, type AccountCheckSet } from './check-set';
import type { EligibilityMetrics, EvidenceRegistry, RuleResult } from './types';

/** Giới hạn số evidence nhồi vào prompt để không vượt context của model. */
const MAX_EVIDENCE_IN_PROMPT = 400;
const MAX_VALUE_LENGTH = 160;

export interface PromptCheckInput {
  checkSet: AccountCheckSet;
  evidence: EvidenceRegistry;
  customerProfile: CustomerProfile;
  eligibility: EligibilityMetrics;
  segmentKey: CustomerSegmentKey;
  segmentName: string;
  productName: string;
}

export function enabledPromptChecks(checkSet: AccountCheckSet): AccountCheckDefinition[] {
  return checkSet.checks.filter((check) => check.kind === 'PROMPT' && check.enabled);
}

function compactEvidence(evidence: EvidenceRegistry): string {
  return evidence.records
    .filter((record) => record.evidence_kind !== 'CHECKLIST_STATUS')
    .slice(0, MAX_EVIDENCE_IN_PROMPT)
    .map((record) => {
      const value = String(record.normalized_value ?? '').slice(0, MAX_VALUE_LENGTH);
      return `${record.evidence_id} | ${record.doc_type_key} | ${record.file_name} | ${record.field_path} = ${value} | ${record.review_status}`;
    })
    .join('\n');
}

function compactEligibility(eligibility: EligibilityMetrics): string {
  return Object.entries(eligibility)
    .map(([key, metric]) => {
      if (metric.status === 'CALCULATED') return `${key}: ${metric.value} (${metric.unit})`;
      if (metric.status === 'NOT_APPLICABLE') return `${key}: KHÔNG ÁP DỤNG`;
      return `${key}: CHƯA ĐỦ DỮ LIỆU`;
    })
    .join('\n');
}

/** Dựng prompt cho TẤT CẢ rule LLM trong một lần gọi để giảm chi phí. */
export function buildPromptCheckVars(input: PromptCheckInput): Record<string, unknown> {
  const checks = enabledPromptChecks(input.checkSet);
  const checkBlock = checks
    .map((check) => [
      `--- KIỂM TRA id="${check.id}" ---`,
      `Tên: ${check.name}`,
      `Nguồn dữ liệu khai báo: ${check.input.join(', ') || 'không khai báo'}`,
      `Ngưỡng tin cậy tối thiểu: ${check.threshold ?? 0.85}`,
      `Yêu cầu: ${check.prompt}`,
    ].join('\n'))
    .join('\n\n');

  const prompt = [
    `Bạn là chuyên viên kiểm soát hồ sơ mở tài khoản, phụ trách phân khúc ${input.segmentName}, sản phẩm "${input.productName}".`,
    'Thực hiện từng KIỂM TRA dưới đây trên bộ hồ sơ đã được bóc tách.',
    '',
    'QUY TẮC BẮT BUỘC:',
    '1. Mỗi kiểm tra phải trả về đúng một kết quả, dùng lại đúng id đã cho.',
    '2. evidence_ids PHẢI là các mã evidence có trong DANH SÁCH EVIDENCE bên dưới. Tuyệt đối không tự tạo mã mới.',
    '3. Nếu không tìm được evidence để chứng minh, trả status="INSUFFICIENT_DATA" và evidence_ids=[]. Không suy đoán.',
    '4. status chỉ nhận: PASS | REVIEW | FAIL | INSUFFICIENT_DATA.',
    '5. confidence là số thực 0..1 thể hiện mức chắc chắn của bạn.',
    '6. Dữ liệu đến từ OCR nên có thể sai dấu, sai hoa/thường, nhầm O↔0, l↔1. So sánh theo NGHĨA; chỉ báo mâu thuẫn khi khác biệt mang tính thực chất.',
    '7. reason viết bằng tiếng Việt, nêu rõ con số hoặc giá trị bạn đã so sánh.',
    '8. Đây là bước kiểm soát hồ sơ, KHÔNG phải quyết định mở tài khoản; không đưa ra kết luận phê duyệt.',
    '',
    `PHÂN KHÚC: ${input.segmentKey} — ${input.segmentName}`,
    '',
    'CUSTOMER PROFILE HỢP NHẤT (có thể thiếu, chỉ dùng để định hướng):',
    JSON.stringify(input.customerProfile ?? {}),
    '',
    'CHỈ TIÊU ĐIỀU KIỆN ĐÃ TÍNH:',
    compactEligibility(input.eligibility),
    '',
    'DANH SÁCH EVIDENCE (evidence_id | loại chứng từ | file | field = giá trị | trạng thái):',
    compactEvidence(input.evidence),
    '',
    'CÁC KIỂM TRA CẦN THỰC HIỆN:',
    checkBlock,
    '',
    `CHỈ trả về JSON đúng schema sau, không kèm lời dẫn hay markdown:\n${ACCOUNT_CHECK_OUTPUT_SCHEMA}`,
  ].join('\n');

  return { _prompt: prompt };
}

const VALID_STATUSES = new Set(['PASS', 'REVIEW', 'FAIL', 'INSUFFICIENT_DATA']);

function normalizeStatus(raw: unknown): 'PASS' | 'REVIEW' | 'FAIL' | 'INSUFFICIENT_DATA' | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  return VALID_STATUSES.has(upper) ? upper as 'PASS' | 'REVIEW' | 'FAIL' | 'INSUFFICIENT_DATA' : null;
}

function normalizeConfidence(raw: unknown): number | null {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return null;
  // Một số model trả 0..100 thay vì 0..1.
  const scaled = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  if (scaled < 0 || scaled > 1) return null;
  return scaled;
}

/**
 * Chuẩn hoá output của rule LLM thành RuleResult, áp toàn bộ rào an toàn.
 * Không tin model: mọi evidence_id không tồn tại đều bị loại.
 */
export function parsePromptCheckResults(
  parsed: unknown,
  checkSet: AccountCheckSet,
  evidence: EvidenceRegistry,
): RuleResult[] {
  const checks = enabledPromptChecks(checkSet);
  if (checks.length === 0) return [];

  const validIds = new Set(evidence.records.map((record) => record.evidence_id));
  const acceptedIds = new Set(
    evidence.records.filter((record) => record.review_status === 'ACCEPTED').map((record) => record.evidence_id),
  );

  const container = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const rawResults = Array.isArray(container.results) ? container.results : Array.isArray(parsed) ? parsed : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of rawResults) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const id = (entry as Record<string, unknown>).id;
      if (typeof id === 'string' && id.trim()) byId.set(id.trim(), entry as Record<string, unknown>);
    }
  }

  return checks.map((check) => {
    const threshold = check.threshold ?? 0.85;
    const base = {
      rule_id: check.id,
      rule_version: check.version,
      severity: check.severity,
      exception_allowed: check.exception_allowed,
      check_kind: 'PROMPT' as const,
      check_name: check.name,
      check_scope: { segments: check.segments, products: check.products },
      threshold,
      expected: check.input.length > 0 ? { input: check.input } : undefined,
    };

    const raw = byId.get(check.id);
    if (!raw) {
      return {
        ...base,
        result: 'NOT_RUN',
        actual: null,
        confidence: null,
        reason_code: 'PROMPT_CHECK_NOT_RETURNED',
        message: 'Kiểm tra được cấu hình nhưng không có kết quả trả về; không được coi là đạt.',
        evidence_ids: [],
      } satisfies RuleResult;
    }

    const status = normalizeStatus(raw.status);
    const confidence = normalizeConfidence(raw.confidence);
    const reason = typeof raw.reason === 'string' && raw.reason.trim()
      ? raw.reason.trim().slice(0, 1_000)
      : 'Không có diễn giải từ kiểm tra.';
    const requestedEvidence = Array.isArray(raw.evidence_ids)
      ? raw.evidence_ids.filter((id): id is string => typeof id === 'string')
      : [];
    const evidenceIds = [...new Set(requestedEvidence.filter((id) => validIds.has(id)))];
    const droppedEvidence = requestedEvidence.length - evidenceIds.length;

    if (!status) {
      return {
        ...base,
        result: 'INSUFFICIENT_DATA',
        actual: null,
        confidence,
        reason_code: 'PROMPT_CHECK_INVALID_STATUS',
        message: 'Kết quả trả về không đúng schema; không dùng làm kết luận.',
        evidence_ids: evidenceIds,
      } satisfies RuleResult;
    }

    // Thiếu evidence hợp lệ ⇒ không được kết luận, bất kể model nói gì.
    if (evidenceIds.length === 0) {
      return {
        ...base,
        result: 'INSUFFICIENT_DATA',
        actual: status,
        confidence,
        reason_code: 'PROMPT_CHECK_EVIDENCE_MISSING',
        message: droppedEvidence > 0
          ? `${reason} (Đã loại ${droppedEvidence} tham chiếu evidence không tồn tại.)`
          : `${reason} (Không có evidence truy xuất được nên không dùng làm kết luận.)`,
        evidence_ids: [],
      } satisfies RuleResult;
    }

    // PASS phải dựa trên evidence đã được chấp nhận.
    if (status === 'PASS' && !evidenceIds.every((id) => acceptedIds.has(id))) {
      return {
        ...base,
        result: 'REVIEW',
        actual: status,
        confidence,
        reason_code: 'PROMPT_CHECK_EVIDENCE_NOT_ACCEPTED',
        message: `${reason} (Evidence dẫn chiếu chưa ở trạng thái ACCEPTED nên hạ xuống cần rà soát.)`,
        evidence_ids: evidenceIds,
      } satisfies RuleResult;
    }

    // Dưới ngưỡng tin cậy ⇒ cần người rà soát, không kết luận đạt hay không đạt.
    if (confidence !== null && confidence < threshold) {
      return {
        ...base,
        result: 'REVIEW',
        actual: status,
        confidence,
        reason_code: 'PROMPT_CHECK_BELOW_THRESHOLD',
        message: `${reason} (Độ tin cậy ${(confidence * 100).toFixed(0)}% dưới ngưỡng ${(threshold * 100).toFixed(0)}%.)`,
        evidence_ids: evidenceIds,
      } satisfies RuleResult;
    }

    return {
      ...base,
      result: status,
      actual: status,
      confidence,
      reason_code: `PROMPT_CHECK_${status}`,
      message: droppedEvidence > 0 ? `${reason} (Đã loại ${droppedEvidence} tham chiếu evidence không tồn tại.)` : reason,
      evidence_ids: evidenceIds,
    } satisfies RuleResult;
  });
}

/** Kết quả NOT_RUN cho toàn bộ rule LLM khi không gọi được connector. */
export function promptChecksNotRun(checkSet: AccountCheckSet, reason: string): RuleResult[] {
  return enabledPromptChecks(checkSet).map((check) => ({
    rule_id: check.id,
    rule_version: check.version,
    severity: check.severity,
    exception_allowed: check.exception_allowed,
    check_kind: 'PROMPT',
    check_name: check.name,
    check_scope: { segments: check.segments, products: check.products },
    threshold: check.threshold ?? 0.85,
    result: 'NOT_RUN',
    actual: null,
    confidence: null,
    reason_code: 'PROMPT_CHECK_EXECUTION_FAILED',
    message: `Không thực hiện được kiểm tra: ${reason}`,
    evidence_ids: [],
  }));
}
