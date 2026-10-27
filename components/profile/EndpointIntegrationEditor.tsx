'use client';

import type { EndpointIntegrationDraft } from '@/lib/profiles/integration-config';

interface EndpointIntegrationEditorProps {
  value: EndpointIntegrationDraft;
  onChange: (next: EndpointIntegrationDraft) => void;
  hasLegacyCspParams?: boolean;
  hasProfileCallbackAuth?: boolean;
  onCopyLegacyCspAuth?: () => void;
  onClearLegacyCspParams?: () => void;
}

/**
 * Per-endpoint integration settings that are actually persisted.
 *
 * The per-endpoint file-download credential override was removed: file-URL and callback
 * authentication is configured once for the whole Profile ("Cấu hình tích hợp"). This
 * editor therefore no longer renders an AuthConfigEditor, and the "Test tải file" button
 * moved out too — with a single stored credential it tested exactly the same thing as the
 * button in the Profile block.
 *
 * The cURL preview switches ("Kiểu đầu vào" / "Callback") live next to the cURL block in
 * app/profiles/page.tsx: they are session-only view controls, not saved configuration.
 */
export function EndpointIntegrationEditor({
  value,
  onChange,
  hasLegacyCspParams = false,
  hasProfileCallbackAuth = false,
  onCopyLegacyCspAuth,
  onClearLegacyCspParams,
}: EndpointIntegrationEditorProps) {
  return <div className="sm:col-span-2 border-t border-border pt-4">
    <section className="modern-card space-y-4 p-4">
      <div>
        <h4 className="text-sm font-semibold">Tải file từ URL</h4>
        <p className="mt-1 text-xs text-muted-foreground">Xác thực khi tải file và khi gọi callback được cấu hình một lần cho cả Profile, tại <span className="font-medium">Cấu hình tích hợp</span>.</p>
      </div>

      <label className="block max-w-md space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Chia nhỏ khi tải file lớn</span>
        <input
          type="number"
          min={1}
          max={1000}
          value={value.inputSource.defaultChunks}
          onChange={event => onChange({ ...value, inputSource: { ...value.inputSource, defaultChunks: event.target.value } })}
          className="input-field"
          placeholder="Hệ thống tự chọn"
        />
        <span className="block text-xs text-muted-foreground">Số phần song song khi tải file lớn. Bỏ trống = hệ thống tự chọn.</span>
      </label>

      {hasLegacyCspParams && (hasProfileCallbackAuth ? <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/20"><p className="font-semibold text-emerald-800 dark:text-emerald-300">✅ Hệ thống đang ưu tiên cấu hình mới (mã hoá + Vault).</p><p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">CSP parameters bên dưới có thể xoá khi xác nhận callback/file download hoạt động bình thường.</p>{onClearLegacyCspParams && <button type="button" onClick={onClearLegacyCspParams} className="mt-2 rounded-lg border border-emerald-400 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/40">Xoá CSP parameters</button>}</div> : <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20"><p className="font-semibold text-amber-900 dark:text-amber-300">🔄 Chuyển đổi xác thực (cấu hình cũ phát hiện)</p><p className="mt-1 text-xs text-amber-800 dark:text-amber-400">Endpoint này đang lưu credentials dạng plaintext trong CSP parameters. Hệ thống mới hỗ trợ mã hoá và Vault an toàn hơn.</p><ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-amber-800 dark:text-amber-400"><li>Cấu hình OAuth2 tại Xác thực hệ thống.</li><li>Lưu Profile để hệ thống ưu tiên cấu hình mới.</li><li>Xác nhận callback/file download hoạt động.</li><li>Xoá CSP parameters bên dưới.</li></ol>{onCopyLegacyCspAuth && <button type="button" onClick={onCopyLegacyCspAuth} className="mt-2 rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40">Tự động sao chép lên cấu hình mới</button>}</div>)}
    </section>
  </div>;
}
