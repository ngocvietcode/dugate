'use client';

import { useState, useCallback } from 'react';
import { FileInput, Settings2, Terminal, Copy, Check } from 'lucide-react';
import type { OperationDetail } from '../../types';

interface RequestInfoSectionProps {
  operation: OperationDetail;
}

/**
 * What the request carried — endpoint, profile, parameter NAMES, files — without
 * the values. Parameter values stay in the database for N days so DEV can be
 * given an incident extract by Ops, but are never sent to the browser.
 */
export default function RequestInfoSection({ operation }: RequestInfoSectionProps) {
  const [showCurl, setShowCurl] = useState(false);
  const [copied, setCopied] = useState(false);

  const parameterNames = [...new Set((operation.pipelineJson ?? []).flatMap((step) => step.parameterNames ?? []))];
  const hasParameters = parameterNames.length > 0;
  const hasFiles = operation.filesJson && operation.filesJson.length > 0;
  const originalFileUrls = operation.originalFileUrls ?? [];
  const hasOriginalUrls = originalFileUrls.length > 0;

  // Reconstruct a pseudo-cURL skeleton (names only, values as placeholders)
  const curlCommand = reconstructCurl(operation, parameterNames);

  const handleCopyCurl = useCallback(async () => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(curlCommand);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch { /* fallthrough */ }
    }
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = curlCommand;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [curlCommand]);

  if (!hasParameters && !hasFiles && !hasOriginalUrls && !operation.endpointSlug) return null;

  return (
    <div className="modern-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Thông tin Request</h3>
        <button
          type="button"
          onClick={() => setShowCurl(!showCurl)}
          aria-expanded={showCurl}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
        >
          <Terminal className="w-3.5 h-3.5" aria-hidden="true" />
          {showCurl ? 'Ẩn cURL' : 'Xem cURL'}
        </button>
      </div>

      {/* Reconstructed cURL skeleton */}
      {showCurl && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Cấu trúc request (giá trị đã ẩn)</span>
            <button type="button" onClick={handleCopyCurl}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border hover:bg-muted transition-colors">
              {copied ? <><Check className="w-3 h-3 text-green-500" aria-hidden="true" /><span className="text-green-600">Copied</span></> : <><Copy className="w-3 h-3 text-muted-foreground" aria-hidden="true" /><span className="text-muted-foreground">Copy</span></>}
            </button>
          </div>
          <pre className="text-xs bg-zinc-900 dark:bg-zinc-950 text-green-400 p-4 rounded-lg overflow-auto max-h-[300px] whitespace-pre-wrap break-all font-mono">
            {curlCommand}
          </pre>
        </div>
      )}

      {/* Request summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
        <InfoItem label="Endpoint" value={operation.endpointSlug || '—'} mono />
        <InfoItem label="Profile" value={operation.profileName || '—'} />
        <InfoItem label="Webhook" value={operation.webhookUrl ? 'Có' : 'Không'} />
        {operation.idempotencyKey && <InfoItem label="Idempotency Key" value={operation.idempotencyKey} mono />}
      </div>

      {/* Files */}
      {hasFiles && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileInput className="w-3.5 h-3.5" aria-hidden="true" />
            Files đầu vào ({operation.filesJson.length})
          </div>
          <ul className="space-y-1">
            {operation.filesJson.map((file, idx) => (
              <li key={idx} className="flex items-center gap-3 text-xs bg-muted/50 rounded-lg px-3 py-2">
                {file.isRemoteUrl ? (
                  <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded shrink-0">URL</span>
                ) : (
                  <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">File</span>
                )}
                <span className="text-foreground font-medium truncate flex-1">{file.name}</span>
                {file.isRemoteUrl && file.url && (
                  <span className="text-muted-foreground font-mono text-[10px] truncate max-w-[240px]" title={file.url}>{file.url}</span>
                )}
                {!file.isRemoteUrl && file.mime && (
                  <span className="text-muted-foreground shrink-0">{file.mime}</span>
                )}
                {!file.isRemoteUrl && file.size !== null && file.size > 0 && (
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {file.size > 1024 * 1024
                      ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                      : `${(file.size / 1024).toFixed(0)} KB`}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {/* Only show "deleted" warning for uploaded files, not remote URLs */}
          {operation.filesDeleted && operation.filesJson.some((f) => !f.isRemoteUrl) && (
            <p className="text-xs text-amber-600 dark:text-amber-400">⚠ File đã upload bị xóa khỏi storage (cleanup tự động sau 24h)</p>
          )}
        </div>
      )}

      {/* Original file_urls (for workflow submissions via URL) */}
      {hasOriginalUrls && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileInput className="w-3.5 h-3.5" aria-hidden="true" />
            File URLs đầu vào ({originalFileUrls.length})
            <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">
              URL gốc từ request (đã bỏ query string)
            </span>
          </div>
          <ul className="space-y-1">
            {originalFileUrls.map((f, idx) => (
              <li key={idx} className="flex items-start gap-3 text-xs bg-blue-50/50 dark:bg-blue-900/10 rounded-lg px-3 py-2">
                <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded shrink-0 mt-0.5">URL</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground">{f.filename || 'file'}</p>
                  {f.mime_type && <p className="text-muted-foreground">{f.mime_type}</p>}
                  {f.url && <p className="font-mono text-[10px] text-muted-foreground break-all mt-0.5">{f.url}</p>}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Files được download từ URL trên để xử lý, không lưu trữ lâu dài.</p>
        </div>
      )}

      {/* Parameter names (values are never shown) */}
      {hasParameters && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
            Parameters ({parameterNames.length})
            <span className="text-[10px] font-normal">— chỉ hiển thị tên, giá trị được ẩn</span>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {parameterNames.map((name) => (
              <li key={name} className="font-mono text-[11px] bg-muted/60 text-foreground px-2 py-0.5 rounded">{name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-muted/30 rounded-lg px-3 py-2">
      <p className="text-muted-foreground text-[10px] uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-foreground truncate ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</p>
    </div>
  );
}

/** Reconstruct a pseudo-cURL skeleton: field names only, values as placeholders. */
function reconstructCurl(op: OperationDetail, parameterNames: string[]): string {
  const isWorkflow = op.endpointSlug?.startsWith('workflows:');
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://skillhub.aws.rpa.vpbank.dev';
  const endpoint = isWorkflow
    ? `${baseUrl}/api/v1/docs/workflows`
    : `${baseUrl}/api/v1/docs/${op.endpointSlug?.split(':')[0] || 'extract'}`;

  const lines: string[] = [];
  lines.push(`curl -X POST "${endpoint}" \\`);
  lines.push(`  -H "x-api-key: <YOUR_API_KEY>" \\`);

  if (op.webhookUrl) {
    lines.push(`  -F "webhook_url=<webhook_url>" \\`);
  }

  if (isWorkflow) {
    const processName = op.endpointSlug?.replace('workflows:', '') || '';
    lines.push(`  -F "process=${processName}" \\`);
  }

  for (const name of parameterNames) {
    lines.push(`  -F "${name}=<${name}>" \\`);
  }

  if ((op.originalFileUrls ?? []).length > 0) {
    lines.push(`  -F 'file_urls=<file_urls JSON>' \\`);
  } else if (op.filesJson && op.filesJson.length > 0) {
    for (const file of op.filesJson) {
      lines.push(`  -F "files=@${file.name}" \\`);
    }
  }

  // Remove trailing backslash from last line
  const lastIdx = lines.length - 1;
  if (lines[lastIdx].endsWith(' \\')) {
    lines[lastIdx] = lines[lastIdx].slice(0, -2);
  }

  return lines.join('\n');
}
