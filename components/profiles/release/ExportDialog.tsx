'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { isSemanticVersion, suggestNextPatchVersion } from '@/lib/profiles/release/version';
import type { ReleaseBundle } from './ImportWizard';

interface ExportDialogProps {
  profileId: string;
  profileName: string;
  onClose: () => void;
  onExported: () => void;
}

interface ExportResponse {
  success: true;
  bundle: ReleaseBundle;
  revision: number;
  version: string | null;
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

export function ExportDialog({ profileId, profileName, onClose, onExported }: ExportDialogProps) {
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/internal/profile-release/revisions/${encodeURIComponent(profileName)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Không thể tải lịch sử phát hành.');
        const suggestedVersion = suggestNextPatchVersion((payload.revisions ?? []).map((revision: { version?: string | null }) => revision.version));
        setVersion((current) => current === '1.0.0' ? suggestedVersion : current);
      })
      .catch(() => {
        // An export can still start at 1.0.0 when history is unavailable.
      });
    return () => controller.abort();
  }, [profileName]);

  const exportRelease = async () => {
    if (!isSemanticVersion(version)) {
      toast.error('Phiên bản phải theo chuẩn semver, ví dụ 1.0.0.');
      return;
    }

    setExporting(true);
    try {
      const response = await fetch('/api/internal/profile-release/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeyId: profileId, message, version }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Không thể xuất cấu hình.');
      const exportResult = payload as ExportResponse;
      setResult(exportResult);
      downloadBundle(exportResult.bundle, profileName, exportResult.revision);
      onExported();
      toast.success(`Đã xuất phiên bản ${exportResult.version ?? version} (revision ${exportResult.revision}).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể xuất cấu hình.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="export-release-title">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-background p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="export-release-title" className="text-lg font-bold">Xuất cấu hình</h2>
            <p className="mt-1 text-sm text-muted-foreground">Xuất cấu hình hiện tại của <span className="font-medium text-foreground">{profileName}</span> thành tệp JSON.</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">Đóng</button>
        </div>

        {!result ? (
          <>
            <label className="block text-sm font-medium">
              Phiên bản
              <input value={version} onChange={(event) => setVersion(event.target.value)} className="input-field mt-1 w-full font-mono" maxLength={100} placeholder="1.0.0" aria-describedby="release-version-help" />
              <span id="release-version-help" className="mt-1 block text-xs text-muted-foreground">Gợi ý tăng patch từ revision gần nhất. Bạn có thể nhập minor hoặc major khác.</span>
            </label>
            <label className="block text-sm font-medium">
              Ghi chú phát hành
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="input-field mt-1 min-h-[96px] w-full resize-y"
                maxLength={500}
                placeholder="Ví dụ: Bật cấu hình hoá đơn tháng 8"
              />
            </label>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted">Huỷ</button>
              <button type="button" disabled={exporting || !isSemanticVersion(version)} onClick={exportRelease} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {exporting ? 'Đang xuất...' : 'Xuất cấu hình'}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">Đã tải phiên bản {result.version ?? '—'} (revision {result.revision}). Bấm Tải lại nếu cần tải thêm lần nữa.</p>
            <button type="button" onClick={() => downloadBundle(result.bundle, profileName, result.revision)} className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground">
              Tải lại
            </button>
            <div className="flex justify-end"><button type="button" onClick={onClose} className="font-semibold text-primary hover:underline">Hoàn tất</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
