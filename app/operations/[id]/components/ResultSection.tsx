'use client';

import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { FinancialReportOperationsSummary, isFinancialReportEnvelope } from '@/components/financial-report/FinancialReportOperationsSummary';
import type { OperationDetail } from '../../types';

interface ResultSectionProps {
  operation: OperationDetail;
}

/**
 * Operations is a monitoring surface: it shows THAT a request finished and how,
 * never the customer result. The result itself goes to the integrating system
 * through the v1 API / webhook; the detail API does not return it.
 */
export default function ResultSection({ operation }: ResultSectionProps) {
  if (operation.state === 'SUCCEEDED') {
    const summary = isFinancialReportEnvelope(operation.resultSummary) ? operation.resultSummary : null;

    return (
      <div className="modern-card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">Kết quả xử lý</h3>
          {operation.outputFormat && (
            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
              {operation.outputFormat}
            </span>
          )}
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span>
            Xử lý thành công. Nội dung kết quả không hiển thị trên Operations để bảo vệ dữ liệu khách hàng;
            kết quả được trả cho hệ thống tích hợp qua API / webhook.
          </span>
        </p>

        {/* Typed operational summary (per-file status, counters, error codes) — no business figures. */}
        {summary && <FinancialReportOperationsSummary envelope={summary} />}
      </div>
    );
  }

  if (operation.state === 'FAILED') {
    return (
      <div className="modern-card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Kết quả</h3>

        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-2" role="alert">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" aria-hidden="true" />
            <span className="text-sm font-medium text-red-800 dark:text-red-400">
              {typeof operation.errorCode === 'string' ? operation.errorCode : 'ERROR'}
            </span>
          </div>
          <p className="text-sm text-red-700 dark:text-red-300">
            {typeof operation.errorMessage === 'string' ? operation.errorMessage : 'Đã xảy ra lỗi không xác định'}
          </p>
          {operation.failedAtStep !== null && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Thất bại tại bước {operation.failedAtStep + 1}
            </p>
          )}
        </div>

        {operation.stepsResultJson && operation.stepsResultJson.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Các bước đã hoàn thành trước khi thất bại
            </span>
            {operation.stepsResultJson.map((step, index) => (
              <div key={`${step.step}-${index}`} className="text-xs bg-muted p-2 rounded flex items-center gap-2">
                <span className="font-medium">Bước {step.step + 1}:</span>
                <span>{step.stepName || step.processor || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}
