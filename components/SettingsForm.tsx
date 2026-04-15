'use client';

// components/SettingsForm.tsx
// Form for AI provider settings: provider, api key, model, prompts

import { useState, useEffect } from 'react';
import { Eye, EyeOff, Save, Zap, CheckCircle, XCircle, Loader2, FileText, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';

// ─── Prompt presets (mirrors lib/settings.ts — kept client-side for instant fill) ──
const PROMPT_PRESETS = {
  en: {
    image: `You are describing an image from an internal SOP (Standard Operating Procedure) document. Purpose: to help AI agents guide employees through procedures without seeing the original image.\n\nDescribe in detail using this structure:\n\n1. IMAGE TYPE: Screenshot of software, process diagram, real photo, or table/chart.\n\n2. MAIN CONTENT:\n   - If software screenshot: app name, current screen, data fields, sample values, highlighted buttons or arrows.\n   - If process diagram: list each step in order with arrow directions.\n   - If real photo: describe objects, positions, conditions.\n   - If table/chart: list column headers and sample rows.\n\n3. TEXT IN IMAGE: Transcribe ALL visible text exactly as shown, especially labels, titles, values, button names.\n\n4. ACTION REQUIRED: If the image illustrates a specific action, describe exactly what to click/type/select and where.\n\nDo not add personal opinions. Do not guess information not visible in the image.`,
    pdf: `Transform this document to Markdown. Preserve heading structure, tables, and lists.\n\nFor each image in the document, replace with a detailed description block:\n> **[Image]:** [detailed description]\n\nInclude: image type, software name if screenshot, all visible text, and required actions if applicable.\n\nOutput clean Markdown with proper heading hierarchy (h1, h2, h3).`,
    docx: `Transform this Word document to Markdown. Preserve heading structure, tables, and lists.\nUse GitHub Flavored Markdown for tables.\n\nFor each image in the document, replace with a placeholder:\n![Image placeholder]()\n\nOutput clean Markdown with proper heading hierarchy (h1, h2, h3).`,
    compare: `Bạn là chuyên gia phân tích văn bản pháp lý. Nhiệm vụ của bạn là so sánh hai phiên bản của cùng một văn bản quy định/pháp lý.\n\nVăn bản được cấu trúc theo các điều, khoản (Điều 1, Điều 2, Khoản 1.1...).\n\n**FILE 1 (phiên bản cũ/gốc):**\n{file1}\n\n**FILE 2 (phiên bản mới/sửa đổi):**\n{file2}\n\n**Yêu cầu:**\nSo sánh từng điều/khoản giữa hai file. Chỉ liệt kê những điều/khoản CÓ SỰ THAY ĐỔI (thêm mới, xóa bỏ, chỉnh sửa nội dung). Bỏ qua các điều/khoản giống nhau hoàn toàn.\n\n**Định dạng output — trả về JSON array, mỗi phần tử có cấu trúc:**\n{\n  "clause": "Tên điều/khoản (vd: Điều 3, Khoản 2.1, Phần IV)",\n  "file1Content": "Nội dung nguyên văn trong file 1 (để trống nếu điều/khoản này không có trong file 1)",\n  "file2Content": "Nội dung nguyên văn trong file 2 (để trống nếu điều/khoản này không có trong file 2)",\n  "note": "Mô tả ngắn gọn sự khác biệt: Thêm mới / Đã xóa / Sửa đổi [tóm tắt thay đổi]"\n}\n\nChỉ trả về JSON array hợp lệ, không có markdown code fence hay giải thích thêm.`,
  },
  vi: {
    image: `Bạn là trợ lý mô tả hình ảnh cho tài liệu SOP (quy trình nội bộ). Mô tả chi tiết hình ảnh này bằng tiếng Việt theo cấu trúc sau:\n\n1. Một câu tóm tắt ngắn về nội dung tổng thể của hình.\n2. Mô tả chi tiết các thành phần chính: tên màn hình/giao diện, các nút bấm, menu, bảng dữ liệu, trường nhập liệu.\n3. Ghi rõ tất cả text/số liệu hiển thị trong hình (tên cột, giá trị, nhãn nút).\n4. Mô tả trạng thái hiện tại và thao tác mà người dùng đang thực hiện hoặc cần thực hiện.\n\nNếu hình trắng hoặc không có nội dung rõ ràng, chỉ ghi: "[Hình không có nội dung]".`,
    pdf: `Transform tài liệu này sang Markdown tiếng Việt. Giữ nguyên cấu trúc heading, bảng, danh sách. Mô tả chi tiết mọi hình ảnh trong tài liệu, bao gồm text trong hình nếu có.`,
    docx: `Transform tài liệu Word này sang Markdown tiếng Việt. Giữ nguyên cấu trúc heading, bảng, danh sách. Ưu tiên sử dụng bảng GFM cho các bảng biểu.\nĐối với mỗi hình ảnh, hãy chèn placeholder: ![Image placeholder]()`,
    compare: `Bạn là chuyên gia phân tích văn bản pháp lý. Nhiệm vụ của bạn là so sánh hai phiên bản của cùng một văn bản quy định/pháp lý.\n\nVăn bản được cấu trúc theo các điều, khoản (Điều 1, Điều 2, Khoản 1.1...).\n\n**FILE 1 (phiên bản cũ/gốc):**\n{file1}\n\n**FILE 2 (phiên bản mới/sửa đổi):**\n{file2}\n\n**Yêu cầu:**\nSo sánh từng điều/khoản giữa hai file. Chỉ liệt kê những điều/khoản CÓ SỰ THAY ĐỔI (thêm mới, xóa bỏ, chỉnh sửa nội dung). Bỏ qua các điều/khoản giống nhau hoàn toàn.\n\n**Định dạng output — trả về JSON array, mỗi phần tử có cấu trúc:**\n{\n  "clause": "Tên điều/khoản (vd: Điều 3, Khoản 2.1, Phần IV)",\n  "file1Content": "Nội dung nguyên văn trong file 1 (để trống nếu điều/khoản này không có trong file 1)",\n  "file2Content": "Nội dung nguyên văn trong file 2 (để trống nếu điều/khoản này không có trong file 2)",\n  "note": "Mô tả ngắn gọn sự khác biệt: Thêm mới / Đã xóa / Sửa đổi [tóm tắt thay đổi]"\n}\n\nChỉ trả về JSON array hợp lệ, không có markdown code fence hay giải thích thêm.`,
  },
} as const;

interface Settings {
  ai_provider: string;
  ai_api_key: string;
  ai_model: string;
  ai_image_prompt: string;
  ai_pdf_prompt: string;
  ai_docx_prompt: string;
  ai_compare_prompt: string;
  ai_generate_prompt: string;
  openai_api_key: string;
  openai_base_url: string;
  api_secret_key: string;
  s3_endpoint: string;
  s3_bucket: string;
  s3_access_key: string;
  s3_secret_key: string;
  s3_region: string;
  s3_cache_ttl_hours: string;
}

const PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openai', label: 'OpenAI (Compatible)' },
  { value: 'anthropic', label: 'Anthropic Claude (sắp hỗ trợ)' },
];

const MODEL_SUGGESTIONS: Record<string, { id: string; label: string }[]> = {
  gemini: [
    // Gemini 2.5
    { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    // Gemini 2.0
    { id: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite' },
    // Gemini 1.5
    { id: 'gemini-1.5-pro',        label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash',      label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-flash-8b',   label: 'Gemini 1.5 Flash-8B' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4o',      label: 'GPT-4o' },
  ],
  anthropic: [
    { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku' },
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  ],
};

export default function SettingsForm() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    ai_provider: 'gemini',
    ai_api_key: '',
    ai_model: 'gemini-2.0-flash-lite',
    ai_image_prompt: '',
    ai_pdf_prompt: '',
    ai_docx_prompt: '',
    ai_compare_prompt: '',
    ai_generate_prompt: '',
    openai_api_key: '',
    openai_base_url: 'https://api.openai.com/v1',
    api_secret_key: '',
    s3_endpoint: '',
    s3_bucket: '',
    s3_access_key: '',
    s3_secret_key: '',
    s3_region: 'us-east-1',
    s3_cache_ttl_hours: '168',
  });
  const [showKey, setShowKey] = useState(false);
  const [showS3Key, setShowS3Key] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testingS3, setTestingS3] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [s3TestResult, setS3TestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [cacheStats, setCacheStats] = useState<{ totalFiles: number; totalSizeMB: number; outputFiles: number; expiredOperations: number; storageBackend: string } | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: Settings) => {
        setSettings(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
      
    // Load cache stats
    fetch('/api/settings/cache').then(r => r.json()).then(setCacheStats).catch(() => {});
    // ensure theme is mounted
    setMounted(true);
  }, []);

  async function savePartial(keys: (keyof Settings)[], sectionName: string) {
    setSaving(sectionName);
    setSaveResult(null);
    
    // Xây dựng payload và tự động loại bỏ các key bị mask (chứa '*')
    const payload: Partial<Settings> = {};
    for (const k of keys) {
      const val = settings[k];
      if (typeof val === 'string' && val.includes('****')) {
        continue; // Bỏ qua giá trị đang bị đánh sao che giấu
      }
      payload[k] = val as any;
    }

    if (Object.keys(payload).length === 0) {
      setSaveResult({ ok: true, msg: `Không có gì thay đổi để lưu ở mục ${sectionName}` });
      setSaving(null);
      return;
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveResult({ ok: true, msg: `Đã lưu mục ${sectionName} thành công!` });
      } else {
        const data = await res.json();
        setSaveResult({ ok: false, msg: data.error || `Lỗi lưu mục ${sectionName}` });
      }
    } catch {
      setSaveResult({ ok: false, msg: 'Lỗi kết nối server' });
    } finally {
      setSaving(null);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    // Test endpoint đọc settings trực tiếp từ DB — không cần PUT trước
    // (PUT sẽ ghi đè key thật bằng giá trị masked "****" → data corruption)
    try {
      const res = await fetch('/api/settings/test', { method: 'POST' });
      const data = await res.json();
      setTestResult({ ok: data.success, msg: data.message });
    } catch {
      setTestResult({ ok: false, msg: 'Lỗi kết nối server' });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        <span className="ml-3 text-slate-500 font-medium">Đang tải cấu hình...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Giao diện (Theme) */}
      <div className="modern-card p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <Monitor className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Giao diện (Theme)</h2>
        </div>
        
        {mounted && (
          <div>
            <label className="block text-sm font-bold text-foreground mb-3">
              Chế độ hiển thị
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 font-medium transition-all ${
                  theme === 'light'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                Sáng
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 font-medium transition-all ${
                  theme === 'dark'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                Tối
              </button>
              <button
                type="button"
                onClick={() => setTheme('system')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 font-medium transition-all ${
                  theme === 'system'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                Hệ thống
              </button>
              <button
                type="button"
                onClick={() => setTheme('vpb')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 font-medium transition-all ${
                  theme === 'vpb'
                    ? 'border-[#009A49] bg-[#009A49]/10 text-[#009A49]'
                    : 'border-border text-muted-foreground hover:border-[#009A49]/50'
                }`}
              >
                VPB Sáng
              </button>
              <button
                type="button"
                onClick={() => setTheme('vpb-dark')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 font-medium transition-all ${
                  theme === 'vpb-dark'
                    ? 'border-[#00B25A] bg-[#00B25A]/10 text-[#00B25A]'
                    : 'border-border text-muted-foreground hover:border-[#00B25A]/50'
                }`}
              >
                VPB Tối
              </button>
            </div>
          </div>
        )}
      </div>

      {/* API Secret Key Protection */}
      <div className="modern-card p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <Zap className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Bảo mật API (Dugateway)</h2>
        </div>

        <div>
          <label className="block text-sm font-bold text-foreground mb-2">
            API Secret Key (Client header `x-api-key`)
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={settings.api_secret_key}
              onChange={e => setSettings(s => ({ ...s, api_secret_key: e.target.value }))}
              placeholder="Nhập khóa bảo vệ API Gateway..."
              className="input-field font-mono pr-12"
            />
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary p-1 rounded transition-colors"
            >
              {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Dùng để xác thực các request gọi tới `/api/v1/`. Mọi client đều phải truyền key này qua header `x-api-key` để vượt qua Middleware.</p>
        </div>
        
        <div className="flex justify-end pt-2">
          <button
            onClick={() => savePartial(['api_secret_key'], 'Bảo mật API')}
            disabled={saving === 'Bảo mật API'}
            className="w-full sm:w-auto btn-primary modern-button py-2 px-5 text-sm"
          >
            {saving === 'Bảo mật API' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving === 'Bảo mật API' ? 'Đang lưu...' : 'Lưu API Key Gateway'}
          </button>
        </div>
      </div>

      {/* S3 Storage */}
      <div className="modern-card p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <FileText className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">File Storage (S3 Compatible)</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Endpoint URL (Tùy chọn)</label>
            <input
              type="text"
              value={settings.s3_endpoint}
              onChange={e => setSettings(s => ({ ...s, s3_endpoint: e.target.value }))}
              placeholder="Để trống nếu dùng AWS mặc định"
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Bucket</label>
            <input
              type="text"
              value={settings.s3_bucket}
              onChange={e => setSettings(s => ({ ...s, s3_bucket: e.target.value }))}
              placeholder="dugate-files"
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Access Key (Tùy chọn)</label>
            <div className="relative">
              <input
                type={showS3Key ? 'text' : 'password'}
                value={settings.s3_access_key}
                onChange={e => setSettings(s => ({ ...s, s3_access_key: e.target.value }))}
                placeholder="Để trống nếu dùng IAM Role"
                className="input-field font-mono pr-12"
              />
              <button
                type="button"
                onClick={() => setShowS3Key(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary p-1 rounded transition-colors"
              >
                {showS3Key ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Secret Key (Tùy chọn)</label>
            <input
              type="password"
              value={settings.s3_secret_key}
              onChange={e => setSettings(s => ({ ...s, s3_secret_key: e.target.value }))}
              placeholder="Để trống nếu dùng IAM Role"
              className="input-field font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Region</label>
            <input
              type="text"
              value={settings.s3_region}
              onChange={e => setSettings(s => ({ ...s, s3_region: e.target.value }))}
              placeholder="us-east-1"
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Cache TTL (hours)</label>
            <input
              type="number"
              value={settings.s3_cache_ttl_hours}
              onChange={e => setSettings(s => ({ ...s, s3_cache_ttl_hours: e.target.value }))}
              placeholder="168"
              className="input-field"
              min={1}
            />
            <p className="text-xs text-muted-foreground mt-1">File cache sẽ tự xóa sau khoảng thời gian này (mặc định 7 ngày)</p>
          </div>
        </div>

        {/* Storage Stats */}
        {cacheStats && (
          <div className="space-y-3">
            {/* Backend indicator */}
            <div className="flex items-center gap-2 text-xs">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold ${
                cacheStats.storageBackend === 's3'
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'bg-muted text-muted-foreground border border-border'
              }`}>
                <span className={`w-2 h-2 rounded-full ${cacheStats.storageBackend === 's3' ? 'bg-primary' : 'bg-muted-foreground'}`} />
                {cacheStats.storageBackend === 's3' ? 'S3 Active' : 'Local Disk'}
              </span>
            </div>

            {/* File Cache row */}
            <div className="bg-muted/50 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">File Cache (Dedup)</span>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setClearingCache(true);
                      try {
                        const res = await fetch('/api/settings/cache?expired=true', { method: 'DELETE' });
                        const data = await res.json();
                        setS3TestResult({ ok: true, msg: `Cleared ${data.deleted} expired file(s), freed ${data.freedMB} MB` });
                        fetch('/api/settings/cache').then(r => r.json()).then(setCacheStats).catch(() => {});
                      } catch { setS3TestResult({ ok: false, msg: 'Failed to clear cache' }); }
                      setClearingCache(false);
                    }}
                    disabled={clearingCache}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border hover:border-primary transition-colors disabled:opacity-50"
                  >
                    Clear Expired
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('Xóa toàn bộ file cache (unreferenced)? Hành động này không thể hoàn tác.')) return;
                      setClearingCache(true);
                      try {
                        const res = await fetch('/api/settings/cache', { method: 'DELETE' });
                        const data = await res.json();
                        setS3TestResult({ ok: true, msg: `Cleared ${data.deleted} file(s), freed ${data.freedMB} MB` });
                        fetch('/api/settings/cache').then(r => r.json()).then(setCacheStats).catch(() => {});
                      } catch { setS3TestResult({ ok: false, msg: 'Failed to clear cache' }); }
                      setClearingCache(false);
                    }}
                    disabled={clearingCache}
                    className="text-xs px-3 py-1.5 rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  >
                    Clear All
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="font-medium text-foreground">{cacheStats.totalFiles} file(s)</span>
                <span className="text-muted-foreground">|</span>
                <span className="font-medium text-foreground">{cacheStats.totalSizeMB} MB</span>
              </div>
            </div>

            {/* Output Files row */}
            <div className="bg-muted/50 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Output Files</span>
                {cacheStats.expiredOperations > 0 && (
                  <button
                    onClick={async () => {
                      setClearingCache(true);
                      try {
                        const res = await fetch('/api/settings/cache?target=outputs', { method: 'DELETE' });
                        const data = await res.json();
                        setS3TestResult({ ok: true, msg: `Cleaned ${data.deleted} expired operation(s), freed ${data.freedMB} MB` });
                        fetch('/api/settings/cache').then(r => r.json()).then(setCacheStats).catch(() => {});
                      } catch { setS3TestResult({ ok: false, msg: 'Failed to clean output files' }); }
                      setClearingCache(false);
                    }}
                    disabled={clearingCache}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border hover:border-primary transition-colors disabled:opacity-50"
                  >
                    Clean Expired Outputs
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="font-medium text-foreground">{cacheStats.outputFiles} operation(s) with output files</span>
                {cacheStats.expiredOperations > 0 && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <span className="font-medium text-amber-600 dark:text-amber-400">{cacheStats.expiredOperations} expired (cleanable)</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {s3TestResult && (
          <div className={`flex items-center gap-2 text-sm font-medium rounded-xl px-4 py-3 ${
            s3TestResult.ok ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-destructive/10 text-destructive border border-destructive/20'
          }`}>
            {s3TestResult.ok ? <CheckCircle className="w-5 h-5 shrink-0" /> : <XCircle className="w-5 h-5 shrink-0" />}
            {s3TestResult.msg}
          </div>
        )}

        <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2">
          <button
            onClick={async () => {
              setTestingS3(true);
              setS3TestResult(null);
              try {
                // Save S3 settings first
                await savePartial(['s3_endpoint', 's3_bucket', 's3_access_key', 's3_secret_key', 's3_region', 's3_cache_ttl_hours'], 'S3 Storage');
                const res = await fetch('/api/settings/s3-test', { method: 'POST' });
                const data = await res.json();
                setS3TestResult({ ok: data.ok, msg: data.ok ? data.message : data.error });
              } catch { setS3TestResult({ ok: false, msg: 'Network error' }); }
              setTestingS3(false);
            }}
            disabled={testingS3 || saving === 'S3 Storage'}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2 bg-card border-2 border-border text-foreground rounded-xl font-bold hover:border-primary hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm"
          >
            {testingS3 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-primary" />}
            {testingS3 ? 'Testing...' : 'Lưu & Test Connection'}
          </button>
        </div>
      </div>

      {/* AI Provider */}
      <div className="modern-card p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <Zap className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Cấu hình Nền tảng AI</h2>
        </div>

        <div>
          <label className="block text-sm font-bold text-foreground mb-2">
            Nhà cung cấp (Provider)
          </label>
          <select
            value={settings.ai_provider}
            onChange={e => setSettings(s => ({ ...s, ai_provider: e.target.value }))}
            className="input-field cursor-pointer"
          >
            {PROVIDER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {settings.ai_provider === 'gemini' && (
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">
              Gemini API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.ai_api_key}
                onChange={e => setSettings(s => ({ ...s, ai_api_key: e.target.value }))}
                placeholder="Nhập Gemini API key..."
                className="input-field font-mono pr-12"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary p-1 rounded transition-colors"
              >
                {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 text-primary" />
              API key được mã hóa an toàn AES-256 trước khi lưu.
            </p>
          </div>
        )}

        {settings.ai_provider === 'openai' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-foreground mb-2">
                OpenAI Base URL (Tùy chỉnh)
              </label>
              <input
                type="text"
                value={settings.openai_base_url}
                onChange={e => setSettings(s => ({ ...s, openai_base_url: e.target.value }))}
                placeholder="https://api.openai.com/v1"
                className="input-field font-mono"
              />
              <p className="text-xs text-muted-foreground mt-2">Dùng để kết nối vLLM, LMStudio, Ollama... hoặc để mặc định nếu dùng dịch vụ OpenAI gốc.</p>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground mb-2">
                OpenAI API Key (Tùy chọn nếu xài host local)
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={settings.openai_api_key}
                  onChange={e => setSettings(s => ({ ...s, openai_api_key: e.target.value }))}
                  placeholder="Nhập OpenAI API key..."
                  className="input-field font-mono pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary p-1 rounded transition-colors"
                >
                  {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-primary" />
                API key được mã hóa an toàn AES-256 trước khi lưu.
              </p>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-bold text-foreground mb-2">
            Mô hình AI (Model)
          </label>
          <input
            type="text"
            value={settings.ai_model}
            onChange={e => setSettings(s => ({ ...s, ai_model: e.target.value }))}
            className="input-field font-mono"
          />
          <div className="mt-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mr-3">Gợi ý:</span>
            <div className="inline-flex flex-wrap gap-2 mt-2 md:mt-0">
              {(MODEL_SUGGESTIONS[settings.ai_provider] ?? []).map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSettings(s => ({ ...s, ai_model: m.id }))}
                  className={`text-xs px-2.5 py-1.5 rounded-md border font-medium transition-all ${
                    settings.ai_model === m.id
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-card text-foreground border-border hover:border-primary hover:text-primary'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        <div className="flex justify-end pt-2">
          <button
            onClick={() => savePartial(['ai_provider', 'ai_api_key', 'ai_model', 'openai_base_url', 'openai_api_key'], 'Nền tảng AI')}
            disabled={saving === 'Nền tảng AI'}
            className="w-full sm:w-auto btn-primary modern-button py-2 px-5 text-sm"
          >
            {saving === 'Nền tảng AI' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving === 'Nền tảng AI' ? 'Đang lưu...' : 'Lưu Cấu hình Nền tảng AI'}
          </button>
        </div>
      </div>

      {/* Prompts */}
      <div className="modern-card p-6 md:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Cấu hình Prompts Hệ thống</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-muted-foreground">Mẫu mặc định:</span>
            <select
              onChange={e => {
                const lang = e.target.value as 'en' | 'vi';
                setSettings(s => ({
                  ...s,
                  ai_image_prompt: PROMPT_PRESETS[lang].image,
                  ai_pdf_prompt:   PROMPT_PRESETS[lang].pdf,
                  ai_docx_prompt:  PROMPT_PRESETS[lang].docx,
                  ai_compare_prompt: PROMPT_PRESETS[lang].compare,
                }));
              }}
              className="text-sm border border-border bg-card text-foreground rounded-lg px-3 py-1.5 hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer transition-colors"
            >
              <option value="en">English (Khuyên dùng)</option>
              <option value="vi">Tiếng Việt</option>
            </select>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Prompt mô tả Hình ảnh (DOCX)</label>
            <textarea
              rows={4}
              value={settings.ai_image_prompt}
              onChange={e => setSettings(s => ({ ...s, ai_image_prompt: e.target.value }))}
              className="input-field font-mono text-sm leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Prompt chuyển đổi PDF</label>
            <textarea
              rows={4}
              value={settings.ai_pdf_prompt}
              onChange={e => setSettings(s => ({ ...s, ai_pdf_prompt: e.target.value }))}
              className="input-field font-mono text-sm leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Prompt chuyển đổi DOCX</label>
            <textarea
              rows={4}
              value={settings.ai_docx_prompt}
              onChange={e => setSettings(s => ({ ...s, ai_docx_prompt: e.target.value }))}
              className="input-field font-mono text-sm leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Prompt so sánh Tài liệu</label>
            <textarea
              rows={5}
              value={settings.ai_compare_prompt}
              onChange={e => setSettings(s => ({ ...s, ai_compare_prompt: e.target.value }))}
              className="input-field font-mono text-sm leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-foreground mb-2">Prompt tạo Tài liệu</label>
            <p className="text-sm font-medium text-muted-foreground mb-2 bg-muted p-3 rounded-lg border border-border">
              Template thực tế sử dụng: <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded mr-1 font-mono">{`{user_prompt}`}</code> và <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">{`{input_content}`}</code>
            </p>
            <textarea
              rows={5}
              value={settings.ai_generate_prompt}
              onChange={e => setSettings(s => ({ ...s, ai_generate_prompt: e.target.value }))}
              className="input-field font-mono text-sm leading-relaxed"
            />
          </div>
        </div>
        
        <div className="flex justify-end pt-2">
          <button
            onClick={() => savePartial(['ai_image_prompt', 'ai_pdf_prompt', 'ai_docx_prompt', 'ai_compare_prompt', 'ai_generate_prompt'], 'Hệ thống Prompts')}
            disabled={saving === 'Hệ thống Prompts'}
            className="w-full sm:w-auto btn-primary modern-button py-2 px-5 text-sm"
          >
            {saving === 'Hệ thống Prompts' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving === 'Hệ thống Prompts' ? 'Đang lưu...' : 'Lưu Prompts Hướng dẫn'}
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-4 mt-8">
        <div className="w-full sm:w-auto">
          {saveResult && (
            <div className={`flex items-center gap-2 text-sm font-medium rounded-xl px-4 py-3 ${
              saveResult.ok ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-destructive/10 text-destructive border border-destructive/20'
            }`}>
              {saveResult.ok
                ? <CheckCircle className="w-5 h-5 shrink-0" />
                : <XCircle className="w-5 h-5 shrink-0" />}
              {saveResult.msg}
            </div>
          )}
        </div>

        <button
          onClick={handleTest}
          disabled={testing}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-card border-2 border-border text-foreground rounded-xl font-bold hover:border-primary hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          {testing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5 text-destructive" />}
          {testing ? 'Đang kiểm tra...' : 'Kiểm tra kết nối AI'}
        </button>
      </div>

      {testResult && (
        <div className={`flex items-center gap-2 text-sm font-medium rounded-xl px-4 py-3 ${
          testResult.ok ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-destructive/10 text-destructive border border-destructive/20'
        }`}>
          {testResult.ok
            ? <CheckCircle className="w-5 h-5 shrink-0" />
            : <XCircle className="w-5 h-5 shrink-0" />}
          {testResult.msg}
        </div>
      )}
    </div>
  );
}
