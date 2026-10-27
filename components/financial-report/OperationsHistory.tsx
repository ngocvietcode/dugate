'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FINANCIAL_REPORT_OPERATION_SLUG,
  type FinancialReportHistoryOperation,
} from '@/lib/financial-report/client-helpers';

interface OperationsHistoryResponse {
  operations?: FinancialReportHistoryOperation[];
}

interface OperationsHistoryProps {
  disabled: boolean;
  onSelect: (operationName: string) => void;
}

/** Session-only history. This request intentionally never sends the pasted workflow API key. */
export function OperationsHistory({ disabled, onSelect }: OperationsHistoryProps) {
  const [operations, setOperations] = useState<FinancialReportHistoryOperation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        scope: 'mine',
        endpoint_slug: FINANCIAL_REPORT_OPERATION_SLUG,
        page_size: '10',
      });
      const response = await fetch(`/api/v1/operations?${params.toString()}`, {
        credentials: 'same-origin',
      });
      const body = await response.json() as OperationsHistoryResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || `Không tải được lịch sử (HTTP ${response.status}).`);
      setOperations(Array.isArray(body.operations) ? body.operations : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <section className="modern-card p-4 space-y-3" aria-labelledby="my-runs-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="my-runs-heading" className="text-xs font-semibold">Các lần chạy của tôi</h2>
          <p className="text-[11px] text-muted-foreground">Chỉ hiện operation do tài khoản phiên hiện tại tạo cho workflow này.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadHistory()}
          disabled={isLoading || disabled}
          className="modern-button btn-outline text-xs disabled:opacity-50"
        >
          {isLoading ? 'Đang tải...' : 'Tải lại danh sách'}
        </button>
      </div>

      {error && <p className="text-xs text-destructive">Không tải được lịch sử: {error}</p>}
      {!isLoading && !error && operations.length === 0 && (
        <p className="text-xs text-muted-foreground">Chưa có lần chạy nào được lưu cho tài khoản này.</p>
      )}
      {operations.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {operations.map((operation) => {
            const operationId = operation.name.replace(/^operations\//, '');
            const files = operation.input_files.length > 0 ? operation.input_files.join(', ') : 'Không có tên file';
            return (
              <li key={operation.name} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{files}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground" title={operationId}>{operationId}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {operation.metadata.state} · {operation.metadata.progress_percent}%
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(operation.name)}
                  disabled={disabled}
                  className="modern-button btn-outline text-xs disabled:opacity-50"
                >
                  Mở
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
