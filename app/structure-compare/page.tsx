'use client';

// app/structure-compare/page.tsx
// Structure-Mapped Document Comparison — So sánh theo Cấu trúc Ánh xạ
// Modern UI with clean layout, progressive pipeline, and rich report display.

import React, { useState, useRef, useCallback } from 'react';
import {
  FileText, Upload, GitCompare, CheckCircle2, AlertCircle,
  Loader2, ArrowRight, RotateCcw, Eye, ChevronDown, ChevronRight,
} from 'lucide-react';
import type {
  PipelineStep,
  PipelinePhase,
  UploadedFile,
  DocumentPair,
} from './types';
import type { MappingTable, ComparisonReport as ComparisonReportType } from '@/lib/structure-compare/types';
import { unmatchEntry } from '@/lib/structure-compare/section-mapper';
import { useWorkflowPolling } from './hooks/useWorkflowPolling';
import { MappingEditor } from './components/MappingEditor';
import { ComparisonReport } from './components/ComparisonReport';

// ─── Pipeline Step Definitions ───────────────────────────────────────────────

const PIPELINE_STEPS = [
  { id: 'upload', label: 'Tải lên', icon: Upload },
  { id: 'extract', label: 'Quét cấu trúc', icon: FileText },
  { id: 'mapping', label: 'Ghép cặp', icon: GitCompare },
  { id: 'review', label: 'Xác nhận', icon: Eye },
  { id: 'compare', label: 'So sánh', icon: GitCompare },
  { id: 'report', label: 'Báo cáo', icon: CheckCircle2 },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StructureComparePage() {
  const [phase, setPhase] = useState<PipelinePhase>('UPLOAD');
  const [documents, setDocuments] = useState<DocumentPair>({ v1: null, v2: null });
  const [realFiles, setRealFiles] = useState<File[]>([]);
  const [apiKeyId, setApiKeyId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const [mappingTable, setMappingTable] = useState<MappingTable | null>(null);
  const [report, setReport] = useState<ComparisonReportType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Workflow Polling ───────────────────────────────────────────────────────
  const { operationId, isPolling, apiError, submitWorkflow, resumeWorkflow } =
    useWorkflowPolling({
      onStepReveal: (stepIdx, backendStep) => {
        setActiveStep(stepIdx + 1);
        const stepNum = backendStep.step as number | undefined;
        const stepName = backendStep.stepName as string | undefined;
        if ((stepNum === 4 || stepName === 'Report Aggregation') && backendStep.extracted_data) {
          setReport(backendStep.extracted_data as ComparisonReportType);
        }
      },
      onComplete: () => {
        setPipelineComplete(true);
        setPhase('REPORT');
        setIsProcessing(false);
        setActiveStep(5);
        if (operationId) {
          fetch(`/api/v1/operations/${operationId}`)
            .then(res => res.json())
            .then(data => {
              const steps = data.result?.pipeline_steps || data.metadata?.pipeline_steps || [];
              const reportStep = steps.find((s: any) => s.step === 4 || s.stepName === 'Report Aggregation');
              if (reportStep?.extracted_data) setReport(reportStep.extracted_data as ComparisonReportType);
            })
            .catch(() => {});
        }
      },
      onError: (_stepIdx, message) => {
        setError(message);
        setIsProcessing(false);
      },
      onProgress: (_stepIdx, _percent) => {},
      onWaitingForInput: (_stepIdx, stepData) => {
        setPhase('REVIEWING');
        setIsProcessing(false);
        setActiveStep(3);
        if (stepData && typeof stepData === 'object') {
          const data = stepData as Record<string, unknown>;
          if (data.extracted_data) setMappingTable(data.extracted_data as MappingTable);
        }
      },
    });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleFilesSelected = useCallback((files: File[]) => {
    if (files.length < 2) return;
    setDocuments({
      v1: { id: `v1-${Date.now()}`, name: files[0].name, size: files[0].size, type: files[0].type, icon: '📄' },
      v2: { id: `v2-${Date.now()}`, name: files[1].name, size: files[1].size, type: files[1].type, icon: '📄' },
    });
    setRealFiles(files.slice(0, 2));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!documents.v1 || !documents.v2) return;
    if (!apiKeyId.trim()) {
      setError('Vui lòng nhập Profile API Key ID để chạy so sánh.');
      return;
    }
    setIsProcessing(true);
    setError(null);
    setPhase('EXTRACTING');
    setActiveStep(1);
    try {
      await submitWorkflow([documents.v1, documents.v2], realFiles, apiKeyId.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
      setIsProcessing(false);
    }
  }, [documents, realFiles, apiKeyId, submitWorkflow]);

  const handleConfirmMapping = useCallback(async (confirmedTable: MappingTable) => {
    setIsProcessing(true);
    setPhase('COMPARING');
    setActiveStep(4);
    try {
      await resumeWorkflow(confirmedTable);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi khi tiếp tục');
      setIsProcessing(false);
    }
  }, [resumeWorkflow]);

  const handleReset = useCallback(() => {
    setPhase('UPLOAD');
    setDocuments({ v1: null, v2: null });
    setRealFiles([]);
    setIsProcessing(false);
    setPipelineComplete(false);
    setMappingTable(null);
    setReport(null);
    setError(null);
    setActiveStep(0);
    setProgressMessage(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      <div className="mx-auto max-w-6xl px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200">
              <GitCompare className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">So sánh Cấu trúc Ánh xạ</h1>
              <p className="text-sm text-slate-500">So sánh hai phiên bản tài liệu với mapping cấu trúc thông minh</p>
            </div>
          </div>
        </div>

        {/* Pipeline Progress Bar */}
        <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            {PIPELINE_STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isComplete = idx < activeStep;
              const isCurrent = idx === activeStep && isProcessing;
              const isPending = idx > activeStep;
              return (
                <React.Fragment key={step.id}>
                  <div className="flex flex-col items-center gap-1.5">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-300 ${
                      isComplete ? 'bg-green-500 text-white shadow-md shadow-green-200' :
                      isCurrent ? 'bg-blue-500 text-white shadow-md shadow-blue-200 animate-pulse' :
                      'bg-slate-100 text-slate-400'
                    }`}>
                      {isComplete ? <CheckCircle2 className="h-4 w-4" /> :
                       isCurrent ? <Loader2 className="h-4 w-4 animate-spin" /> :
                       <Icon className="h-4 w-4" />}
                    </div>
                    <span className={`text-[11px] font-medium ${
                      isComplete ? 'text-green-600' : isCurrent ? 'text-blue-600' : 'text-slate-400'
                    }`}>{step.label}</span>
                  </div>
                  {idx < PIPELINE_STEPS.length - 1 && (
                    <div className={`mx-1 h-0.5 flex-1 rounded-full transition-all duration-500 ${
                      idx < activeStep ? 'bg-green-400' : 'bg-slate-200'
                    }`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Upload Section */}
        {phase === 'UPLOAD' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-12 transition-colors hover:border-blue-400 hover:bg-blue-50/30 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files);
                if (files.length >= 2) handleFilesSelected(files);
              }}
            >
              <div className="mb-4 rounded-full bg-blue-100 p-4">
                <Upload className="h-8 w-8 text-blue-600" />
              </div>
              <p className="mb-2 text-base font-medium text-slate-700">
                Kéo thả hoặc click để chọn 2 tài liệu
              </p>
              <p className="text-sm text-slate-500">
                V1 (bản gốc) và V2 (bản mới) • PDF, DOCX, ảnh (JPG/PNG/WEBP/HEIC)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,.heic,.heif"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length >= 2) handleFilesSelected(files);
                }}
              />
            </div>

            {/* API Key (Bắt buộc) — luôn hiển thị */}
            <div className="mt-6">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">API Key (x-api-key) <span className="text-red-500">*</span></label>
              <input
                type="password"
                placeholder="Nhập API Key (x-api-key, bắt buộc)"
                className={`w-full px-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500/50 ${!apiKeyId.trim() ? 'border-red-300' : 'border-slate-200'}`}
                value={apiKeyId}
                onChange={(e) => setApiKeyId(e.target.value)}
                disabled={isProcessing}
              />
              {!apiKeyId.trim() && <p className="text-[11px] text-red-500 mt-1">Vui lòng nhập API Key để sử dụng chức năng này.</p>}
            </div>

            {/* Selected files */}
            {documents.v1 && documents.v2 && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-xs font-bold text-orange-600">V1</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-700">{documents.v1.name}</p>
                    <p className="text-xs text-slate-400">Bản gốc</p>
                  </div>
                  <FileText className="h-4 w-4 text-slate-400" />
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-xs font-bold text-blue-600">V2</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-700">{documents.v2.name}</p>
                    <p className="text-xs text-slate-400">Bản mới</p>
                  </div>
                  <FileText className="h-4 w-4 text-slate-400" />
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={isProcessing || !apiKeyId.trim()}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 hover:shadow-xl disabled:opacity-50"
                >
                  <GitCompare className="h-4 w-4" />
                  Bắt đầu so sánh
                </button>
              </div>
            )}
          </div>
        )}

        {/* Processing State */}
        {isProcessing && phase !== 'REVIEWING' && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-6 text-center">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm font-medium text-blue-700">
              {phase === 'EXTRACTING' && 'Đang quét cấu trúc tài liệu...'}
              {phase === 'MAPPING' && 'Đang ghép cặp các phần...'}
              {phase === 'COMPARING' && 'Đang so sánh chi tiết...'}
            </p>
            <p className="mt-1 text-xs text-blue-500">Vui lòng chờ trong giây lát</p>
          </div>
        )}

        {/* Mapping Review */}
        {phase === 'REVIEWING' && mappingTable && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Xem xét Bảng Ánh xạ</h2>
                <p className="text-sm text-slate-500">
                  Hệ thống đã ghép cặp {mappingTable.entries.length} mục ({mappingTable.autoMappedPercentage}% tự động).
                  Kiểm tra và chỉnh sửa nếu cần.
                </p>
              </div>
            </div>
            <MappingEditor
              mappingTable={mappingTable}
              onConfirm={handleConfirmMapping}
              onAutoRemap={() => {}}
              onUnmatch={(entryId) => setMappingTable(unmatchEntry(mappingTable, entryId))}
              onReassign={() => {}}
            />
          </div>
        )}

        {/* Report */}
        {pipelineComplete && report && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Kết quả So sánh</h2>
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                So sánh mới
              </button>
            </div>
            <ComparisonReport
              report={report}
              v1FileName={documents.v1?.name || 'V1'}
              v2FileName={documents.v2?.name || 'V2'}
              mappingTable={mappingTable}
            />
          </div>
        )}

        {pipelineComplete && !report && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-500" />
            <h2 className="text-lg font-bold text-green-800">So sánh hoàn tất</h2>
            <p className="mt-1 text-sm text-green-600">Không phát hiện thay đổi giữa hai phiên bản.</p>
            <button onClick={handleReset} className="mt-4 rounded-lg bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
              So sánh mới
            </button>
          </div>
        )}

        {/* Error */}
        {(error || apiError) && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-medium text-red-800">Đã xảy ra lỗi</p>
                <p className="mt-1 text-sm text-red-600">{error || apiError}</p>
                <button onClick={handleReset} className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                  Thử lại
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
