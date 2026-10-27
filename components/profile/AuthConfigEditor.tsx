'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { initOAuth2Draft, selectApiKeyAuthLocation, type AuthConfigDraft, type AuthType, type GatewayHeaderDraft } from '@/lib/profiles/integration-config';

type ApiKeyLocation = 'header' | 'query';

const AUTH_TYPES: Array<{ value: 'none' | 'bearer' | 'apiKey' | 'oauth2_client_credentials'; label: string }> = [
  { value: 'none', label: 'Không có' },
  { value: 'apiKey', label: 'API Key' },
  { value: 'bearer', label: 'Bearer' },
  { value: 'oauth2_client_credentials', label: 'OAuth2' },
];

const VAULT_PLACEHOLDER = 'vd: eda/rpa/dugate/agent-toolkit#field';

function Field({ label, value, onChange, placeholder, monospace = false, hint }: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  monospace?: boolean;
  hint?: string;
}) {
  return <label className="space-y-1 block"><span className="text-xs font-medium text-muted-foreground">{label}</span><input type="text" value={value ?? ''} placeholder={placeholder} onChange={event => onChange(event.target.value)} className={`w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary ${monospace ? 'font-mono' : ''}`} />{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</label>;
}

/**
 * Plain value field with a show/hide toggle, used for custom gateway headers such
 * as X-IBM-Client-Id. Unlike CredentialField it has no Vault|Direct row, so its input
 * lines up with the header "Tên" input on every breakpoint. Vault stays reserved
 * for the primary secrets (Bearer/API Key/OAuth2 client secret).
 */
function HeaderValueField({ label, value, vaultPath, hasSavedValue, valuePreview, onChange, onVaultPathChange }: {
  label: string;
  value?: string;
  /** Full Vault reference stored for this header value (a path, shown as-is). */
  vaultPath?: string;
  hasSavedValue?: boolean;
  valuePreview?: string;
  onChange: (value: string) => void;
  onVaultPathChange: (vaultPath: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  // A header value stored as a Vault reference shows the FULL path in a plain text
  // input (the path is permission-guarded, not the secret itself). An inline value
  // shows a masked preview placeholder; the operator types to replace it.
  if (vaultPath !== undefined) {
    return <label className="space-y-1 block">
      <span className="text-xs font-medium text-muted-foreground">{label} (Vault)</span>
      <input type="text" value={vaultPath} onChange={event => onVaultPathChange(event.target.value)} placeholder="vd: eda/rpa/dugate/agent-toolkit#field" className="input-field w-full font-mono text-sm" />
    </label>;
  }
  const placeholder = valuePreview
    ? `Đã cấu hình: ${valuePreview} — nhập để thay thế`
    : hasSavedValue ? 'Đã cấu hình — nhập để thay thế' : 'Giá trị header';
  return <label className="space-y-1 block">
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <div className="flex gap-2">
      <input type={visible ? 'text' : 'password'} value={value ?? ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="input-field flex-1 font-mono text-sm" />
      <button type="button" onClick={() => setVisible(current => !current)} className="shrink-0 rounded-lg border border-border p-2 hover:bg-muted" title={visible ? 'Ẩn giá trị' : 'Hiện giá trị'}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
    </div>
  </label>;
}

function CredentialField({ label, directValue, vaultPath, hasSavedSecret, savedPreview, onDirectChange, onVaultPathChange }: {
  label: string;
  directValue?: string;
  /** Vault reference for this credential — a permission-guarded path, not the secret. */
  vaultPath?: string;
  hasSavedSecret?: boolean;
  /** Masked, display-only preview of a stored inline value (first/last chars kept, middle masked). */
  savedPreview?: string;
  onDirectChange: (value: string) => void;
  onVaultPathChange: (value: string) => void;
}) {
  // Default to the mode that matches the stored auth value: Vault when a reference is
  // saved (the full path is shown), otherwise Direct so the masked inline preview
  // is visible immediately.
  const [mode, setMode] = useState<'vault' | 'direct'>(vaultPath ? 'vault' : 'direct');
  const [visible, setVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const switchMode = (next: 'vault' | 'direct') => {
    setMode(next);
    setFeedback(null);
    if (next === 'vault') onDirectChange('');
    else onVaultPathChange('');
  };

  const testResolve = async () => {
    const ref = vaultPath?.trim();
    if (!ref) {
      setFeedback('✗ Nhập đường dẫn Vault trước.');
      return;
    }
    setTesting(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/internal/vault/test-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref }),
      });
      const data = await response.json();
      setFeedback(data.ok ? '✓ Vault đọc được secret.' : `✗ ${data.error ?? 'Không thể đọc secret.'}`);
    } catch {
      setFeedback('✗ Không thể kết nối tới Vault.');
    } finally {
      setTesting(false);
    }
  };

  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="inline-flex overflow-hidden rounded-lg border border-border text-xs font-medium">
        <button type="button" onClick={() => switchMode('vault')} className={`px-3 py-1.5 ${mode === 'vault' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>Vault</button>
        <button type="button" onClick={() => switchMode('direct')} className={`px-3 py-1.5 ${mode === 'direct' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>Trực tiếp</button>
      </div>
    </div>
    {mode === 'vault' ? <>
      <div className="flex gap-2">
        <input value={vaultPath ?? ''} onChange={event => onVaultPathChange(event.target.value)} placeholder={VAULT_PLACEHOLDER} className="input-field flex-1 font-mono text-sm" />
        <button type="button" onClick={testResolve} disabled={testing} className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">{testing ? 'Đang kiểm tra...' : 'Kiểm tra'}</button>
      </div>
      <p className="text-xs text-muted-foreground">Vault là mặc định; chỉ xác nhận pass/fail, không hiển thị secret.</p>
    </> : <div className="flex gap-2">
      <input type={visible ? 'text' : 'password'} value={directValue ?? ''} onChange={event => onDirectChange(event.target.value)} placeholder={savedPreview ? `Đã cấu hình: ${savedPreview} — chỉ nhập để thay thế` : hasSavedSecret ? 'Đã cấu hình — chỉ nhập để thay thế' : 'Nhập secret'} className="input-field flex-1 font-mono text-sm" />
      <button type="button" onClick={() => setVisible(current => !current)} className="shrink-0 rounded-lg border border-border p-2 hover:bg-muted" title={visible ? 'Ẩn secret' : 'Hiện secret'}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
    </div>}
    {feedback && <p className={`text-xs ${feedback.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{feedback}</p>}
  </div>;
}

function isApiKeyType(type: AuthType): type is 'header' | 'query' {
  return type === 'header' || type === 'query';
}

export function AuthConfigEditor({ value, onChange, allowedTypes, label }: { value: AuthConfigDraft; onChange: (next: AuthConfigDraft) => void; allowedTypes: AuthType[]; label: string }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const update = (patch: Partial<AuthConfigDraft>) => onChange({ ...value, ...patch });
  const updateOAuth = (patch: Partial<AuthConfigDraft>) => update({ type: 'oauth2_client_credentials', ...patch });
  const gatewayHeaders = value.gateway_headers ?? [];
  const canUseQuery = allowedTypes.includes('query');
  const apiKeyLocation: ApiKeyLocation = value.type === 'query' ? 'query' : 'header';
  const isOAuth = value.type === 'oauth2_client_credentials' || value.type === 'csp_oauth2';

  const selectType = (type: 'none' | 'bearer' | 'apiKey' | 'oauth2_client_credentials') => {
    if (type === 'apiKey') {
      update({ type: canUseQuery && value.type === 'query' ? 'query' : 'header' });
      return;
    }
    // Entering OAuth2 from a non-OAuth mechanism seeds APIC-friendly defaults so the
    // advanced panel reflects real applied values instead of a hidden fallback.
    if (type === 'oauth2_client_credentials' && !isOAuth) {
      onChange(initOAuth2Draft(value));
      return;
    }
    update({ type });
  };
  const setApiKeyLocation = (location: ApiKeyLocation) => onChange(selectApiKeyAuthLocation(value, location));
  const updateHeader = (index: number, patch: Partial<GatewayHeaderDraft>) => updateOAuth({ gateway_headers: gatewayHeaders.map((header, current) => current === index ? { ...header, ...patch } : header) });

  return <div className="space-y-4 rounded-xl border border-border bg-muted/10 p-4">
    <div><p className="text-sm font-semibold">{label}</p><p className="mt-1 text-xs text-muted-foreground">{value.hasSavedSecret ? 'Đã cấu hình secret; giá trị đã lưu không được hiển thị hoặc gửi lại.' : 'Chọn cơ chế xác thực phù hợp với hệ thống nhận.'}</p></div>
    <div className="flex flex-wrap gap-1.5">{AUTH_TYPES.filter(type => type.value === 'apiKey' ? allowedTypes.includes('header') : allowedTypes.includes(type.value)).map(type => {
      const active = type.value === 'apiKey' ? isApiKeyType(value.type) : type.value === 'oauth2_client_credentials' ? isOAuth : value.type === type.value;
      return <button key={type.value} type="button" onClick={() => selectType(type.value)} className={`rounded-lg border px-3 py-1.5 text-xs ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}>{type.label}</button>;
    })}</div>

    {isApiKeyType(value.type) && <div className="space-y-3">
      <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">Đặt ở</span><select value={apiKeyLocation} onChange={event => setApiKeyLocation(event.target.value as ApiKeyLocation)} className="input-field max-w-xs"><option value="header">Header</option>{canUseQuery && <option value="query">Query</option>}</select></label>
      {apiKeyLocation === 'header' ? <><Field label="Tên header" value={value.header_name} onChange={header_name => update({ header_name })} placeholder="X-API-Key" monospace /><CredentialField label="Giá trị API Key" directValue={value.header_value} vaultPath={value.header_value_secret_ref} hasSavedSecret={value.hasSavedSecret} savedPreview={value.header_value_preview} onDirectChange={header_value => update({ header_value, header_value_secret_ref: undefined })} onVaultPathChange={header_value_secret_ref => update({ header_value_secret_ref, header_value: undefined })} /></> : <><Field label="Tên query" value={value.query_key} onChange={query_key => update({ query_key })} placeholder="api_key" monospace /><CredentialField label="Giá trị API Key" directValue={value.query_value} vaultPath={value.query_value_secret_ref} hasSavedSecret={value.hasSavedSecret} savedPreview={value.query_value_preview} onDirectChange={query_value => update({ query_value, query_value_secret_ref: undefined })} onVaultPathChange={query_value_secret_ref => update({ query_value_secret_ref, query_value: undefined })} /></>}
    </div>}

    {value.type === 'bearer' && <CredentialField label="Bearer token" directValue={value.token} vaultPath={value.token_secret_ref} hasSavedSecret={value.hasSavedSecret} savedPreview={value.token_preview} onDirectChange={token => update({ token, token_secret_ref: undefined })} onVaultPathChange={token_secret_ref => update({ token_secret_ref, token: undefined })} />}

    {isOAuth && <div className="space-y-3">
      <p className="text-xs text-muted-foreground">OAuth2 client-credentials cho token động từ hệ thống nhận. Mặc định phù hợp cổng APIC — hệ thống khác có thể xóa header X-IBM-Client-Id và đổi định dạng body/kiểu xác thực.</p>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Token URL" value={value.token_url} onChange={token_url => updateOAuth({ token_url })} placeholder="https://auth.example/token" monospace /><Field label="Client ID" value={value.client_id} onChange={client_id => updateOAuth({ client_id })} /></div>
      <CredentialField label="Client secret" directValue={value.client_secret} vaultPath={value.client_secret_ref} hasSavedSecret={value.hasSavedSecret} savedPreview={value.client_secret_preview} onDirectChange={client_secret => updateOAuth({ client_secret, client_secret_ref: undefined })} onVaultPathChange={client_secret_ref => updateOAuth({ client_secret_ref, client_secret: undefined })} />
      <details open={advancedOpen} onToggle={event => setAdvancedOpen((event.target as HTMLDetailsElement).open)} className="rounded-lg border border-border bg-background/60 p-3"><summary className="cursor-pointer text-sm font-medium">Thiết lập nâng cao</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">Định dạng gửi lấy token</span><select value={value.token_body_format ?? ''} onChange={event => updateOAuth({ token_body_format: event.target.value as 'json' | 'form' })} className="input-field"><option value="form">Form</option><option value="json">JSON</option></select><span className="text-xs text-muted-foreground">APIC dùng JSON; OAuth2 chuẩn RFC dùng Form.</span></label><label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">Gửi credentials qua</span><select value={value.token_auth_style ?? ''} onChange={event => updateOAuth({ token_auth_style: event.target.value as 'body' | 'basic' })} className="input-field"><option value="body">Trong body</option><option value="basic">HTTP Basic</option></select><span className="text-xs text-muted-foreground">APIC gửi client_id/secret trong body.</span></label><Field label="Phạm vi quyền (scope)" value={value.scope} onChange={scope => updateOAuth({ scope })} placeholder="VD: read file:download" hint="Danh sách quyền server yêu cầu, cách nhau bằng dấu cách. Bỏ trống nếu server không yêu cầu." /><Field label="Đối tượng nhận token (audience)" value={value.audience} onChange={audience => updateOAuth({ audience })} placeholder="https://api.partner.com" hint="URL hoặc ID API nhận. Đa số không dùng — bỏ trống nếu không chắc." /><label className="block space-y-1 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Đường dẫn token trong response</span><input type="text" value={value.token_response_path ?? ''} placeholder="access_token" onChange={event => updateOAuth({ token_response_path: event.target.value })} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary font-mono" /><span className="text-xs text-muted-foreground">Mặc định: access_token. VD: data.token</span></label></div></details>
      <div className="space-y-2"><div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold text-muted-foreground">Header tuỳ chỉnh (tuỳ chọn)</p><p className="text-xs text-muted-foreground">Thêm header mà API gateway yêu cầu. VD: cổng APIC cần X-IBM-Client-Id.</p></div><button type="button" onClick={() => updateOAuth({ gateway_headers: [...gatewayHeaders, { name: '', value: '' }] })} className="text-xs font-medium text-primary hover:underline">+ Thêm header</button></div>{gatewayHeaders.map((header, index) => <div key={`${index}-${header.name}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end"><Field label="Tên" value={header.name} onChange={name => updateHeader(index, { name })} placeholder="X-Client-Id" monospace /><HeaderValueField label="Giá trị" value={header.value} vaultPath={header.value_secret_ref} hasSavedValue={header.hasSavedValue} valuePreview={header.valuePreview} onChange={value => updateHeader(index, { value, value_secret_ref: undefined })} onVaultPathChange={value_secret_ref => updateHeader(index, { value_secret_ref, value: undefined })} /><button type="button" onClick={() => updateOAuth({ gateway_headers: gatewayHeaders.filter((_, current) => current !== index) })} className="self-end px-2 py-2 text-xs text-red-600 hover:underline">Xóa</button></div>)}</div>
    </div>}
  </div>;
}
