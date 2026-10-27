// Danh mục loại chứng từ (checklist) cấu hình được cho workflow mở tài khoản,
// theo PHÂN KHÚC và SẢN PHẨM.
//
// Ranh giới an toàn — đọc kỹ trước khi mở rộng:
//   Cấu hình được: bật/tắt một document key đã có trong catalog gốc cho một sản
//   phẩm cụ thể, đổi required, đổi label/description hiển thị, đổi group hiển thị
//   trên Customer Profile.
//
//   KHÔNG cấu hình được: presetKey (schema OCR field), và KHÔNG thể tạo document
//   key hoàn toàn mới. Lý do: nhiều nơi trong engine tham chiếu presetKey/field
//   bên trong nó bằng REGEX cố định trên field_path (xem *_PATTERNS trong
//   strategies.ts — DOB_PATTERNS, EXPIRY_PATTERNS, CHARTER_CAPITAL_PATTERNS...),
//   và bằng docTypes filter cố định (identityDocument, authorizationKeys,
//   ownershipKeys trong CddRiskStrategy/EligibilityStrategy). Đổi presetKey của
//   một key đã có, hoặc thêm key mới không được các rule này biết tới, sẽ khiến
//   metric/rule liên quan âm thầm rơi về INSUFFICIENT_DATA mà không có lỗi nào
//   được ném ra — đây là loại "silent regression" module này cố tránh.
//
// Vì vậy: catalog chỉ có thể BỚT phạm vi hoặc đổi NHÃN của những gì code đã biết,
// không thể mở rộng logic. Cùng nguyên tắc với check-set.ts (không tạo rule
// engine mới từ config).
//
// Nguồn cấu hình: ProfileEndpoint.parameters.account_document_catalog → merge
// vào ctx.pipelineVars. Đọc khoan dung (mục sai bị bỏ + warning), ghi fail-closed
// (API trả lỗi rõ ràng) — như mọi cấu hình khác của workflow này.

import { EXTRACT_PRESETS } from '@/lib/endpoints/presets';
import {
  ACCOUNT_PRODUCTS,
  type AccountProduct,
  type CustomerSegmentKey,
  type DocRequirement,
  type ProfileGroup,
} from '../prompts/account-opening-prompts';

const PROFILE_GROUPS: readonly ProfileGroup[] = [
  'identity', 'contact', 'organization', 'authorization', 'ownership', 'compliance', 'account',
];

/** Field admin được sửa trên một document key đã có trong catalog gốc của sản phẩm. */
export interface DocumentOverride {
  key: string;
  /** Không set = giữ nguyên required gốc của sản phẩm. */
  required?: boolean;
  /** Không set = giữ nguyên enabled gốc (true). false = loại khỏi checklist sản phẩm này. */
  enabled?: boolean;
  label?: string;
  description?: string;
  group?: ProfileGroup;
}

export interface DocumentCatalogOverride {
  version: string;
  source: 'DEFAULT' | 'PROFILE';
  /** Áp cho một sản phẩm cụ thể; không set nghĩa là áp cho mọi sản phẩm của segment. */
  productCode?: string;
  documents: DocumentOverride[];
}

export const MAX_DOCUMENT_OVERRIDES = 40;
export const MAX_LABEL_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 1_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function isProfileGroup(value: unknown): value is ProfileGroup {
  return typeof value === 'string' && (PROFILE_GROUPS as readonly string[]).includes(value);
}

/** Toàn bộ document key có cài đặt sẵn trong code, gộp từ mọi sản phẩm. */
function knownDocumentKeys(): Map<string, DocRequirement> {
  const map = new Map<string, DocRequirement>();
  for (const product of Object.values(ACCOUNT_PRODUCTS)) {
    for (const doc of product.requiredDocs) {
      if (!map.has(doc.key)) map.set(doc.key, doc);
    }
  }
  return map;
}

/**
 * Áp override lên checklist gốc của một sản phẩm. Chỉ sửa field cho phép; không
 * bao giờ thêm document mới hay đổi presetKey — override cho key lạ bị bỏ qua
 * (không throw, vì đây là đường đọc runtime).
 */
export function applyDocumentOverrides(
  baseDocs: DocRequirement[],
  overrides: DocumentOverride[],
): DocRequirement[] {
  const byKey = new Map(overrides.map((item) => [item.key, item]));
  const result: DocRequirement[] = [];
  for (const doc of baseDocs) {
    const override = byKey.get(doc.key);
    if (!override) { result.push(doc); continue; }
    if (override.enabled === false) continue;
    result.push({
      ...doc,
      required: override.required ?? doc.required,
      label: override.label ?? doc.label,
      description: override.description ?? doc.description,
      group: override.group ?? doc.group,
    });
  }
  return result;
}

/**
 * Đọc danh mục chứng từ đã cấu hình cho phân khúc + sản phẩm đang chạy, áp lên
 * checklist gốc của sản phẩm. Không bao giờ throw: hồ sơ vẫn phải chạy được với
 * checklist mặc định trong code.
 */
export function resolveDocumentRequirements(
  raw: unknown,
  product: AccountProduct,
): { requiredDocs: DocRequirement[]; warnings: string[] } {
  const warnings: string[] = [];
  const source = asRecord(raw);
  if (!source) {
    if (raw !== undefined && raw !== null && raw !== '') {
      warnings.push('account_document_catalog không phải object; dùng danh mục chứng từ mặc định.');
    }
    return { requiredDocs: product.requiredDocs, warnings };
  }

  const configuredProduct = cleanString(source.productCode, 80);
  if (configuredProduct && configuredProduct !== product.code) {
    // Cấu hình cho sản phẩm khác — không áp dụng cho lần chạy này, không phải lỗi.
    return { requiredDocs: product.requiredDocs, warnings };
  }

  const rawDocuments = Array.isArray(source.documents) ? source.documents : null;
  if (!rawDocuments) {
    warnings.push('account_document_catalog.documents không phải mảng; dùng danh mục chứng từ mặc định.');
    return { requiredDocs: product.requiredDocs, warnings };
  }
  if (rawDocuments.length > MAX_DOCUMENT_OVERRIDES) {
    warnings.push(`account_document_catalog.documents vượt ${MAX_DOCUMENT_OVERRIDES} mục; chỉ nhận ${MAX_DOCUMENT_OVERRIDES} mục đầu.`);
  }

  const known = knownDocumentKeys();
  const productKeys = new Set(product.requiredDocs.map((doc) => doc.key));
  const seen = new Set<string>();
  const overrides: DocumentOverride[] = [];

  for (const rawItem of rawDocuments.slice(0, MAX_DOCUMENT_OVERRIDES)) {
    const item = asRecord(rawItem);
    if (!item) { warnings.push('Bỏ một mục danh mục không phải object.'); continue; }
    const key = cleanString(item.key, 120);
    if (!key) { warnings.push('Bỏ một mục danh mục thiếu key hợp lệ.'); continue; }
    if (seen.has(key)) { warnings.push(`Bỏ mục danh mục trùng key "${key}".`); continue; }
    seen.add(key);

    if (!known.has(key)) {
      warnings.push(`"${key}" không có trong danh mục chứng từ đã cài đặt trong code; cấu hình không tạo được document key mới.`);
      continue;
    }
    if (!productKeys.has(key)) {
      // Key hợp lệ ở sản phẩm khác nhưng không thuộc sản phẩm đang chạy — bỏ qua âm thầm,
      // không phải lỗi cấu hình (admin có thể quản lý một catalog dùng chung nhiều sản phẩm).
      continue;
    }

    const enabled = item.enabled === undefined ? undefined : item.enabled !== false;
    const required = typeof item.required === 'boolean' ? item.required : undefined;
    const label = item.label !== undefined ? cleanString(item.label, MAX_LABEL_LENGTH) ?? undefined : undefined;
    if (item.label !== undefined && label === undefined) warnings.push(`label của "${key}" không hợp lệ; giữ nhãn mặc định.`);
    const description = item.description !== undefined ? cleanString(item.description, MAX_DESCRIPTION_LENGTH) ?? undefined : undefined;
    if (item.description !== undefined && description === undefined) warnings.push(`description của "${key}" không hợp lệ; giữ mô tả mặc định.`);
    const group = isProfileGroup(item.group) ? item.group : undefined;
    if (item.group !== undefined && group === undefined) warnings.push(`group của "${key}" không hợp lệ; giữ nhóm mặc định.`);

    overrides.push({ key, ...(enabled !== undefined ? { enabled } : {}), ...(required !== undefined ? { required } : {}), ...(label ? { label } : {}), ...(description ? { description } : {}), ...(group ? { group } : {}) });
  }

  if (overrides.length === 0) {
    return { requiredDocs: product.requiredDocs, warnings };
  }

  const requiredDocs = applyDocumentOverrides(product.requiredDocs, overrides);
  if (requiredDocs.filter((doc) => doc.required).length === 0) {
    warnings.push('Cấu hình khiến danh mục không còn chứng từ bắt buộc nào; dùng danh mục chứng từ mặc định.');
    return { requiredDocs: product.requiredDocs, warnings };
  }
  return { requiredDocs, warnings };
}

// ─── Validate khi ghi cấu hình từ /profiles ───────────────────────────────────
// resolveDocumentRequirements ở trên cố ý khoan dung (bỏ mục sai, chạy tiếp) vì
// runtime không được đổ vì cấu hình. Đường ghi thì ngược lại: fail-closed, trả
// lỗi rõ ràng để admin không lưu được cấu hình sai rồi tưởng là đã áp dụng.

export type ConfigValidation = { ok: true } | { ok: false; error: string };

function invalid(error: string): ConfigValidation {
  return { ok: false, error };
}

export function validateDocumentCatalogValue(value: unknown): ConfigValidation {
  const source = asRecord(value);
  if (!source) return invalid('account_document_catalog.value phải là object.');
  if (source.version !== undefined && cleanString(source.version, 40) === null) {
    return invalid('account_document_catalog.version phải là chuỗi không rỗng, tối đa 40 ký tự.');
  }
  if (source.productCode !== undefined) {
    const productCode = cleanString(source.productCode, 80);
    if (!productCode) return invalid('account_document_catalog.productCode phải là chuỗi không rỗng, tối đa 80 ký tự.');
    if (!ACCOUNT_PRODUCTS[productCode]) return invalid(`account_document_catalog.productCode "${productCode}" không tồn tại.`);
  }
  if (!Array.isArray(source.documents)) return invalid('account_document_catalog.documents phải là mảng.');
  if (source.documents.length === 0) return invalid('account_document_catalog.documents không được rỗng.');
  if (source.documents.length > MAX_DOCUMENT_OVERRIDES) {
    return invalid(`account_document_catalog.documents tối đa ${MAX_DOCUMENT_OVERRIDES} mục.`);
  }

  const known = knownDocumentKeys();
  const scopedProductCode = cleanString(source.productCode, 80);
  const scopedProduct = scopedProductCode ? ACCOUNT_PRODUCTS[scopedProductCode] : null;
  const allowedKeys = scopedProduct
    ? new Set(scopedProduct.requiredDocs.map((doc) => doc.key))
    : null;

  const seen = new Set<string>();
  for (const rawItem of source.documents) {
    const item = asRecord(rawItem);
    if (!item) return invalid('Mỗi mục trong account_document_catalog.documents phải là object.');
    const key = cleanString(item.key, 120);
    if (!key) return invalid('Mỗi mục danh mục phải có key hợp lệ (tối đa 120 ký tự).');
    if (seen.has(key)) return invalid(`Trùng key danh mục "${key}".`);
    seen.add(key);

    if (!known.has(key)) {
      return invalid(`"${key}" không có trong danh mục chứng từ đã cài đặt trong code; không tạo được document key mới.`);
    }
    if (allowedKeys && !allowedKeys.has(key)) {
      return invalid(`"${key}" không thuộc sản phẩm "${scopedProductCode}"; chọn key khác hoặc bỏ productCode để áp cho mọi sản phẩm phù hợp.`);
    }
    // presetKey của document đã có KHÔNG được cấu hình lại — chặn tường minh dù
    // client không nên gửi field này, để lỗi rõ ràng hơn là bị âm thầm bỏ qua.
    if (item.presetKey !== undefined) {
      return invalid(`"${key}": không cấu hình được presetKey. Schema OCR (field bóc tách) cố định trong code vì nhiều rule tham chiếu theo field cố định.`);
    }
    if (item.required !== undefined && typeof item.required !== 'boolean') {
      return invalid(`required của "${key}" phải là boolean.`);
    }
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') {
      return invalid(`enabled của "${key}" phải là boolean.`);
    }
    if (item.label !== undefined && cleanString(item.label, MAX_LABEL_LENGTH) === null) {
      return invalid(`label của "${key}" phải là chuỗi không rỗng, tối đa ${MAX_LABEL_LENGTH} ký tự.`);
    }
    if (item.description !== undefined && cleanString(item.description, MAX_DESCRIPTION_LENGTH) === null) {
      return invalid(`description của "${key}" phải là chuỗi không rỗng, tối đa ${MAX_DESCRIPTION_LENGTH} ký tự.`);
    }
    if (item.group !== undefined && !isProfileGroup(item.group)) {
      return invalid(`group của "${key}" chỉ nhận ${PROFILE_GROUPS.join(', ')}.`);
    }
  }

  // Không cho cấu hình xoá hết chứng từ bắt buộc của sản phẩm ngay ở đường ghi
  // (đường đọc có fallback tương tự, nhưng ở đây cần chặn sớm để admin thấy lỗi).
  if (scopedProduct) {
    const overridesByKey = new Map(
      source.documents.map((raw) => {
        const item = raw as Record<string, unknown>;
        return [item.key as string, item];
      }),
    );
    const stillRequired = scopedProduct.requiredDocs.some((doc) => {
      const override = overridesByKey.get(doc.key);
      if (!override) return doc.required;
      if (override.enabled === false) return false;
      return typeof override.required === 'boolean' ? override.required : doc.required;
    });
    if (!stillRequired) {
      return invalid(`Cấu hình khiến sản phẩm "${scopedProductCode}" không còn chứng từ bắt buộc nào.`);
    }
  }

  return { ok: true };
}

// ─── Tóm tắt thay đổi cho audit ───────────────────────────────────────────────

function documentsByKey(value: unknown): Map<string, Record<string, unknown>> {
  const source = asRecord(value);
  const documents = Array.isArray(source?.documents) ? source!.documents : [];
  const map = new Map<string, Record<string, unknown>>();
  for (const raw of documents) {
    const item = asRecord(raw);
    const key = typeof item?.key === 'string' ? item.key.trim() : '';
    if (item && key) map.set(key, item);
  }
  return map;
}

const AUDITED_DOCUMENT_FIELDS = ['enabled', 'required', 'label', 'description', 'group'] as const;

/** So sánh hai giá trị account_document_catalog thô. Trả null khi không có thay đổi. */
export function summarizeDocumentCatalogChange(before: unknown, after: unknown): string | null {
  const previous = documentsByKey(before);
  const next = documentsByKey(after);
  if (previous.size === 0 && next.size === 0) return null;

  const added = [...next.keys()].filter((key) => !previous.has(key));
  const removed = [...previous.keys()].filter((key) => !next.has(key));
  const changed: string[] = [];
  for (const [key, item] of next) {
    const old = previous.get(key);
    if (!old) continue;
    const fields = AUDITED_DOCUMENT_FIELDS.filter((field) => JSON.stringify(old[field] ?? null) !== JSON.stringify(item[field] ?? null));
    if (fields.length > 0) changed.push(`${key}[${fields.join(',')}]`);
  }

  const parts: string[] = [];
  if (added.length > 0) parts.push(`thêm=${added.join('|')}`);
  if (removed.length > 0) parts.push(`bỏ=${removed.join('|')}`);
  if (changed.length > 0) parts.push(`sửa=${changed.join('|')}`);
  if (parts.length === 0) return null;
  return `account_document_catalog(${parts.join(' ')})`;
}

/** Danh sách document key + preset (chỉ đọc) của một sản phẩm — dùng cho UI /profiles. */
export function documentCatalogForProduct(product: AccountProduct): Array<{
  key: string;
  label: string;
  description: string;
  group: ProfileGroup;
  required: boolean;
  presetKey: string;
  presetDescription: string;
}> {
  return product.requiredDocs.map((doc) => ({
    key: doc.key,
    label: doc.label,
    description: doc.description,
    group: doc.group,
    required: doc.required,
    presetKey: doc.presetKey,
    presetDescription: EXTRACT_PRESETS[doc.presetKey]?.description ?? '',
  }));
}
