'use client';

import { FileText } from 'lucide-react';
import { sourceDocumentsOf, type SourceDocument } from '@/app/loan-appraisal-v2/lib/selectors';
import { useEvidenceLookup } from './EvidenceContext';

const EMPTY = 'Chưa liên kết được chứng từ nguồn.';

/** Chip chứng từ nguồn khi đã có sẵn tên file. */
export function SourceFileChips({ documents, unresolved = 0, label = 'Nguồn', emptyText = EMPTY, className = '' }: {
  documents: Array<SourceDocument | string>;
  unresolved?: number;
  label?: string;
  emptyText?: string;
  className?: string;
}) {
  const items = documents.map((doc) => (typeof doc === 'string' ? { file_name: doc, doc_type_label: '' } : doc));
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {label && (
        <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <FileText className="h-3.5 w-3.5" aria-hidden />{label}
        </span>
      )}
      {items.length > 0 ? items.map((doc) => (
        <span
          key={`${doc.file_name}-${doc.doc_type_label}`}
          title={doc.doc_type_label ? `${doc.file_name} · ${doc.doc_type_label}` : doc.file_name}
          className="max-w-full truncate rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
        >
          {doc.file_name}{doc.doc_type_label && <span className="text-muted-foreground"> · {doc.doc_type_label}</span>}
        </span>
      )) : <span className="text-xs italic text-muted-foreground">{emptyText}</span>}
      {unresolved > 0 && <span className="text-xs text-[rgb(var(--la2-warning))]">{unresolved} căn cứ không truy được chứng từ</span>}
    </div>
  );
}

/** Chip chứng từ nguồn cho danh sách evidence id (tra qua EvidenceProvider). */
export function EvidenceChips({ ids, label, emptyText, className }: {
  ids: string[] | null | undefined;
  label?: string;
  emptyText?: string;
  className?: string;
}) {
  const lookup = useEvidenceLookup();
  const { documents, unresolved } = sourceDocumentsOf(ids, lookup);
  return <SourceFileChips documents={documents} unresolved={unresolved} label={label} emptyText={emptyText} className={className} />;
}
