'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ReleaseBundle } from './ImportWizard';

interface Revision {
  revision: number;
  version: string | null;
  contentHash: string;
  action: string;
  message: string | null;
  createdByUserId: string | null;
  createdAt: string | null;
  isActive: boolean;
}

export interface ActiveRelease {
  revision: number;
  version: string | null;
}

interface RevisionTableProps {
  profileName: string;
  onReapply: (bundle: ReleaseBundle) => void;
  onActiveReleaseChange?: (release: ActiveRelease | null) => void;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function downloadBundle(bundle: ReleaseBundle, profileName: string, revision: number) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${profileName}-release-r${revision}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function RevisionTable({ profileName, onReapply, onActiveReleaseChange }: RevisionTableProps) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [comparison, setComparison] = useState('');
  const encodedProfileName = encodeURIComponent(profileName);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/internal/profile-release/revisions/${encodedProfileName}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Không thể tải lịch sử phát hành.');
        const loadedRevisions = payload.revisions as Revision[];
        setRevisions(loadedRevisions);
        onActiveReleaseChange?.(payload.activeRevision === null || payload.activeRevision === undefined
          ? null
          : { revision: payload.activeRevision, version: payload.activeVersion ?? null });
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Không thể tải lịch sử phát hành.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [encodedProfileName, onActiveReleaseChange]);

  const fetchBundle = async (revision: number) => {
    const response = await fetch(`/api/internal/profile-release/revisions/${encodedProfileName}/${revision}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Không thể tải revision.');
    return payload.bundle as ReleaseBundle;
  };

  const toggleSelected = (revision: number) => {
    setComparison('');
    setSelected((current) => current.includes(revision) ? current.filter((value) => value !== revision) : [...current, revision].slice(-2));
  };

  const compare = async () => {
    if (selected.length !== 2) return;
    try {
      const [first, second] = await Promise.all(selected.map(fetchBundle));
      const firstEndpoints = new Set(first.endpoints.map((endpoint) => endpoint.endpointSlug));
      const secondEndpoints = new Set(second.endpoints.map((endpoint) => endpoint.endpointSlug));
      const changed = [...new Set([...firstEndpoints, ...secondEndpoints])].filter((slug) => {
        const firstEndpoint = first.endpoints.find((endpoint) => endpoint.endpointSlug === slug);
        const secondEndpoint = second.endpoints.find((endpoint) => endpoint.endpointSlug === slug);
        return JSON.stringify(firstEndpoint) !== JSON.stringify(secondEndpoint);
      });
      setComparison(changed.length ? `Khác biệt endpoint: ${changed.join(', ')}` : 'Hai revision có cùng nội dung endpoint.');
    } catch (compareError) {
      toast.error(compareError instanceof Error ? compareError.message : 'Không thể so sánh revision.');
    }
  };

  const reapply = async (revision: number) => {
    try {
      onReapply(await fetchBundle(revision));
    } catch (reapplyError) {
      toast.error(reapplyError instanceof Error ? reapplyError.message : 'Không thể tải revision.');
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Lịch sử phát hành</h3><p className="text-xs text-muted-foreground">Chọn hai revision để so sánh; dùng lại revision sẽ chạy đối chiếu và xác nhận trước khi áp dụng.</p></div>{selected.length === 2 && <button type="button" onClick={compare} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted">So sánh 2 revision</button>}</div>
      {loading && <p className="text-sm text-muted-foreground">Đang tải lịch sử...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && (revisions.length ? <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[840px] text-left text-xs"><thead className="bg-muted/60 text-muted-foreground"><tr><th className="px-3 py-2">Chọn</th><th className="px-3 py-2">Rev</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Hash</th><th className="px-3 py-2">Loại</th><th className="px-3 py-2">Ghi chú</th><th className="px-3 py-2">Người tạo</th><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Thao tác</th></tr></thead><tbody>{revisions.map((revision) => <tr key={revision.revision} className="border-t border-border"><td className="px-3 py-2"><input type="checkbox" checked={selected.includes(revision.revision)} onChange={() => toggleSelected(revision.revision)} aria-label={`Chọn revision ${revision.revision}`} /></td><td className="px-3 py-2 font-semibold">{revision.revision}{revision.isActive && <span className="ml-2 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">✓ Đang dùng</span>}</td><td className="px-3 py-2 font-mono">{revision.version ?? '—'}</td><td className="px-3 py-2 font-mono">{revision.contentHash.slice(0, 8)}</td><td className="px-3 py-2">{revision.action}</td><td className="max-w-40 truncate px-3 py-2" title={revision.message ?? ''}>{revision.message || '—'}</td><td className="px-3 py-2">{revision.createdByUserId || 'system'}</td><td className="px-3 py-2">{formatDate(revision.createdAt)}</td><td className="space-x-2 whitespace-nowrap px-3 py-2"><button type="button" onClick={async () => { try { downloadBundle(await fetchBundle(revision.revision), profileName, revision.revision); } catch (downloadError) { toast.error(downloadError instanceof Error ? downloadError.message : 'Không thể tải revision.'); } }} className="font-semibold text-primary hover:underline">Tải</button><button type="button" onClick={() => void reapply(revision.revision)} className="font-semibold text-primary hover:underline">Dùng lại</button></td></tr>)}</tbody></table></div> : <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Chưa có lịch sử phát hành.</p>)}
      {comparison && <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{comparison}</p>}
    </div>
  );
}
