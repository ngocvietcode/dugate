'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  ariaLabel?: string;
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  ariaLabel = 'Phân trang',
}: PaginationProps) {
  if (totalPages <= 1) return null;

  // Generate page numbers: first, last, current ± 1
  const pages: (number | 'ellipsis')[] = [];
  const addPage = (p: number) => {
    if (p >= 1 && p <= totalPages && !pages.includes(p)) pages.push(p);
  };

  addPage(1);
  if (page - 2 > 2) pages.push('ellipsis');
  addPage(page - 1);
  addPage(page);
  addPage(page + 1);
  if (page + 2 < totalPages) pages.push('ellipsis');
  if (totalPages > 1) addPage(totalPages);

  // Deduplicate ellipsis
  const deduped: (number | 'ellipsis')[] = [];
  for (const item of pages) {
    if (item === 'ellipsis' && deduped[deduped.length - 1] === 'ellipsis') continue;
    deduped.push(item);
  }

  return (
    <nav className="flex items-center gap-1" aria-label={ariaLabel}>
      {/* First */}
      <NavButton
        onClick={() => onPageChange(1)}
        disabled={page === 1}
        label="Trang đầu"
      >
        <ChevronsLeft className="w-3.5 h-3.5" />
      </NavButton>

      {/* Previous */}
      <NavButton
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
        label="Trang trước"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </NavButton>

      {/* Page numbers */}
      {deduped.map((item, idx) =>
        item === 'ellipsis' ? (
          <span key={`e-${idx}`} className="px-1 text-muted-foreground text-xs select-none">…</span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            className={`
              h-8 min-w-[32px] px-2 rounded-lg text-xs font-medium transition-all
              inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
              ${item === page
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }
            `}
            aria-label={`Trang ${item}`}
            aria-current={item === page ? 'page' : undefined}
          >
            {item}
          </button>
        ),
      )}

      {/* Next */}
      <NavButton
        onClick={() => onPageChange(page + 1)}
        disabled={page === totalPages}
        label="Trang sau"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </NavButton>

      {/* Last */}
      <NavButton
        onClick={() => onPageChange(totalPages)}
        disabled={page === totalPages}
        label="Trang cuối"
      >
        <ChevronsRight className="w-3.5 h-3.5" />
      </NavButton>
    </nav>
  );
}

function NavButton({
  children, onClick, disabled, label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        h-8 w-8 rounded-lg inline-flex items-center justify-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
        ${disabled
          ? 'text-muted-foreground/30 cursor-not-allowed'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }
      `}
      aria-label={label}
    >
      {children}
    </button>
  );
}
