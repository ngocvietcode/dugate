// Kiểm tra NHÁP bộ hồ sơ cho Sale + bước tổng kết tóm tắt (D-59).
//   1. Quy tắc dựng 4 tiêu chí: giai đoạn 2 tinh gọn dựng từ kết quả `dossier_precheck` (precheck-intake.ts), đường S3–S5 dựng từ S4/S5 (intake-assessment.ts).
//   2. LLM `dossier_summary` nhận thông tin hồ sơ + kết quả các tiêu chí đó (và overview / next_actions của kiểm tra sơ bộ) và viết tổng kết tóm tắt. Đây là lời gọi LLM DUY NHẤT của bước này.
//   3. LLM `intake_review` (chấm lại 3 tiêu chí) chỉ còn chạy khi `runIntakeLlm(..., { review: true })`: nó chấm lại đúng các điểm mà precheck / S4 / S5 đã nêu nên mặc định TẮT; code giữ lại cho đường lùi và test.
// Đây là bước nháp, không có trách nhiệm giải trình: lỗi LLM hoặc phản hồi sai định dạng → giữ kết quả của quy tắc, không làm đổ stage.
// Prompt `dossier_summary` cấu hình theo sản phẩm (`loan_product_config`), có bản mặc định trong code.
import { z } from 'zod';

import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { JSON_ONLY_OUTPUT_RULE } from '@/lib/loan-dossier/common/llm-json';
import { ensurePlaceholders, UNTRUSTED_DATA_GUARD, untrustedBlock } from '../prompts/loan-appraisal-prompts';
import {
  assetIdentity,
  type CriterionStatus,
  type DossierSummary,
  type IntakeAssessment,
  type IntakeCriterion,
  type IntakeFinding,
} from './intake-assessment';

export const INTAKE_REVIEW_STEP = 'intake_review';
export const DOSSIER_SUMMARY_STEP = 'dossier_summary';

/** Tiêu chí LLM được chấm (tiêu chí 3 chưa áp dụng nên không đưa vào). */
const REVIEW_KEYS = ['DOCUMENTS_COMPLETE', 'CONSISTENT_ACROSS_DOCUMENTS', 'READY_FOR_HANDOVER'] as const;

export const INTAKE_REVIEW_OUTPUT_SCHEMA =
  '{ "criteria": [{ "key": "DOCUMENTS_COMPLETE|CONSISTENT_ACROSS_DOCUMENTS|READY_FOR_HANDOVER", "status": "PASS|NEEDS_EXPLANATION|FAIL", '
  + '"summary": "<1-2 câu>", "findings": [{ "ref": "<mã điểm trong dữ kiện, hoặc null>", "message": "<tối đa 2 câu>", "group": "<nhóm hoặc null>" }] }] }';

export const DOSSIER_SUMMARY_OUTPUT_SCHEMA =
  '{ "overview": "<3-6 câu>", "highlights": ["<ý chính, tối đa 8>"], "next_actions": ["<việc Sale nên làm trước khi nộp, tối đa 8>"] }';

export const INTAKE_REVIEW_PROMPT_TEMPLATE = `Bạn là trợ lý kiểm tra NHÁP bộ hồ sơ vay cho cán bộ bán hàng (Sale) trước khi Sale nộp hồ sơ lên bước sau.
Kết quả chỉ để Sale tham khảo, không phải kết luận chính thức và không ai phải giải trình theo nó. Hãy thực tế, ngắn gọn, dễ hiểu; ưu tiên điều Sale cần làm ngay.

Chấm 3 tiêu chí dựa trên DỮ KIỆN bên dưới (hệ thống đã kiểm tra sơ bộ bằng quy tắc, mỗi điểm có mã "ref"):
- DOCUMENTS_COMPLETE (Hồ sơ đầy đủ theo quy định): đã có đủ LOẠI chứng từ bắt buộc cho từng người, từng tài sản chưa. Chỉ xét có/không có chứng từ; việc nội dung có khớp nhau thuộc tiêu chí sau.
- CONSISTENT_ACROSS_DOCUMENTS (Thông tin giữa các chứng từ nhất quán): họ tên, số định danh, ngày sinh, tình trạng hôn nhân, số tiền vay, chủ sở hữu và định danh tài sản không mâu thuẫn; tài sản, vai trò, quan hệ xác định được.
- READY_FOR_HANDOVER (Đủ chất lượng để chuyển CBQL/CO): hồ sơ dùng được cho bước thẩm định; tài liệu lỗi hoặc chưa nhận diện đã được xử lý.

QUY TẮC BẮT BUỘC:
1. Chỉ dùng thông tin có trong DỮ KIỆN. Không suy đoán thêm chứng từ, người, số liệu hay giá trị không có trong dữ kiện.
2. status chỉ nhận: PASS | NEEDS_EXPLANATION (Sale nên kiểm tra lại, có thể không phải lỗi) | FAIL (thiếu hoặc lỗi rõ ràng cần xử lý).
3. Mỗi điểm nêu trong findings: nếu dựa trên một điểm của dữ kiện thì đặt "ref" đúng mã đó; được gộp các điểm trùng hoặc rất giống thành một và được bỏ điểm chỉ khác về hình thức (hoa/thường, dấu câu, cách viết tắt, địa danh viết khác) hoặc chỉ liên quan thông tin phụ (người ký, cán bộ ký, nơi cấp). KHÔNG được bỏ điểm thiếu chứng từ bắt buộc hoặc chứng từ không đọc được.
4. Điểm mới do bạn phát hiện từ dữ kiện (không có ref) chỉ được nêu khi có căn cứ rõ trong dữ kiện.
5. message viết tiếng Việt, tối đa 2 câu, nêu rõ chứng từ / người / tài sản nào và Sale cần làm gì.
6. Không có điểm nào cần nêu thì findings = [] và status = PASS.

DỮ KIỆN KIỂM TRA SƠ BỘ (theo từng tiêu chí):
{{criteria}}

THÔNG TIN BỘ HỒ SƠ:
{{dossier}}

CHỈ trả về JSON đúng schema sau, không kèm lời dẫn hay markdown:
{{output_schema}}`;

export const DOSSIER_SUMMARY_PROMPT_TEMPLATE = `Bạn là trợ lý của cán bộ bán hàng (Sale). Viết TỔNG KẾT TÓM TẮT bộ hồ sơ vay dưới đây để Sale nắm nhanh tình trạng trước khi nộp lên bước sau.
Đây là bản nháp tham khảo, không phải kết luận chính thức.

QUY TẮC BẮT BUỘC:
1. Chỉ dùng thông tin trong THÔNG TIN BỘ HỒ SƠ và KẾT QUẢ KIỂM TRA NHÁP (các tiêu chí và điểm cần xử lý đã được hệ thống kiểm tra trước, kèm nhận xét sơ bộ ở trường precheck_overview nếu có). Không bịa số liệu, tên hay chứng từ; không tự thêm điểm thiếu hay lệch ngoài những gì đã nêu.
2. overview: 3-6 câu tiếng Việt: khách hàng và sản phẩm vay, số tiền / mục đích vay nếu có, tài sản bảo đảm, nguồn thu, và tình trạng chung của hồ sơ.
3. highlights: các ý chính đáng chú ý (tối đa 8, mỗi ý một dòng ngắn).
4. next_actions: việc Sale nên làm trước khi nộp, theo thứ tự ưu tiên (tối đa 8, mỗi ý một dòng ngắn, nêu rõ chứng từ / người / tài sản). Gộp các điểm trùng hoặc rất giống thành một, bỏ điểm chỉ khác về hình thức; KHÔNG bỏ điểm thiếu chứng từ bắt buộc hoặc chứng từ không đọc được. Hồ sơ không còn vấn đề thì để mảng rỗng.

THÔNG TIN BỘ HỒ SƠ:
{{dossier}}

KẾT QUẢ KIỂM TRA NHÁP:
{{review}}

CHỈ trả về JSON đúng schema sau, không kèm lời dẫn hay markdown:
{{output_schema}}`;

// ─── Dữ liệu LLM trả về ────────────────────────────────────────────────────────

const ReviewSchema = z.object({
  criteria: z.array(z.object({
    key: z.enum(REVIEW_KEYS),
    status: z.enum(['PASS', 'NEEDS_EXPLANATION', 'FAIL']),
    summary: z.string().trim().min(1).max(500),
    findings: z.array(z.object({
      ref: z.string().max(300).nullish(),
      message: z.string().trim().min(1).max(500),
      group: z.string().max(80).nullish(),
    })).max(60).default([]),
  })).min(1),
});
export type ReviewRaw = z.infer<typeof ReviewSchema>;

const SummarySchema = z.object({
  overview: z.string().trim().min(1).max(1500),
  highlights: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  next_actions: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
});
export type SummaryRaw = z.infer<typeof SummarySchema>;

/** Kết quả gọi LLM, lưu ở checkpoint bước 2 để resume không gọi lại. */
export interface IntakeLlmCache {
  review: ReviewRaw | null;
  summary: SummaryRaw | null;
  warnings: string[];
  prompt_overridden: { intake_review: boolean; dossier_summary: boolean };
}

export function isIntakeLlmCache(v: unknown): v is IntakeLlmCache {
  return !!v && typeof v === 'object' && 'review' in v && 'summary' in v && 'warnings' in v && 'prompt_overridden' in v;
}

/** Cổng gọi model: trả về nội dung đã parse JSON (hoặc chuỗi thô nếu không parse được). Ném lỗi khi model lỗi / timeout. */
export type AskModel = (step: typeof INTAKE_REVIEW_STEP | typeof DOSSIER_SUMMARY_STEP, prompt: string) => Promise<unknown>;

// ─── Dữ kiện đưa vào prompt ──────────────────────────────────────────────────

export interface DossierFactsInput {
  product_name: string;
  flow: string | null;
  file_count: number;
  s3: MapDossierData | null;
  evidences: ReadonlyArray<EvidenceEnvelope>;
}

const CRITERIA_CHAR_BUDGET = 14_000;
const MAX_PASSED_LINES = 30;
const MAX_FINDINGS_PER_CRITERION = 80;

interface LoanInfoLike { requested_amount?: unknown; bank_proposed_amount?: unknown; loan_purposes?: unknown; interest_rate_code?: unknown }
interface FinancialInfoLike { income_details?: Array<{ source?: string | null }>; repayment_source?: string | null }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Thông tin hồ sơ cho LLM: người, tài sản, khoản vay, nguồn thu. Không gồm số giấy tờ của người. */
export function buildDossierFacts(input: DossierFactsInput): Record<string, unknown> {
  const apps = input.evidences.filter((e) => e.status === 'SUCCESS' && e.doc_type_key === 'loan_application');
  const loan = apps.map((e) => e.data?.loan_info as LoanInfoLike | null | undefined).find((l) => l) ?? null;
  const fin = apps.map((e) => e.data?.financial_info as FinancialInfoLike | null | undefined).find((f) => f) ?? null;
  const income = [...new Set([...(fin?.income_details ?? []).map((d) => str(d.source)), str(fin?.repayment_source)].filter((x): x is string => x !== null))];
  return {
    product: input.product_name,
    flow: input.flow,
    file_count: input.file_count,
    evidence_count: input.evidences.length,
    readable_evidence_count: input.evidences.filter((e) => e.status === 'SUCCESS').length,
    persons: (input.s3?.customer_360 ?? []).map((c) => ({ person_id: c.person_id, name: c.identity.full_name ?? null, roles: c.roles })),
    assets: (input.s3?.asset_registry ?? []).map((a) => ({
      asset_id: a.asset_id, type: a.asset_type, identity: assetIdentity(a), usage: a.usage_contexts, context_status: a.context_status,
    })),
    loan: loan
      ? {
        requested_amount: loan.requested_amount ?? null,
        bank_proposed_amount: loan.bank_proposed_amount ?? null,
        purposes: Array.isArray(loan.loan_purposes) ? loan.loan_purposes.filter((p): p is string => typeof p === 'string').slice(0, 5) : [],
        interest_rate_code: loan.interest_rate_code ?? null,
      }
      : null,
    income_sources: income.slice(0, 6),
  };
}

/** Dữ kiện theo tiêu chí: mỗi điểm có `ref` ổn định; điểm đã đạt chỉ nêu số lượng và vài dòng đầu. */
export function buildCriteriaFacts(rule: IntakeAssessment): unknown[] {
  return rule.criteria.filter((c) => c.no !== 3).map((c) => ({
    key: c.key,
    label: c.label,
    goal: c.goal,
    rule_status: c.status,
    rule_summary: c.summary,
    findings: c.findings.slice(0, MAX_FINDINGS_PER_CRITERION).map((f) => ({
      ref: f.code, message: f.message, group: f.group, explained: f.status === 'ACCEPTED',
    })),
    passed_count: c.passed.length,
    passed_sample: c.passed.slice(0, MAX_PASSED_LINES).map((p) => p.message),
  }));
}

function jsonBudget(value: unknown, budget: number): string {
  const text = JSON.stringify(value);
  return text.length <= budget ? text : `${text.slice(0, budget)}…(đã cắt bớt)`;
}

export function renderPrompt(template: string, required: string[], vars: Record<string, string>): string {
  const body = ensurePlaceholders(template, required).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => (key in vars ? vars[key] : match));
  return `${UNTRUSTED_DATA_GUARD}\n\n${body}\n\n${JSON_ONLY_OUTPUT_RULE}`;
}

// ─── Gộp kết quả LLM với kết quả quy tắc ──────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  PASS: 'Đạt', FAIL: 'Chưa đạt', NEEDS_EXPLANATION: 'Cần kiểm tra', ACCEPTED: 'Đã giải trình', NOT_APPLICABLE: 'Chưa áp dụng',
};

function mergeCriterion(rc: IntakeCriterion, lc: ReviewRaw['criteria'][number]): IntakeCriterion {
  const ruleByCode = new Map(rc.findings.map((f) => [f.code, f]));
  const used = new Set<string>();
  const findings: IntakeFinding[] = [];
  lc.findings.forEach((f, i) => {
    const base = f.ref ? ruleByCode.get(f.ref) : undefined;
    if (base) {
      used.add(base.code);
      findings.push({ ...base, message: f.message, group: base.group ?? f.group ?? null });
    } else {
      findings.push({ code: `LLM:${rc.key}:${i + 1}`, message: f.message, group: f.group ?? null, acknowledgeable: false, status: 'OPEN', acknowledgement_reason: null });
    }
  });
  // Rào chắn: điểm không giải trình được (thiếu / không đọc được chứng từ bắt buộc) không bị LLM bỏ.
  for (const f of rc.findings) if (!used.has(f.code) && !f.acknowledgeable) findings.push(f);

  const open = findings.filter((f) => f.status === 'OPEN');
  let status: CriterionStatus = lc.status;
  if (findings.length > 0 && open.length === 0) status = 'ACCEPTED';
  else if (open.length > 0 && status === 'PASS') status = open.some((f) => !f.acknowledgeable) ? 'FAIL' : 'NEEDS_EXPLANATION';
  return { ...rc, status, summary: lc.summary, findings };
}

/** Áp kết quả chấm của LLM lên kết quả quy tắc. `passed`, tiêu chí 3 và `ignored_acknowledgements` giữ nguyên. */
export function mergeReview(rule: IntakeAssessment, raw: ReviewRaw): IntakeAssessment {
  const byKey = new Map(raw.criteria.map((c) => [c.key as string, c]));
  const criteria = rule.criteria.map((rc) => {
    const lc = byKey.get(rc.key);
    return lc && rc.no !== 3 ? mergeCriterion(rc, lc) : rc;
  });
  const ok = (key: string) => ['PASS', 'ACCEPTED'].includes(criteria.find((c) => c.key === key)?.status ?? '');
  return { ...rule, criteria, ready_for_handover: ok('DOCUMENTS_COMPLETE') && ok('CONSISTENT_ACROSS_DOCUMENTS') && ok('READY_FOR_HANDOVER') };
}

/** Tổng kết bằng quy tắc — dự phòng khi LLM lỗi. */
export function ruleBasedSummary(assessment: IntakeAssessment, facts: Record<string, unknown>): DossierSummary {
  const persons = (facts.persons as Array<{ name: string | null; roles: string[] }> | undefined) ?? [];
  const borrower = persons.find((p) => p.roles.includes('borrower'))?.name ?? null;
  const assets = (facts.assets as Array<{ identity: string | null; asset_id: string }> | undefined) ?? [];
  const loan = facts.loan as { bank_proposed_amount?: unknown; requested_amount?: unknown } | null;
  const amount = loan?.bank_proposed_amount ?? loan?.requested_amount ?? null;
  const parts = assessment.criteria.filter((c) => c.no !== 3).map((c) => `${c.label}: ${STATUS_LABEL[c.status] ?? c.status}`);
  const overview = [
    `Bộ hồ sơ vay ${String(facts.product ?? '')}${borrower ? ` của khách hàng ${borrower}` : ''}, gồm ${String(facts.file_count ?? 0)} tài liệu${facts.flow ? `, luồng ${String(facts.flow)}` : ''}.`,
    `${parts.join('; ')}.`,
  ].join(' ');
  const highlights = [
    ...(persons.length > 0 ? [`Người trong hồ sơ: ${persons.map((p) => `${p.name ?? 'chưa rõ tên'} (${p.roles.join(', ')})`).join('; ')}`] : []),
    ...(assets.length > 0 ? [`Tài sản: ${assets.map((a) => a.identity ?? a.asset_id).join('; ')}`] : []),
    ...(amount !== null ? [`Số tiền vay: ${String(amount)}`] : []),
  ].slice(0, 8);
  const next_actions = assessment.criteria.flatMap((c) => c.findings.filter((f) => f.status === 'OPEN').map((f) => f.message)).slice(0, 8);
  return { overview, highlights, next_actions, source: 'RULES' };
}

/** Kết quả cuối: quy tắc + (nếu có) chấm của LLM + tổng kết. Hàm thuần — dựng lại mỗi lần resume từ cache. */
export function applyIntakeLlm(rule: IntakeAssessment, cache: IntakeLlmCache | null, facts: Record<string, unknown>): IntakeAssessment {
  const merged = cache?.review ? mergeReview(rule, cache.review) : rule;
  const summary: DossierSummary = cache?.summary ? { ...cache.summary, source: 'LLM' } : ruleBasedSummary(merged, facts);
  // intake_review (chấm lại tiêu chí) mặc định tắt: tiêu chí đến từ precheck / S4 / S5. Không có kết quả chấm không phải là lỗi.
  return {
    ...merged,
    review: {
      draft: true,
      source: cache?.review ? 'LLM' : 'RULES',
      warning: cache ? (cache.warnings.join(' ') || null) : null,
      prompt_overridden: Boolean(cache && (cache.prompt_overridden.intake_review || cache.prompt_overridden.dossier_summary)),
    },
    dossier_summary: summary,
  };
}

// ─── Gọi LLM ─────────────────────────────────────────────────────────────────

function parseWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): { ok: true; value: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const first = parsed.error.issues[0];
  return { ok: false, error: `${first?.path.join('.') || '(gốc)'}: ${first?.message ?? 'không hợp lệ'}` };
}

/**
 * Mặc định chạy MỘT lời gọi LLM: tổng kết (`dossier_summary`). Chấm tiêu chí (`intake_review`) chỉ chạy khi `opts.review` = true
 * (khi đó tổng kết đọc cả kết quả chấm). Lỗi model / định dạng sai → trường tương ứng null kèm cảnh báo.
 * Ném lại lỗi huỷ (`isPassThroughError`) để operation bị huỷ không bị nuốt.
 */
export async function runIntakeLlm(
  rule: IntakeAssessment,
  facts: Record<string, unknown>,
  ask: AskModel,
  overrides: Readonly<Record<string, string | undefined>>,
  isPassThroughError: (err: unknown) => boolean = () => false,
  opts: { review?: boolean } = {},
): Promise<IntakeLlmCache> {
  const warnings: string[] = [];
  const dossier = untrustedBlock('untrusted_dossier_facts', jsonBudget(facts, 6_000));
  const prompt_overridden = { intake_review: Boolean(opts.review && overrides[INTAKE_REVIEW_STEP]), dossier_summary: Boolean(overrides[DOSSIER_SUMMARY_STEP]) };

  let review: ReviewRaw | null = null;
  if (opts.review) {
    try {
      const prompt = renderPrompt(overrides[INTAKE_REVIEW_STEP] || INTAKE_REVIEW_PROMPT_TEMPLATE, ['criteria', 'output_schema'], {
        criteria: untrustedBlock('untrusted_criteria_facts', jsonBudget(buildCriteriaFacts(rule), CRITERIA_CHAR_BUDGET)),
        dossier,
        output_schema: INTAKE_REVIEW_OUTPUT_SCHEMA,
      });
      const parsed = parseWith(ReviewSchema, await ask(INTAKE_REVIEW_STEP, prompt));
      if (parsed.ok) review = parsed.value;
      else warnings.push(`Phản hồi chấm tiêu chí không đúng định dạng (${parsed.error}).`);
    } catch (err) {
      if (isPassThroughError(err)) throw err;
      warnings.push(`Không gọi được LLM chấm tiêu chí: ${err instanceof Error ? err.message : String(err)}.`);
    }
  }

  let summary: SummaryRaw | null = null;
  try {
    const merged = review ? mergeReview(rule, review) : rule;
    const reviewFacts = merged.criteria.filter((c) => c.no !== 3).map((c) => ({
      key: c.key, label: c.label, status: STATUS_LABEL[c.status] ?? c.status, summary: c.summary,
      findings: c.findings.filter((f) => f.status === 'OPEN').slice(0, MAX_FINDINGS_PER_CRITERION).map((f) => f.message),
      passed_count: c.passed.length,
    }));
    const prompt = renderPrompt(overrides[DOSSIER_SUMMARY_STEP] || DOSSIER_SUMMARY_PROMPT_TEMPLATE, ['dossier', 'output_schema'], {
      dossier,
      review: untrustedBlock('untrusted_review', jsonBudget(reviewFacts, 8_000)),
      output_schema: DOSSIER_SUMMARY_OUTPUT_SCHEMA,
    });
    const parsed = parseWith(SummarySchema, await ask(DOSSIER_SUMMARY_STEP, prompt));
    if (parsed.ok) summary = parsed.value;
    else warnings.push(`Phản hồi tổng kết không đúng định dạng (${parsed.error}).`);
  } catch (err) {
    if (isPassThroughError(err)) throw err;
    warnings.push(`Không gọi được LLM tổng kết: ${err instanceof Error ? err.message : String(err)}.`);
  }
  return { review, summary, warnings, prompt_overridden };
}
