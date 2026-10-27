'use client';

// Bộ kiểm tra hồ sơ mở tài khoản cho workflow account-opening.
//
// Khác với loan-appraisal: mỗi kiểm tra có PHẠM VI theo phân khúc (KHCN/HKD/SME/
// KHDN) và tuỳ chọn theo sản phẩm. Runtime lọc catalog theo phân khúc + sản phẩm
// của lần chạy, nên panel phải cho admin thấy cả phạm vi, kèm bộ xem trước để
// biết một phân khúc cụ thể sẽ chạy những rule nào.
//
// Hai loại kiểm tra:
//   - Rule engine (tham số): phép so sánh nằm trong code, chỉ cấu hình ngưỡng.
//   - Rule LLM (prompt): cấu hình prompt + ngưỡng tin cậy, chạy qua connector.
//
// Panel ghi vào paramsObj hai key `account_check_set` và `account_policy` nên
// được saveSettings + dirty-tracking của ProfileEndpointCard bao phủ sẵn. Khi
// cấu hình trùng mặc định thì key bị xoá để Profile không giữ bản sao dư thừa.

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Code, FileStack, FlaskConical, Layers, Loader2, ShieldCheck, Sparkles, Wand2, X } from 'lucide-react';
import {
  ACCOUNT_CHECK_CATALOG,
  DETERMINISTIC_CHECK_IDS,
  MAX_CHECKS,
  MAX_NAME_LENGTH,
  MAX_PROMPT_LENGTH,
  PARAM_RANGES,
  POLICY_RANGES,
  checkAppliesTo,
  type AccountCheckDefinition,
} from '@/lib/pipelines/workflows/account-opening/check-set';
import {
  documentCatalogForProduct,
  MAX_DESCRIPTION_LENGTH,
  MAX_DOCUMENT_OVERRIDES,
  MAX_LABEL_LENGTH,
} from '@/lib/pipelines/workflows/account-opening/document-catalog';
import { ACCOUNT_PRODUCTS, type ProfileGroup } from '@/lib/pipelines/workflows/prompts/account-opening-prompts';
import {
  accountPolicyDefaults,
  listAccountOpeningPolicies,
} from '@/lib/pipelines/workflows/account-opening/segment-policy';

type ParamsObj = Record<string, { value: any; isLocked: boolean }>;
type SegmentKey = AccountCheckDefinition['segments'][number];
type PanelTab = 'overview' | 'documents' | 'engine' | 'prompt' | 'policy';

const PANEL_NAV: Array<{ key: PanelTab; label: string; icon: typeof Layers }> = [
  { key: 'overview', label: 'Tổng quan', icon: Layers },
  { key: 'documents', label: 'Danh mục chứng từ', icon: FileStack },
  { key: 'engine', label: 'Rule engine', icon: ShieldCheck },
  { key: 'prompt', label: 'Rule LLM', icon: Sparkles },
  { key: 'policy', label: 'Ngưỡng policy', icon: Code },
];

const SEVERITY_OPTIONS = ['BLOCKER', 'EXCEPTION', 'REVIEW', 'INFO'] as const;
const SEGMENT_OPTIONS: Array<{ key: SegmentKey; label: string }> = [
  { key: 'KHCN', label: 'KHCN — cá nhân' },
  { key: 'HKD', label: 'HKD — hộ kinh doanh' },
  { key: 'SME', label: 'SME — doanh nghiệp nhỏ' },
  { key: 'KHDN', label: 'KHDN — doanh nghiệp lớn' },
];

const PRODUCT_OPTIONS = listAccountOpeningPolicies().map((policy) => ({
  code: policy.productCode,
  segmentKey: policy.segmentKey,
  label: `${policy.segmentKey} · ${policy.productCode}`,
}));

const CHECK_SET_PROGRAM = 'account-opening';
const CHECK_SET_VERSION = '1.0.0';

/** Tham số mà mỗi rule engine sử dụng. Rule engine không có prompt. */
interface ParamSpec {
  key: keyof typeof PARAM_RANGES;
  label: string;
  hint: string;
  step: number;
  /** Field trên policy sản phẩm dùng làm giá trị mặc định khi để trống. */
  policyField: 'minimumIdValidityDays' | 'minimumAgeYears' | 'maximumAgeYears' | 'minimumBeneficialOwnerCoveragePercent' | 'minimumAuthorizedSignatories';
}

const DETERMINISTIC_PARAMS: Record<string, ParamSpec[]> = {
  'AO.INTAKE.REQUIRED_DOCUMENTS': [],
  'AO.IDENTITY.DOCUMENT_VALIDITY': [
    { key: 'minimum_days', label: 'Hiệu lực còn lại tối thiểu (ngày)', hint: 'Giấy tờ định danh phải còn ít nhất số ngày này', step: 1, policyField: 'minimumIdValidityDays' },
  ],
  'AO.ELIGIBILITY.MIN_AGE': [
    { key: 'minimum_age', label: 'Tuổi tối thiểu', hint: 'Chủ tài khoản hoặc người đại diện', step: 1, policyField: 'minimumAgeYears' },
    { key: 'maximum_age', label: 'Tuổi tối đa', hint: 'Để trống = không giới hạn', step: 1, policyField: 'maximumAgeYears' },
  ],
  'AO.OWNERSHIP.BENEFICIAL_OWNER_DISCLOSURE': [
    { key: 'minimum_percent', label: 'Độ phủ sở hữu tối thiểu (%)', hint: 'Tổng tỷ lệ sở hữu phải kê khai được', step: 1, policyField: 'minimumBeneficialOwnerCoveragePercent' },
  ],
  'AO.AUTHORIZATION.SIGNATORY_REGISTERED': [
    { key: 'minimum_count', label: 'Số người ký tối thiểu', hint: 'Người đại diện / được ủy quyền trên tài khoản', step: 1, policyField: 'minimumAuthorizedSignatories' },
  ],
  'AO.RISK.DUE_DILIGENCE_LEVEL': [],
};

const POLICY_FIELDS: Array<{
  param: keyof typeof POLICY_RANGES;
  label: string;
  hint: string;
  step: number;
  policyField: ParamSpec['policyField'] | 'beneficialOwnerThresholdPercent';
}> = [
  { param: 'minimum_age_years', label: 'Tuổi tối thiểu', hint: 'Áp cho chủ tài khoản hoặc người đại diện', step: 1, policyField: 'minimumAgeYears' },
  { param: 'maximum_age_years', label: 'Tuổi tối đa', hint: 'Để trống = không giới hạn', step: 1, policyField: 'maximumAgeYears' },
  { param: 'minimum_id_validity_days', label: 'Hiệu lực giấy tờ tối thiểu (ngày)', hint: 'Dùng cho rule DOCUMENT_VALIDITY khi rule không khai tham số riêng', step: 1, policyField: 'minimumIdValidityDays' },
  { param: 'beneficial_owner_threshold_percent', label: 'Ngưỡng phải kê khai chủ sở hữu (%)', hint: 'Sở hữu từ mức này trở lên phải kê khai; 0 = không áp dụng', step: 1, policyField: 'beneficialOwnerThresholdPercent' },
  { param: 'minimum_beneficial_owner_coverage_percent', label: 'Độ phủ sở hữu yêu cầu (%)', hint: 'Tổng tỷ lệ sở hữu kê khai được', step: 1, policyField: 'minimumBeneficialOwnerCoveragePercent' },
  { param: 'minimum_authorized_signatories', label: 'Số người ký tối thiểu', hint: 'Chỉ áp dụng cho khách hàng tổ chức', step: 1, policyField: 'minimumAuthorizedSignatories' },
];

const PROFILE_GROUP_OPTIONS: Array<{ key: ProfileGroup; label: string }> = [
  { key: 'identity', label: 'Định danh' },
  { key: 'contact', label: 'Liên hệ' },
  { key: 'organization', label: 'Tổ chức' },
  { key: 'authorization', label: 'Ủy quyền' },
  { key: 'ownership', label: 'Sở hữu' },
  { key: 'compliance', label: 'Tuân thủ' },
  { key: 'account', label: 'Tài khoản' },
];

/** Field admin được sửa trên một document key đã có trong danh mục mặc định. */
interface EditableDocument {
  key: string;
  /** Nhãn/mô tả/nhóm gốc trong code — dùng làm placeholder khi override để trống. */
  defaultLabel: string;
  defaultDescription: string;
  defaultGroup: ProfileGroup;
  defaultRequired: boolean;
  presetKey: string;
  presetDescription: string;
  enabled: boolean;
  required: boolean;
  label: string;
  description: string;
  group: ProfileGroup;
}

interface EditableCheck extends AccountCheckDefinition {
  /** Rule do admin thêm — được phép đổi id và xoá. Rule mặc định thì không. */
  isCustom: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanSegments(value: unknown, fallback: SegmentKey[]): SegmentKey[] {
  if (!Array.isArray(value)) return fallback;
  const valid = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is SegmentKey => SEGMENT_OPTIONS.some((option) => option.key === entry));
  return valid.length > 0 ? [...new Set(valid)] : fallback;
}

/**
 * Hợp nhất cấu hình đã lưu với catalog mặc định. Luôn liệt kê đủ rule trong
 * catalog để admin thấy hết những gì có thể áp dụng, kể cả rule bị tắt.
 */
function readChecks(paramsObj: ParamsObj): EditableCheck[] {
  const saved = asRecord(paramsObj.account_check_set?.value);
  const savedChecks = Array.isArray(saved?.checks) ? saved!.checks : [];
  const catalogById = new Map(ACCOUNT_CHECK_CATALOG.map((check) => [check.id, check]));
  const result: EditableCheck[] = [];
  const seen = new Set<string>();

  for (const raw of savedChecks) {
    const item = asRecord(raw);
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!item || !id || seen.has(id)) continue;
    seen.add(id);
    const fallback = catalogById.get(id);
    const isDeterministic = (DETERMINISTIC_CHECK_IDS as readonly string[]).includes(id);
    const params = asRecord(item.params);
    result.push({
      id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : fallback?.name ?? id,
      kind: isDeterministic ? 'DETERMINISTIC' : 'PROMPT',
      enabled: item.enabled !== false,
      segments: cleanSegments(item.segments, fallback?.segments ?? SEGMENT_OPTIONS.map((option) => option.key)),
      products: Array.isArray(item.products)
        ? item.products.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim())
        : fallback?.products ?? [],
      input: Array.isArray(item.input)
        ? item.input.filter((entry): entry is string => typeof entry === 'string')
        : fallback?.input ?? [],
      action: item.action === 'block' ? 'block' : 'warn',
      severity: SEVERITY_OPTIONS.includes(String(item.severity).toUpperCase() as typeof SEVERITY_OPTIONS[number])
        ? String(item.severity).toUpperCase() as EditableCheck['severity']
        : fallback?.severity ?? 'REVIEW',
      exception_allowed: item.exception_allowed === true,
      version: typeof item.version === 'string' && item.version.trim() ? item.version.trim() : fallback?.version ?? '1.0.0',
      ...(isDeterministic && params
        ? { params: Object.fromEntries(Object.entries(params).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) }
        : {}),
      ...(isDeterministic ? {} : {
        prompt: typeof item.prompt === 'string' ? item.prompt : fallback?.prompt ?? '',
        threshold: typeof item.threshold === 'number' ? item.threshold : fallback?.threshold ?? 0.85,
      }),
      isCustom: !fallback,
    });
  }

  for (const fallback of ACCOUNT_CHECK_CATALOG) {
    if (seen.has(fallback.id)) continue;
    result.push({ ...fallback, isCustom: false });
  }
  return result;
}

function readPolicy(paramsObj: ParamsObj): Record<string, string> {
  const saved = asRecord(paramsObj.account_policy?.value) ?? {};
  const state: Record<string, string> = {};
  for (const field of POLICY_FIELDS) {
    const value = saved[field.param];
    state[field.param] = typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  }
  return state;
}

/**
 * Đọc danh mục chứng từ đã lưu CHO MỘT SẢN PHẨM CỤ THỂ, hợp nhất với danh mục
 * mặc định trong code của sản phẩm đó. Cấu hình lưu chung một key `account_document_catalog`
 * scope theo `productCode`; đổi sản phẩm xem trước thì đọc lại danh mục tương ứng.
 */
function readDocumentCatalog(paramsObj: ParamsObj, productCode: string): EditableDocument[] {
  const product = ACCOUNT_PRODUCTS[productCode];
  if (!product) return [];
  const defaults = documentCatalogForProduct(product);
  const saved = asRecord(paramsObj.account_document_catalog?.value);
  const savedProductCode = typeof saved?.productCode === 'string' ? saved.productCode.trim() : '';
  // Cấu hình đã lưu cho sản phẩm KHÁC thì không áp cho sản phẩm đang xem trước.
  const savedDocuments = savedProductCode === productCode && Array.isArray(saved?.documents) ? saved!.documents : [];
  const overridesByKey = new Map<string, Record<string, unknown>>();
  for (const raw of savedDocuments) {
    const item = asRecord(raw);
    const key = typeof item?.key === 'string' ? item.key.trim() : '';
    if (item && key) overridesByKey.set(key, item);
  }

  return defaults.map((doc) => {
    const override = overridesByKey.get(doc.key);
    return {
      key: doc.key,
      defaultLabel: doc.label,
      defaultDescription: doc.description,
      defaultGroup: doc.group,
      defaultRequired: doc.required,
      presetKey: doc.presetKey,
      presetDescription: doc.presetDescription,
      enabled: override?.enabled !== false,
      required: typeof override?.required === 'boolean' ? override.required : doc.required,
      label: typeof override?.label === 'string' && override.label.trim() ? override.label.trim() : doc.label,
      description: typeof override?.description === 'string' && override.description.trim() ? override.description.trim() : doc.description,
      group: PROFILE_GROUP_OPTIONS.some((option) => option.key === override?.group) ? override!.group as ProfileGroup : doc.group,
    };
  });
}

/** Serialize CHỈ những field khác mặc định, để cấu hình gọn và audit dễ đọc. */
function serializeDocumentCatalog(documents: EditableDocument[]): Array<Record<string, unknown>> {
  const changed: Array<Record<string, unknown>> = [];
  for (const doc of documents) {
    const patch: Record<string, unknown> = {};
    if (!doc.enabled) patch.enabled = false;
    if (doc.required !== doc.defaultRequired) patch.required = doc.required;
    if (doc.label !== doc.defaultLabel) patch.label = doc.label;
    if (doc.description !== doc.defaultDescription) patch.description = doc.description;
    if (doc.group !== doc.defaultGroup) patch.group = doc.group;
    if (Object.keys(patch).length > 0) changed.push({ key: doc.key, ...patch });
  }
  return changed;
}

function serializeChecks(checks: EditableCheck[]) {
  return checks.map((check) => ({
    id: check.id,
    name: check.name,
    kind: check.kind,
    enabled: check.enabled,
    segments: check.segments,
    products: check.products,
    input: check.input,
    action: check.action,
    severity: check.severity,
    exception_allowed: check.exception_allowed,
    version: check.version,
    ...(check.kind === 'DETERMINISTIC' && check.params && Object.keys(check.params).length > 0
      ? { params: check.params }
      : {}),
    ...(check.kind === 'PROMPT'
      ? { prompt: check.prompt ?? '', threshold: check.threshold ?? 0.85 }
      : {}),
  }));
}

const DEFAULT_CHECKS_SERIALIZED = JSON.stringify(
  serializeChecks(ACCOUNT_CHECK_CATALOG.map((check) => ({ ...check, isCustom: false }))),
);

/** Cảnh báo phản chiếu đúng ràng buộc runtime của parseCheckSet. */
function checkWarnings(check: EditableCheck): string[] {
  const warnings: string[] = [];
  if (check.segments.length === 0) {
    warnings.push('Chưa chọn phân khúc nào — rule sẽ không áp dụng cho lần chạy nào.');
  }
  if (check.kind === 'PROMPT') {
    if (!check.prompt?.trim()) warnings.push('Thiếu prompt — rule sẽ bị bỏ khi chạy.');
    if ((check.prompt?.length ?? 0) > MAX_PROMPT_LENGTH) warnings.push(`Prompt vượt ${MAX_PROMPT_LENGTH} ký tự.`);
    if (check.action === 'block' && check.severity !== 'BLOCKER') {
      warnings.push('Rule LLM chỉ chặn được khi severity = BLOCKER; runtime sẽ hạ về warn.');
    }
    const threshold = check.threshold ?? 0.85;
    if (threshold < 0 || threshold > 1) warnings.push('Ngưỡng tin cậy phải trong khoảng 0..1.');
  } else {
    for (const spec of DETERMINISTIC_PARAMS[check.id] ?? []) {
      const value = check.params?.[spec.key];
      if (value === undefined) continue;
      const range = PARAM_RANGES[spec.key];
      if (value < range.min || value > range.max) {
        warnings.push(`${spec.label} phải trong [${range.min}, ${range.max}]; ngoài khoảng sẽ dùng ngưỡng policy.`);
      }
    }
  }
  return warnings;
}

export default function AccountCheckSetPanel({
  endpoint,
  paramsObj,
  setParamsObj,
  canManageEndpoints,
  syncKey,
  previewProduct: previewProductProp,
  onPreviewProductChange,
}: {
  endpoint: { slug: string; displayName?: string };
  paramsObj: ParamsObj;
  setParamsObj: React.Dispatch<React.SetStateAction<ParamsObj>>;
  canManageEndpoints: boolean;
  syncKey: string;
  /**
   * Sản phẩm dùng để xem trước rule/checklist. Truyền từ ngoài (VD thanh chọn
   * cố định của trang) để đồng bộ với phần còn lại của UI cha; không truyền thì
   * panel tự quản state này như trước (giữ tương thích ngược).
   */
  previewProduct?: string;
  onPreviewProductChange?: (productCode: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<PanelTab>('overview');
  const [checks, setChecks] = useState<EditableCheck[]>(() => readChecks(paramsObj));
  const [policy, setPolicy] = useState<Record<string, string>>(() => readPolicy(paramsObj));
  // Bộ xem trước: chọn phân khúc/sản phẩm để biết lần chạy đó áp những rule nào.
  // Danh mục chứng từ scope theo ĐÚNG sản phẩm này (khác check set là scope theo tập segments/products).
  const [internalPreviewProduct, setInternalPreviewProduct] = useState<string>(PRODUCT_OPTIONS[0]?.code ?? '');
  const previewProduct = previewProductProp ?? internalPreviewProduct;
  const setPreviewProduct = onPreviewProductChange ?? setInternalPreviewProduct;
  const [documents, setDocuments] = useState<EditableDocument[]>(() => readDocumentCatalog(paramsObj, previewProduct));
  const [wizardOpen, setWizardOpen] = useState<Record<string, boolean>>({});
  const [wizardProblem, setWizardProblem] = useState<Record<string, string>>({});
  const [wizardLoading, setWizardLoading] = useState<Record<string, boolean>>({});
  const [wizardResult, setWizardResult] = useState<Record<string, string>>({});

  useEffect(() => {
    setActiveTab('overview');
    setChecks(readChecks(paramsObj));
    setPolicy(readPolicy(paramsObj));
    const initialProduct = PRODUCT_OPTIONS[0]?.code ?? '';
    setPreviewProduct(initialProduct);
    setDocuments(readDocumentCatalog(paramsObj, initialProduct));
    setWizardOpen({});
    setWizardProblem({});
    setWizardLoading({});
    setWizardResult({});
    // syncKey chỉ đổi khi Profile hoặc endpoint đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  // Danh mục chứng từ được cấu hình riêng cho từng sản phẩm; đổi sản phẩm xem
  // trước thì phải đọc lại catalog tương ứng, không giữ state của sản phẩm cũ.
  useEffect(() => {
    setDocuments(readDocumentCatalog(paramsObj, previewProduct));
    // Chỉ đọc lại khi đổi sản phẩm xem trước hoặc khi syncKey đổi (đã xử lý ở effect trên);
    // không phụ thuộc paramsObj để tránh vòng lặp với effect đồng bộ ngược phía dưới.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewProduct]);

  // Đồng bộ check set xuống paramsObj. Trùng mặc định thì xoá key.
  useEffect(() => {
    if (!canManageEndpoints) return;
    setParamsObj((previous) => {
      const serialized = serializeChecks(checks);
      const isDefault = JSON.stringify(serialized) === DEFAULT_CHECKS_SERIALIZED;
      const nextValue = isDefault
        ? null
        : { program: CHECK_SET_PROGRAM, version: CHECK_SET_VERSION, checks: serialized };
      const currentJson = JSON.stringify(previous.account_check_set?.value ?? null);
      if (currentJson === JSON.stringify(nextValue)) return previous;
      const next = { ...previous };
      if (!nextValue) delete next.account_check_set;
      // Bộ kiểm tra do admin quản trị: khoá để client không ghi đè khi gọi API.
      else next.account_check_set = { value: nextValue, isLocked: previous.account_check_set?.isLocked ?? true };
      return next;
    });
  }, [checks, canManageEndpoints, setParamsObj]);

  // Đồng bộ ngưỡng policy. Chỉ ghi các field có giá trị số hợp lệ.
  useEffect(() => {
    if (!canManageEndpoints) return;
    setParamsObj((previous) => {
      const collected: Record<string, number> = {};
      for (const field of POLICY_FIELDS) {
        const raw = policy[field.param];
        if (raw === undefined || raw.trim() === '') continue;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) continue;
        collected[field.param] = parsed;
      }
      const nextValue = Object.keys(collected).length > 0 ? collected : null;
      const currentJson = JSON.stringify(previous.account_policy?.value ?? null);
      if (currentJson === JSON.stringify(nextValue)) return previous;
      const next = { ...previous };
      if (!nextValue) delete next.account_policy;
      else next.account_policy = { value: nextValue, isLocked: previous.account_policy?.isLocked ?? true };
      return next;
    });
  }, [policy, canManageEndpoints, setParamsObj]);

  // Đồng bộ danh mục chứng từ của sản phẩm đang xem trước. Trùng mặc định (không
  // có field nào khác) thì xoá key — nhưng chỉ khi key đó đang thuộc CHÍNH sản
  // phẩm này; cấu hình của sản phẩm khác (nếu còn sót từ trước) không bị xoá nhầm.
  useEffect(() => {
    if (!canManageEndpoints) return;
    setParamsObj((previous) => {
      const changedDocuments = serializeDocumentCatalog(documents);
      const savedProductCode = typeof asRecord(previous.account_document_catalog?.value)?.productCode === 'string'
        ? (asRecord(previous.account_document_catalog?.value)!.productCode as string).trim()
        : '';
      if (changedDocuments.length === 0) {
        // Không còn override nào cho sản phẩm này — chỉ xoá key nếu nó đang scope
        // đúng sản phẩm đang xem trước; nếu key thuộc sản phẩm khác thì giữ nguyên.
        if (savedProductCode !== previewProduct) return previous;
        const next = { ...previous };
        delete next.account_document_catalog;
        return next;
      }
      const nextValue = { version: '1.0.0', productCode: previewProduct, documents: changedDocuments };
      const currentJson = JSON.stringify(previous.account_document_catalog?.value ?? null);
      if (currentJson === JSON.stringify(nextValue)) return previous;
      const next = { ...previous };
      next.account_document_catalog = { value: nextValue, isLocked: previous.account_document_catalog?.isLocked ?? true };
      return next;
    });
  }, [documents, previewProduct, canManageEndpoints, setParamsObj]);

  const updateDocument = (key: string, patch: Partial<EditableDocument>) => {
    if (!canManageEndpoints) return;
    setDocuments((previous) => previous.map((doc) => doc.key === key ? { ...doc, ...patch } : doc));
  };

  const resetDocumentsToDefault = () => {
    if (!canManageEndpoints) return;
    setDocuments(readDocumentCatalog({}, previewProduct));
  };

  const updateCheck = (id: string, patch: Partial<EditableCheck>) => {
    if (!canManageEndpoints) return;
    setChecks((previous) => previous.map((check) => check.id === id ? { ...check, ...patch } : check));
  };

  const toggleSegment = (id: string, segment: SegmentKey) => {
    if (!canManageEndpoints) return;
    setChecks((previous) => previous.map((check) => {
      if (check.id !== id) return check;
      const has = check.segments.includes(segment);
      const segments = has
        ? check.segments.filter((entry) => entry !== segment)
        : [...check.segments, segment];
      return { ...check, segments };
    }));
  };

  const toggleProduct = (id: string, productCode: string) => {
    if (!canManageEndpoints) return;
    setChecks((previous) => previous.map((check) => {
      if (check.id !== id) return check;
      const has = check.products.includes(productCode);
      const products = has
        ? check.products.filter((entry) => entry !== productCode)
        : [...check.products, productCode];
      return { ...check, products };
    }));
  };

  const updateParam = (id: string, key: string, raw: string) => {
    if (!canManageEndpoints) return;
    setChecks((previous) => previous.map((check) => {
      if (check.id !== id) return check;
      const params = { ...(check.params ?? {}) };
      const parsed = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(parsed)) delete params[key];
      else params[key] = parsed;
      return { ...check, params: Object.keys(params).length > 0 ? params : undefined };
    }));
  };

  const addPromptCheck = () => {
    if (!canManageEndpoints) return;
    if (checks.length >= MAX_CHECKS) {
      toast.error(`Tối đa ${MAX_CHECKS} kiểm tra trong một bộ.`);
      return;
    }
    const existingIds = new Set(checks.map((check) => check.id));
    let index = checks.filter((check) => check.isCustom).length + 1;
    let id = `AO.CUSTOM.CHECK_${index}`;
    while (existingIds.has(id)) { index += 1; id = `AO.CUSTOM.CHECK_${index}`; }
    setChecks((previous) => [...previous, {
      id,
      name: `Kiểm tra tuỳ chỉnh ${index}`,
      kind: 'PROMPT',
      enabled: true,
      // Mặc định áp cho mọi phân khúc; admin thu hẹp lại theo nhu cầu.
      segments: SEGMENT_OPTIONS.map((option) => option.key),
      products: [],
      input: [],
      action: 'warn',
      severity: 'REVIEW',
      exception_allowed: false,
      version: '1.0.0',
      prompt: '',
      threshold: 0.85,
      isCustom: true,
    }]);
  };

  const removeCheck = (id: string) => {
    if (!canManageEndpoints) return;
    setChecks((previous) => previous.filter((check) => check.id !== id));
  };

  const resetToDefault = () => {
    if (!canManageEndpoints) return;
    setChecks(ACCOUNT_CHECK_CATALOG.map((check) => ({ ...check, isCustom: false })));
    setPolicy(Object.fromEntries(POLICY_FIELDS.map((field) => [field.param, ''])));
  };

  const runWizard = async (check: EditableCheck) => {
    setWizardLoading((previous) => ({ ...previous, [check.id]: true }));
    setWizardResult((previous) => ({ ...previous, [check.id]: '' }));
    try {
      const response = await fetch('/api/internal/prompt-wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPrompt: check.prompt ?? '',
          problem: wizardProblem[check.id] ?? '',
          metadata: {
            endpointName: endpoint.displayName,
            endpointSlug: endpoint.slug,
            checkId: check.id,
            checkName: check.name,
            segments: check.segments.join(','),
          },
        }),
      });
      const data = await response.json();
      if (data.success) setWizardResult((previous) => ({ ...previous, [check.id]: data.upgradedPrompt }));
      else toast.error(data.error ?? 'Lỗi không xác định');
    } catch {
      toast.error('Lỗi kết nối khi gọi Prompt Wizard');
    } finally {
      setWizardLoading((previous) => ({ ...previous, [check.id]: false }));
    }
  };

  const engineChecks = useMemo(() => checks.filter((check) => check.kind === 'DETERMINISTIC'), [checks]);
  const promptChecks = useMemo(() => checks.filter((check) => check.kind === 'PROMPT'), [checks]);
  const enabledCount = checks.filter((check) => check.enabled).length;
  // Backend (check-set.ts) reject fail-closed khi rule LLM enabled thiếu prompt —
  // chặn/cảnh báo sớm ở đây để không phải đợi lỗi từ API sau khi bấm Lưu.
  const checksMissingPrompt = checks.filter(
    (check) => check.kind === 'PROMPT' && check.enabled && !check.prompt?.trim(),
  );
  const isDocumentsCustomized = serializeDocumentCatalog(documents).length > 0;
  const isCustomized = JSON.stringify(serializeChecks(checks)) !== DEFAULT_CHECKS_SERIALIZED
    || POLICY_FIELDS.some((field) => (policy[field.param] ?? '').trim() !== '')
    || isDocumentsCustomized;
  const remainingRequiredDocuments = documents.filter((doc) => doc.enabled && doc.required).length;

  const previewSegment = PRODUCT_OPTIONS.find((option) => option.code === previewProduct)?.segmentKey;
  // Xem trước phản chiếu đúng logic checkAppliesTo của runtime.
  const previewChecks = useMemo(() => {
    if (!previewSegment) return [];
    return checks.filter((check) => check.enabled && checkAppliesTo(check, previewSegment, previewProduct));
  }, [checks, previewSegment, previewProduct]);
  const previewDefaults = accountPolicyDefaults(previewProduct);

  const renderCheckCard = (check: EditableCheck) => {
    const isEngine = check.kind === 'DETERMINISTIC';
    const specs = isEngine ? DETERMINISTIC_PARAMS[check.id] ?? [] : [];
    const warnings = checkWarnings(check);
    const appliesToPreview = previewSegment ? checkAppliesTo(check, previewSegment, previewProduct) : false;

    return (
      <div
        key={check.id}
        className={`rounded-xl border overflow-hidden transition-all ${check.enabled
          ? isEngine
            ? 'border-emerald-200/70 dark:border-emerald-900/60 bg-background'
            : 'border-violet-200/70 dark:border-violet-900/60 bg-background'
          : 'border-border bg-muted/30 opacity-70'}`}
      >
        <div className="px-4 py-3 flex items-start justify-between gap-3 bg-muted/30 border-b border-border/30">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm ${isEngine
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                : 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'}`}>
                {isEngine ? 'Rule engine (tham số)' : 'Rule LLM (prompt)'}
              </span>
              <span className="text-[10px] font-mono bg-background border px-1.5 py-0.5 rounded text-muted-foreground">{check.id}</span>
              <span className="text-[10px] text-muted-foreground">v{check.version}</span>
              {check.isCustom && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 px-2 py-0.5 rounded-sm">
                  Tuỳ chỉnh
                </span>
              )}
              {check.enabled && previewSegment && (
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm ${appliesToPreview
                  ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                  {appliesToPreview ? `Áp cho ${previewSegment}` : `Không áp cho ${previewSegment}`}
                </span>
              )}
            </div>
            <input
              value={check.name}
              maxLength={MAX_NAME_LENGTH}
              disabled={!canManageEndpoints}
              onChange={(event) => updateCheck(check.id, { name: event.target.value })}
              aria-label={`Tên kiểm tra ${check.id}`}
              className="mt-1.5 w-full bg-transparent text-sm font-bold text-foreground outline-none border-b border-transparent focus:border-border disabled:cursor-not-allowed"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={check.enabled}
                disabled={!canManageEndpoints}
                onChange={(event) => updateCheck(check.id, { enabled: event.target.checked })}
                aria-label={`Bật kiểm tra ${check.name}`}
              />
              <div className={`relative h-5 w-9 rounded-full transition-colors ${check.enabled ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700'}
                after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:bg-white after:rounded-full after:transition-all
                peer-checked:after:translate-x-full peer-disabled:opacity-60`} />
              <span className="text-[11px] font-semibold text-muted-foreground">{check.enabled ? 'Đang áp dụng' : 'Đã tắt'}</span>
            </label>
            {canManageEndpoints && check.isCustom && (
              <button
                type="button"
                onClick={() => removeCheck(check.id)}
                className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                title="Xoá kiểm tra tuỳ chỉnh"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* PHẠM VI ÁP DỤNG — điểm khác biệt chính so với workflow thẩm định vay */}
          <div className="border border-sky-200 dark:border-sky-900 rounded-lg p-3 bg-sky-50/40 dark:bg-sky-950/20">
            <p className="text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400 flex items-center gap-1">
              <Layers className="w-3 h-3" /> Phạm vi áp dụng
            </p>
            <div className="mt-2">
              <p className="text-[11px] text-muted-foreground mb-1.5">Phân khúc (bắt buộc chọn ít nhất một)</p>
              <div className="flex flex-wrap gap-1.5">
                {SEGMENT_OPTIONS.map((option) => {
                  const active = check.segments.includes(option.key);
                  return (
                    <button
                      key={option.key}
                      type="button"
                      disabled={!canManageEndpoints}
                      aria-pressed={active}
                      onClick={() => toggleSegment(check.id, option.key)}
                      title={option.label}
                      className={`px-2 py-1 text-[11px] font-semibold rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${active
                        ? 'border-sky-400 bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
                    >
                      {option.key}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-3">
              <p className="text-[11px] text-muted-foreground mb-1.5">
                Sản phẩm — để trống nghĩa là áp cho MỌI sản phẩm của các phân khúc đã chọn
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PRODUCT_OPTIONS.filter((option) => check.segments.includes(option.segmentKey)).map((option) => {
                  const active = check.products.includes(option.code);
                  return (
                    <button
                      key={option.code}
                      type="button"
                      disabled={!canManageEndpoints}
                      aria-pressed={active}
                      onClick={() => toggleProduct(check.id, option.code)}
                      className={`px-2 py-1 text-[10px] font-mono rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${active
                        ? 'border-indigo-400 bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
                    >
                      {option.code}
                    </button>
                  );
                })}
              </div>
              {check.products.length > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5">
                  Đang giới hạn {check.products.length} sản phẩm — các sản phẩm khác trong cùng phân khúc sẽ KHÔNG chạy rule này.
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mức độ</span>
              <select
                value={check.severity}
                disabled={!canManageEndpoints}
                onChange={(event) => updateCheck(check.id, { severity: event.target.value as EditableCheck['severity'] })}
                className="input-field mt-1 py-1.5 text-xs font-mono disabled:opacity-70"
              >
                {SEVERITY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hành động</span>
              <select
                value={check.action}
                disabled={!canManageEndpoints}
                onChange={(event) => updateCheck(check.id, { action: event.target.value === 'block' ? 'block' : 'warn' })}
                className="input-field mt-1 py-1.5 text-xs font-mono disabled:opacity-70"
              >
                <option value="warn">warn — cảnh báo, không chặn</option>
                <option value="block">block — chặn khi không đạt</option>
              </select>
            </label>
            <label className="flex items-center gap-2 mt-5 select-none">
              <input
                type="checkbox"
                checked={check.exception_allowed}
                disabled={!canManageEndpoints}
                onChange={(event) => updateCheck(check.id, { exception_allowed: event.target.checked })}
                className="w-4 h-4 accent-indigo-600"
              />
              <span className="text-xs text-foreground">Cho phép ngoại lệ (phê duyệt vượt)</span>
            </label>
          </div>

          {isEngine ? (
            <div className="border border-emerald-200 dark:border-emerald-900 rounded-lg p-3 bg-emerald-50/40 dark:bg-emerald-950/20">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Tham số
              </p>
              {specs.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 mt-2">
                  {specs.map((spec) => {
                    const range = PARAM_RANGES[spec.key];
                    const defaultValue = previewDefaults?.[spec.policyField];
                    return (
                      <label key={spec.key} className="block">
                        <span className="text-xs text-foreground">{spec.label}</span>
                        <input
                          type="number"
                          step={spec.step}
                          min={range.min}
                          max={range.max}
                          value={check.params?.[spec.key] ?? ''}
                          disabled={!canManageEndpoints}
                          onChange={(event) => updateParam(check.id, spec.key, event.target.value)}
                          placeholder={defaultValue === null || defaultValue === undefined
                            ? 'Để trống = dùng ngưỡng policy'
                            : `Để trống = ngưỡng policy (${defaultValue.toLocaleString('vi-VN')})`}
                          className="input-field mt-1 py-1.5 text-xs font-mono disabled:opacity-70"
                        />
                        <span className="text-[11px] text-muted-foreground">{spec.hint} · khoảng hợp lệ [{range.min}, {range.max}]</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Kiểm tra này không có tham số ngưỡng; nó đối chiếu trực tiếp trạng thái checklist hoặc mức rủi ro đã chấm.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">
                Phép so sánh nằm trong code TypeScript nên kết quả tái lập 100%. Không cấu hình được prompt cho loại này.
              </p>
            </div>
          ) : (
            <div className="border border-violet-200 dark:border-violet-900 rounded-lg p-3 bg-violet-50/40 dark:bg-violet-950/20 space-y-3">
              <div className="flex items-end justify-between gap-3 flex-wrap">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-400">Ngưỡng tin cậy</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    max={1}
                    value={check.threshold ?? 0.85}
                    disabled={!canManageEndpoints}
                    onChange={(event) => updateCheck(check.id, { threshold: Number(event.target.value) })}
                    className="input-field mt-1 py-1.5 text-xs font-mono w-32 disabled:opacity-70"
                  />
                </label>
                <p className="text-[11px] text-muted-foreground flex-1 min-w-[220px]">
                  Dưới ngưỡng này kết quả bị hạ xuống <strong>cần rà soát</strong>, không bao giờ tự kết luận không đạt.
                </p>
                {canManageEndpoints && (
                  <button
                    type="button"
                    onClick={() => setWizardOpen((previous) => ({ ...previous, [check.id]: !previous[check.id] }))}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-violet-200 dark:border-violet-800 bg-background hover:bg-violet-100/60 dark:hover:bg-violet-900/40 transition-colors"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-violet-500" />
                    {wizardOpen[check.id] ? 'Đóng Wizard' : 'Prompt Wizard'}
                  </button>
                )}
              </div>

              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-400">Prompt kiểm tra</span>
                <textarea
                  value={check.prompt ?? ''}
                  maxLength={MAX_PROMPT_LENGTH}
                  disabled={!canManageEndpoints}
                  onChange={(event) => updateCheck(check.id, { prompt: event.target.value })}
                  spellCheck={false}
                  className="input-field mt-1 py-2 text-xs font-mono min-h-[140px] resize-y disabled:opacity-70"
                  placeholder="Nêu rõ cần đối chiếu gì, giữa chứng từ nào, và khi nào coi là mâu thuẫn thực chất..."
                />
                <span className="text-[11px] text-muted-foreground">
                  {(check.prompt ?? '').length}/{MAX_PROMPT_LENGTH} ký tự. Runtime tự gắn phân khúc, Customer Profile, danh sách evidence và schema output.
                </span>
              </label>

              {wizardOpen[check.id] && (
                <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-background p-3 space-y-2">
                  <textarea
                    value={wizardProblem[check.id] ?? ''}
                    onChange={(event) => setWizardProblem((previous) => ({ ...previous, [check.id]: event.target.value }))}
                    rows={2}
                    className="input-field py-2 text-xs resize-none"
                    placeholder="Vấn đề đang gặp (tuỳ chọn). VD: model hay bỏ sót người đại diện được ủy quyền..."
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={wizardLoading[check.id]}
                      onClick={() => runWizard(check)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                    >
                      {wizardLoading[check.id]
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang nâng cấp...</>
                        : <><Sparkles className="w-3.5 h-3.5" /> Nâng cấp prompt</>}
                    </button>
                  </div>
                  {wizardResult[check.id] && (
                    <div className="space-y-2">
                      <pre className="text-[11px] font-mono bg-muted/50 border border-border rounded-lg p-3 whitespace-pre-wrap max-h-56 overflow-y-auto">
                        {wizardResult[check.id]}
                      </pre>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setWizardResult((previous) => ({ ...previous, [check.id]: '' }))}
                          className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                        >
                          Huỷ
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            updateCheck(check.id, { prompt: wizardResult[check.id] });
                            setWizardResult((previous) => ({ ...previous, [check.id]: '' }));
                            setWizardOpen((previous) => ({ ...previous, [check.id]: false }));
                            toast.success('Đã áp dụng prompt mới. Nhớ bấm Lưu Toàn bộ Thiết lập.');
                          }}
                          className="px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                        >
                          Áp dụng prompt này
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {check.input.length > 0 && (
            <details className="group">
              <summary className="text-xs font-semibold text-muted-foreground cursor-pointer w-fit hover:text-foreground flex items-center gap-1.5">
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                Nguồn dữ liệu kiểm tra
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {check.input.map((entry) => (
                  <span key={entry} className="text-[11px] font-mono bg-muted px-2 py-0.5 rounded border border-border/50 text-muted-foreground">{entry}</span>
                ))}
              </div>
            </details>
          )}

          {warnings.length > 0 && (
            <ul className="space-y-1">
              {warnings.map((warning) => (
                <li key={warning} className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                  <FlaskConical className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  const tabBadge = (tab: PanelTab): { label: string; tone: 'amber' | 'rose' } | null => {
    if (tab === 'prompt' && checksMissingPrompt.length > 0) return { label: String(checksMissingPrompt.length), tone: 'rose' };
    if (tab === 'documents' && (isDocumentsCustomized || remainingRequiredDocuments === 0)) {
      return remainingRequiredDocuments === 0 ? { label: '!', tone: 'rose' } : { label: '•', tone: 'amber' };
    }
    if (tab === 'policy' && POLICY_FIELDS.some((field) => (policy[field.param] ?? '').trim() !== '')) return { label: '•', tone: 'amber' };
    return null;
  };

  const tabMeta = (tab: PanelTab): string => {
    switch (tab) {
      case 'overview': return `${previewChecks.length} rule áp dụng cho sản phẩm đang xem`;
      case 'documents': return `${documents.length} loại · ${remainingRequiredDocuments} bắt buộc`;
      case 'engine': return `${engineChecks.length} kiểm tra bằng code`;
      case 'prompt': return `${promptChecks.length} kiểm tra bằng prompt`;
      case 'policy': return `${POLICY_FIELDS.filter((field) => (policy[field.param] ?? '').trim() !== '').length}/${POLICY_FIELDS.length} ngưỡng đã ghi đè`;
      default: return '';
    }
  };

  // previewProductProp có nghĩa là trang cha đã dựng thanh chọn Profile/sản phẩm/
  // Lưu riêng ở trên cùng — panel không cần lặp lại khối đó nữa, chỉ còn sidebar
  // + nội dung. Không truyền thì panel tự vẽ khối chọn sản phẩm như bản cũ.
  const controlledPreview = previewProductProp !== undefined;

  return (
    <div className={controlledPreview ? '' : 'space-y-5'}>
      {!controlledPreview && (
        <div className="rounded-2xl border border-border bg-background p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-base font-bold text-foreground">
                <ShieldCheck className="w-4.5 h-4.5 text-emerald-600" />
                Bộ kiểm tra hồ sơ mở tài khoản
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {engineChecks.length} rule engine · {promptChecks.length} rule LLM · {enabledCount} đang áp dụng
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isCustomized && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded-sm">
                  Khác mặc định
                </span>
              )}
              {checksMissingPrompt.length > 0 && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 px-2 py-0.5 rounded-sm">
                  {checksMissingPrompt.length} rule thiếu prompt
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-sky-200/70 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 px-4 py-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1"><Layers className="w-3 h-3" /> Sản phẩm xem trước</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Quyết định rule/checklist hiển thị ở các khu vực bên dưới.</p>
            </div>
            <select
              value={previewProduct}
              onChange={(event) => setPreviewProduct(event.target.value)}
              className="input-field py-1.5 text-xs font-mono min-w-[260px]"
            >
              {PRODUCT_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Sidebar dọc + nội dung khu vực đang chọn */}
      <div className="grid gap-5 lg:grid-cols-[248px_minmax(0,1fr)] lg:items-start">
        <nav className="lg:sticky lg:top-4 rounded-2xl border border-border bg-background p-3" aria-label="Khu vực cấu hình">
          <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Khu vực cấu hình</p>
          <div className="space-y-1" role="tablist" aria-label="Khu vực cấu hình" aria-orientation="vertical">
            {PANEL_NAV.map((tab) => {
              const isActive = activeTab === tab.key;
              const badge = tabBadge(tab.key);
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    isActive
                      ? 'bg-indigo-50 dark:bg-indigo-950/40'
                      : 'hover:bg-muted/60'
                  }`}
                >
                  {isActive && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-indigo-500" />}
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground'}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs font-semibold ${isActive ? 'text-indigo-900 dark:text-indigo-200' : 'text-foreground'}`}>{tab.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{tabMeta(tab.key)}</span>
                  </span>
                  {badge && (
                    <span className={`mt-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-bold ${
                      badge.tone === 'rose'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                    }`}>
                      {badge.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {canManageEndpoints && (
            <>
              <div className="my-3 border-t border-border" />
              <button
                type="button"
                onClick={resetToDefault}
                className="w-full rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                title="Bỏ toàn bộ tuỳ chỉnh, quay về bộ kiểm tra mặc định trong code"
              >
                Về bộ mặc định
                <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground/80">Bỏ toàn bộ tuỳ chỉnh của Profile này</span>
              </button>
            </>
          )}
        </nav>

        <div className="min-w-0 space-y-4">
      {/* ── Khu vực: Tổng quan & xem trước ─────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/50 rounded-lg p-3 text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed flex gap-2 items-start">
            <Code className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <strong className="text-emerald-900 dark:text-emerald-100">Rule có phạm vi theo phân khúc và sản phẩm.</strong>{' '}
              Mỗi lần chạy, runtime lọc catalog theo <code className="font-mono">segment</code> +{' '}
              <code className="font-mono">product_code</code> của hồ sơ, nên KHCN không bị chấm bằng rule chủ sở hữu hưởng lợi của SME.{' '}
              <em>Rule engine</em> so sánh bằng code, chỉ cấu hình ngưỡng — không thêm rule engine mới từ cấu hình.{' '}
              <em>Rule LLM</em> chạy prompt trên dữ liệu đã bóc tách, buộc phải dẫn evidence và mặc định chỉ cảnh báo.
            </div>
          </div>

          <div className="rounded-xl border border-sky-200/70 dark:border-sky-900/60 bg-background overflow-hidden">
            <div className="px-4 py-3 bg-muted/30 border-b border-border/30">
              <p className="text-sm font-bold flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-sky-500" /> Rule áp dụng cho sản phẩm đang xem trước</p>
            </div>
            <div className="p-4">
              <p className="text-xs text-foreground">
                <strong>{previewChecks.length}</strong> rule sẽ chạy cho phân khúc{' '}
                <strong>{previewSegment}</strong> · sản phẩm <code className="font-mono text-[11px]">{previewProduct}</code>{' '}
                ({previewChecks.filter((check) => check.kind === 'DETERMINISTIC').length} rule engine ·{' '}
                {previewChecks.filter((check) => check.kind === 'PROMPT').length} rule LLM)
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {previewChecks.map((check) => (
                  <span
                    key={check.id}
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${check.kind === 'DETERMINISTIC'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300'}`}
                  >
                    {check.id}
                  </span>
                ))}
                {previewChecks.length === 0 && (
                  <span className="text-[11px] text-amber-700 dark:text-amber-400">
                    Không rule nào áp dụng — hồ sơ của phân khúc này sẽ không được kiểm tra.
                  </span>
                )}
              </div>
              {previewDefaults && (
                <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border/40">
                  Ngưỡng mặc định của sản phẩm: tuổi ≥ {previewDefaults.minimumAgeYears} ·
                  hiệu lực giấy tờ ≥ {previewDefaults.minimumIdValidityDays} ngày ·
                  {previewDefaults.beneficialOwnerThresholdPercent > 0
                    ? ` kê khai chủ sở hữu từ ${previewDefaults.beneficialOwnerThresholdPercent}% (phủ ${previewDefaults.minimumBeneficialOwnerCoveragePercent}%) ·`
                    : ' không áp dụng chủ sở hữu hưởng lợi ·'}
                  {' '}người ký ≥ {previewDefaults.minimumAuthorizedSignatories} ·
                  rủi ro nền {previewDefaults.baselineRiskLevel}
                  {previewDefaults.requiresEnhancedDueDiligence ? ' · luôn yêu cầu EDD' : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Ngưỡng policy ──────────────────────────────────────────────── */}
      {activeTab === 'policy' && (
        <div className="rounded-xl border border-sky-200/70 dark:border-sky-900/60 bg-background overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="px-4 py-3 bg-muted/30 border-b border-border/30">
            <p className="text-sm font-bold">Ngưỡng policy ghi đè</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ngưỡng ở đây áp cho MỌI sản phẩm chạy qua Profile này. Để trống = giữ ngưỡng mặc định riêng của từng sản phẩm
              (xem tab Tổng quan). Rule engine dùng các ngưỡng này khi không khai tham số riêng.
            </p>
          </div>
          <div className="p-4 grid gap-3 sm:grid-cols-2">
            {POLICY_FIELDS.map((field) => {
              const range = POLICY_RANGES[field.param];
              const defaultValue = previewDefaults
                ? previewDefaults[field.policyField as keyof typeof previewDefaults]
                : null;
              return (
                <label key={field.param} className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">{field.label}</span>
                  <input
                    type="number"
                    step={field.step}
                    min={range.min}
                    max={range.max}
                    value={policy[field.param] ?? ''}
                    disabled={!canManageEndpoints}
                    onChange={(event) => setPolicy((previous) => ({ ...previous, [field.param]: event.target.value }))}
                    placeholder={typeof defaultValue === 'number'
                      ? `${previewProduct}: ${defaultValue.toLocaleString('vi-VN')}`
                      : 'Không giới hạn / không áp dụng'}
                    className="input-field mt-1 py-1.5 text-xs font-mono disabled:opacity-70"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {field.hint} · khoảng hợp lệ [{range.min.toLocaleString('vi-VN')}, {range.max.toLocaleString('vi-VN')}]
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tab: Danh mục chứng từ ──────────────────────────────────────────── */}
      {activeTab === 'documents' && (
          <div className="rounded-xl border border-sky-200/70 dark:border-sky-900/60 bg-background overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="px-4 py-3 bg-muted/30 border-b border-border/30">
              <p className="text-sm font-bold flex items-center gap-1.5"><FileStack className="w-3.5 h-3.5 text-sky-500" /> Danh mục chứng từ (checklist)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Áp dụng cho sản phẩm <code className="font-mono">{previewProduct}</code> đang chọn ở{' '}
                {controlledPreview ? 'thanh cấu hình phía trên' : 'khối chọn sản phẩm phía trên'}.
                Chỉ có thể bật/tắt một loại chứng từ trong danh mục, đổi bắt buộc/tùy chọn, hoặc đổi nhãn/mô tả/nhóm hiển thị.
              </p>
            </div>
            <div className="bg-sky-50/50 dark:bg-sky-950/20 border-b border-border/30 px-4 py-2.5 text-[11px] text-sky-800 dark:text-sky-300 leading-relaxed flex gap-2 items-start">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>Không cấu hình được schema OCR (preset) và không tạo được loại chứng từ mới.</strong> Nhiều rule ở
                engine dò field theo mẫu cố định trên đúng những key này (ngày sinh, ngày hết hạn, tỷ lệ sở hữu...); đổi
                preset hoặc thêm key lạ sẽ khiến chỉ tiêu liên quan âm thầm rơi về &ldquo;thiếu dữ liệu&rdquo; mà không có
                cảnh báo nào khi chạy.
              </span>
            </div>
            <div className="p-4 grid gap-3 sm:grid-cols-2">
              {documents.map((doc) => {
                const isDefault = doc.enabled === true && doc.required === doc.defaultRequired
                  && doc.label === doc.defaultLabel && doc.description === doc.defaultDescription && doc.group === doc.defaultGroup;
                return (
                  <div
                    key={doc.key}
                    className={`flex h-full flex-col rounded-lg border overflow-hidden transition-all ${doc.enabled
                      ? 'border-border bg-background'
                      : 'border-border bg-muted/30 opacity-70'}`}
                  >
                    <div className="px-3 py-2.5 flex items-start justify-between gap-3 bg-muted/20">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono bg-background border px-1.5 py-0.5 rounded text-muted-foreground">{doc.key}</span>
                          <span className="text-[10px] text-muted-foreground" title={doc.presetDescription}>preset: {doc.presetKey}</span>
                          {!isDefault && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 px-2 py-0.5 rounded-sm">
                              Khác mặc định
                            </span>
                          )}
                        </div>
                        <input
                          value={doc.label}
                          maxLength={MAX_LABEL_LENGTH}
                          disabled={!canManageEndpoints || !doc.enabled}
                          onChange={(event) => updateDocument(doc.key, { label: event.target.value })}
                          aria-label={`Nhãn chứng từ ${doc.key}`}
                          className="mt-1.5 w-full bg-transparent text-sm font-bold text-foreground outline-none border-b border-transparent focus:border-border disabled:cursor-not-allowed"
                        />
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <label className="flex items-center gap-1.5 select-none">
                          <input
                            type="checkbox"
                            checked={doc.required}
                            disabled={!canManageEndpoints || !doc.enabled}
                            onChange={(event) => updateDocument(doc.key, { required: event.target.checked })}
                            className="w-3.5 h-3.5 accent-rose-600"
                          />
                          <span className="text-[11px] text-foreground">Bắt buộc</span>
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={doc.enabled}
                            disabled={!canManageEndpoints}
                            onChange={(event) => updateDocument(doc.key, { enabled: event.target.checked })}
                            aria-label={`Bật chứng từ ${doc.key}`}
                          />
                          <div className={`relative h-5 w-9 rounded-full transition-colors ${doc.enabled ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700'}
                            after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:bg-white after:rounded-full after:transition-all
                            peer-checked:after:translate-x-full peer-disabled:opacity-60`} />
                        </label>
                      </div>
                    </div>
                    {doc.enabled && (
                      <div className="p-3 space-y-2.5">
                        <label className="block">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mô tả (đưa vào prompt phân loại)</span>
                          <textarea
                            value={doc.description}
                            maxLength={MAX_DESCRIPTION_LENGTH}
                            disabled={!canManageEndpoints}
                            onChange={(event) => updateDocument(doc.key, { description: event.target.value })}
                            rows={2}
                            className="input-field mt-1 py-1.5 text-xs resize-y disabled:opacity-70"
                          />
                        </label>
                        <label className="block max-w-xs">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nhóm hiển thị (Customer Profile)</span>
                          <select
                            value={doc.group}
                            disabled={!canManageEndpoints}
                            onChange={(event) => updateDocument(doc.key, { group: event.target.value as ProfileGroup })}
                            className="input-field mt-1 py-1.5 text-xs disabled:opacity-70"
                          >
                            {PROFILE_GROUP_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
              {documents.length === 0 && (
                <p className="text-xs text-muted-foreground">Sản phẩm này chưa có danh mục chứng từ nào trong code.</p>
              )}
            </div>
            <div className="px-4 pb-4 flex flex-wrap items-center justify-between gap-3">
              {remainingRequiredDocuments === 0 ? (
                <p className="text-[11px] text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                  <FlaskConical className="w-3.5 h-3.5 shrink-0" /> Không còn chứng từ bắt buộc nào — cấu hình này sẽ bị từ chối khi lưu.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">{remainingRequiredDocuments} chứng từ bắt buộc đang áp dụng.</p>
              )}
              {canManageEndpoints && isDocumentsCustomized && (
                <button
                  type="button"
                  onClick={resetDocumentsToDefault}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Bỏ tuỳ chỉnh danh mục chứng từ của sản phẩm này, quay về mặc định trong code"
                >
                  Về danh mục mặc định
                </button>
              )}
            </div>
          </div>
      )}

      {/* ── Tab: Rule engine & Rule LLM ─────────────────────────────────────── */}
      {/* ── Khu vực: Rule engine ─────────────────────────────────────────────── */}
      {activeTab === 'engine' && (
        <div className="grid gap-3 lg:grid-cols-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {engineChecks.map(renderCheckCard)}
          {engineChecks.length === 0 && (
            <p className="text-xs text-muted-foreground lg:col-span-2">Không có rule engine nào trong bộ kiểm tra hiện tại.</p>
          )}
        </div>
      )}

      {/* ── Khu vực: Rule LLM ────────────────────────────────────────────────── */}
      {activeTab === 'prompt' && (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="grid gap-3 lg:grid-cols-2">
            {promptChecks.map(renderCheckCard)}
          </div>

          {canManageEndpoints && (
            <button
              type="button"
              onClick={addPromptCheck}
              className="px-3 py-1.5 text-xs font-bold bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 rounded-lg hover:bg-violet-200 dark:hover:bg-violet-900/70 transition-colors"
            >
              + Thêm rule LLM
            </button>
          )}

          {checksMissingPrompt.length > 0 && (
            <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-800/50 rounded-lg p-3 text-xs text-rose-700 dark:text-rose-300 flex gap-2 items-start">
              <FlaskConical className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>
                <strong>Chưa thể lưu:</strong> {checksMissingPrompt.length} rule LLM đang áp dụng chưa có prompt
                ({checksMissingPrompt.map((check) => check.name).join(', ')}). Điền prompt hoặc tắt (Áp dụng: Không)
                các rule này trước khi nhấn <strong>&ldquo;Lưu Toàn bộ Thiết lập&rdquo;</strong> — hệ thống sẽ từ chối lưu
                rule LLM không có prompt để tránh rule âm thầm không chạy.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Cảnh báo chung — hiện ở mọi khu vực vì áp dụng cho toàn bộ cấu hình, không riêng khu vực nào */}
      {isCustomized && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/50 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300 flex gap-2 items-center">
          <FlaskConical className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            Cấu hình đang khác mặc định. Nhấn <strong>&ldquo;Lưu Toàn bộ Thiết lập&rdquo;</strong> để ghi vào Profile
            (tham số <code className="font-mono">account_check_set</code>, <code className="font-mono">account_policy</code>
            {isDocumentsCustomized ? <>, <code className="font-mono">account_document_catalog</code></> : null}).
          </span>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
