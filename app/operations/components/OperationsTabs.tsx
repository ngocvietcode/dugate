'use client';

import { LayoutDashboard, List, DollarSign } from 'lucide-react';
import type { OperationsTab } from '../types';

interface OperationsTabsProps {
  active: OperationsTab;
  onChange: (tab: OperationsTab) => void;
}

const TABS: { key: OperationsTab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Tổng quan', icon: <LayoutDashboard className="w-4 h-4" /> },
  { key: 'requests', label: 'Requests', icon: <List className="w-4 h-4" /> },
  { key: 'cost', label: 'Chi phí & Profile', icon: <DollarSign className="w-4 h-4" /> },
];

export default function OperationsTabs({ active, onChange }: OperationsTabsProps) {
  // WAI-ARIA tabs: Left/Right (and Home/End) move between tabs.
  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(TABS[next].key);
    }
  };

  return (
    <div className="border-b border-border mb-6">
      <nav className="flex items-center gap-1 -mb-px" role="tablist" aria-label="Operations tabs">
        {TABS.map((tab, idx) => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              id={`ops-tab-${tab.key}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`ops-tabpanel-${tab.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.key)}
              onKeyDown={(e) => onKeyDown(e, idx)}
              className={`
                inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all
                focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-t-md
                ${isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }
              `}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
