'use client';

import { FileText } from 'lucide-react';
import type { FileInfo } from '../../types';

interface FilesSectionProps {
  filesJson: FileInfo[];
  filesDeleted: boolean;
}

export default function FilesSection({ filesJson, filesDeleted }: FilesSectionProps) {
  if (!filesJson || filesJson.length === 0) return null;

  return (
    <div className="modern-card p-6 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Files</h3>
        {filesDeleted && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
            Files đã bị xóa
          </span>
        )}
      </div>

      <ul className="space-y-1.5">
        {filesJson.map((file, idx) => (
          <li key={idx} className="flex items-center gap-2 text-sm text-foreground">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate">{typeof file.name === 'string' ? file.name : JSON.stringify(file.name)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
