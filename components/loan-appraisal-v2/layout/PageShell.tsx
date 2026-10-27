import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, Landmark, Settings2 } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { COPY } from '@/app/loan-appraisal-v2/copy';
import { FOCUS_RING } from '../ui/toneClasses';

const LINK = `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground ${FOCUS_RING}`;

export function AppHeader({ current }: { current: 'main' | 'config' }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex min-h-14 max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href={current === 'config' ? '/loan-appraisal-v2' : '/apps'} aria-label={current === 'config' ? 'Quay lại màn hình thẩm định' : 'Quay lại danh sách ứng dụng'} className={`rounded-lg p-2 text-muted-foreground hover:bg-muted ${FOCUS_RING}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Landmark className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-bold leading-tight">{current === 'config' ? 'Cấu hình bộ kiểm tra thẩm định vay' : COPY.appName}</p>
            <p className="text-xs leading-tight text-muted-foreground">{COPY.appSub} · {COPY.version}</p>
          </div>
        </div>
        <nav aria-label="Điều hướng phụ" className="flex flex-wrap items-center gap-1">
          {current === 'main' && (
            <Link href="/loan-appraisal-v2/config" className={LINK}><Settings2 className="h-3.5 w-3.5" aria-hidden />Cấu hình</Link>
          )}
          <Link href="/apps" className={LINK}>Ứng dụng</Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

export function PageShell({ current = 'main', children }: { current?: 'main' | 'config'; children: ReactNode }) {
  return (
    <>
      <a
        href="#la2-main"
        className={`sr-only z-50 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3 ${FOCUS_RING}`}
      >
        {COPY.skipToContent}
      </a>
      <AppHeader current={current} />
      <main id="la2-main" tabIndex={-1} className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 focus:outline-none">
        {children}
      </main>
    </>
  );
}
