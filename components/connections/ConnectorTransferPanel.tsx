'use client';

// components/connections/ConnectorTransferPanel.tsx
// Export/import UI for connector configuration bundles. Export downloads a signed
// dugate.connector JSON (secrets omitted). Import runs a 3-step wizard:
// upload -> compare (plan) -> enter new secrets/URLs -> apply (upsert by slug).

import { useCallback, useMemo, useState } from 'react';
import { Download, Upload, Loader2, X, AlertTriangle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface ConnectorLite {
  id: string;
  slug: string;
  name: string;
}

interface PlanItem {
  slug: string;
  name: string;
  op: 'CREATE' | 'UPDATE';
  secretRequired: boolean;
  endpointUrlChanged: boolean;
  hostChanged: boolean;
}

interface PlanResult {
  items: PlanItem[];
  applicable: boolean;
  blockers: string[];
}

interface BundleConnector {
  slug: string;
  name: string;
  endpointUrl: string;
  authType: string;
  vaultSecretPath?: string | null;
  needsInlineSecret: boolean;
}

interface ConnectorBundle {
  bundleVersion: number;
  kind: string;
  connectors: BundleConnector[];
  meta: { sourceEnv?: string | null; exportedAt: string; contentHash: string };
}

type SecretInput = { endpointUrl: string; inlineSecret: string; vaultSecretPath: string };

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ConnectorTransferPanel({ connections, onImported }: {
  connections: ConnectorLite[];
  onImported: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const exportAll = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/internal/ext-connections/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || 'Export thất bại');
        return;
      }
      downloadJson(`connectors-all-${new Date().toISOString().slice(0, 10)}.json`, data.bundle);
      toast.success(`Đã export ${data.bundle.connectors.length} connector`);
    } catch {
      toast.error('Lỗi kết nối khi export');
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={exportAll}
          disabled={exporting || connections.length === 0}
          className="flex items-center gap-2 text-sm px-3 py-1.5 bg-background text-foreground rounded-lg shadow-sm border border-border hover:bg-muted font-medium transition-colors disabled:opacity-50"
          title="Export toàn bộ connector ra file JSON"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 text-primary" />}
          Export tất cả
        </button>
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-2 text-sm px-3 py-1.5 bg-background text-foreground rounded-lg shadow-sm border border-border hover:bg-muted font-medium transition-colors"
          title="Import cấu hình connector từ file JSON"
        >
          <Upload className="w-4 h-4 text-primary" /> Import bundle
        </button>
      </div>

      {showImport && (
        <ImportBundleModal onClose={() => setShowImport(false)} onImported={onImported} />
      )}
    </>
  );
}

/** Per-connector export button placed inside each list item. */
export function ConnectorExportButton({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const onClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch('/api/internal/ext-connections/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: [slug] }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || 'Export thất bại');
        return;
      }
      downloadJson(`connector-${slug}.json`, data.bundle);
      toast.success(`Đã export '${slug}'`);
    } catch {
      toast.error('Lỗi kết nối khi export');
    } finally {
      setBusy(false);
    }
  }, [slug]);

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="p-1 rounded hover:bg-black/10 disabled:opacity-50"
      title={`Export connector '${slug}'`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
    </button>
  );
}

function ImportBundleModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload');
  const [bundle, setBundle] = useState<ConnectorBundle | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [inputs, setInputs] = useState<Record<string, SecretInput>>({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ slug: string; op: string }> | null>(null);

  const buildInputsArray = useCallback((state: Record<string, SecretInput>) =>
    Object.entries(state).map(([slug, v]) => ({
      slug,
      ...(v.endpointUrl.trim() ? { endpointUrl: v.endpointUrl.trim() } : {}),
      ...(v.inlineSecret.trim() ? { inlineSecret: v.inlineSecret.trim() } : {}),
      ...(v.vaultSecretPath.trim() ? { vaultSecretPath: v.vaultSecretPath.trim() } : {}),
    })), []);

  const runPlan = useCallback(async (b: ConnectorBundle, state: Record<string, SecretInput>) => {
    const res = await fetch('/api/internal/ext-connections/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'plan', bundle: b, inputs: buildInputsArray(state) }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Không thể đối chiếu bundle');
    return data.plan as PlanResult;
  }, [buildInputsArray]);

  const onFile = useCallback(async (file: File) => {
    // Clear any previous failed attempt before parsing the next file.
    setBundle(null);
    setPlan(null);
    setInputs({});
    setResults(null);
    setStep('upload');
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ConnectorBundle;
      if (parsed?.kind !== 'dugate.connector') {
        toast.error('File không phải bundle connector (kind !== dugate.connector)');
        return;
      }
      const seed: Record<string, SecretInput> = {};
      for (const c of parsed.connectors) {
        seed[c.slug] = { endpointUrl: c.endpointUrl, inlineSecret: '', vaultSecretPath: c.vaultSecretPath ?? '' };
      }
      const p = await runPlan(parsed, seed);
      setBundle(parsed);
      setInputs(seed);
      setPlan(p);
      setStep('review');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'File JSON không hợp lệ');
    } finally {
      setBusy(false);
    }
  }, [runPlan]);

  const updateInput = useCallback((slug: string, patch: Partial<SecretInput>) => {
    setInputs(prev => ({ ...prev, [slug]: { ...prev[slug], ...patch } }));
  }, []);

  const removeConnector = useCallback(async (slug: string) => {
    if (!bundle) return;
    if (bundle.connectors.length <= 1) {
      toast.error('Bundle phải còn ít nhất một connector');
      return;
    }

    const nextBundle: ConnectorBundle = {
      ...bundle,
      connectors: bundle.connectors.filter(connector => connector.slug !== slug),
    };
    const nextInputs = Object.fromEntries(
      Object.entries(inputs).filter(([inputSlug]) => inputSlug !== slug),
    );

    setBusy(true);
    try {
      const nextPlan = await runPlan(nextBundle, nextInputs);
      setBundle(nextBundle);
      setInputs(nextInputs);
      setPlan(nextPlan);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể cập nhật danh sách connector');
    } finally {
      setBusy(false);
    }
  }, [bundle, inputs, runPlan]);

  const refreshPlan = useCallback(async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      setPlan(await runPlan(bundle, inputs));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi đối chiếu');
    } finally {
      setBusy(false);
    }
  }, [bundle, inputs, runPlan]);

  const apply = useCallback(async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      const res = await fetch('/api/internal/ext-connections/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', bundle, inputs: buildInputsArray(inputs) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || 'Import thất bại');
        return;
      }
      setResults(data.results);
      setStep('done');
      onImported();
      toast.success(`Đã import ${data.results.length} connector`);
    } catch {
      toast.error('Lỗi kết nối khi import');
    } finally {
      setBusy(false);
    }
  }, [bundle, inputs, buildInputsArray, onImported]);

  const bundleBySlug = useMemo(
    () => new Map((bundle?.connectors ?? []).map(c => [c.slug, c])),
    [bundle],
  );
  // Plan rows still waiting on operator input. This is a list of connector metadata
  // (slug, name), never a secret.
  const itemsNeedingInput = plan?.items.filter(item => item.secretRequired) ?? [];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl border border-border shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-bold flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" /> Import connector bundle
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {step === 'upload' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Chọn file bundle JSON đã export từ môi trường khác. Secret không nằm trong file — bạn sẽ nhập API Key mới ở bước sau.
              </p>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-8 cursor-pointer hover:bg-muted/40">
                {busy ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : <Upload className="w-6 h-6 text-primary" />}
                <span className="mt-2 text-sm font-medium">Bấm để chọn file .json</span>
                <input type="file" accept="application/json,.json" className="hidden"
                  onChange={e => {
                    const input = e.currentTarget;
                    const file = input.files?.[0];
                    // Allow selecting the same or another file after any failed attempt.
                    input.value = '';
                    if (file) void onFile(file);
                  }} />
              </label>
            </div>
          )}

          {step === 'review' && plan && bundle && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                Nguồn: <span className="font-mono">{bundle.meta.sourceEnv ?? 'unknown'}</span> · {bundle.connectors.length} connector
              </div>

              {itemsNeedingInput.length > 0 && (
                <div
                  role="alert"
                  className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950 shadow-sm dark:border-amber-500 dark:bg-amber-950/30 dark:text-amber-100"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">
                        Chưa thể import: {itemsNeedingInput.length} connector cần bổ sung secret
                      </div>
                      <div className="mt-1 text-xs opacity-90">
                        Nhập API Key mới hoặc Vault Secret Path cho các connector bên dưới. Connector đã có secret sẽ hiển thị trạng thái OK.
                      </div>
                      <ul className="mt-3 space-y-2 text-sm">
                        {itemsNeedingInput.map(item => (
                          <li key={item.slug} className="flex items-start gap-2">
                            <span className="mt-1 text-amber-600 dark:text-amber-400">•</span>
                            <span className="min-w-0">
                              <strong>{item.name}</strong>{' '}
                              <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs dark:bg-amber-900/50">{item.slug}</code>
                              <span className="ml-1 text-xs">— cần API Key hoặc Vault Secret Path</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              {plan.items.map(item => {
                const b = bundleBySlug.get(item.slug);
                const input = inputs[item.slug];
                const usingVault = Boolean(input?.vaultSecretPath?.trim());
                  const needsSecret = item.secretRequired;
                return (
                  <div
                    key={item.slug}
                    className={`rounded-xl border-2 p-3 space-y-3 transition-colors ${
                      needsSecret
                        ? 'border-amber-400 bg-amber-50/70 shadow-sm dark:border-amber-500 dark:bg-amber-950/20'
                        : 'border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${item.op === 'CREATE' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>{item.op}</span>
                        <span className="font-semibold text-sm">{item.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{item.slug}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {needsSecret
                          ? <span className="flex items-center gap-1.5 rounded-md bg-amber-200 px-2 py-1 text-xs font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-900/60 dark:text-amber-100"><AlertTriangle className="w-3.5 h-3.5" /> CẦN SECRET</span>
                          : <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400"><CheckCircle className="w-3.5 h-3.5" /> ĐỦ SECRET</span>}
                        <button
                          type="button"
                          onClick={() => void removeConnector(item.slug)}
                          disabled={busy}
                          className="p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50"
                          title={`Bỏ connector '${item.slug}' khỏi lần import này`}
                          aria-label={`Bỏ connector '${item.slug}' khỏi lần import này`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Endpoint URL (môi trường đích)</span>
                      <input value={input?.endpointUrl ?? ''} onChange={e => updateInput(item.slug, { endpointUrl: e.target.value })}
                        onBlur={refreshPlan}
                        className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
                      {item.hostChanged && <span className="text-[11px] text-amber-600">Host khác với cấu hình hiện tại — kiểm tra kỹ trước khi import.</span>}
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Vault Secret Path (ưu tiên)</span>
                        <input value={input?.vaultSecretPath ?? ''} onChange={e => updateInput(item.slug, { vaultSecretPath: e.target.value })}
                          onBlur={refreshPlan} placeholder="vd: eda/rpa/dugate/aihub#key"
                          className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">API Key mới {usingVault ? '(không cần khi dùng Vault)' : ''}</span>
                        <input type="password" value={input?.inlineSecret ?? ''} disabled={usingVault || b?.authType === 'NONE'}
                          onChange={e => updateInput(item.slug, { inlineSecret: e.target.value })} onBlur={refreshPlan}
                          placeholder={item.op === 'UPDATE' && !item.secretRequired ? 'Giữ key hiện tại — để trống' : 'Nhập API Key'}
                          className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50" />
                      </label>
                    </div>
                  </div>
                );
              })}


            </div>
          )}

          {step === 'done' && results && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-green-600"><CheckCircle className="w-5 h-5" /> Import hoàn tất</div>
              {results.map(r => (
                <div key={r.slug} className="text-sm font-mono">{r.op} — {r.slug}</div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg hover:bg-muted font-medium">
            {step === 'done' ? 'Đóng' : 'Hủy'}
          </button>
          {step === 'review' && (
            <button onClick={apply} disabled={busy || !plan?.applicable}
              className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import ngay
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
