'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, FileText, File, X, Loader2, KeyRound, CheckCircle2, AlertTriangle } from 'lucide-react';

export type FieldDef = {
  name: string;
  label: string;
  type: 'select' | 'text' | 'textarea';
  options?: { label: string; value: string }[];
  placeholder?: string;
  defaultValue?: string;
};

interface ServiceTestClientProps {
  serviceSlug: string; 
  title: string;
  description: string;
  discriminatorName?: string; 
  discriminatorOptions?: { label: string; value: string }[];
  extraFields?: FieldDef[];
  isCompareMode?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ServiceTestClient({
  serviceSlug,
  title,
  description,
  discriminatorName,
  discriminatorOptions,
  extraFields = [],
  isCompareMode = false,
}: ServiceTestClientProps) {
  const [apiKeyId, setApiKeyId] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(true);

  // Form State
  const [files, setFiles] = useState<File[]>([]);
  const [targetFile, setTargetFile] = useState<File | null>(null); // For compare mode
  const [dragging, setDragging] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  
  // Request State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [execTime, setExecTime] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetFileInputRef = useRef<HTMLInputElement>(null);

  // Initialize form data with defaults
  useEffect(() => {
    const initialData: Record<string, string> = {};
    if (discriminatorName && discriminatorOptions?.length) {
      initialData[discriminatorName] = discriminatorOptions[0].value;
    }
    extraFields.forEach(f => {
      if (f.defaultValue) initialData[f.name] = f.defaultValue;
    });
    setFormData(initialData);
  }, [discriminatorName, discriminatorOptions, extraFields]);

  // Fetch Global API Key
  useEffect(() => {
    async function fetchKeys() {
      try {
        const res = await fetch('/api/internal/apikeys');
        const data = await res.json();
        if (data.success && data.apiKeys?.length > 0) {
          setApiKeyId(data.apiKeys[0].id);
        } else {
          setError('Không tìm thấy API Key nào. Vui lòng tạo Profile trước.');
        }
      } catch (err) {
        console.error('Failed to fetch api keys', err);
        setError('Lỗi khi tải thông tin xác thực.');
      } finally {
        setKeyLoading(false);
      }
    }
    fetchKeys();
  }, []);

  // -- File Handling
  const acceptFiles = (incoming: FileList | File[], isTarget = false) => {
    const arr = Array.from(incoming);
    setError(null);
    if (isCompareMode && isTarget) {
      if (arr.length > 0) setTargetFile(arr[0]);
    } else {
      if (isCompareMode && arr.length > 0) {
         setFiles([arr[0]]); // Compare only takes 1 source
      } else {
         setFiles(prev => [...prev, ...arr]);
      }
    }
  };

  const removeFile = (name: string, isTarget = false) => {
    if (isTarget) setTargetFile(null);
    else setFiles(prev => prev.filter(f => f.name !== name));
  };

  const renderDropzone = (isTarget = false) => {
    const currentFiles = isTarget ? (targetFile ? [targetFile] : []) : files;
    const acceptExt = '.pdf,.docx,.doc,.png,.jpg,.jpeg';
    const label = isTarget ? 'Target File (V2)' : (isCompareMode ? 'Source File (V1)' : 'Kéo thả tài liệu vào đây');
    const multiple = !isCompareMode;

    return (
      <div
        onClick={() => currentFiles.length === 0 && (isTarget ? targetFileInputRef.current?.click() : fileInputRef.current?.click())}
        onDragOver={(e) => { e.preventDefault(); !isTarget && setDragging(true); }}
        onDragLeave={() => !isTarget && setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          !isTarget && setDragging(false);
          if (e.dataTransfer.files.length > 0) acceptFiles(e.dataTransfer.files, isTarget);
        }}
        className={`relative border-2 border-dashed rounded-3xl transition-colors duration-200 cursor-pointer overflow-hidden
          ${currentFiles.length === 0 ? 'p-10 text-center hover:bg-muted/50' : 'p-5 bg-card/50'}
          ${!isTarget && dragging ? 'border-primary bg-primary/5' : 'border-border'}
        `}
      >
        <input
          ref={isTarget ? targetFileInputRef : fileInputRef}
          type="file"
          accept={acceptExt}
          multiple={multiple}
          className="sr-only"
          onChange={e => e.target.files && acceptFiles(e.target.files, isTarget)}
        />
        
        {currentFiles.length === 0 ? (
          <>
            <Upload className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="font-semibold text-foreground text-sm">{label}</p>
            <p className="text-xs text-muted-foreground mt-1">Hỗ trợ PDF, DOCX, Hình ảnh</p>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
            {currentFiles.map(f => (
              <div key={f.name} className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeFile(f.name, isTarget); }}
                  className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // -- Submission
  const handleSubmit = async () => {
    if (!apiKeyId) return;
    if (files.length === 0) {
      setError('Vui lòng upload tài liệu để xử lý.');
      return;
    }
    if (isCompareMode && !targetFile) {
      setError('Mode so sánh yêu cầu upload đủ cả Source và Target file.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    const start = Date.now();

    try {
      const form = new FormData();
      form.append('__service', serviceSlug);
      form.append('__apiKeyId', apiKeyId);

      // Append form fields
      Object.entries(formData).forEach(([k, v]) => {
        if (v) form.append(k, v);
      });

      // Append files
      if (isCompareMode) {
        form.append('source_file', files[0]);
        form.append('target_file', targetFile!);
      } else {
        files.forEach(f => form.append('files[]', f));
      }

      const res = await fetch('/api/internal/test-profile-endpoint', {
        method: 'POST',
        body: form,
      });

      const data = await res.json();
      
      if (!res.ok) {
        setError(data.detail ?? data.error ?? data.title ?? 'Lỗi xử lý từ server');
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối tới server.');
    } finally {
      setLoading(false);
      setExecTime(Date.now() - start);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
      
      {/* LEFT COLUMN: Controls & Input */}
      <div className="lg:col-span-5 space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight flex items-center gap-3">
            {title}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{description}</p>
        </div>

        {/* Global Auth Badge */}
        <div className="flex items-center gap-2 bg-muted/50 border border-border px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground">
          {keyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 
           apiKeyId ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : 
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
          Xác thực: {apiKeyId ? 'Global API Key' : (keyLoading ? 'Đang tải profile...' : 'Chưa có API Key')}
        </div>

        {/* Parameters Form */}
        <div className="modern-card p-5 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 border-b border-border pb-2">Tham số API</h3>
          
          {discriminatorName && discriminatorOptions && (
            <div>
              <label className="block text-sm font-bold mb-1.5">{discriminatorName} *</label>
              <select 
                className="input-field py-2.5 font-mono text-sm"
                value={formData[discriminatorName] || ''}
                onChange={e => setFormData({...formData, [discriminatorName]: e.target.value})}
              >
                {discriminatorOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {extraFields.map(field => (
            <div key={field.name}>
              <label className="block text-sm font-bold mb-1.5">{field.label}</label>
              {field.type === 'select' ? (
                <select 
                  className="input-field py-2.5"
                  value={formData[field.name] || ''}
                  onChange={e => setFormData({...formData, [field.name]: e.target.value})}
                >
                  <option value="">-- Mặc định --</option>
                  {field.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea 
                  className="input-field font-mono text-xs leading-relaxed min-h-[100px]"
                  placeholder={field.placeholder}
                  value={formData[field.name] || ''}
                  onChange={e => setFormData({...formData, [field.name]: e.target.value})}
                />
              ) : (
                <input 
                  type="text"
                  className="input-field py-2.5"
                  placeholder={field.placeholder}
                  value={formData[field.name] || ''}
                  onChange={e => setFormData({...formData, [field.name]: e.target.value})}
                />
              )}
            </div>
          ))}
        </div>

        {/* File Uploads */}
        <div className="space-y-3">
           <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">Tài liệu đầu vào</h3>
           <div className="grid grid-cols-1 gap-4">
             {renderDropzone(false)}
             {isCompareMode && renderDropzone(true)}
           </div>
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm font-semibold p-4 rounded-xl border border-destructive/20 whitespace-pre-wrap leading-relaxed">
            {error}
          </div>
        )}

        <button 
          onClick={handleSubmit} 
          disabled={loading || !apiKeyId || files.length === 0 || (isCompareMode && !targetFile)}
          className="w-full btn-primary modern-button py-3 text-lg font-bold shadow-lg shadow-primary/20"
        >
          {loading ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Đang xử lý...</> : 'Bắt đầu xử lý đồng bộ'}
        </button>
      </div>

      {/* RIGHT COLUMN: Results */}
      <div className="lg:col-span-7 flex flex-col">
        <div className="modern-card flex-1 flex flex-col overflow-hidden bg-card border-border relative min-h-[500px]">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
             <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-mono text-xs font-bold text-muted-foreground uppercase tracking-widest">JSON Response</span>
             </div>
             {execTime !== null && !loading && (
               <span className="text-xs font-mono text-muted-foreground font-semibold">
                 Thời gian: {(execTime / 1000).toFixed(2)}s
               </span>
             )}
          </div>
          
          <div className="flex-1 bg-[#1e1e1e] overflow-auto p-4 text-sm font-mono text-emerald-400 relative">
             {loading ? (
               <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground opacity-50">
                  <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
                  <p>Hệ thống AI đang phân tích tài liệu...</p>
                  <p className="text-xs mt-2">Việc này có thể mất từ vài giây đến 1 phút.</p>
               </div>
             ) : result ? (
               <pre className="whitespace-pre-wrap break-words">
                 {JSON.stringify(result, null, 2)}
               </pre>
             ) : (
               <div className="absolute inset-0 flex items-center justify-center text-muted-foreground opacity-30">
                  Chưa có dữ liệu phản hồi
               </div>
             )}
          </div>
        </div>
      </div>

    </div>
  );
}
