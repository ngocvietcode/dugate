'use client';

import { useState } from 'react';
import { AlertCircle, Play, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { OperationDetail } from '../../types';

interface WaitingInputSectionProps {
  operation: OperationDetail;
  onResumed: () => void;
}

export default function WaitingInputSection({ operation, onResumed }: WaitingInputSectionProps) {
  const [loading, setLoading] = useState(false);
  const [edited, setEdited] = useState(false);
  const [extractedDataStr, setExtractedDataStr] = useState(() => {
    // The detail API returns the waiting step's extracted data ONLY in this state.
    const data = operation.waitingInput?.extracted_data;
    return data ? JSON.stringify(data, null, 2) : '{}';
  });

  if (operation.state !== 'WAITING_USER_INPUT') return null;

  const handleResume = async () => {
    setLoading(true);
    try {
      let body: Record<string, unknown> = {};

      if (edited) {
        try {
          const parsedData = JSON.parse(extractedDataStr);
          body = {
            step: operation.waitingInput?.step ?? operation.currentStep,
            extracted_data: parsedData,
          };
        } catch {
          toast.error('JSON không hợp lệ. Vui lòng kiểm tra lại.');
          setLoading(false);
          return;
        }
      }

      const res = await fetch(`/api/internal/operations/${operation.id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Không thể tiếp tục xử lý');
        return;
      }

      toast.success('Đã tiếp tục xử lý');
      onResumed();
    } catch {
      toast.error('Lỗi kết nối mạng');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modern-card border-yellow-300 dark:border-yellow-700 bg-yellow-50/50 dark:bg-yellow-900/10 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
        <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
          Chờ xác nhận
        </h3>
      </div>

      <p className="text-sm text-muted-foreground">
        Operation đang chờ xác nhận từ người dùng. Bạn có thể chỉnh sửa dữ liệu trích xuất bên dưới trước khi tiếp tục.
      </p>

      {/* JSON editor */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Extracted Data (Bước {operation.currentStep + 1})
        </label>
        <textarea
          value={extractedDataStr}
          onChange={(e) => {
            setExtractedDataStr(e.target.value);
            setEdited(true);
          }}
          rows={10}
          className="input-field w-full font-mono text-xs resize-y"
          spellCheck={false}
        />
      </div>

      <button
        onClick={handleResume}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        Tiếp tục xử lý
      </button>
    </div>
  );
}
