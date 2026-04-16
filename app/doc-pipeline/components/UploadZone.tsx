'use client';

// app/doc-pipeline/components/UploadZone.tsx
// File upload zone with drag & drop, file list, and sample files.

import React, { useRef, useCallback } from 'react';
import type { UploadedFile } from '../types';
import { UploadCloudIcon, XIcon } from './Icons';
import { getFileIcon, formatBytes } from '../lib/mock-data';

interface UploadZoneProps {
  files: UploadedFile[];
  isProcessing: boolean;
  onFilesAdded: (uploadedFiles: UploadedFile[], realFiles?: File[]) => void;
  onFileRemoved: (id: string) => void;
  onClearAll: () => void;
}

export function UploadZone({ files, isProcessing, onFilesAdded, onFileRemoved, onClearAll }: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = React.useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInput = useCallback((fileList: FileList) => {
    const newFiles: UploadedFile[] = Array.from(fileList).map(f => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size,
      type: f.type,
      icon: getFileIcon(f.name),
    }));
    onFilesAdded(newFiles, Array.from(fileList));
  }, [onFilesAdded]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileInput(e.dataTransfer.files);
    }
  }, [handleFileInput]);

  return (
    <div className="modern-card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-lg" aria-hidden="true">📁</div>
        <div>
          <h2 className="font-heading font-bold text-lg">Upload Hồ sơ</h2>
          <p className="text-muted-foreground text-xs">Kéo thả hoặc chọn file — hỗ trợ PDF, DOCX, XLSX, ảnh, ZIP</p>
        </div>
      </div>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Khu vực upload file"
        className={`dropzone p-8 text-center transition-all duration-300 ${isDragOver ? 'border-primary bg-primary/10 scale-[1.01]' : ''} ${isProcessing ? 'pointer-events-none opacity-50' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
      >
        <UploadCloudIcon className={`w-12 h-12 mx-auto mb-3 transition-all duration-300 ${isDragOver ? 'text-primary scale-110' : 'text-muted-foreground'}`} />
        <p className="font-semibold text-sm mb-1">
          {isDragOver ? 'Thả file vào đây...' : 'Kéo thả file hoặc click để chọn'}
        </p>
        <p className="text-xs text-muted-foreground">PDF, DOCX, XLSX, PNG, JPG, ZIP — tối đa 300MB/file</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.xlsx,.xls,.png,.jpg,.jpeg,.zip"
          className="hidden"
          aria-label="Chọn file upload"
          onChange={e => e.target.files && handleFileInput(e.target.files)}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {files.length} file đã chọn
            </span>
            {!isProcessing && (
              <button
                onClick={onClearAll}
                className="text-xs text-destructive hover:text-destructive/80 font-medium transition-colors"
                aria-label="Xóa tất cả file"
              >
                Xóa tất cả
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/50 border border-border/50 group hover:border-primary/30 transition-all">
                <span className="text-xl flex-shrink-0" aria-hidden="true">{f.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                </div>
                {!isProcessing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onFileRemoved(f.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded-lg transition-all"
                    aria-label={`Xóa file ${f.name}`}
                  >
                    <XIcon className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
