'use client';
// app/api-connections/page.tsx
// Admin UI — Quản lý External AI Service Connections

import { useState, useEffect, useCallback } from 'react';
import {
  PlugZap, Plus, Trash2, Save, Eye, EyeOff, ChevronRight,
  Loader2, CheckCircle, XCircle, FlaskConical, RefreshCw,
  Settings2, Globe, Lock, FileJson, Zap, Download
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaticField {
  key: string;
  value: string;
}

interface Connection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  endpointUrl: string;
  httpMethod: string;
  authType: string;
  authKeyHeader: string;
  authSecret: string;     // always "••••••••" from API
  promptFieldName: string;
  fileFieldName: string;
  defaultPrompt: string;
  staticFormFields: string | null;  // JSON array
  extraHeaders: string | null;      // JSON object
  responseContentPath: string | null;
  timeoutSec: number;
  state: string;
}

interface TestResult {
  success: boolean;
  httpStatus: number;
  latencyMs: number;
  responsePreview: string;
  mappedContent: string | null;
  error: string | null;
  errorStack?: string | null;
  curlCmd?: string;
}

const EMPTY_FORM: Omit<Connection, 'id'> = {
  name: '',
  slug: '',
  description: '',
  endpointUrl: '',
  httpMethod: 'POST',
  authType: 'API_KEY_HEADER',
  authKeyHeader: 'x-api-key',
  authSecret: '',
  promptFieldName: 'query',
  fileFieldName: 'files',
  defaultPrompt: '',
  staticFormFields: null,
  extraHeaders: null,
  responseContentPath: 'content',
  timeoutSec: 60,
  state: 'ENABLED',
};

// ─── Util ─────────────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return 'ext-' + str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

function parseCurl(curlText: string) {
  const text = curlText.replace(/\\\r?\n/g, ' ').trim();
  const tokens: string[] = [];
  let currentToken = '';
  let insideQuote: '"' | "'" | null = null;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (insideQuote) {
      if (char === '\\' && i + 1 < text.length && text[i+1] === insideQuote) {
        currentToken += insideQuote;
        i++;
      } else if (char === insideQuote) {
        insideQuote = null;
      } else {
        currentToken += char;
      }
    } else {
      if (char === '"' || char === "'") {
        insideQuote = char;
      } else if (char === ' ' || char === '\t') {
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = '';
        }
      } else {
        currentToken += char;
      }
    }
  }
  if (currentToken) tokens.push(currentToken);

  let url = '';
  let method = 'GET';
  let isMethodExplicit = false;
  const headers: Record<string, string> = {};
  const forms: Record<string, string> = {};
  
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.toLowerCase() === 'curl') continue;
    
    if (token === '-X' || token === '--request') {
      method = tokens[++i]?.toUpperCase() ?? 'POST';
      isMethodExplicit = true;
    } else if (token === '-H' || token === '--header') {
      const headerLine = tokens[++i];
      if (headerLine) {
        const idx = headerLine.indexOf(':');
        if (idx !== -1) {
          headers[headerLine.substring(0, idx).trim()] = headerLine.substring(idx + 1).trim();
        }
      }
    } else if (token === '-F' || token === '--form') {
      const formLine = tokens[++i];
      if (formLine) {
        const idx = formLine.indexOf('=');
        if (idx !== -1) {
           let val = formLine.substring(idx + 1).trim();
           if (val.startsWith('@')) val = val; // Ignore file uploads for static fields mapping maybe
           forms[formLine.substring(0, idx).trim()] = val;
        }
      }
      if (!isMethodExplicit) method = 'POST';
    } else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
       if (!isMethodExplicit) method = 'POST';
       i++;
    } else if (token.startsWith('http://') || token.startsWith('https://')) {
      if (!url) url = token;
    }
  }

  let authType = 'NONE';
  let authKeyHeader = 'x-api-key';
  let authSecret = '';

  const finalHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lowerK = k.toLowerCase();
    if (lowerK === 'authorization') {
      if (v.startsWith('Bearer ')) {
        authType = 'BEARER';
        authSecret = v.substring(7);
      } else {
        finalHeaders[k] = v;
      }
    } else if (lowerK === 'x-api-key' || lowerK === 'api-key') {
      authType = 'API_KEY_HEADER';
      authKeyHeader = k;
      authSecret = v;
    } else {
      finalHeaders[k] = v;
    }
  }

  return { endpointUrl: url, httpMethod: method, authType, authKeyHeader, authSecret, parsedHeaders: finalHeaders, parsedForms: forms };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ApiConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Omit<Connection, 'id'>>(EMPTY_FORM);
  const [isEditingSecret, setIsEditingSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Static fields editor state
  const [staticFields, setStaticFields] = useState<StaticField[]>([]);
  const [extraHeadersList, setExtraHeadersList] = useState<StaticField[]>([]);

  // Test modal state
  const [showTest, setShowTest] = useState(false);
  const [testPrompt, setTestPrompt] = useState('');
  const [testFiles, setTestFiles] = useState<File[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importCurlText, setImportCurlText] = useState('');

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/internal/ext-connections');
      const data = await res.json();
      if (data.success) setConnections(data.connections);
    } catch {
      console.error('Failed to load connections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  // ── Selection ───────────────────────────────────────────────────────────────
  const selectConnection = (conn: Connection) => {
    setSelectedId(conn.id);
    setForm({ ...conn });
    setStaticFields(conn.staticFormFields ? JSON.parse(conn.staticFormFields) : []);
    
    if (conn.extraHeaders) {
      try {
        const parsed = JSON.parse(conn.extraHeaders);
        setExtraHeadersList(Object.entries(parsed).map(([k, v]) => ({ key: k, value: String(v) })));
      } catch {
        setExtraHeadersList([]);
      }
    } else {
      setExtraHeadersList([]);
    }
    
    setIsEditingSecret(false);
    setSaveResult(null);
    setTestResult(null);
    setShowTest(false);
  };

  const selectNew = () => {
    setSelectedId('new');
    setForm({ ...EMPTY_FORM });
    setStaticFields([]);
    setExtraHeadersList([]);
    setIsEditingSecret(true);
    setSaveResult(null);
    setTestResult(null);
    setShowTest(false);
    setTestFiles([]);
  };

  const updateForm = (key: keyof typeof form, value: string | number | null) => {
    setSaveResult(null);
    setForm(prev => {
      const updated = { ...prev, [key]: value };
      // Auto-generate slug from name (only when creating new)
      if (key === 'name' && selectedId === 'new') {
        updated.slug = slugify(value as string);
      }
      return updated;
    });
  };

  // ── Static fields editor ────────────────────────────────────────────────────
  const addStaticField = () => setStaticFields(f => [...f, { key: '', value: '' }]);
  const removeStaticField = (i: number) => setStaticFields(f => f.filter((_, idx) => idx !== i));
  const updateStaticField = (i: number, k: 'key' | 'value', v: string) => {
    setStaticFields(f => f.map((field, idx) => idx === i ? { ...field, [k]: v } : field));
  };

  const addHeaderField = () => setExtraHeadersList(f => [...f, { key: '', value: '' }]);
  const removeHeaderField = (i: number) => setExtraHeadersList(f => f.filter((_, idx) => idx !== i));
  const updateHeaderField = (i: number, k: 'key' | 'value', v: string) => {
    setExtraHeadersList(f => f.map((field, idx) => idx === i ? { ...field, [k]: v } : field));
  };

  // ── Import cURL ─────────────────────────────────────────────────────────────
  const handleImportCurl = () => {
    if (!importCurlText.trim()) return;
    try {
      const parsed = parseCurl(importCurlText);
      setForm(prev => ({
        ...prev,
        endpointUrl: parsed.endpointUrl || prev.endpointUrl,
        httpMethod: ['POST', 'PUT'].includes(parsed.httpMethod.toUpperCase()) ? parsed.httpMethod.toUpperCase() : 'POST',
        authType: parsed.authType || prev.authType,
        authKeyHeader: parsed.authKeyHeader || prev.authKeyHeader,
        authSecret: parsed.authSecret || prev.authSecret,
      }));

      // Merge headers
      if (parsed.parsedHeaders) {
        const newArr = Object.entries(parsed.parsedHeaders).map(([k, v]) => ({ key: k, value: String(v) }));
        if (newArr.length > 0) setExtraHeadersList(newArr);
      }

      // Merge form data
      if (parsed.parsedForms) {
        const newStatic = Object.entries(parsed.parsedForms)
          .filter(([k]) => k !== form.promptFieldName && k !== form.fileFieldName)
          .map(([k, v]) => ({ key: k, value: String(v) }));
        if (newStatic.length > 0) setStaticFields(newStatic);
      }

      setShowImportModal(false);
      setImportCurlText('');
    } catch {
      alert("Lỗi khi phân tích lệnh cURL!");
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const headersObj: Record<string, string> = {};
      for (const h of extraHeadersList) {
        if (h.key.trim()) headersObj[h.key.trim()] = h.value;
      }

      const payload = {
        ...form,
        staticFormFields: staticFields.length > 0 ? JSON.stringify(staticFields) : null,
        extraHeaders: Object.keys(headersObj).length > 0 ? JSON.stringify(headersObj) : null,
      };

      const isNew = selectedId === 'new';
      const url = isNew
        ? '/api/internal/ext-connections'
        : `/api/internal/ext-connections/${selectedId}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success) {
        setSaveResult({ ok: true, msg: isNew ? 'Tạo thành công!' : 'Đã lưu thay đổi!' });
        await fetchConnections();
        if (isNew && data.connection) setSelectedId(data.connection.id);
      } else {
        setSaveResult({ ok: false, msg: data.error ?? 'Lỗi không xác định' });
      }
    } catch {
      setSaveResult({ ok: false, msg: 'Lỗi kết nối' });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!selectedId || selectedId === 'new') return;
    if (!confirm('Xóa Connection này sẽ đồng thời xóa Processor liên kết và tất cả Client Overrides. Bạn chắc chưa?')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/internal/ext-connections/${selectedId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        await fetchConnections();
        setSelectedId(null);
        setForm({ ...EMPTY_FORM });
      } else {
        alert(data.error ?? 'Lỗi khi xóa');
      }
    } catch {
      alert('Lỗi kết nối');
    } finally {
      setDeleting(false);
    }
  };

  // ── Test Connection ─────────────────────────────────────────────────────────
  const handleTest = async () => {
    if (!selectedId || selectedId === 'new') return;
    setTesting(true);
    setTestResult(null);
    try {
      const fd = new FormData();
      fd.append('prompt', testPrompt || form.defaultPrompt);
      for (const file of testFiles) {
        fd.append('files', file);
      }

      const res = await fetch(`/api/internal/ext-connections/${selectedId}/test`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, httpStatus: 0, latencyMs: 0, responsePreview: '', mappedContent: null, error: 'Lỗi kết nối nội bộ' });
    } finally {
      setTesting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="max-w-[1400px] mx-auto px-4 py-8 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-2 flex items-center gap-2">
          <PlugZap className="w-8 h-8 text-primary" />
          API Connections
        </h1>
        <p className="text-muted-foreground text-base max-w-3xl">
          Quản lý kết nối đến các AI Service bên ngoài. Mỗi Connection sẽ tự động tạo một Processor có thể sử dụng trong Pipeline.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">

        {/* ── LEFT SIDEBAR ──────────────────────────────────────────────────── */}
        <div className="w-full md:w-72 shrink-0">
          <div className="modern-card overflow-hidden flex flex-col" style={{ minHeight: '60vh' }}>
            <div className="bg-muted p-4 border-b border-border flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2">
                <PlugZap className="w-4 h-4 text-primary" />
                Connections ({connections.length})
              </h2>
              <button
                onClick={selectNew}
                className="p-1.5 hover:bg-primary/10 text-primary rounded-md transition-colors bg-background border border-border shadow-sm"
                title="Thêm Connection mới"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading ? (
                <div className="p-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : connections.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Chưa có Connection nào. Bấm <Plus className="w-3 h-3 inline" /> để tạo mới.
                </div>
              ) : (
                connections.map(conn => {
                  const isSelected = conn.id === selectedId;
                  return (
                    <button
                      key={conn.id}
                      onClick={() => selectConnection(conn)}
                      className={`w-full text-left px-3 py-3 rounded-lg flex items-center justify-between transition-all ${
                        isSelected
                          ? 'bg-primary text-primary-foreground shadow-md'
                          : 'hover:bg-muted text-foreground'
                      }`}
                    >
                      <div className="flex flex-col truncate pr-2">
                        <span className="font-semibold text-sm truncate">{conn.name}</span>
                        <span className={`text-[10px] mt-0.5 font-mono truncate ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          {conn.slug}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`w-2 h-2 rounded-full ${conn.state === 'ENABLED' ? 'bg-green-400' : 'bg-zinc-400'}`} />
                        {isSelected && <ChevronRight className="w-4 h-4 opacity-70" />}
                      </div>
                    </button>
                  );
                })
              )}

              {/* New item placeholder */}
              {selectedId === 'new' && (
                <div className="w-full text-left px-3 py-3 rounded-lg flex items-center gap-2 bg-primary text-primary-foreground shadow-md">
                  <Plus className="w-4 h-4" />
                  <span className="font-semibold text-sm">Connection mới...</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL ───────────────────────────────────────────────────── */}
        <div className="flex-1 w-full">
          {selectedId === null ? (
            <div className="flex flex-col items-center justify-center p-16 modern-card border-dashed text-center">
              <PlugZap className="w-14 h-14 text-muted-foreground mb-4 opacity-40" />
              <p className="text-lg font-medium text-muted-foreground">Chọn một Connection hoặc tạo mới để bắt đầu.</p>
            </div>
          ) : (
            <div className="space-y-5">

              <div className="flex justify-between items-center bg-muted/40 p-4 rounded-xl border border-border mt-1">
                <h2 className="text-xl font-bold">{selectedId === 'new' ? 'Tạo Connection Mới' : 'Chi Tiết Connection'}</h2>
                <button 
                  onClick={() => setShowImportModal(true)} 
                  className="flex items-center gap-2 text-sm px-3 py-1.5 bg-background text-foreground rounded-lg shadow-sm border border-border hover:bg-muted font-medium transition-colors"
                >
                  <Download className="w-4 h-4 text-primary" /> Import cURL
                </button>
              </div>

              {/* ── Save Result Notice ──────────────────────────────────────── */}
              {saveResult && (
                <div className={`flex items-center gap-3 p-4 rounded-xl border text-sm font-medium ${
                  saveResult.ok
                    ? 'bg-green-50 dark:bg-green-950/20 border-green-300 dark:border-green-800 text-green-800 dark:text-green-300'
                    : 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800 text-red-800 dark:text-red-300'
                }`}>
                  {saveResult.ok ? <CheckCircle className="w-5 h-5 shrink-0" /> : <XCircle className="w-5 h-5 shrink-0" />}
                  {saveResult.msg}
                </div>
              )}

              {/* ═══ SECTION 1: Identity ═══════════════════════════════════ */}
              <FormSection icon={<Settings2 className="w-4 h-4 text-sky-500" />} title="Identity">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Tên Connection *</label>
                    <input
                      id="conn-name"
                      className="input-field"
                      value={form.name}
                      onChange={e => updateForm('name', e.target.value)}
                      placeholder="VD: VPBank ADK Invoice Extractor"
                    />
                  </div>
                  <div>
                    <label className="form-label">Slug (tự động)</label>
                    <input
                      id="conn-slug"
                      className="input-field font-mono text-sm"
                      value={form.slug}
                      onChange={e => updateForm('slug', e.target.value)}
                      placeholder="ext-vpbank-adk"
                    />
                  </div>
                </div>
                <div>
                  <label className="form-label">Mô tả</label>
                  <input
                    className="input-field"
                    value={form.description ?? ''}
                    onChange={e => updateForm('description', e.target.value)}
                    placeholder="Mô tả ngắn về chức năng của service này"
                  />
                </div>
                <div className="flex items-center gap-4">
                  <label className="form-label mb-0">Trạng thái</label>
                  <select
                    className="input-field w-auto"
                    value={form.state}
                    onChange={e => updateForm('state', e.target.value)}
                  >
                    <option value="ENABLED">✅ ENABLED</option>
                    <option value="DISABLED">🚫 DISABLED</option>
                  </select>
                </div>
              </FormSection>

              {/* ═══ SECTION 2: Endpoint ═══════════════════════════════════ */}
              <FormSection icon={<Globe className="w-4 h-4 text-violet-500" />} title="Endpoint">
                <div>
                  <label className="form-label">URL *</label>
                  <input
                    id="conn-url"
                    className="input-field font-mono text-sm"
                    value={form.endpointUrl}
                    onChange={e => updateForm('endpointUrl', e.target.value)}
                    placeholder="https://api.vendor.com/v1/extract?stream=false"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Có thể kèm query string trực tiếp trong URL.</p>
                </div>
                <div className="flex items-center gap-4">
                  <label className="form-label mb-0">HTTP Method</label>
                  <select
                    className="input-field w-auto"
                    value={form.httpMethod}
                    onChange={e => updateForm('httpMethod', e.target.value)}
                  >
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                  </select>
                </div>
              </FormSection>

              {/* ═══ SECTION 3: Authentication ════════════════════════════ */}
              <FormSection icon={<Lock className="w-4 h-4 text-amber-500" />} title="Authentication">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="form-label">Auth Type</label>
                    <select
                      className="input-field"
                      value={form.authType}
                      onChange={e => updateForm('authType', e.target.value)}
                    >
                      <option value="API_KEY_HEADER">API Key Header</option>
                      <option value="BEARER">Bearer Token</option>
                      <option value="NONE">None</option>
                    </select>
                  </div>
                  {form.authType !== 'NONE' && (
                    <div>
                      <label className="form-label">
                        {form.authType === 'BEARER' ? 'Header (auto: Authorization)' : 'Header Name'}
                      </label>
                      <input
                        className="input-field font-mono text-sm"
                        value={form.authType === 'BEARER' ? 'Authorization' : form.authKeyHeader}
                        readOnly={form.authType === 'BEARER'}
                        onChange={e => updateForm('authKeyHeader', e.target.value)}
                        placeholder="x-api-key"
                      />
                    </div>
                  )}
                  {form.authType !== 'NONE' && (
                    <div>
                      <label className="form-label">Secret / Token *</label>
                      <div className="flex gap-2">
                        <input
                          className="input-field font-mono text-sm flex-1"
                          type={isEditingSecret ? 'text' : 'password'}
                          value={form.authSecret}
                          onChange={e => updateForm('authSecret', e.target.value)}
                          placeholder={selectedId === 'new' ? 'sk-xxx...' : ''}
                        />
                        <button
                          onClick={() => setIsEditingSecret(v => !v)}
                          className="p-2 border border-border rounded-lg hover:bg-muted transition-colors shrink-0"
                          title={isEditingSecret ? 'Ẩn' : 'Hiện'}
                        >
                          {isEditingSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {selectedId !== 'new' && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Để trống = giữ nguyên secret hiện tại.</p>
                      )}
                    </div>
                  )}
                </div>
              </FormSection>

              {/* ═══ SECTION 4: Request Format ════════════════════════════ */}
              <FormSection icon={<FileJson className="w-4 h-4 text-emerald-500" />} title="Request Format (Multipart Form)">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Prompt Field Name *</label>
                    <input
                      className="input-field font-mono text-sm"
                      value={form.promptFieldName}
                      onChange={e => updateForm('promptFieldName', e.target.value)}
                      placeholder="query"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Tên field chứa prompt trong form request.</p>
                  </div>
                  <div>
                    <label className="form-label">File Field Name *</label>
                    <input
                      className="input-field font-mono text-sm"
                      value={form.fileFieldName}
                      onChange={e => updateForm('fileFieldName', e.target.value)}
                      placeholder="files"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Tên field nhận file upload.</p>
                  </div>
                </div>

                {/* Default Prompt */}
                <div>
                  <label className="form-label">Default Prompt *</label>
                  <textarea
                    className="input-field font-mono text-xs leading-relaxed min-h-[100px]"
                    value={form.defaultPrompt}
                    onChange={e => updateForm('defaultPrompt', e.target.value)}
                    placeholder={`VD: "Trích xuất nội dung từ các file sau thành định dạng markdown như hướng dẫn."`}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Client Profile có thể override giá trị này trong trang Overrides.</p>
                </div>

                {/* Static Form Fields */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="form-label mb-0">Static Form Fields</label>
                    <button
                      onClick={addStaticField}
                      className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Thêm field
                    </button>
                  </div>
                  <div className="space-y-2">
                    {staticFields.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">Chưa có static field nào.</p>
                    )}
                    {staticFields.map((field, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input
                          className="input-field font-mono text-sm flex-1"
                          value={field.key}
                          onChange={e => updateStaticField(i, 'key', e.target.value)}
                          placeholder="field_name"
                        />
                        <input
                          className="input-field font-mono text-sm flex-[2]"
                          value={field.value}
                          onChange={e => updateStaticField(i, 'value', e.target.value)}
                          placeholder="giá trị"
                        />
                        <button
                          onClick={() => removeStaticField(i)}
                          className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Các field này cố định — client không thể thay đổi (VD: <code className="font-mono">user_id</code>, <code className="font-mono">session_id</code>).
                  </p>
                </div>
              </FormSection>

              {/* ═══ SECTION 5: Response Mapping ══════════════════════════ */}
              {/* ═══ SECTION 5: Response Mapping & Headers ══════════════ */}
              <FormSection icon={<FileJson className="w-4 h-4 text-rose-500" />} title="Response Mapping & Limits">
                <div>
                  <label className="form-label">Dot-path đến nội dung text</label>
                  <input
                    className="input-field font-mono text-sm"
                    value={form.responseContentPath ?? ''}
                    onChange={e => updateForm('responseContentPath', e.target.value)}
                    placeholder="data.response"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Đường dẫn trong response JSON để lấy nội dung text. VD: <code className="font-mono">data.response</code>, <code className="font-mono">choices.0.message.content</code>
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Extra Headers List */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="form-label mb-0">Extra Headers</label>
                      <button
                        onClick={addHeaderField}
                        className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> Thêm header
                      </button>
                    </div>
                    <div className="space-y-2">
                      {extraHeadersList.length === 0 && (
                        <p className="text-sm text-muted-foreground italic">Không có extra header.</p>
                      )}
                      {extraHeadersList.map((field, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            className="input-field font-mono text-sm flex-1"
                            value={field.key}
                            onChange={e => updateHeaderField(i, 'key', e.target.value)}
                            placeholder="Accept"
                          />
                          <input
                            className="input-field font-mono text-sm flex-[2]"
                            value={field.value}
                            onChange={e => updateHeaderField(i, 'value', e.target.value)}
                            placeholder="application/json"
                          />
                          <button
                            onClick={() => removeHeaderField(i)}
                            className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Timeout */}
                  <div>
                    <label className="form-label">Timeout (giây)</label>
                    <input
                      className="input-field"
                      type="number"
                      min={5}
                      max={300}
                      value={form.timeoutSec}
                      onChange={e => updateForm('timeoutSec', Number(e.target.value))}
                    />
                  </div>
                </div>
              </FormSection>

              {/* ═══ ACTION BUTTONS ════════════════════════════════════════ */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  id="btn-save-connection"
                  className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-50 shadow-sm"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Đang lưu...' : (selectedId === 'new' ? 'Tạo Connection' : 'Lưu thay đổi')}
                </button>

                {selectedId !== 'new' && (
                  <>
                    <button
                      onClick={() => { setShowTest(!showTest); setTestResult(null); setTestPrompt(''); setTestFiles([]); }}
                      className="flex items-center gap-2 px-5 py-2.5 border border-border hover:bg-muted text-foreground font-semibold rounded-xl transition-colors shadow-sm"
                    >
                      <FlaskConical className="w-4 h-4 text-violet-500" />
                      Test Connection
                    </button>

                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex items-center gap-2 px-4 py-2.5 border border-destructive/30 hover:bg-destructive/10 text-destructive font-semibold rounded-xl transition-colors shadow-sm ml-auto"
                    >
                      {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      Xóa
                    </button>
                  </>
                )}
              </div>

              {/* ═══ TEST PANEL ════════════════════════════════════════════ */}
              {showTest && selectedId !== 'new' && (
                <div className="modern-card border-2 border-violet-200 dark:border-violet-900/50 bg-violet-50/30 dark:bg-violet-950/10 p-5 space-y-4 animate-in slide-in-from-top-4 duration-300">
                  <h3 className="font-bold flex items-center gap-2 text-violet-800 dark:text-violet-300">
                    <FlaskConical className="w-5 h-5" /> Test Connection
                  </h3>

                  <div>
                    <label className="form-label">Prompt thử nghiệm</label>
                    <textarea
                      className="input-field font-mono text-xs min-h-[80px]"
                      value={testPrompt}
                      onChange={e => setTestPrompt(e.target.value)}
                      placeholder={form.defaultPrompt || 'Để trống = dùng default prompt'}
                    />
                  </div>

                  <div>
                    <label className="form-label">File đính kèm (tùy chọn - có thể chọn nhiều file)</label>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.docx,.txt,.jpg,.png"
                      className="text-sm text-muted-foreground"
                      onChange={e => setTestFiles(Array.from(e.target.files ?? []))}
                    />
                    {testFiles.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">Đã đính kèm {testFiles.length} file.</p>
                    )}
                  </div>

                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {testing ? 'Đang gửi request...' : 'Gửi Request'}
                  </button>

                  {testResult && (
                    <div className={`p-4 rounded-xl border text-sm space-y-3 ${
                      testResult.success
                        ? 'bg-green-50 dark:bg-green-950/20 border-green-300 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800'
                    }`}>
                      <div className="flex items-center gap-3 flex-wrap">
                        {testResult.success
                          ? <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                          : <XCircle className="w-5 h-5 text-red-600 shrink-0" />}
                        <span className="font-bold">
                          HTTP {testResult.httpStatus || '—'}
                        </span>
                        <span className="text-muted-foreground">
                          Latency: {testResult.latencyMs}ms
                        </span>
                        {testResult.error && (
                          <span className="text-red-700 dark:text-red-400 font-medium">{testResult.error}</span>
                        )}
                      </div>

                      {testResult.curlCmd && (
                        <div>
                          <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1">CURL Request:</p>
                          <pre className="bg-zinc-900 text-zinc-100 dark:bg-black/50 border border-zinc-700 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words">
                            {testResult.curlCmd}
                          </pre>
                        </div>
                      )}

                      {testResult.errorStack && (
                        <div>
                          <p className="font-semibold text-xs uppercase tracking-wide text-red-600 dark:text-red-400 mb-1">Exception Stacktrace:</p>
                          <pre className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words text-red-800 dark:text-red-300 max-h-48">
                            {testResult.errorStack}
                          </pre>
                        </div>
                      )}

                      {testResult.mappedContent && (
                        <div>
                          <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1">
                            Nội dung trích xuất ({form.responseContentPath}):
                          </p>
                          <pre className="bg-background/70 border border-border rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words max-h-96">
                            {String(testResult.mappedContent)}
                          </pre>
                        </div>
                      )}

                      {testResult.responsePreview && (
                        <div>
                          <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1">Response Raw (preview):</p>
                          <pre className="bg-background/70 border border-border rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words max-h-96 opacity-70">
                            {testResult.responsePreview}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ═══ IMPORT cURL MODAL ═════════════════════════════════════ */}
              {showImportModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                  <div className="bg-background rounded-xl border border-border shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-4 border-b border-border font-bold flex items-center gap-2">
                       <Download className="w-4 h-4 text-primary" /> Import Connection từ cURL
                    </div>
                    <div className="p-4">
                      <p className="text-sm text-muted-foreground mb-3">
                        Dán lệnh cURL vào đây để tự động điền các thông số như URL, Header, Authentication và Form Data.
                      </p>
                      <textarea 
                         value={importCurlText}
                         onChange={(e) => setImportCurlText(e.target.value)}
                         className="w-full h-64 p-3 bg-zinc-950 text-zinc-300 font-mono text-xs rounded-lg border border-border focus:ring-1 focus:ring-primary outline-none"
                         placeholder="curl -X POST https://api.vendor.com/v1/something \
  -H 'Authorization: Bearer my-token' \
  -H 'Content-Type: multipart/form-data' \
  -F 'files=@my-file.txt' \
  -F 'model=best-model'"
                      />
                    </div>
                    <div className="p-4 bg-muted/40 border-t border-border flex justify-end gap-3">
                       <button onClick={() => setShowImportModal(false)} className="px-5 py-2 text-sm text-foreground hover:bg-muted rounded-lg font-medium border border-transparent">Hủy</button>
                       <button onClick={handleImportCurl} className="px-5 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg font-semibold shadow-sm flex items-center gap-2">
                         <Download className="w-4 h-4" /> Import Ngay
                       </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ─── Sub-component: Section Card ──────────────────────────────────────────────
function FormSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="modern-card p-5 space-y-4">
      <h3 className="font-bold flex items-center gap-2 text-foreground text-sm uppercase tracking-wide">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}
