'use client';

// Logic trang cấu hình v2. Cấu hình workflow nằm THEO SẢN PHẨM trong khóa `loan_product_config` của một Profile
// (xem lib/pipelines/workflows/loan-appraisal/product-config.ts). Trang chọn Profile (nơi lưu) → sản phẩm → luồng.
// Lưu qua cùng endpoint /api/internal/profile-endpoints như trước; chỉ payload đổi.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  LEGACY_LOAN_PARAMS,
  LOAN_PRODUCT_CONFIG_PARAM,
  LOAN_PRODUCT_CONFIG_VERSION,
  migrateLegacyForProduct,
  type LoanProductConfig,
  type LoanProductConfigFile,
} from '@/lib/pipelines/workflows/loan-appraisal/product-config';
import { defaultFlowFor, flowOptionsFor, productOptions } from './../lib/product-options';

export const ENDPOINT_SLUG = 'workflows:loan-appraisal';

export type ParamsObj = Record<string, { value: unknown; isLocked: boolean }>;

export interface ApiKeyOption {
  id: string;
  name: string;
  displayName?: string | null;
}

export interface EndpointRecord {
  slug: string;
  displayName?: string;
  parameters: ParamsObj | null;
}

export function profileLabel(profile: Pick<ApiKeyOption, 'name' | 'displayName'>): string {
  return profile.displayName?.trim() || profile.name;
}

const EMPTY_FILE: LoanProductConfigFile = { version: LOAN_PRODUCT_CONFIG_VERSION, products: {} };

function readFile(params: ParamsObj | null): LoanProductConfigFile {
  const raw = params?.[LOAN_PRODUCT_CONFIG_PARAM]?.value;
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_FILE;
  const products = (value as { products?: unknown }).products;
  return {
    version: typeof (value as { version?: unknown }).version === 'string' ? (value as { version: string }).version : LOAN_PRODUCT_CONFIG_VERSION,
    products: products && typeof products === 'object' && !Array.isArray(products) ? { ...(products as Record<string, LoanProductConfig>) } : {},
  };
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/** Cấu hình rỗng thì bỏ khoá, để Profile không giữ bản sao dư thừa của mặc định. */
function isEmptyConfig(config: LoanProductConfig | undefined): boolean {
  if (!config) return true;
  return Object.values(config).every((section) => {
    if (section === undefined || section === null) return true;
    if (typeof section === 'object') return Object.keys(section as object).length === 0;
    return false;
  });
}

export function useLoanConfig() {
  const [profiles, setProfiles] = useState<ApiKeyOption[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [apiKeyId, setApiKeyId] = useState('');
  const [endpoint, setEndpoint] = useState<EndpointRecord | null>(null);
  const [paramsObj, setParamsObj] = useState<ParamsObj>({});
  const [loadingEndpoint, setLoadingEndpoint] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [canManageEndpoints, setCanManageEndpoints] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadedFor, setLoadedFor] = useState('');
  const latestRequest = useRef(0);

  const products = useMemo(() => productOptions(), []);
  const [productCode, setProductCodeState] = useState<string>(products[0]?.value ?? '');
  const [flow, setFlow] = useState<string>(defaultFlowFor(products[0]?.value ?? '') ?? '');

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('client');
    if (initial) setApiKeyId(initial);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/internal/apikeys', { cache: 'no-store' });
        const data = await response.json();
        if (!cancelled && response.ok && Array.isArray(data.apiKeys)) setProfiles(data.apiKeys);
      } catch {
        if (!cancelled) toast.error('Không tải được danh sách Profile.');
      } finally {
        if (!cancelled) setLoadingProfiles(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadEndpoint = useCallback(async (target: string) => {
    if (!target) {
      latestRequest.current += 1;
      setLoadingEndpoint(false);
      setEndpoint(null);
      setParamsObj({});
      setLoadedFor('');
      setDirty(false);
      return;
    }
    const requestId = ++latestRequest.current;
    setLoadingEndpoint(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/internal/profile-endpoints?apiKeyId=${encodeURIComponent(target)}`, { cache: 'no-store' });
      const data = await response.json();
      if (requestId !== latestRequest.current) return;
      if (!response.ok) throw new Error(data?.error || 'Không tải được cấu hình endpoint.');
      const found = Array.isArray(data.endpoints)
        ? data.endpoints.find((item: { slug: string }) => item.slug === ENDPOINT_SLUG)
        : null;
      if (!found) throw new Error(`Không tìm thấy endpoint "${ENDPOINT_SLUG}" cho Profile này.`);
      setEndpoint({ slug: found.slug, displayName: found.displayName, parameters: found.parameters ?? null });
      setParamsObj(found.parameters ?? {});
      setLoadedFor(target);
      setDirty(false);
      // Gợi ý UI: người không có endpoint:manage nhận parameters đã redact (value: null). Server vẫn kiểm quyền khi lưu.
      const entries = Object.values(found.parameters ?? {}) as Array<{ value: unknown }>;
      setCanManageEndpoints(entries.length === 0 || !entries.some((entry) => entry && entry.value === null));
    } catch (error) {
      if (requestId !== latestRequest.current) return;
      setLoadError(error instanceof Error ? error.message : 'Không tải được cấu hình endpoint.');
      setEndpoint(null);
      setParamsObj({});
      setLoadedFor('');
      setDirty(false);
    } finally {
      if (requestId === latestRequest.current) setLoadingEndpoint(false);
    }
  }, []);

  useEffect(() => { void loadEndpoint(apiKeyId); }, [apiKeyId, loadEndpoint]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === apiKeyId), [profiles, apiKeyId]);
  const isReady = Boolean(endpoint) && loadedFor === apiKeyId && !!apiKeyId;

  const flows = useMemo(() => flowOptionsFor(productCode), [productCode]);

  /** Đổi sản phẩm: luồng phải thuộc chương trình của sản phẩm mới (giữ luồng cũ nếu vẫn hợp lệ). */
  const changeProduct = useCallback((next: string) => {
    setProductCodeState(next);
    setFlow((current) => (flowOptionsFor(next).some((option) => option.value === current) ? current : defaultFlowFor(next) ?? ''));
  }, []);

  const changeProfile = useCallback((next: string) => {
    if (next === apiKeyId) return;
    if (dirty && !window.confirm('Có thay đổi chưa lưu. Chuyển Profile sẽ bỏ các thay đổi này?')) return;
    setDirty(false);
    setApiKeyId(next);
  }, [apiKeyId, dirty]);

  const file = useMemo(() => readFile(paramsObj), [paramsObj]);
  const productConfig: LoanProductConfig = file.products[productCode] ?? {};

  /** Sửa cấu hình của sản phẩm đang chọn. `update` nhận bản sao hiện tại, trả bản mới; rỗng → xoá khoá sản phẩm. */
  const updateProduct = useCallback((update: (current: LoanProductConfig) => LoanProductConfig) => {
    setParamsObj((previous) => {
      const current = readFile(previous);
      const nextProduct = update(structuredClone(current.products[productCode] ?? {}));
      const products = { ...current.products };
      if (isEmptyConfig(nextProduct)) delete products[productCode];
      else products[productCode] = nextProduct;
      const next = { ...previous };
      if (Object.keys(products).length === 0) delete next[LOAN_PRODUCT_CONFIG_PARAM];
      // Cấu hình do admin quản trị: khoá để client không ghi đè khi gọi API.
      else next[LOAN_PRODUCT_CONFIG_PARAM] = { value: { version: current.version, products }, isLocked: previous[LOAN_PRODUCT_CONFIG_PARAM]?.isLocked ?? true };
      if (JSON.stringify(next) === JSON.stringify(previous)) return previous;
      setDirty(true);
      return next;
    });
  }, [productCode]);

  const save = useCallback(async () => {
    if (!isReady || !endpoint) return;
    setSaving(true);
    try {
      const response = await fetch('/api/internal/profile-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKeyId,
          endpointSlug: ENDPOINT_SLUG,
          parameters: Object.keys(paramsObj).length ? paramsObj : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Không lưu được thiết lập.');
      setDirty(false);
      toast.success('Đã lưu cấu hình thẩm định vay.');
      await loadEndpoint(apiKeyId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Lỗi khi lưu thiết lập.');
    } finally {
      setSaving(false);
    }
  }, [isReady, endpoint, apiKeyId, paramsObj, loadEndpoint]);

  /** Cấu hình cũ (theo Profile) còn nằm trong Profile: runtime không còn đọc, báo để admin chuyển sang sản phẩm. */
  const legacyKeys = useMemo(
    () => LEGACY_LOAN_PARAMS.filter((key) => {
      const value = paramsObj[key]?.value;
      return value && typeof value === 'object' && Object.keys(value as object).length > 0;
    }),
    [paramsObj],
  );

  /**
   * Chuyển cấu hình cũ sang từng sản phẩm CHƯA có cấu hình riêng (cấu hình cũ áp cho mọi sản phẩm), rồi xoá khoá cũ.
   * Chỉ sửa bản nháp tới khi bấm Lưu.
   */
  const migrateLegacy = useCallback(() => {
    setParamsObj((previous) => {
      const current = readFile(previous);
      const merged = { ...current.products };
      for (const option of products) {
        if (merged[option.value]) continue;
        const migrated = migrateLegacyForProduct(previous as Record<string, { value?: unknown }>, option.value);
        if (!isEmptyConfig(migrated)) merged[option.value] = migrated;
      }
      const next = { ...previous };
      for (const key of LEGACY_LOAN_PARAMS) delete next[key];
      if (Object.keys(merged).length > 0) next[LOAN_PRODUCT_CONFIG_PARAM] = { value: { version: current.version, products: merged }, isLocked: previous[LOAN_PRODUCT_CONFIG_PARAM]?.isLocked ?? true };
      return next;
    });
    setDirty(true);
  }, [products]);

  /** Bỏ hẳn khoá cũ, không chuyển. */
  const dropLegacy = useCallback(() => {
    setParamsObj((previous) => {
      const next = { ...previous };
      for (const key of LEGACY_LOAN_PARAMS) delete next[key];
      return next;
    });
    setDirty(true);
  }, []);
  return {
    profiles, loadingProfiles, apiKeyId, endpoint, paramsObj, loadingEndpoint, loadError,
    saving, canManageEndpoints, dirty, isReady, selectedProfile, changeProfile, save,
    products, productCode, changeProduct, flows, flow, setFlow,
    productConfig, updateProduct, legacyKeys, migrateLegacy, dropLegacy,
  };
}
