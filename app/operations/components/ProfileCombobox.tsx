'use client';

import { ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface ProfileOption {
  value: string;
  label: string;
}

export interface ProfileComboboxProps {
  /** Current draft selection: 'ALL' | a server-authorized scope id. */
  value: string;
  profiles: ReadonlyArray<{ id: string; name: string }>;
  /** Whether to offer the legacy request-level "no profile" bucket. */
  showNoProfile: boolean;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const ALL_VALUE = 'ALL';
const NONE_VALUE = '__none__';

/**
 * Searchable, keyboard-accessible profile filter (ARIA combobox pattern).
 * Replaces the plain <select> so operators can type-to-filter a long profile
 * list. Options are sorted A–Z (Vietnamese collation). Selecting updates the
 * caller (which drives the URL); the clear button resets to ALL.
 */
export default function ProfileCombobox({
  value, profiles, showNoProfile, onChange, disabled = false,
}: ProfileComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const options = useMemo<ProfileOption[]>(() => {
    const sorted = [...profiles].sort((left, right) =>
      left.name.localeCompare(right.name, 'vi', { sensitivity: 'base' }),
    );
    const base: ProfileOption[] = [];
    if (showNoProfile || value === NONE_VALUE) {
      base.push({ value: NONE_VALUE, label: 'Không có profile' });
    }
    return [...base, ...sorted.map((profile) => ({ value: profile.id, label: profile.name }))];
  }, [profiles, showNoProfile, value]);

  const filtered = useMemo<ProfileOption[]>(() => {
    const normalized = query.trim().toLocaleLowerCase('vi');
    if (!normalized) return options;
    return options.filter((option) => option.label.toLocaleLowerCase('vi').includes(normalized));
  }, [options, query]);

  const selectedLabel = useMemo(() => {
    if (value === ALL_VALUE) return '';
    if (value === NONE_VALUE) return 'Không có profile';
    return profiles.find((profile) => profile.id === value)?.name ?? value;
  }, [value, profiles]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Keep the highlighted option within range as the filtered list changes.
  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const openList = () => {
    if (!open) {
      setOpen(true);
      setActiveIndex(0);
    }
  };

  const commit = (option: ProfileOption | undefined) => {
    if (!option) return;
    onChange(option.value);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const clear = () => {
    onChange(ALL_VALUE);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        openList();
        setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        openList();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'Enter':
        if (open) {
          event.preventDefault();
          commit(filtered[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          setOpen(false);
          setQuery('');
        }
        break;
      default:
        break;
    }
  };

  const activeOptionId = open && filtered[activeIndex]
    ? `${listboxId}-opt-${activeIndex}`
    : undefined;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-label="Tìm và lọc theo profile"
          className="h-9 w-full max-w-60 rounded-lg border border-border bg-card pl-8 pr-14 text-sm text-foreground transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="Tất cả profile"
          value={open ? query : selectedLabel}
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.target.value);
            openList();
            setActiveIndex(0);
          }}
          onFocus={openList}
          onClick={openList}
          onKeyDown={onKeyDown}
        />
        {value !== ALL_VALUE && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-7 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Xóa lọc profile"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <ChevronDown
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none"
          aria-hidden="true"
        />
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Danh sách profile"
          className="absolute z-20 mt-1 max-h-64 w-full min-w-56 max-w-72 overflow-auto rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === ALL_VALUE}
              className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                value === ALL_VALUE ? 'text-primary font-medium' : 'text-muted-foreground'
              } hover:bg-muted`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={clear}
            >
              Tất cả profile
            </button>
          </li>

          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Không tìm thấy profile</li>
          ) : (
            filtered.map((option, index) => {
              const isActive = index === activeIndex;
              const isSelected = option.value === value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    id={`${listboxId}-opt-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                      isActive ? 'bg-muted' : ''
                    } ${isSelected ? 'text-primary font-medium' : 'text-foreground'} hover:bg-muted`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commit(option)}
                  >
                    {option.label}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
