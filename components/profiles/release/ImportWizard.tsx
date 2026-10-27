'use client';

import { ChangeEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

export interface ReleaseBundle {
  profile: {
    name: string;
    displayName?: string | null;
    secretRefs?: {
      fileAuth?: { needsInlineSecret?: boolean };
      callbackAuth?: { needsInlineSecret?: boolean };
    };
  };
  // `secretRefs.fileUrlAuth` may still be present in an older bundle; it is ignored
  // because the per-endpoint file-auth override was removed.
  endpoints: Array<{ endpointSlug: string }>;
  meta: { contentHash: string; sourceEnv?: string; sourceRevision?: number; version?: string | null };
  requires?: Record<string, unknown>;
}

export interface ImportAppliedResult {
  profileName: string;
  rawKey?: string;
}

interface Plan {
  planHash: string;
  targetHash: string;
  targetProfileName?: string;
  applicable: boolean;
  preconditions: Array<{ check: string; status?: string; detail?: string }>;
  endpoints: Array<{ endpointSlug: string; op: string; fields?: Array<{ field: string; op: string }> }>;
  breaking: Array<{ id: string; endpointSlug?: string; kind?: string; consequence?: string }>;
  warnings: Array<{ code: string; endpointSlug?: string; scope?: string; count?: number }>;
}

interface ProfileOption {
  id: string;
  name: string;
  displayName?: string | null;
}

type TargetMode = 'source' | 'existing' | 'new';

interface ImportWizardProps {
  defaultProfileName?: string;
  initialBundle?: ReleaseBundle;
  createNewOnly?: boolean;
  onClose: () => void;
  onApplied: (result: ImportAppliedResult) => void;
}

function isReleaseBundle(value: unknown): value is ReleaseBundle {
  const bundle = value as Partial<ReleaseBundle> | null;
  return Boolean(
    bundle
      && typeof bundle === 'object'
      && bundle.profile
      && typeof bundle.profile.name === 'string'
      && Array.isArray(bundle.endpoints)
      && bundle.meta
      && typeof bundle.meta.contentHash === 'string',
  );
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function ImportWizard({ defaultProfileName, initialBundle, createNewOnly = false, onClose, onApplied }: ImportWizardProps) {
  const [bundle, setBundle] = useState<ReleaseBundle | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [targetMode, setTargetMode] = useState<TargetMode>('new');
  const [targetProfileName, setTargetProfileName] = useState('');
  const [existingTargetName, setExistingTargetName] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  // Operator-typed values for the two inline auth prompts. Local form state only —
  // the wire keys sent to the API stay `secrets.fileAuth` / `secrets.callbackAuth`.
  const [fileAuthInput, setFileAuthInput] = useState('');
  const [callbackAuthInput, setCallbackAuthInput] = useState('');

  const [message, setMessage] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const loadProfiles = async (): Promise<ProfileOption[]> => {
    setProfilesLoading(true);
    try {
      const response = await fetch('/api/internal/apikeys');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Không thể tải danh sách Profile.');
      const loadedProfiles = Array.isArray(payload.apiKeys)
        ? payload.apiKeys.filter((profile: unknown): profile is ProfileOption => Boolean(
          profile
            && typeof profile === 'object'
            && typeof (profile as ProfileOption).id === 'string'
            && typeof (profile as ProfileOption).name === 'string',
        ))
        : [];
      setProfiles(loadedProfiles);
      return loadedProfiles;
    } finally {
      setProfilesLoading(false);
    }
  };

  const selectInitialTarget = (nextBundle: ReleaseBundle, availableProfiles: ProfileOption[]) => {
    const sourceProfile = availableProfiles.find((profile) => profile.name === nextBundle.profile.name);
    const preferredProfile = defaultProfileName
      ? availableProfiles.find((profile) => profile.name === defaultProfileName)
      : undefined;

    setPlan(null);
    setAcknowledged(false);
    if (createNewOnly) {
      setTargetMode('new');
      setTargetProfileName(nextBundle.profile.name);
      setExistingTargetName('');
      return;
    }
    if (sourceProfile) {
      setTargetMode('source');
      setTargetProfileName(sourceProfile.name);
      setExistingTargetName(sourceProfile.name);
      return;
    }
    if (preferredProfile) {
      setTargetMode('existing');
      setTargetProfileName(preferredProfile.name);
      setExistingTargetName(preferredProfile.name);
      return;
    }
    setTargetMode('new');
    setTargetProfileName(nextBundle.profile.name);
    setExistingTargetName(availableProfiles[0]?.name ?? '');
  };

  useEffect(() => {
    if (!initialBundle) return;
    setBundle(initialBundle);
    void loadProfiles()
      .then((availableProfiles) => selectInitialTarget(initialBundle, availableProfiles))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Không thể tải danh sách Profile.'));
    // The initial bundle is intentionally re-evaluated only when the caller changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBundle]);

  const requestPlan = async () => {
    if (!bundle) return;
    const selectedTargetName = targetProfileName.trim();
    if (!selectedTargetName) {
      setError('Hãy chọn hoặc nhập Profile đích.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/internal/profile-release/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle, targetProfileName: selectedTargetName }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Không thể so sánh cấu hình.');
      setPlan(payload.plan as Plan);
      setStep(2);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể so sánh cấu hình.');
    } finally {
      setLoading(false);
    }
  };

  const onFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isReleaseBundle(parsed)) throw new Error('Tệp không đúng định dạng Profile Release.');
      const availableProfiles = await loadProfiles();
      setBundle(parsed);
      setStep(1);
      selectInitialTarget(parsed, availableProfiles);
      toast.success('Đã đọc tệp cấu hình.');
    } catch (fileError) {
      setBundle(null);
      setPlan(null);
      setError(fileError instanceof Error ? fileError.message : 'Không thể đọc tệp JSON.');
    } finally {
      event.target.value = '';
    }
  };

  const chooseSourceTarget = () => {
    if (!bundle) return;
    setTargetMode('source');
    setTargetProfileName(bundle.profile.name);
    setExistingTargetName(bundle.profile.name);
    setPlan(null);
    setAcknowledged(false);
  };

  const chooseExistingTarget = (name = existingTargetName) => {
    setTargetMode('existing');
    setExistingTargetName(name);
    setTargetProfileName(name);
    setPlan(null);
    setAcknowledged(false);
  };

  const chooseNewTarget = () => {
    setTargetMode('new');
    setTargetProfileName((current) => current || bundle?.profile.name || '');
    setPlan(null);
    setAcknowledged(false);
  };

  const apply = async () => {
    if (!bundle || !plan) return;
    const selectedTargetName = targetProfileName.trim();
    if (!selectedTargetName) {
      setError('Hãy chọn hoặc nhập Profile đích.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      // Only Profile-level credentials are collected. The per-endpoint file-auth
      // override was removed, so an older bundle's `fileUrlAuth:<slug>` secret has
      // nothing left to apply to and is no longer requested.
      const secrets: Record<string, string> = {};
      if (fileAuthInput) secrets.fileAuth = fileAuthInput;
      if (callbackAuthInput) secrets.callbackAuth = callbackAuthInput;
      const response = await fetch('/api/internal/profile-release/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundle,
          plan,
          expectedPlanHash: plan.planHash,
          expectedTargetHash: plan.targetHash,
          targetProfileName: selectedTargetName,
          createMissingProfile: createNewOnly || targetMode === 'new',
          secrets: Object.keys(secrets).length ? secrets : undefined,
          message,
          ticketId: ticketId || undefined,
        }),
      });
      const payload = await response.json();
      setResult(payload as Record<string, unknown>);
      setStep(4);
      if (!response.ok || !payload.success) throw new Error(payload.error ?? 'Không thể áp dụng cấu hình.');
      onApplied({
        profileName: selectedTargetName,
        rawKey: typeof payload.rawKey === 'string' ? payload.rawKey : undefined,
      });
      toast.success('Đã áp dụng cấu hình.');
    } catch (applyError) {
      const messageValue = applyError instanceof Error ? applyError.message : 'Không thể áp dụng cấu hình.';
      setError(messageValue);
      toast.error(messageValue);
    } finally {
      setLoading(false);
    }
  };

  const profileNeedsFileAuth = bundle?.profile.secretRefs?.fileAuth?.needsInlineSecret;
  const profileNeedsCallbackAuth = bundle?.profile.secretRefs?.callbackAuth?.needsInlineSecret;
  const sourceProfileExists = Boolean(bundle && profiles.some((profile) => profile.name === bundle.profile.name));

  return (
    <section className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4" aria-label="Nhập cấu hình Profile">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold">{createNewOnly ? 'Nhập cấu hình để tạo Profile' : 'Nhập cấu hình Profile'}</h3>
          <p className="text-sm text-muted-foreground">Bước {step}/4 — {['Tải tệp và chọn đích', 'So sánh', 'Xác nhận', 'Kết quả'][step - 1]}</p>
        </div>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-muted-foreground hover:text-foreground">Đóng</button>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {step === 1 && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Tệp JSON cấu hình
            <input type="file" accept="application/json,.json" onChange={onFileSelected} className="mt-1 block w-full text-sm" />
          </label>

          {bundle && (
            <div className="space-y-3 rounded-lg border border-border bg-background p-3 text-sm">
              <div className="grid gap-1 sm:grid-cols-2">
                <p><span className="font-medium">Profile trong tệp:</span> {bundle.profile.name}</p>
                <p><span className="font-medium">Profile trên hệ thống:</span> {profilesLoading ? 'Đang kiểm tra...' : sourceProfileExists ? 'Tìm thấy' : 'Không tìm thấy'}</p>
                {bundle.profile.displayName && <p><span className="font-medium">Tên hiển thị:</span> {bundle.profile.displayName}</p>}
                <p><span className="font-medium">Phiên bản:</span> {bundle.meta.version ?? '—'}</p>
                <p><span className="font-medium">Endpoints:</span> {bundle.endpoints.length}</p>
                <p className="break-all"><span className="font-medium">Content hash:</span> {bundle.meta.contentHash}</p>
              </div>

              {createNewOnly ? (
                <label className="block space-y-1 border-t border-border pt-3">
                  <span className="font-semibold">Mã định danh Profile mới</span>
                  <input
                    value={targetProfileName}
                    onChange={(event) => {
                      setTargetMode('new');
                      setTargetProfileName(event.target.value);
                      setPlan(null);
                      setAcknowledged(false);
                    }}
                    maxLength={120}
                    className="input-field w-full font-mono"
                    placeholder={bundle.profile.name}
                  />
                  <span className="text-xs text-muted-foreground">Tên được giữ đúng chữ hoa/thường như bạn nhập; tên hiển thị sẽ lấy từ tệp JSON.</span>
                </label>
              ) : (
                <fieldset className="space-y-3 border-t border-border pt-3">
                  <legend className="font-semibold">Import vào</legend>
                  {sourceProfileExists && (
                    <label className="flex items-center gap-2">
                      <input type="radio" name="target-profile" checked={targetMode === 'source'} onChange={chooseSourceTarget} />
                      <span>Profile hiện có: <strong>{bundle.profile.name}</strong></span>
                    </label>
                  )}
                  <label className="block space-y-1">
                    <span className="flex items-center gap-2">
                      <input type="radio" name="target-profile" checked={targetMode === 'existing'} onChange={() => chooseExistingTarget()} disabled={profiles.length === 0} />
                      <span>Profile hiện có khác</span>
                    </span>
                    <select
                      value={existingTargetName}
                      onChange={(event) => chooseExistingTarget(event.target.value)}
                      disabled={profiles.length === 0}
                      className="input-field ml-6 mt-1 w-[calc(100%-1.5rem)]"
                    >
                      {profiles.length === 0 ? <option value="">Không có Profile để chọn</option> : profiles.map((profile) => (
                        <option key={profile.id} value={profile.name}>{profile.name}{profile.displayName ? ` — ${profile.displayName}` : ''}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="flex items-center gap-2">
                      <input type="radio" name="target-profile" checked={targetMode === 'new'} onChange={chooseNewTarget} />
                      <span>Tạo mới với tên</span>
                    </span>
                    <input
                      value={targetMode === 'new' ? targetProfileName : ''}
                      onFocus={chooseNewTarget}
                      onChange={(event) => {
                        setTargetMode('new');
                        setTargetProfileName(event.target.value);
                        setPlan(null);
                        setAcknowledged(false);
                      }}
                      maxLength={120}
                      className="input-field ml-6 mt-1 w-[calc(100%-1.5rem)]"
                      placeholder={bundle.profile.name}
                    />
                  </label>
                </fieldset>
              )}
              <p className="text-xs text-muted-foreground">Profile đích: <span className="font-mono">{targetProfileName || '—'}</span></p>
            </div>
          )}

          <button type="button" disabled={!bundle || loading || profilesLoading || !targetProfileName.trim()} onClick={requestPlan} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {loading ? 'Đang so sánh...' : 'So sánh với hệ thống'}
          </button>
        </div>
      )}

      {step === 2 && plan && (
        <div className="space-y-4 text-sm">
          <div className={`rounded-lg border p-3 ${plan.applicable ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
            <p className="font-semibold">{plan.applicable ? 'Có thể áp dụng' : 'Chưa thể áp dụng'}</p>
            <p className="mt-1 text-muted-foreground">Profile đích: <span className="font-medium text-foreground">{plan.targetProfileName ?? targetProfileName}</span></p>
            <p className="mt-1 text-muted-foreground">Plan hash: <span className="break-all font-mono text-xs">{plan.planHash}</span></p>
          </div>
          <div>
            <h4 className="mb-2 font-semibold">Điều kiện tiên quyết</h4>
            <ul className="space-y-1 text-muted-foreground">{plan.preconditions.length ? plan.preconditions.map((item, index) => <li key={`${item.check}-${index}`}>{item.status === 'FAIL' ? '✕' : '✓'} {item.check}{item.detail ? `: ${item.detail}` : ''}</li>) : <li>✓ Không có điều kiện chặn.</li>}</ul>
          </div>
          {plan.warnings.length > 0 && <div><h4 className="mb-2 font-semibold text-amber-700 dark:text-amber-400">Cảnh báo</h4><ul className="space-y-1 text-muted-foreground">{plan.warnings.map((item, index) => <li key={`${item.code}-${index}`}>• {item.code}{item.endpointSlug ? `: ${item.endpointSlug}` : ''}</li>)}</ul></div>}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[440px] text-left text-xs"><thead className="bg-muted/60 text-muted-foreground"><tr><th className="px-3 py-2">Endpoint</th><th className="px-3 py-2">Thao tác</th><th className="px-3 py-2">Trường thay đổi</th></tr></thead><tbody>{plan.endpoints.map((endpoint) => <tr key={endpoint.endpointSlug} className="border-t border-border"><td className="px-3 py-2 font-mono">{endpoint.endpointSlug}</td><td className="px-3 py-2">{endpoint.op}</td><td className="px-3 py-2">{endpoint.fields?.filter((field) => field.op !== 'NOOP').map((field) => field.field).join(', ') || '—'}</td></tr>)}</tbody></table>
          </div>
          <div className="flex justify-end gap-3"><button type="button" onClick={() => setStep(1)} className="rounded-lg border border-border px-3 py-2 font-semibold hover:bg-muted">Chọn đích khác</button><button type="button" disabled={!plan.applicable} onClick={() => setStep(3)} className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">Tiếp tục</button></div>
        </div>
      )}

      {step === 3 && plan && bundle && (
        <div className="space-y-4 text-sm">
          {plan.breaking.length > 0 && <label className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" /><span><strong>Đã hiểu các thay đổi có thể gián đoạn.</strong><br />{plan.breaking.map((item) => item.consequence ?? item.kind).join(' ')}</span></label>}
          {(profileNeedsFileAuth || profileNeedsCallbackAuth) && <div className="space-y-3 rounded-lg border border-border p-3"><h4 className="font-semibold">Bí mật cần cung cấp</h4>{profileNeedsFileAuth && <label className="block">File authentication<input type="password" value={fileAuthInput} onChange={(event) => setFileAuthInput(event.target.value)} className="input-field mt-1 w-full" /></label>}{profileNeedsCallbackAuth && <label className="block">Callback authentication<input type="password" value={callbackAuthInput} onChange={(event) => setCallbackAuthInput(event.target.value)} className="input-field mt-1 w-full" /></label>}</div>}
          <label className="block">Ghi chú phát hành<input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} className="input-field mt-1 w-full" /></label>
          <label className="block">Mã ticket (tuỳ chọn)<input value={ticketId} onChange={(event) => setTicketId(event.target.value)} maxLength={120} className="input-field mt-1 w-full" /></label>
          <div className="flex justify-end gap-3"><button type="button" onClick={() => setStep(2)} className="rounded-lg border border-border px-3 py-2 font-semibold hover:bg-muted">Quay lại</button><button type="button" disabled={loading || (plan.breaking.length > 0 && !acknowledged)} onClick={apply} className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">{loading ? 'Đang áp dụng...' : 'Xác nhận áp dụng'}</button></div>
        </div>
      )}

      {step === 4 && <div className="space-y-3 rounded-lg border border-border bg-background p-3 text-sm"><p className="font-semibold">{result?.success === true ? 'Áp dụng thành công' : 'Không thể áp dụng cấu hình'}</p>{result?.success === true && <p className="text-muted-foreground">Phiên bản đã áp dụng: <strong className="text-foreground">{bundle?.meta.version ?? '—'}</strong></p>}<pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{prettyJson(result)}</pre><div className="flex justify-end"><button type="button" onClick={onClose} className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground">Hoàn tất</button></div></div>}
    </section>
  );
}
