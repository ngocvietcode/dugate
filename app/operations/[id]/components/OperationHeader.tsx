'use client';

import { useState } from 'react';
import { Copy, Clock, Key, Check } from 'lucide-react';
import OperationStateBadge from '../../components/OperationStateBadge';
import type { OperationDetail } from '../../types';

interface OperationHeaderProps {
  operation: OperationDetail;
}

export default function OperationHeader({ operation }: OperationHeaderProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(operation.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback silently
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (startIso: string, endIso: string): string => {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min < 60) return `${min}m ${sec}s`;
    const hr = Math.floor(min / 60);
    const remainMin = min % 60;
    return `${hr}h ${remainMin}m ${sec}s`;
  };

  return (
    <div className="modern-card p-6 space-y-4">
      {/* Top row: badge + profile + endpoint */}
      <div className="flex flex-wrap items-center gap-3">
        <OperationStateBadge state={operation.state} />
        {operation.profileName && (
          <span className="text-sm font-medium text-foreground">
            {operation.profileName}
          </span>
        )}
        {operation.endpointSlug && (
          <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
            {operation.endpointSlug}
          </span>
        )}
      </div>

      {/* Operation ID with copy */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground break-all">
          {operation.id}
        </span>
        <button
          onClick={handleCopyId}
          className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
          title="Copy ID"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
      </div>

      {/* Timestamps + Duration */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          Tiếp nhận: {formatDate(operation.createdAt)}
        </span>
        {operation.done ? (
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            Hoàn tất: {formatDate(operation.completedAt ?? operation.updatedAt)}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            Cập nhật: {formatDate(operation.updatedAt)}
          </span>
        )}
        {operation.done && (
          <span className="flex items-center gap-1 font-medium text-foreground bg-muted px-2 py-0.5 rounded">
            {/* Use completedAt (terminal-state time). Fall back to updatedAt for legacy rows
                created before the completedAt column existed. */}
            ⏱ Thời gian xử lý: {formatDuration(operation.createdAt, operation.completedAt ?? operation.updatedAt)}
          </span>
        )}
      </div>

      {/* Idempotency key */}
      {operation.idempotencyKey && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Key className="w-3.5 h-3.5" />
          <span className="font-mono">{operation.idempotencyKey}</span>
        </div>
      )}

      {/* Progress bar when RUNNING */}
      {operation.state === 'RUNNING' && (
        <div className="space-y-1.5">
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(operation.progressPercent, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{typeof operation.progressMessage === 'string' ? operation.progressMessage : 'Đang xử lý...'}</span>
            <span>{operation.progressPercent}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
