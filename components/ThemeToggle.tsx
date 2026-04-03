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

function getCurrentIcon(theme: string | undefined) {
  switch (theme) {
    case 'light': return Sun;
    case 'dark': return Moon;
    case 'vpb': return Building2;
    case 'vpb-dark': return MoonStar;
    default: return Laptop;
  }
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-9 h-9 rounded-full bg-muted animate-pulse" />
    );
  }

  const Icon = getCurrentIcon(theme);

  return (
    <div className="relative group/theme flex items-center justify-center">
      {/* Current theme Icon button */}
      <button className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors">
        <Icon className="w-4 h-4" />
      </button>

      {/* Dropdown Menu */}
      <div className="absolute right-0 top-full mt-2 w-40 bg-popover border border-border text-popover-foreground shadow-xl rounded-xl p-1.5 opacity-0 invisible group-hover/theme:opacity-100 group-hover/theme:visible transition-all duration-200 z-50">
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg font-medium transition-colors ${
              theme === opt.value
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <opt.icon className="w-4 h-4" /> {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

