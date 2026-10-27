// Bộ kiểm tra hồ sơ cấu hình được (check set).
//
// Hai loại kiểm tra:
//   - DETERMINISTIC ("rule engine"): so sánh số/trạng thái bằng code. Cấu hình
//     được THAM SỐ, không cấu hình prompt. Kết quả tái lập 100%.
//   - PROMPT ("rule LLM"): phán đoán định tính trên nội dung chứng từ. Cấu hình
//     được PROMPT + ngưỡng confidence. Bắt buộc trả evidence, và mặc định chỉ
//     được "warn" — muốn "block" phải cấu hình tường minh.
//
// Phạm vi áp dụng (giống account-opening): mỗi kiểm tra khai báo `flows` (luồng
// FULL/FAST/SIMPLE) và `products` (mã sản phẩm vay; rỗng = mọi sản phẩm). Bộ
// kiểm tra của một lần chạy = catalog đã lọc theo luồng + sản phẩm của hồ sơ.
//
// Nguồn cấu hình: ProfileEndpoint.parameters.loan_check_set → tự merge vào
// ctx.pipelineVars bởi createWorkflowContext. Cấu hình sai KHÔNG làm vỡ workflow:
// mọi giá trị ngoài khoảng cho phép bị bỏ và ghi lại trong warnings.

import type { LoanFlow, RuleResult } from './types';
import { isRuleGroupKey, resolveRuleGroup, RULE_GROUP_KEYS, type RuleGroupKey } from './rule-groups';
import { listLoanProductPolicies } from './product-policy';
import { docTypeByKey } from '@/lib/loan-dossier/catalog';
import { loadChecklistCatalog } from '@/lib/loan-dossier/s4/catalog';
import { allFlowKeys, defaultFlow, programFlowKeys, programForProduct } from '@/lib/loan-dossier/s4/programs';

/**
 * `evidence.<doc_type_key>` phải là khóa của doc_types.json; `master.document.<item_key>` phải là mục của checklist
 * catalog; `master.person`, `master.asset` (MD-R10). Nguồn khác (master_data.*, financial.*…) giữ nguyên.
 */
export function isKnownInput(entry: string): boolean {
  const m = entry.match(/^evidence\.([a-z0-9_]+)$/);
  if (m) return docTypeByKey(m[1]) !== undefined;
  // Loan Application Context (LAC-R11, D-103): lac.loan | lac.business | lac.relations | lac.person[.<role>] | lac.asset[.<usage>] | lac.document.<doc>.
  if (entry.startsWith('lac.')) {
    const doc = entry.match(/^lac\.document\.([a-z0-9_]+)$/);
    if (doc) return docTypeByKey(doc[1]) !== undefined;
    return /^lac\.(loan|business|relations|person(\.[a-z_]+)?|asset(\.[a-z_]+)?)$/.test(entry);
  }
  if (!entry.startsWith('master.')) return true;
  const d = entry.match(/^master\.document\.([a-z0-9_]+)$/);
  if (d) return loadChecklistCatalog().items.some((it) => it.item_key === d[1]);
  return /^master\.(person|asset)(\.[a-z0-9_.]+)?$/.test(entry);
}

/**
 * Luồng cho phạm vi bộ kiểm tra (Profile/pipelineVars, field "Flow Classification" trên IL). Luồng hợp lệ là
 * luồng của chương trình checklist của sản phẩm (S4-R24); thiếu/lạ → luồng mặc định (luồng đầu) của chương trình.
 * S4 không dùng hàm này: S4 nhận flow thô và báo INVALID_FLOW (V2-R01).
 */
export function resolveLoanFlow(pipelineVars: Record<string, unknown>, productCode?: string): LoanFlow {
  const raw = pipelineVars.flow ?? pipelineVars.loan_flow ?? pipelineVars.flow_classification;
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  const program = programForProduct(productCode ?? pipelineVars.product_code ?? 'hkd-loan');
  const valid = program ? programFlowKeys(program) : LOAN_FLOWS;
  return valid.includes(value) ? value : program ? defaultFlow(program) : valid[0];
}


export type LoanCheckKind = 'DETERMINISTIC' | 'PROMPT';
export type LoanCheckAction = 'block' | 'warn';

export interface LoanCheckDefinition {
  id: string;
  name: string;
  kind: LoanCheckKind;
  /** Nhóm hiển thị (chỉ trình bày, không đổi cách chấm). Thiếu thì suy từ id, xem `resolveRuleGroup`. */
  group?: RuleGroupKey;
  enabled: boolean;
  /** Luồng thẩm định áp dụng. Rỗng nghĩa là mọi luồng. */
  flows: LoanFlow[];
  /** Sản phẩm vay áp dụng. Rỗng nghĩa là mọi sản phẩm. */
  products: string[];
  /** Khai báo nguồn dữ liệu kiểm tra, ví dụ 'financial.dscr' hoặc 'master_data.owner_name'. */
  input: string[];
  action: LoanCheckAction;
  severity: RuleResult['severity'];
  exception_allowed: boolean;
  version: string;
  /** Chỉ dùng cho DETERMINISTIC; không set thì lấy ngưỡng từ policy sản phẩm. */
  params?: Record<string, number>;
  /** Chỉ dùng cho PROMPT. */
  prompt?: string;
  /**
   * Chỉ PROMPT (và AGENT sau này): danh sách mã kết quả ĐÓNG mà model được chọn (VD ["OWNER_MATCH", "OWNER_DIFFERENT"]).
   * Vắng mặt = bộ mã chung `DEFAULT_MODEL_CODES`. Model trả mã ngoài danh sách → UNKNOWN_CODE và kết quả bị hạ REVIEW.
   * Đây là cách để rule do admin tự thêm vẫn cho ra giá trị mà hệ thống ngoài dự đoán được.
   */
  outputs?: { codes: string[] };
  /** Chỉ dùng cho PROMPT: ngưỡng confidence tối thiểu để được coi là kết luận. */
  threshold?: number;
  /**
   * Chỉ PROMPT, chỉ có tác dụng khi `lac_mode = on` (LAC-R13, D-103): cho phép PASS khi MỌI dữ kiện dẫn chiếu chỉ là lời khai
   * trên đơn vay (DECLARED) — dành cho rule chỉ đọc lời khai (VD số tiền đề nghị ≤ hạn mức). Vắng = PASS chỉ dựa lời khai bị hạ REVIEW.
   */
  allow_declared_pass?: boolean;
}

export interface LoanCheckSet {
  program: string;
  version: string;
  source: 'DEFAULT' | 'PROFILE';
  output_schema: string;
  /** Luồng của lần chạy mà bộ kiểm tra này đã được lọc theo. */
  flow: LoanFlow;
  /** Sản phẩm của lần chạy mà bộ kiểm tra này đã được lọc theo. */
  product_code: string;
  checks: LoanCheckDefinition[];
}

/** Hợp các luồng của mọi chương trình checklist (S4-R24); dùng cho phạm vi `flows[]` của rule. */
export const LOAN_FLOWS: readonly LoanFlow[] = allFlowKeys();
const ALL_FLOWS: LoanFlow[] = [...LOAN_FLOWS];

/** Nhãn bộ kiểm tra dùng chung mọi sản phẩm (trước đây 'hkd-secured'). Ngưỡng theo sản phẩm nằm ở policy (loan_products.json) và `params`. */
export const LOAN_CHECK_PROGRAM = 'loan-secured';
export const LOAN_CHECK_SET_VERSION = '1.0.0';
/**
 * Id cũ của rule (tiền tố `HKD.`, khi chỉ có một sản phẩm) → id chung không phụ thuộc sản phẩm (`LOAN.`).
 * Profile đã lưu `loan_check_set` với id cũ vẫn chạy: `canonicalCheckId` đổi về id mới ở mọi điểm đọc (runtime, validate khi lưu, UI).
 * Bảng chỉ thêm, không bao giờ bỏ mục, để cấu hình đã lưu không mất hiệu lực.
 */
export const LEGACY_CHECK_ID_ALIASES: Readonly<Record<string, string>> = {
  'HKD.INTAKE.REQUIRED_DOCUMENTS': 'LOAN.INTAKE.REQUIRED_DOCUMENTS',
  'HKD.CAPACITY.MIN_DSCR': 'LOAN.CAPACITY.MIN_DSCR',
  'HKD.COLLATERAL.MAX_LTV': 'LOAN.COLLATERAL.MAX_LTV',
  'HKD.PRODUCT.MAX_AMOUNT': 'LOAN.PRODUCT.MAX_AMOUNT',
  'HKD.CONSISTENCY.BORROWER_IDENTITY': 'LOAN.CONSISTENCY.BORROWER_IDENTITY',
  'HKD.COLLATERAL.OWNER_MATCH': 'LOAN.COLLATERAL.OWNER_MATCH',
  'HKD.PURPOSE.COHERENCE': 'LOAN.PURPOSE.COHERENCE',
};

/** Id chuẩn của một rule: đổi id cũ `HKD.*` sang `LOAN.*`; id khác giữ nguyên. */
export function canonicalCheckId(id: string): string {
  return LEGACY_CHECK_ID_ALIASES[id] ?? id;
}

/** Schema bắt buộc cho đầu ra của rule LLM. */
export const LOAN_CHECK_OUTPUT_SCHEMA =
  '{ results: [{ id, status: PASS|REVIEW|FAIL|INSUFFICIENT_DATA, confidence: 0..1, reason, evidence_ids: [] }] }';

/**
 * Rule đã gỡ khỏi bộ kiểm tra. Profile đã lưu còn id này vẫn đọc được: mục bị bỏ êm (không warning, không lỗi khi lưu).
 * LOAN.INTAKE.REQUIRED_DOCUMENTS (đủ chứng từ bắt buộc) đọc checklist S4; giai đoạn 2 hiện không chạy các bước kiểm tra hồ sơ
 * (checklist, Customer 360, đối chiếu) nên rule không còn dữ liệu để chấm. Bảng chỉ thêm, không bỏ mục.
 */
export const RETIRED_CHECK_IDS: readonly string[] = ['LOAN.INTAKE.REQUIRED_DOCUMENTS'];

/** Các rule engine có cài đặt trong code. Config không thể tạo rule engine mới. */
export const DETERMINISTIC_CHECK_IDS = [
  'LOAN.CAPACITY.MIN_DSCR',
  'LOAN.COLLATERAL.MAX_LTV',
  'LOAN.PRODUCT.MAX_AMOUNT',
] as const;

/**
 * Catalog toàn bộ kiểm tra. Bộ mặc định cho một lần chạy được lọc từ đây theo
 * luồng + sản phẩm; thứ tự trong catalog là thứ tự chạy. Mặc định mọi kiểm tra
 * áp cho cả 3 luồng và mọi sản phẩm — admin thu hẹp phạm vi qua Profile.
 */
export const LOAN_CHECK_CATALOG: LoanCheckDefinition[] = [
  {
    id: 'LOAN.CAPACITY.MIN_DSCR',
    name: 'DSCR đạt ngưỡng tối thiểu',
    group: 'CAPACITY',
    kind: 'DETERMINISTIC',
    enabled: true,
    flows: ALL_FLOWS,
    products: [],
    input: ['financial.dscr'],
    action: 'block',
    severity: 'BLOCKER',
    exception_allowed: true,
    version: '1.0.0',
  },
  {
    id: 'LOAN.COLLATERAL.MAX_LTV',
    name: 'LTV không vượt trần',
    group: 'COLLATERAL',
    kind: 'DETERMINISTIC',
    enabled: true,
    flows: ALL_FLOWS,
    products: [],
    input: ['financial.ltv'],
    action: 'block',
    severity: 'BLOCKER',
    exception_allowed: true,
    version: '1.0.0',
  },
  {
    id: 'LOAN.PRODUCT.MAX_AMOUNT',
    name: 'Số tiền đề nghị trong hạn mức sản phẩm',
    group: 'LOAN_PLAN',
    kind: 'DETERMINISTIC',
    enabled: true,
    flows: ALL_FLOWS,
    products: [],
    input: ['financial.requested_amount'],
    action: 'block',
    severity: 'BLOCKER',
    exception_allowed: true,
    version: '1.0.0',
  },
  {
    id: 'LOAN.CONSISTENCY.BORROWER_IDENTITY',
    name: 'Nhất quán định danh khách hàng giữa các chứng từ',
    group: 'DOSSIER',
    kind: 'PROMPT',
    enabled: true,
    flows: ALL_FLOWS,
    products: [],
    input: ['master_data.identity', 'evidence.id_card', 'evidence.vneid', 'evidence.residence_confirmation', 'evidence.household_business_license', 'evidence.enterprise_registration_license', 'evidence.loan_application'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
    threshold: 0.85,
    outputs: { codes: ['IDENTITY_CONSISTENT', 'IDENTITY_MISMATCH', 'NOT_VERIFIABLE'] },
    prompt: 'Đối chiếu họ tên và số định danh của khách hàng vay (chủ hộ, hoặc người đại diện pháp luật của doanh nghiệp) giữa giấy tờ định danh, '
      + 'hồ sơ pháp lý nhân thân, giấy chứng nhận đăng ký kinh doanh (hộ kinh doanh hoặc doanh nghiệp) và giấy đề nghị vay. Bỏ qua khác biệt do OCR (dấu tiếng Việt, '
      + 'viết hoa, khoảng trắng, O↔0, l↔1). Chỉ báo mâu thuẫn khi khác biệt mang tính thực chất (khác người, '
      + 'sai số định danh thật sự). Trả evidence_ids là các evidence chứa giá trị bạn đã so sánh.',
  },
  {
    id: 'LOAN.COLLATERAL.OWNER_MATCH',
    name: 'Chủ sở hữu TSBĐ khớp người vay hoặc đồng sở hữu',
    group: 'COLLATERAL',
    kind: 'PROMPT',
    enabled: true,
    flows: ALL_FLOWS,
    products: [],
    input: ['master_data.identity', 'master_data.collateral', 'master_data.relationship', 'evidence.land_use_certificate', 'evidence.apartment_ownership_certificate', 'evidence.real_estate_valuation_report', 'evidence.external_valuation_certificate', 'evidence.loan_application', 'evidence.marital_status_confirmation'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
    threshold: 0.85,
    outputs: { codes: ['OWNER_MATCH', 'OWNER_DIFFERENT', 'NOT_VERIFIABLE'] },
    prompt: 'Xác định chủ sở hữu tài sản bảo đảm trên giấy chứng nhận tài sản / chứng thư định giá và so với người vay, '
      + 'vợ/chồng hoặc chủ TSBĐ khai trên giấy đề nghị vay. Nếu chủ sở hữu là người thứ ba không được khai là chủ TSBĐ '
      + 'thì báo FAIL. Nếu không đủ chứng từ để xác định thì trả INSUFFICIENT_DATA, không suy đoán.',
  },
  {
    id: 'LOAN.PURPOSE.COHERENCE',
    name: 'Mục đích vay tương xứng quy mô kinh doanh',
    group: 'LOAN_PLAN',
    kind: 'PROMPT',
    enabled: true,
    flows: ALL_FLOWS,
    products: [],
    input: ['master_data.income', 'evidence.loan_application', 'evidence.income_statement', 'evidence.household_business_license', 'evidence.business_account_ledger'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
    threshold: 0.8,
    outputs: { codes: ['PURPOSE_COHERENT', 'PURPOSE_INCOHERENT', 'NOT_VERIFIABLE'] },
    prompt: 'Đánh giá nhu cầu vốn trong phương án vay có tương xứng với doanh thu, quy mô kinh doanh và số tiền '
      + 'đề nghị vay hay không. Nêu rõ con số bạn dựa vào. Không kết luận dựa trên cảm nhận chung; nếu chứng từ '
      + 'không có số liệu định lượng thì trả INSUFFICIENT_DATA.',
  },
];

/** Kiểm tra có áp dụng cho luồng + sản phẩm đang chạy hay không. Rỗng = mọi giá trị. */
export function checkAppliesTo(
  definition: Pick<LoanCheckDefinition, 'flows' | 'products'>,
  flow: LoanFlow,
  productCode: string,
): boolean {
  const flowOk = definition.flows.length === 0 || definition.flows.includes(flow);
  const productOk = definition.products.length === 0 || definition.products.includes(productCode);
  return flowOk && productOk;
}

/** Bộ kiểm tra mặc định cho một luồng + sản phẩm cụ thể. */
export function defaultCheckSet(flow: LoanFlow, productCode: string): LoanCheckSet {
  return {
    program: LOAN_CHECK_PROGRAM,
    version: LOAN_CHECK_SET_VERSION,
    source: 'DEFAULT',
    output_schema: LOAN_CHECK_OUTPUT_SCHEMA,
    flow,
    product_code: productCode,
    checks: LOAN_CHECK_CATALOG
      .filter((definition) => checkAppliesTo(definition, flow, productCode))
      .map((definition) => ({ ...definition })),
  };
}

/**
 * Bộ mặc định cho luồng FULL + sản phẩm hkd-loan. Giữ cho code/test cũ; code mới
 * dùng `defaultCheckSet(flow, productCode)` để có đúng phạm vi của lần chạy.
 */
export const DEFAULT_CHECK_SET: LoanCheckSet = defaultCheckSet('FULL', 'hkd-loan');

// ─── Ràng buộc giá trị ────────────────────────────────────────────────────────
// Cấu hình sai có thể đổi kết quả tín dụng, nên mọi số đều bị kẹp trong khoảng
// nghiệp vụ hợp lý; ngoài khoảng thì bỏ override và giữ mặc định.

export const PARAM_RANGES: Record<string, { min: number; max: number }> = {
  minimum: { min: 0.5, max: 5 },
  maximum: { min: 0.1, max: 1 },
  maximum_vnd: { min: 1_000_000, max: 1_000_000_000_000 },
};

/** Khoảng hợp lệ của ngưỡng policy; dùng chung cho UI /profiles và validate API. */
export const POLICY_RANGES = {
  minimum_dscr: PARAM_RANGES.minimum,
  maximum_ltv: PARAM_RANGES.maximum,
  maximum_amount_vnd: PARAM_RANGES.maximum_vnd,
  default_tenor_months: { min: 1, max: 360 },
} as const;

export const MAX_CHECKS = 40;
export const MAX_OUTPUT_CODES = 20;
const OUTPUT_CODE = /^[A-Z][A-Z0-9_]{1,47}$/;

/** `outputs` hợp lệ → danh sách mã không trùng; sai → null; vắng → undefined (dùng mã mặc định). */
function cleanOutputCodes(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  const raw = record?.codes;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OUTPUT_CODES) return null;
  if (!raw.every((code) => typeof code === 'string' && OUTPUT_CODE.test(code))) return null;
  return [...new Set(raw as string[])];
}
export const MAX_PROMPT_LENGTH = 8_000;
export const MAX_ID_LENGTH = 120;
export const MAX_NAME_LENGTH = 200;

const SEVERITIES: ReadonlyArray<RuleResult['severity']> = ['BLOCKER', 'EXCEPTION', 'REVIEW', 'INFO'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function cleanNumberInRange(value: unknown, range: { min: number; max: number }): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < range.min || parsed > range.max) return null;
  return parsed;
}

function cleanFlows(value: unknown): LoanFlow[] | null {
  if (!Array.isArray(value)) return null;
  const flows = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is LoanFlow => (LOAN_FLOWS as readonly string[]).includes(entry));
  return [...new Set(flows)];
}

/** Mã sản phẩm vay có policy trong code; dùng để validate phạm vi `products`. */
export function loanProductCodes(): string[] {
  return listLoanProductPolicies().map((policy) => policy.productCode);
}

/**
 * Đọc check set từ Profile cho luồng + sản phẩm đang chạy. Trả về set đã hợp lệ
 * + danh sách cảnh báo để ghi log và audit. Không bao giờ throw: hồ sơ vẫn phải
 * chạy được với cấu hình mặc định. Mục không áp dụng cho lần chạy bị bỏ khỏi bộ
 * kiểm tra (không chấm, không NOT_RUN).
 */
export function parseCheckSet(
  raw: unknown,
  flow: LoanFlow = 'FULL',
  productCode = 'hkd-loan',
): { checkSet: LoanCheckSet; warnings: string[] } {
  const warnings: string[] = [];
  const fallbackSet = defaultCheckSet(flow, productCode);
  const source = asRecord(raw);
  if (!source) {
    if (raw !== undefined && raw !== null && raw !== '') warnings.push('loan_check_set không phải object; dùng bộ kiểm tra mặc định.');
    return { checkSet: fallbackSet, warnings };
  }

  const rawChecks = Array.isArray(source.checks) ? source.checks : null;
  if (!rawChecks) {
    warnings.push('loan_check_set.checks không phải mảng; dùng bộ kiểm tra mặc định.');
    return { checkSet: fallbackSet, warnings };
  }
  if (rawChecks.length > MAX_CHECKS) {
    warnings.push(`loan_check_set.checks vượt ${MAX_CHECKS} mục; chỉ nhận ${MAX_CHECKS} mục đầu.`);
  }

  const defaultsById = new Map(LOAN_CHECK_CATALOG.map((check) => [check.id, check]));
  let skippedOutOfScope = 0;
  const seen = new Set<string>();
  const checks: LoanCheckDefinition[] = [];

  for (const rawCheck of rawChecks.slice(0, MAX_CHECKS)) {
    const item = asRecord(rawCheck);
    if (!item) {
      warnings.push('Bỏ một mục kiểm tra không phải object.');
      continue;
    }
    const rawId = cleanString(item.id, MAX_ID_LENGTH);
    if (!rawId) {
      warnings.push('Bỏ một mục kiểm tra thiếu id hợp lệ.');
      continue;
    }
    // Id cũ (HKD.*) đổi sang id chung (LOAN.*) để Profile đã lưu vẫn chạy.
    const id = canonicalCheckId(rawId);
    if (RETIRED_CHECK_IDS.includes(id)) continue;
    if (seen.has(id)) {
      warnings.push(`Bỏ mục kiểm tra trùng id "${id}".`);
      continue;
    }
    seen.add(id);

    const fallback = defaultsById.get(id);
    const kindRaw = typeof item.kind === 'string' ? item.kind.toUpperCase() : '';
    const isDeterministicId = (DETERMINISTIC_CHECK_IDS as readonly string[]).includes(id);
    // Rule engine chỉ tồn tại nếu code có cài đặt; config không tạo được rule engine mới.
    const kind: LoanCheckKind = isDeterministicId ? 'DETERMINISTIC' : 'PROMPT';
    if (kindRaw === 'DETERMINISTIC' && !isDeterministicId) {
      warnings.push(`Kiểm tra "${id}" khai báo DETERMINISTIC nhưng không có cài đặt trong code; xử lý như rule LLM.`);
    }

    // Phạm vi luồng/sản phẩm. Thiếu hoặc rỗng `flows` ⇒ phạm vi của catalog
    // (mục tuỳ chỉnh: mọi luồng). `products` là mảng ⇒ dùng nguyên (rỗng = mọi
    // sản phẩm); thiếu ⇒ phạm vi của catalog.
    const configuredFlows = cleanFlows(item.flows);
    if (item.flows !== undefined && configuredFlows === null) {
      warnings.push(`flows của "${id}" không phải mảng; dùng phạm vi mặc định.`);
    }
    const flows = configuredFlows && configuredFlows.length > 0
      ? configuredFlows
      : fallback?.flows ?? ALL_FLOWS;
    const products = Array.isArray(item.products)
      ? [...new Set(item.products
        .filter((entry): entry is string => typeof entry === 'string' && !!entry.trim())
        .map((entry) => entry.trim()))].slice(0, 20)
      : fallback?.products ?? [];

    if (!checkAppliesTo({ flows, products }, flow, productCode)) {
      skippedOutOfScope += 1;
      continue;
    }

    const severityRaw = typeof item.severity === 'string' ? item.severity.toUpperCase() : '';
    const severity = (SEVERITIES as readonly string[]).includes(severityRaw)
      ? severityRaw as RuleResult['severity']
      : fallback?.severity ?? 'REVIEW';

    const actionRaw = typeof item.action === 'string' ? item.action.toLowerCase() : '';
    let action: LoanCheckAction = actionRaw === 'block' || actionRaw === 'warn'
      ? actionRaw
      : fallback?.action ?? 'warn';

    const prompt = cleanString(item.prompt, MAX_PROMPT_LENGTH) ?? fallback?.prompt;
    if (typeof item.prompt === 'string' && item.prompt.trim().length > MAX_PROMPT_LENGTH) {
      warnings.push(`Prompt của "${id}" vượt ${MAX_PROMPT_LENGTH} ký tự; dùng prompt mặc định.`);
    }

    if (kind === 'PROMPT' && !prompt) {
      warnings.push(`Bỏ rule LLM "${id}" vì không có prompt.`);
      seen.delete(id);
      continue;
    }

    const thresholdRaw = item.threshold ?? fallback?.threshold;
    const threshold = kind === 'PROMPT'
      ? cleanNumberInRange(thresholdRaw, { min: 0, max: 1 }) ?? fallback?.threshold ?? 0.85
      : undefined;
    if (kind === 'PROMPT' && item.threshold !== undefined && cleanNumberInRange(item.threshold, { min: 0, max: 1 }) === null) {
      warnings.push(`Ngưỡng của "${id}" ngoài khoảng 0..1; dùng ${threshold}.`);
    }

    let params: Record<string, number> | undefined;
    const rawParams = asRecord(item.params);
    if (kind === 'DETERMINISTIC' && rawParams) {
      const collected: Record<string, number> = {};
      for (const [key, value] of Object.entries(rawParams)) {
        const range = PARAM_RANGES[key];
        if (!range) {
          warnings.push(`Bỏ tham số không nhận diện "${key}" của "${id}".`);
          continue;
        }
        const numeric = cleanNumberInRange(value, range);
        if (numeric === null) {
          warnings.push(`Tham số "${key}" của "${id}" ngoài khoảng [${range.min}, ${range.max}]; dùng ngưỡng policy.`);
          continue;
        }
        collected[key] = numeric;
      }
      if (Object.keys(collected).length > 0) params = collected;
    }

    // Rule LLM chỉ được chặn khi cấu hình tường minh action=block VÀ severity chặn.
    if (kind === 'PROMPT' && action === 'block' && severity !== 'BLOCKER') {
      action = 'warn';
      warnings.push(`Rule LLM "${id}" cấu hình block nhưng severity không phải BLOCKER; hạ về warn.`);
    }

    const rawInputAll = Array.isArray(item.input)
      ? item.input.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()).slice(0, 20)
      : null;
    // V2-R07: `evidence.<khóa>` theo khóa loại chứng từ của spec-v3; khóa cũ (loan_request…) bị bỏ kèm warning.
    const rawInput = rawInputAll?.filter((entry) => {
      if (isKnownInput(entry)) return true;
      warnings.push(`Bỏ input "${entry}" của "${id}": không phải loại chứng từ của danh mục spec-v3.`);
      return false;
    }) ?? null;

    // Nhóm hiển thị: giá trị cấu hình hợp lệ > nhóm của catalog > suy từ id (rule tuỳ chỉnh → OTHER).
    if (item.group !== undefined && !isRuleGroupKey(item.group)) {
      warnings.push(`group của "${id}" không hợp lệ; dùng nhóm mặc định.`);
    }
    const group = isRuleGroupKey(item.group) ? item.group : resolveRuleGroup({ id, group: fallback?.group });

    // Mã kết quả đóng của rule LLM: chuỗi IN_HOA_GẠCH_DƯỚI, tối đa 20 mã. Cấu hình sai bị bỏ kèm warning → dùng mã mặc định.
    const codes = kind === 'PROMPT' ? cleanOutputCodes(item.outputs) ?? fallback?.outputs?.codes : undefined;
    if (kind === 'PROMPT' && item.outputs !== undefined && cleanOutputCodes(item.outputs) === null) {
      warnings.push(`outputs.codes của "${id}" không hợp lệ (cần mảng mã IN_HOA_GẠCH_DƯỚI, tối đa ${MAX_OUTPUT_CODES}); dùng bộ mã mặc định.`);
    }

    checks.push({
      id,
      name: cleanString(item.name, MAX_NAME_LENGTH) ?? fallback?.name ?? id,
      kind,
      group,
      enabled: item.enabled === undefined ? fallback?.enabled ?? true : item.enabled !== false,
      flows,
      products,
      // `input` quyết định dữ liệu đưa vào prompt rule LLM. Profile lưu bản sao
      // input của catalog tại thời điểm lưu (UI không sửa được field này), nên
      // với rule trong catalog luôn hợp nhất input hiện hành để Profile cũ không
      // bị thiếu nguồn khi catalog bổ sung loại chứng từ.
      input: [...new Set([...(rawInput ?? []), ...(fallback?.input ?? [])])],
      action,
      severity,
      exception_allowed: item.exception_allowed === undefined
        ? fallback?.exception_allowed ?? false
        : item.exception_allowed === true,
      version: cleanString(item.version, 40) ?? fallback?.version ?? '1.0.0',
      ...(params ? { params } : {}),
      ...(prompt ? { prompt } : {}),
      ...(codes && codes.length > 0 ? { outputs: { codes } } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
      ...(kind === 'PROMPT' && (item.allow_declared_pass ?? fallback?.allow_declared_pass) === true ? { allow_declared_pass: true } : {}),
    });
  }

  if (checks.length === 0) {
    // Fail-safe cho nghiệp vụ tín dụng: không có mục nào áp dụng thì chạy bộ mặc định
    // của luồng/sản phẩm thay vì chạy hồ sơ mà không có kiểm tra nào. Muốn bỏ
    // một kiểm tra thì tắt (enabled=false) chứ không thu hẹp phạm vi về rỗng.
    warnings.push(skippedOutOfScope > 0
      ? `Không mục kiểm tra nào áp cho luồng ${flow} · sản phẩm ${productCode}; dùng bộ kiểm tra mặc định.`
      : 'Không còn mục kiểm tra hợp lệ; dùng bộ kiểm tra mặc định.');
    return { checkSet: fallbackSet, warnings };
  }

  return {
    checkSet: {
      program: cleanString(source.program, 80) ?? fallbackSet.program,
      version: cleanString(source.version, 40) ?? fallbackSet.version,
      source: 'PROFILE',
      output_schema: LOAN_CHECK_OUTPUT_SCHEMA,
      flow,
      product_code: productCode,
      checks,
    },
    warnings,
  };
}

/** Ngưỡng policy do Profile cấu hình (ghi đè LoanProductPolicy). */
export interface LoanPolicyOverrides {
  minimumDscr?: number;
  maximumLtv?: number;
  maximumAmountVnd?: number;
  defaultTenorMonths?: number;
}

export function parsePolicyOverrides(raw: unknown): { overrides: LoanPolicyOverrides; warnings: string[] } {
  const warnings: string[] = [];
  const source = asRecord(raw);
  if (!source) {
    if (raw !== undefined && raw !== null && raw !== '') warnings.push('loan_policy không phải object; dùng ngưỡng mặc định.');
    return { overrides: {}, warnings };
  }

  const overrides: LoanPolicyOverrides = {};
  const numericFields: Array<{ key: keyof LoanPolicyOverrides; param: keyof typeof POLICY_RANGES; range: { min: number; max: number } }> = [
    { key: 'minimumDscr', param: 'minimum_dscr', range: POLICY_RANGES.minimum_dscr },
    { key: 'maximumLtv', param: 'maximum_ltv', range: POLICY_RANGES.maximum_ltv },
    { key: 'maximumAmountVnd', param: 'maximum_amount_vnd', range: POLICY_RANGES.maximum_amount_vnd },
    { key: 'defaultTenorMonths', param: 'default_tenor_months', range: POLICY_RANGES.default_tenor_months },
  ];

  for (const field of numericFields) {
    const raw = source[field.param];
    if (raw === undefined || raw === null || raw === '') continue;
    const numeric = cleanNumberInRange(raw, field.range);
    if (numeric === null) {
      warnings.push(`loan_policy.${field.param} ngoài khoảng [${field.range.min}, ${field.range.max}]; giữ ngưỡng mặc định.`);
      continue;
    }
    overrides[field.key] = field.key === 'defaultTenorMonths' ? Math.round(numeric) : numeric;
  }

  return { overrides, warnings };
}

// ─── Validate khi ghi cấu hình từ /profiles ───────────────────────────────────
// parseCheckSet ở trên cố ý khoan dung (bỏ mục sai, chạy tiếp) vì runtime không
// được đổ vì cấu hình. Đường ghi thì ngược lại: fail-closed, trả lỗi rõ ràng để
// admin không lưu được bộ kiểm tra sai rồi tưởng là đã áp dụng.

export type ConfigValidation = { ok: true } | { ok: false; error: string };

function invalid(error: string): ConfigValidation {
  return { ok: false, error };
}

export function validateCheckSetValue(value: unknown): ConfigValidation {
  const source = asRecord(value);
  if (!source) return invalid('loan_check_set.value phải là object.');
  if (source.program !== undefined && cleanString(source.program, 80) === null) {
    return invalid('loan_check_set.program phải là chuỗi không rỗng, tối đa 80 ký tự.');
  }
  if (source.version !== undefined && cleanString(source.version, 40) === null) {
    return invalid('loan_check_set.version phải là chuỗi không rỗng, tối đa 40 ký tự.');
  }
  if (!Array.isArray(source.checks)) return invalid('loan_check_set.checks phải là mảng.');
  if (source.checks.length === 0) return invalid('loan_check_set.checks không được rỗng.');
  if (source.checks.length > MAX_CHECKS) return invalid(`loan_check_set.checks tối đa ${MAX_CHECKS} mục.`);

  const seen = new Set<string>();
  for (const rawCheck of source.checks) {
    const item = asRecord(rawCheck);
    if (!item) return invalid('Mỗi mục trong loan_check_set.checks phải là object.');
    const rawId = cleanString(item.id, MAX_ID_LENGTH);
    if (!rawId) return invalid(`Mục kiểm tra thiếu id hợp lệ (tối đa ${MAX_ID_LENGTH} ký tự).`);
    const id = canonicalCheckId(rawId);
    if (RETIRED_CHECK_IDS.includes(id)) continue;
    if (seen.has(id)) return invalid(`Trùng id kiểm tra "${id}".`);
    seen.add(id);

    const isDeterministic = (DETERMINISTIC_CHECK_IDS as readonly string[]).includes(id);
    if (item.name !== undefined && cleanString(item.name, MAX_NAME_LENGTH) === null) {
      return invalid(`Tên của "${id}" phải là chuỗi không rỗng, tối đa ${MAX_NAME_LENGTH} ký tự.`);
    }
    if (item.kind !== undefined && !['DETERMINISTIC', 'PROMPT'].includes(String(item.kind).toUpperCase())) {
      return invalid(`kind của "${id}" chỉ nhận DETERMINISTIC hoặc PROMPT.`);
    }
    if (item.kind !== undefined && String(item.kind).toUpperCase() === 'DETERMINISTIC' && !isDeterministic) {
      return invalid(`"${id}" không có cài đặt rule engine trong code; cấu hình không tạo được rule engine mới.`);
    }
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') {
      return invalid(`enabled của "${id}" phải là boolean.`);
    }
    if (item.group !== undefined && !isRuleGroupKey(item.group)) {
      return invalid(`group của "${id}" chỉ nhận ${RULE_GROUP_KEYS.join(', ')}.`);
    }
    if (item.outputs !== undefined) {
      if (isDeterministic) return invalid(`"${id}" là rule engine nên không có outputs; mã kết quả do code quyết định.`);
      if (cleanOutputCodes(item.outputs) === null) {
        return invalid(`outputs.codes của "${id}" phải là mảng 1..${MAX_OUTPUT_CODES} mã IN_HOA_GẠCH_DƯỚI (VD OWNER_MATCH).`);
      }
    }
    if (item.input !== undefined) {
      if (!Array.isArray(item.input)) return invalid(`input của "${id}" phải là mảng.`);
      const bad = item.input.find((entry) => typeof entry !== 'string' || !isKnownInput(entry));
      if (bad !== undefined) return invalid(`input "${String(bad)}" của "${id}" không phải loại chứng từ của danh mục spec-v3.`);
    }
    if (item.exception_allowed !== undefined && typeof item.exception_allowed !== 'boolean') {
      return invalid(`exception_allowed của "${id}" phải là boolean.`);
    }
    if (item.action !== undefined && !['block', 'warn'].includes(String(item.action).toLowerCase())) {
      return invalid(`action của "${id}" chỉ nhận block hoặc warn.`);
    }
    if (item.severity !== undefined && !(SEVERITIES as readonly string[]).includes(String(item.severity).toUpperCase())) {
      return invalid(`severity của "${id}" chỉ nhận ${SEVERITIES.join(', ')}.`);
    }
    if (item.version !== undefined && cleanString(item.version, 40) === null) {
      return invalid(`version của "${id}" phải là chuỗi không rỗng, tối đa 40 ký tự.`);
    }
    if (item.flows !== undefined) {
      if (!Array.isArray(item.flows)) return invalid(`flows của "${id}" phải là mảng luồng.`);
      // Rỗng bị runtime hiểu là "phạm vi mặc định", không phải "không luồng nào"
      // — chặn ở đường ghi để admin không tưởng đã tắt rule bằng cách bỏ hết luồng.
      if (item.flows.length === 0) return invalid(`flows của "${id}" phải có ít nhất một luồng; muốn bỏ kiểm tra thì tắt enabled.`);
      const invalidFlow = item.flows.find((entry) => typeof entry !== 'string'
        || !(LOAN_FLOWS as readonly string[]).includes(entry.trim().toUpperCase()));
      if (invalidFlow !== undefined) return invalid(`flows của "${id}" chỉ nhận ${LOAN_FLOWS.join(', ')}.`);
    }
    if (item.products !== undefined) {
      if (!Array.isArray(item.products)) return invalid(`products của "${id}" phải là mảng mã sản phẩm.`);
      if (item.products.length > 20) return invalid(`products của "${id}" tối đa 20 mục.`);
      const knownProducts = loanProductCodes();
      // Mã sai chính tả sẽ âm thầm làm rule không bao giờ chạy — fail-closed.
      const unknownProduct = item.products.find((entry) => typeof entry !== 'string' || !knownProducts.includes(entry.trim()));
      if (unknownProduct !== undefined) {
        return invalid(`products của "${id}" chỉ nhận mã sản phẩm đã khai báo: ${knownProducts.join(', ')}.`);
      }
    }
    if (item.input !== undefined) {
      if (!Array.isArray(item.input)) return invalid(`input của "${id}" phải là mảng chuỗi.`);
      if (item.input.length > 20) return invalid(`input của "${id}" tối đa 20 mục.`);
      if (item.input.some((entry) => typeof entry !== 'string')) return invalid(`input của "${id}" chỉ nhận chuỗi.`);
    }

    if (item.params !== undefined) {
      const params = asRecord(item.params);
      if (!params) return invalid(`params của "${id}" phải là object.`);
      if (!isDeterministic && Object.keys(params).length > 0) {
        return invalid(`"${id}" là rule LLM nên không dùng params; cấu hình ngưỡng tin cậy qua threshold.`);
      }
      for (const [key, raw] of Object.entries(params)) {
        const range = PARAM_RANGES[key];
        if (!range) return invalid(`Tham số "${key}" của "${id}" không được hỗ trợ.`);
        if (cleanNumberInRange(raw, range) === null) {
          return invalid(`Tham số "${key}" của "${id}" phải là số trong [${range.min}, ${range.max}].`);
        }
      }
    }

    if (!isDeterministic) {
      const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
      if (!prompt) return invalid(`Rule LLM "${id}" phải có prompt.`);
      if (prompt.length > MAX_PROMPT_LENGTH) return invalid(`Prompt của "${id}" vượt ${MAX_PROMPT_LENGTH} ký tự.`);
      if (item.threshold !== undefined && cleanNumberInRange(item.threshold, { min: 0, max: 1 }) === null) {
        return invalid(`threshold của "${id}" phải là số trong [0, 1].`);
      }
      if (item.allow_declared_pass !== undefined && typeof item.allow_declared_pass !== 'boolean') {
        return invalid(`allow_declared_pass của "${id}" phải là true hoặc false.`);
      }
    } else if (item.allow_declared_pass !== undefined) {
      return invalid(`"${id}" là rule engine nên không dùng allow_declared_pass.`);
    } else if (item.prompt !== undefined && String(item.prompt).trim() !== '') {
      return invalid(`"${id}" là rule engine nên không nhận prompt; chỉ cấu hình tham số.`);
    }
  }
  return { ok: true };
}

export function validatePolicyValue(value: unknown): ConfigValidation {
  const source = asRecord(value);
  if (!source) return invalid('loan_policy.value phải là object.');
  for (const [key, raw] of Object.entries(source)) {
    const range = (POLICY_RANGES as Record<string, { min: number; max: number }>)[key];
    if (!range) return invalid(`loan_policy."${key}" không được hỗ trợ.`);
    if (cleanNumberInRange(raw, range) === null) {
      return invalid(`loan_policy.${key} phải là số trong [${range.min}, ${range.max}].`);
    }
  }
  return { ok: true };
}

// ─── Tóm tắt thay đổi cho audit ───────────────────────────────────────────────
// Audit log redact giá trị parameters thành presence-only, nên nếu không có tóm
// tắt này thì việc "ai đổi rule nào" không còn dấu vết. Chỉ ghi id và tên field
// đã đổi, không ghi nội dung prompt.

function checksById(value: unknown): Map<string, Record<string, unknown>> {
  const source = asRecord(value);
  const checks = Array.isArray(source?.checks) ? source!.checks : [];
  const map = new Map<string, Record<string, unknown>>();
  for (const raw of checks) {
    const item = asRecord(raw);
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (item && id) map.set(id, item);
  }
  return map;
}

const AUDITED_CHECK_FIELDS = ['enabled', 'group', 'flows', 'products', 'action', 'severity', 'exception_allowed', 'threshold', 'allow_declared_pass', 'params', 'name', 'version', 'outputs'] as const;

/** So sánh hai giá trị loan_check_set thô. Trả null khi không có thay đổi. */
export function summarizeCheckSetChange(before: unknown, after: unknown): string | null {
  const previous = checksById(before);
  const next = checksById(after);
  if (previous.size === 0 && next.size === 0) return null;

  const added = [...next.keys()].filter((id) => !previous.has(id));
  const removed = [...previous.keys()].filter((id) => !next.has(id));
  const changed: string[] = [];
  for (const [id, item] of next) {
    const old = previous.get(id);
    if (!old) continue;
    const fields = AUDITED_CHECK_FIELDS.filter((field) => JSON.stringify(old[field] ?? null) !== JSON.stringify(item[field] ?? null));
    // Prompt được ghi là "prompt" thôi, không đưa nội dung vào audit log.
    if (String(old.prompt ?? '') !== String(item.prompt ?? '')) fields.push('prompt' as never);
    if (fields.length > 0) changed.push(`${id}[${fields.join(',')}]`);
  }

  const parts: string[] = [];
  if (added.length > 0) parts.push(`thêm=${added.join('|')}`);
  if (removed.length > 0) parts.push(`bỏ=${removed.join('|')}`);
  if (changed.length > 0) parts.push(`sửa=${changed.join('|')}`);
  if (parts.length === 0) return null;
  return `check_set(${parts.join(' ')})`;
}

/** So sánh hai giá trị loan_policy thô. Ngưỡng policy không phải bí mật nên ghi cả giá trị. */
export function summarizePolicyChange(before: unknown, after: unknown): string | null {
  const previous = asRecord(before) ?? {};
  const next = asRecord(after) ?? {};
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])];
  const parts = keys
    .filter((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(next[key] ?? null))
    .map((key) => `${key}:${JSON.stringify(previous[key] ?? null)}→${JSON.stringify(next[key] ?? null)}`);
  return parts.length > 0 ? `loan_policy(${parts.join(' ')})` : null;
}
