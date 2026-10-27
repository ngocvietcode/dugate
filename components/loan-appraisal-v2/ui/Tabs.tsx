'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FOCUS_RING } from './toneClasses';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: LucideIcon;
  badge?: ReactNode;
}

/** Tablist theo WAI-ARIA: roving tabindex, mũi tên trái/phải, Home, End. Panel do nơi gọi render bằng `panelProps`. */
export function Tabs<T extends string>({ items, active, onChange, label, idPrefix, variant = 'underline' }: {
  items: ReadonlyArray<TabItem<T>>;
  active: T;
  onChange: (id: T) => void;
  label: string;
  idPrefix?: string;
  variant?: 'underline' | 'pill';
}) {
  const generated = useId();
  const prefix = idPrefix ?? generated;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    const target = items[next];
    onChange(target.id);
    refs.current[target.id]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 overflow-x-auto ${variant === 'underline' ? 'border-b border-border' : ''}`}>
      {items.map(({ id, label: text, icon: Icon, badge }, index) => {
        const selected = id === active;
        const style = variant === 'underline'
          ? `border-b-2 px-3 py-3 ${selected ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`
          : `rounded-lg border px-3 py-2 ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`;
        return (
          <button
            key={id}
            ref={(node) => { refs.current[id] = node; }}
            id={`${prefix}-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${prefix}-panel-${id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`flex shrink-0 items-center gap-2 text-sm font-semibold transition-colors ${style} ${FOCUS_RING}`}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            {text}
            {badge}
          </button>
        );
      })}
    </div>
  );
}

export function panelProps(prefix: string, id: string) {
  return {
    id: `${prefix}-panel-${id}`,
    role: 'tabpanel' as const,
    'aria-labelledby': `${prefix}-tab-${id}`,
    tabIndex: 0,
    className: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg`,
  };
}
