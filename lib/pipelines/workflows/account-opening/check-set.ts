// Bộ kiểm tra hồ sơ mở tài khoản cấu hình được (check set), phạm vi theo PHÂN
// KHÚC và SẢN PHẨM.
//
// Hai loại kiểm tra:
//   - DETERMINISTIC ("rule engine"): so sánh số/trạng thái bằng code. Cấu hình
//     được THAM SỐ, không cấu hình prompt. Kết quả tái lập 100%.
//   - PROMPT ("rule LLM"): phán đoán định tính trên nội dung chứng từ. Cấu hình
//     được PROMPT + ngưỡng confidence. Bắt buộc trả evidence, và mặc định chỉ
//     được "warn" — muốn "block" phải cấu hình tường minh.
//
// Phạm vi áp dụng: mỗi kiểm tra khai báo `segments` (bắt buộc) và `products`
// (tùy chọn). Bộ kiểm tra mặc định của một lần chạy = catalog đã lọc theo phân
// khúc + sản phẩm, nên KHCN không bị chấm bằng rule chủ sở hữu hưởng lợi của SME.
//
// Nguồn cấu hình: ProfileEndpoint.parameters.account_check_set → tự merge vào
// ctx.pipelineVars bởi createWorkflowContext. Cấu hình sai KHÔNG làm vỡ workflow:
// mọi giá trị ngoài khoảng cho phép bị bỏ và ghi lại trong warnings.

import type { CustomerSegmentKey } from '../prompts/account-opening-prompts';
import type { RuleResult } from './types';

export type AccountCheckKind = 'DETERMINISTIC' | 'PROMPT';
export type AccountCheckAction = 'block' | 'warn';

export interface AccountCheckDefinition {
  id: string;
  name: string;
  kind: AccountCheckKind;
  enabled: boolean;
  /** Phân khúc áp dụng. Rỗng nghĩa là áp dụng cho mọi phân khúc. */
  segments: CustomerSegmentKey[];
  /** Sản phẩm áp dụng. Rỗng nghĩa là mọi sản phẩm của các phân khúc trên. */
  products: string[];
  /** Khai báo nguồn dữ liệu kiểm tra, ví dụ 'eligibility.applicant_age'. */
  input: string[];
  action: AccountCheckAction;
  severity: RuleResult['severity'];
  exception_allowed: boolean;
  version: string;
  /** Chỉ dùng cho DETERMINISTIC; không set thì lấy ngưỡng từ policy sản phẩm. */
  params?: Record<string, number>;
  /** Chỉ dùng cho PROMPT. */
  prompt?: string;
  /** Chỉ dùng cho PROMPT: ngưỡng confidence tối thiểu để được coi là kết luận. */
  threshold?: number;
}

export interface AccountCheckSet {
  program: string;
  version: string;
  source: 'DEFAULT' | 'PROFILE';
  output_schema: string;
  segment_key: CustomerSegmentKey;
  product_code: string;
  checks: AccountCheckDefinition[];
}

/** Schema bắt buộc cho đầu ra của rule LLM. */
export const ACCOUNT_CHECK_OUTPUT_SCHEMA =
  '{ results: [{ id, status: PASS|REVIEW|FAIL|INSUFFICIENT_DATA, confidence: 0..1, reason, evidence_ids: [] }] }';

/** Các rule engine có cài đặt trong code. Config không thể tạo rule engine mới. */
export const DETERMINISTIC_CHECK_IDS = [
  'AO.INTAKE.REQUIRED_DOCUMENTS',
  'AO.IDENTITY.DOCUMENT_VALIDITY',
  'AO.ELIGIBILITY.MIN_AGE',
  'AO.OWNERSHIP.BENEFICIAL_OWNER_DISCLOSURE',
  'AO.AUTHORIZATION.SIGNATORY_REGISTERED',
  'AO.RISK.DUE_DILIGENCE_LEVEL',
] as const;

const ALL_SEGMENTS: CustomerSegmentKey[] = ['KHCN', 'HKD', 'SME', 'KHDN'];
const ORGANIZATION_SEGMENTS: CustomerSegmentKey[] = ['SME', 'KHDN'];

/**
 * Catalog toàn bộ kiểm tra. Bộ mặc định cho một lần chạy được lọc từ đây theo
 * phân khúc + sản phẩm; thứ tự trong catalog là thứ tự chạy.
 */
export const ACCOUNT_CHECK_CATALOG: AccountCheckDefinition[] = [
  {
    id: 'AO.INTAKE.REQUIRED_DOCUMENTS',
    name: 'Đủ chứng từ bắt buộc theo phân khúc',
    kind: 'DETERMINISTIC',
    enabled: true,
    segments: ALL_SEGMENTS,
    products: [],
    input: ['intake.checklist'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
  },
  {
    id: 'AO.IDENTITY.DOCUMENT_VALIDITY',
    name: 'Giấy tờ định danh còn hiệu lực',
    kind: 'DETERMINISTIC',
    enabled: true,
    segments: ALL_SEGMENTS,
    products: [],
    input: ['eligibility.primary_id_validity_days', 'eligibility.residency_permit_validity_days'],
    action: 'block',
    severity: 'BLOCKER',
    exception_allowed: false,
    version: '1.0.0',
  },
  {
    id: 'AO.ELIGIBILITY.MIN_AGE',
    name: 'Chủ tài khoản / người đại diện đủ tuổi',
    kind: 'DETERMINISTIC',
    enabled: true,
    segments: ALL_SEGMENTS,
    products: [],
    input: ['eligibility.applicant_age'],
    action: 'block',
    severity: 'BLOCKER',
    exception_allowed: false,
    version: '1.0.0',
  },
  {
    id: 'AO.OWNERSHIP.BENEFICIAL_OWNER_DISCLOSURE',
    name: 'Kê khai đủ chủ sở hữu hưởng lợi',
    kind: 'DETERMINISTIC',
    enabled: true,
    segments: ORGANIZATION_SEGMENTS,
    products: [],
    input: ['eligibility.beneficial_owner_coverage_percent'],
    action: 'block',
    severity: 'BLOCKER',
    exception_allowed: true,
    version: '1.0.0',
  },
  {
    id: 'AO.AUTHORIZATION.SIGNATORY_REGISTERED',
    name: 'Đủ người ký / người được ủy quyền đăng ký trên tài khoản',
    kind: 'DETERMINISTIC',
    enabled: true,
    segments: ORGANIZATION_SEGMENTS,
    products: [],
    input: ['eligibility.authorized_signatory_count'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: true,
    version: '1.0.0',
  },
  {
    id: 'AO.RISK.DUE_DILIGENCE_LEVEL',
    name: 'Mức rủi ro trong ngưỡng xử lý của sản phẩm',
    kind: 'DETERMINISTIC',
    enabled: true,
    segments: ALL_SEGMENTS,
    products: [],
    input: ['cdd.risk_rating', 'cdd.due_diligence_level'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
  },
  {
    id: 'AO.CONSISTENCY.CUSTOMER_IDENTITY',
    name: 'Nhất quán định danh khách hàng giữa các chứng từ',
    kind: 'PROMPT',
    enabled: true,
    segments: ALL_SEGMENTS,
    products: [],
    input: ['profile.identity', 'evidence.id_document', 'evidence.account_form'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
    threshold: 0.85,
    prompt: 'Đối chiếu họ tên, ngày sinh và số giấy tờ định danh của khách hàng (hoặc người đại diện) giữa giấy tờ '
      + 'định danh, giấy đề nghị mở tài khoản và các chứng từ khác trong hồ sơ. Bỏ qua khác biệt do OCR (dấu tiếng Việt, '
      + 'viết hoa, khoảng trắng, O↔0, l↔1). Chỉ báo mâu thuẫn khi khác biệt mang tính thực chất (khác người, sai số giấy '
      + 'tờ thật sự). Trả evidence_ids là các evidence chứa giá trị bạn đã so sánh.',
  },
  {
    id: 'AO.CONSISTENCY.LEGAL_REPRESENTATIVE',
    name: 'Người đại diện theo pháp luật khớp đăng ký doanh nghiệp và văn bản bổ nhiệm',
    kind: 'PROMPT',
    enabled: true,
    segments: ORGANIZATION_SEGMENTS,
    products: [],
    input: ['profile.identity', 'profile.authorization', 'evidence.business_registration', 'evidence.appointment_decision'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
    threshold: 0.85,
    prompt: 'Xác định người đại diện theo pháp luật ghi trên GCN đăng ký doanh nghiệp, quyết định bổ nhiệm và giấy đề '
      + 'nghị mở tài khoản; kiểm tra có cùng một người và cùng chức danh hay không. Nếu người đứng tên trên biểu mẫu '
      + 'không phải người đại diện và không có văn bản ủy quyền hợp lệ thì trả FAIL. Không đủ chứng từ để xác định thì '
      + 'trả INSUFFICIENT_DATA, không suy đoán.',
  },
  {
    id: 'AO.AUTHORIZATION.MANDATE_SCOPE',
    name: 'Phạm vi và thời hạn ủy quyền rõ ràng, còn hiệu lực',
    kind: 'PROMPT',
    enabled: true,
    segments: ['HKD', 'SME', 'KHDN'],
    products: [],
    input: ['profile.authorization', 'evidence.authorization_doc', 'evidence.board_resolution'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
    threshold: 0.8,
    prompt: 'Nếu hồ sơ có giấy ủy quyền hoặc nghị quyết về mở/sử dụng tài khoản, hãy kiểm tra: người được ủy quyền, phạm '
      + 'vi giao dịch, hạn mức (nếu có) và thời hạn ủy quyền có được nêu rõ và còn hiệu lực hay không; người ký ủy quyền '
      + 'có thẩm quyền theo điều lệ hay không. Nếu hồ sơ không có văn bản ủy quyền nào thì trả INSUFFICIENT_DATA.',
  },
  {
    id: 'AO.PURPOSE.PLAUSIBILITY',
    name: 'Mục đích mở tài khoản tương xứng nghề nghiệp/ngành nghề và doanh số dự kiến',
    kind: 'PROMPT',
    enabled: true,
    segments: ALL_SEGMENTS,
    products: [],
    input: ['profile.compliance', 'evidence.account_form', 'evidence.source_of_funds'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
    threshold: 0.8,
    prompt: 'Đánh giá mục đích mở tài khoản, nguồn tiền và doanh số giao dịch dự kiến có tương xứng với nghề nghiệp '
      + '(KHCN) hoặc ngành nghề, quy mô, doanh thu (HKD/SME/KHDN) hay không. Nêu rõ con số bạn dựa vào. Không kết luận '
      + 'dựa trên cảm nhận chung; nếu chứng từ không có số liệu định lượng thì trả INSUFFICIENT_DATA.',
  },
  {
    id: 'AO.FORM.SIGNATURE_COMPLETENESS',
    name: 'Biểu mẫu mở tài khoản đủ mục bắt buộc, chữ ký và mẫu dấu',
    kind: 'PROMPT',
    enabled: true,
    segments: ALL_SEGMENTS,
    products: [],
    input: ['evidence.account_form', 'evidence.signature_specimen'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
    threshold: 0.8,
    prompt: 'Kiểm tra giấy đề nghị mở tài khoản: các mục bắt buộc (thông tin khách hàng, mục đích, loại tiền, dịch vụ '
      + 'đăng ký, người đại diện/ủy quyền) có được điền không; có chữ ký của chủ tài khoản/người đại diện và mẫu dấu '
      + '(với tổ chức) không. Chỉ kết luận dựa trên dữ liệu bóc tách được; thiếu dữ liệu thì trả INSUFFICIENT_DATA.',
  },
  {
    id: 'AO.SANCTIONS.JURISDICTION_FLAG',
    name: 'Dấu hiệu quốc gia/địa bàn rủi ro cao trên hồ sơ',
    kind: 'PROMPT',
    enabled: true,
    segments: ['KHCN', 'KHDN'],
    // Chỉ áp cho sản phẩm có yếu tố nước ngoài — ví dụ phạm vi theo SẢN PHẨM.
    products: ['casa-khcn-nonresident', 'casa-khdn-standard'],
    input: ['profile.compliance', 'profile.ownership', 'evidence.passport', 'evidence.ownership_structure'],
    action: 'warn',
    severity: 'REVIEW',
    exception_allowed: false,
    version: '1.0.0',
    threshold: 0.8,
    prompt: 'Rà soát quốc tịch, quốc gia cư trú thuế, quốc gia đăng ký của tổ chức và các pháp nhân trong chuỗi sở hữu; '
      + 'nêu rõ nếu có quốc gia/địa bàn thường bị xếp vào nhóm rủi ro cao hoặc bị hạn chế giao dịch. Đây là phát hiện dấu '
      + 'hiệu trên chứng từ, KHÔNG phải kết quả sàng lọc danh sách cấm vận. Không có thông tin thì trả INSUFFICIENT_DATA.',
  },
];

/** Kiểm tra có áp dụng cho phân khúc + sản phẩm đang chạy hay không. */
export function checkAppliesTo(
  definition: Pick<AccountCheckDefinition, 'segments' | 'products'>,
  segmentKey: CustomerSegmentKey,
  productCode: string,
): boolean {
  const segmentOk = definition.segments.length === 0 || definition.segments.includes(segmentKey);
  const productOk = definition.products.length === 0 || definition.products.includes(productCode);
  return segmentOk && productOk;
}

/** Bộ kiểm tra mặc định cho một phân khúc + sản phẩm cụ thể. */
export function defaultCheckSet(segmentKey: CustomerSegmentKey, productCode: string): AccountCheckSet {
  return {
    program: `account-opening-${segmentKey.toLowerCase()}`,
    version: '1.0.0',
    source: 'DEFAULT',
    output_schema: ACCOUNT_CHECK_OUTPUT_SCHEMA,
    segment_key: segmentKey,
    product_code: productCode,
    checks: ACCOUNT_CHECK_CATALOG
      .filter((definition) => checkAppliesTo(definition, segmentKey, productCode))
      .map((definition) => ({ ...definition })),
  };
}

// ─── Ràng buộc giá trị ────────────────────────────────────────────────────────
// Cấu hình sai có thể cho mở tài khoản không đủ điều kiện, nên mọi số đều bị kẹp
// trong khoảng nghiệp vụ hợp lý; ngoài khoảng thì bỏ override và giữ mặc định.

export const PARAM_RANGES: Record<string, { min: number; max: number }> = {
  minimum_age: { min: 15, max: 25 },
  maximum_age: { min: 60, max: 120 },
  minimum_days: { min: 0, max: 365 },
  minimum_percent: { min: 0, max: 100 },
  minimum_count: { min: 1, max: 20 },
};

/** Khoảng hợp lệ của ngưỡng policy; dùng chung cho UI /profiles và validate API. */
export const POLICY_RANGES = {
  minimum_age_years: PARAM_RANGES.minimum_age,
  maximum_age_years: PARAM_RANGES.maximum_age,
  minimum_id_validity_days: PARAM_RANGES.minimum_days,
  beneficial_owner_threshold_percent: PARAM_RANGES.minimum_percent,
  minimum_beneficial_owner_coverage_percent: PARAM_RANGES.minimum_percent,
  minimum_authorized_signatories: PARAM_RANGES.minimum_count,
} as const;

export const MAX_CHECKS = 40;
export const MAX_PROMPT_LENGTH = 8_000;
export const MAX_ID_LENGTH = 120;
export const MAX_NAME_LENGTH = 200;

const SEVERITIES: ReadonlyArray<RuleResult['severity']> = ['BLOCKER', 'EXCEPTION', 'REVIEW', 'INFO'];
const SEGMENT_KEYS: ReadonlyArray<CustomerSegmentKey> = ['KHCN', 'HKD', 'SME', 'KHDN'];

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

function cleanSegments(value: unknown): CustomerSegmentKey[] | null {
  if (!Array.isArray(value)) return null;
  const segments = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is CustomerSegmentKey => (SEGMENT_KEYS as readonly string[]).includes(entry));
  return [...new Set(segments)];
}

/**
 * Đọc check set từ Profile cho phân khúc + sản phẩm đang chạy. Trả về set đã hợp
 * lệ + danh sách cảnh báo để ghi log và audit. Không bao giờ throw: hồ sơ vẫn
 * phải chạy được với cấu hình mặc định.
 */
export function parseCheckSet(
  raw: unknown,
  segmentKey: CustomerSegmentKey,
  productCode: string,
): { checkSet: AccountCheckSet; warnings: string[] } {
  const warnings: string[] = [];
  const fallbackSet = defaultCheckSet(segmentKey, productCode);
  const source = asRecord(raw);
  if (!source) {
    if (raw !== undefined && raw !== null && raw !== '') warnings.push('account_check_set không phải object; dùng bộ kiểm tra mặc định.');
    return { checkSet: fallbackSet, warnings };
  }

  const rawChecks = Array.isArray(source.checks) ? source.checks : null;
  if (!rawChecks) {
    warnings.push('account_check_set.checks không phải mảng; dùng bộ kiểm tra mặc định.');
    return { checkSet: fallbackSet, warnings };
  }
  if (rawChecks.length > MAX_CHECKS) {
    warnings.push(`account_check_set.checks vượt ${MAX_CHECKS} mục; chỉ nhận ${MAX_CHECKS} mục đầu.`);
  }

  const catalogById = new Map(ACCOUNT_CHECK_CATALOG.map((check) => [check.id, check]));
  const seen = new Set<string>();
  const checks: AccountCheckDefinition[] = [];

  for (const rawCheck of rawChecks.slice(0, MAX_CHECKS)) {
    const item = asRecord(rawCheck);
    if (!item) {
      warnings.push('Bỏ một mục kiểm tra không phải object.');
      continue;
    }
    const id = cleanString(item.id, MAX_ID_LENGTH);
    if (!id) {
      warnings.push('Bỏ một mục kiểm tra thiếu id hợp lệ.');
      continue;
    }
    if (seen.has(id)) {
      warnings.push(`Bỏ mục kiểm tra trùng id "${id}".`);
      continue;
    }
    seen.add(id);

    const fallback = catalogById.get(id);
    const kindRaw = typeof item.kind === 'string' ? item.kind.toUpperCase() : '';
    const isDeterministicId = (DETERMINISTIC_CHECK_IDS as readonly string[]).includes(id);
    // Rule engine chỉ tồn tại nếu code có cài đặt; config không tạo được rule engine mới.
    const kind: AccountCheckKind = isDeterministicId ? 'DETERMINISTIC' : 'PROMPT';
    if (kindRaw === 'DETERMINISTIC' && !isDeterministicId) {
      warnings.push(`Kiểm tra "${id}" khai báo DETERMINISTIC nhưng không có cài đặt trong code; xử lý như rule LLM.`);
    }

    // Phạm vi phân khúc/sản phẩm: config được thu hẹp phạm vi, và mục không áp
    // dụng cho lần chạy này bị bỏ khỏi bộ kiểm tra (không chấm, không NOT_RUN).
    const configuredSegments = cleanSegments(item.segments);
    if (item.segments !== undefined && configuredSegments === null) {
      warnings.push(`segments của "${id}" không phải mảng; dùng phạm vi mặc định.`);
    }
    const segments = configuredSegments && configuredSegments.length > 0
      ? configuredSegments
      : fallback?.segments ?? [];
    const configuredProducts = Array.isArray(item.products)
      ? item.products.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()).slice(0, 20)
      : null;
    const products = configuredProducts && configuredProducts.length > 0
      ? configuredProducts
      : fallback?.products ?? [];

    if (!checkAppliesTo({ segments, products }, segmentKey, productCode)) {
      continue;
    }

    const severityRaw = typeof item.severity === 'string' ? item.severity.toUpperCase() : '';
    const severity = (SEVERITIES as readonly string[]).includes(severityRaw)
      ? severityRaw as RuleResult['severity']
      : fallback?.severity ?? 'REVIEW';

    const actionRaw = typeof item.action === 'string' ? item.action.toLowerCase() : '';
    let action: AccountCheckAction = actionRaw === 'block' || actionRaw === 'warn'
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

    const rawInput = Array.isArray(item.input)
      ? item.input.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()).slice(0, 20)
      : null;

    checks.push({
      id,
      name: cleanString(item.name, MAX_NAME_LENGTH) ?? fallback?.name ?? id,
      kind,
      enabled: item.enabled === undefined ? fallback?.enabled ?? true : item.enabled !== false,
      segments,
      products,
      input: rawInput && rawInput.length > 0 ? rawInput : fallback?.input ?? [],
      action,
      severity,
      exception_allowed: item.exception_allowed === undefined
        ? fallback?.exception_allowed ?? false
        : item.exception_allowed === true,
      version: cleanString(item.version, 40) ?? fallback?.version ?? '1.0.0',
      ...(params ? { params } : {}),
      ...(prompt ? { prompt } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
    });
  }

  if (checks.length === 0) {
    warnings.push(`Không còn mục kiểm tra hợp lệ cho phân khúc ${segmentKey}; dùng bộ kiểm tra mặc định.`);
    return { checkSet: fallbackSet, warnings };
  }

  return {
    checkSet: {
      program: cleanString(source.program, 80) ?? fallbackSet.program,
      version: cleanString(source.version, 40) ?? fallbackSet.version,
      source: 'PROFILE',
      output_schema: ACCOUNT_CHECK_OUTPUT_SCHEMA,
      segment_key: segmentKey,
      product_code: productCode,
      checks,
    },
    warnings,
  };
}

/** Ngưỡng policy do Profile cấu hình (ghi đè AccountOpeningPolicy). */
export interface AccountPolicyOverrides {
  minimumAgeYears?: number;
  maximumAgeYears?: number;
  minimumIdValidityDays?: number;
  beneficialOwnerThresholdPercent?: number;
  minimumBeneficialOwnerCoveragePercent?: number;
  minimumAuthorizedSignatories?: number;
}

export function parsePolicyOverrides(raw: unknown): { overrides: AccountPolicyOverrides; warnings: string[] } {
  const warnings: string[] = [];
  const source = asRecord(raw);
  if (!source) {
    if (raw !== undefined && raw !== null && raw !== '') warnings.push('account_policy không phải object; dùng ngưỡng mặc định.');
    return { overrides: {}, warnings };
  }

  const overrides: AccountPolicyOverrides = {};
  const integerFields = new Set<keyof AccountPolicyOverrides>([
    'minimumAgeYears',
    'maximumAgeYears',
    'minimumIdValidityDays',
    'minimumAuthorizedSignatories',
  ]);
  const numericFields: Array<{ key: keyof AccountPolicyOverrides; param: keyof typeof POLICY_RANGES }> = [
    { key: 'minimumAgeYears', param: 'minimum_age_years' },
    { key: 'maximumAgeYears', param: 'maximum_age_years' },
    { key: 'minimumIdValidityDays', param: 'minimum_id_validity_days' },
    { key: 'beneficialOwnerThresholdPercent', param: 'beneficial_owner_threshold_percent' },
    { key: 'minimumBeneficialOwnerCoveragePercent', param: 'minimum_beneficial_owner_coverage_percent' },
    { key: 'minimumAuthorizedSignatories', param: 'minimum_authorized_signatories' },
  ];

  for (const field of numericFields) {
    const range = POLICY_RANGES[field.param];
    const rawValue = source[field.param];
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const numeric = cleanNumberInRange(rawValue, range);
    if (numeric === null) {
      warnings.push(`account_policy.${field.param} ngoài khoảng [${range.min}, ${range.max}]; giữ ngưỡng mặc định.`);
      continue;
    }
    overrides[field.key] = integerFields.has(field.key) ? Math.round(numeric) : numeric;
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
  if (!source) return invalid('account_check_set.value phải là object.');
  if (source.program !== undefined && cleanString(source.program, 80) === null) {
    return invalid('account_check_set.program phải là chuỗi không rỗng, tối đa 80 ký tự.');
  }
  if (source.version !== undefined && cleanString(source.version, 40) === null) {
    return invalid('account_check_set.version phải là chuỗi không rỗng, tối đa 40 ký tự.');
  }
  if (!Array.isArray(source.checks)) return invalid('account_check_set.checks phải là mảng.');
  if (source.checks.length === 0) return invalid('account_check_set.checks không được rỗng.');
  if (source.checks.length > MAX_CHECKS) return invalid(`account_check_set.checks tối đa ${MAX_CHECKS} mục.`);

  const seen = new Set<string>();
  for (const rawCheck of source.checks) {
    const item = asRecord(rawCheck);
    if (!item) return invalid('Mỗi mục trong account_check_set.checks phải là object.');
    const id = cleanString(item.id, MAX_ID_LENGTH);
    if (!id) return invalid(`Mục kiểm tra thiếu id hợp lệ (tối đa ${MAX_ID_LENGTH} ký tự).`);
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
    if (item.segments !== undefined) {
      if (!Array.isArray(item.segments)) return invalid(`segments của "${id}" phải là mảng phân khúc.`);
      const invalidSegment = item.segments.find((entry) => typeof entry !== 'string'
        || !(SEGMENT_KEYS as readonly string[]).includes(entry.trim().toUpperCase()));
      if (invalidSegment !== undefined) {
        return invalid(`segments của "${id}" chỉ nhận ${SEGMENT_KEYS.join(', ')}.`);
      }
    }
    if (item.products !== undefined) {
      if (!Array.isArray(item.products)) return invalid(`products của "${id}" phải là mảng chuỗi mã sản phẩm.`);
      if (item.products.length > 20) return invalid(`products của "${id}" tối đa 20 mục.`);
      if (item.products.some((entry) => typeof entry !== 'string' || !entry.trim())) {
        return invalid(`products của "${id}" chỉ nhận chuỗi mã sản phẩm không rỗng.`);
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
      for (const [key, rawValue] of Object.entries(params)) {
        const range = PARAM_RANGES[key];
        if (!range) return invalid(`Tham số "${key}" của "${id}" không được hỗ trợ.`);
        if (cleanNumberInRange(rawValue, range) === null) {
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
    } else if (item.prompt !== undefined && String(item.prompt).trim() !== '') {
      return invalid(`"${id}" là rule engine nên không nhận prompt; chỉ cấu hình tham số.`);
    }
  }
  return { ok: true };
}

export function validatePolicyValue(value: unknown): ConfigValidation {
  const source = asRecord(value);
  if (!source) return invalid('account_policy.value phải là object.');
  for (const [key, rawValue] of Object.entries(source)) {
    const range = (POLICY_RANGES as Record<string, { min: number; max: number }>)[key];
    if (!range) return invalid(`account_policy."${key}" không được hỗ trợ.`);
    if (cleanNumberInRange(rawValue, range) === null) {
      return invalid(`account_policy.${key} phải là số trong [${range.min}, ${range.max}].`);
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

const AUDITED_CHECK_FIELDS = [
  'enabled', 'action', 'severity', 'exception_allowed', 'threshold', 'params',
  'name', 'version', 'segments', 'products',
] as const;

/** So sánh hai giá trị account_check_set thô. Trả null khi không có thay đổi. */
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
  return `account_check_set(${parts.join(' ')})`;
}

/** So sánh hai giá trị account_policy thô. Ngưỡng policy không phải bí mật nên ghi cả giá trị. */
export function summarizePolicyChange(before: unknown, after: unknown): string | null {
  const previous = asRecord(before) ?? {};
  const next = asRecord(after) ?? {};
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])];
  const parts = keys
    .filter((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(next[key] ?? null))
    .map((key) => `${key}:${JSON.stringify(previous[key] ?? null)}→${JSON.stringify(next[key] ?? null)}`);
  return parts.length > 0 ? `account_policy(${parts.join(' ')})` : null;
}

/** Danh sách kiểm tra áp dụng cho phân khúc, dùng cho UI cấu hình /profiles. */
export function catalogForSegment(segmentKey: CustomerSegmentKey): AccountCheckDefinition[] {
  return ACCOUNT_CHECK_CATALOG.filter((definition) => definition.segments.length === 0
    || definition.segments.includes(segmentKey));
}
