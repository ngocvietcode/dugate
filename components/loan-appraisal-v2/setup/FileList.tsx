'use client';

import { X } from 'lucide-react';
import { fileExtension, formatBytes } from '@/app/loan-appraisal-v2/lib/format';
import { Button } from '../ui/Button';
import { FOCUS_RING } from '../ui/toneClasses';

export interface FileEntry {
  id: string;
  file: File;
}

export function FileList({ entries, locked, onRemove, onClear }: {
  entries: FileEntry[];
  locked: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground">{entries.length} tài liệu đầu vào</h4>
        {!locked && <Button size="sm" variant="ghost" onClick={onClear}>Xoá tất cả</Button>}
      </div>
      <ul className="max-h-64 space-y-1.5 overflow-auto pr-1">
        {entries.map(({ id, file }) => (
          <li key={id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
            <span className="flex h-8 w-10 shrink-0 items-center justify-center rounded-md bg-card text-[11px] font-bold text-primary">{fileExtension(file.name)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium" title={file.name}>{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            {!locked && (
              <button
                type="button"
                aria-label={`Xoá ${file.name}`}
                onClick={() => onRemove(id)}
                className={`rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
