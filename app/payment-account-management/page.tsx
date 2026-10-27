'use client';

// app/payment-account-management/page.tsx
// Test UI for the payment-account-management workflow (mode = open).
// Upload local files → run a stage → per-file classification/extraction cards.
// See DESIGN.md for the design/control doc.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import type { UploadedFile, PamStage, PamMode, DocCard, RunStatus, BankData } from './types';
import { usePamPolling, buildMetadata } from './hooks/usePamPolling';
import { ModeStageBar } from './components/ModeStageBar';
import { SummaryStrip } from './components/SummaryStrip';
import { DocumentCard } from './components/DocumentCard';
import { CopyButton } from './components/CopyButton';
import { BankDataPanel } from './components/BankDataPanel';
import { pruneBankData, bankDataFromMb03 } from './components/bank-data';
import { partitionByFormTemplate, groupByParentFile } from './components/card-grouping';

// Re-typing an API key and a bank-data payload on every reload is the main
// friction in a test page, so both persist across a reload. The key only persists
// for the tab (sessionStorage), the bank data persists properly (localStorage).
const SS_API_KEY = 'pam.apiKey';
const LS_BANK_DATA = 'pam.bankData';

function getFileIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return '📄';
  if (/\.(jpg|jpeg|png)$/.test(n)) return '🖼️';
  return '📎';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function PaymentAccountManagementPage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [realFiles, setRealFiles] = useState<File[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [mode, setMode] = useState<PamMode>('open');
  const [stage, setStage] = useState<PamStage>('e2e');
  const [bankData, setBankData] = useState<BankData>({});

  // Restore persisted key + bank data once on mount (client-only).
  // [SEC 18/09 P2.2] The API key lives in sessionStorage, not localStorage: it is a
  // /api/v1 credential that may carry the ADMIN role, so it must not outlive the tab
  // or survive a sign-out. LS_BANK_DATA below stays in localStorage — business data,
  // not a secret, and operators rely on it persisting.
  useEffect(() => {
    try {
      const key = sessionStorage.getItem(SS_API_KEY);
      if (key) setApiKey(key);
      const saved = localStorage.getItem(LS_BANK_DATA);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) setBankData(parsed);
      }
    } catch {
      // Corrupt/unavailable localStorage is not worth surfacing on a test page.
    }
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(SS_API_KEY, apiKey); } catch { /* ignore */ }
  }, [apiKey]);

  useEffect(() => {
    try { localStorage.setItem(LS_BANK_DATA, JSON.stringify(bankData)); } catch { /* ignore */ }
  }, [bankData]);

  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<DocCard[]>([]);
  const [envelope, setEnvelope] = useState<unknown>(null);
  const envelopeStatus = (envelope as any)?.status as string | undefined;
  // The runner's own result sits under envelope.result; update mode may signal
  // that the required MB03 document was not found, or that the bank system data
  // (metadata.data) was not provided for reconciliation.
  const runnerResult = (envelope as any)?.result;
  const requiredDocMissing = runnerResult?.status === 'REQUIRED_DOCUMENT_MISSING';
  const bankDataMissing = runnerResult?.data_status === 'BANK_DATA_MISSING';
  // The payload the backend actually parsed, echoed back. Not the same as the
  // form state: unknown keys were dropped, so this is what the compare really saw.
  const echoedBankData = (runnerResult?.bank_data ?? null) as BankData | null;

  const isProcessing = runStatus === 'running';

  const reset = useCallback(() => {
    setRunStatus('idle');
    setProgress(0);
    setProgressMsg('');
    setError(null);
    setCards([]);
    setEnvelope(null);
  }, []);

  const polling = usePamPolling({
    onProgress: (pct, msg) => {
      setProgress(pct);
      if (msg) setProgressMsg(msg);
    },
    onComplete: (docCards, env) => {
      setCards(docCards);
      setEnvelope(env);
      setRunStatus('complete');
    },
    onError: (msg) => {
      setError(msg);
      setRunStatus('error');
    },
  });

  // ── File handling ───────────────────────────────────────────────────────────
  const handleFileInput = useCallback((fileList: FileList) => {
    const newFiles: UploadedFile[] = Array.from(fileList).map(f => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size,
      type: f.type,
      icon: getFileIcon(f.name),
    }));
    setFiles(prev => [...prev, ...newFiles]);
    setRealFiles(prev => [...prev, ...Array.from(fileList)]);
    reset();
  }, [reset]);

  const handleRemove = useCallback((id: string) => {
    const idx = files.findIndex(f => f.id === id);
    setFiles(prev => prev.filter(f => f.id !== id));
    setRealFiles(prev => prev.filter((_, i) => i !== idx));
    reset();
  }, [files, reset]);

  const handleClearAll = useCallback(() => {
    setFiles([]);
    setRealFiles([]);
    reset();
    const input = document.getElementById('pam-file-input') as HTMLInputElement | null;
    if (input) input.value = '';
  }, [reset]);

  // ── Run ─────────────────────────────────────────────────────────────────────
  const run = async () => {
    if (files.length === 0 || isProcessing || !apiKey) return;
    reset();
    setRunStatus('running');
    setProgress(5);
    try {
      await polling.submitWorkflow(
        files, realFiles, stage, mode, apiKey || undefined, pruneBankData(bankData),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunStatus('error');
    }
  };

  const canRun = files.length > 0 && !isProcessing && !!apiKey;

  // `metadata.data` is only read by the update runner at stage e2e.
  const bankDataActive = mode === 'update' && stage === 'e2e';

  // After a run, offer to seed the bank form from the extracted MB03 so every
  // (full_name, id_no) matches and the tester only has to break one field.
  const prefillSource = useMemo(() => {
    const mb03 = cards.find(c => c.classification?.code === 'MB03' && c.extracted);
    return mb03 ? bankDataFromMb03(mb03.extracted) : null;
  }, [cards]);

  // The exact metadata that will be sent — copyable into a cURL when a run
  // behaves differently than the UI suggests it should.
  const metadataPreview = useMemo(
    () => JSON.stringify(buildMetadata(mode, stage, pruneBankData(bankData)), null, 2),
    [mode, stage, bankData],
  );

  return (
    <div className="min-h-screen pb-20 relative overflow-hidden">
      <div className="glow-purple -top-60 -left-40 fixed opacity-30" aria-hidden="true" />
      <div className="glow-cyan -bottom-40 -right-60 fixed opacity-20" aria-hidden="true" />

      {/* Header */}
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-6 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold text-primary tracking-wider uppercase mb-4">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Payment Account Management — Live API
        </div>
        <h1 className="text-3xl md:text-4xl font-heading font-bold tracking-tight mb-3">
          <span className="text-gradient">Quản lý tài khoản thanh toán</span>
        </h1>
        <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
          Upload hồ sơ mở tài khoản (PDF / ảnh) từ máy → Phân loại &amp; Trích xuất từng tài liệu → Xác minh.
        </p>

        {/* API Key */}
        <div className="mt-4 mx-auto max-w-sm">
          <input
            type="password"
            placeholder="Nhập API Key (bắt buộc)"
            className={`w-full px-3 py-2 text-xs bg-background border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-center ${!apiKey ? 'border-red-300' : 'border-border'}`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={isProcessing}
          />
          {!apiKey && <p className="text-[10px] text-red-500 mt-1">Vui lòng nhập API Key để sử dụng</p>}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 space-y-6">
        {/* Mode + Stage */}
        <ModeStageBar mode={mode} stage={stage} onModeChange={setMode} onStageChange={setStage} disabled={isProcessing} />

        {/* Upload */}
        <div className="modern-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-lg">📁</div>
            <div>
              <h2 className="font-heading font-bold text-lg">Upload Hồ sơ</h2>
              <p className="text-muted-foreground text-xs">Nhiều file PDF hoặc ảnh (đơn mở tài khoản, giấy tờ tùy thân, ...)</p>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer hover:border-primary/50 hover:bg-primary/5 ${isProcessing ? 'pointer-events-none opacity-50' : 'border-border'}`}
            onClick={() => document.getElementById('pam-file-input')?.click()}
            onKeyDown={(e) => e.key === 'Enter' && document.getElementById('pam-file-input')?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length > 0) handleFileInput(e.dataTransfer.files); }}
          >
            <div className="text-4xl mb-2">📤</div>
            <p className="font-semibold text-sm mb-1">Kéo thả file hoặc click để chọn</p>
            <p className="text-xs text-muted-foreground">PDF, JPG, PNG</p>
            <input
              id="pam-file-input"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={e => e.target.files && handleFileInput(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {files.length} file đã chọn
                </span>
                {!isProcessing && (
                  <button onClick={handleClearAll} className="text-xs text-destructive hover:text-destructive/80 font-medium">
                    Xóa tất cả
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {files.map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/50 border border-border/50 group hover:border-primary/30 transition-all">
                    <span className="text-xl flex-shrink-0">{f.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                    </div>
                    {!isProcessing && (
                      <button onClick={() => handleRemove(f.id)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded-lg transition-all">
                        <span className="text-xs text-muted-foreground hover:text-destructive">✕</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Core-bank data (mode=update) */}
        {mode === 'update' && (
          <BankDataPanel
            value={bankData}
            onChange={setBankData}
            disabled={isProcessing}
            active={bankDataActive}
            prefillSource={prefillSource}
          />
        )}

        {/* Actions + overall progress */}
        {files.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <button
                onClick={run}
                disabled={!canRun || runStatus === 'complete'}
                className="modern-button btn-primary text-sm gap-2 flex-1 sm:flex-none disabled:opacity-50"
              >
                {isProcessing ? <><Spinner /> Đang xử lý...</>
                  : runStatus === 'complete' ? <>✓ Hoàn tất</>
                  : <>▶ Bắt đầu</>}
              </button>
              {(runStatus === 'complete' || runStatus === 'error') && (
                <button onClick={reset} className="modern-button btn-outline text-sm">↻ Chạy lại</button>
              )}
            </div>

            {/* Exact outgoing metadata — for reproducing a run via cURL */}
            <details className="text-xs">
              <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
                Xem payload sẽ gửi (metadata)
              </summary>
              <div className="mt-2 flex items-start gap-2">
                <pre className="flex-1 text-[11px] font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto bg-muted/40 rounded-lg p-3 leading-relaxed">
                  {metadataPreview}
                </pre>
                <CopyButton getText={() => metadataPreview} label="Copy" />
              </div>
            </details>

            {(isProcessing || runStatus === 'complete') && (
              <div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 rounded-full ${runStatus === 'complete' ? 'bg-emerald-500' : 'bg-primary'}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {progressMsg && <p className="text-[11px] text-muted-foreground mt-1.5">{progressMsg}</p>}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="modern-card p-4 border-destructive/30 bg-destructive/5 flex items-center gap-3">
            <span className="text-destructive text-lg">⚠️</span>
            <p className="text-sm font-medium text-destructive flex-1">{error}</p>
          </div>
        )}

        {/* Results */}
        {runStatus === 'complete' && envelope != null && (
          <>
            {/* Results header: title + copy full API response */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-heading font-bold text-lg">Kết quả</h2>
              <CopyButton
                getText={() => JSON.stringify(envelope, null, 2)}
                label="Copy toàn bộ response"
              />
            </div>

            {requiredDocMissing && (
              <div className="modern-card p-4 border border-amber-400/50 bg-amber-500/10">
                <p className="text-sm font-semibold text-amber-700">
                  ⚠️ Thiếu tài liệu bắt buộc{runnerResult?.required_code ? ` (${runnerResult.required_code})` : ''}
                </p>
                <p className="text-xs text-amber-700/90 mt-1">
                  {runnerResult?.message ?? 'Nghiệp vụ này yêu cầu một tài liệu bắt buộc không có trong hồ sơ.'}
                </p>
              </div>
            )}

            {bankDataMissing && (
              <div className="modern-card p-4 border border-amber-400/50 bg-amber-500/10">
                <p className="text-sm font-semibold text-amber-700">
                  ⚠️ Thiếu dữ liệu hệ thống ngân hàng
                </p>
                <p className="text-xs text-amber-700/90 mt-1">
                  {runnerResult?.warning ?? 'Dữ liệu tài khoản từ hệ thống ngân hàng chưa được cung cấp — không thể đối chiếu.'}
                </p>
              </div>
            )}

            {cards.length > 0 && (
              <>
                <SummaryStrip cards={cards} envelopeStatus={envelopeStatus} />
                <DocumentCardGrid cards={cards} bankData={echoedBankData} />
              </>
            )}

            {cards.length === 0 && !error && (
              <div className="modern-card p-4 text-sm text-muted-foreground">
                Workflow hoàn tất nhưng không có tài liệu nào để hiển thị.
              </div>
            )}

            {/* Raw JSON (collapsed) — the full API response, copyable above */}
            <details className="modern-card p-4">
              <summary className="text-sm font-medium cursor-pointer select-none">
                Xem JSON đầy đủ (API response)
              </summary>
              <pre className="mt-3 text-[11px] font-mono whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto bg-muted/40 rounded-lg p-3 leading-relaxed">
                {JSON.stringify(envelope, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>

      {/* Floating progress */}
      {isProcessing && (
        <div className="fixed bottom-6 right-6 px-4 py-2.5 rounded-2xl bg-card/90 backdrop-blur-xl border border-primary/20 shadow-lg flex items-center gap-3 z-50">
          <Spinner />
          <span className="text-sm font-medium">Đang xử lý...</span>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/**
 * Forms full width (one per row), other documents in the 2-column grid.
 *
 * A form carries ~200 potential sub-fields across nested record cards and
 * container sections; at half width its inner 2-column field tables wrap badly.
 * An identity document is a handful of flat fields and reads fine at half width.
 *
 * Section headings appear only when BOTH groups are non-empty — a dossier that is
 * all forms, or all identity documents, needs no labels to explain itself.
 * Unknown-classified cards fall into "Tài liệu khác"; their own grey styling
 * already flags them, so they don't warrant a third section.
 */
function CardSections({
  cards,
  bankData,
  headingLevel = 'section',
}: {
  cards: DocCard[];
  bankData: BankData | null;
  /** 'section' for top-level use; 'sub' inside a split-mode file group. */
  headingLevel?: 'section' | 'sub';
}) {
  const { forms, others } = partitionByFormTemplate(cards);
  const showHeadings = forms.length > 0 && others.length > 0;
  const headingClass =
    headingLevel === 'section'
      ? 'text-sm font-semibold'
      : 'text-[11px] font-semibold text-muted-foreground uppercase tracking-wider';

  return (
    <div className="flex flex-col gap-4">
      {forms.length > 0 && (
        <div className="flex flex-col gap-2">
          {showHeadings && (
            <h3 className={headingClass}>
              Mẫu biểu <span className="text-muted-foreground font-normal">({forms.length})</span>
            </h3>
          )}
          <div className="flex flex-col gap-3">
            {forms.map(card => (
              <DocumentCard key={card.key} card={card} bankData={bankData} />
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          {showHeadings && (
            <h3 className={headingClass}>
              Tài liệu khác <span className="text-muted-foreground font-normal">({others.length})</span>
            </h3>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {others.map(card => (
              <DocumentCard key={card.key} card={card} bankData={bankData} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Render the document cards. In SPLIT mode (any card has `source`) the OUTER
 * grouping stays by parent scan file — that grouping exists so a reviewer can see
 * which scan each segment came from, and re-cutting it by document type would
 * destroy that. Form-vs-other splitting then applies inside each file group.
 */
function DocumentCardGrid({ cards, bankData }: { cards: DocCard[]; bankData: BankData | null }) {
  const isSplit = cards.some(c => c.source);
  if (!isSplit) {
    return <CardSections cards={cards} bankData={bankData} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {groupByParentFile(cards).map(group => (
        <div key={group.fileId} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden="true">📄</span>
            <span className="truncate" title={group.name}>{group.name}</span>
            <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded-full bg-muted">
              tách thành {group.cards.length} tài liệu
            </span>
          </div>
          <CardSections cards={group.cards} bankData={bankData} headingLevel="sub" />
        </div>
      ))}
    </div>
  );
}
