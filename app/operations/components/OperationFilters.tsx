'use client';

import { ChevronDown, Filter, RotateCcw, Search, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type {
  BusinessOperationsDashboardFilter,
  BusinessOperationsFilterState,
  BusinessStatusFilter,
  OperationFiltersState,
  OperationState,
} from '../types';
import { STATE_BADGE_CONFIG } from '../types';
import {
  BUSINESS_OPERATION_SEARCH_MODE_OPTIONS,
  INTERNAL_PROFILE_FILTER,
  isBusinessOperationsDraftDirty,
  prepareBusinessOperationsFilterSubmission,
  type BusinessOperationProfileFilterOption,
  type BusinessOperationsFilterValidationError,
} from '../lib/business-filters';
import ProfileCombobox from './ProfileCombobox';
import { BusinessOperationsTimeRangeControl } from './TimeRangeControl';

const BUSINESS_STATUS_OPTIONS: ReadonlyArray<{ value: BusinessStatusFilter; label: string }> = [
  { value: 'ALL', label: 'Tất cả trạng thái nghiệp vụ' },
  { value: 'IN_PROGRESS', label: 'Đang xử lý' },
  { value: 'SUCCEEDED', label: 'Thành công' },
  { value: 'FAILED', label: 'Thất bại' },
  { value: 'N/A', label: 'N/A' },
];

const BUSINESS_FILTER_ERROR_MESSAGES: Record<BusinessOperationsFilterValidationError, string> = {
  INVALID_RANGE: 'Khoảng thời gian không hợp lệ.',
  FORBIDDEN_PROFILE: 'Profile không còn thuộc phạm vi được cấp quyền.',
  INVALID_OPERATION_TYPE: 'Loại operation không hợp lệ.',
  INVALID_STATUS: 'Trạng thái nghiệp vụ không hợp lệ.',
  INVALID_SEARCH_MODE: 'Kiểu tìm kiếm không hợp lệ.',
  EMPTY_SEARCH: 'Nhập Reference ID hoặc Request ID để tìm kiếm.',
  SEARCH_TOO_LONG: 'Giá trị tìm kiếm chỉ được dài tối đa 256 ký tự.',
};

export interface BusinessOperationFiltersProps {
  draftFilter: BusinessOperationsFilterState;
  appliedFilter: BusinessOperationsDashboardFilter;
  calendarTimezone: string;
  profiles: readonly BusinessOperationProfileFilterOption[];
  operationTypes: readonly string[];
  onDraftChange: (draft: BusinessOperationsFilterState) => void;
  /** Starts validation/fetch only. Applied URL/filter/data must commit on server success. */
  onRequestApply: (draft: BusinessOperationsFilterState) => void;
  disabled?: boolean;
  serverError?: string | null;
}

/** Draft-only controls for the server-authoritative Business Operations dashboard. */
export function BusinessOperationFilters({
  draftFilter,
  appliedFilter,
  calendarTimezone,
  profiles,
  operationTypes,
  onDraftChange,
  onRequestApply,
  disabled = false,
  serverError = null,
}: BusinessOperationFiltersProps) {
  const [validationError, setValidationError] = useState<BusinessOperationsFilterValidationError | null>(null);
  const dirty = isBusinessOperationsDraftDirty(draftFilter, appliedFilter);
  const searchLength = Array.from(draftFilter.query.trim()).length;
  const profileOptions = profiles.map((profile) => ({
    id: profile.id ?? INTERNAL_PROFILE_FILTER,
    name: profile.name,
  }));

  const updateDraft = (patch: Partial<BusinessOperationsFilterState>) => {
    setValidationError(null);
    onDraftChange({ ...draftFilter, ...patch, page: 1 });
  };

  const submit = (intent: 'filters' | 'search') => {
    const result = prepareBusinessOperationsFilterSubmission(
      draftFilter,
      appliedFilter,
      { profiles, operationTypes },
      intent,
    );
    if (!result.accepted) {
      setValidationError(result.error);
      return;
    }
    setValidationError(null);
    onDraftChange(result.draft);
    onRequestApply(result.draft);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit('search');
  };

  const clearSearch = () => {
    const cleared = { ...draftFilter, query: '', page: 1 };
    const result = prepareBusinessOperationsFilterSubmission(
      cleared,
      appliedFilter,
      { profiles, operationTypes },
      'filters',
    );
    onDraftChange(cleared);
    if (result.accepted) onRequestApply(result.draft);
  };

  return (
    <section className="space-y-4" aria-label="Bộ lọc Business Operations">
      <BusinessOperationsTimeRangeControl
        draftRange={draftFilter.range}
        appliedRange={appliedFilter.range}
        calendarTimezone={calendarTimezone}
        onDraftRangeChange={(range) => updateDraft({ range })}
        disabled={disabled}
      />

      <div className="flex flex-wrap items-end gap-2.5">
        <div className="space-y-1">
          <label className="block text-[11px] text-muted-foreground">Profile scope</label>
          <ProfileCombobox
            value={draftFilter.profile}
            profiles={profileOptions}
            showNoProfile={false}
            disabled={disabled}
            onChange={(profile) => updateDraft({ profile })}
          />
        </div>

        <label className="space-y-1">
          <span className="block text-[11px] text-muted-foreground">Loại operation</span>
          <SelectShell>
            <select
              className={`${selectClass} max-w-72`}
              value={draftFilter.operationType}
              disabled={disabled}
              onChange={(event) => updateDraft({ operationType: event.target.value })}
              aria-label="Loại operation nghiệp vụ"
            >
              <option value="ALL">Tất cả loại operation</option>
              {operationTypes.map((operationType) => (
                <option key={operationType} value={operationType}>{operationType}</option>
              ))}
            </select>
          </SelectShell>
        </label>

        <label className="space-y-1">
          <span className="block text-[11px] text-muted-foreground">Trạng thái nghiệp vụ</span>
          <SelectShell>
            <select
              className={selectClass}
              value={draftFilter.status}
              disabled={disabled}
              onChange={(event) => updateDraft({ status: event.target.value as BusinessStatusFilter })}
              aria-label="Trạng thái nghiệp vụ"
            >
              {BUSINESS_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </SelectShell>
        </label>

        <button
          type="button"
          disabled={disabled || !dirty}
          onClick={() => submit('filters')}
          className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Áp dụng bộ lọc
        </button>
      </div>

      <form className="space-y-1" onSubmit={submitSearch} noValidate>
        <label className="block text-[11px] text-muted-foreground" htmlFor="business-operation-search">
          Tìm Reference ID hoặc Request ID
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <SelectShell>
            <select
              className={selectClass}
              value={draftFilter.searchMode}
              disabled={disabled}
              onChange={(event) => updateDraft({
                searchMode: event.target.value as BusinessOperationsFilterState['searchMode'],
              })}
              aria-label="Kiểu tìm kiếm nghiệp vụ"
            >
              {BUSINESS_OPERATION_SEARCH_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </SelectShell>
          <div className="relative min-w-64 flex-1 max-w-xl">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="business-operation-search"
              type="search"
              value={draftFilter.query}
              disabled={disabled}
              onChange={(event) => updateDraft({ query: event.target.value })}
              aria-describedby="business-operation-search-help"
              aria-invalid={validationError === 'EMPTY_SEARCH' || validationError === 'SEARCH_TOO_LONG'}
              className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="1–256 ký tự"
            />
          </div>
          <button
            type="submit"
            disabled={disabled}
            className="h-9 rounded-lg border border-primary bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Tìm kiếm
          </button>
          {appliedFilter.search && (
            <button
              type="button"
              disabled={disabled}
              onClick={clearSearch}
              className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Xóa tìm kiếm
            </button>
          )}
        </div>
        <p id="business-operation-search-help" className="text-[11px] text-muted-foreground">
          {searchLength}/256 ký tự. Tìm chính xác hỗ trợ Reference ID và Request ID; tìm chứa chuỗi chỉ áp dụng cho Reference ID.
        </p>
      </form>

      {(validationError || serverError) && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {validationError ? BUSINESS_FILTER_ERROR_MESSAGES[validationError] : serverError}
        </p>
      )}
      {dirty && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          Thay đổi đang ở bản nháp; dữ liệu và URL hiện tại chỉ đổi sau khi máy chủ chấp nhận.
        </p>
      )}
    </section>
  );
}

const STATE_OPTIONS: { value: OperationState | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Tất cả trạng thái' },
  { value: 'RUNNING', label: 'Đang chạy' },
  { value: 'SUCCEEDED', label: 'Thành công' },
  { value: 'FAILED', label: 'Thất bại' },
  { value: 'WAITING_USER_INPUT', label: 'Chờ xác nhận' },
  { value: 'CANCELLED', label: 'Đã hủy' },
  { value: 'PENDING', label: 'Chờ xử lý' },
];

const selectClass =
  'h-9 rounded-lg border border-border bg-card pl-3 pr-8 text-sm text-foreground appearance-none cursor-pointer transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

interface OperationFiltersProps {
  filters: OperationFiltersState;
  onFilterChange: (filters: OperationFiltersState) => void;
  onClearFilters: () => void;
  total: number;
  isAutoRefreshing: boolean;
}

/** Requests-only controls. State never affects Overview or Cost. */
export default function OperationFilters({
  filters, onFilterChange, onClearFilters, total, isAutoRefreshing,
}: OperationFiltersProps) {
  return (
    <div className="space-y-3 mb-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
          <Filter className="w-3.5 h-3.5" />
          <span className="text-xs font-medium hidden sm:inline">Riêng Requests</span>
        </div>

        <SelectShell>
          <select
            className={selectClass}
            value={filters.state}
            onChange={(event) => onFilterChange({
              ...filters,
              state: event.target.value as OperationState | 'ALL',
            })}
            aria-label="Trạng thái request"
          >
            {STATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </SelectShell>

        {filters.state !== 'ALL' && (
          <button
            type="button"
            onClick={onClearFilters}
            className="h-9 inline-flex items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-all"
          >
            <X className="w-3.5 h-3.5" /> Xóa trạng thái
          </button>
        )}

        <div className="flex-1" />
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground shrink-0">
          {isAutoRefreshing && (
            <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
              <RotateCcw className="w-3 h-3 animate-spin" /> Live
            </span>
          )}
          <span className="tabular-nums">{total.toLocaleString('en-US')} kết quả</span>
        </div>
      </div>

      {filters.state !== 'ALL' && (
        <FilterTag
          label={`Trạng thái: ${STATE_BADGE_CONFIG[filters.state]?.label || filters.state}`}
          onRemove={onClearFilters}
        />
      )}
    </div>
  );
}

interface GlobalOperationFiltersProps {
  filters: OperationFiltersState;
  onFilterChange: (filters: OperationFiltersState) => void;
  onClearFilters: () => void;
  endpoints: string[];
  profiles: { id: string; name: string }[];
  hasNoProfile: boolean;
}

/** Shared endpoint/profile controls placed above tabs. */
export function GlobalOperationFilters({
  filters, onFilterChange, onClearFilters, endpoints, profiles, hasNoProfile,
}: GlobalOperationFiltersProps) {
  const hasActive = filters.endpoint !== 'ALL' || filters.profile !== 'ALL';

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
        <Filter className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">Bộ lọc chung</span>
      </div>

      <SelectShell>
        <select
          className={`${selectClass} max-w-60`}
          value={filters.endpoint}
          onChange={(event) => onFilterChange({ ...filters, endpoint: event.target.value })}
          aria-label="Endpoint dùng cho mọi tab"
        >
          <option value="ALL">Tất cả endpoint</option>
          {endpoints.map((endpoint) => <option key={endpoint} value={endpoint}>{endpoint}</option>)}
        </select>
      </SelectShell>

      <ProfileCombobox
        value={filters.profile}
        profiles={profiles}
        showNoProfile={hasNoProfile}
        onChange={(profile) => onFilterChange({ ...filters, profile })}
      />

      {hasActive && (
        <button
          type="button"
          onClick={onClearFilters}
          className="h-9 inline-flex items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-all"
        >
          <X className="w-3.5 h-3.5" /> Xóa bộ lọc chung
        </button>
      )}

      {filters.endpoint !== 'ALL' && (
        <FilterTag
          label={`Endpoint: ${filters.endpoint}`}
          onRemove={() => onFilterChange({ ...filters, endpoint: 'ALL' })}
        />
      )}
      {filters.profile !== 'ALL' && (
        <FilterTag
          label={`Profile: ${filters.profile === '__none__' ? 'Không có' : (profiles.find((profile) => profile.id === filters.profile)?.name || filters.profile)}`}
          onRemove={() => onFilterChange({ ...filters, profile: 'ALL' })}
        />
      )}
    </div>
  );
}

function SelectShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
    </div>
  );
}

function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-primary/8 text-primary border border-primary/20 rounded-lg">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="hover:bg-primary/10 rounded p-0.5 transition-colors"
        aria-label={`Xóa filter: ${label}`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
