'use client';

// Trang cấu hình riêng cho workflow Account Opening — tách khỏi /profiles vì
// bộ rule + policy + danh mục chứng từ quá phức tạp để nhúng vào layout chung
// (không gian hẹp, phải cuộn lồng trong card endpoint). Trang này KHÔNG dùng
// layout hệ thống (PageWrapper/HeaderNav tự bỏ qua path bắt đầu bằng
// /account-opening) — theo đúng phong cách UI nghiệp vụ của trang vận hành
// /account-opening, để có không gian rộng và thao tác trực tiếp hơn.
//
// Luồng dữ liệu giữ nguyên như khi còn nhúng trong /profiles:
//   - Chọn Profile (apiKeyId) → GET /api/internal/profile-endpoints?apiKeyId=...
//   - Lọc đúng endpoint slug 'workflows:account-opening', lấy parameters hiện có.
//   - AccountCheckSetPanel mutate parameters cục bộ qua setParamsObj.
//   - Nút Lưu ở đây gọi lại POST /api/internal/profile-endpoints với payload tối
//     giản { apiKeyId, endpointSlug, parameters } — API chỉ update field nào có
//     mặt trong body nên không cần biết các field khác (connectionsOverride...).

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, CircleAlert, Layers, Loader2, Save, Settings2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import AccountCheckSetPanel from '@/components/profiles/AccountCheckSetPanel';
import { listAccountOpeningPolicies } from '@/lib/pipelines/workflows/account-opening/segment-policy';

const ENDPOINT_SLUG = 'workflows:account-opening';

const PRODUCT_OPTIONS = listAccountOpeningPolicies().map((policy) => ({
  code: policy.productCode,
  label: `${policy.segmentKey} · ${policy.productCode}`,
}));

type ParamsObj = Record<string, { value: unknown; isLocked: boolean }>;

interface ApiKeyOption {
  id: string;
  name: string;
  displayName?: string | null;
}

interface EndpointRecord {
  slug: string;
  displayName?: string;
  parameters: ParamsObj | null;
}

function profileLabel(profile: Pick<ApiKeyOption, 'name' | 'displayName'>): string {
  return profile.displayName?.trim() || profile.name;
}

export default function AccountOpeningConfigPage() {
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
  // Sản phẩm dùng để xem trước rule/checklist — nâng lên đây (thay vì để panel tự
  // quản) để hiển thị cùng thanh với Profile picker + nút Lưu ở trên cùng.
  const [previewProduct, setPreviewProduct] = useState<string>(PRODUCT_OPTIONS[0]?.code ?? '');

  // Đọc apiKeyId ban đầu từ query string (?client=...) để có thể link trực tiếp
  // từ /profiles hoặc từ trang vận hành /account-opening.
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
        if (!cancelled && response.ok && Array.isArray(data.apiKeys)) {
          setProfiles(data.apiKeys);
        }
      } catch {
        if (!cancelled) toast.error('Không tải được danh sách Profile.');
      } finally {
        if (!cancelled) setLoadingProfiles(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadEndpoint = useCallback(async (targetApiKeyId: string) => {
    if (!targetApiKeyId) {
      setEndpoint(null);
      setParamsObj({});
      return;
    }
    setLoadingEndpoint(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/internal/profile-endpoints?apiKeyId=${targetApiKeyId}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Không tải được cấu hình endpoint.');
      const found = Array.isArray(data.endpoints)
        ? data.endpoints.find((item: { slug: string }) => item.slug === ENDPOINT_SLUG)
        : null;
      if (!found) throw new Error(`Không tìm thấy endpoint "${ENDPOINT_SLUG}" cho Profile này.`);
      setEndpoint({ slug: found.slug, displayName: found.displayName, parameters: found.parameters ?? null });
      setParamsObj(found.parameters ?? {});
      setDirty(false);
      // canManageEndpoints không trả trực tiếp trong response GET; suy ra từ khả
      // năng đọc parameters chưa bị redact (redactParameterValues chỉ trả `value: null`).
      const rawEntries = Object.values(found.parameters ?? {}) as Array<{ value: unknown }>;
      const hasRedacted = rawEntries.some((entry) => entry && entry.value === null);
      setCanManageEndpoints(!hasRedacted || rawEntries.length === 0);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Không tải được cấu hình endpoint.');
      setEndpoint(null);
      setParamsObj({});
    } finally {
      setLoadingEndpoint(false);
    }
  }, []);

  useEffect(() => {
    void loadEndpoint(apiKeyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeyId]);

  // AccountCheckSetPanel tự mutate paramsObj qua setParamsObj — theo dõi thay
  // đổi để biết có cần cảnh báo trước khi rời trang / bật nút Lưu.
  const wrappedSetParamsObj = useCallback<React.Dispatch<React.SetStateAction<ParamsObj>>>((update) => {
    setParamsObj((previous) => {
      const next = typeof update === 'function' ? (update as (value: ParamsObj) => ParamsObj)(previous) : update;
      if (JSON.stringify(next) !== JSON.stringify(previous)) setDirty(true);
      return next;
    });
  }, []);

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === apiKeyId), [profiles, apiKeyId]);

  const handleSave = async () => {
    if (!apiKeyId || !endpoint) return;
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
      toast.success('Đã lưu cấu hình mở tài khoản.');
      await loadEndpoint(apiKeyId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Lỗi khi lưu thiết lập.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f4f7fb] text-slate-900">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute -left-36 top-12 h-96 w-96 rounded-full bg-cyan-300/20 blur-[120px]" />
        <div className="absolute right-0 top-0 h-[32rem] w-[32rem] rounded-full bg-indigo-300/20 blur-[150px]" />
      </div>

      <header className="relative z-30 border-b border-slate-200 bg-white/90 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1720px] items-center justify-between px-4 sm:px-6 xl:px-10">
          <div className="flex items-center gap-3">
            <Link href="/account-opening" aria-label="Quay lại trang vận hành" className="mr-1 rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-300 to-indigo-500 text-[#06101b] shadow-[0_0_28px_rgba(34,211,238,.22)]">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-slate-900">DUGATE <span className="font-medium text-cyan-700">Onboarding Intelligence</span></p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Cấu hình bộ kiểm tra mở tài khoản</p>
            </div>
          </div>
        </div>
      </header>

      {/* Thanh điều khiển cố định: Profile + sản phẩm xem trước + Lưu — luôn thấy
          được, không phải cuộn xuống đáy trang mới lưu được. */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1720px] flex-wrap items-end gap-3 px-4 py-3 sm:px-6 xl:px-10">
          <label className="block min-w-[220px] flex-1 max-w-sm">
            <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><Wallet className="h-3 w-3" /> Profile</span>
            <div className="relative">
              <select
                value={apiKeyId}
                onChange={(event) => setApiKeyId(event.target.value)}
                disabled={loadingProfiles}
                className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 disabled:opacity-70"
              >
                <option value="">{loadingProfiles ? 'Đang tải…' : 'Chọn Profile'}</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profileLabel(profile)}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </div>
          </label>

          <label className="block min-w-[220px] flex-1 max-w-sm">
            <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-700"><Layers className="h-3 w-3" /> Sản phẩm xem trước</span>
            <select
              value={previewProduct}
              onChange={(event) => setPreviewProduct(event.target.value)}
              disabled={!endpoint}
              className="w-full rounded-xl border border-cyan-200 bg-cyan-50/60 px-3 py-2 text-sm font-mono text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 disabled:opacity-60"
            >
              {PRODUCT_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="flex-1" />

          {dirty && (
            <span className="mb-1 rounded-full border border-amber-300/40 bg-amber-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-800">
              Có thay đổi chưa lưu
            </span>
          )}

          {endpoint && canManageEndpoints && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-indigo-400 px-5 text-sm font-bold text-[#04101a] shadow-[0_12px_35px_rgba(34,211,238,.18)] transition hover:-translate-y-0.5 hover:shadow-[0_15px_40px_rgba(34,211,238,.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Đang lưu' : 'Lưu thiết lập'}
            </button>
          )}
        </div>
        {selectedProfile && !canManageEndpoints && !loadingEndpoint && (
          <div className="mx-auto max-w-[1720px] px-4 pb-3 sm:px-6 xl:px-10">
            <p className="flex items-center gap-1.5 text-[11px] text-amber-800">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" /> Bạn không có quyền chỉnh cấu hình endpoint; chỉ xem được ở dạng đã ẩn giá trị.
            </p>
          </div>
        )}
      </div>

      <div className="relative z-10 mx-auto max-w-[1720px] px-4 pb-16 pt-8 sm:px-6 xl:px-10">
        <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-3xl">
              Cấu hình bộ kiểm tra hồ sơ mở tài khoản
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Chỉnh rule engine, rule LLM, ngưỡng policy và danh mục chứng từ theo từng Profile — độc lập với layout
              cấu hình chung để có đủ không gian thao tác.
            </p>
          </div>
        </section>

        {loadingEndpoint && (
          <div className="flex items-center gap-2 rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-[0_18px_55px_rgba(15,23,42,.08)]">
            <Loader2 className="h-4 w-4 animate-spin text-cyan-700" /> Đang tải cấu hình…
          </div>
        )}

        {!loadingEndpoint && loadError && (
          <div className="flex items-start gap-3 rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-800 shadow-[0_18px_55px_rgba(15,23,42,.08)]" role="alert">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div>
              <p className="text-sm font-semibold">Không tải được cấu hình</p>
              <p className="mt-1 text-xs leading-5 text-rose-700">{loadError}</p>
            </div>
          </div>
        )}

        {!loadingEndpoint && !loadError && !endpoint && apiKeyId && (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-[0_18px_55px_rgba(15,23,42,.08)]">
            Profile này chưa có endpoint mở tài khoản.
          </div>
        )}

        {!apiKeyId && !loadingProfiles && (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-sm text-slate-500">
            Chọn một Profile ở trên để xem và chỉnh cấu hình.
          </div>
        )}

        {endpoint && (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,.08)]">
            <AccountCheckSetPanel
              endpoint={{ slug: endpoint.slug, displayName: endpoint.displayName }}
              paramsObj={paramsObj}
              setParamsObj={wrappedSetParamsObj}
              canManageEndpoints={canManageEndpoints}
              syncKey={`${apiKeyId}:${endpoint.slug}`}
              previewProduct={previewProduct}
              onPreviewProductChange={setPreviewProduct}
            />
          </section>
        )}
      </div>
    </main>
  );
}
