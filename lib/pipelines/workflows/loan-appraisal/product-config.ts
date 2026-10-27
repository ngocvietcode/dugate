// Cấu hình workflow loan-appraisal THEO SẢN PHẨM (thay cho cấu hình rải rác theo Profile).
//
// Một Profile (ProfileEndpoint.parameters) giữ một khóa `loan_product_config`:
//   { version, products: { <product_code>: ProductConfig } }
// ProductConfig gồm: prompts / models / reasoning (theo step key), policy (ngưỡng), checks (bộ rule),
// checklist (override mức yêu cầu theo luồng) và flows[flow].checks (bật/tắt rule theo luồng — thay cho tag flows/products).
//
// Hai đường đọc / ghi cố ý khác nhau:
//   - parseLoanProductConfig (runtime): khoan dung, bỏ mục sai + warning, không bao giờ throw.
//   - validateLoanProductConfig (ghi): fail-closed, trả lỗi đầu tiên để admin không lưu được cấu hình sai.
//
// Không phụ thuộc React để dùng được ở cả server (route, workflow) lẫn client (trang cấu hình).
import { isValidReasoningEffortOverride } from '@/lib/endpoints/aihub-config';
import { loanProductConfig } from '@/lib/loan-dossier/catalog/products';
import { programForProduct, programFlowKeys, validateChecklistOverrides, parseChecklistOverrides, type ChecklistOverrides } from '@/lib/loan-dossier/s4/programs';

import {
  MAX_ID_LENGTH,
  checkAppliesTo,
  parseCheckSet,
  parsePolicyOverrides,
  validateCheckSetValue,
  validatePolicyValue,
  type LoanPolicyOverrides,
} from './check-set';
import { LOAN_APPRAISAL_STEPS } from './step-catalog';
import type { LoanCheckSet } from './check-set';
import type { LoanFlow } from './types';

/** Tên khóa trong ProfileEndpoint.parameters. */
export const LOAN_PRODUCT_CONFIG_PARAM = 'loan_product_config';
export const LOAN_PRODUCT_CONFIG_VERSION = '1.0';

/** Khóa cũ (theo Profile) đã được thay bằng loan_product_config; runtime không đọc nữa. */
export const LEGACY_LOAN_PARAMS = ['loan_check_set', 'loan_policy', 'loan_checklist_overrides', '_workflowPrompts', '_workflowModels', '_workflowReasoningEfforts'] as const;

export const MAX_STEP_PROMPT_LENGTH = 20_000;
export const MAX_MODEL_LENGTH = 200;

/** Step key hợp lệ = các bước AI khai báo trong step-catalog (nguồn duy nhất, dùng chung cho UI và validate). */
export const LOAN_STEP_KEYS: readonly string[] = LOAN_APPRAISAL_STEPS.map((step) => step.key);
/** Step key ghi đè được prompt: bỏ các bước schema cố định (classify, extract, evaluate). */
export const LOAN_PROMPT_STEP_KEYS: readonly string[] = LOAN_APPRAISAL_STEPS.filter((step) => step.promptEditable !== false).map((step) => step.key);

export interface LoanFlowConfig {
  /** Rule bật/tắt theo luồng: id → bật (true) / tắt (false). Vắng mặt = theo `enabled` của rule. */
  checks?: Record<string, boolean>;
}

export interface LoanProductConfig {
  prompts?: Record<string, string>;
  models?: Record<string, string>;
  reasoning?: Record<string, string>;
  /** Ngưỡng policy ghi đè mặc định sản phẩm (cùng khóa với `loan_policy` cũ). */
  policy?: Record<string, number>;
  /** Bộ rule (cùng dạng `loan_check_set` cũ: { program, version, checks[] }). `flows`/`products` của từng rule bị bỏ qua. */
  checks?: Record<string, unknown>;
  /** Override mức yêu cầu checklist theo luồng của chương trình: { item_key: { FLOW: REQUIRED|CONDITIONAL|NOT_REQUIRED|null } }. */
  checklist?: Record<string, Record<string, string | null>>;
  flows?: Record<string, LoanFlowConfig>;
}

export interface LoanProductConfigFile {
  version: string;
  products: Record<string, LoanProductConfig>;
}

export type ConfigValidation = { ok: true } | { ok: false; error: string };
const invalid = (error: string): ConfigValidation => ({ ok: false, error });

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

// ─── Cầu nối với cấu hình cũ (checklist theo chương trình) ─────────────────────

/** Override checklist của sản phẩm → dạng `ChecklistOverrides` mà S4 đang dùng ({ programs: { <program_key>: ... } }). */
export function checklistOverridesFor(productCode: string, cfg: LoanProductConfig | undefined): { programs: ChecklistOverrides } | null {
  const program = programForProduct(productCode);
  if (!program || !cfg?.checklist || Object.keys(cfg.checklist).length === 0) return null;
  return { programs: { [program.program_key]: cfg.checklist as ChecklistOverrides[string] } } as { programs: ChecklistOverrides };
}

// ─── Đọc cho runtime (khoan dung) ──────────────────────────────────────────────

export interface ResolvedLoanConfig {
  productCode: string;
  /** Có cấu hình riêng cho sản phẩm này không. */
  configured: boolean;
  promptOverrides: Record<string, string>;
  modelOverrides: Record<string, string>;
  reasoningEffortOverrides: Record<string, string>;
  policyOverrides: LoanPolicyOverrides;
  checkSet: LoanCheckSet;
  checklistOverrides: ChecklistOverrides;
  warnings: string[];
}

function cleanStringMap(value: unknown, max: number, keys: readonly string[], label: string, warnings: string[], validate?: (v: string) => boolean): Record<string, string> {
  const source = asRecord(value);
  const out: Record<string, string> = {};
  if (!source) return out;
  for (const [key, raw] of Object.entries(source)) {
    if (!keys.includes(key)) { warnings.push(`${label}: bỏ step lạ "${key}".`); continue; }
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const v = raw.trim();
    if (v.length > max) { warnings.push(`${label}.${key} vượt ${max} ký tự; bỏ qua.`); continue; }
    if (validate && !validate(v)) { warnings.push(`${label}.${key} có giá trị không hợp lệ; bỏ qua.`); continue; }
    out[key] = v;
  }
  return out;
}

/** Bộ rule của sản phẩm cho đúng luồng: bỏ tag cũ, áp công tắc theo luồng. */
function applyFlowSwitches(rawChecks: Record<string, unknown> | undefined, flowCfg: LoanFlowConfig | undefined): Record<string, unknown> | undefined {
  if (!rawChecks) return undefined;
  const checks = Array.isArray(rawChecks.checks) ? rawChecks.checks : null;
  if (!checks) return rawChecks;
  const switches = flowCfg?.checks ?? {};
  return {
    ...rawChecks,
    checks: checks.map((raw) => {
      const item = asRecord(raw);
      if (!item) return raw;
      // Phạm vi nay do trang cấu hình quyết định (sản phẩm + luồng), nên xoá tag cũ để không lọc lần nữa.
      const { flows: _flows, products: _products, ...rest } = item;
      const id = typeof rest.id === 'string' ? rest.id.trim() : '';
      return id in switches ? { ...rest, enabled: switches[id] } : rest;
    }),
  };
}

/**
 * Cấu hình cho MỘT lần chạy (sản phẩm + luồng). Không throw; mọi giá trị sai bị bỏ kèm warning, runtime dùng mặc định.
 * `raw` là giá trị `loan_product_config` (object hoặc chuỗi JSON).
 */
export function resolveLoanConfig(raw: unknown, productCode: string, flow: LoanFlow): ResolvedLoanConfig {
  const warnings: string[] = [];
  const file = asRecord(asJson(raw));
  if (raw !== undefined && raw !== null && raw !== '' && !file) warnings.push(`${LOAN_PRODUCT_CONFIG_PARAM} không phải object; dùng cấu hình mặc định.`);
  const products = asRecord(file?.products);
  const cfg = asRecord(products?.[productCode]) as LoanProductConfig | null;

  const prompts = cleanStringMap(cfg?.prompts, MAX_STEP_PROMPT_LENGTH, LOAN_PROMPT_STEP_KEYS, 'prompts', warnings);
  const models = cleanStringMap(cfg?.models, MAX_MODEL_LENGTH, LOAN_STEP_KEYS, 'models', warnings);
  const reasoning = cleanStringMap(cfg?.reasoning, 20, LOAN_STEP_KEYS, 'reasoning', warnings, (v) => v !== '' && isValidReasoningEffortOverride(v));

  const policy = parsePolicyOverrides(cfg?.policy);
  const flowCfg = asRecord(asRecord(cfg?.flows)?.[flow]) as LoanFlowConfig | null;
  const checkSet = parseCheckSet(applyFlowSwitches(cfg?.checks, flowCfg ?? undefined), flow, productCode);
  const checklist = parseChecklistOverrides(checklistOverridesFor(productCode, cfg ?? undefined));

  warnings.push(...policy.warnings, ...checkSet.warnings, ...checklist.warnings);
  return {
    productCode,
    configured: Boolean(cfg),
    promptOverrides: prompts,
    modelOverrides: models,
    reasoningEffortOverrides: reasoning,
    policyOverrides: policy.overrides,
    checkSet: checkSet.checkSet,
    checklistOverrides: checklist.overrides,
    warnings,
  };
}

// ─── Ghi (fail-closed) ─────────────────────────────────────────────────────────

const MAX_PRODUCTS = 50;

export function validateLoanProductConfig(value: unknown): ConfigValidation {
  const file = asRecord(asJson(value));
  if (!file) return invalid(`${LOAN_PRODUCT_CONFIG_PARAM}.value phải là object.`);
  const unknownTop = Object.keys(file).filter((k) => k !== 'version' && k !== 'products');
  if (unknownTop.length) return invalid(`${LOAN_PRODUCT_CONFIG_PARAM}: key lạ ${unknownTop.join(', ')}.`);
  if (file.version !== undefined && (typeof file.version !== 'string' || !file.version.trim() || file.version.length > 40)) {
    return invalid(`${LOAN_PRODUCT_CONFIG_PARAM}.version phải là chuỗi không rỗng, tối đa 40 ký tự.`);
  }
  const products = asRecord(file.products);
  if (!products) return invalid(`${LOAN_PRODUCT_CONFIG_PARAM}.products phải là object mã sản phẩm → cấu hình.`);
  if (Object.keys(products).length > MAX_PRODUCTS) return invalid(`${LOAN_PRODUCT_CONFIG_PARAM}.products tối đa ${MAX_PRODUCTS} sản phẩm.`);

  for (const [code, rawCfg] of Object.entries(products)) {
    if (!code.trim() || code.length > MAX_ID_LENGTH) return invalid('Mã sản phẩm không hợp lệ.');
    // Mã sai chính tả sẽ âm thầm không bao giờ được dùng — chặn ở đường ghi.
    if (!loanProductConfig(code)) return invalid(`Sản phẩm "${code}" chưa khai báo trong loan_products.json.`);
    const cfg = asRecord(rawCfg);
    if (!cfg) return invalid(`Cấu hình của sản phẩm "${code}" phải là object.`);
    const unknownKeys = Object.keys(cfg).filter((k) => !['prompts', 'models', 'reasoning', 'policy', 'checks', 'checklist', 'flows'].includes(k));
    if (unknownKeys.length) return invalid(`${code}: key lạ ${unknownKeys.join(', ')}.`);

    const stepMap = (field: 'prompts' | 'models' | 'reasoning', max: number, check?: (v: string) => string | null): ConfigValidation => {
      const map = cfg[field];
      if (map === undefined) return { ok: true };
      const rec = asRecord(map);
      if (!rec) return invalid(`${code}.${field} phải là object step → giá trị.`);
      const allowed = field === 'prompts' ? LOAN_PROMPT_STEP_KEYS : LOAN_STEP_KEYS;
      for (const [step, v] of Object.entries(rec)) {
        if (!allowed.includes(step)) return invalid(`${code}.${field}: step "${step}" không tồn tại hoặc không ghi đè được.`);
        if (typeof v !== 'string' || !v.trim()) return invalid(`${code}.${field}.${step} phải là chuỗi không rỗng (xoá khoá nếu muốn dùng mặc định).`);
        if (v.length > max) return invalid(`${code}.${field}.${step} vượt ${max} ký tự.`);
        const err = check?.(v);
        if (err) return invalid(`${code}.${field}.${step} ${err}`);
      }
      return { ok: true };
    };
    for (const result of [
      stepMap('prompts', MAX_STEP_PROMPT_LENGTH),
      stepMap('models', MAX_MODEL_LENGTH),
      stepMap('reasoning', 20, (v) => (isValidReasoningEffortOverride(v) ? null : 'chỉ nhận minimal, low, medium hoặc high.')),
    ]) if (!result.ok) return result;

    if (cfg.policy !== undefined) {
      const r = validatePolicyValue(cfg.policy);
      if (!r.ok) return invalid(`${code}: ${r.error}`);
    }
    if (cfg.checks !== undefined) {
      const r = validateCheckSetValue(cfg.checks);
      if (!r.ok) return invalid(`${code}: ${r.error}`);
    }
    if (cfg.checklist !== undefined) {
      const program = programForProduct(code);
      if (!program) return invalid(`${code}: sản phẩm chưa thuộc chương trình checklist nào.`);
      const r = validateChecklistOverrides({ programs: { [program.program_key]: cfg.checklist } });
      if (!r.ok) return invalid(`${code}: ${r.error}`);
    }
    if (cfg.flows !== undefined) {
      const flows = asRecord(cfg.flows);
      if (!flows) return invalid(`${code}.flows phải là object luồng → cấu hình.`);
      const program = programForProduct(code);
      const valid = program ? programFlowKeys(program) : [];
      for (const [flow, rawFlow] of Object.entries(flows)) {
        if (!valid.includes(flow)) return invalid(`${code}.flows: luồng "${flow}" không thuộc chương trình của sản phẩm (${valid.join('/')}).`);
        const flowCfg = asRecord(rawFlow);
        if (!flowCfg) return invalid(`${code}.flows.${flow} phải là object.`);
        if (Object.keys(flowCfg).some((k) => k !== 'checks')) return invalid(`${code}.flows.${flow}: chỉ nhận "checks".`);
        const checks = asRecord(flowCfg.checks);
        if (flowCfg.checks !== undefined && !checks) return invalid(`${code}.flows.${flow}.checks phải là object id → boolean.`);
        for (const [id, on] of Object.entries(checks ?? {})) {
          if (typeof on !== 'boolean') return invalid(`${code}.flows.${flow}.checks.${id} phải là boolean.`);
        }
      }
    }
  }
  return { ok: true };
}

// ─── Chuyển cấu hình cũ (theo Profile) sang một sản phẩm ───────────────────────

const unwrap = (params: Record<string, { value?: unknown }> | null | undefined, key: string): unknown => asJson(params?.[key]?.value);

/** Cấu hình cũ của Profile áp cho MỌI sản phẩm; hàm này dựng cấu hình tương đương cho MỘT sản phẩm (tag flows/products → công tắc theo luồng). */
export function migrateLegacyForProduct(params: Record<string, { value?: unknown }> | null | undefined, productCode: string): LoanProductConfig {
  const out: LoanProductConfig = {};
  const step = (key: string, allowed: readonly string[]): Record<string, string> => {
    const map = asRecord(unwrap(params, key));
    return Object.fromEntries(Object.entries(map ?? {}).filter((e): e is [string, string] => allowed.includes(e[0]) && typeof e[1] === 'string' && !!e[1].trim()).map(([k, v]) => [k, v.trim()]));
  };
  const prompts = step('_workflowPrompts', LOAN_PROMPT_STEP_KEYS);
  const models = step('_workflowModels', LOAN_STEP_KEYS);
  const reasoning = step('_workflowReasoningEfforts', LOAN_STEP_KEYS);
  if (Object.keys(prompts).length) out.prompts = prompts;
  if (Object.keys(models).length) out.models = models;
  if (Object.keys(reasoning).length) out.reasoning = reasoning;

  const policy = parsePolicyOverrides(unwrap(params, 'loan_policy')).overrides;
  const policyRaw = asRecord(unwrap(params, 'loan_policy'));
  if (policyRaw && Object.keys(policy).length) {
    out.policy = Object.fromEntries(Object.entries(policyRaw).filter((e): e is [string, number] => typeof e[1] === 'number'));
  }

  const checkSet = asRecord(unwrap(params, 'loan_check_set'));
  const rawChecks = Array.isArray(checkSet?.checks) ? checkSet!.checks : null;
  if (checkSet && rawChecks) {
    const program = programForProduct(productCode);
    const flowKeys = program ? programFlowKeys(program) : [];
    const stripped = rawChecks.map((raw) => {
      const item = asRecord(raw);
      if (!item) return raw;
      const { flows: _f, products: _p, ...rest } = item;
      return rest;
    });
    out.checks = { ...checkSet, checks: stripped };
    const flows: Record<string, LoanFlowConfig> = {};
    for (const rawCheck of rawChecks) {
      const item = asRecord(rawCheck);
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      if (!item || !id) continue;
      const tagFlows = Array.isArray(item.flows) ? item.flows.filter((f): f is string => typeof f === 'string').map((f) => f.toUpperCase()) : null;
      const tagProducts = Array.isArray(item.products) ? item.products.filter((p): p is string => typeof p === 'string') : null;
      for (const flow of flowKeys) {
        const applies = checkAppliesTo({ flows: (tagFlows ?? flowKeys) as LoanFlow[], products: tagProducts ?? [] }, flow as LoanFlow, productCode);
        if (!applies) ((flows[flow] ??= {}).checks ??= {})[id] = false;
      }
    }
    if (Object.keys(flows).length) out.flows = flows;
  }

  const overrides = asRecord(asRecord(unwrap(params, 'loan_checklist_overrides'))?.programs);
  const program = programForProduct(productCode);
  const mine = program ? asRecord(overrides?.[program.program_key]) : null;
  if (mine && Object.keys(mine).length) out.checklist = mine as Record<string, Record<string, string | null>>;
  return out;
}

// ─── Tóm tắt thay đổi cho audit ────────────────────────────────────────────────
// Audit redact giá trị parameters; chỉ ghi tên sản phẩm + nhóm đã đổi, không ghi nội dung prompt.

export function summarizeLoanProductConfigChange(before: unknown, after: unknown): string | null {
  const a = asRecord(asRecord(asJson(before))?.products) ?? {};
  const b = asRecord(asRecord(asJson(after))?.products) ?? {};
  const parts: string[] = [];
  for (const code of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = asRecord(a[code]) ?? {};
    const y = asRecord(b[code]) ?? {};
    const changed = ['prompts', 'models', 'reasoning', 'policy', 'checks', 'checklist', 'flows']
      .filter((k) => JSON.stringify(x[k] ?? null) !== JSON.stringify(y[k] ?? null));
    if (changed.length) parts.push(`${code}: ${changed.join(', ')}`);
  }
  return parts.length ? `loan_product_config đổi — ${parts.join('; ')}.` : null;
}
