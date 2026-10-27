'use client';

import Link from 'next/link';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  CircleAlert,
  Info,
  KeyRound,
  Loader2,
  LockKeyhole,
  Play,
  ShieldCheck,
  UploadCloud,
  UserRound,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AccountOpeningResult,
  AccountPhaseKey,
  AccountStageKey,
  BackendWorkflowStep,
  ClassifiedDoc,
  CustomerSegmentKey,
  ExtractedDoc,
  StepStatus,
  UploadedFile,
} from './types';
import { DEFAULT_PRODUCT_CODE, SEGMENTS, findProduct, findSegment, productsOfSegment } from './segments';
import { useAccountOpeningPolling } from './hooks/useAccountOpeningPolling';
import { OnboardingWorkspace } from './components/OnboardingWorkspace';

interface StepState {
  id: AccountStageKey;
  label: string;
  caption: string;
  phase: AccountPhaseKey;
  status: StepStatus;
}

const STAGE_ORDER: Array<Omit<StepState, 'status'>> = [
  { id: 'classify', label: 'Phân loại chứng từ', caption: 'Nhận dạng loại hồ sơ', phase: 'DOSSIER_INTAKE' },
  { id: 'extract_evidence', label: 'OCR & bóc tách', caption: 'Trích xuất dữ liệu có nguồn', phase: 'DOSSIER_INTAKE' },
  { id: 'consolidate_profile', label: 'Customer Profile', caption: 'Hợp nhất và kiểm tra chéo', phase: 'DOSSIER_INTAKE' },
  { id: 'evaluate_eligibility', label: 'Điều kiện mở', caption: 'Tuổi, giấy tờ, trường CIF', phase: 'ONBOARDING_ASSESSMENT' },
  { id: 'assess_cdd_risk', label: 'Rà soát khách hàng', caption: 'Năm yếu tố CDD', phase: 'ONBOARDING_ASSESSMENT' },
  { id: 'evaluate_policy_compliance', label: 'Policy & tuân thủ', caption: 'Rule theo phân khúc', phase: 'ONBOARDING_ASSESSMENT' },
  { id: 'screen_watchlists', label: 'Sàng lọc cảnh báo', caption: 'AML/PEP/sanctions/CIF', phase: 'ONBOARDING_ASSESSMENT' },
  { id: 'synthesize_decision', label: 'Kết luận & định tuyến', caption: 'Tuyến rà soát hồ sơ', phase: 'ONBOARDING_ASSESSMENT' },
];

const PHASE_META: Array<{ key: AccountPhaseKey; order: number; label: string; description: string }> = [
  {
    key: 'DOSSIER_INTAKE',
    order: 1,
    label: 'Tiếp nhận & hoàn thiện hồ sơ',
    description: 'Phân loại chứng từ, bóc tách, hợp nhất Customer Profile và kiểm tra chéo.',
  },
  {
    key: 'ONBOARDING_ASSESSMENT',
    order: 2,
    label: 'Đánh giá & kết luận mở tài khoản',
    description: 'Điều kiện, rà soát khách hàng theo phân khúc, policy rule, sàng lọc và kết luận.',
  },
];

function phaseStatusOf(steps: StepState[], phase: AccountPhaseKey): StepStatus | 'partial' {
  const group = steps.filter((step) => step.phase === phase);
  if (group.some((step) => step.status === 'error')) return 'error';
  if (group.some((step) => step.status === 'running')) return 'running';
  if (group.length > 0 && group.every((step) => step.status === 'done')) return 'done';
  if (group.some((step) => step.status === 'done')) return 'partial';
  return 'pending';
}

function getInitialSteps(): StepState[] {
  return STAGE_ORDER.map((stage) => ({ ...stage, status: 'pending' }));
}

function getFileType(name: string): string {
  const extension = name.split('.').pop();
  return extension ? extension.toUpperCase().slice(0, 5) : 'FILE';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function genCaseId(): string {
  return `AO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

/** Tên khách hàng ưu tiên lấy từ Customer Profile đã hợp nhất (cá nhân hoặc tổ chức). */
function customerNameFrom(result: AccountOpeningResult | null): string | null {
  const candidates = [
    result?.customer_profile?.organization?.business_name,
    result?.customer_profile?.identity?.full_name,
    result?.customer_profile?.identity?.legal_representative_name,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  return typeof found === 'string' ? found : null;
}

export default function AccountOpeningPage() {
  const [apiKeyId, setApiKeyId] = useState('');
  const [caseId] = useState(genCaseId);
  const [segmentKey, setSegmentKey] = useState<CustomerSegmentKey>('KHCN');
  const [productCode, setProductCode] = useState(DEFAULT_PRODUCT_CODE);
  const [customerName, setCustomerName] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [realFiles, setRealFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepState[]>(getInitialSteps());
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [classification, setClassification] = useState<ClassifiedDoc[] | null>(null);
  const [extraction, setExtraction] = useState<ExtractedDoc[] | null>(null);
  const [result, setResult] = useState<AccountOpeningResult | null>(null);
  // Người dùng chọn giai đoạn thủ công thì giữ nguyên lựa chọn đó qua các lần polling.
  const [phaseOverride, setPhaseOverride] = useState<AccountPhaseKey | null>(null);

  const segment = findSegment(segmentKey);
  const product = findProduct(productCode);
  const segmentProducts = useMemo(() => productsOfSegment(segmentKey), [segmentKey]);

  const resetRun = useCallback(() => {
    setSteps(getInitialSteps());
    setPhaseOverride(null);
    setPipelineComplete(false);
    setPipelineError(null);
    setClassification(null);
    setExtraction(null);
    setResult(null);
    setProgressMsg('');
    setProgressPercent(0);
  }, []);

  // Đổi phân khúc thì sản phẩm phải theo phân khúc đó, nếu không backend sẽ reject.
  const handleSegmentChange = useCallback((nextSegment: CustomerSegmentKey) => {
    setSegmentKey(nextSegment);
    const available = productsOfSegment(nextSegment);
    setProductCode(available[0]?.code ?? DEFAULT_PRODUCT_CODE);
    resetRun();
  }, [resetRun]);

  const revealStep = useCallback((stageKey: string, backendStep: BackendWorkflowStep) => {
    const data = backendStep.extracted_data;
    if (stageKey === 'classify' && Array.isArray(data)) setClassification(data as ClassifiedDoc[]);
    if (stageKey === 'extract_evidence' && Array.isArray(data)) setExtraction(data as ExtractedDoc[]);
    if ((stageKey === 'consolidate_profile' || stageKey === 'synthesize_decision') && data && typeof data === 'object') {
      // Stage 2 trả OnboardingEvaluation (chưa có segment/product), stage cuối trả
      // kết quả đầy đủ. Merge để UI luôn có nhãn phân khúc/sản phẩm để hiển thị.
      setResult((previous) => ({
        segment_key: segmentKey,
        segment_name: segment.name,
        product_code: product.code,
        product_name: product.name,
        documents: [],
        ...(previous ?? {}),
        ...(data as Partial<AccountOpeningResult>),
      } as AccountOpeningResult));
    }
    setSteps((previous) => {
      const stepIndex = previous.findIndex((step) => step.id === stageKey);
      if (stepIndex < 0) return previous;
      return previous.map((step, index) => {
        if (index === stepIndex) return { ...step, status: backendStep.status === 'FAILED' ? 'error' : 'done' };
        if (index === stepIndex + 1 && step.status === 'pending') return { ...step, status: 'running' };
        return step;
      });
    });
  }, [segmentKey, segment.name, product.code, product.name]);

  const polling = useAccountOpeningPolling({
    onStepReveal: revealStep,
    onComplete: (extracted) => {
      const completed = extracted && typeof extracted === 'object' ? extracted as AccountOpeningResult : null;
      if (completed) setResult(completed);
      setPipelineComplete(true);
      setIsProcessing(false);
      setProgressPercent(100);
      setSteps((previous) => previous.map((step) => ({ ...step, status: step.status === 'error' ? 'error' : 'done' })));
    },
    onError: (stageKey, message) => {
      setSteps((previous) => previous.map((step) => step.id === stageKey ? { ...step, status: 'error' as StepStatus } : step));
      setPipelineError(message);
      setPipelineComplete(true);
      setIsProcessing(false);
    },
    onProgress: (stageKey, percent, message) => {
      if (stageKey) {
        setSteps((previous) => previous.map((step) => step.id === stageKey && step.status === 'pending'
          ? { ...step, status: 'running' as StepStatus }
          : step));
      }
      setProgressPercent(percent);
      if (message) setProgressMsg(message.split('\n').slice(-1)[0] || '');
    },
  });

  const handleFileInput = useCallback((fileList: FileList) => {
    const selectedFiles = Array.from(fileList);
    const added: UploadedFile[] = selectedFiles.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type,
      icon: getFileType(file.name),
    }));
    setFiles((previous) => [...previous, ...added]);
    setRealFiles((previous) => [...previous, ...selectedFiles]);
    resetRun();
  }, [resetRun]);

  const handleFileRemoved = useCallback((id: string) => {
    const index = files.findIndex((file) => file.id === id);
    setFiles((previous) => previous.filter((file) => file.id !== id));
    setRealFiles((previous) => previous.filter((_, fileIndex) => fileIndex !== index));
    resetRun();
  }, [files, resetRun]);

  const handleClearAll = useCallback(() => {
    setFiles([]);
    setRealFiles([]);
    resetRun();
    const input = document.getElementById('ao-file-input') as HTMLInputElement | null;
    if (input) input.value = '';
  }, [resetRun]);

  // Hồ sơ chưa đủ điều kiện thì mặc định mở giai đoạn tiếp nhận, nhưng giai đoạn
  // đánh giá vẫn luôn xem được.
  const defaultPhase: AccountPhaseKey = result?.dossier_readiness
    ? (result.dossier_readiness.status === 'READY_FOR_ASSESSMENT' ? 'ONBOARDING_ASSESSMENT' : 'DOSSIER_INTAKE')
    : result?.cdd_assessment ? 'ONBOARDING_ASSESSMENT' : 'DOSSIER_INTAKE';
  const activePhase = phaseOverride ?? defaultPhase;

  const canRun = realFiles.length > 0 && !isProcessing && Boolean(apiKeyId);
  const resolvedCustomerName = customerNameFrom(result) ?? customerName;
  const completedStages = useMemo(() => steps.filter((step) => step.status === 'done').length, [steps]);

  const runOnboarding = async () => {
    if (!canRun) return;
    setIsProcessing(true);
    resetRun();
    setProgressPercent(5);
    setSteps((previous) => previous.map((step, index) => index === 0 ? { ...step, status: 'running' } : step));
    try {
      await polling.submitWorkflow(realFiles, apiKeyId, segmentKey, productCode);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSteps((previous) => previous.map((step, index) => index === 0 ? { ...step, status: 'error' as StepStatus } : step));
      setPipelineError(message);
      setPipelineComplete(true);
      setIsProcessing(false);
    }
  };

  const openFilePicker = () => document.getElementById('ao-file-input')?.click();

  const uploadSlot = (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={isProcessing ? -1 : 0}
        aria-label="Tải tài liệu hồ sơ mở tài khoản lên"
        className={`group relative overflow-hidden rounded-2xl border border-dashed p-5 text-center transition-all ${
          isProcessing
            ? 'cursor-not-allowed border-slate-200 opacity-50'
            : 'cursor-pointer border-cyan-300 bg-cyan-50 hover:border-cyan-500 hover:bg-cyan-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500'
        }`}
        onClick={() => !isProcessing && openFilePicker()}
        onKeyDown={(event) => {
          if (!isProcessing && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openFilePicker();
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!isProcessing && event.dataTransfer.files.length > 0) handleFileInput(event.dataTransfer.files);
        }}
      >
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-300/10 text-cyan-700 transition-transform group-hover:-translate-y-0.5">
          <UploadCloud className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-slate-900">Kéo thả bộ hồ sơ vào đây</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">PDF, ảnh, Word hoặc Excel · chọn nhiều tệp</p>
        <input
          id="ao-file-input"
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx"
          className="hidden"
          onChange={(event) => event.target.files && handleFileInput(event.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{files.length} tài liệu đầu vào</span>
            {!isProcessing && (
              <button type="button" onClick={handleClearAll} className="rounded-md px-2 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-300/10">
                Xóa tất cả
              </button>
            )}
          </div>
          <div className="max-h-64 space-y-2 overflow-auto pr-1">
            {files.map((file) => (
              <div key={file.id} className="group/file flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold tracking-wide text-cyan-700">
                  {file.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-800" title={file.name}>{file.name}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">{formatBytes(file.size)}</p>
                </div>
                {!isProcessing && (
                  <button
                    type="button"
                    aria-label={`Xóa ${file.name}`}
                    onClick={() => handleFileRemoved(file.id)}
                    className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-rose-400/10 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f4f7fb] text-slate-900">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute -left-36 top-12 h-96 w-96 rounded-full bg-cyan-300/20 blur-[120px]" />
        <div className="absolute right-0 top-0 h-[32rem] w-[32rem] rounded-full bg-indigo-300/20 blur-[150px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(rgba(15,23,42,.28) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,.28) 1px, transparent 1px)', backgroundSize: '48px 48px' }}
        />
      </div>

      <header className="relative z-30 border-b border-slate-200 bg-white/90 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1720px] items-center justify-between px-4 sm:px-6 xl:px-10">
          <div className="flex items-center gap-3">
            <Link href="/apps" aria-label="Quay lại danh sách ứng dụng" className="mr-1 rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-300 to-indigo-500 text-[#06101b] shadow-[0_0_28px_rgba(34,211,238,.22)]">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-slate-900">DUGATE <span className="font-medium text-cyan-700">Onboarding Intelligence</span></p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Account opening control plane</p>
            </div>
          </div>
          <div className="hidden items-center gap-5 sm:flex">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <LockKeyhole className="h-3.5 w-3.5 text-emerald-600" />
              Dữ liệu xử lý trong luồng bảo mật
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700">Showcase V1</span>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-[1720px] px-4 pb-16 pt-8 sm:px-6 xl:px-10">
        <section className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_520px] xl:items-end">
          <div className="max-w-4xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                <ShieldCheck className="h-3.5 w-3.5 text-cyan-700" />
                {product.name}
              </span>
              <span className="rounded-full border border-slate-200 px-3 py-1.5 font-mono text-[11px] text-slate-600">{caseId}</span>
              {polling.operationId && <span className="rounded-full border border-slate-200 px-3 py-1.5 font-mono text-[11px] text-slate-500">OP {polling.operationId.slice(0, 8)}</span>}
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold leading-[1.1] tracking-[-0.035em] text-slate-900 sm:text-5xl xl:text-[3.6rem]">
              Tiếp nhận hồ sơ mở tài khoản <span className="bg-gradient-to-r from-cyan-700 via-blue-700 to-indigo-700 bg-clip-text text-transparent">theo đúng phân khúc khách hàng.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
              Mỗi phân khúc có bộ chứng từ, ngưỡng và bộ rule riêng. Hệ thống phân loại chứng từ, hợp nhất Customer Profile,
              chấm điều kiện mở tài khoản, rà soát rủi ro khách hàng và đề xuất tuyến xử lý — toàn bộ đều truy được về chứng từ gốc.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,.10)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Onboarding console</p>
                <p className="mt-1 text-sm text-slate-600">Chọn phân khúc và sản phẩm</p>
              </div>
              <CaseStatus isProcessing={isProcessing} isComplete={pipelineComplete} hasError={Boolean(pipelineError)} result={result} />
            </div>

            <div className="space-y-3">
              <div>
                <span className="mb-1.5 block text-[11px] font-medium text-slate-600">Phân khúc khách hàng</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Phân khúc khách hàng">
                  {SEGMENTS.map((item) => {
                    const isActive = item.key === segmentKey;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        disabled={isProcessing}
                        aria-pressed={isActive}
                        onClick={() => handleSegmentChange(item.key)}
                        title={item.description}
                        className={`rounded-xl border px-2 py-2 text-center transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          isActive
                            ? 'border-cyan-400 bg-cyan-50 text-cyan-900 ring-2 ring-cyan-500/25'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="block text-xs font-bold">{item.key}</span>
                        <span className="mt-0.5 block text-[9px] leading-3">{item.shortName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium text-slate-600">Sản phẩm tài khoản</span>
                <select
                  value={productCode}
                  disabled={isProcessing}
                  onChange={(event) => { setProductCode(event.target.value); resetRun(); }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 disabled:opacity-70"
                >
                  {segmentProducts.map((item) => (
                    <option key={item.code} value={item.code}>{item.name}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[10px] leading-4 text-slate-500">{product.description}</span>
              </label>

              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-600"><UserRound className="h-3.5 w-3.5" /> Khách hàng trình diễn</span>
                <input
                  value={resolvedCustomerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  disabled={Boolean(customerNameFrom(result)) || isProcessing}
                  placeholder={segment.isOrganization ? 'Công ty TNHH ABC' : 'Nguyễn Văn A'}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 disabled:opacity-70"
                />
              </label>
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[10px] leading-4 text-slate-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Tên khách hàng chỉ phục vụ trình bày. Engine dùng dữ liệu trích xuất từ chứng từ làm nguồn sự thật.
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="relative block">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  value={apiKeyId}
                  onChange={(event) => setApiKeyId(event.target.value)}
                  disabled={isProcessing}
                  placeholder="API key cho phiên tiếp nhận"
                  aria-label="API key"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
                />
              </label>
              <button
                type="button"
                onClick={runOnboarding}
                disabled={!canRun}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-indigo-400 px-5 text-sm font-bold text-[#04101a] shadow-[0_12px_35px_rgba(34,211,238,.18)] transition hover:-translate-y-0.5 hover:shadow-[0_15px_40px_rgba(34,211,238,.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : pipelineComplete && !pipelineError ? <Check className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                {isProcessing ? 'Đang xử lý' : pipelineComplete && !pipelineError ? 'Chạy lại' : 'Bắt đầu tiếp nhận'}
              </button>
            </div>
            {!apiKeyId && <p className="mt-2 text-[11px] text-amber-800/80">Nhập API key và tải ít nhất một tài liệu để bắt đầu.</p>}
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,.08)] sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-700"><Activity className="h-4 w-4" /></div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Luồng tiếp nhận &amp; đánh giá</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">2 giai đoạn nghiệp vụ · 8 bước xử lý</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <span>{completedStages}/8 hoàn tất</span>
              <span className="font-mono text-cyan-700">{Math.round(progressPercent)}%</span>
            </div>
          </div>
          <div
            className="mb-5 h-1 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-label="Tiến độ workflow mở tài khoản"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPercent)}
          >
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-indigo-400 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }} />
          </div>
          <PhaseRail steps={steps} activePhase={activePhase} onSelectPhase={setPhaseOverride} />
          {(isProcessing || progressMsg) && (
            <div className="mt-4 flex items-center gap-2 border-t border-slate-200 pt-4 text-xs text-slate-600" aria-live="polite">
              {isProcessing && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-700" />}
              <span>{progressMsg || 'Đang khởi tạo workflow và chuẩn bị tài liệu…'}</span>
            </div>
          )}
        </section>

        {pipelineError && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800" role="alert">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Không thể hoàn tất phiên tiếp nhận</p>
              <p className="mt-1 text-xs leading-5 text-rose-700">{pipelineError}</p>
            </div>
          </div>
        )}

        <div className="mt-6">
          <OnboardingWorkspace
            segment={segment}
            product={product}
            template={product.checklist}
            classification={classification}
            extraction={extraction}
            result={result}
            uploadSlot={uploadSlot}
            activePhase={activePhase}
            onPhaseChange={setPhaseOverride}
            caseId={caseId}
          />
        </div>
      </div>

      {isProcessing && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-2xl border border-cyan-200 bg-white/95 px-4 py-3 shadow-xl backdrop-blur-xl" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-700" />
          <div>
            <p className="text-xs font-semibold text-slate-900">Control plane đang xử lý</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Có thể theo dõi từng stage trên pipeline</p>
          </div>
        </div>
      )}
    </main>
  );
}

function CaseStatus({ isProcessing, isComplete, hasError, result }: {
  isProcessing: boolean;
  isComplete: boolean;
  hasError: boolean;
  result: AccountOpeningResult | null;
}) {
  let label = 'Sẵn sàng';
  let style = 'border-slate-200 bg-slate-50 text-slate-600';
  let Icon = Circle;
  if (isProcessing) {
    label = 'Đang xử lý';
    style = 'border-cyan-300/20 bg-cyan-300/10 text-cyan-700';
    Icon = Loader2;
  } else if (hasError) {
    label = 'Có lỗi';
    style = 'border-rose-300/20 bg-rose-300/10 text-rose-700';
    Icon = XCircle;
  } else if (isComplete) {
    const status = result?.processing_status;
    label = status === 'COMPLETE' ? 'Hoàn tất' : status === 'BLOCKED' ? 'Bị chặn' : 'Cần rà soát';
    style = status === 'COMPLETE'
      ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-700'
      : status === 'BLOCKED'
        ? 'border-rose-300/20 bg-rose-300/10 text-rose-700'
        : 'border-amber-300/20 bg-amber-300/10 text-amber-800';
    Icon = status === 'COMPLETE' ? CheckCircle2 : CircleAlert;
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${style}`}>
      <Icon className={`h-3 w-3 ${isProcessing ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}

function phaseToneClass(status: StepStatus | 'partial'): string {
  if (status === 'running') return 'border-cyan-300 bg-cyan-50';
  if (status === 'done') return 'border-emerald-200 bg-emerald-50';
  if (status === 'error') return 'border-rose-200 bg-rose-50';
  if (status === 'partial') return 'border-amber-200 bg-amber-50';
  return 'border-slate-200 bg-slate-50';
}

function stepDotClass(status: StepStatus): string {
  if (status === 'running') return 'bg-cyan-500';
  if (status === 'done') return 'bg-emerald-500';
  if (status === 'error') return 'bg-rose-500';
  return 'bg-slate-300';
}

function PhaseRail({ steps, activePhase, onSelectPhase }: {
  steps: StepState[];
  activePhase: AccountPhaseKey;
  onSelectPhase: (phase: AccountPhaseKey) => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {PHASE_META.map((phase) => {
        const group = steps.filter((step) => step.phase === phase.key);
        const status = phaseStatusOf(steps, phase.key);
        const doneCount = group.filter((step) => step.status === 'done').length;
        const isActive = activePhase === phase.key;
        return (
          <section
            key={phase.key}
            className={`rounded-2xl border transition-all ${phaseToneClass(status)} ${isActive ? 'ring-2 ring-cyan-500 ring-offset-2' : ''}`}
            aria-current={status === 'running' ? 'step' : undefined}
          >
            <div className="flex items-start gap-3 p-4">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                status === 'running' ? 'bg-cyan-500 text-white'
                  : status === 'done' ? 'bg-emerald-500 text-white'
                    : status === 'error' ? 'bg-rose-500 text-white'
                      : status === 'partial' ? 'bg-amber-500 text-white'
                        : 'bg-slate-200 text-slate-600'
              }`}>
                {status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" />
                  : status === 'done' ? <Check className="h-4 w-4" />
                    : status === 'error' ? <X className="h-4 w-4" />
                      : phase.order}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectPhase(phase.key)}
                    aria-pressed={isActive}
                    className="rounded text-left text-sm font-semibold text-slate-900 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                  >
                    {phase.label}
                  </button>
                  <span className="text-[10px] font-medium text-slate-500">{doneCount}/{group.length}</span>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-slate-600">{phase.description}</p>
                <ul className="mt-3 space-y-1.5">
                  {group.map((step) => (
                    <li key={step.id} className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${stepDotClass(step.status)}`} />
                      <span className={`text-[11px] ${step.status === 'pending' ? 'text-slate-500' : 'font-medium text-slate-800'}`}>{step.label}</span>
                      <span className="truncate text-[10px] text-slate-400">· {step.caption}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
