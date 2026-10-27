'use client';
// app/apps/page.tsx — App Launcher / Tools Directory
// Lists every registered page the current user may access, grouped, with purpose
// descriptions and lifecycle badges. Solves page discoverability ("where is X?").

import Link from 'next/link';
import { LayoutGrid } from 'lucide-react';
import {
  getPagesForCapabilities,
  groupPages,
  STATUS_META,
} from '@/lib/navigation/registry';
import { usePermissions } from '@/lib/rbac/use-permissions';

export default function AppsLauncherPage() {
  const { permissions, loading } = usePermissions();

  // Include nav-hidden pages here so the launcher remains the complete directory.
  const groups = groupPages(getPagesForCapabilities(permissions, { includeHidden: true }));

  return (
    <main className="py-12 max-w-6xl mx-auto px-4 sm:px-6">
      <div className="mb-8 flex items-center gap-3">
        <div className="bg-primary/10 text-primary p-2.5 rounded-xl">
          <LayoutGrid className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Tất cả công cụ</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Danh mục đầy đủ các trang trong hệ thống, theo nhóm chức năng và quyền truy cập của bạn.
          </p>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">Đang tải…</p>
      )}

      {!loading && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">Không có công cụ nào khả dụng cho tài khoản của bạn.</p>
      )}

      <div className="space-y-10">
        {groups.map(({ meta, pages }) => (
          <section key={meta.key}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {meta.label}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pages.map((page) => {
                const Icon = page.icon;
                const isDeprecated = page.status === 'deprecated';
                const badge = STATUS_META[page.status];
                return (
                  <Link
                    key={page.path}
                    href={page.path}
                    className={`group relative flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-md ${
                      isDeprecated ? 'opacity-70' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="bg-muted text-foreground p-2 rounded-xl group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                        <Icon className="w-5 h-5" />
                      </div>
                      <span className="font-semibold text-foreground flex-1 truncate">{page.title}</span>
                      {page.status !== 'stable' && (
                        <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${badge.className}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{page.description}</p>
                    <code className="text-[10px] text-muted-foreground/60 font-mono mt-auto pt-1">{page.path}</code>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
