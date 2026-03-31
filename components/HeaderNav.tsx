'use client';
// components/HeaderNav.tsx — ẩn trên trang /login

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Home, Clock, Settings, FileText, SlidersHorizontal, PlugZap } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

export default function HeaderNav() {
  const pathname = usePathname();
  if (pathname === '/login' || pathname === '/setup') return null;

  return (
    <header className="glass-header sticky top-0 z-50">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="bg-primary text-primary-foreground p-1.5 rounded-xl shadow-md transition-colors">
            <FileText className="w-5 h-5 shadow-inner" />
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
            dugate
          </span>
        </Link>

        {/* Nav items */}
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className={`pill-nav-item ${
              pathname === '/' ? 'pill-nav-active' : 'pill-nav-inactive'
            }`}
          >
            <Home className="w-4 h-4" />
            Trang chủ
          </Link>

          <Link
            href="/history"
            className={`pill-nav-item ${
              pathname.startsWith('/history') ? 'pill-nav-active' : 'pill-nav-inactive'
            }`}
          >
            <Clock className="w-4 h-4" />
            Lịch sử
          </Link>
          <Link
            href="/settings"
            className={`pill-nav-item ${
              pathname.startsWith('/settings') ? 'pill-nav-active' : 'pill-nav-inactive'
            }`}
          >
            <Settings className="w-4 h-4" />
            Cài đặt
          </Link>
          <Link
            href="/overrides"
            className={`pill-nav-item ${
              pathname.startsWith('/overrides') ? 'pill-nav-active' : 'pill-nav-inactive'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Overrides
          </Link>
          <Link
            href="/api-connections"
            className={`pill-nav-item ${
              pathname.startsWith('/api-connections') ? 'pill-nav-active' : 'pill-nav-inactive'
            }`}
          >
            <PlugZap className="w-4 h-4" />
            API Connections
          </Link>
          
          <div className="w-[1px] h-6 bg-border mx-2" />
          
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
