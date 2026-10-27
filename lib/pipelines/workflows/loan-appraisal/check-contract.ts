// LỚP KIỂM TRA CHUNG (ENGINE / LLM / AGENT) — hợp đồng đầu ra giữa các loại thực thi và phần còn lại của hệ thống.
//
// Mục tiêu: thêm rule engine, rule LLM hay rule Agent mới KHÔNG đổi JSON tích hợp, vì cả ba cùng được ép về MỘT hình dạng
// `CheckResult` (xem integration-contract.ts). File này gồm:
//   1. Schema đầu ra mà LLM / Agent phải trả (`ModelCheckOutputSchema`) + parse an toàn bằng zod.
//   2. Mã kết quả ĐÓNG cho từng rule (`outputs.codes`): model chỉ được chọn trong danh sách đã khai báo.
//   3. `toCheckResult`: chuẩn hoá `RuleResult` nội bộ → `CheckResult` của contract (một hàm duy nhất cho mọi loại).
//
// Agent rule: chỉ khác LLM ở CÁCH thu thập bằng chứng (nhiều bước, gọi công cụ). Kết luận cuối vẫn phải qua cùng
// `ModelCheckOutputSchema` và cùng các rào an toàn ở prompt-checks.ts (evidence hợp lệ, ngưỡng tin cậy, PASS cần evidence ACCEPTED).
// Chuỗi suy luận / công cụ đã gọi thuộc audit nội bộ, KHÔNG đi vào JSON tích hợp.
import { z } from 'zod/v4';
import type { CheckKind, IntegrationCheck, Outcome } from './integration-contract';
import { resolveRuleGroup } from './rule-groups';
import type { RuleResult } from './types';

// ─── 1. Schema đầu ra của model ──────────────────────────────────────────────

export const MODEL_CHECK_STATUSES = ['PASS', 'REVIEW', 'FAIL', 'INSUFFICIENT_DATA'] as const;

/** Mã kết quả dùng chung cho mọi rule LLM / Agent khi rule không tự khai báo `outputs.codes`. */
export const DEFAULT_MODEL_CODES = ['MATCH', 'MISMATCH', 'NOT_VERIFIABLE'] as const;

/** Mã hệ thống gán khi model trả mã nằm ngoài danh sách đã khai báo của rule. */
export const UNKNOWN_CODE = 'UNKNOWN_CODE' as const;

/** Một kết quả model trả cho MỘT kiểm tra. Lỏng ở biên (model hay trả sai kiểu) và được chuẩn hoá sau, nên dùng coerce có chọn lọc. */
export const ModelCheckItemSchema = z.object({
  id: z.string().trim().min(1),
  status: z.string(),
  confidence: z.union([z.number(), z.string()]).optional(),
  /** Mã kết quả ĐÓNG (chọn trong `outputs.codes` của rule). Không bắt buộc để tương thích prompt cũ. */
  code: z.string().optional(),
  reason: z.string().optional(),
  evidence_ids: z.array(z.string()).optional(),
});
export type ModelCheckItem = z.infer<typeof ModelCheckItemSchema>;

export const ModelCheckOutputSchema = z.object({ results: z.array(z.unknown()) });

/**
 * Tách danh sách kết quả hợp lệ từ đầu ra thô của model. Phần tử sai hình dạng bị bỏ (kiểm tra tương ứng sẽ ra NOT_RUN),
 * không làm hỏng các kiểm tra còn lại. Chấp nhận cả `{results:[…]}` lẫn mảng trần.
 */
export function parseModelCheckOutput(parsed: unknown): { items: ModelCheckItem[]; dropped: number } {
  const container = Array.isArray(parsed) ? { results: parsed } : parsed;
  const outer = ModelCheckOutputSchema.safeParse(container);
  if (!outer.success) return { items: [], dropped: 0 };
  const items: ModelCheckItem[] = [];
  let dropped = 0;
  for (const raw of outer.data.results) {
    const one = ModelCheckItemSchema.safeParse(raw);
    if (one.success) items.push(one.data); else dropped += 1;
  }
  return { items, dropped };
}

/** JSON Schema gửi kèm lời gọi model (nếu connector hỗ trợ `response_format`) và dùng làm tài liệu. Sinh từ chính schema runtime. */
export function modelCheckJsonSchema(codes: readonly string[] = DEFAULT_MODEL_CODES) {
  return z.toJSONSchema(z.object({
    results: z.array(z.object({
      id: z.string(),
      status: z.enum(MODEL_CHECK_STATUSES),
      confidence: z.number().min(0).max(1),
      code: z.enum(codes as [string, ...string[]]),
      reason: z.string(),
      evidence_ids: z.array(z.string()),
    })),
  }));
}

// ─── 2. Mã kết quả đóng ──────────────────────────────────────────────────────

/** Danh sách mã hợp lệ của một rule (rule khai báo hoặc mặc định chung). */
export function allowedCodes(declared: readonly string[] | undefined): readonly string[] {
  return declared && declared.length > 0 ? declared : DEFAULT_MODEL_CODES;
}

/**
 * Áp danh sách đóng: model không trả mã → để trống; trả mã ngoài danh sách → UNKNOWN_CODE (kết quả bị hạ REVIEW ở nơi gọi).
 * Chuẩn hoá chữ hoa và ký tự không phải chữ/số thành `_` trước khi so.
 */
export function resolveModelCode(raw: string | undefined, declared: readonly string[] | undefined): { code?: string; unknown: boolean } {
  if (raw === undefined || raw.trim() === '') return { unknown: false };
  const normalized = raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return allowedCodes(declared).includes(normalized) ? { code: normalized, unknown: false } : { code: UNKNOWN_CODE, unknown: true };
}

// ─── 3. Chuẩn hoá RuleResult → CheckResult ───────────────────────────────────

const KIND_OF: Readonly<Record<NonNullable<RuleResult['check_kind']>, CheckKind>> = {
  DETERMINISTIC: 'ENGINE',
  PROMPT: 'LLM',
};

/** Mã chung do hệ thống gán cho kiểm tra không có kết luận hợp lệ (thay cho PROMPT_CHECK_*): giữ số mã nhỏ, ổn định. */
const SYSTEM_CODE: Readonly<Record<string, string>> = {
  PROMPT_CHECK_NOT_RETURNED: 'NOT_RETURNED',
  PROMPT_CHECK_EXECUTION_FAILED: 'EXECUTION_FAILED',
  PROMPT_CHECK_INVALID_STATUS: 'INVALID_OUTPUT',
  PROMPT_CHECK_EVIDENCE_MISSING: 'EVIDENCE_MISSING',
  PROMPT_CHECK_EVIDENCE_NOT_ACCEPTED: 'EVIDENCE_NOT_ACCEPTED',
  PROMPT_CHECK_CONFIDENCE_MISSING: 'CONFIDENCE_MISSING',
  PROMPT_CHECK_BELOW_THRESHOLD: 'BELOW_THRESHOLD',
};

/** `PROMPT_CHECK_PASS|FAIL|REVIEW|INSUFFICIENT_DATA` chỉ lặp lại `outcome`, nên không xuất `code`. */
const REDUNDANT_PROMPT_CODE = /^PROMPT_CHECK_(PASS|FAIL|REVIEW|INSUFFICIENT_DATA)$/;

export interface CheckResultOptions {
  /** Mã đóng do model chọn (đã qua `resolveModelCode`), nếu có. */
  modelCode?: string;
  /** Bên / tài sản bị kiểm tra, khi rule chạy theo từng đối tượng. */
  party?: string;
  asset?: string;
  /** Rule kiểu AGENT: ghi đè `kind` suy ra từ `check_kind`. */
  kind?: CheckKind;
}

const OUTCOME_OF: Readonly<Record<RuleResult['result'], Outcome>> = {
  PASS: 'PASS', FAIL: 'FAIL', REVIEW: 'REVIEW', INSUFFICIENT_DATA: 'INSUFFICIENT_DATA', NOT_RUN: 'NOT_RUN', NOT_APPLICABLE: 'NOT_APPLICABLE',
};

/**
 * Hình dạng DUY NHẤT của một kiểm tra trong JSON tích hợp, bất kể ENGINE / LLM / AGENT.
 *  - PASS chỉ mang {id, ver, kind, group, outcome} (và `confidence` với model): hồ sơ tốt càng nhỏ.
 *  - Chỉ kiểm tra không đạt mới có `code`, `measure`, `message`.
 *  - `message` của LLM/Agent là diễn giải tự do và có thể chứa tên: caller chịu trách nhiệm không đưa nó vào log.
 */
export function toCheckResult(rule: RuleResult, options: CheckResultOptions = {}): IntegrationCheck {
  const kind = options.kind ?? KIND_OF[rule.check_kind ?? 'DETERMINISTIC'];
  const outcome = OUTCOME_OF[rule.result];
  const passed = outcome === 'PASS';
  const isModel = kind !== 'ENGINE';

  const code = passed ? undefined
    : options.modelCode ?? (SYSTEM_CODE[rule.reason_code] ?? (REDUNDANT_PROMPT_CODE.test(rule.reason_code) ? undefined : rule.reason_code));

  const severity = rule.severity;
  // Rule engine luôn kèm ngưỡng/giá trị (kể cả khi đạt) để consumer thấy căn cứ; LLM/Agent không có `measure`.
  const measure = !isModel && (rule.expected !== undefined || rule.actual !== undefined)
    ? { ...(rule.expected !== undefined ? { expected: rule.expected } : {}), ...(rule.actual !== undefined ? { actual: rule.actual } : {}) }
    : undefined;

  return {
    id: rule.rule_id,
    ver: rule.rule_version,
    kind,
    group: resolveRuleGroup({ id: rule.rule_id, group: rule.group }),
    outcome,
    severity,
    ...(code ? { code } : {}),
    ...(options.party ? { party: options.party } : {}),
    ...(options.asset ? { asset: options.asset } : {}),
    ...(measure ? { measure } : {}),
    ...(isModel && typeof rule.confidence === 'number' ? { confidence: rule.confidence } : {}),
    ...(!passed && rule.message ? { message: rule.message } : {}),
    ...(rule.result === 'FAIL' && rule.exception_allowed ? { exception: true as const } : {}),
  };
}
