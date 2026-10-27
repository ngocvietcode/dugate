'use client';

// components/SettingsForm.tsx
// Form for system settings: S3 storage, home mode

import { useState, useEffect } from 'react';
import { Save, Zap, CheckCircle, XCircle, Loader2, Monitor, Eye, EyeOff, FileText, Activity } from 'lucide-react';
import { useTheme } from 'next-themes';
import ModelPricingSection from './ModelPricingSection';

interface Settings {
  s3_endpoint: string;
  s3_bucket: string;
  s3_access_key: string;
  s3_secret_key: string;
  s3_region: string;
  s3_cache_ttl_hours: string;
  home_mode: string;
  ops_stuck_running_min: string;
  ops_stuck_pending_min: string;
  ops_export_max_days: string;
  [key: string]: string; // allow dynamic keys from backend
}

// [SEC 18/09 P1.1] Keys GET only ever returns masked. Mirrors MASKED_SECRET_KEYS in
// app/api/settings/route.ts.
const MASKED_SECRET_KEYS = ['s3_access_key', 's3_secret_key'] as const;

const SECRET_LABELS: Record<string, string> = {
  s3_access_key: 'Access Key',
  s3_secret_key: 'Secret Key',
};

export default function SettingsForm() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    s3_endpoint: '',
    s3_bucket: '',
    s3_access_key: '',
    s3_secret_key: '',
    s3_region: 'us-east-1',
    s3_cache_ttl_hours: '168',
    home_mode: 'showcase',
    ops_stuck_running_min: '10',
    ops_stuck_pending_min: '5',
    ops_export_max_days: '31',
  });
  // [SEC 18/09 P1.1] The masks GET last handed us, so savePartial can tell an
  // untouched secret field (skip it) from a half-edited one (refuse, and say so).
  const [serverMasks, setServerMasks] = useState<Record<string, string>>({});
  const [showS3Key, setShowS3Key] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [testingS3, setTestingS3] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [s3TestResult, setS3TestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [cacheStats, setCacheStats] = useState<{ totalFiles: number; totalSizeMB: number; outputFiles: number; expiredOperations: number; storageBackend: string } | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: Settings) => {
        setSettings(data);
        setServerMasks(
          Object.fromEntries(MASKED_SECRET_KEYS.map(k => [k, data[k] ?? ''])),
        );
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
    
    // [SEC 18/09 P1.1] Build the payload. A secret field left exactly as the mask GET
    // gave us was not edited, so drop it and say so afterwards. A field that still
    // carries '****' but no longer matches the mask is half-edited — the old code
    // dropped it silently and then reported success, so the operator believed a secret
    // was saved when it was not. Refuse that outright instead.
    const payload: Partial<Settings> = {};
    const untouchedSecrets: string[] = [];
    for (const k of keys) {
      const key = String(k);
      const val = settings[k];
      if ((MASKED_SECRET_KEYS as readonly string[]).includes(key) && typeof val === 'string') {
        if (serverMasks[key] && val === serverMasks[key]) {
          untouchedSecrets.push(SECRET_LABELS[key] ?? key);
          continue;
        }
        if (val.includes('****')) {
          setSaveResult({
            ok: false,
            msg: `Ô "${SECRET_LABELS[key] ?? key}" đang là giá trị che (****) bị sửa dở nên không lưu được — chưa có gì ở mục ${sectionName} được lưu. Hãy xoá trắng ô rồi dán lại toàn bộ giá trị, hoặc để trống để xoá secret.`,
          });
          setSaving(null);
          return;
        }
      }
      payload[k] = val as any;
    }

    const untouchedNote = untouchedSecrets.length
      ? ` (giữ nguyên ${untouchedSecrets.join(', ')} vì chưa sửa)`
      : '';

    if (Object.keys(payload).length === 0) {
      setSaveResult({ ok: true, msg: `Không có gì thay đổi để lưu ở mục ${sectionName}${untouchedNote}` });
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
        // Refresh the mask baseline from the server so a second save of the same
        // section can still tell "untouched" from "newly typed".
        const data = await res.json().catch(() => null);
        if (data?.masked) {
          setServerMasks(prev => ({ ...prev, ...data.masked }));
          setSettings(s => ({ ...s, ...data.masked }));
        }
        setSaveResult({ ok: true, msg: `Đã lưu mục ${sectionName} thành công!${untouchedNote}` });
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

  // S3 needs Eye/EyeOff for password field

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

      {/* Home Mode */}
      <div className="modern-card p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <Monitor className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Chế độ Trang chủ (Home Mode)</h2>
        </div>

        <div>
          <label className="block text-sm font-bold text-foreground mb-3">
            Giao diện hiển thị trang chủ, header và login
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSettings(s => ({ ...s, home_mode: 'showcase' }))}
              className={`flex flex-col items-start gap-1 py-4 px-5 rounded-xl border-2 font-medium transition-all text-left ${
                settings.home_mode !== 'developer'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              <span className="font-bold">Showcase</span>
              <span className="text-xs opacity-75">Marketing page, branding &quot;AI Skill Hub&quot;</span>
            </button>
            <button
              type="button"
              onClick={() => setSettings(s => ({ ...s, home_mode: 'developer' }))}
              className={`flex flex-col items-start gap-1 py-4 px-5 rounded-xl border-2 font-medium transition-all text-left ${
                settings.home_mode === 'developer'
                  ? 'border-emerald-600 bg-emerald-600/10 text-emerald-600'
                  : 'border-border text-muted-foreground hover:border-emerald-600/50'
              }`}
            >
              <span className="font-bold">Developer</span>
              <span className="text-xs opacity-75">API reference, branding &quot;RPA.Doc&quot;</span>
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Thay đổi sẽ ảnh hưởng đến trang chủ, header và login page. Reload trang sau khi lưu.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={async () => {
              await savePartial(['home_mode'], 'Home Mode');
              // Reload page để áp dụng mode mới cho header + homepage
              setTimeout(() => window.location.reload(), 800);
            }}
            disabled={saving === 'Home Mode'}
            className="modern-button btn-primary px-6"
          >
            {saving === 'Home Mode' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Lưu Home Mode
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

      {/* Operations Monitoring */}
      <div className="modern-card p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <Activity className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Giám sát vận hành (Operations)</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">
              Ngưỡng treo — RUNNING (phút)
            </label>
            <input
              type="number"
              min={1}
              value={settings.ops_stuck_running_min ?? '10'}
              onChange={e => setSettings(s => ({ ...s, ops_stuck_running_min: e.target.value }))}
              placeholder="10"
              className="input-field"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Request RUNNING không cập nhật quá số phút này sẽ bị cảnh báo &quot;nghi treo&quot;.
            </p>
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">
              Ngưỡng treo — PENDING (phút)
            </label>
            <input
              type="number"
              min={1}
              value={settings.ops_stuck_pending_min ?? '5'}
              onChange={e => setSettings(s => ({ ...s, ops_stuck_pending_min: e.target.value }))}
              placeholder="5"
              className="input-field"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Request PENDING (chờ worker) quá số phút này sẽ bị cảnh báo.
            </p>
          </div>
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">
              Giới hạn export CSV (ngày)
            </label>
            <input
              type="number"
              min={1}
              max={366}
              value={settings.ops_export_max_days ?? '31'}
              onChange={e => setSettings(s => ({ ...s, ops_export_max_days: e.target.value }))}
              placeholder="31"
              className="input-field"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Khoảng thời gian tối đa cho 1 lần xuất CSV tổng hợp (bảo vệ hệ thống).
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={() => savePartial(['ops_stuck_running_min', 'ops_stuck_pending_min', 'ops_export_max_days'], 'Giám sát vận hành')}
            disabled={saving === 'Giám sát vận hành'}
            className="w-full sm:w-auto btn-primary modern-button py-2 px-5 text-sm"
          >
            {saving === 'Giám sát vận hành' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving === 'Giám sát vận hành' ? 'Đang lưu...' : 'Lưu cấu hình vận hành'}
          </button>
        </div>
      </div>

      {/* Bảng giá Model AIHub (CRUD) */}
      <ModelPricingSection />

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
      </div>
    </div>
  );
}
