'use client';

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useFocusTrap } from '@/app/loan-appraisal-v2/hooks/useFocusTrap';
import { FOCUS_RING } from './toneClasses';

/** Dialog modal: focus trap, Esc đóng, trả focus về nút mở, khoá cuộn nền. */
export function Dialog({ open, onClose, title, description, children, footer, wide = false, initialFocusRef }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Mặc định focus vào nút đóng. */
  initialFocusRef?: RefObject<HTMLElement>;
}) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(panelRef, open, initialFocusRef ?? closeRef);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="la2-root fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-md'}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold">{title}</h2>
            {description && <p id={descId} className="mt-1 text-xs text-muted-foreground">{description}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className={`rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children && <div className="min-h-0 flex-1 overflow-auto">{children}</div>}
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
