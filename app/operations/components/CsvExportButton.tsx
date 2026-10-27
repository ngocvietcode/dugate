'use client';

import { useState, useCallback } from 'react';
import { Download, Loader2, Sheet } from 'lucide-react';
import { toast } from 'sonner';
import type { OperationFiltersState } from '../types';

interface CsvExportButtonProps {
  filters: OperationFiltersState;
}

export default function CsvExportButton({ filters }: CsvExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filters.state !== 'ALL') params.set('state', filters.state);
      if (filters.endpoint !== 'ALL') params.set('endpoint', filters.endpoint);
      if (filters.profile !== 'ALL') params.set('profile', filters.profile);
      if (filters.searchQuery) params.set('q', filters.searchQuery);
      if (filters.startDate) params.set('start_date', filters.startDate);
      if (filters.endDate) params.set('end_date', filters.endDate);

      const res = await fetch(`/api/internal/operations/export-csv?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || `Xuất CSV thất bại (HTTP ${res.status})`);
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";\n]+)"?/);
      const filename = match?.[1] || 'operations.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Đã xuất CSV tổng hợp.');
    } catch {
      toast.error('Lỗi kết nối khi xuất CSV');
    } finally {
      setExporting(false);
    }
  }, [filters]);

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="h-9 inline-flex items-center gap-1.5 px-3 text-xs font-medium text-foreground border border-border rounded-lg hover:bg-muted disabled:opacity-50 transition-all"
      title="Xuất CSV tổng hợp theo bộ lọc & khoảng thời gian hiện tại"
    >
      {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sheet className="w-3.5 h-3.5" />}
      <Download className="w-3.5 h-3.5" />
      CSV
    </button>
  );
}
