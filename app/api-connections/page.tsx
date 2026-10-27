'use client';
// app/api-connections/page.tsx
// Admin UI — Quản lý External AI Service Connections

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/lib/rbac/use-permissions';
import { ConnectorTransferPanel, ConnectorExportButton } from '@/components/connections/ConnectorTransferPanel';
import { AuditHistoryDrawer } from '@/components/audit/AuditHistoryDrawer';
import { toast } from 'sonner';
import {
  PlugZap, Plus, Trash2, Save, Eye, EyeOff, ChevronRight,
  Loader2, CheckCircle, XCircle, FlaskConical, RefreshCw,
  Settings2, Globe, Lock, FileJson, Zap, Download, History
} from 'lucide-react';
import {
  parseConnectionToForm,
  buildPayloadFromForm,
  normalizeReasoningEffort,
  REASONING_EFFORT_VALUES,
  type ConnectionMode,
  type StaticField,
} from '@/lib/endpoints/aihub-config';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  vaultSecretPath: string | null;  // Vault logical ref; when set, key is resolved from Vault
  promptFieldName: string;
  fileFieldName: string;
  defaultPrompt: string;
  staticFormFields: string | null;  // JSON array
  extraHeaders: string | null;      // JSON object
  responseContentPath: string | null;
  // Session ID Chaining
  sessionIdResponsePath: string | null;
  sessionIdFieldName: string | null;
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
  vaultSecretPath: null,
  promptFieldName: 'query',
  fileFieldName: 'files',
  defaultPrompt: '',
  staticFormFields: null,
  extraHeaders: null,
  responseContentPath: 'content',
  sessionIdResponsePath: null,
  sessionIdFieldName: null,
  timeoutSec: 300,
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

/**
 * Trích nội dung text từ trường `content` của một message.
 * - content là chuỗi → trả về nguyên chuỗi.
 * - content là mảng content-part → trả về `text` của phần `type: "text"` đầu tiên.
 */
function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>;
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
      }
    }
  }
  return '';
}

/**
 * Phân tích body `-d` của một lệnh cURL AIHub (OpenAI chat-completions shape).
 * - Trả về `null` khi body KHÔNG phải JSON hợp lệ / không phải object (coi như lệnh hỏng).
 * - Khi parse được: lấy `model` (top-level), System_Message (message role "system"),
 *   User_Message (message role "user"; nếu content là mảng → text của phần text đầu tiên),
 *   và `max_tokens` (nếu là số nguyên dương).
 */
function parseAiHubBody(raw: string): {
  model: string;
  systemMessage: string;
  userMessage: string;
  maxTokens: number;
  reasoningEffort: string;
} | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;

  const model = typeof obj.model === 'string' ? obj.model : '';

  let systemMessage = '';
  let userMessage = '';
  if (Array.isArray(obj.messages)) {
    for (const msg of obj.messages) {
      if (!msg || typeof msg !== 'object') continue;
      const m = msg as Record<string, unknown>;
      const role = typeof m.role === 'string' ? m.role : '';
      if (role === 'system' && !systemMessage) {
        systemMessage = extractMessageText(m.content);
      } else if (role === 'user' && !userMessage) {
        userMessage = extractMessageText(m.content);
      }
    }
  }

  const mt = Number(obj.max_tokens);
  const maxTokens = Number.isInteger(mt) && mt > 0 ? mt : 0;

  const reasoningEffort = normalizeReasoningEffort(obj.reasoning_effort);

  return { model, systemMessage, userMessage, maxTokens, reasoningEffort };
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
  let dataBody: string | null = null;
  let hasFormFlag = false;
  
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
      hasFormFlag = true;
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
       const dataArg = tokens[++i];
       if (dataArg !== undefined) dataBody = dataArg;
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

  // ── Mode detection ──────────────────────────────────────────────────────────
  // Priority: presence of -F flags or a multipart/form-data content-type → MULTIPART;
  // otherwise presence of Content-Type: application/json + a -d body → AIHUB.
  const contentType = Object.entries(headers)
    .find(([k]) => k.toLowerCase() === 'content-type')?.[1]
    ?.toLowerCase() ?? '';
  const isMultipart = hasFormFlag || contentType.includes('multipart/form-data');
  const isJson = !isMultipart && contentType.includes('application/json') && dataBody !== null;

  let mode: ConnectionMode = 'MULTIPART';
  let aihub: { model: string; systemMessage: string; userMessage: string; maxTokens: number; reasoningEffort: string } | null = null;
  let jsonParseFailed = false;

  if (isJson && dataBody !== null) {
    const parsedBody = parseAiHubBody(dataBody);
    if (parsedBody) {
      mode = 'AIHUB';
      aihub = parsedBody;
    } else {
      // Lệnh khai báo application/json + -d nhưng body không phải JSON hợp lệ → coi như không phân tích được.
      jsonParseFailed = true;
    }
  }

  return {
    endpointUrl: url,
    httpMethod: method,
    authType,
    authKeyHeader,
    authSecret,
    parsedHeaders: finalHeaders,
    parsedForms: forms,
    mode,
    aihub,
    jsonParseFailed,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ApiConnectionsPage() {
  const { can, loading: permissionsLoading } = usePermissions();
  const canManageConnectors = can('connector:manage');
  const router = useRouter();


  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Omit<Connection, 'id'>>(EMPTY_FORM);
  const [isEditingSecret, setIsEditingSecret] = useState(false);

  // Chế độ kết nối (mặc định MULTIPART; suy ra từ extraHeaders khi load)
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('MULTIPART');

  // Các trường cấu hình AIHub (chỉ hiển thị khi connectionMode === 'AIHUB')
  const [aihubModel, setAihubModel] = useState<string>('');
  const [aihubSystemMessage, setAihubSystemMessage] = useState<string>('');
  const [aihubUserMessage, setAihubUserMessage] = useState<string>('');
  const [aihubMaxTokens, setAihubMaxTokens] = useState<number>(4096);
  const [aihubTemperature, setAihubTemperature] = useState<number>(0);
  const [aihubReasoningEffort, setAihubReasoningEffort] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showAuditHistory, setShowAuditHistory] = useState(false);

  // Vault "Test resolve" state
  const [vaultTesting, setVaultTesting] = useState(false);
  const [vaultTest, setVaultTest] = useState<{ ok: boolean; msg: string } | null>(null);
  // Reveal the secondary (direct-in-DB) API key field. Vault path is the primary method.
  const [showDirectKey, setShowDirectKey] = useState(false);

  // Static fields editor state
  const [staticFields, setStaticFields] = useState<StaticField[]>([]);
  const [extraHeadersList, setExtraHeadersList] = useState<StaticField[]>([]);

  // Test panel state (panel is always visible for saved connectors)
  const [testPrompt, setTestPrompt] = useState('');
  const [testFiles, setTestFiles] = useState<File[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importCurlText, setImportCurlText] = useState('');

  // Connector configuration is a configurable OPS capability, not an ADMIN-only
  // page. Server routes enforce connector:manage independently.
  if (!permissionsLoading && !canManageConnectors) {
    return null;
  }

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

  useEffect(() => {
    if (permissionsLoading) return;
    if (!canManageConnectors) {
      router.push('/');
      return;
    }
    fetchConnections();
  }, [canManageConnectors, permissionsLoading, router, fetchConnections]);

  if (permissionsLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // ── Selection ───────────────────────────────────────────────────────────────
  const selectConnection = (conn: Connection) => {
    setSelectedId(conn.id);
    setForm({ ...conn });

    // Phân giải connection record → trạng thái form qua helper thuần (aihub-config).
    const parsed = parseConnectionToForm(conn);
    setStaticFields(parsed.staticFields);
    setConnectionMode(parsed.mode);
    setExtraHeadersList(parsed.extraHeadersList);

    // Prefill các trường AIHub (helper trả về giá trị mặc định khi không phải AIHUB).
    setAihubModel(parsed.aihub.model);
    setAihubSystemMessage(parsed.aihub.systemMessage);
    setAihubUserMessage(parsed.aihub.userMessage);
    setAihubMaxTokens(parsed.aihub.maxTokens);
    setAihubTemperature(parsed.aihub.temperature);
    setAihubReasoningEffort(parsed.aihub.reasoningEffort);

    setIsEditingSecret(false);
    // Reveal the direct-key field only when this connector still relies on a stored key (no Vault path).
    setShowDirectKey(!!conn.authSecret && !(conn.vaultSecretPath && conn.vaultSecretPath.trim()));
    setVaultTest(null);
    setSaveResult(null);
    setTestResult(null);
  };

  const selectNew = () => {
    setSelectedId('new');
    setForm({ ...EMPTY_FORM });
    setStaticFields([]);
    setExtraHeadersList([]);
    // Connection mới luôn khởi tạo ở chế độ MULTIPART (mặc định)
    setConnectionMode('MULTIPART');
    setAihubModel('');
    setAihubSystemMessage('');
    setAihubUserMessage('');
    setAihubMaxTokens(4096);
    setAihubTemperature(0);
    setAihubReasoningEffort('');
    setIsEditingSecret(true);
    setShowDirectKey(false);
    setVaultTest(null);
    setSaveResult(null);
    setTestResult(null);
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

      // Lệnh khai báo application/json + -d nhưng body không phân tích được →
      // báo lỗi và GIỮ NGUYÊN cấu hình hiện tại (không sửa state).
      if (parsed.jsonParseFailed) {
        alert('Lỗi khi phân tích lệnh cURL: phần dữ liệu -d không phải JSON hợp lệ.');
        return;
      }

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

      if (parsed.mode === 'AIHUB' && parsed.aihub) {
        // ── Lệnh AIHub (Content-Type: application/json + -d) → chuyển sang AIHUB ──
        setConnectionMode('AIHUB');
        setAihubModel(parsed.aihub.model);
        setAihubSystemMessage(parsed.aihub.systemMessage);
        setAihubUserMessage(parsed.aihub.userMessage);
        if (parsed.aihub.maxTokens > 0) setAihubMaxTokens(parsed.aihub.maxTokens);
        setAihubReasoningEffort(parsed.aihub.reasoningEffort);
      } else {
        // ── Lệnh Multipart (-F / multipart-form-data) → giữ hành vi hiện hữu ──
        // Merge form data
        if (parsed.parsedForms) {
          const newStatic = Object.entries(parsed.parsedForms)
            .filter(([k]) => k !== form.promptFieldName && k !== form.fileFieldName)
            .map(([k, v]) => ({ key: k, value: String(v) }));
          if (newStatic.length > 0) setStaticFields(newStatic);
        }
      }

      setShowImportModal(false);
      setImportCurlText('');
    } catch {
      alert("Lỗi khi phân tích lệnh cURL!");
    }
  };

  // ── Mode change ─────────────────────────────────────────────────────────────
  const handleModeChange = (mode: ConnectionMode) => {
    setSaveResult(null);
    setConnectionMode(mode);
  };

  // Switch key mode (mutually exclusive) — clears the other side so only ONE value is ever set.
  const switchKeyMode = (direct: boolean) => {
    setShowDirectKey(direct);
    setVaultTest(null);
    setSaveResult(null);
    if (direct) updateForm('vaultSecretPath', null);
    else updateForm('authSecret', '');
  };

  // ── Test Vault resolve (pass/fail only — never reveals the value) ─────────────
  const handleTestVaultResolve = async () => {
    const ref = form.vaultSecretPath?.trim();
    setVaultTest(null);
    if (!ref) { setVaultTest({ ok: false, msg: 'Nhập Vault Secret Path trước' }); return; }
    setVaultTesting(true);
    try {
      const res = await fetch('/api/internal/vault/test-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref }),
      });
      const data = await res.json();
      setVaultTest(data.ok
        ? { ok: true, msg: 'Resolve OK — Vault đọc được secret' }
        : { ok: false, msg: data.error ?? 'Resolve thất bại' });
    } catch {
      setVaultTest({ ok: false, msg: 'Lỗi kết nối' });
    } finally {
      setVaultTesting(false);
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      // Dựng payload theo chế độ qua helper thuần (aihub-config):
      // - AIHUB: ghi Mode_Marker + Content-Type, lưu config vào staticFormFields,
      //   sinh template JSON vào defaultPrompt.
      // - MULTIPART: giữ nguyên hành vi cũ, loại bỏ Mode_Marker khi vừa chuyển từ AIHUB.
      const payload = buildPayloadFromForm(
        {
          form,
          staticFields,
          extraHeadersList,
          aihubModel,
          aihubSystemMessage,
          aihubUserMessage,
          aihubMaxTokens,
          aihubTemperature,
          aihubReasoningEffort,
        },
        connectionMode,
      );

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
        const message = isNew ? 'Tạo thành công!' : 'Đã lưu thay đổi!';
        setSaveResult({ ok: true, msg: message });
        toast.success(message);
        await fetchConnections();
        if (isNew && data.connection) setSelectedId(data.connection.id);
      } else {
        const message = data.error ?? 'Lỗi không xác định';
        setSaveResult({ ok: false, msg: message });
        toast.error(message);
      }
    } catch {
      const message = 'Lỗi kết nối';
      setSaveResult({ ok: false, msg: message });
      toast.error(message);
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
      // Khi AIHub mode, default prompt cho test phải là user message (từ aihubUserMessage),
      // KHÔNG phải form.defaultPrompt (đó là JSON template). Multipart vẫn dùng form.defaultPrompt.
      const testDefaultPrompt = connectionMode === 'AIHUB' ? aihubUserMessage : form.defaultPrompt;
      fd.append('prompt', testPrompt || testDefaultPrompt);
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

            {/* Export/Import bundle (chuyển cấu hình giữa các môi trường) */}
            <div className="px-3 py-2 border-b border-border">
              <ConnectorTransferPanel connections={connections} onImported={fetchConnections} />
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
                    <div
                      key={conn.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectConnection(conn)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectConnection(conn); } }}
                      className={`w-full cursor-pointer text-left px-3 py-3 rounded-lg flex items-center justify-between transition-all ${
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
                        <span onClick={(e) => e.stopPropagation()} className={isSelected ? 'text-primary-foreground' : 'text-muted-foreground'}>
                          <ConnectorExportButton slug={conn.slug} />
                        </span>
                        {isSelected && <ChevronRight className="w-4 h-4 opacity-70" />}
                      </div>
                    </div>
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
                <div className="flex items-center gap-2">
                  {selectedId !== 'new' && (
                    <button type="button" onClick={() => setShowAuditHistory(true)} className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-background text-foreground rounded-lg shadow-sm border border-border hover:bg-muted font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      <History className="w-4 h-4 text-primary" aria-hidden="true" /> Lịch sử thay đổi
                    </button>
                  )}
                  <button
                  onClick={() => setShowImportModal(true)} 
                  className="flex items-center gap-2 text-sm px-3 py-1.5 bg-background text-foreground rounded-lg shadow-sm border border-border hover:bg-muted font-medium transition-colors"
                >
                  <Download className="w-4 h-4 text-primary" /> Import cURL
                </button>
                </div>
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
                    <div className="sm:col-span-3">
                      <div className="flex items-center justify-between mb-1">
                        <label className="form-label mb-0">{showDirectKey ? 'API Key' : 'Vault Secret Path'}</label>
                        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                          <button
                            type="button"
                            onClick={() => switchKeyMode(false)}
                            className={`px-3 py-1 transition-colors ${!showDirectKey ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                          >
                            Vault
                          </button>
                          <button
                            type="button"
                            onClick={() => switchKeyMode(true)}
                            className={`px-3 py-1 transition-colors ${showDirectKey ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                          >
                            API Key
                          </button>
                        </div>
                      </div>

                      {!showDirectKey ? (
                        <>
                          <div className="flex gap-2">
                            <input
                              className="input-field font-mono text-sm flex-1"
                              value={form.vaultSecretPath ?? ''}
                              onChange={e => updateForm('vaultSecretPath', e.target.value || null)}
                              placeholder="vd: eda/rpa/dugate/agent-toolkit#ext-doc-layout"
                            />
                            <button
                              type="button"
                              onClick={handleTestVaultResolve}
                              disabled={vaultTesting}
                              className="px-3 py-2 border border-border rounded-lg hover:bg-muted transition-colors shrink-0 text-sm disabled:opacity-50"
                              title="Xác minh Vault đọc được secret (không hiển thị giá trị)"
                            >
                              {vaultTesting ? 'Đang kiểm tra...' : 'Kiểm tra'}
                            </button>
                          </div>
                          {vaultTest && (
                            <p className={`text-xs mt-1 ${vaultTest.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                              {vaultTest.ok ? '✓ ' : '✗ '}{vaultTest.msg}
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex gap-2">
                            <input
                              className="input-field font-mono text-sm flex-1"
                              type={isEditingSecret ? 'text' : 'password'}
                              value={form.authSecret}
                              onChange={e => updateForm('authSecret', e.target.value)}
                              placeholder={selectedId === 'new' ? 'sk-xxx...' : '••••••••'}
                            />
                            <button
                              type="button"
                              onClick={() => setIsEditingSecret(v => !v)}
                              className="p-2 border border-border rounded-lg hover:bg-muted transition-colors shrink-0"
                              title={isEditingSecret ? 'Ẩn' : 'Hiện'}
                            >
                              {isEditingSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">For testing</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </FormSection>

              {/* ═══ SECTION 4: Request Format ════════════════════════════ */}
              <FormSection
                icon={<FileJson className="w-4 h-4 text-emerald-500" />}
                title={connectionMode === 'AIHUB' ? 'Request Format (AIHub / JSON)' : 'Request Format (Multipart Form)'}
              >
                {/* Connection_Mode_Selector */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <label className="form-label mb-0">Chế độ kết nối</label>
                  <select
                    className="input-field w-auto"
                    value={connectionMode}
                    onChange={e => handleModeChange(e.target.value as ConnectionMode)}
                  >
                    <option value="MULTIPART">Multipart / Form-Data (Agent Toolkit)</option>
                    <option value="AIHUB">AIHub / JSON (LLM Hub Chat Completions)</option>
                  </select>
                </div>

                {connectionMode === 'AIHUB' ? (
                  /* ── AIHub field set ──────────────────────────────────── */
                  <>
                    <div>
                      <label className="form-label">Model *</label>
                      <input
                        className="input-field font-mono text-sm"
                        value={aihubModel}
                        onChange={e => { setSaveResult(null); setAihubModel(e.target.value); }}
                        placeholder="VD: gemini-2.5-pro"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Tên model gửi tới LLM Hub.</p>
                    </div>

                    <div>
                      <label className="form-label">System Message</label>
                      <textarea
                        className="input-field font-mono text-xs leading-relaxed min-h-[100px] max-h-[400px] overflow-y-auto"
                        value={aihubSystemMessage}
                        onChange={e => { setSaveResult(null); setAihubSystemMessage(e.target.value); }}
                        placeholder="Chỉ dẫn hệ thống (tùy chọn). Để trống nếu không cần system message."
                      />
                      <p className="text-xs text-muted-foreground mt-1">Chỉ thêm vào messages khi không rỗng.</p>
                    </div>

                    <div>
                      <label className="form-label">User Message *</label>
                      <textarea
                        className="input-field font-mono text-xs leading-relaxed min-h-[150px] max-h-[500px] overflow-y-auto"
                        value={aihubUserMessage}
                        onChange={e => { setSaveResult(null); setAihubUserMessage(e.target.value); }}
                        placeholder={`VD: "Trích xuất bảng biểu trong tài liệu thành định dạng markdown."`}
                      />
                      <p className="text-xs text-muted-foreground mt-1">Client Profile có thể override giá trị này trong trang Overrides.</p>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <label className="form-label mb-0">max_tokens *</label>
                      <input
                        className="input-field w-auto"
                        type="number"
                        min={1}
                        step={1}
                        value={aihubMaxTokens}
                        onChange={e => { setSaveResult(null); setAihubMaxTokens(Number(e.target.value)); }}
                        placeholder="4096"
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <label className="form-label mb-0">temperature</label>
                      <input
                        className="input-field w-auto"
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={aihubTemperature}
                        onChange={e => { setSaveResult(null); setAihubTemperature(Number(e.target.value)); }}
                        placeholder="0"
                      />
                      <span className="text-xs text-muted-foreground">0 = deterministic, 1 = creative, max 2</span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <label className="form-label mb-0">reasoning_effort</label>
                      <select
                        className="input-field w-auto"
                        value={aihubReasoningEffort}
                        onChange={e => { setSaveResult(null); setAihubReasoningEffort(normalizeReasoningEffort(e.target.value)); }}
                      >
                        {REASONING_EFFORT_VALUES.map(v => (
                          <option key={v || 'none'} value={v}>{v === '' ? '(không gửi)' : v}</option>
                        ))}
                      </select>
                      <span className="text-xs text-muted-foreground">OpenAI-compatible. Chỉ dùng cho reasoning model; để <code className="font-mono">(không gửi)</code> nếu model không hỗ trợ.</span>
                    </div>

                    <div>
                      <label className="form-label">Dot-path đến nội dung text</label>
                      <input
                        className="input-field font-mono text-sm"
                        value={form.responseContentPath ?? ''}
                        onChange={e => updateForm('responseContentPath', e.target.value)}
                        placeholder="choices.0.message.content"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Đường dẫn trong response JSON để lấy nội dung text. VD: <code className="font-mono">choices.0.message.content</code>
                      </p>
                    </div>
                  </>
                ) : (
                  /* ── Multipart field set (giữ nguyên hành vi hiện hữu) ── */
                  <>
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
                        className="input-field font-mono text-xs leading-relaxed min-h-[200px] max-h-[500px] overflow-y-auto"
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
                  </>
                )}
              </FormSection>

              {/* ═══ SECTION 5: Response Mapping ══════════════════════════ */}
              {/* ═══ SECTION 5: Response Mapping & Headers ══════════════ */}
              <FormSection icon={<FileJson className="w-4 h-4 text-rose-500" />} title="Response Mapping & Limits">
                {connectionMode !== 'AIHUB' && (
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
                )}

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
                      max={600}
                      value={form.timeoutSec}
                      onChange={e => updateForm('timeoutSec', Number(e.target.value))}
                    />
                  </div>
                </div>
              </FormSection>

              {/* ═══ SECTION 6: Session ID Chaining ══════════════════════ */}
              <FormSection icon={<Zap className="w-4 h-4 text-indigo-500" />} title="Session ID Chaining">
                <div className="mb-3 p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
                  <strong>Pipeline Chaining:</strong> Cho phép step này chia sẻ <code className="font-mono bg-indigo-100 dark:bg-indigo-900 px-1 rounded">session_id</code> với các step tiếp theo trong cùng pipeline.
                  Để trống cả 2 nếu connector này không cần session chaining.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Capture Session từ Response</label>
                    <input
                      className="input-field font-mono text-sm"
                      value={form.sessionIdResponsePath ?? ''}
                      onChange={e => updateForm('sessionIdResponsePath', e.target.value || null)}
                      placeholder="result.session_id"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Dot-path đọc <code className="font-mono">session_id</code> từ response JSON của step này.
                      VD: <code className="font-mono">result.session_id</code>, <code className="font-mono">data.context_token</code>
                    </p>
                  </div>
                  <div>
                    <label className="form-label">Inject Session vào Request</label>
                    <input
                      className="input-field font-mono text-sm"
                      value={form.sessionIdFieldName ?? ''}
                      onChange={e => updateForm('sessionIdFieldName', e.target.value || null)}
                      placeholder="session_id"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Tên form field để inject <code className="font-mono">session_id</code> vào request của step này
                      (lấy từ pipelineState do step trước capture).
                    </p>
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

              {/* ═══ TEST PANEL (always visible for saved connectors) ═════ */}
              {selectedId !== 'new' && (
                <div className="modern-card border-2 border-violet-200 dark:border-violet-900/50 bg-violet-50/30 dark:bg-violet-950/10 p-5 space-y-4 animate-in slide-in-from-top-4 duration-300">
                  <h3 className="font-bold flex items-center gap-2 text-violet-800 dark:text-violet-300">
                    <FlaskConical className="w-5 h-5" /> Test Connection
                  </h3>

                  <div>
                    <label className="form-label">Prompt thử nghiệm</label>
                    <textarea
                      className="input-field font-mono text-xs min-h-[80px] max-h-[300px] overflow-y-auto"
                      value={testPrompt}
                      onChange={e => setTestPrompt(e.target.value)}
                      placeholder={(connectionMode === 'AIHUB' ? aihubUserMessage : form.defaultPrompt) || 'Để trống = dùng default prompt'}
                    />
                  </div>

                  <div>
                    <label className="form-label">File đính kèm (tùy chọn - có thể chọn nhiều file)</label>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,.heic,.heif"
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
                          <pre className="bg-zinc-900 text-zinc-100 dark:bg-black/50 border border-zinc-700 rounded-lg p-3 text-xs whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                            {testResult.curlCmd}
                          </pre>
                        </div>
                      )}

                      {testResult.errorStack && (
                        <div>
                          <p className="font-semibold text-xs uppercase tracking-wide text-red-600 dark:text-red-400 mb-1">Exception Stacktrace:</p>
                          <pre className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-3 text-xs overflow-y-auto whitespace-pre-wrap break-words text-red-800 dark:text-red-300 max-h-48">
                            {testResult.errorStack}
                          </pre>
                        </div>
                      )}

                      {testResult.mappedContent && (
                        <div>
                          <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1">
                            Nội dung trích xuất ({form.responseContentPath}):
                          </p>
                          <pre className="bg-background/70 border border-border rounded-lg p-3 text-xs overflow-y-auto whitespace-pre-wrap break-words max-h-96">
                            {String(testResult.mappedContent)}
                          </pre>
                        </div>
                      )}

                      {testResult.responsePreview && (
                        <div>
                          <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1">Response Raw (preview):</p>
                          <pre className="bg-background/70 border border-border rounded-lg p-3 text-xs overflow-y-auto whitespace-pre-wrap break-words max-h-96 opacity-70">
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
  -H 'Authorization: Bearer <token>' \
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
      <AuditHistoryDrawer
        entityType="CONNECTOR"
        entityId={selectedId && selectedId !== 'new' ? selectedId : ''}
        entityLabel={form.name || form.slug || 'Connection'}
        open={showAuditHistory && selectedId !== null && selectedId !== 'new'}
        onClose={() => setShowAuditHistory(false)}
      />
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
