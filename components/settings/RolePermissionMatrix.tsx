'use client';
// components/settings/RolePermissionMatrix.tsx
// ADMIN-only editor for the configurable OPS capability matrix.
//
// Boundaries reflected in this UI (all re-enforced by /api/internal/rbac):
//  - ADMIN always holds every capability, so its column is fixed.
//  - `baseline` rows are required for OPS to use the console at all.
//  - `locked` rows are identity/RBAC controls that OPS must never receive;
//    they render disabled with the reason, and the API rejects them outright.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Lock, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import type { Capability, CapabilityGroup, CapabilityKind } from '@/lib/rbac/capabilities';

interface MatrixRow {
  key: Capability;
  group: CapabilityGroup;
  label: string;
  description: string;
  kind: CapabilityKind;
  lockedReason?: string;
  granted: boolean;
}

const KIND_BADGE: Record<CapabilityKind, { label: string; className: string }> = {
  baseline: { label: 'Bắt buộc', className: 'bg-slate-500/10 text-slate-500 border-slate-500/20' },
  configurable: { label: 'Cấu hình được', className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  locked: { label: 'Chỉ ADMIN', className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
};

export function RolePermissionMatrix({
  onNotify,
}: {
  onNotify?: (message: string, type: 'success' | 'error') => void;
}) {
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notify = useCallback((message: string, type: 'success' | 'error') => {
    if (onNotify) onNotify(message, type);
    else if (type === 'error') setError(message);
  }, [onNotify]);

  const applyRows = useCallback((incoming: MatrixRow[]) => {
    setRows(incoming);
    setDraft(Object.fromEntries(incoming.map((row) => [row.key, row.granted])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/internal/rbac', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? 'Không thể tải ma trận phân quyền');
      applyRows(payload.capabilities as MatrixRow[]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải ma trận phân quyền');
    } finally {
      setLoading(false);
    }
  }, [applyRows]);

  useEffect(() => { void load(); }, [load]);

  const changed = useMemo(
    () => rows.filter((row) => row.kind === 'configurable' && draft[row.key] !== row.granted),
    [rows, draft],
  );

  const grouped = useMemo(() => {
    const byGroup = new Map<CapabilityGroup, MatrixRow[]>();
    for (const row of rows) {
      const list = byGroup.get(row.group) ?? [];
      list.push(row);
      byGroup.set(row.group, list);
    }
    return [...byGroup.entries()];
  }, [rows]);

  const save = async () => {
    if (changed.length === 0) return;
    setSaving(true);
    try {
      const response = await fetch('/api/internal/rbac', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'OPS',
          // Send only configurable keys: baseline/locked keys are rejected by the API.
          permissions: Object.fromEntries(changed.map((row) => [row.key, draft[row.key]])),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? 'Không thể cập nhật ma trận phân quyền');
      applyRows(payload.capabilities as MatrixRow[]);
      notify(`Đã cập nhật ${payload.changed} quyền của OPS`, 'success');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Không thể cập nhật ma trận phân quyền', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modern-card p-6 mt-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary p-2 rounded-xl">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Phân quyền role OPS</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              ADMIN luôn có toàn quyền. Thay đổi tại đây được ghi vào Audit Log và áp dụng
              cho OPS trong vòng 15 giây, không cần đăng nhập lại.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/internal/rbac/export?format=csv"
            className="px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> CSV
          </a>
          <a
            href="/api/internal/rbac/export?format=json"
            className="px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> JSON
          </a>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive mb-4">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang tải ma trận phân quyền…
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-semibold">Quyền</th>
                  <th className="py-2 px-3 font-semibold w-24 text-center">ADMIN</th>
                  <th className="py-2 pl-3 font-semibold w-28 text-center">OPS</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([group, groupRows]) => (
                  <Fragment key={group}>
                    <tr className="bg-muted/40">
                      <td colSpan={3} className="py-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group}
                      </td>
                    </tr>
                    {groupRows.map((row) => {
                      const editable = row.kind === 'configurable';
                      const isDirty = editable && draft[row.key] !== row.granted;
                      return (
                        <tr key={row.key} className={`border-b border-border/60 ${isDirty ? 'bg-amber-500/5' : ''}`}>
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-foreground">{row.label}</span>
                              <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${KIND_BADGE[row.kind].className}`}>
                                {KIND_BADGE[row.kind].label}
                              </span>
                              <code className="text-[10px] font-mono text-muted-foreground/70">{row.key}</code>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{row.description}</p>
                            {row.lockedReason && (
                              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> {row.lockedReason}
                              </p>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center text-muted-foreground">✓</td>
                          <td className="py-2.5 pl-3 text-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
                              checked={editable ? Boolean(draft[row.key]) : row.granted}
                              disabled={!editable || saving}
                              aria-label={`Quyền ${row.label} cho OPS`}
                              title={editable ? undefined : row.lockedReason ?? 'Quyền này không thể cấu hình.'}
                              onChange={(event) =>
                                setDraft((previous) => ({ ...previous, [row.key]: event.target.checked }))
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={save}
              disabled={saving || changed.length === 0}
              className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Lưu phân quyền
            </button>
            {changed.length > 0 && (
              <>
                <button
                  onClick={() => applyRows(rows)}
                  disabled={saving}
                  className="px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Hoàn tác
                </button>
                <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">
                  {changed.length} thay đổi chưa lưu
                </span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
