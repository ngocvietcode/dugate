'use client';
// components/HeaderNav.tsx — ẩn trên trang /login, hiển thị user dropdown

import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { Home, Clock, SlidersHorizontal, PlugZap, User, LogOut, Users, ChevronDown, LogIn, BrainCircuit, Activity, Settings } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

export default function HeaderNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (pathname === '/login' || pathname === '/setup') return null;

  const isAdmin = session?.user?.role === 'ADMIN';
  const isViewer = session?.user?.role === 'VIEWER';

  return (
    <header className="glass-header sticky top-0 z-50">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="bg-primary text-primary-foreground p-1.5 rounded-xl shadow-md transition-colors">
            <BrainCircuit className="w-5 h-5 shadow-inner" />
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground group-hover:text-primary transition-colors whitespace-nowrap">
            AI Skill Hub
          </span>
          <span className="text-[10px] uppercase font-mono tracking-wider font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded ml-1 border border-border">
            v{process.env.NEXT_PUBLIC_APP_VERSION || '1.1.0'}
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

          {!isViewer && (
            <Link
              href="/dashboard"
              className={`pill-nav-item ${
                pathname.startsWith('/dashboard') ? 'pill-nav-active' : 'pill-nav-inactive'
              }`}
            >
              <Activity className="w-4 h-4" />
              Dashboard
            </Link>
          )}

          <Link
            href="/history"
            className={`pill-nav-item ${
              pathname.startsWith('/history') ? 'pill-nav-active' : 'pill-nav-inactive'
            }`}
          >
            <Clock className="w-4 h-4" />
            Lịch sử
          </Link>
          {!isViewer && (
            <>
              <Link
                href="/profiles"
                className={`pill-nav-item ${
                  pathname.startsWith('/profiles') ? 'pill-nav-active' : 'pill-nav-inactive'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Profiles
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
            </>
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
                      {session.user.role === 'ADMIN' ? '🔑 Quản trị viên' : session.user.role === 'VIEWER' ? '👁 Chỉ xem' : '👤 Người dùng'}
                    </p>
                  </div>

                  {/* Menu Items */}
                  <div className="p-1.5">
                    {isAdmin && (
                      <Link
                        href="/settings"
                        onClick={() => setShowDropdown(false)}
                        className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground rounded-xl hover:bg-muted transition-colors"
                      >
                        <Settings className="w-4 h-4 text-muted-foreground" />
                        Cài đặt
                      </Link>
                    )}
                    {isAdmin && (
                      <Link
                        href="/settings/users"
                        onClick={() => setShowDropdown(false)}
                        className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground rounded-xl hover:bg-muted transition-colors"
                      >
                        <Users className="w-4 h-4 text-muted-foreground" />
                        Quản lý người dùng
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
