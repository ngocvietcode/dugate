'use client';
// components/HeaderNav.tsx — ẩn trên trang /login, hiển thị user dropdown

import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { SlidersHorizontal, PlugZap, User, LogOut, Users, ChevronDown, LogIn, Settings, Layers, Activity, FileText, BrainCircuit, LayoutGrid } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useHomeMode } from '@/lib/useHomeMode';
import { getPagesForCapabilities, groupPages } from '@/lib/navigation/registry';
import { usePermissions } from '@/lib/rbac/use-permissions';
import { PageStatusBadge } from './PageStatusBadge';

export default function HeaderNav() {
  const pathname = usePathname();
  const homeMode = useHomeMode();
  const { data: session } = useSession();
  // Skip the request for anonymous visitors (e.g. /login) instead of provoking a 401.
  const { permissions, can } = usePermissions({ enabled: Boolean(session?.user) });
  const [showDropdown, setShowDropdown] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setShowTools(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setShowDropdown(false);
    setShowTools(false);
  }, [pathname]);

  if (pathname === '/login' || pathname === '/setup' || pathname.startsWith('/loan-appraisal') || pathname.startsWith('/account-opening')) return null;

  // homeMode is declared once at the top of the component. Neither the duplicate
  // (HEAD) nor develop's isAdmin/isViewer are needed: this nav is capability-driven
  // via can(...), so we only derive the developer branding flag here.
  const isDeveloper = homeMode === 'developer';

  // Tools dropdown — driven by the central page registry (single source of truth).
  // Exclude pages already shown as top-level pills, and the admin group (in user menu).
  const PILL_PATHS = new Set(['/profiles', '/operations', '/api-connections']);
  const toolGroups = groupPages(
    getPagesForCapabilities(permissions).filter((p) => p.group !== 'admin' && !PILL_PATHS.has(p.path)),
  );

  return (
    <header className="glass-header sticky top-0 z-50">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo — branding thay đổi theo mode */}
        <Link href="/" className="flex items-center gap-2 group">
          {isDeveloper ? (
            <div className="bg-emerald-600 text-white p-1.5 rounded-lg">
              <FileText className="w-4 h-4" />
            </div>
          ) : (
            <div className="bg-primary text-primary-foreground p-1.5 rounded-xl shadow-md transition-colors">
              <BrainCircuit className="w-5 h-5 shadow-inner" />
            </div>
          )}
          <span className={`font-bold tracking-tight text-foreground group-hover:text-primary transition-colors whitespace-nowrap ${isDeveloper ? 'text-base font-mono' : 'text-xl'}`}>
            {isDeveloper ? 'RPA.Doc' : 'AI Skill Hub'}
          </span>
          <span className={`text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-muted border border-border ${isDeveloper ? '' : 'uppercase tracking-wider font-semibold ml-1'}`}>
            {isDeveloper ? '' : 'v'}{process.env.NEXT_PUBLIC_APP_VERSION || '1.1.0'}
          </span>
        </Link>

        {/* Nav items — giữ nguyên cấu trúc nav từ commit hiện tại */}
        <div className="flex items-center gap-2">
          {can('profile:read') && (
            <Link
              href="/profiles"
              className={`pill-nav-item ${
                pathname.startsWith('/profiles') ? 'pill-nav-active' : 'pill-nav-inactive'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Profiles
            </Link>
          )}

          {can('operations:read') && (
            <Link
              href="/operations"
              className={`pill-nav-item ${
                pathname.startsWith('/operations') ? 'pill-nav-active' : 'pill-nav-inactive'
              }`}
            >
              <Activity className="w-4 h-4" />
              Operations
            </Link>
          )}

          {can('connector:manage') && (
            <>
              <Link
                href="/api-connections"
                className={`pill-nav-item ${
                  pathname.startsWith('/api-connections') ? 'pill-nav-active' : 'pill-nav-inactive'
                }`}
              >
                <PlugZap className="w-4 h-4" />
                Connectors
              </Link>
            </>
          )}

          {/* Tools dropdown — discover all registered pages (registry-driven) */}
          {session?.user && toolGroups.length > 0 && (
            <div className="relative" ref={toolsRef}>
              <button
                onClick={() => setShowTools((s) => !s)}
                className={`pill-nav-item ${showTools ? 'pill-nav-active' : 'pill-nav-inactive'}`}
              >
                <LayoutGrid className="w-4 h-4" />
                Công cụ
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showTools ? 'rotate-180' : ''}`} />
              </button>

              {showTools && (
                <div className="absolute left-0 mt-2 w-[320px] max-h-[70vh] overflow-y-auto rounded-2xl bg-card border border-border shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-2">
                    {toolGroups.map(({ meta, pages }) => (
                      <div key={meta.key} className="mb-1.5 last:mb-0">
                        <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {meta.label}
                        </p>
                        {pages.map((page) => {
                          const Icon = page.icon;
                          const active = pathname === page.path || pathname.startsWith(page.path + '/');
                          return (
                            <Link
                              key={page.path}
                              href={page.path}
                              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors ${
                                active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                              }`}
                            >
                              <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                              <span className="flex-1 truncate">{page.title}</span>
                              <PageStatusBadge status={page.status} />
                            </Link>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border p-1.5">
                    <Link
                      href="/apps"
                      className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-primary rounded-xl hover:bg-muted transition-colors"
                    >
                      <LayoutGrid className="w-4 h-4" />
                      Xem tất cả công cụ
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="w-[1px] h-6 bg-border mx-2" />
          
          {/* User Profile Dropdown or Login Button */}
          {session?.user ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-full hover:bg-muted transition-colors duration-200"
              >
                <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <span className="text-foreground max-w-[100px] truncate">{session.user.username || session.user.name}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${showDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showDropdown && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-card border border-border shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  {/* User Info */}
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {session.user.username || session.user.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {session.user.role === 'ADMIN' ? '🔑 Quản trị viên' : '🛠 Vận hành (OPS)'}
                    </p>
                  </div>

                  {/* Menu Items */}
                  <div className="p-1.5">
                    <Link
                      href="/apps"
                      onClick={() => setShowDropdown(false)}
                      className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground rounded-xl hover:bg-muted transition-colors"
                    >
                      <LayoutGrid className="w-4 h-4 text-muted-foreground" />
                      Tất cả công cụ
                    </Link>
                    {can('settings:manage') && (
                      <Link
                        href="/settings"
                        onClick={() => setShowDropdown(false)}
                        className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground rounded-xl hover:bg-muted transition-colors"
                      >
                        <Settings className="w-4 h-4 text-muted-foreground" />
                        Cài đặt
                      </Link>
                    )}
                    {can('user:manage') && (
                      <Link
                        href="/settings/users"
                        onClick={() => setShowDropdown(false)}
                        className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground rounded-xl hover:bg-muted transition-colors"
                      >
                        <Users className="w-4 h-4 text-muted-foreground" />
                        Quản lý người dùng
                      </Link>
                    )}
                    {can('workergroups:manage') && (
                      <Link
                        href="/settings/worker-groups"
                        onClick={() => setShowDropdown(false)}
                        className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground rounded-xl hover:bg-muted transition-colors"
                      >
                        <Layers className="w-4 h-4 text-muted-foreground" />
                        Worker Groups & Queues
                      </Link>
                    )}
                    
                    <div className="my-1 border-t border-border/50" />
                    <ThemeToggle />
                    <div className="my-1 border-t border-border/50" />
                    
                      <button
                        onClick={() => signOut({ callbackUrl: `${window.location.origin}/login` })}
                        className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-destructive rounded-xl hover:bg-destructive/10 transition-colors w-full text-left"
                      >
                      <LogOut className="w-4 h-4" />
                      Đăng xuất
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm ml-2"
            >
              <LogIn className="w-4 h-4" />
              Đăng nhập
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
