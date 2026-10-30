'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Coins, FolderOpen, RotateCcw, ShieldCheck } from 'lucide-react';
import type { LoanFlow, LoanPhaseKey } from '@/app/loan-appraisal/types';
import { AppraisalWorkspace } from '@/components/loan-appraisal-v2/appraisal/AppraisalWorkspace';
import { IntakeWorkspace } from '@/components/loan-appraisal-v2/intake/IntakeWorkspace';
import { PageShell } from '@/components/loan-appraisal-v2/layout/PageShell';
import { ErrorBanner } from '@/components/loan-appraisal-v2/progress/ErrorBanner';
import { PipelineProgress } from '@/components/loan-appraisal-v2/progress/PipelineProgress';
import { SoftTimeoutNotice } from '@/components/loan-appraisal-v2/progress/SoftTimeoutNotice';
import { UsageCard } from '@/components/loan-appraisal-v2/progress/UsageCard';
import { CaseSetupPanel } from '@/components/loan-appraisal-v2/setup/CaseSetupPanel';
import type { FileEntry } from '@/components/loan-appraisal-v2/setup/FileList';
import { CaseSummary } from '@/components/loan-appraisal-v2/summary/CaseSummary';
import { DecisionPanel } from '@/components/loan-appraisal-v2/summary/DecisionPanel';
import { StickySummaryBar } from '@/components/loan-appraisal-v2/summary/StickySummaryBar';
import { Badge } from '@/components/loan-appraisal-v2/ui/Badge';
import { Button } from '@/components/loan-appraisal-v2/ui/Button';
import { EmptyState } from '@/components/loan-appraisal-v2/ui/EmptyState';
import { ErrorBoundary } from '@/components/loan-appraisal-v2/ui/ErrorBoundary';
import { EvidenceProvider } from '@/components/loan-appraisal-v2/ui/EvidenceContext';
import { Tabs, panelProps } from '@/components/loan-appraisal-v2/ui/Tabs';
import { COPY } from './copy';
import { useLoanAppraisalRun } from './hooks/useLoanAppraisalRun';
import { useOperationUrl } from './hooks/useOperationUrl';
import { DEFAULT_PRODUCT_CODE, coerceFlow, defaultFlowFor } from './lib/product-options';
import { customerNameFrom } from './lib/selectors';

const PHASE_PREFIX = 'la2-phase';
/** Hai giai đoạn xử lý + tab Chi phí & token đặt cuối cùng. */
type PageTab = LoanPhaseKey | 'USAGE';

export default function LoanAppraisalV2Page() {
  const run = useLoanAppraisalRun();
  const { state } = run;
  const { initialOperation, ready, writeOperation } = useOperationUrl();

  const [apiKey, setApiKey] = useState('');
  const [productCode, setProductCode] = useState<string>(DEFAULT_PRODUCT_CODE);
  const [flow, setFlow] = useState<LoanFlow>(defaultFlowFor(DEFAULT_PRODUCT_CODE) ?? 'FULL');
  const [customerName, setCustomerName] = useState('');
  const [loanNeed, setLoanNeed] = useState('');
  // Mặc định bỏ chọn: chạy hết một lần. Chọn: dừng sau giai đoạn 1 (stop_after_intake) rồi chuyển giai đoạn 2 thủ công.
  const [stopAfterIntake, setStopAfterIntake] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  // Người dùng chọn giai đoạn thủ công; không bao giờ tự nhảy khi kết quả về.
  const [activePhase, setActivePhase] = useState<PageTab>('DOSSIER_INTAKE');
  const [linkedOperation, setLinkedOperation] = useState<string | null>(null);
  const attachedOnce = useRef(false);

  // Tải lại với ?op=<id>: tự mở lại bằng phiên đăng nhập hiện tại (một lần).
  useEffect(() => {
    if (!ready || attachedOnce.current || !initialOperation) return;
    attachedOnce.current = true;
    setLinkedOperation(initialOperation);
    void run.attach(initialOperation);
  }, [ready, initialOperation, run]);

  // Chỉ mã operation được ghi vào URL; API key tuyệt đối không.
  useEffect(() => {
    if (state.operationId) {
      setLinkedOperation(state.operationId);
      writeOperation(state.operationId);
    }
  }, [state.operationId, writeOperation]);

  // Đồng bộ ô chọn với kết quả đang xem (mở lại ?op=<id> hoặc kết quả mới về). Sau đó người dùng vẫn đổi luồng được để chạy lại;
  // lựa chọn chỉ bị ghi đè khi luồng/sản phẩm của kết quả thay đổi.
  const resultFlow = state.result?.flow;
  const resultProduct = state.result?.product_code;
  useEffect(() => {
    if (resultProduct) setProductCode(resultProduct);
    if (resultFlow) setFlow(resultFlow as LoanFlow);
  }, [resultFlow, resultProduct]);

  const resetForInputChange = useCallback(() => {
    run.reset();
    setActivePhase('DOSSIER_INTAKE');
    setLinkedOperation(null);
    writeOperation(null);
  }, [run, writeOperation]);

  const handleFiles = useCallback((files: File[]) => {
    setEntries((previous) => [...previous, ...files.map((file) => ({ id: crypto.randomUUID(), file }))]);
    resetForInputChange();
  }, [resetForInputChange]);

  const handleRemove = useCallback((id: string) => {
    setEntries((previous) => previous.filter((entry) => entry.id !== id));
    resetForInputChange();
  }, [resetForInputChange]);

  const handleClear = useCallback(() => {
    setEntries([]);
    resetForInputChange();
  }, [resetForInputChange]);

  const handleRun = useCallback(() => {
    setActivePhase('DOSSIER_INTAKE');
    void run.submit(entries.map((entry) => entry.file), apiKey, flow, productCode, stopAfterIntake);
  }, [run, entries, apiKey, flow, productCode, stopAfterIntake]);

  // Đổi sản phẩm → luồng phải thuộc chương trình checklist của sản phẩm mới (giữ luồng cũ nếu vẫn hợp lệ).
  const handleProduct = useCallback((code: string) => {
    setProductCode(code);
    setFlow((current) => (coerceFlow(code, current) ?? current) as LoanFlow);
  }, []);

  // D-51: đang dừng sau giai đoạn 1 → chạy tiếp giai đoạn 2 rồi mở tab thẩm định; đã chạy xong → chỉ chuyển tab.
  const goToAppraisal = useCallback(() => {
    if (state.phase === 'paused') void run.resume();
    setActivePhase('CREDIT_APPRAISAL');
  }, [run, state.phase]);

  const reopen = useCallback(() => {
    if (linkedOperation) void run.attach(linkedOperation, apiKey || undefined);
  }, [run, linkedOperation, apiKey]);

  const result = state.result;
  const resolvedName = customerNameFrom(result) ?? customerName;
  const conditional = Boolean(result?.dossier_readiness?.appraisal_conditional);
  const canReopen = Boolean(linkedOperation) && !run.isBusy && (state.phase === 'stalled' || state.phase === 'idle' || (state.phase === 'failed' && state.error?.kind !== 'invalid-op'));

  const reopenButton = canReopen ? (
    <Button size="sm" onClick={reopen}><RotateCcw className="h-3.5 w-3.5" aria-hidden />Mở lại kết quả</Button>
  ) : undefined;

  const phaseTabs = [
    { id: 'DOSSIER_INTAKE' as const, label: 'Giai đoạn 1. Phân loại & kiểm tra sơ bộ', icon: FolderOpen, badge: conditional ? <Badge tone="warning">Cần bổ sung</Badge> : undefined },
    { id: 'CREDIT_APPRAISAL' as const, label: 'Giai đoạn 2. Bóc tách, đối chiếu & thẩm định', icon: ShieldCheck },
    { id: 'USAGE' as const, label: 'Chi phí & token', icon: Coins },
  ];

  const running = state.phase === 'running' || state.phase === 'submitting' || state.phase === 'cancelling';
  const showUsage = Boolean(state.usage) && (state.phase === 'succeeded' || state.phase === 'failed');
  const tabLabel = activePhase === 'DOSSIER_INTAKE' ? 'Giai đoạn phân loại & kiểm tra sơ bộ' : activePhase === 'USAGE' ? 'Chi phí & token' : 'Giai đoạn bóc tách, đối chiếu & thẩm định';

  return (
    <PageShell>
      <div className="space-y-5">
        <CaseSetupPanel
          phase={state.phase}
          apiKey={apiKey}
          onApiKey={setApiKey}
          productCode={result?.product_code ?? productCode}
          productLocked={Boolean(result?.product_code)}
          onProduct={handleProduct}
          flow={flow}
          onFlow={setFlow}
          customerName={resolvedName}
          customerLocked={Boolean(customerNameFrom(result))}
          onCustomerName={setCustomerName}
          loanNeed={loanNeed}
          onLoanNeed={setLoanNeed}
          stopAfterIntake={stopAfterIntake}
          onStopAfterIntake={setStopAfterIntake}
          entries={entries}
          onFiles={handleFiles}
          onRemove={handleRemove}
          onClear={handleClear}
          onRun={handleRun}
          onCancel={() => void run.cancel()}
        />

        <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
          <div className="space-y-4">
            <PipelineProgress state={state} onSelectPhase={setActivePhase} />
          </div>

          <div className="min-w-0 space-y-4">
            {state.phase === 'failed' && state.error && <ErrorBanner error={state.error} needsApiKey={state.needsApiKey} action={reopenButton} />}
            {state.phase === 'cancelled' && (
              <div role="status" className="rounded-xl border border-border bg-muted p-4 text-sm">
                <p className="font-semibold">Phiên thẩm định đã được huỷ</p>
                <p className="mt-1 text-xs text-muted-foreground">Workflow đã dừng và không có kết quả. Bạn có thể chạy lại với cùng bộ hồ sơ.</p>
              </div>
            )}
            {state.phase === 'stalled' && <SoftTimeoutNotice stalled action={reopenButton} />}
            {state.softTimeout && (state.phase === 'running' || state.phase === 'cancelling') && <SoftTimeoutNotice stalled={false} />}
            {state.phase === 'idle' && linkedOperation && !result && (
              <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted p-3 text-xs">
                <span>Đường dẫn đang gắn với operation <span className="font-mono">{linkedOperation.slice(0, 8)}</span>.</span>
                {reopenButton}
              </div>
            )}
            {state.phase === 'succeeded' && !result && (
              <div role="status" className="rounded-xl border border-border bg-muted p-4 text-sm">{COPY.noResult}</div>
            )}

            {result && <CaseSummary result={result} operationId={state.operationId} />}
            {state.phase === 'succeeded' && result && <DecisionPanel result={result} onGoToProfile={() => setActivePhase('CREDIT_APPRAISAL')} />}

            <EvidenceProvider records={result?.evidence?.records}>
              <section aria-label="Kết quả thẩm định" className="space-y-4">
                <Tabs items={phaseTabs} active={activePhase} onChange={setActivePhase} label="Giai đoạn xử lý hồ sơ" idPrefix={PHASE_PREFIX} variant="pill" />
                <div {...panelProps(PHASE_PREFIX, activePhase)}>
                  <ErrorBoundary label={tabLabel} key={activePhase}>
                    {activePhase === 'DOSSIER_INTAKE' ? (
                      <IntakeWorkspace
                        classification={state.classification}
                        precheck={state.precheck}
                        result={result}
                        running={running}
                        onGoToAppraisal={goToAppraisal}
                        appraisalPending={state.phase === 'paused' || state.phase === 'resuming'}
                        appraisalStarting={state.phase === 'resuming'}
                      />
                    ) : activePhase === 'USAGE' ? (
                      showUsage && state.usage
                        ? <UsageCard usage={state.usage} />
                        : <EmptyState icon={Coins} title="Chưa có số liệu chi phí">Chi phí và token hiển thị sau khi phiên thẩm định chạy xong.</EmptyState>
                    ) : (
                      <AppraisalWorkspace result={result} extraction={state.extraction} busy={running} apiKey={apiKey}
                        onRecompute={(file) => { void run.submit([file], apiKey, flow, productCode, false); }} />
                    )}
                  </ErrorBoundary>
                </div>
              </section>
            </EvidenceProvider>

            {result && <StickySummaryBar result={result} />}
          </div>
        </div>
      </div>
    </PageShell>
  );
}