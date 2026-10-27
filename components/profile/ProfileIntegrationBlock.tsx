'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { AuthConfigEditor } from './AuthConfigEditor';
import {
  authConfigForTest,
  testCallbackPayload,
  type ProfileIntegrationDraft,
} from '@/lib/profiles/integration-config';

interface ProfileIntegrationBlockProps {
  apiKeyId: string;
  endpointSlug: string;
  value: ProfileIntegrationDraft;
  onChange: (next: ProfileIntegrationDraft) => void;
}

export function ProfileIntegrationBlock({ apiKeyId, endpointSlug, value, onChange }: ProfileIntegrationBlockProps) {
  const [open, setOpen] = useState(false);
  const [fileUrl, setFileUrl] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [testing, setTesting] = useState<'file' | 'callback' | null>(null);
  const [feedback, setFeedback] = useState('');

  // A Query API key cannot be applied to a callback (token would end up in the URL),
  // so a shared Query auth forces the callback onto its own separate configuration.
  const sharedTypeIsQuery = value.inputSource.auth.type === 'query';
  useEffect(() => {
    if (sharedTypeIsQuery && !value.callbackUsesSeparateAuth) {
      onChange({ ...value, callbackUsesSeparateAuth: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedTypeIsQuery]);

  const test = async (kind: 'file' | 'callback') => {
    const url = kind === 'file' ? fileUrl.trim() : callbackUrl.trim();
    if (!url) {
      setFeedback(kind === 'file' ? 'Nhập URL file để kiểm thử.' : 'Nhập URL nhận thử callback.');
      return;
    }

    // File download always uses the shared system auth. The callback uses its own
    // auth only when separated; otherwise it reuses the shared system auth.
    const draftForTest = kind === 'file'
      ? value.inputSource.auth
      : value.callbackUsesSeparateAuth ? value.callback.auth : value.inputSource.auth;
    const authConfig = authConfigForTest(draftForTest);
    const body = kind === 'file'
      ? { apiKeyId, endpointSlug, url, ...(authConfig ? { authConfig } : {}) }
      : { apiKeyId, endpointSlug, callbackUrl: url, ...(authConfig ? { authConfig } : {}), payload: testCallbackPayload() };

    setTesting(kind);
    setFeedback('');
    try {
      const response = await fetch(`/api/internal/profile-endpoints/test-${kind === 'file' ? 'file-url' : 'callback'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      setFeedback(data.ok
        ? `✓ HTTP ${data.httpStatus ?? 200}${data.latencyMs ? ` · ${data.latencyMs}ms` : ''}`
        : `✗ ${data.errorSummary || data.error || `HTTP ${response.status}`}`);
    } catch {
      setFeedback('✗ Không thể kết nối tới dịch vụ kiểm thử.');
    } finally {
      setTesting(null);
    }
  };

  return <div className="border-t border-border pt-4">
    <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 text-sm font-semibold">
      <ChevronDown className={`h-4 w-4 ${open ? '' : '-rotate-90'}`} /> Cấu hình tích hợp
    </button>
    {open && <div className="mt-4 space-y-5">
      <section className="modern-card space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold">Xác thực khi gọi hệ thống đối tác</h3>
          <p className="mt-1 text-xs text-muted-foreground">DU dùng cơ chế này mỗi khi tải file từ URL đối tác hoặc gọi callback.</p>
        </div>
        <AuthConfigEditor label="Xác thực dùng chung" value={value.inputSource.auth} onChange={auth => onChange({ ...value, inputSource: { ...value.inputSource, auth } })} allowedTypes={['none', 'bearer', 'header', 'query', 'oauth2_client_credentials']} />
      </section>

      <section className="modern-card space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold">Callback trả kết quả</h3>
          <p className="mt-1 text-xs text-muted-foreground">URL callback lấy từ mỗi request. Cấu hình xác thực callback tại đây.</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={value.callbackUsesSeparateAuth} disabled={sharedTypeIsQuery} onChange={event => onChange({ ...value, callbackUsesSeparateAuth: event.target.checked })} />
          <span>
            <span className="font-medium">Dùng xác thực riêng cho callback</span>
            <span className="block text-xs text-muted-foreground">Tắt = dùng chung. Bật = cấu hình cơ chế riêng cho callback.</span>
          </span>
        </label>
        {sharedTypeIsQuery && <p className="text-xs text-amber-600 dark:text-amber-400">API Key dạng Query không dùng cho callback — hãy cấu hình xác thực callback riêng.</p>}
        {value.callbackUsesSeparateAuth
          ? <AuthConfigEditor label="Xác thực callback" value={value.callback.auth} onChange={auth => onChange({ ...value, callback: { ...value.callback, auth } })} allowedTypes={['none', 'bearer', 'header', 'oauth2_client_credentials']} />
          : <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">Callback đang dùng chung cấu hình xác thực ở trên.</p>}
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">Chế độ gửi dữ liệu</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={value.callback.payload === null} onChange={() => onChange({ ...value, callback: { ...value.callback, payload: null } })} />Chỉ trạng thái (mặc định)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={value.callback.payload === 'WITH_RESULT'} onChange={() => onChange({ ...value, callback: { ...value.callback, payload: 'WITH_RESULT' } })} />Gửi kèm kết quả</label>
          </div>
        </fieldset>
      </section>

      <section className="modern-card space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold">Kiểm thử kết nối</h3>
          <p className="mt-1 text-xs text-muted-foreground">Kiểm tra trước khi lưu — không tạo Operation.</p>
        </div>
        <div className="flex gap-2">
          <input value={fileUrl} onChange={event => setFileUrl(event.target.value)} placeholder="URL file mẫu" className="input-field flex-1 font-mono text-sm" />
          <button type="button" onClick={() => test('file')} disabled={testing !== null} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">{testing === 'file' && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />}Test tải file</button>
        </div>
        <div className="flex gap-2">
          <input value={callbackUrl} onChange={event => setCallbackUrl(event.target.value)} placeholder="URL callback" className="input-field flex-1 font-mono text-sm" />
          <button type="button" onClick={() => test('callback')} disabled={testing !== null} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">{testing === 'callback' && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />}Test callback</button>
        </div>
        {feedback && <p className="text-xs text-muted-foreground">{feedback} <span className="ml-1">Đang kiểm tra cấu hình trên form, chưa lưu.</span></p>}
      </section>
    </div>}
  </div>;
}
