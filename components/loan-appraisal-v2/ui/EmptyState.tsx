import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function EmptyState({ icon: Icon, title, children }: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
      {Icon && <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {children && <div className="max-w-md text-xs leading-5 text-muted-foreground">{children}</div>}
    </div>
  );
}
