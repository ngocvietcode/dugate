'use client';

import React, { useState, useEffect } from 'react';

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  title?: string;
  description?: string;
}

export const JsonEditor: React.FC<JsonEditorProps> = ({
  value,
  onChange,
  title = "Phê duyệt Dữ liệu (Human in the Loop)",
  description = "Kiểm duyệt kết quả Bóc tách OCR. Chỉnh sửa JSON bên dưới nếu cần."
}) => {
  const [isValid, setIsValid] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      JSON.parse(value);
      setIsValid(true);
      setError(null);
    } catch (err: any) {
      setIsValid(false);
      setError(err.message);
    }
  }, [value]);

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(value);
      const formatted = JSON.stringify(parsed, null, 2);
      onChange(formatted);
    } catch (err) {
      // Ignore if invalid
    }
  };

  return (
    <div className="modern-card p-6 border-border/40 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500 bg-card/50 backdrop-blur-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2.5 text-foreground tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            {title}
          </h3>
          <p className="text-xs text-muted-foreground mt-1.5 ml-10.5 font-medium leading-relaxed max-w-xl">
            {description}
          </p>
        </div>
        
        <div className="flex items-center gap-3 shrink-0 ml-10.5 md:ml-0">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
            isValid 
              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
              : 'bg-destructive/10 text-destructive border border-destructive/20'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isValid ? 'bg-emerald-500 animate-pulse' : 'bg-destructive'}`} />
            {isValid ? 'JSON Hợp lệ' : 'Lỗi Cú pháp'}
          </div>
          
          <button
            onClick={handleFormat}
            disabled={!isValid}
            className="text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-primary/5 disabled:opacity-30"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="7.5 4.21 12 6.81 16.5 4.21"></polyline><polyline points="7.5 19.79 7.5 14.6 3 12"></polyline><polyline points="21 12 16.5 14.6 16.5 19.79"></polyline><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            Tự động Định dạng
          </button>
        </div>
      </div>

      <div className="relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-primary/10 via-transparent to-primary/5 rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 blur" />
        <div className="relative">
          <textarea
            className={`w-full h-[450px] p-6 font-mono text-sm leading-relaxed bg-[#0f0f13] text-[#a6accd] border border-border/50 rounded-xl outline-none transition-all focus:border-primary/50 shadow-inner scrollbar-thin scrollbar-thumb-primary/10 ${
              !isValid ? 'ring-1 ring-destructive/40 border-destructive/40' : ''
            }`}
            style={{ 
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Roboto Mono', monospace",
              tabSize: 2 
            }}
            value={value}
            onChange={e => onChange(e.target.value)}
            spellCheck={false}
          />
          
          {error && (
            <div className="absolute bottom-4 left-6 right-6 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-xs text-destructive animate-in fade-in slide-in-from-bottom-2">
              <span className="font-bold uppercase mr-2 text-[10px]">Error:</span> {error}
            </div>
          )}
        </div>
      </div>
      
      <p className="mt-4 text-[10px] text-muted-foreground flex items-center gap-1.5 font-medium ml-1">
        <svg className="w-3.5 h-3.5 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        Hệ thống sẽ chỉ tiếp tục nếu JSON hợp lệ. Thay đổi của bạn sẽ được lưu trực tiếp vào cơ sở dữ liệu.
      </p>
    </div>
  );
};
