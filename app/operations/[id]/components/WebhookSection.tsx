'use client';

import { AlertCircle, CheckCircle, Clock, Globe, Info } from 'lucide-react';
import { getWebhookDisplayState, scrubWebhookError } from '@/lib/ops/webhook-display';

interface WebhookSectionProps {
  webhookUrl: string | null;
  webhookSentAt: string | null;
  webhookAttempts: number | null;
  webhookLastError: string | null;
}

function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'URL callback đã cấu hình';
  }
}

export default function WebhookSection({ webhookUrl, webhookSentAt, webhookAttempts, webhookLastError }: WebhookSectionProps) {
  const state = getWebhookDisplayState({ webhookUrl, webhookSentAt, webhookAttempts });
  const safeError = scrubWebhookError(webhookLastError);

  return <div className="modern-card p-6 space-y-3">
    <h3 className="text-sm font-semibold text-foreground">Webhook / Callback</h3>
    {state === 'unconfigured' ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Info className="w-4 h-4 shrink-0" />Chưa có callback — Profile hoặc endpoint chưa cấu hình URL đích.</div> : <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-muted-foreground shrink-0" /><span className="font-mono text-xs text-foreground break-all">{displayUrl(webhookUrl!)}</span></div>
      {state === 'sent' && <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-500 shrink-0" /><span className="text-xs text-muted-foreground">Đã gửi{webhookAttempts !== null ? ` sau ${webhookAttempts} lần` : ''}: {new Date(webhookSentAt!).toLocaleString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div>}
      {state === 'failed' && <div className="flex items-start gap-2"><AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" /><span className="text-xs text-muted-foreground">Thất bại sau {webhookAttempts} lần{safeError ? `: ${safeError}` : '.'}</span></div>}
      {state === 'legacy' && <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-yellow-500 shrink-0" /><span className="text-xs text-muted-foreground">Chưa gửi / không có chi tiết (Operation cũ hoặc luồng callback cũ).</span></div>}
    </div>}
  </div>;
}
