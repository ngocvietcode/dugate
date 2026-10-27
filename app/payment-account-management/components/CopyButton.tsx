'use client';

// app/payment-account-management/components/CopyButton.tsx
// Copy arbitrary text to the clipboard with a clear copied/failed state.
// Falls back to a legacy execCommand path when the async Clipboard API is
// unavailable (e.g. non-HTTPS origins).

import React, { useState, useCallback, useRef, useEffect } from 'react';

type CopyState = 'idle' | 'copied' | 'error';

interface CopyButtonProps {
  /** Producer for the text to copy. Called on click so we always copy the latest value. */
  getText: () => string;
  /** Label shown in the idle state. */
  label?: string;
  className?: string;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  // Legacy fallback for insecure origins / older browsers.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ getText, label = 'Copy JSON', className = '' }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleClick = useCallback(async () => {
    const ok = await copyToClipboard(getText());
    setState(ok ? 'copied' : 'error');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState('idle'), 1800);
  }, [getText]);

  const content =
    state === 'copied' ? <>✓ Đã copy</>
      : state === 'error' ? <>✕ Lỗi copy</>
      : <>⧉ {label}</>;

  const tone =
    state === 'copied' ? 'text-emerald-600 border-emerald-500/40 bg-emerald-500/10'
      : state === 'error' ? 'text-red-600 border-red-500/40 bg-red-500/10'
      : 'text-primary border-border hover:border-primary/40';

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-live="polite"
      className={`modern-button btn-outline text-sm gap-2 transition-colors ${tone} ${className}`}
    >
      {content}
    </button>
  );
}
