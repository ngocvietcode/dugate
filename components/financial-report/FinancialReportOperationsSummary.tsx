'use client';

import { REPORT_TYPES } from '@/lib/pipelines/workflows/financial-report/types';
import type {
  FileProcessingInfo,
  FinancialReportEnvelope,
  FinancialReportPayload,
  ReportType,
} from '@/lib/pipelines/workflows/financial-report/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFileResultLike(value: unknown): boolean {
  return isRecord(value)
    && typeof value.fileId === 'string'
    && typeof value.fileName === 'string'
    && typeof value.status === 'string';
}

/** Recognize only the public financial-report envelope; other Operations results stay generic JSON. */
export function isFinancialReportEnvelope(value: unknown): value is FinancialReportEnvelope {
  if (!isRecord(value)
    || !Number.isFinite(value.code)
    || typeof value.requestId !== 'string'
    || typeof value.message !== 'string'
    || typeof value.timestamp !== 'string'
    || typeof value.targetLang !== 'string') {
    return false;
  }
  return value.data === null || (Array.isArray(value.data) && value.data.every(isFileResultLike));
}

function formatRanges(info: FileProcessingInfo): string {
  return info.failedPageRanges.length === 0
    ? '—'
    : info.failedPageRanges.map((range) => range.from === range.to ? `${range.from}` : `${range.from}–${range.to}`).join(', ');
}

export function FinancialReportProcessingInfo({ info }: { info: FileProcessingInfo }) {
  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Quá trình xử lý</p>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-xs">
        <div className="flex gap-2"><dt className="text-muted-foreground min-w-[140px]">Số trang</dt><dd className="font-medium">{info.totalPages}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground min-w-[140px]">Chunk bóc tách lỗi</dt><dd className="font-medium">{info.extractChunksFailed}/{info.extractChunksTotal}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground min-w-[140px]">Cửa sổ phân loại lỗi</dt><dd className="font-medium">{info.classifyWindowsFailed}/{info.classifyWindowsTotal}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground min-w-[140px]">Trang không bóc được</dt><dd className="font-medium">{formatRanges(info)}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground min-w-[140px]">Bước dịch</dt><dd className="font-medium">{info.translationStatus}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground min-w-[140px]">Nội dung chưa dịch</dt><dd className="font-medium">{info.untranslatedItems}</dd></div>
      </dl>
      {info.failureReasons.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">Lý do lỗi kỹ thuật ({info.failureReasons.length})</summary>
          <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
            {info.failureReasons.map((reason, index) => <li key={`${index}-${reason}`} className="break-all">• {reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function ReportWarnings({ report }: { report: FinancialReportPayload }) {
  const presentReports = REPORT_TYPES.flatMap((reportType) => {
    const data = report[reportType];
    return data ? [[reportType, data] as const] : [];
  });
  if (presentReports.length === 0) return <p className="mt-3 text-xs text-muted-foreground">Không có báo cáo công khai.</p>;

  return (
    <div className="mt-3 overflow-x-auto">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Trạng thái báo cáo</p>
      <table className="w-full text-xs border-collapse">
        <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">Báo cáo</th><th className="py-1 pr-3">Trạng thái</th><th className="py-1">Cảnh báo</th></tr></thead>
        <tbody>{presentReports.map(([reportType, data]) => (
          <tr key={reportType} className="border-t border-border/50 align-top">
            <td className="py-1.5 pr-3 font-medium">{reportType}</td>
            <td className="py-1.5 pr-3">{data.status}</td>
            <td className="py-1.5 text-[11px] text-muted-foreground">
              {data.warnings.length === 0 ? '—' : data.warnings.map((warning, index) => (
                <div key={`${warning.code}-${index}`}><code className="font-mono text-amber-700">{warning.code}</code>{warning.message ? ` — ${warning.message}` : ''}</div>
              ))}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function FinancialReportOperationsSummary({ envelope }: { envelope: FinancialReportEnvelope }) {
  const files = envelope.data ?? [];
  return (
    <section className="space-y-3" aria-label="Kết quả OCR và dịch báo cáo tài chính">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
        <span className="font-semibold">OCR &amp; Dịch Báo cáo tài chính</span> · code={envelope.code} · {envelope.message}
      </div>
      {files.map((file) => (
        <article key={file.fileId} className="rounded-lg border border-border p-3">
          <h4 className="text-sm font-semibold">{file.fileName}</h4>
          <p className="mt-1 text-xs">Trạng thái file: <strong>{file.status}</strong></p>
          {(file.errorCode || file.errorMessage || file.diagnostic) && (
            <p className="mt-1 text-xs text-muted-foreground"><code>{file.errorCode}</code>{file.errorMessage ? ` — ${file.errorMessage}` : ''}{file.diagnostic ? ` — ${file.diagnostic}` : ''}</p>
          )}
          {file.processingInfo && <FinancialReportProcessingInfo info={file.processingInfo} />}
          {file.report && <ReportWarnings report={file.report} />}
        </article>
      ))}
    </section>
  );
}
