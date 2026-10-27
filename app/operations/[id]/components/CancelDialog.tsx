'use client';

import { useState } from 'react';
import { XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface CancelDialogProps {
  operationId: string;
  done: boolean;
  onCancelled: () => void;
}

export default function CancelDialog({ operationId, done, onCancelled }: CancelDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  if (done) return null;

  const handleCancel = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/internal/operations/${operationId}/cancel`, {
        method: 'POST',
      });

      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Operation đã hoàn thành, không thể hủy');
        setOpen(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Không thể hủy operation');
        setOpen(false);
        return;
      }

      toast.success('Operation đã được hủy');
      setOpen(false);
      onCancelled();
    } catch {
      toast.error('Lỗi kết nối mạng');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-md text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
      >
        <XCircle className="w-4 h-4" />
        Hủy Operation
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !loading && setOpen(false)}
          />
          <div className="relative bg-background border border-border rounded-lg shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Xác nhận hủy</h3>
            </div>

            <p className="text-sm text-muted-foreground">
              Bạn có chắc chắn muốn hủy operation này? Hành động này không thể hoàn tác.
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setOpen(false)}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-foreground bg-muted rounded-md hover:bg-muted/80 transition-colors"
              >
                Quay lại
              </button>
              <button
                onClick={handleCancel}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Xác nhận hủy
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
