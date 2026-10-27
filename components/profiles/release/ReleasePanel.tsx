'use client';

import { useEffect, useState } from 'react';
import { ExportDialog } from './ExportDialog';
import { ImportWizard, type ImportAppliedResult, type ReleaseBundle } from './ImportWizard';
import { RevisionTable, type ActiveRelease } from './RevisionTable';

interface ReleasePanelProps {
  profileId?: string;
  profileName?: string;
  onProfileChanged?: (result: ImportAppliedResult) => void;
}

export default function ReleasePanel({ profileId, profileName, onProfileChanged }: ReleasePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importBundle, setImportBundle] = useState<ReleaseBundle | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeRelease, setActiveRelease] = useState<ActiveRelease | null>(null);

  const refreshRevisions = () => setRefreshKey((key) => key + 1);
  const handleApplied = (result: ImportAppliedResult) => {
    refreshRevisions();
    onProfileChanged?.(result);
  };
  const openImport = (bundle?: ReleaseBundle) => {
    setImportBundle(bundle);
    setShowImport(true);
  };

  useEffect(() => {
    if (!profileName) {
      setActiveRelease(null);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/internal/profile-release/revisions/${encodeURIComponent(profileName)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Không thể tải lịch sử phát hành.');
        setActiveRelease(payload.activeRevision === null || payload.activeRevision === undefined
          ? null
          : { revision: payload.activeRevision, version: payload.activeVersion ?? null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setActiveRelease(null);
      });
    return () => controller.abort();
  }, [profileName, refreshKey]);

  return (
    <section className="modern-card overflow-hidden border border-border">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold transition-colors hover:bg-muted/60"
      >
        <span className="flex flex-wrap items-center gap-2">
          Phát hành Profile
          {activeRelease && <span className="text-xs font-medium text-muted-foreground">Phiên bản: {activeRelease.version ?? '—'} (rev {activeRelease.revision})</span>}
        </span>
        <span className="text-xs font-medium text-muted-foreground">{expanded ? '▲ Thu gọn' : '▼ Mở rộng'}</span>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border px-4 pb-4 pt-4">
          <div className="flex flex-wrap gap-3">
            {profileId && profileName && (
              <button
                type="button"
                onClick={() => setShowExport(true)}
                className="rounded-lg border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted"
              >
                Xuất cấu hình
              </button>
            )}
            {profileId && profileName && (
              <button
                type="button"
                onClick={() => openImport()}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Nhập cấu hình
              </button>
            )}
          </div>

          {showImport && profileName && (
            <ImportWizard
              defaultProfileName={profileName}
              initialBundle={importBundle}
              onClose={() => {
                setShowImport(false);
                setImportBundle(undefined);
              }}
              onApplied={handleApplied}
            />
          )}

          {profileName && (
            <RevisionTable
              key={refreshKey}
              profileName={profileName}
              onReapply={(bundle) => openImport(bundle)}
              onActiveReleaseChange={setActiveRelease}
            />
          )}
        </div>
      )}

      {showExport && profileId && profileName && (
        <ExportDialog
          profileId={profileId}
          profileName={profileName}
          onClose={() => setShowExport(false)}
          onExported={refreshRevisions}
        />
      )}
    </section>
  );
}
