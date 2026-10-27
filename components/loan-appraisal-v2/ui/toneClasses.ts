import type { Tone } from '@/app/loan-appraisal-v2/lib/tone';

// Nguồn duy nhất của class màu theo tone (biến --la2-* định nghĩa trong v2.css).
export const TONE_BOX: Record<Tone, string> = {
  success: 'border-[rgb(var(--la2-success)/0.35)] bg-[rgb(var(--la2-success)/0.10)] text-[rgb(var(--la2-success))]',
  warning: 'border-[rgb(var(--la2-warning)/0.35)] bg-[rgb(var(--la2-warning)/0.10)] text-[rgb(var(--la2-warning))]',
  danger: 'border-[rgb(var(--la2-danger)/0.35)] bg-[rgb(var(--la2-danger)/0.10)] text-[rgb(var(--la2-danger))]',
  info: 'border-[rgb(var(--la2-info)/0.35)] bg-[rgb(var(--la2-info)/0.10)] text-[rgb(var(--la2-info))]',
  neutral: 'border-border bg-muted text-muted-foreground',
};

export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-[rgb(var(--la2-success))]',
  warning: 'text-[rgb(var(--la2-warning))]',
  danger: 'text-[rgb(var(--la2-danger))]',
  info: 'text-[rgb(var(--la2-info))]',
  neutral: 'text-muted-foreground',
};

export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background';
