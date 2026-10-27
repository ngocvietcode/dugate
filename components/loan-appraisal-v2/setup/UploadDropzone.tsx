'use client';

import { useRef, useState, type DragEvent } from 'react';
import { UploadCloud } from 'lucide-react';
import { ACCEPTED_EXTENSIONS, ACCEPT_ATTRIBUTE } from '@/app/loan-appraisal-v2/copy';
import { FOCUS_RING } from '../ui/toneClasses';

function extensionOk(name: string): boolean {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);
}

export function UploadDropzone({ disabled, onFiles }: { disabled: boolean; onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const accept = (list: FileList | File[]) => {
    const all = Array.from(list);
    const valid = all.filter((file) => extensionOk(file.name));
    const rejected = all.length - valid.length;
    if (valid.length > 0) onFiles(valid);
    setAnnouncement(
      `${valid.length > 0 ? `Đã thêm ${valid.length} tài liệu.` : ''}${rejected > 0 ? ` Bỏ qua ${rejected} tệp không đúng định dạng.` : ''}`.trim(),
    );
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled && event.dataTransfer.files.length > 0) accept(event.dataTransfer.files);
  };

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dragging ? 'border-primary bg-primary/10' : 'border-border bg-muted/40 hover:border-primary'} ${FOCUS_RING}`}
      >
        <UploadCloud className="h-6 w-6 text-primary" aria-hidden />
        <span className="text-sm font-semibold">Kéo thả hoặc chọn bộ hồ sơ</span>
        <span className="text-xs text-muted-foreground">PDF, ảnh, Word hoặc Excel · chọn nhiều tệp</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-label="Chọn tài liệu hồ sơ"
        onChange={(event) => {
          if (event.target.files) accept(event.target.files);
          event.target.value = '';
        }}
      />
      <p role="status" aria-live="polite" className="mt-1 min-h-4 text-xs text-muted-foreground">{announcement}</p>
    </div>
  );
}
