'use client';

import OperationFilters from './OperationFilters';
import OperationsTable from './OperationsTable';
import Pagination from './Pagination';
import CsvExportButton from './CsvExportButton';
import { formatInt } from '../lib/format';
import type { OperationFiltersState, OperationListItemView } from '../types';

interface RequestsTabProps {
  filters: OperationFiltersState;
  onFilterChange: (filters: OperationFiltersState) => void;
  onClearFilters: () => void;
  onResetAll: () => void;
  operations: OperationListItemView[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  isAutoRefreshing: boolean;
  total: number;
  hasAnyFilter: boolean;
  page: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function RequestsTab(props: RequestsTabProps) {
  const {
    filters, onFilterChange, onClearFilters, onResetAll,
    operations, loading, error, onRetry, isAutoRefreshing, total, hasAnyFilter,
    page, totalPages, pageSize, pageSizeOptions, onPageChange, onPageSizeChange,
  } = props;

  return (
    <div>
      <OperationFilters
        filters={filters}
        onFilterChange={onFilterChange}
        onClearFilters={onClearFilters}
        total={total}
        isAutoRefreshing={isAutoRefreshing}
      />

      <div className="flex justify-end mb-3">
        <CsvExportButton filters={filters} />
      </div>

      <OperationsTable
        operations={operations}
        loading={loading}
        error={error}
        onRetry={onRetry}
        emptyWithFilter={hasAnyFilter}
        onClearFilters={onResetAll}
      />

      {!loading && !error && operations.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4">
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground tabular-nums">
              Trang {page}/{totalPages} — {operations.length}/{formatInt(total)}
            </p>
            <PageSizeSelector value={pageSize} options={pageSizeOptions} onChange={onPageSizeChange} />
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
        </div>
      )}
    </div>
  );
}

function PageSizeSelector({ value, options, onChange }: { value: number; options: number[]; onChange: (size: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Hiển thị</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-7 rounded-md border border-border bg-card px-2 pr-6 text-xs text-foreground appearance-none cursor-pointer transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
        aria-label="Số record mỗi trang"
      >
        {options.map((size) => <option key={size} value={size}>{size}</option>)}
      </select>
    </div>
  );
}
