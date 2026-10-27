import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Tone } from '@/app/loan-appraisal-v2/lib/tone';
import { TONE_BOX } from './toneClasses';

/** Badge luôn kèm nhãn chữ (và icon tuỳ chọn): màu không phải tín hiệu duy nhất. */
export function Badge({ tone = 'neutral', children, icon: Icon, className = '' }: {
  tone?: Tone;
  children: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_BOX[tone]} ${className}`}>
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  );
}
