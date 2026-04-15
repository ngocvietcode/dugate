'use client';

import * as React from 'react';
import { Moon, Sun, Laptop, Building2, MoonStar } from 'lucide-react';
import { useTheme } from 'next-themes';

const THEME_OPTIONS = [
  { value: 'light', label: 'Sáng (Light)', icon: Sun },
  { value: 'dark', label: 'Tối (Dark)', icon: Moon },
  { value: 'system', label: 'Bám Hệ thống', icon: Laptop },
  { value: 'vpb', label: 'VPB Sáng', icon: Building2 },
  { value: 'vpb-dark', label: 'VPB Tối', icon: MoonStar },
] as const;



export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center justify-between w-full p-2 h-10 bg-muted/50 rounded-xl animate-pulse" />
    );
  }

  return (
    <div className="flex flex-col gap-1.5 px-1 pb-1">
      <span className="text-xs font-semibold text-muted-foreground px-2 pt-1 uppercase tracking-wider">Themes</span>
      <div className="flex items-center justify-between bg-muted/30 p-1 rounded-xl border border-border/50">
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={(e) => { e.stopPropagation(); setTheme(opt.value); }}
            title={opt.label}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
              theme === opt.value
                ? 'bg-background shadow-sm text-primary scale-105'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <opt.icon className="w-4 h-4" />
          </button>
        ))}
      </div>
    </div>
  );
}

