'use client';

import { useState, useEffect, Suspense, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { usePermissions } from '@/lib/rbac/use-permissions';
import {
  Loader2, CheckCircle, Plus, Copy,
  Settings, Save, Key, ChevronRight, ChevronDown, FileText, PlugZap, Trash2, Code, FlaskConical, Zap, XCircle, GripVertical, X, Wand2, Search, ArrowLeft, ArrowUpDown, ArrowUpRight, AlertTriangle, History
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ensureStepIds,
  overrideKeyFor,
  persistedStepId,
  type ConnectionStepDraft as ConnStep,
} from '@/lib/profiles/connection-steps';
import { selectSendableTestParams } from '@/lib/profiles/test-params';
import { shouldDisplayProfileParameter } from '@/lib/profiles/parameter-visibility';
import { validateEncryptionParams } from '@/lib/crypto/validate-encryption-params';
import { resolveConnectionPrompt } from '@/lib/endpoints/aihub-config';
import { ProfileIntegrationBlock } from '@/components/profile/ProfileIntegrationBlock';
import { EndpointIntegrationEditor } from '@/components/profile/EndpointIntegrationEditor';
import { AuditHistoryDrawer } from '@/components/audit/AuditHistoryDrawer';
import { ImportWizard, type ImportAppliedResult } from '@/components/profiles/release/ImportWizard';
import {
  createEndpointIntegrationDraft,
  type EndpointInputMode,
  createProfileIntegrationDraft,
  endpointIntegrationPatch,
  integrationDraftSignature,
  profileIntegrationPatch,
  type EndpointIntegrationDraft,
  type ProfileIntegrationDraft,
} from '@/lib/profiles/integration-config';

const ReleasePanel = dynamic(
  () => import('@/components/profiles/release/ReleasePanel'),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted-foreground">Đang tải...</div> },
);

/** Options for the cURL preview's file-input switch (see the API Integration block). */
const INPUT_MODES: Array<{ value: EndpointInputMode; label: string }> = [
  { value: 'upload', label: 'Upload trực tiếp' },
  { value: 'file_url', label: 'File URL (DU tự tải)' },
  { value: 'both', label: 'Cả hai' },
];

interface ApiKey {
  id: string;
  name: string;
  displayName?: string | null;
  status: string;
  note?: string | null;
  rateLimitPerMin?: number;
  /** Read-only operational summaries served by the Profile list API. */
  enabledEndpoints?: number;
  lastActivityAt?: string | null;
  /** Presence-only auth metadata and the Profile callback payload setting. */
  fileAuthConfigured?: boolean;
  callbackAuthConfigured?: boolean;
  /** Auth type stored on server (admin-only, never contains secrets). */
  fileAuthType?: string | null;
  callbackAuthType?: string | null;
  /** Non-secret structural fields from stored auth config (admin-only). */
  fileAuthMetadata?: Record<string, unknown> | null;
  callbackAuthMetadata?: Record<string, unknown> | null;
  callbackPayload?: 'WITH_RESULT' | null;
}

type WorkspaceTab = 'core' | 'workflows';
type ProfileSortKey = 'label' | 'endpoints' | 'activity';
type SortDirection = 'asc' | 'desc';

const PROFILE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const PROFILE_PAGE_SIZE_STORAGE_KEY = 'dugate.profiles.pageSize';

function effectiveProfileLabel(profile: Pick<ApiKey, 'name' | 'displayName'>): string {
  return profile.displayName?.trim() || profile.name;
}

/** Compact Vietnamese relative time for the "Hoạt động gần nhất" column. */
function formatRelativeTime(value?: string | null): string {
  if (!value) return 'Chưa có';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'Chưa có';
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} tháng trước` : `${Math.floor(months / 12)} năm trước`;
}

function endpointDraftSignature(value: unknown): string {
  return integrationDraftSignature(value);
}

/**
 * Object-valued parameters owned by a dedicated config page (/loan-appraisal/config),
 * so the generic scalar parameter editor must skip them (it would stringify the object).
 */
// loan_product_config (cấu hình theo sản phẩm) do trang /loan-appraisal-v2/config sở hữu; ba key cũ vẫn bị ẩn để dữ liệu cũ không bị ghi đè thành "[object Object]".
const PANEL_OWNED_OBJECT_PARAMS = new Set(['loan_product_config', 'loan_check_set', 'loan_policy', 'loan_checklist_overrides']);

/** Shared confirm-dialog opener passed from the page down to endpoint cards. */
type ConfirmRequest = (
  title: string,
  message: string,
  onConfirm: () => void,
  isDestructive?: boolean,
  confirmText?: string,
) => void;

function SortableHeader({ label, sortKey, activeKey, direction, onSort }: {
  label: string;
  sortKey: ProfileSortKey;
  activeKey: ProfileSortKey;
  direction: SortDirection;
  onSort: (key: ProfileSortKey) => void;
}) {
  const isActive = activeKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 uppercase tracking-wider transition-colors ${isActive ? 'text-foreground' : 'hover:text-foreground'}`}
    >
      {label}
      <ArrowUpDown className={`w-3 h-3 ${isActive ? 'opacity-100' : 'opacity-40'}`} aria-hidden="true" />
    </button>
  );
}

export default function OverridesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/');
    }
  }, [session, status, router]);

  if (status === 'loading' || !session) {
    return null;
  }

  return (
    <Suspense fallback={<div className="p-12 text-center text-muted-foreground flex justify-center items-center"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Đang tải cấu hình Admin...</div>}>
      <OverridesContent />
    </Suspense>
  );
}

function OverridesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Affordances come from the server-resolved capability set, so an ADMIN who
  // revokes an individual OPS grant changes this UI without a re-login. Every
  // action below is independently enforced by its API route.
  const { can } = usePermissions();
  const canCreateProfile = can('profile:create');
  const canUpdateProfile = can('profile:update');
  const canDeleteProfile = can('profile:delete');
  const canRotateKey = can('profile:rotate');
  const canManageRelease = can('release:manage');
  const canManageEndpoints = can('endpoint:manage');
  const requestedClientId = searchParams?.get('client')?.trim() ?? '';
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  // Authorized Profile list. Detail requests are only issued after selection is
  // proven to exist in this RBAC-filtered list.
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [allConnectors, setAllConnectors] = useState<{ id: string; slug: string; name: string; defaultPrompt?: string; effectivePrompt?: string; systemPrompt?: string; connectionMode?: 'AIHUB' | 'MULTIPART'; defaultModel?: string; defaultReasoningEffort?: string }[]>([]);

  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [profileEndpoints, setProfileEndpoints] = useState<any[]>([]);
  const [activeServiceTab, setActiveServiceTab] = useState<WorkspaceTab>('core');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const [showAuditHistory, setShowAuditHistory] = useState(false);
  // Index table search. The detail switcher keeps its own state so typing in one
  // context never silently filters the other.
  const [profileSearch, setProfileSearch] = useState('');
  const [switcherSearch, setSwitcherSearch] = useState('');
  const [sortKey, setSortKey] = useState<ProfileSortKey>('label');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [tablePage, setTablePage] = useState(1);
  // Page size is an operator preference, so it persists per browser.
  const [pageSize, setPageSize] = useState<number>(25);
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(PROFILE_PAGE_SIZE_STORAGE_KEY));
    if (PROFILE_PAGE_SIZE_OPTIONS.includes(stored as typeof PROFILE_PAGE_SIZE_OPTIONS[number])) {
      setPageSize(stored);
    }
  }, []);
  const changePageSize = (size: number) => {
    setPageSize(size);
    setTablePage(1);
    window.localStorage.setItem(PROFILE_PAGE_SIZE_STORAGE_KEY, String(size));
  };
  const [showDisabledCatalog, setShowDisabledCatalog] = useState(false);
  const [bulkEndpointLoading, setBulkEndpointLoading] = useState(false);
  const [dirtyEndpointSlugs, setDirtyEndpointSlugs] = useState<Set<string>>(() => new Set());

  // New Profile state
  const [showAddClient, setShowAddClient] = useState(false);
  const [createProfileMode, setCreateProfileMode] = useState<'manual' | 'import'>('manual');
  const [newClientName, setNewClientName] = useState('');
  const [newClientDisplayName, setNewClientDisplayName] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const [createdRawKey, setCreatedRawKey] = useState<{ name: string; key: string } | null>(null);

  // Profile detail drafts
  const selectedClient = apiKeys.find(k => k.id === selectedClientId);
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileNote, setProfileNote] = useState('');
  const [rateLimitInput, setRateLimitInput] = useState('');
  const [savingProfileInfo, setSavingProfileInfo] = useState(false);
  const [profileIntegration, setProfileIntegration] = useState<ProfileIntegrationDraft>(() => createProfileIntegrationDraft({}));
  const profileIntegrationBaselineRef = useRef<ProfileIntegrationDraft>(createProfileIntegrationDraft({}));
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const detailRequestId = useRef(0);
  // Tracks the currently selected Profile so a save request that resolves after
  // the operator has navigated away never writes its response into another
  // Profile's draft fields. The authoritative list merge stays keyed by id.
  const selectedClientIdRef = useRef(selectedClientId);
  useEffect(() => { selectedClientIdRef.current = selectedClientId; }, [selectedClientId]);

  // Custom Confirm Dialog State
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive?: boolean;
    confirmText?: string;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => { } });

  const confirmAction = (title: string, message: string, onConfirm: () => void, isDestructive = false, confirmText = 'Xác nhận') => {
    setConfirmState({ isOpen: true, title, message, onConfirm, isDestructive, confirmText });
  };

  useEffect(() => {
    // Any Profile identity change (click, URL edit, browser back/forward) must
    // start from a clean endpoint-draft state so stale dirty slugs never leak
    // onto the newly selected Profile.
    setDirtyEndpointSlugs(new Set());
    const client = apiKeys.find((key) => key.id === selectedClientId);
    if (client) {
      setProfileDisplayName(client.displayName || '');
      setProfileNote(client.note || '');
      setRateLimitInput(String(client.rateLimitPerMin ?? 0));
      const integration = createProfileIntegrationDraft(client);
      setProfileIntegration(integration);
      profileIntegrationBaselineRef.current = integration;
      setActiveServiceTab('core');
      setShowAuditHistory(false);
      setShowDisabledCatalog(false);
      setDeleteConfirmText('');
    }
    // Drafts reset only when changing Profile, never after saving another field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId]);

  const hasProfileDraft = Boolean(canUpdateProfile && selectedClient && (
    profileDisplayName !== (selectedClient.displayName || '')
    || profileNote !== (selectedClient.note || '')
    || rateLimitInput !== String(selectedClient.rateLimitPerMin ?? 0)
    || integrationDraftSignature(profileIntegration) !== integrationDraftSignature(profileIntegrationBaselineRef.current)
  ));
  const hasEndpointDraft = canManageEndpoints && dirtyEndpointSlugs.size > 0;
  const hasUnsavedDraft = hasProfileDraft || hasEndpointDraft;

  const handleEndpointDirtyChange = useCallback((endpointSlug: string, isDirty: boolean) => {
    setDirtyEndpointSlugs(previous => {
      const next = new Set(previous);
      if (isDirty) next.add(endpointSlug);
      else next.delete(endpointSlug);
      return next.size === previous.size && [...next].every(slug => previous.has(slug)) ? previous : next;
    });
  }, []);

  useEffect(() => {
    if (!hasUnsavedDraft) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedDraft]);

  const navigateWithDirtyGuard = (action: () => void) => {
    if (!hasUnsavedDraft) {
      action();
      return;
    }
    confirmAction(
      'Bỏ thay đổi chưa lưu?',
      'Profile hoặc cấu hình endpoint đang có thay đổi chưa lưu. Tiếp tục sẽ bỏ các thay đổi này.',
      action,
      true,
      'Bỏ thay đổi',
    );
  };

  const selectProfile = (profileId: string) => {
    if (profileId === selectedClientId) return;
    navigateWithDirtyGuard(() => {
      setDirtyEndpointSlugs(new Set());
      setShowAddClient(false);
      setNewClientName('');
      setNewClientDisplayName('');
      setSelectedClientId(profileId);
      setCreatedRawKey(null);
      // push (not replace) so the browser Back button returns to the index table,
      // and scroll resets so the Profile header is visible on arrival.
      router.push(`/profiles?client=${profileId}`);
      window.scrollTo({ top: 0 });
    });
  };

  const returnToOverview = () => navigateWithDirtyGuard(() => {
    setDirtyEndpointSlugs(new Set());
    setSelectedClientId('');
    setProfileEndpoints([]);
    setAllConnectors([]);
    router.push('/profiles');
    window.scrollTo({ top: 0 });
  });

  const selectWorkspaceTab = (tab: WorkspaceTab) => {
    if (tab === activeServiceTab) return;
    const changeTab = () => {
      setDirtyEndpointSlugs(new Set());
      setActiveServiceTab(tab);
      setShowDisabledCatalog(false);
    };
    if (!hasEndpointDraft) {
      changeTab();
      return;
    }
    confirmAction(
      'Bỏ cấu hình endpoint chưa lưu?',
      'Chuyển tab sẽ bỏ các thay đổi endpoint chưa lưu. Thay đổi thông tin Profile vẫn được giữ.',
      changeTab,
      true,
      'Bỏ thay đổi endpoint',
    );
  };

  const toggleDisabledCatalog = () => {
    if (showDisabledCatalog && hasEndpointDraft) {
      toast.error('Hãy lưu hoặc bỏ thay đổi endpoint trước khi ẩn catalog.');
      return;
    }
    setShowDisabledCatalog(value => !value);
  };

  const applyBulkEndpointUpdate = async (scope: WorkspaceTab, enabled: boolean) => {
    if (!selectedClientId || bulkEndpointLoading) return;
    if (hasEndpointDraft) {
      toast.error('Hãy lưu hoặc bỏ thay đổi endpoint trước khi cập nhật hàng loạt.');
      return;
    }

    const targetId = selectedClientId;
    setBulkEndpointLoading(true);
    try {
      const response = await fetch('/api/internal/profile-endpoints/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeyId: targetId, enabled, scope }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      await Promise.all([refreshProfileEndpoints(targetId), reloadProfiles()]);
      setDirtyEndpointSlugs(new Set());
      toast.success(`Đã ${enabled ? 'bật' : 'tắt'} ${data.updated ?? 0} endpoint.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể cập nhật endpoint hàng loạt.');
    } finally {
      setBulkEndpointLoading(false);
    }
  };

  const requestBulkEndpointUpdate = (enabled: boolean) => {
    if (hasEndpointDraft) {
      toast.error('Hãy lưu hoặc bỏ thay đổi endpoint trước khi cập nhật hàng loạt.');
      return;
    }

    const scope = activeServiceTab;
    const scopeLabel = scope === 'core' ? 'Core APIs' : 'Business Workflows';
    confirmAction(
      `${enabled ? 'Bật' : 'Tắt'} tất cả endpoint?`,
      `${enabled ? 'Bật' : 'Tắt'} tất cả endpoint trong ${scopeLabel} của Profile này. Thao tác được áp dụng một lần cho toàn bộ nhóm.`,
      () => { void applyBulkEndpointUpdate(scope, enabled); },
      !enabled,
      enabled ? 'Bật tất cả' : 'Tắt tất cả',
    );
  };

  /**
   * Single save for the Profile info card. One PUT carries label, rate limit and
   * note together so a partially-saved card can no longer happen. An empty label
   * clears `displayName` back to NULL (the effective label falls back to `name`).
   */
  const handleSaveProfileInfo = async () => {
    if (!selectedClientId || savingProfileInfo) return;
    const targetId = selectedClientId;
    const rate = Number(rateLimitInput);
    if (!Number.isInteger(rate) || rate < 0) {
      toast.error('Giới hạn tốc độ phải là số nguyên >= 0');
      return;
    }
    setSavingProfileInfo(true);
    try {
      const integrationPatch = profileIntegrationPatch(profileIntegration, profileIntegrationBaselineRef.current);
      const requestBody = {
        id: targetId,
        displayName: profileDisplayName.trim() ? profileDisplayName : null,
        note: profileNote,
        rateLimitPerMin: rate,
        action: 'update',
        ...integrationPatch,
      };
      // DEBUG: Log integration patch and full request body for save diagnostics.
      // Safe in production — no secrets are logged (draft secrets are already blanked).
      console.log('[PROFILE SAVE] integrationPatch keys:', Object.keys(integrationPatch));
      console.log('[PROFILE SAVE] requestBody keys:', Object.keys(requestBody));
      if (integrationPatch.fileAuthConfig) {
        const cfg = integrationPatch.fileAuthConfig as Record<string, unknown>;
        console.log('[PROFILE SAVE] fileAuthConfig.type:', cfg?.type);
      }
      const res = await fetch('/api/internal/apikeys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || 'Lỗi khi lưu thông tin Profile');
        return;
      }
      setApiKeys(prev => prev.map(key => key.id === targetId ? { ...key, ...data.apiKey } : key));
      if (selectedClientIdRef.current === targetId) {
        setProfileDisplayName(data.apiKey.displayName || '');
        setProfileNote(data.apiKey.note || '');
        setRateLimitInput(String(data.apiKey.rateLimitPerMin ?? 0));
        // The API intentionally never returns decrypted auth config. Keep the
        // current secret-safe draft as the next baseline after a successful save.
        profileIntegrationBaselineRef.current = profileIntegration;
      }
      toast.success('Đã lưu thông tin Profile');
    } catch {
      toast.error('Lỗi kết nối');
    } finally {
      setSavingProfileInfo(false);
    }
  };

  const handleRotateKey = async () => {
    if (!selectedClientId) return;
    confirmAction(
      'Cấp lại API Key',
      'Profile sẽ nhận Key mới ngay lập tức. Mọi client đang dùng key cũ sẽ bị từ chối cho tới khi được cập nhật key mới.',
      async () => {
        try {
          const res = await fetch('/api/internal/apikeys', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: selectedClientId, action: 'rotate' })
          });
          const data = await res.json();
          if (data.success) {
            setCreatedRawKey({ name: effectiveProfileLabel(data.apiKey), key: data.rawKey });
            window.scrollTo({ top: 0, behavior: 'smooth' });
            toast.success('Đã cấp lại API Key');
          } else {
            toast.error(data.error);
          }
        } catch {
          toast.error('Lỗi kết nối');
        }
      },
      true, // Destructive meaning warning
      'Cấp lại Key'
    );
  };

  // Bulk enable/disable is intentionally unavailable: the legacy multi-request
  // flow could partially succeed and overwrite fields omitted from its payload.

  const matchesProfileQuery = (profile: ApiKey, rawQuery: string) => {
    const query = rawQuery.trim().toLocaleLowerCase('vi');
    if (!query) return true;
    return effectiveProfileLabel(profile).toLocaleLowerCase('vi').includes(query)
      || profile.name.toLocaleLowerCase('vi').includes(query)
      || (profile.note ?? '').toLocaleLowerCase('vi').includes(query);
  };

  // Index table: search + sort + pagination.
  const sortedTableProfiles = useMemo(() => {
    const filtered = apiKeys.filter(profile => matchesProfileQuery(profile, profileSearch));
    const factor = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (sortKey === 'endpoints') {
        return ((left.enabledEndpoints ?? 0) - (right.enabledEndpoints ?? 0)) * factor;
      }
      if (sortKey === 'activity') {
        const leftAt = left.lastActivityAt ? new Date(left.lastActivityAt).getTime() : 0;
        const rightAt = right.lastActivityAt ? new Date(right.lastActivityAt).getTime() : 0;
        return (leftAt - rightAt) * factor;
      }
      return effectiveProfileLabel(left).localeCompare(effectiveProfileLabel(right), 'vi') * factor;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeys, profileSearch, sortKey, sortDirection]);

  const totalTablePages = Math.max(1, Math.ceil(sortedTableProfiles.length / pageSize));
  const currentTablePage = Math.min(tablePage, totalTablePages);
  const pagedTableProfiles = useMemo(
    () => sortedTableProfiles.slice((currentTablePage - 1) * pageSize, currentTablePage * pageSize),
    [sortedTableProfiles, currentTablePage, pageSize],
  );

  // Detail switcher: independent search, no pagination (it is a jump list).
  const switcherProfiles = useMemo(
    () => apiKeys.filter(profile => matchesProfileQuery(profile, switcherSearch)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiKeys, switcherSearch],
  );

  const ariaSortFor = (key: ProfileSortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';

  const toggleSort = (key: ProfileSortKey) => {
    setTablePage(1);
    if (key === sortKey) {
      setSortDirection(direction => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    // Counts and timestamps are most useful highest/newest-first on first click.
    setSortDirection(key === 'label' ? 'asc' : 'desc');
  };

  const endpointsForTab = useMemo(() => {
    const workflowTab = activeServiceTab === 'workflows';
    return profileEndpoints
      .filter(endpoint => Boolean(endpoint.isWorkflow) === workflowTab)
      .filter(endpoint => showDisabledCatalog || endpoint.enabled)
      .sort((left, right) => Number(right.enabled) - Number(left.enabled));
  }, [activeServiceTab, profileEndpoints, showDisabledCatalog]);

  const groupedEndpoints = useMemo(() => endpointsForTab.reduce((groups: Record<string, any[]>, endpoint: any) => {
    const group = endpoint.serviceSlug || (endpoint.isWorkflow ? 'workflows' : 'other');
    if (!groups[group]) groups[group] = [];
    groups[group].push(endpoint);
    return groups;
  }, {}), [endpointsForTab]);

  const reloadProfiles = useCallback(async (signal?: AbortSignal): Promise<ApiKey[]> => {
    const response = await fetch('/api/internal/apikeys', { signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Không thể tải danh sách Profile');
    setApiKeys(data.apiKeys);
    return data.apiKeys as ApiKey[];
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError('');
    void reloadProfiles(controller.signal)
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setListError(error instanceof Error ? error.message : 'Không thể tải danh sách Profile');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadProfiles]);

  // A browser tab or history entry can be restored without remounting this
  // client component. Refresh the authoritative Profile list when it becomes
  // visible again; reloadProfiles uses cache: 'no-store'. Only rehydrate the
  // selected draft when there are no unsaved edits, so user work remains intact.
  useEffect(() => {
    let cancelled = false;
    const refreshOnReturn = () => {
      if (document.visibilityState !== 'visible') return;
      void reloadProfiles().then(profiles => {
        if (cancelled || hasUnsavedDraft) return;
        const current = profiles.find(profile => profile.id === selectedClientId);
        if (!current) return;

        setProfileDisplayName(current.displayName || '');
        setProfileNote(current.note || '');
        setRateLimitInput(String(current.rateLimitPerMin ?? 0));
        const integration = createProfileIntegrationDraft(current);
        setProfileIntegration(integration);
        profileIntegrationBaselineRef.current = integration;
      }).catch(() => {
        // Keep the current draft visible if a transient refresh fails.
      });
    };
    const onPageShow = () => refreshOnReturn();

    window.addEventListener('focus', refreshOnReturn);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshOnReturn);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [hasUnsavedDraft, reloadProfiles, selectedClientId]);

  useEffect(() => {
    if (loading) return;
    setSelectedClientId(requestedClientId);
  }, [loading, requestedClientId]);

  const normalizeConnectors = (connections: any[]) => connections.map((connection: any) => {
    let defaultModel: string | undefined;
    let defaultReasoningEffort: string | undefined;
    try {
      const fields = connection.staticFormFields ? JSON.parse(connection.staticFormFields) : null;
      if (Array.isArray(fields)) {
        const model = fields.find((field: any) => field?.key === 'model')?.value;
        if (typeof model === 'string' && model.trim()) defaultModel = model.trim();
        const re = fields.find((field: any) => field?.key === 'reasoning_effort')?.value;
        if (typeof re === 'string' && re.trim()) defaultReasoningEffort = re.trim();
      } else if (fields && typeof fields === 'object') {
        if (typeof fields.model === 'string' && fields.model.trim()) defaultModel = fields.model.trim();
        if (typeof fields.reasoning_effort === 'string' && fields.reasoning_effort.trim()) defaultReasoningEffort = fields.reasoning_effort.trim();
      }
    } catch { /* malformed connector metadata: no default labels */ }
    // Prefer the server-resolved prompt (the list API computes it so non-admin
    // clients never receive `extraHeaders`). Fall back to client-side resolution
    // for backward compatibility. For AIHub connectors the raw `defaultPrompt` is
    // only the JSON chat-body wrapper; the real editable prompt (what a
    // promptOverride replaces at runtime) is the `user_prompt` static field.
    const resolved = connection.effectivePrompt !== undefined || connection.connectionMode !== undefined
      ? {
          mode: (connection.connectionMode ?? 'MULTIPART') as 'AIHUB' | 'MULTIPART',
          effectivePrompt: connection.effectivePrompt ?? connection.defaultPrompt ?? '',
          systemPrompt: connection.systemPrompt ?? '',
        }
      : resolveConnectionPrompt({
          extraHeaders: connection.extraHeaders ?? null,
          staticFormFields: connection.staticFormFields ?? null,
          defaultPrompt: connection.defaultPrompt ?? null,
        });
    return {
      ...connection,
      defaultModel,
      defaultReasoningEffort,
      connectionMode: resolved.mode,
      effectivePrompt: resolved.effectivePrompt,
      systemPrompt: resolved.systemPrompt,
    };
  });

  const refreshProfileEndpoints = async (clientId: string) => {
    const response = await fetch(`/api/internal/profile-endpoints?apiKeyId=${clientId}`);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.endpoints)) {
      throw new Error(data.error || 'Không thể tải cấu hình Profile');
    }
    setProfileEndpoints(data.endpoints);
  };

  useEffect(() => {
    if (!selectedClient) {
      detailRequestId.current += 1;
      setProfileEndpoints([]);
      setAllConnectors([]);
      setDetailError('');
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    const requestId = ++detailRequestId.current;
    setDetailLoading(true);
    setDetailError('');

    Promise.all([
      fetch(`/api/internal/profile-endpoints?apiKeyId=${selectedClient.id}`, { signal: controller.signal }),
      fetch('/api/internal/ext-connections', { signal: controller.signal }),
    ]).then(async ([endpointResponse, connectorResponse]) => {
      const [endpointData, connectorData] = await Promise.all([endpointResponse.json(), connectorResponse.json()]);
      if (!endpointResponse.ok || !Array.isArray(endpointData.endpoints)) {
        throw new Error(endpointData.error || 'Không thể tải cấu hình Profile');
      }
      if (!connectorResponse.ok || !Array.isArray(connectorData.connections)) {
        throw new Error(connectorData.error || 'Không thể tải danh sách Connector');
      }
      if (requestId !== detailRequestId.current) return;
      setProfileEndpoints(endpointData.endpoints);
      setAllConnectors(normalizeConnectors(connectorData.connections));
    }).catch(error => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (requestId === detailRequestId.current) {
        setDetailError(error instanceof Error ? error.message : 'Không thể tải chi tiết Profile');
      }
    }).finally(() => {
      if (requestId === detailRequestId.current) setDetailLoading(false);
    });

    return () => controller.abort();
    // selectedClientId is the stable identity; narrow Profile saves must not refetch detail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, detailReloadToken]);

  // Handle Client Creation
  const handleCreateClient = async () => {
    if (!newClientName.trim() || creatingClient) return;
    setCreatingClient(true);
    try {
      const payload: { name: string; displayName?: string } = { name: newClientName.trim() };
      if (newClientDisplayName.trim()) payload.displayName = newClientDisplayName.trim();
      const res = await fetch('/api/internal/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setApiKeys(prev => [data.apiKey, ...prev]);
        setCreatedRawKey({ name: effectiveProfileLabel(data.apiKey), key: data.rawKey });
        setShowAddClient(false);
        setNewClientName('');
        setNewClientDisplayName('');
        toast.success('Đã tạo Profile và API Key thành công!');
      } else {
        toast.error(data.error || 'Lỗi khi tạo Profile');
      }
    } catch {
      toast.error('Lỗi khi tạo API Key');
    } finally {
      setCreatingClient(false);
    }
  };

  const handleReleaseProfileChanged = useCallback(async ({ profileName, rawKey }: ImportAppliedResult) => {
    try {
      const profiles = await reloadProfiles();
      const changedProfile = profiles.find((profile) => profile.name === profileName);
      if (!changedProfile) return;

      setDetailReloadToken((value) => value + 1);
      if (rawKey) setCreatedRawKey({ name: effectiveProfileLabel(changedProfile), key: rawKey });
      if (changedProfile.id !== selectedClientId) {
        setDirtyEndpointSlugs(new Set());
        setSelectedClientId(changedProfile.id);
        router.push(`/profiles?client=${changedProfile.id}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể làm mới Profile sau khi áp dụng cấu hình.');
    }
  }, [reloadProfiles, router, selectedClientId]);

  // Handle Delete Client
  const handleDeleteClient = async (id: string) => {
    confirmAction(
      'Xóa Profile vĩnh viễn',
      'Bạn có chắc chắn muốn xóa vĩnh viễn Profile này? Dữ liệu và chìa khóa xác thực sẽ bị xóa không thể khôi phục.',
      async () => {
        try {
          const res = await fetch(`/api/internal/apikeys?id=${id}`, {
            method: 'DELETE',
          });
          if (res.ok) {
            setApiKeys(prev => prev.filter(k => k.id !== id));
            if (selectedClientId === id) {
              setSelectedClientId('');
              // The deleted Profile must not stay in history as a reachable URL.
              router.replace('/profiles');
              window.scrollTo({ top: 0 });
            }
            toast.success('Đã xoá Profile');
          } else {
            const data = await res.json();
            toast.error(data.error || 'Failed to delete Profile');
          }
        } catch (e) {
          toast.error('Error deleting Profile');
        }
      },
      true,
      'Xóa Profile'
    );
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground font-medium">Đang tải dữ liệu...</span>
      </div>
    );
  }

  if (listError) {
    return (
      <main className="max-w-[1400px] mx-auto px-6 py-10">
        <div className="modern-card border-red-200 dark:border-red-900 p-10 text-center">
          <XCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold">Không thể tải danh sách Profile</h1>
          <p className="text-sm text-muted-foreground mt-2">{listError}</p>
          <button onClick={() => window.location.reload()} className="mt-5 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold">Thử lại</button>
        </div>
      </main>
    );
  }

  if (!requestedClientId) {
    return (
      <main className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2"><Settings className="w-8 h-8 text-primary" /> Profile Management</h1>
            <p className="text-muted-foreground mt-2">Quản lý Profile, nhãn vận hành và chính sách xử lý tài liệu trên một workspace.</p>
          </div>
          {canCreateProfile && (
            <button onClick={() => { setCreateProfileMode('manual'); setShowAddClient(true); }} className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold flex items-center gap-2 shadow-sm">
              <Plus className="w-4 h-4" /> Tạo Profile
            </button>
          )}
        </div>

        {showAddClient && canCreateProfile && (
          <div className="modern-card border-2 border-indigo-500/30 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">Tạo Profile và cấp API Key</h2>
                <p className="text-sm text-muted-foreground">Tạo Profile trống hoặc nhập toàn bộ cấu hình từ tệp JSON.</p>
              </div>
              <button onClick={() => { setShowAddClient(false); setCreateProfileMode('manual'); setNewClientName(''); setNewClientDisplayName(''); }} className="p-2 rounded-lg hover:bg-muted" aria-label="Đóng"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex gap-2 border-b border-border" role="tablist" aria-label="Cách tạo Profile">
              <button type="button" role="tab" aria-selected={createProfileMode === 'manual'} onClick={() => setCreateProfileMode('manual')} className={`px-3 py-2 text-sm font-semibold border-b-2 ${createProfileMode === 'manual' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>Tạo mới</button>
              <button type="button" role="tab" aria-selected={createProfileMode === 'import'} onClick={() => setCreateProfileMode('import')} className={`px-3 py-2 text-sm font-semibold border-b-2 ${createProfileMode === 'import' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>Nhập từ tệp JSON</button>
            </div>
            {createProfileMode === 'manual' ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <label className="space-y-1.5">
                    <span className="text-sm font-semibold">Mã định danh <span className="text-red-500">*</span></span>
                    <input autoFocus maxLength={120} value={newClientName} onChange={event => setNewClientName(event.target.value)} className="input-field" placeholder="VD: crm-credit-production" />
                    <span className="text-xs text-muted-foreground">Bắt buộc. Không thể thay đổi sau khi tạo.</span>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-sm font-semibold">Tên Profile</span>
                    <input maxLength={120} value={newClientDisplayName} onChange={event => setNewClientDisplayName(event.target.value)} className="input-field" placeholder="VD: CRM Khối Tín dụng" />
                    <span className="text-xs text-muted-foreground">Không bắt buộc. Để trống sẽ hiển thị theo mã định danh.</span>
                  </label>
                </div>
                <div className="rounded-lg border border-dashed p-3 text-sm">
                  Preview: <strong>{newClientDisplayName.trim() || newClientName.trim() || 'Tên Profile'}</strong>
                  {newClientName.trim() && <span className="text-muted-foreground ml-2 font-mono">({newClientName.trim()})</span>}
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => { setShowAddClient(false); setNewClientName(''); setNewClientDisplayName(''); }} className="px-4 py-2 rounded-lg border border-border hover:bg-muted">Hủy</button>
                  <button onClick={handleCreateClient} disabled={!newClientName.trim() || creatingClient} className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-50 flex items-center gap-2">
                    {creatingClient && <Loader2 className="w-4 h-4 animate-spin" />} Tạo và cấp Key
                  </button>
                </div>
              </>
            ) : (
              <ImportWizard
                createNewOnly
                onClose={() => { setShowAddClient(false); setCreateProfileMode('manual'); }}
                onApplied={handleReleaseProfileChanged}
              />
            )}
          </div>
        )}

        {createdRawKey && (
          <div className="modern-card border-green-500 bg-green-50 dark:bg-green-950/20 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
              <div className="space-y-3 flex-1">
                <div><h3 className="font-bold text-green-900 dark:text-green-100">API Key mới: {createdRawKey.name}</h3><p className="text-sm text-green-700 dark:text-green-400">Key chỉ hiển thị một lần. Hãy sao chép và lưu tại nơi an toàn.</p></div>
                <div className="flex gap-2"><code className="bg-background border px-4 py-2.5 rounded-lg flex-1 overflow-x-auto">x-api-key: {createdRawKey.key}</code><button onClick={() => { navigator.clipboard.writeText(createdRawKey.key); toast.success('Đã copy!'); }} className="p-2.5 rounded-lg bg-green-200/60" aria-label="Copy API key"><Copy className="w-5 h-5" /></button></div>
              </div>
            </div>
          </div>
        )}

        <div className="modern-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-xl">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              {/* paddingLeft is inline on purpose: `.input-field` lives in the same
                  Tailwind utilities layer and is emitted after `pl-*`, so its `px-4`
                  would otherwise win and the text would sit under the icon. */}
              <input
                value={profileSearch}
                onChange={event => { setProfileSearch(event.target.value); setTablePage(1); }}
                className="input-field"
                style={{ paddingLeft: '2.75rem' }}
                placeholder="Tìm Profile..."
                aria-label="Tìm Profile theo tên, mã định danh hoặc ghi chú"
              />
            </div>
            <span className="text-sm text-muted-foreground shrink-0">
              {sortedTableProfiles.length}/{apiKeys.length} Profile
            </span>
          </div>

          {apiKeys.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Key className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>{canCreateProfile ? 'Hệ thống chưa có Profile nào. Hãy tạo Profile đầu tiên.' : 'Bạn chưa được phân quyền cho Profile nào. Liên hệ quản trị viên để được cấp quyền.'}</p>
            </div>
          ) : sortedTableProfiles.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>Không tìm thấy Profile phù hợp.</p>
              <button onClick={() => setProfileSearch('')} className="mt-3 text-primary font-semibold">Xóa bộ lọc</button>
            </div>
          ) : (
            <>
              <table className="w-full text-left">
                <thead className="bg-muted/50 border-b border-border">
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                    {/* aria-sort belongs on the column header itself, not on a nested button. */}
                    <th scope="col" className="px-4 py-3 font-semibold" aria-sort={ariaSortFor('label')}>
                      <SortableHeader label="Tên Profile" sortKey="label" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">Mã định danh</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Ghi chú</th>
                    <th scope="col" className="px-4 py-3 font-semibold w-[150px]" aria-sort={ariaSortFor('endpoints')}>
                      <SortableHeader label="Endpoint đang bật" sortKey="endpoints" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold w-[170px]" aria-sort={ariaSortFor('activity')}>
                      <SortableHeader label="Hoạt động gần nhất" sortKey="activity" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pagedTableProfiles.map(profile => (
                    <tr
                      key={profile.id}
                      onClick={() => selectProfile(profile.id)}
                      className="hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3 max-w-0">
                        <div className="flex items-center gap-2">
                          {/* A real button keeps the row reachable by keyboard and
                              announced as interactive; the row onClick is only a
                              mouse convenience on top of it. */}
                          <button
                            type="button"
                            onClick={event => { event.stopPropagation(); selectProfile(profile.id); }}
                            className="font-semibold truncate text-left rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {effectiveProfileLabel(profile)}
                          </button>
                          {/* Status is surfaced only when it deviates from the healthy default. */}
                          {profile.status !== 'active' && (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 shrink-0">
                              {profile.status}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate">{profile.id.split('-')[0]}••••</p>
                      </td>
                      <td className="px-4 py-3 max-w-0">
                        <p className="text-sm font-mono truncate">{profile.name}</p>
                      </td>
                      <td className="px-4 py-3 max-w-0">
                        <p className="text-sm text-muted-foreground truncate" title={profile.note ?? ''}>
                          {profile.note?.trim() || '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">{profile.enabledEndpoints ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {formatRelativeTime(profile.lastActivityAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-t border-border">
                <div className="flex items-center gap-3">
                  <label htmlFor="profile-page-size" className="text-sm text-muted-foreground">Số dòng</label>
                  <select
                    id="profile-page-size"
                    value={pageSize}
                    onChange={event => changePageSize(Number(event.target.value))}
                    className="rounded-lg border border-border bg-background py-1.5 pl-2 pr-7 text-sm"
                  >
                    {PROFILE_PAGE_SIZE_OPTIONS.map(size => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                  <span className="text-sm text-muted-foreground">
                    {sortedTableProfiles.length === 0
                      ? '0'
                      : `${(currentTablePage - 1) * pageSize + 1}–${Math.min(currentTablePage * pageSize, sortedTableProfiles.length)}`} / {sortedTableProfiles.length}
                  </span>
                </div>
                {totalTablePages > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground mr-1">
                      Trang {currentTablePage}/{totalTablePages}
                    </span>
                    <button
                      onClick={() => setTablePage(page => Math.max(1, page - 1))}
                      disabled={currentTablePage <= 1}
                      className="px-3 py-1.5 rounded-lg border border-border text-sm font-semibold disabled:opacity-40 hover:bg-muted"
                    >
                      Trước
                    </button>
                    <button
                      onClick={() => setTablePage(page => Math.min(totalTablePages, page + 1))}
                      disabled={currentTablePage >= totalTablePages}
                      className="px-3 py-1.5 rounded-lg border border-border text-sm font-semibold disabled:opacity-40 hover:bg-muted"
                    >
                      Sau
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    );
  }

  // Resolve straight from the URL. Deriving this from `selectedClientId` state made
  // the unauthorized screen flash for one render on every navigation, because the
  // effect that copies `?client=` into state runs after the first paint.
  const requestedClient = apiKeys.find((key) => key.id === requestedClientId);

  if (!requestedClient) {
    return (
      <main className="max-w-[1000px] mx-auto px-6 py-12">
        <div className="modern-card border-amber-300 dark:border-amber-800 p-10 text-center">
          <XCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold">Profile không tồn tại hoặc bạn không được phân quyền</h1>
          <p className="text-sm text-muted-foreground mt-2 font-mono">{requestedClientId}</p>
          <button onClick={returnToOverview} className="mt-5 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold flex items-center gap-2 mx-auto"><ArrowLeft className="w-4 h-4" /> Về danh sách Profile</button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start gap-3">
        <button onClick={returnToOverview} className="mt-1 p-2 rounded-lg border border-border hover:bg-muted" aria-label="Về danh sách Profile"><ArrowLeft className="w-4 h-4" /></button>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-2 flex items-center gap-2">
            <Settings className="w-8 h-8 text-primary" />
            Profile Management
          </h1>
          <p className="text-muted-foreground text-base max-w-3xl">
            Cấu hình Profile theo Core APIs và Business Workflows. Mọi identity và routing tiếp tục dùng Profile ID.
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">

        {/* L E F T   S I D E B A R   ( C L I E N T S ) */}
        <div className="w-full md:w-80 shrink-0 space-y-4">
          <div className="modern-card overflow-hidden flex flex-col sticky top-6 max-h-[calc(100vh-3rem)]">
            {/* Header Sidebar */}
            <div className="bg-muted p-4 border-b border-border space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-bold flex items-center gap-2 text-foreground">
                  <Key className="w-4 h-4 text-primary" />
                  Profiles ({apiKeys.length})
                </h2>
                {dirtyEndpointSlugs.size > 0 && (
                  <span className="text-[10px] font-bold uppercase rounded-full bg-amber-100 text-amber-700 px-2 py-1">Chưa lưu</span>
                )}
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                {/* See the index-table search: inline paddingLeft beats `.input-field`. */}
                <input
                  value={switcherSearch}
                  onChange={event => setSwitcherSearch(event.target.value)}
                  style={{ paddingLeft: '2.5rem' }}
                  className="input-field py-2 text-sm"
                  placeholder="Tìm Profile..."
                  aria-label="Tìm Profile trong navigator"
                />
              </div>
            </div>

            {/* List Clients */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {apiKeys.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Chưa có Profile được cấp quyền.
                </div>
              ) : switcherProfiles.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Không tìm thấy Profile phù hợp.
                </div>
              ) : (
                switcherProfiles.map(key => {
                  const isSelected = key.id === selectedClientId;
                  return (
                    <button
                      key={key.id}
                      onClick={() => selectProfile(key.id)}
                      className={`w-full text-left px-3 py-3 rounded-lg flex items-center justify-between transition-all ${isSelected
                        ? 'bg-primary text-primary-foreground shadow-md'
                        : 'hover:bg-muted text-foreground'
                        }`}
                    >
                      <div className="flex flex-col truncate pr-2">
                        <span className="font-semibold text-sm truncate">{effectiveProfileLabel(key)}</span>
                        <span className={`text-[10px] mt-0.5 truncate font-mono ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          {key.name} · {key.id.split('-')[0]}
                        </span>
                      </div>
                      {isSelected && <ChevronRight className="w-4 h-4 shrink-0 opacity-70" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* R I G H T   C O N T E N T */}
        <div className="flex-1 w-full space-y-6">

          {/* Success Notification for a rotated API Key */}
          {createdRawKey && (
            <div className="modern-card border-green-500 bg-green-50 dark:bg-green-950/20 dark:border-green-900/50 p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                <div className="space-y-3 w-full">
                  <div>
                    <h3 className="text-lg font-bold text-green-900 dark:text-green-100">API Key mới đã được cấp: {createdRawKey.name}</h3>
                    <p className="text-green-700 dark:text-green-400 text-sm mt-1">Hãy copy Header Key này và gửi cho Client. Mã này đã được mã hóa 1 chiều trên DB và sẽ KHÔNG BAO GIỜ hiển thị lại.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="bg-white dark:bg-black border border-green-200 dark:border-green-900 text-green-800 dark:text-green-300 px-4 py-2.5 rounded-lg flex-1 overflow-x-auto text-sm">
                      x-api-key: {createdRawKey.key}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(createdRawKey.key);
                        toast.success('Đã copy vào clipboard!');
                      }}
                      className="p-2.5 bg-green-200/50 hover:bg-green-300/50 dark:bg-green-900/50 text-green-700 dark:text-green-200 rounded-lg transition-colors shrink-0"
                      title="Copy Header Key"
                    >
                      <Copy className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main Workspace */}
          {requestedClient && (
            <div className="space-y-4 animate-in fade-in duration-300">

              {/* Profile Overview Card */}
              <div className="modern-card p-6 bg-gradient-to-r from-background to-muted/30 border border-border shadow-sm">
                <div className="flex flex-col gap-6">
                  {/* Top: API Key */}
                  <div className="flex-1 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="text-2xl font-bold flex items-center gap-2 text-foreground">
                          <span className="truncate">{effectiveProfileLabel(requestedClient)}</span>
                          {requestedClient.name === 'Global Profile' && (
                            <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full uppercase tracking-wider">Mặc định</span>
                          )}
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1 font-mono">
                          {requestedClient.name} · {requestedClient.id.split('-')[0]}
                        </p>
                        <button type="button" onClick={() => setShowAuditHistory(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                          <History className="h-3.5 w-3.5" aria-hidden="true" /> Lịch sử thay đổi
                        </button>
                      </div>
                      {/* Status is shown only when it deviates from the healthy default,
                          matching the index table. There is no UI to change it, so a
                          permanent "active" chip would be noise. */}
                      {requestedClient.status !== 'active' && (
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          {requestedClient.status}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="profile-label" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Tên Profile</label>
                        <input
                          id="profile-label"
                          value={profileDisplayName}
                          maxLength={120}
                          readOnly={!canUpdateProfile}
                          onChange={event => setProfileDisplayName(event.target.value)}
                          className="input-field"
                          placeholder={requestedClient.name}
                        />
                        <p className="text-xs text-muted-foreground mt-1">Để trống sẽ hiển thị theo mã định danh.</p>
                      </div>

                      <div>
                        <label htmlFor="profile-rate" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Giới hạn tốc độ (request/phút)</label>
                        <input
                          id="profile-rate"
                          type="number"
                          min={0}
                          step={1}
                          value={rateLimitInput}
                          readOnly={!canUpdateProfile}
                          onChange={e => setRateLimitInput(e.target.value)}
                          placeholder="0"
                          className="input-field"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Đặt <code className="font-mono">0</code> để dùng mặc định hệ thống.</p>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="profile-note" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Ghi chú</label>
                      <textarea
                        id="profile-note"
                        value={profileNote}
                        readOnly={!canUpdateProfile}
                        onChange={e => setProfileNote(e.target.value)}
                        placeholder="Profile này dùng cho hệ thống nào, đơn vị nào..."
                        className="input-field min-h-[72px] text-sm resize-none"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Hiển thị trong danh sách Profile để nhận diện nhanh.</p>
                    </div>

                    {canUpdateProfile && (
                      <ProfileIntegrationBlock
                        apiKeyId={selectedClientId}
                        endpointSlug={profileEndpoints[0]?.slug ?? 'extract'}
                        value={profileIntegration}
                        onChange={setProfileIntegration}
                      />
                    )}

                    {canUpdateProfile && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleSaveProfileInfo}
                          disabled={savingProfileInfo || !hasProfileDraft}
                          className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                        >
                          {savingProfileInfo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          Lưu thông tin Profile
                        </button>
                        {hasProfileDraft && <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">Có thay đổi chưa lưu</span>}
                      </div>
                    )}

                    <div className="pt-2 border-t border-border">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">API Key</p>
                      <p className="text-sm text-muted-foreground">
                        API key chỉ hiển thị một lần khi tạo hoặc cấp lại. Hệ thống chỉ lưu bản băm nên không thể xem lại key hiện tại.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {canManageRelease && <ReleasePanel profileId={requestedClient.id} profileName={requestedClient.name} onProfileChanged={handleReleaseProfileChanged} />}
              <div className="flex items-center justify-between mt-8 border-b border-border">
                <div className="flex items-center gap-1" role="tablist" aria-label="Khu vực cấu hình Profile">
                  {([
                    ['core', 'Core APIs'],
                    ['workflows', 'Business Workflows'],
                  ] as Array<[WorkspaceTab, string]>).map(([tab, label]) => (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={activeServiceTab === tab}
                      onClick={() => selectWorkspaceTab(tab)}
                      className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${activeServiceTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="mb-2 text-sm text-muted-foreground">
                  {profileEndpoints.filter(endpoint => Boolean(endpoint.isWorkflow) === (activeServiceTab === 'workflows') && endpoint.enabled).length} đang bật
                </span>
              </div>

              {detailLoading && (
                <div className="p-10 text-center modern-card"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /><p className="text-sm text-muted-foreground mt-2">Đang tải cấu hình Profile...</p></div>
              )}

              {!detailLoading && detailError && (
                <div className="p-8 text-center modern-card border-red-200 dark:border-red-900">
                  <XCircle className="w-7 h-7 text-red-500 mx-auto mb-2" />
                  <p className="font-semibold">Không thể tải chi tiết Profile</p>
                  <p className="text-sm text-muted-foreground mt-1">{detailError}</p>
                  <button onClick={() => setDetailReloadToken(value => value + 1)} className="mt-3 px-4 py-2 rounded-lg border border-border hover:bg-muted text-sm font-semibold">Thử lại</button>
                </div>
              )}

              {!detailLoading && !detailError && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold">{activeServiceTab === 'core' ? 'Core APIs' : 'Business Workflows'}</h2>
                      <p className="text-sm text-muted-foreground">Endpoint đang bật được ưu tiên. Mở catalog để xem và cấu hình endpoint đang tắt.</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {canManageEndpoints && (
                        <>
                          <button
                            type="button"
                            onClick={() => requestBulkEndpointUpdate(true)}
                            disabled={bulkEndpointLoading || hasEndpointDraft}
                            className="px-3 py-2 rounded-lg text-xs font-semibold border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {bulkEndpointLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="Đang cập nhật endpoint" /> : 'Bật tất cả'}
                          </button>
                          <button
                            type="button"
                            onClick={() => requestBulkEndpointUpdate(false)}
                            disabled={bulkEndpointLoading || hasEndpointDraft}
                            className="px-3 py-2 rounded-lg text-xs font-semibold border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Tắt tất cả
                          </button>
                        </>
                      )}
                      <button
                        onClick={toggleDisabledCatalog}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${showDisabledCatalog ? 'bg-primary/10 text-primary border-primary/30' : 'border-border text-muted-foreground hover:bg-muted'}`}
                      >
                        {showDisabledCatalog ? 'Ẩn endpoint đang tắt' : 'Xem endpoint đang tắt'}
                      </button>
                    </div>
                  </div>

                  {Object.keys(groupedEndpoints).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(groupedEndpoints).map(([slug, eps]) => (
                        <EndpointGroup
                          key={slug}
                          slug={slug}
                          eps={eps as any[]}
                          apiKeyId={selectedClientId}
                          allConnectors={allConnectors}
                          canManageEndpoints={canManageEndpoints}
                          profileIntegration={profileIntegration}
                          onProfileIntegrationChange={setProfileIntegration}
                          profileEndpoints={profileEndpoints}
                          onDirtyChange={handleEndpointDirtyChange}
                          onRequestConfirm={confirmAction}
                          onUpdated={() => refreshProfileEndpoints(selectedClientId).catch(error => toast.error(error instanceof Error ? error.message : 'Không thể làm mới cấu hình Profile'))}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="p-10 text-center border-dashed border-2 rounded-xl text-muted-foreground">
                      <Settings className="w-8 h-8 opacity-20 mb-2 mx-auto" />
                      {showDisabledCatalog ? 'Không có endpoint trong nhóm này.' : 'Chưa có endpoint nào được bật. Mở danh mục để cấu hình.'}
                    </div>
                  )}
                </div>
              )}

              {/* Sensitive actions, grouped away from day-to-day configuration
                  because they affect live traffic or are irreversible. Key rotation
                  and deletion are separate grants, so each is shown on its own. */}
              {(canRotateKey || canDeleteProfile) && (
                <div className="modern-card border-border p-5 space-y-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <AlertTriangle className="w-4 h-4" />
                    <h3 className="text-sm font-bold uppercase tracking-wider">Thao tác quản trị</h3>
                  </div>

                  {canRotateKey && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">Cấp lại API Key</p>
                        <p className="text-xs text-muted-foreground">Key cũ mất hiệu lực ngay. Client đang dùng key cũ sẽ bị từ chối cho tới khi cập nhật key mới.</p>
                      </div>
                      <button
                        onClick={handleRotateKey}
                        className="px-4 py-2 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 text-sm font-semibold flex items-center gap-2 shrink-0"
                      >
                        <Zap className="w-4 h-4" /> Cấp lại Key
                      </button>
                    </div>
                  )}

                  {canDeleteProfile && requestedClient.name !== 'Global Profile' && (
                    <div className="pt-3 border-t border-border space-y-2">
                      <p className="text-sm font-semibold">Xoá Profile</p>
                      <p className="text-xs text-muted-foreground">
                        Không thể hoàn tác. Nhập <code className="font-mono font-bold">{requestedClient.name}</code> để xác nhận.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={deleteConfirmText}
                          onChange={event => setDeleteConfirmText(event.target.value)}
                          className="input-field max-w-xs font-mono text-sm"
                          placeholder="Nhập mã định danh"
                          aria-label="Xác nhận mã định danh để xoá Profile"
                        />
                        <button
                          onClick={() => navigateWithDirtyGuard(() => handleDeleteClient(selectedClientId))}
                          disabled={deleteConfirmText.trim() !== requestedClient.name}
                          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-40 disabled:hover:bg-red-600 flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" /> Xoá Profile
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <AuditHistoryDrawer
            entityType="PROFILE"
            entityId={requestedClient.id}
            entityLabel={effectiveProfileLabel(requestedClient)}
            open={showAuditHistory}
            onClose={() => setShowAuditHistory(false)}
          />

          {/* No "pick a Profile" placeholder is needed here: this branch only renders
              once `?client=` resolves to an authorized Profile. An empty or unknown id
              is handled earlier by the index table and the not-authorized screen. */}
        </div>
      </div>

      {/* Custom Confirm Modal */}
      {confirmState.isOpen && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-background border border-border shadow-2xl rounded-2xl p-6 w-full max-w-md animate-in zoom-in-95 duration-200">
            <h3 className={`text-xl font-bold mb-2 flex items-center gap-2 ${confirmState.isDestructive ? 'text-red-500' : 'text-foreground'}`}>
              {confirmState.isDestructive ? <Trash2 className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
              {confirmState.title}
            </h3>
            <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
              {confirmState.message}
            </p>
            <div className="flex items-center justify-end gap-3 font-medium">
              <button
                onClick={() => setConfirmState({ ...confirmState, isOpen: false })}
                className="px-5 py-2 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-colors border border-transparent hover:border-border"
              >
                Hủy
              </button>
              <button
                onClick={() => {
                  const action = confirmState.onConfirm;
                  setConfirmState({ ...confirmState, isOpen: false });
                  action();
                }}
                className={`px-5 py-2 rounded-lg text-white shadow-sm transition-colors ${confirmState.isDestructive
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
              >
                {confirmState.confirmText || 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ─── EndpointGroup ─────────────────────────────────────────────────────────────

function EndpointGroup({ slug, eps, apiKeyId, allConnectors, canManageEndpoints, profileIntegration, onProfileIntegrationChange, profileEndpoints, onUpdated, onDirtyChange, onRequestConfirm }: {
  slug: string;
  eps: any[];
  apiKeyId: string;
  canManageEndpoints: boolean;
  profileIntegration: ProfileIntegrationDraft;
  onProfileIntegrationChange: (next: ProfileIntegrationDraft) => void;
  profileEndpoints: any[];
  allConnectors: { id: string; slug: string; name: string; defaultPrompt?: string; effectivePrompt?: string; systemPrompt?: string; connectionMode?: 'AIHUB' | 'MULTIPART'; defaultModel?: string; defaultReasoningEffort?: string }[];
  onUpdated: () => void;
  onDirtyChange: (endpointSlug: string, isDirty: boolean) => void;
  onRequestConfirm: ConfirmRequest;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const enabledCount = eps.filter(ep => ep.enabled).length;
  const isWorkflowGroup = eps.some((ep: any) => ep.isWorkflow);

  const accentClass = isWorkflowGroup
    ? {
        border: 'border-purple-200 dark:border-purple-800 bg-purple-50/10 dark:bg-purple-900/10',
        text: 'text-purple-600 dark:text-purple-400',
        borderLeft: 'border-purple-500',
        badge: 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300',
        btnActive: 'bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400',
      }
    : {
        border: 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/10 dark:bg-indigo-900/10',
        text: 'text-indigo-600 dark:text-indigo-400',
        borderLeft: 'border-indigo-500',
        badge: 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300',
        btnActive: 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400',
      };

  return (
    <div className={`mb-4 modern-card border transition-all duration-300 ${isExpanded ? `${accentClass.border} shadow-sm` : 'border-border bg-background'}`}>
      <div
        className="flex items-center justify-between p-4 cursor-pointer group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h3 className={`text-sm font-extrabold uppercase tracking-widest ${accentClass.text} px-2 border-l-4 ${accentClass.borderLeft} flex items-center gap-2`}>
          <span>{isWorkflowGroup ? '⚡ Business Workflows' : `${slug} Endpoints`}</span>
          <span className={`${accentClass.badge} text-[10px] px-2 py-0.5 rounded-full font-bold tracking-normal`}>
            {enabledCount}/{eps.length} BẬT
          </span>
          {isWorkflowGroup && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-200/80 text-purple-800 dark:bg-purple-800/50 dark:text-purple-200 px-2 py-0.5 rounded-sm">
              Code-Driven
            </span>
          )}
        </h3>
        <button className={`p-1.5 rounded-lg transition-all duration-200 ${isExpanded ? accentClass.btnActive : 'hover:bg-muted text-muted-foreground group-hover:text-foreground'}`}>
          <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} />
        </button>
      </div>

      <div className={isExpanded ? 'p-4 pt-0' : 'hidden'}>
          {isWorkflowGroup && (
            <div className="mb-4 bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/50 dark:border-purple-800/50 rounded-lg p-3 text-xs text-purple-700 dark:text-purple-300 leading-relaxed flex gap-2 items-start">
              <Code className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
              <div>
                <strong className="text-purple-900 dark:text-purple-100">Workflow Orchestration:</strong>{' '}
                Workflow orchestration và mode dispatch vẫn nằm trong code TypeScript. Tại đây chỉ quản lý các AI step runtime thật sự đọc prompt/model override; code-only step luôn read-only.
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
            {eps.map((ep: any) => (
              <ProfileEndpointCard
                key={ep.slug}
                endpoint={ep}
                apiKeyId={apiKeyId}
                allConnectors={allConnectors}
                canManageEndpoints={canManageEndpoints}
                profileIntegration={profileIntegration}
                onProfileIntegrationChange={onProfileIntegrationChange}
                profileEndpoints={profileEndpoints}
                onDirtyChange={onDirtyChange}
                onUpdated={onUpdated}
                onRequestConfirm={onRequestConfirm}
              />
            ))}
          </div>
        </div>
    </div>
  );
}

// ─── ProfileEndpointCard ───────────────────────────────────────────────────────

function ProfileEndpointCard({
  endpoint,
  apiKeyId,
  canManageEndpoints,
  profileIntegration,
  onProfileIntegrationChange,
  profileEndpoints,
  allConnectors,
  onUpdated,
  onDirtyChange,
  onRequestConfirm,
}: {
  endpoint: any;
  apiKeyId: string;
  canManageEndpoints: boolean;
  profileIntegration: ProfileIntegrationDraft;
  onProfileIntegrationChange: (next: ProfileIntegrationDraft) => void;
  profileEndpoints: any[];
  allConnectors: { id: string; slug: string; name: string; defaultPrompt?: string; effectivePrompt?: string; systemPrompt?: string; connectionMode?: 'AIHUB' | 'MULTIPART'; defaultModel?: string; defaultReasoningEffort?: string }[];
  onUpdated: () => void;
  onDirtyChange: (endpointSlug: string, isDirty: boolean) => void;
  onRequestConfirm: ConfirmRequest;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [isActive, setIsActive] = useState(endpoint.enabled);
  const [isEditing, setIsEditing] = useState(false);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isProcessorsOpen, setIsProcessorsOpen] = useState(false);
  const [isCurlOpen, setIsCurlOpen] = useState(false);
  // cURL preview choices live on endpointIntegration as session-only draft state.

  // Unified Param state
  const [paramsObj, setParamsObj] = useState<Record<string, { value: any, isLocked: boolean }>>(endpoint.parameters || {});
  const [showRaw, setShowRaw] = useState(false);
  // Raw-JSON editing keeps its own draft so partially typed JSON is never thrown away.
  const [rawParamsDraft, setRawParamsDraft] = useState('');
  const [rawParamsError, setRawParamsError] = useState('');
  const [addKey, setAddKey] = useState('');

  // Processor overrides
  const [extOverridesState, setExtOverridesState] = useState<Record<string, string | null>>({});
  // Per-step model overrides (parallel to extOverridesState, keyed by stepId/connectionId)
  const [extModelOverridesState, setExtModelOverridesState] = useState<Record<string, string | null>>({});
  // Per-step reasoning_effort overrides (parallel to extModelOverridesState)
  const [extReasoningEffortOverridesState, setExtReasoningEffortOverridesState] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);

  // Job Priority
  const [jobPriority, setJobPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH'>(
    endpoint.jobPriority ?? 'MEDIUM'
  );

  // Integration draft is a single state object so its init/reset/signature/save lifecycle stays aligned.
  const [endpointIntegration, setEndpointIntegration] = useState<EndpointIntegrationDraft>(() => createEndpointIntegrationDraft(endpoint));
  const endpointIntegrationBaselineRef = useRef<EndpointIntegrationDraft>(createEndpointIntegrationDraft(endpoint));
  const legacyCspKeys = ['csp_token_url', 'csp_client_id', 'csp_client_secret', 'ibm_client_id'] as const;
  const legacyCspValues = Object.fromEntries(legacyCspKeys.map(key => [key, paramsObj[key]?.value])) as Record<typeof legacyCspKeys[number], unknown>;
  const hasLegacyCspParams = legacyCspKeys.some(key => {
    const value = legacyCspValues[key];
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
  const selectedProfileCallbackAuth = profileIntegration.callbackUsesSeparateAuth
    ? profileIntegration.callback.auth
    : profileIntegration.inputSource.auth;
  const hasProfileCallbackAuth = selectedProfileCallbackAuth.type !== 'none';

  const copyLegacyCspAuthToProfile = () => {
    const auth = {
      type: 'oauth2_client_credentials' as const,
      token_url: String(legacyCspValues.csp_token_url ?? ''),
      client_id: String(legacyCspValues.csp_client_id ?? ''),
      client_secret: String(legacyCspValues.csp_client_secret ?? ''),
      token_body_format: 'json' as const,
      token_auth_style: 'body' as const,
      gateway_headers: legacyCspValues.ibm_client_id ? [{ name: 'X-IBM-Client-Id', value: String(legacyCspValues.ibm_client_id) }] : [],
    };
    onProfileIntegrationChange({
      ...profileIntegration,
      inputSource: { ...profileIntegration.inputSource, auth, authConfigured: true },
      callback: { ...profileIntegration.callback, auth, authConfigured: true },
      callbackUsesSeparateAuth: false,
    });
    toast.success('Đã sao chép CSP credentials vào xác thực Profile. Hãy lưu Profile trước khi xoá tham số cũ.');
  };

  const clearLegacyCspParams = () => {
    setParamsObj(previous => Object.fromEntries(Object.entries(previous).map(([key, config]) =>
      legacyCspKeys.includes(key as typeof legacyCspKeys[number]) ? [key, { ...config, value: null }] : [key, config],
    )));
    toast.success('Đã xoá giá trị CSP trong bản nháp endpoint. Hãy lưu endpoint để áp dụng.');
  };

  // Configured allowed file extensions
  const [allowedFileExtensions, setAllowedFileExtensions] = useState<string>(endpoint.allowedFileExtensions || '');

  // Reference field for ops search (extractClientReference)
  const [referenceExtract, setReferenceExtract] = useState<string>((endpoint as any).referenceExtract || '');

  const [connectionsOverride, setConnectionsOverride] = useState<ConnStep[] | null>(() => {
    const raw = endpoint.connectionsOverride;
    if (!raw) return null;
    // Support cả format cũ (string[]) và format mới (ConnStep[])
    if (raw.length > 0 && typeof raw[0] === 'string') {
      return ensureStepIds((raw as string[]).map((slug: string) => ({ slug })));
    }
    return ensureStepIds(raw as ConnStep[]);
  });
  // Prompt Wizard state — keyed by overrideKey (stepId)
  const [wizardOpen, setWizardOpen]       = useState<Record<string, boolean>>({});
  const [wizardProblem, setWizardProblem] = useState<Record<string, string>>({});
  const [wizardLoading, setWizardLoading] = useState<Record<string, boolean>>({});
  const [wizardResult, setWizardResult]   = useState<Record<string, string>>({});

  // Test Endpoint Modal State
  const [showTestModal, setShowTestModal] = useState(false);
  const [testFiles, setTestFiles] = useState<File[]>([]);
  const [testFileUrlsRaw, setTestFileUrlsRaw] = useState<string>('');
  const [testParams, setTestParams] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const baselineSignatureRef = useRef('');

  useEffect(() => {
    const initialParams = endpoint.parameters || {};
    const initialOverrides: Record<string, string | null> = {};
    const initialModelOverrides: Record<string, string | null> = {};
    const initialReasoningEffortOverrides: Record<string, string | null> = {};
    endpoint.extConnections?.forEach((conn: any) => {
      const key = conn.stepId ?? conn.connectionId;
      initialOverrides[key] = conn.promptOverride ?? null;
      initialModelOverrides[key] = conn.modelOverride ?? null;
      initialReasoningEffortOverrides[key] = conn.reasoningEffortOverride ?? null;
    });

    const rawConnections = endpoint.connectionsOverride;
    let initialConnections: ConnStep[] | null = null;
    if (rawConnections?.length > 0 && typeof rawConnections[0] === 'string') {
      initialConnections = ensureStepIds((rawConnections as string[]).map((slug: string) => ({ slug })));
    } else if (rawConnections) {
      initialConnections = ensureStepIds(rawConnections as ConnStep[]);
    }

    const initialJobPriority = endpoint.jobPriority ?? 'MEDIUM';
    const initialIntegration = createEndpointIntegrationDraft(endpoint);
    const initialAllowedExtensions = endpoint.allowedFileExtensions || '';
    const initialReferenceExtract = endpoint.referenceExtract || '';

    setIsActive(endpoint.enabled);
    setParamsObj(initialParams);
    setExtOverridesState(initialOverrides);
    setExtModelOverridesState(initialModelOverrides);
    setExtReasoningEffortOverridesState(initialReasoningEffortOverrides);
    setConnectionsOverride(initialConnections);
    setJobPriority(initialJobPriority);
    setEndpointIntegration(initialIntegration);
    endpointIntegrationBaselineRef.current = initialIntegration;
    setAllowedFileExtensions(initialAllowedExtensions);
    setReferenceExtract(initialReferenceExtract);
    baselineSignatureRef.current = endpointDraftSignature({
      paramsObj: initialParams,
      extOverridesState: initialOverrides,
      extModelOverridesState: initialModelOverrides,
      extReasoningEffortOverridesState: initialReasoningEffortOverrides,
      connectionsOverride: initialConnections,
      jobPriority: initialJobPriority,
      endpointIntegration: initialIntegration,
      allowedFileExtensions: initialAllowedExtensions,
      referenceExtract: initialReferenceExtract,
    });
  }, [endpoint, apiKeyId]);

  // Promoting endpoint defaults into an override must go through ensureStepIds,
  // exactly like addConnection/updateStepSession, so step identity stays stable.
  const promoteDefaults = (): ConnStep[] =>
    ensureStepIds((endpoint.connections || []).map((s: string) => ({ slug: s })));

  const moveConnection = (idx: number, dir: 1 | -1) => {
    const list = connectionsOverride ? [...connectionsOverride] : promoteDefaults();
    const item = list.splice(idx, 1)[0];
    list.splice(idx + dir, 0, item);
    setConnectionsOverride(list);
  };

  const removeConnection = (idx: number) => {
    const list = connectionsOverride ? [...connectionsOverride] : promoteDefaults();
    list.splice(idx, 1);
    setConnectionsOverride(list);
  };

  const addConnection = (slug: string) => {
    const list = connectionsOverride ? [...connectionsOverride] : promoteDefaults();
    // A step added by hand may duplicate an existing connector, so it always gets
    // its own id. ensureStepIds keeps the pre-existing occurrences untouched.
    list.push({ slug });
    setConnectionsOverride(ensureStepIds(list));
  };

  const updateStepSession = (idx: number, field: 'captureSession' | 'injectSession', value: string) => {
    // Nếu chưa có override, tự động khởi tạo từ default connections
    // Việc sửa session field sẽ tự động promote thành override mode
    const baseList = connectionsOverride ?? promoteDefaults();
    setConnectionsOverride(baseList.map((s: ConnStep, i: number) =>
      i === idx ? { ...s, [field]: value || null } : s
    ));
  };

  const resetToDefaultConnections = () => {
    setConnectionsOverride(null);
  };

  const toggleRawMode = (next: boolean) => {
    if (next) {
      setRawParamsDraft(Object.keys(paramsObj).length ? JSON.stringify(paramsObj, null, 2) : '');
      setRawParamsError('');
    }
    setShowRaw(next);
  };

  /** Commit raw JSON into the draft only when it parses into a parameter map. */
  const updateRawParams = (text: string) => {
    setRawParamsDraft(text);
    if (!text.trim()) {
      setParamsObj({});
      setRawParamsError('');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setRawParamsError(`JSON không hợp lệ: ${err instanceof Error ? err.message : 'lỗi cú pháp'}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setRawParamsError('Tham số phải là một object dạng { "key": { "value": ..., "isLocked": false } }.');
      return;
    }
    const invalidKey = Object.entries(parsed as Record<string, unknown>).find(([, config]) =>
      !config || typeof config !== 'object' || Array.isArray(config) || !('value' in (config as object)));
    if (invalidKey) {
      setRawParamsError(`Tham số "${invalidKey[0]}" phải có dạng { "value": ..., "isLocked": true|false }.`);
      return;
    }
    setRawParamsError('');
    setParamsObj(parsed as Record<string, { value: any; isLocked: boolean }>);
  };

  // Reset expanded states when switching to a different client profile
  useEffect(() => {
    setIsEditing(false);
    setIsParamsOpen(false);
    setIsProcessorsOpen(false);
    setIsCurlOpen(false);
    setShowTestModal(false);
    setTestResult(null);
    setTestFiles([]);
    setTestParams({});
    setShowRaw(false);
    setRawParamsDraft('');
    setRawParamsError('');
    setAddKey('');
    setJobPriority(endpoint.jobPriority ?? 'MEDIUM');
    setEndpointIntegration(createEndpointIntegrationDraft(endpoint));
    setAllowedFileExtensions(endpoint.allowedFileExtensions || '');
    setReferenceExtract((endpoint as any).referenceExtract || '');
    setWizardOpen({});
    setWizardProblem({});
    setWizardLoading({});
    setWizardResult({});
  }, [apiKeyId, endpoint.slug]);

  const currentConfigurationSignature = useMemo(() => endpointDraftSignature({
    paramsObj,
    extOverridesState,
    extModelOverridesState,
    extReasoningEffortOverridesState,
    connectionsOverride,
    jobPriority,
    endpointIntegration,
    allowedFileExtensions,
    referenceExtract,
  }), [
    paramsObj,
    extOverridesState,
    extModelOverridesState,
    extReasoningEffortOverridesState,
    connectionsOverride,
    jobPriority,
    endpointIntegration,
    allowedFileExtensions,
    referenceExtract,
  ]);

  useEffect(() => {
    onDirtyChange(endpoint.slug, Boolean(canManageEndpoints && baselineSignatureRef.current && currentConfigurationSignature !== baselineSignatureRef.current));
  }, [currentConfigurationSignature, endpoint.slug, canManageEndpoints, onDirtyChange]);

  useEffect(() => () => onDirtyChange(endpoint.slug, false), [endpoint.slug, onDirtyChange]);

  // Generate cURL preview
  const generateCurl = () => {
    // Bug fix 1: use actual browser origin instead of recreating a potentially wrong host
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://api.dugate.vn';
    const [method, routePath] = (endpoint.route || 'POST /api/v1/docs/extract').split(' ');
    const fullUrl = `${origin}${routePath}`;

    let curlLines = [
      `curl -X ${method} "${fullUrl}" \\`,
      `  -H "x-api-key: YOUR_API_KEY" \\`,
      `  -H "x-correlation-id: YOUR_TRACE_ID" \\`,
      `  -H "idempotency-key: YOUR_UNIQUE_KEY" \\`,
    ];

    if (endpointIntegration.inputMode !== 'file_url') {
      if (routePath.includes('compare')) {
        curlLines.push(`  -F "source_file=@/path/to/source.pdf" \\`);
        curlLines.push(`  -F "target_file=@/path/to/target.pdf" \\`);
      } else {
        curlLines.push(`  -F "file=@/path/to/document.pdf" \\`);
      }
    }

    if (endpoint.discriminatorName && endpoint.discriminatorValue && endpoint.discriminatorValue !== '_default') {
      curlLines.push(`  -F "${endpoint.discriminatorName}=${endpoint.discriminatorValue}" \\`);
    }

    // Bug fix 2: iterate over paramsObj (current state) instead of only parametersSchema,
    // so newly added custom parameters are also included in the curl output.
    if (Object.keys(paramsObj).length > 0) {
      Object.entries(paramsObj).forEach(([key, paramConfig]) => {
        // Internal workflow prompt/model/reasoning_effort maps are consumed
        // entirely server-side from the saved Profile config; they are never a
        // client request field, so they must never appear in a client-facing
        // example (previously rendered as the literal string "[object Object]").
        if (key.startsWith('_workflow')) return;

        const schema = (endpoint.parametersSchema as any)?.[key];
        // Respect the same visibility gate as the Params editor — e.g. encryption
        // sub-params (including unlocked ones like encryption_public_key) stay
        // hidden while encryption_enabled is off, so the example never shows a
        // field the client cannot meaningfully send yet.
        if (!shouldDisplayProfileParameter(schema, paramsObj, key, endpoint.parametersSchema as any)) return;

        // Skip locked params — client shouldn't send them
        if (paramConfig.isLocked) return;

        let exVal: any = paramConfig.value;
        // If param has no value yet, derive a good example from the schema
        if (exVal === '' || exVal === undefined || exVal === null) {
          if (schema) {
            if (schema.options) exVal = schema.options[0];
            else if (schema.default !== undefined) exVal = schema.default;
            else exVal = `{${schema.type}}`;
          } else {
            exVal = '{value}';
          }
        }
        curlLines.push(`  -F "${key}=${exVal}" \\`);
      });
    }

    // File URL examples intentionally contain no DU credential: DU resolves Profile auth server-side.
    if (endpointIntegration.inputMode !== 'upload') {
      curlLines.push(`  -F 'file_urls=${JSON.stringify([{ url: 'https://partner.example/document.pdf' }])}' \\`);
    }

    // Callback destination only; callback auth remains in Profile configuration.
    if (endpointIntegration.curlIncludeCallback) {
      curlLines.push(`  -F "callback_url=https://partner.example/callback" \\`);
    }

    const lastLine = curlLines[curlLines.length - 1];
    if (lastLine.endsWith(' \\')) {
      curlLines[curlLines.length - 1] = lastLine.slice(0, -2);
    }
    return curlLines.join('\n');
  };

  // Generate exact cURL for the test payload
  const generateTestCurl = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://api.dugate.vn';
    const [method, routePath] = (endpoint.route || 'POST /api/v1/docs/extract').split(' ');
    const fullUrl = `${origin}${routePath}`;

    let curlLines = [
      `curl -X ${method} "${fullUrl}" \\`,
      `  -H "x-api-key: YOUR_API_KEY_HERE" \\`
    ];

    if (endpointIntegration.inputMode !== 'file_url' && testFiles.length > 0) {
      testFiles.forEach(file => {
        curlLines.push(`  -F "files[]=@${file.name}" \\`);
      });
    }

    if (endpoint.discriminatorName && endpoint.discriminatorValue && endpoint.discriminatorValue !== '_default') {
      curlLines.push(`  -F "${endpoint.discriminatorName}=${endpoint.discriminatorValue}" \\`);
    }

    // Same selection as the real request: locked params are server-injected and
    // must not appear in a client-facing example.
    for (const [key, value] of selectSendableTestParams(testParams, paramsObj, endpoint.parametersSchema)) {
      curlLines.push(`  -F "${key}=${value}" \\`);
    }

    if (endpointIntegration.inputMode !== 'upload') {
      const urls = testFileUrlsRaw.split('\n').map(line => line.trim()).filter(Boolean);
      const fileUrls = urls.length ? urls : ['https://partner.example/document.pdf'];
      curlLines.push(`  -F 'file_urls=${JSON.stringify(fileUrls.map(url => ({ url })))}' \\`);
    }

    if (endpointIntegration.curlIncludeCallback) {
      curlLines.push(`  -F "callback_url=https://partner.example/callback" \\`);
    }

    const lastLine = curlLines[curlLines.length - 1];
    if (lastLine && lastLine.endsWith(' \\')) {
      curlLines[curlLines.length - 1] = lastLine.slice(0, -2);
    }
    return curlLines.join('\n');
  };

  // handleTabSwitch removed — replaced by unified key-value editor

  const requestToggle = (checked: boolean) => {
    // Enabling only widens access, so it stays instant. Disabling cuts traffic for
    // a client that may be calling this endpoint right now, so it asks first.
    if (!checked) {
      onRequestConfirm(
        'Tắt endpoint đang bật?',
        `Client dùng Profile này sẽ bị từ chối khi gọi "${endpoint.displayName}" ngay sau khi tắt.`,
        () => { void applyToggle(false); },
        true,
        'Tắt endpoint',
      );
      return;
    }
    void applyToggle(true);
  };

  const applyToggle = async (checked: boolean) => {
    setSaving(true);
    try {
      // Toggle is intentionally a narrow PATCH-like request. Unsaved editor
      // fields must never be persisted as a side effect of enabling/disabling.
      const response = await fetch('/api/internal/profile-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeyId, endpointSlug: endpoint.slug, enabled: checked }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }
      setIsActive(checked);
      if (checked) setIsEditing(true);
      onUpdated();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Lỗi khi cập nhật trạng thái: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async (): Promise<boolean> => {
    // Saving while the raw editor holds invalid JSON would silently persist the
    // last valid draft, not what the operator sees on screen.
    if (showRaw && rawParamsError) {
      toast.error('Tham số JSON chưa hợp lệ. Sửa lỗi trước khi lưu.');
      return false;
    }
    // Fail-closed encryption config: when encryption is enabled, mode is required
    // and selective mode requires an explicit field list. Same rule the server
    // enforces — surfaced here so the admin gets immediate feedback and the save
    // is blocked before the request is sent.
    const encryptionError = validateEncryptionParams(paramsObj as Record<string, { value?: unknown }>);
    if (encryptionError) {
      toast.error(encryptionError);
      return false;
    }

    setSaving(true);
    try {
      const finalParamsObj = Object.keys(paramsObj).length ? paramsObj : null;

      // Build endpoint + processor overrides as one atomic server transaction.
      const currentSteps = connectionsOverride
        ?? (endpoint.connections || []).map((s: string) => ({ slug: s }));
      const overrides = currentSteps.map((step: ConnStep) => {
        const cData = allConnectors.find((c: any) => c.slug === step.slug);
        if (!cData) return null;
        const overrideKey = overrideKeyFor(step, cData.id);
        // When a legacy/default step is promoted to a UUID, preserve the
        // existing connection-scoped values instead of silently dropping them.
        const val = extOverridesState[overrideKey] ?? extOverridesState[cData.id];
        const modelVal = extModelOverridesState[overrideKey] ?? extModelOverridesState[cData.id];
        const reasoningVal = extReasoningEffortOverridesState[overrideKey] ?? extReasoningEffortOverridesState[cData.id];
        const hasPrompt = val !== null && val !== undefined && String(val).trim() !== '';
        const hasModel = modelVal !== null && modelVal !== undefined && String(modelVal).trim() !== '';
        const hasReasoning = reasoningVal !== null && reasoningVal !== undefined && String(reasoningVal).trim() !== '';
        return {
          connectionId: cData.id,
          stepId: persistedStepId(step),
          isActive: hasPrompt || hasModel || hasReasoning,
          promptOverride: hasPrompt ? val : null,
          modelOverride: hasModel ? modelVal : null,
          reasoningEffortOverride: hasReasoning ? reasoningVal : null,
        };
      }).filter(Boolean);

      const response = await fetch('/api/internal/profile-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKeyId,
          endpointSlug: endpoint.slug,
          enabled: isActive,
          parameters: finalParamsObj,
          connectionsOverride: connectionsOverride && connectionsOverride.length > 0 ? connectionsOverride : null,
          jobPriority,
          ...endpointIntegrationPatch(endpointIntegration, endpointIntegrationBaselineRef.current),
          allowedFileExtensions: allowedFileExtensions.trim() ? allowedFileExtensions.trim() : null,
          referenceExtract: referenceExtract.trim() ? referenceExtract.trim() : null,
          overrides,
          replaceOverrides: true,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      // Update local state without closing editor if manually saved
      setParamsObj(finalParamsObj || {});
      endpointIntegrationBaselineRef.current = endpointIntegration;

      // Re-baseline the dirty tracker to the just-saved state. Without this the
      // signature still differs from the stale baseline, so the "unsaved changes"
      // guard keeps firing when navigating away right after a successful save.
      baselineSignatureRef.current = endpointDraftSignature({
        paramsObj: finalParamsObj || {},
        extOverridesState,
        extModelOverridesState,
        extReasoningEffortOverridesState,
        connectionsOverride,
        jobPriority,
        endpointIntegration,
        allowedFileExtensions,
        referenceExtract,
      });
      onDirtyChange(endpoint.slug, false);

      onUpdated();
      toast.success(`Đã lưu cấu hình "${endpoint.displayName}"`);
      return true;
    } catch (err: any) {
      toast.error(`Lỗi khi lưu thiết lập: ${err.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleTestEndpoint = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const fd = new FormData();
      const baseService = endpoint.slug.split(':')[0];
      fd.append('__service', baseService);
      fd.append('__apiKeyId', apiKeyId);
      for (const file of testFiles) fd.append('files[]', file);

      if (testFileUrlsRaw.trim()) {
        const urls = testFileUrlsRaw.split('\n').map(l => l.trim()).filter(Boolean);
        for (const u of urls) {
          try {
            new URL(u);
          } catch {
            toast.error(`URL không hợp lệ: ${u}`);
            setTesting(false);
            return;
          }
        }
        const mapped = urls.map(u => ({ url: u }));
        fd.append('file_urls', JSON.stringify(mapped));
      }

      if (endpoint.discriminatorName && endpoint.discriminatorValue && endpoint.discriminatorValue !== '_default') {
        fd.append(endpoint.discriminatorName, endpoint.discriminatorValue);
      }

      // Append test params. Locked keys are deliberately excluded: the server
      // rejects the whole request with 400 forbidden-field if a locked key is
      // present at all, so sending them made Test unusable on any endpoint that
      // had one. The server injects the locked values itself.
      for (const [key, value] of selectSendableTestParams(testParams, paramsObj, endpoint.parametersSchema)) {
        fd.append(key, value);
      }

      const res = await fetch('/api/internal/test-profile-endpoint', {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      setTestResult({ status: res.status, data });
    } catch (e: any) {
      // Shape the transport failure like a server payload so the result panel can
      // render it. A bare { error: string } was never read by any render branch,
      // which showed an empty red box for network/abort failures.
      setTestResult({
        status: 0,
        data: { error: { code: 'REQUEST_FAILED', message: e?.message || 'Không gọi được API test' } },
      });
    } finally {
      setTesting(false);
    }
  };

  /**
   * A sync pipeline run answers HTTP 200 even when the pipeline FAILED (the
   * failure lives in `error` / `metadata.state`). Keying the banner off the HTTP
   * status alone therefore painted a green "Thành công" header over a failed run.
   */
  const testFailed = Boolean(
    testResult
    && (testResult.status !== 200
      || testResult.data?.error
      || testResult.data?.metadata?.state === 'FAILED'),
  );

  // Render a dynamic input based on schema
  const renderSchemaInput = (
    key: string,
    schema: any,
    val: any,
    isLocked: boolean,
    onToggleLock: (locked: boolean) => void,
    onChange: (v: any) => void,
    onDelete: () => void,
  ) => {
    // "locked" = client CANNOT override this param at request time (admin-managed).
    // Editing values / toggling the lock requires the endpoint:manage capability.
    // Without it the values render read-only (defense in depth — the edit panel is
    // already gated behind canManageEndpoints, this is a second layer).
    // defaultLocked from the schema only sets the INITIAL lock state; it must not
    // disable the admin's inputs.
    const locked = Boolean(isLocked);
    const isLegacy = Boolean(schema.deprecated);
    const readOnly = !canManageEndpoints;
    const isPublicKey = key === 'encryption_public_key';
    const handlePublicKeyFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Allow selecting the same file again after a validation error.
      event.target.value = '';
      if (!file) return;
      if (file.size > 100 * 1024) {
        toast.error('File public key quá lớn (tối đa 100 KB).');
        return;
      }
      try {
        const pem = (await file.text()).replace(/^\uFEFF/, '').trim();
        if (!pem.includes('-----BEGIN PUBLIC KEY-----') || !pem.includes('-----END PUBLIC KEY-----')) {
          toast.error('File không phải SPKI PEM public key hợp lệ. Cần có BEGIN/END PUBLIC KEY.');
          return;
        }
        onChange(pem);
        toast.success(`Đã nạp public key từ file ${file.name}`);
      } catch {
        toast.error('Không thể đọc file public key.');
      }
    };
    return (
      <div key={key} className={`flex flex-col mb-4 bg-background p-3 rounded-lg border shadow-sm transition-colors ${locked ? 'border-amber-500/50 bg-amber-500/5' : isLegacy ? 'border-slate-300/60 bg-muted/30 opacity-80' : 'border-border'}`}>
        <label className="text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">{key}{schema.required ? <span className="text-red-500 ml-0.5">*</span> : null}</span>
            {readOnly
              ? (locked
                ? <span className="px-1.5 py-0.5 font-bold rounded text-[10px] uppercase text-amber-700 border border-amber-500/30 bg-amber-50 dark:bg-amber-950/30">🔒 Khoá bởi admin</span>
                : <span className="px-1.5 py-0.5 font-bold rounded text-[10px] uppercase text-slate-600 border border-slate-300 bg-slate-100 dark:bg-slate-900">Client ghi đè được</span>)
              : (locked
                ? <button onClick={() => onToggleLock(false)} title="Đang khoá: Client KHÔNG đè được. Bấm để cho phép Client ghi đè." className="px-1.5 py-0.5 font-bold rounded text-[10px] uppercase transition-colors hover:bg-muted border text-amber-700 border-amber-500/30 bg-amber-50 dark:bg-amber-950/30">🔒 Khoá bởi admin</button>
                : <button onClick={() => onToggleLock(true)} title="Đang mở: Client được ghi đè. Bấm để khoá (Client không đè được)." className="px-1.5 py-0.5 font-bold rounded text-[10px] uppercase transition-colors hover:bg-muted border text-indigo-600 border-indigo-500/30 bg-indigo-50 dark:bg-indigo-950/30">✏️ Cho phép Client ghi đè</button>)}
            {isLegacy && <span className="px-1.5 py-0.5 font-bold rounded text-[10px] uppercase text-slate-600 border border-slate-300 bg-slate-100 dark:bg-slate-900">Legacy</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase text-muted-foreground">{schema.type}</span>
            {!readOnly && <button onClick={onDelete} className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 rounded shrink-0 transition-colors" title="Xóa tham số này"><X className="w-3.5 h-3.5" /></button>}
          </div>
        </label>
        <p className="text-xs text-muted-foreground mt-1 mb-2 leading-relaxed">{schema.description}</p>
        {schema.options ? <select value={(val ?? schema.default ?? '') as string} disabled={readOnly} onChange={e => onChange(e.target.value)} className="input-field text-sm font-mono py-1.5 disabled:cursor-not-allowed disabled:opacity-70"><option value="">{schema.default ? `-- Mặc định: ${schema.default} --` : '-- Không đè (Để trống) --'}</option>{schema.options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}</select>
          : schema.type === 'number' ? <input type="number" value={val || ''} disabled={readOnly} onChange={e => onChange(Number(e.target.value))} className="input-field py-1.5 text-sm font-mono disabled:cursor-not-allowed disabled:opacity-70" placeholder={schema.default ? `Mặc định: ${schema.default}` : 'Nhập số...'} />
          : schema.type === 'boolean' ? (
            <label className="inline-flex items-center gap-3 cursor-pointer mt-1 select-none">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={Boolean(val)}
                disabled={readOnly}
                onChange={e => onChange(e.target.checked)}
              />
              <div className={`
                relative h-6 w-11 rounded-full ring-0 transition-all duration-300 ease-in-out shrink-0
                ${val ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700'}
                peer-disabled:opacity-60 peer-disabled:cursor-not-allowed
                after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                after:h-5 after:w-5 after:bg-white after:rounded-full after:transition-all after:shadow-sm
                peer-checked:after:translate-x-full
              `} />
              <span className={`text-xs font-semibold ${val ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground'}`}>
                {val ? 'Đang bật' : 'Đang tắt'}
              </span>
            </label>
          )
          : schema.multiline ? (
          <>
            {isPublicKey && !readOnly && (
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-xs text-muted-foreground">Hoặc nhập nhanh từ file PEM:</span>
                <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted cursor-pointer transition-colors">
                  <FileText className="w-3.5 h-3.5 text-primary" />
                  Chọn file PEM
                  <input
                    type="file"
                    accept=".pem,.pub,.key,text/plain,application/x-pem-file"
                    className="sr-only"
                    onChange={handlePublicKeyFile}
                    aria-label="Chọn file SPKI PEM public key"
                  />
                </label>
              </div>
            )}
            <textarea
              value={val || ''}
              disabled={readOnly}
              onChange={e => onChange(e.target.value)}
              spellCheck={false}
              className="input-field py-1.5 text-sm font-mono min-h-[120px] resize-y disabled:cursor-not-allowed disabled:opacity-70"
              placeholder={schema.placeholder ?? '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----'}
            />
            {isPublicKey && <p className="text-[11px] text-muted-foreground mt-1">File chỉ được đọc trên trình duyệt; nội dung PEM sẽ được đưa vào draft để lưu cùng cấu hình Profile.</p>}
          </>
          ) : <input type={schema.isSecret ? 'password' : 'text'} value={val || ''} disabled={readOnly} onChange={e => onChange(e.target.value)} className="input-field py-1.5 text-sm font-mono disabled:cursor-not-allowed disabled:opacity-70" placeholder={schema.placeholder ?? (schema.default ? `Mặc định: ${schema.default}` : 'Nhập giá trị...')} />}
      </div>
    );
  };

  return (
    <div className={`modern-card flex flex-col border transition-colors relative ${showTestModal ? 'z-[100]' : isEditing ? 'z-50' : 'z-10'} ${isActive
      ? 'bg-indigo-50/10 dark:bg-indigo-950/10 border-indigo-200 dark:border-indigo-900/50 ring-1 ring-indigo-500/20 shadow-md'
      : 'border-border opacity-70'
      }`}>
      <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Card body is not a click target: the chevron button is the single,
            predictable affordance for opening the configuration drawer. */}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className={`text-base font-bold select-none ${isActive ? 'text-indigo-700 dark:text-indigo-400' : 'text-foreground'}`}>
              {endpoint.displayName}
            </h3>
            <span className="text-[11px] font-mono select-none bg-muted text-muted-foreground px-2 py-0.5 rounded-md border border-border">
              {endpoint.route}
            </span>
          </div>
          <p className="text-sm text-muted-foreground leading-snug select-none">
            {endpoint.description}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 mt-2 sm:mt-0">
          {/* Test Endpoint button — only available when endpoint is active */}
          {isActive && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const defaultParams: Record<string, string> = {};
                // Pre-populate with saved values from paramsObj OR default schema values
                Object.keys(endpoint.parametersSchema || {}).forEach(k => {
                  const schema = (endpoint.parametersSchema as any)[k];
                  const savedVal = paramsObj[k]?.value;
                  if (savedVal !== undefined && savedVal !== '') {
                    defaultParams[k] = String(savedVal);
                  } else if (schema?.default !== undefined) {
                    defaultParams[k] = String(schema.default);
                  } else if (schema?.options?.length > 0) {
                    defaultParams[k] = String(schema.options[0]);
                  }
                });
                // Include newly added custom params. Object-valued params owned by a
                // dedicated panel are skipped: String() would send "[object Object]".
                Object.keys(paramsObj).forEach(k => {
                  if (PANEL_OWNED_OBJECT_PARAMS.has(k)) return;
                  if (defaultParams[k] === undefined && paramsObj[k]?.value) {
                    defaultParams[k] = String(paramsObj[k].value);
                  }
                });
                setTestParams(defaultParams);
                setShowTestModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors shadow-sm"
              title="Test Endpoint"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Test
            </button>
          )}

          {canManageEndpoints && (
            <label className="flex items-center gap-2 cursor-pointer relative group">
              {/* Explicit state text: a bare switch forces users to infer meaning from colour. */}
              <span className={`text-xs font-semibold ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground'}`}>
                {isActive ? 'Đang bật' : 'Đang tắt'}
              </span>
              <input
                type="checkbox"
                className="peer sr-only"
                checked={isActive}
                disabled={!canManageEndpoints || saving}
                onChange={e => requestToggle(e.target.checked)}
              />
              <div className={`
                relative h-6 w-11 rounded-full ring-0 transition-all duration-300 ease-in-out shrink-0
                ${isActive ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700'}
                after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                after:h-5 after:w-5 after:bg-white after:rounded-full after:transition-all after:shadow-sm
                peer-checked:after:translate-x-full
              `} />
            </label>
          )}

          {canManageEndpoints && (isActive || isEditing) && (
            <button
              onClick={(e) => { e.stopPropagation(); setIsEditing(!isEditing); }}
              className={`p-1.5 rounded-lg transition-colors border ${isEditing
                ? 'bg-indigo-50 dark:bg-indigo-950 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400'
                : 'bg-transparent border-transparent text-slate-400 hover:text-foreground hover:bg-muted'
                }`}
            >
              <ChevronDown className={`w-5 h-5 transition-transform ${isEditing ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* ══ TEST ENDPOINT MODAL ══════════════════════════════════════════════ */}
      {mounted && showTestModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => { setShowTestModal(false); setTestResult(null); setTestFiles([]); }}
        >
          <div
            className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                  <FlaskConical className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-base">Test Endpoint</h3>
                  <p className="text-xs text-muted-foreground font-mono">{endpoint.displayName} · {endpoint.discriminatorValue || '_default'}</p>
                </div>
              </div>
              <button
                onClick={() => { setShowTestModal(false); setTestResult(null); setTestFiles([]); }}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              <div className="bg-muted/40 border border-border rounded-xl p-4 text-sm text-muted-foreground">
                <p>Thực thi pipeline đầy đủ giống như client thật — tự động áp dụng mọi <strong>Profile Params</strong> và <strong>Prompt Overrides</strong> đã cấu hình cho profile này.</p>
              </div>

              {Object.keys(endpoint.parametersSchema || {}).length > 0 || Object.keys(paramsObj).length > 0 ? (
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2 flex items-center justify-between">
                    <span>Tham số Data (Parameters)</span>
                    <span className="text-xs font-normal text-muted-foreground">Bạn có thể sửa tạm giá trị để test</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted/20 p-3 border border-border rounded-xl">
                    {Array.from(new Set([...Object.keys(endpoint.parametersSchema || {}), ...Object.keys(paramsObj)])).map(key => {
                      const schema = (endpoint.parametersSchema as any)?.[key];
                      const isLocked = paramsObj[key]?.isLocked ?? schema?.defaultLocked ?? false;
                      const hasOptions = schema?.options && schema.options.length > 0;
                      return (
                        <div key={key} className="flex flex-col gap-1">
                          <label className="text-xs font-semibold font-mono text-muted-foreground flex items-center gap-1.5">
                            {key} {isLocked && <span title="Khóa bởi admin — server tự áp giá trị, request không được gửi trường này" className="text-[10px] bg-amber-100 text-amber-700 px-1 py-0 rounded">🔒</span>}
                          </label>
                          {/* A locked param is read-only here: it is not part of the
                              request, so letting it be edited would promise an effect
                              the test run cannot have. */}
                          {hasOptions ? (
                            <select
                              value={testParams[key] ?? ''}
                              disabled={isLocked}
                              onChange={e => setTestParams({ ...testParams, [key]: e.target.value })}
                              className="input-field text-xs py-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              <option value="">-- Trống --</option>
                              {schema.options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={testParams[key] ?? ''}
                              readOnly={isLocked}
                              onChange={e => setTestParams({ ...testParams, [key]: e.target.value })}
                              placeholder={schema?.default ? `Mặc định: ${schema.default}` : 'Trống'}
                              className={`input-field text-xs py-1.5 ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                            />
                          )}
                          {isLocked && (
                            <span className="text-[10px] text-muted-foreground">Server tự áp giá trị này.</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">File kiểm thử <span className="text-xs font-normal text-muted-foreground">(tuỳ chọn)</span></label>
                <div className="border-2 border-dashed border-border rounded-xl p-4 hover:border-violet-400 dark:hover:border-violet-600 transition-colors">
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,.heic,.heif"
                    className="w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 dark:file:bg-violet-900/40 dark:file:text-violet-300 cursor-pointer"
                    onChange={e => { setTestFiles(Array.from(e.target.files ?? [])); setTestResult(null); }}
                  />
                  {testFiles.length > 0 && (
                    <p className="text-xs text-violet-700 dark:text-violet-300 mt-2 font-medium">✓ Đã chọn {testFiles.length} file: {testFiles.map(f => f.name).join(', ')}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">Remote URLs <span className="text-xs font-normal text-muted-foreground">(tuỳ chọn)</span></label>
                <div className="border border-border rounded-xl p-4 hover:border-violet-400 dark:hover:border-violet-600 transition-colors bg-muted/10">
                  <p className="text-xs text-muted-foreground mb-2">Nhập danh sách <code className="bg-muted px-1 rounded">file_urls</code> cần hệ thống download, mỗi URL một dòng.</p>
                  <textarea
                    className="w-full input-field text-xs font-mono min-h-[80px]"
                    placeholder="https://example.com/file1.pdf&#10;https://example.com/file2.docx"
                    value={testFileUrlsRaw}
                    onChange={(e) => {
                      setTestFileUrlsRaw(e.target.value);
                      setTestResult(null);
                    }}
                  />
                  {testFileUrlsRaw.trim() && (
                    <p className="text-xs text-violet-700 dark:text-violet-300 mt-2 font-medium">
                      ✓ Sẽ tải {testFileUrlsRaw.split('\n').filter(l => l.trim()).length} URL.
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={handleTestEndpoint}
                disabled={testing}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white font-semibold rounded-xl shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {testing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                {testing ? 'Đang thực thi Pipeline...' : 'Chạy Test'}
              </button>

              {/* Result Panel */}
              {testResult && (
                <div className={`rounded-xl border text-sm space-y-4 overflow-hidden ${!testFailed
                  ? 'border-green-300 dark:border-green-800'
                  : 'border-red-300 dark:border-red-800'
                  }`}>
                  {/* Status Bar */}
                  <div className={`px-4 py-3 flex items-center gap-2 font-semibold ${!testFailed
                    ? 'bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300'
                    : 'bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300'
                    }`}>
                    {!testFailed
                      ? <><CheckCircle className="w-4 h-4" /> Thành công (HTTP 200)</>
                      : <><XCircle className="w-4 h-4" /> Thất bại {testResult.status === 200
                          ? '(HTTP 200 — pipeline FAILED)'
                          : testResult.status === 0
                            ? '(không gọi được API)'
                            : `(HTTP ${testResult.status})`}</>}
                  </div>

                  <div className="px-4 pb-4 space-y-4">
                    {/* cURL block */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Payload cURL</p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(String(generateTestCurl()));
                            toast.success('Đã copy cURL!');
                          }}
                          className="flex items-center gap-1.5 text-[10px] bg-muted/60 hover:bg-muted text-foreground px-2 py-1 rounded border border-border transition-colors font-medium"
                        >
                          <Copy className="w-3 h-3" /> Copy
                        </button>
                      </div>
                      <pre className="bg-slate-900 border border-slate-800 p-3 rounded-lg overflow-x-auto text-[11px] font-mono text-slate-300 leading-relaxed max-h-48 overflow-y-auto select-all">
                        {String(generateTestCurl())}
                      </pre>
                    </div>

                    {testResult.data?.result?.extracted_data && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Extracted Data</p>
                          <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(testResult.data.result.extracted_data, null, 2)); toast.success('Đã copy!'); }} className="text-[10px] bg-muted/60 hover:bg-muted text-foreground px-2 py-1 rounded border border-border transition-colors font-medium flex items-center gap-1"><Copy className="w-3 h-3" /> Copy</button>
                        </div>
                        <pre className="bg-muted/50 border border-border p-3 rounded-lg overflow-x-auto text-xs max-h-72 overflow-y-auto font-mono">{JSON.stringify(testResult.data.result.extracted_data, null, 2)}</pre>
                      </div>
                    )}

                    {testResult.data?.result?.content && !testResult.data?.result?.extracted_data && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Content</p>
                          <button onClick={() => { navigator.clipboard.writeText(testResult.data.result.content); toast.success('Đã copy!'); }} className="text-[10px] bg-muted/60 hover:bg-muted text-foreground px-2 py-1 rounded border border-border transition-colors font-medium flex items-center gap-1"><Copy className="w-3 h-3" /> Copy</button>
                        </div>
                        <pre className="bg-muted/50 border border-border p-3 rounded-lg overflow-x-auto text-xs whitespace-pre-wrap max-h-72 overflow-y-auto font-mono">{testResult.data.result.content}</pre>
                      </div>
                    )}

                    {testResult.data?.error && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-semibold text-xs uppercase tracking-wide text-red-600 dark:text-red-400">Error Details</p>
                          <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(testResult.data.error, null, 2)); toast.success('Đã copy lỗi!'); }} className="text-[10px] bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-2 py-1 rounded border border-red-200 dark:border-red-800 transition-colors font-medium flex items-center gap-1"><Copy className="w-3 h-3" /> Copy</button>
                        </div>
                        <pre className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-3 rounded-lg text-xs text-red-800 dark:text-red-300 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">{JSON.stringify(testResult.data.error, null, 2)}</pre>
                      </div>
                    )}

                    {!testResult.data?.result && !testResult.data?.error && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Raw Response</p>
                          <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(testResult.data, null, 2)); toast.success('Đã copy Json!'); }} className="text-[10px] bg-muted/60 hover:bg-muted text-foreground px-2 py-1 rounded border border-border transition-colors font-medium flex items-center gap-1"><Copy className="w-3 h-3" /> Copy Raw</button>
                        </div>
                        <pre className="bg-muted/50 border border-border p-3 rounded-lg overflow-x-auto text-xs max-h-72 overflow-y-auto font-mono">{JSON.stringify(testResult.data, null, 2)}</pre>
                      </div>
                    )}

                    {testResult.data?.result?.usage && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                        <span className="inline-flex items-center gap-1 bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold">
                          Model: {testResult.data.result.usage.model_used || 'N/A'}
                        </span>
                        <span className="inline-flex items-center gap-1 bg-muted px-2.5 py-1 rounded-lg text-xs font-mono">
                          IN: {testResult.data.result.usage.input_tokens} tokens
                        </span>
                        <span className="inline-flex items-center gap-1 bg-muted px-2.5 py-1 rounded-lg text-xs font-mono">
                          OUT: {testResult.data.result.usage.output_tokens} tokens
                        </span>
                        <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold">
                          Cost: ${testResult.data.result.usage.cost_usd?.toFixed(5)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {canManageEndpoints && (isActive || isEditing) && isEditing && (
        <div className="px-4 pb-4 border-t border-border bg-card/50 rounded-b-xl animate-in fade-in fill-mode-forwards">
          <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-6">

            {/* PRIORITY SELECTOR */}
            {canManageEndpoints && (
              <div className="sm:col-span-2 flex items-center justify-between py-3 px-4 bg-muted/30 border border-border rounded-xl mb-2">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-foreground">Job Priority</span>
                  <span className="text-xs text-muted-foreground mt-0.5">Độ ưu tiên trong BullMQ queue khi endpoint này được gọi</span>
                </div>
                <div className="flex gap-1 bg-background p-0.5 rounded-lg border border-border shadow-sm">
                  {(['LOW', 'MEDIUM', 'HIGH'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setJobPriority(level)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                        jobPriority === level
                          ? level === 'HIGH'
                            ? 'bg-green-500 text-white shadow-sm'
                            : level === 'LOW'
                              ? 'bg-slate-400 text-white shadow-sm'
                              : 'bg-indigo-500 text-white shadow-sm'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      {level === 'HIGH' ? '⚡ High' : level === 'LOW' ? '🐢 Low' : '— Medium'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <EndpointIntegrationEditor
              value={endpointIntegration}
              onChange={setEndpointIntegration}
              hasLegacyCspParams={Boolean(endpoint.isWorkflow && hasLegacyCspParams)}
              hasProfileCallbackAuth={hasProfileCallbackAuth}
              onCopyLegacyCspAuth={copyLegacyCspAuthToProfile}
              onClearLegacyCspParams={clearLegacyCspParams}
            />

            {/* ALLOWED FILE EXTENSIONS SECTION */}
            {canManageEndpoints && (
              <div className="sm:col-span-2">
                <label className="flex flex-col">
                  <span className="text-sm font-semibold text-foreground mb-1">Allowed File Extensions</span>
                  <span className="text-xs text-muted-foreground mb-2">Định dạng file được phép tải lên. Phân cách bằng dấu phẩy (vd: <code className="bg-muted px-1 rounded">.pdf, .jpg, .png</code>). Để trống thì dùng mặc định theo endpoint (PDF + ảnh; thêm .docx/.xlsx cho các endpoint hỗ trợ parse nội bộ).</span>
                  <input
                    type="text"
                    placeholder=".pdf, .jpg, .png"
                    value={allowedFileExtensions}
                    onChange={(e) => setAllowedFileExtensions(e.target.value)}
                    className="input-field text-sm font-mono w-full sm:w-1/2"
                  />
                </label>
              </div>
            )}

            {/* REFERENCE FIELD FOR OPS SEARCH */}
            {canManageEndpoints && (
              <div className="sm:col-span-2">
                <label className="flex flex-col">
                  <span className="text-sm font-semibold text-foreground mb-1">Reference Field (Ops Search)</span>
                  <span className="text-xs text-muted-foreground mb-2">
                    Tên field trong body request dùng làm mã tham chiếu cho vận hành tìm kiếm trên trang Operations.
                    Cú pháp: <code className="bg-muted px-1 rounded">deal_id</code> (simple field),{' '}
                    <code className="bg-muted px-1 rounded">_filename</code> (tên file),{' '}
                    <code className="bg-muted px-1 rounded">data.case_id</code> (nested JSON),{' '}
                    <code className="bg-muted px-1 rounded">process/deal_id</code> (gộp nhiều field).
                    Để trống nếu không cần.
                  </span>
                  <input
                    type="text"
                    placeholder="VD: deal_id, _filename, reference_data.case_id"
                    value={referenceExtract}
                    onChange={(e) => setReferenceExtract(e.target.value)}
                    className="input-field text-sm font-mono w-full sm:w-1/2"
                  />
                </label>
              </div>
            )}

            {/* CURL PREVIEW SECTION */}
            <div className="sm:col-span-2">
              <div
                className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2 cursor-pointer hover:bg-muted/50 w-fit p-1.5 -ml-1.5 rounded transition-colors select-none"
                onClick={() => setIsCurlOpen(!isCurlOpen)}
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${isCurlOpen ? '' : '-rotate-90'}`} />
                <Code className="w-4 h-4" /> API Integration (cURL)
              </div>

              {isCurlOpen && (
                <div className="relative animate-in fade-in mt-2 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2 flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">cURL Example (multipart/form-data)</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(String(generateCurl()));
                        toast.success('Đã copy cURL!');
                      }}
                      className="text-xs flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 px-2 py-1 rounded"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                  </div>
                  {/* cURL preview switches. They live here, next to the sample they
                      control, so the effect is visible in the same glance. They are
                      session-only: nothing below is saved to the endpoint. */}
                  <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-800 space-y-2">
                    <p className="text-[11px] text-muted-foreground">Các lựa chọn dưới đây chỉ thay đổi <strong>mẫu cURL</strong> bên dưới — không lưu và không ảnh hưởng runtime.</p>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                      <span className="font-medium text-muted-foreground">Kiểu đầu vào:</span>
                      {INPUT_MODES.map(mode => (
                        <label key={mode.value} className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            checked={endpointIntegration.inputMode === mode.value}
                            onChange={() => setEndpointIntegration(current => ({ ...current, inputMode: mode.value }))}
                          />
                          {mode.label}
                        </label>
                      ))}
                      <label className="flex items-center gap-1.5 sm:ml-auto">
                        <input
                          type="checkbox"
                          checked={endpointIntegration.curlIncludeCallback}
                          onChange={event => setEndpointIntegration(current => ({ ...current, curlIncludeCallback: event.target.checked }))}
                        />
                        Hiện <code className="bg-muted px-1 rounded">callback_url</code>
                      </label>
                    </div>
                  </div>
                  <pre className="p-4 text-xs font-mono bg-white dark:bg-[#0d1117] text-slate-800 dark:text-slate-200 overflow-x-auto m-0 leading-relaxed">
                    {String(generateCurl())}
                  </pre>
                  <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800 text-[11px] text-muted-foreground space-y-1">
                    <p>🔒 DU tự xác thực khi tải <code className="bg-muted px-1 rounded">file_urls</code> theo cấu hình Profile (không đưa secret vào cURL).</p>
                    <p>💡 <code className="bg-muted px-1 rounded">x-correlation-id</code> và <code className="bg-muted px-1 rounded">idempotency-key</code> là <strong>optional</strong> — khuyến nghị gửi để hỗ trợ troubleshooting và chống gửi trùng.
                    Response luôn chứa <code className="bg-muted px-1 rounded">X-Operation-ID</code> header — nên log giá trị này.</p>
                  </div>
                </div>
              )}
            </div>

            {/* CORE SETTINGS HEADER */}
            <div
              className="sm:col-span-2 flex items-center gap-2 border-b border-border pb-2 cursor-pointer hover:bg-muted/50 rounded px-2 -mx-2 transition-colors select-none"
              onClick={() => setIsParamsOpen(!isParamsOpen)}
            >
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isParamsOpen ? '' : '-rotate-90'}`} />
              <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Parameters Configuration</span>
              {Object.keys(paramsObj).length > 0 && (
                <span className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-2 py-0.5 rounded-full font-semibold">
                  {Object.keys(paramsObj).length} tham số
                </span>
              )}
            </div>

            {isParamsOpen && (
              <div className="sm:col-span-2">
                <div className="animate-in fade-in">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <label className="text-sm font-bold text-foreground flex items-center gap-2">
                        <FileText className="w-4 h-4 text-indigo-500" /> 🎯 Tham số Cấu hình (Params)
                      </label>
                      <p className="text-xs text-muted-foreground mt-0.5">Giá trị khởi tạo khi Pipeline chạy. Bật khóa 🔒 để cấm Client ghi đè.</p>
                    </div>
                    <button onClick={() => toggleRawMode(!showRaw)} disabled={!canManageEndpoints} title={!canManageEndpoints ? 'Bạn không có quyền chỉnh sửa tham số endpoint.' : undefined} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50">
                      <Code className="w-3 h-3" /> {showRaw ? 'Form' : 'Raw JSON'}
                    </button>
                  </div>
                  {showRaw ? (
                    <div className="space-y-2">
                      {/* The textarea is backed by its own draft string. Deriving its
                          value from paramsObj meant every keystroke that left the JSON
                          momentarily invalid — including the very first `{` — was
                          discarded, and the silent catch gave no feedback at all. */}
                      <textarea
                        value={rawParamsDraft}
                        disabled={!canManageEndpoints}
                        onChange={e => updateRawParams(e.target.value)}
                        spellCheck={false}
                        aria-invalid={Boolean(rawParamsError)}
                        className={`w-full bg-background border rounded-lg p-3 font-mono text-xs leading-relaxed min-h-[140px] focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-70 ${rawParamsError ? 'border-red-400 dark:border-red-800' : 'border-border'}`}
                        placeholder={'{\n  "output_format": { "value": "json", "isLocked": false }\n}'}
                      />
                      {rawParamsError
                        ? <p className="text-xs text-red-600 dark:text-red-400 font-medium">{rawParamsError}</p>
                        : <p className="text-xs text-muted-foreground">JSON hợp lệ. Thay đổi đã được áp vào bản nháp.</p>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Object.values(endpoint.parametersSchema || {}).some((schema: any) => schema.deprecated) && <div className="rounded-lg border border-slate-300/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Tham số legacy (sẽ bỏ)</span> được hiển thị cuối danh sách với nhãn Legacy; hãy chuyển sang Profile Integration Auth trước khi xoá.</div>}
                      {Array.from(new Set([...Object.keys(endpoint.parametersSchema || {}), ...Object.keys(paramsObj)])).sort((left, right) => Number(Boolean((endpoint.parametersSchema as any)?.[left]?.deprecated)) - Number(Boolean((endpoint.parametersSchema as any)?.[right]?.deprecated))).map(key => {
                        // _workflowPrompts / _workflowModels / _workflowReasoningEfforts are
                        // internal maps (stepKey -> value) owned entirely by WorkflowPromptPanel
                        // below. The generic editor here only supports scalar string values, so
                        // rendering these object-valued keys just shows "[object Object]" and —
                        // worse — lets an admin overwrite the whole map with that literal string
                        // if they type into the box. Keep them out of this list; the dedicated
                        // per-step Model/Prompt/reasoning_effort override UI is the only place
                        // that should ever write to them.
                        if (key.startsWith('_workflow')) return null;
                        // Same reasoning for the loan-appraisal check set: these two keys hold
                        // structured objects owned by LoanCheckSetPanel. The scalar editor would
                        // show "[object Object]" and overwrite the whole rule set with that string.
                        if (PANEL_OWNED_OBJECT_PARAMS.has(key)) return null;
                        const schema = (endpoint.parametersSchema as any)?.[key];
                        if (!shouldDisplayProfileParameter(schema, paramsObj, key, endpoint.parametersSchema as any)) return null;
                        const paramConfig = paramsObj[key] ?? { value: '', isLocked: schema?.defaultLocked ?? false };
                        if (schema) {
                          return renderSchemaInput(
                            key,
                            schema,
                            paramConfig.value,
                            paramConfig.isLocked,
                            (locked) => setParamsObj(prev => ({ ...prev, [key]: { ...prev[key], isLocked: locked } })),
                            (v) => {
                              setParamsObj(prev => {
                                const n = { ...prev };
                                if (v === '' || v === undefined) {
                                  delete n[key];
                                } else {
                                  n[key] = { value: v, isLocked: n[key]?.isLocked ?? schema.defaultLocked ?? false };
                                }
                                return n;
                              });
                            },
                            () => setParamsObj(prev => { const n = { ...prev }; delete n[key]; return n; })
                          );
                        }
                        return (
                          <div key={key} className={`flex items-center gap-2 bg-background p-2.5 rounded-lg border border-dashed transition-colors ${paramConfig.isLocked ? 'border-amber-300 bg-amber-50/30 dark:bg-amber-950/20' : 'border-indigo-200 dark:border-indigo-900/40'}`}>
                          <span className="font-mono text-[11px] bg-muted text-foreground px-1.5 py-0.5 rounded shrink-0">{key}</span>
                          {!canManageEndpoints
                            ? (paramConfig.isLocked
                              ? <span className="px-1.5 py-0.5 font-bold rounded text-[10px] uppercase shrink-0 text-amber-700 border border-amber-500/30 bg-amber-50 dark:bg-amber-950/30">🔒 Khoá bởi admin</span>
                              : <span className="px-1.5 py-0.5 font-bold rounded text-[10px] uppercase shrink-0 text-slate-600 border border-slate-300 bg-slate-100 dark:bg-slate-900">Client ghi đè được</span>)
                            : (paramConfig.isLocked
                              ? <button onClick={() => setParamsObj(prev => ({ ...prev, [key]: { ...prev[key], isLocked: false } }))} title="Đang khoá: Client KHÔNG đè được. Bấm để cho phép Client ghi đè." className="px-1.5 py-0.5 font-bold rounded text-[10px] uppercase transition-colors shrink-0 text-amber-700 border border-amber-500/30 bg-amber-50 dark:bg-amber-950/30">🔒 Khoá bởi admin</button>
                              : <button onClick={() => setParamsObj(prev => ({ ...prev, [key]: { ...prev[key], isLocked: true } }))} title="Đang mở: Client được ghi đè. Bấm để khoá." className="px-1.5 py-0.5 font-bold rounded text-[10px] uppercase transition-colors shrink-0 text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30">✏️ Cho phép Client ghi đè</button>)}
                          <input type="text" value={String(paramConfig.value ?? '')} disabled={!canManageEndpoints} onChange={e => setParamsObj(prev => ({ ...prev, [key]: { ...prev[key], value: e.target.value } }))} className="input-field py-1 text-xs font-mono flex-1 min-w-0 disabled:cursor-not-allowed disabled:opacity-70" />
                          {canManageEndpoints && <button onClick={() => setParamsObj(prev => { const n = { ...prev }; delete n[key]; return n; })} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 rounded shrink-0"><X className="w-3.5 h-3.5" /></button>}
                        </div>
                        );
                      })}
                      {Object.keys(paramsObj).length === 0 && (
                        <div className="text-xs text-muted-foreground py-3 text-center bg-muted/30 rounded-lg border border-dashed">Chưa cấu hình tham số nào.</div>
                      )}
                      <div className="flex items-center gap-2 pt-1 mt-4">
                        <input
                          list={`keys-${endpoint.slug}`}
                          value={addKey}
                          onChange={e => setAddKey(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && addKey.trim()) {
                              const schema = (endpoint.parametersSchema as any)?.[addKey.trim()];
                              setParamsObj(prev => ({ ...prev, [addKey.trim()]: { value: '', isLocked: schema?.defaultLocked ?? false } }));
                              setAddKey('');
                            }
                          }}
                          placeholder="+ Thêm tham số... (Enter để thêm)"
                          className="input-field py-1.5 text-xs font-mono flex-1 min-w-0"
                        />
                        <datalist id={`keys-${endpoint.slug}`}>
                          {Object.keys(endpoint.parametersSchema || {}).filter(k => paramsObj[k] === undefined).map(k => <option key={k} value={k} />)}
                        </datalist>
                        <button
                          onClick={() => {
                            if (addKey.trim()) {
                              const schema = (endpoint.parametersSchema as any)?.[addKey.trim()];
                              setParamsObj(prev => ({ ...prev, [addKey.trim()]: { value: '', isLocked: schema?.defaultLocked ?? false } }));
                              setAddKey('');
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 transition-colors shrink-0"
                        >+ Thêm</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PIPELINE PROCESSORS + CONNECTION ROUTING — Hidden for workflows (code-driven) */}
            {!endpoint.isWorkflow && (
            <div className="sm:col-span-2 mt-4 pt-4 border-t border-border/50">
              <div
                className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 cursor-pointer hover:bg-muted/50 w-fit p-1.5 -ml-1.5 rounded transition-colors select-none"
                onClick={() => setIsProcessorsOpen(!isProcessorsOpen)}
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${isProcessorsOpen ? '' : '-rotate-90'}`} />
                Pipeline Processors ({(connectionsOverride || (endpoint.connections || []).map((s: string) => ({ slug: s }))).length} Bước)
                {connectionsOverride && connectionsOverride.length > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 px-2 py-0.5 rounded-sm ml-1">
                    Routing Override
                  </span>
                )}
                {/* resetToDefaultConnections existed but had no control wired to it,
                    so an override could never be undone from the UI. */}
                {canManageEndpoints && connectionsOverride && (
                  <button
                    type="button"
                    onClick={event => { event.stopPropagation(); resetToDefaultConnections(); }}
                    className="ml-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors normal-case"
                    title="Bỏ routing override, dùng lại pipeline mặc định của endpoint"
                  >
                    Về mặc định
                  </button>
                )}
              </div>

              {isProcessorsOpen && (
                <>
                  <div className="mb-4 bg-muted/40 border border-muted-foreground/20 rounded-lg p-3 text-xs text-muted-foreground leading-relaxed flex gap-2 items-start">
                    <PlugZap className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-foreground flex items-center gap-1"><Code className="w-3.5 h-3.5" /> Hướng dẫn Mapping Variable: </strong>
                      Mỗi bước trong pipeline sẽ tự động nhận kết quả từ bước liền trước đó. Tại <strong>Prompt Override</strong> của bước tiếp theo, bạn chỉ cần sử dụng biến <code className="bg-muted px-1 py-0.5 rounded border border-border/50 font-semibold">{`{{input_content}}`}</code> để chèn dữ liệu đầu vào.
                    </div>
                  </div>
                  <div className="space-y-4 mb-4">
                    {((connectionsOverride || (endpoint.connections || []).map((s: string) => ({ slug: s }))).map((step: ConnStep, idx: number, arr: ConnStep[]) => {
                      const slug = step.slug;
                      const cData = allConnectors.find((c: any) => c.slug === slug);
                      if (!cData) return null;

                      const connId = cData.id;
                      // Prompt the admin actually edits/overrides: user_prompt for AIHub,
                      // defaultPrompt for multipart (falls back to raw defaultPrompt).
                      const promptBaseline = cData.effectivePrompt ?? cData.defaultPrompt ?? '';
                      // Read-only reference shown in the UI. For AIHub, surface BOTH the
                      // system_prompt (often carries the extraction schema) and user_prompt
                      // instead of the meaningless JSON chat-body wrapper.
                      const promptForDisplay = cData.connectionMode === 'AIHUB'
                        ? [
                            cData.systemPrompt ? `# system_prompt\n${cData.systemPrompt}` : '',
                            cData.effectivePrompt ? `# user_prompt\n${cData.effectivePrompt}` : '',
                          ].filter(Boolean).join('\n\n') || (cData.defaultPrompt ?? '')
                        : promptBaseline;
                      // Use stepId as override key (supports multiple steps with same connector)
                      const overrideKey = overrideKeyFor(step, connId);
                      const overrideValue = extOverridesState[overrideKey];
                      const modelOverrideValue = extModelOverridesState[overrideKey];
                      const reasoningEffortOverrideValue = extReasoningEffortOverridesState[overrideKey];
                      const isOverridden = overrideValue !== null && overrideValue !== undefined;
                      const hasSessionConfig = !!(step.captureSession || step.injectSession);

                      return (
                        <div key={`${connId}-${idx}`} className="flex flex-col">
                          {idx > 0 && (
                            <div className="flex justify-center -mt-2 mb-2">
                              <div className="w-px h-6 bg-border"></div>
                            </div>
                          )}

                          <div className={`bg-background rounded-xl border ${connectionsOverride ? 'border-teal-300 dark:border-teal-800' : 'border-border opacity-90'} shadow-sm overflow-hidden`}>
                            <div className="bg-muted/50 px-4 py-3 border-b border-border flex flex-col xl:flex-row justify-between xl:items-center gap-3">
                              <div className="flex items-center gap-2 text-sm font-medium flex-wrap">
                                <GripVertical className="w-4 h-4 text-muted-foreground/50 flex-shrink-0 cursor-grab" />
                                <span className="bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-400 w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold shrink-0">
                                  {idx + 1}
                                </span>
                                <PlugZap className="w-4 h-4 text-violet-500 shrink-0" />
                                <span className="font-bold">{cData.name}</span>
                                <span className="text-[10px] bg-background border px-1.5 py-0.5 rounded text-muted-foreground">{cData.slug}</span>
                                {isOverridden && (
                                  <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-100 text-violet-700 px-2 py-0.5 rounded-sm ml-2">
                                    Custom Override
                                  </span>
                                )}
                                {hasSessionConfig && (
                                  <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-2 py-0.5 rounded-sm">
                                    Session
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  onClick={() => moveConnection(idx, -1)}
                                  disabled={idx === 0}
                                  className="p-1.5 rounded-lg border border-transparent hover:border-border hover:bg-muted disabled:opacity-30 text-muted-foreground transition-colors"
                                  title="Di chuyển lên"
                                >▲</button>
                                <button
                                  onClick={() => moveConnection(idx, 1)}
                                  disabled={idx === arr.length - 1}
                                  className="p-1.5 rounded-lg border border-transparent hover:border-border hover:bg-muted disabled:opacity-30 text-muted-foreground transition-colors"
                                  title="Di chuyển xuống"
                                >▼</button>

                                <div className="w-px h-4 bg-border mx-1 hidden sm:block"></div>

                                <button
                                  onClick={() => {
                                    setExtOverridesState(prev => ({
                                      ...prev,
                                      [overrideKey]: isOverridden ? null : (promptBaseline || null)
                                    }));
                                  }}
                                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors shrink-0 ${isOverridden
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/70'
                                    : 'bg-background border border-border text-foreground hover:bg-muted font-medium'
                                    }`}
                                >
                                  {isOverridden ? 'Bỏ Custom Prompt' : 'Tùy chỉnh Prompt'}
                                </button>

                                <button
                                  onClick={() => removeConnection(idx)}
                                  className="p-1.5 ml-1 rounded-lg border border-transparent hover:border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"
                                  title="Xoá Connector Này"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            <div className="p-4 space-y-4">
                              {/* Session ID Chaining — endpoint-level override */}
                              <div className="border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 bg-indigo-50/50 dark:bg-indigo-950/20">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-2 flex items-center gap-1">
                                  <Zap className="w-3 h-3" /> Session ID Chaining (Override)
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-xs text-muted-foreground block mb-1">Capture từ Response</label>
                                    <input
                                      className="input-field font-mono text-xs py-1"
                                      value={step.captureSession ?? ''}
                                      onChange={e => updateStepSession(idx, 'captureSession', e.target.value)}
                                      placeholder="result.session_id"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs text-muted-foreground block mb-1">Inject vào Request</label>
                                    <input
                                      className="input-field font-mono text-xs py-1"
                                      value={step.injectSession ?? ''}
                                      onChange={e => updateStepSession(idx, 'injectSession', e.target.value)}
                                      placeholder="session_id"
                                    />
                                  </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-1.5">
                                  Override mức endpoint (ưu tiên hơn cấu hình tại Connector).
                                </p>
                              </div>

                              {/* Model override — override model (model name) cho bước này theo Profile */}
                              <div className="border border-sky-200 dark:border-sky-800 rounded-lg p-3 bg-sky-50/50 dark:bg-sky-950/20">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 mb-2 flex items-center gap-1">
                                  <PlugZap className="w-3 h-3" /> Model Override
                                </div>
                                <input
                                  className="input-field font-mono text-xs py-1.5"
                                  maxLength={200}
                                  value={modelOverrideValue ?? ''}
                                  onChange={(e) =>
                                    setExtModelOverridesState(prev => ({
                                      ...prev,
                                      [overrideKey]: e.target.value === '' ? null : e.target.value,
                                    }))
                                  }
                                  placeholder={cData.defaultModel ? `Mặc định: ${cData.defaultModel}` : 'VD: gpt-4o, gemini-2.5-flash'}
                                />
                                <p className="text-[10px] text-muted-foreground mt-1.5">
                                  Để trống = dùng model mặc định của Connector{cData.defaultModel ? ` (${cData.defaultModel})` : ''}. Ghi đè trường <code className="bg-muted px-1 rounded">model</code> khi gọi AI.
                                </p>
                              </div>

                              {/* reasoning_effort override — OpenAI-compatible, override theo Profile */}
                              <div className="border border-sky-200 dark:border-sky-800 rounded-lg p-3 bg-sky-50/50 dark:bg-sky-950/20">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 mb-2 flex items-center gap-1">
                                  <PlugZap className="w-3 h-3" /> reasoning_effort Override
                                </div>
                                <select
                                  className="input-field font-mono text-xs py-1.5"
                                  value={reasoningEffortOverrideValue ?? ''}
                                  onChange={(e) =>
                                    setExtReasoningEffortOverridesState(prev => ({
                                      ...prev,
                                      [overrideKey]: e.target.value === '' ? null : e.target.value,
                                    }))
                                  }
                                >
                                  <option value="">
                                    {cData.defaultReasoningEffort ? `Mặc định: ${cData.defaultReasoningEffort}` : 'Mặc định (theo Connector)'}
                                  </option>
                                  <option value="minimal">minimal</option>
                                  <option value="low">low</option>
                                  <option value="medium">medium</option>
                                  <option value="high">high</option>
                                </select>
                                <p className="text-[10px] text-muted-foreground mt-1.5">
                                  Để trống = dùng mặc định của Connector{cData.defaultReasoningEffort ? ` (${cData.defaultReasoningEffort})` : ''}. Ghi đè trường <code className="bg-muted px-1 rounded">reasoning_effort</code> (OpenAI-compatible) khi gọi AI.
                                </p>
                              </div>

                              {/* Prompt override */}
                              {isOverridden ? (
                                <div className="space-y-2 animate-in fade-in zoom-in-95 duration-200">
                                  <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold flex items-center gap-1 text-violet-600 dark:text-violet-400">
                                      Prompt Override Content <span className="font-normal text-muted-foreground mr-1">— Mapping output:</span> <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">{`{{input_content}}`}</code>
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => setWizardOpen(prev => ({ ...prev, [overrideKey]: !prev[overrideKey] }))}
                                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${wizardOpen[overrideKey] ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700' : 'bg-background border-border text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                                      title="Nâng cấp prompt với AI"
                                    >
                                      <Wand2 className="w-3.5 h-3.5" />
                                      AI Wizard
                                    </button>
                                  </div>
                                  <textarea
                                    value={overrideValue ?? ''}
                                    onChange={(e) => setExtOverridesState(prev => ({ ...prev, [overrideKey]: e.target.value }))}
                                    className="w-full text-sm font-mono p-3 rounded-lg border border-violet-200 dark:border-violet-900 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 bg-violet-50/10 dark:bg-violet-950/20 outline-none leading-relaxed shadow-inner min-h-[140px]"
                                    placeholder="Nhập prompt override cho bước này (sử dụng biến {{input_content}} để ghép với dữ liệu đầu ra từ bước trước)..."
                                  />

                                  {/* ── Prompt Wizard Panel ── */}
                                  {wizardOpen[overrideKey] && (
                                    <div className="animate-in slide-in-from-top-2 duration-200 border border-violet-200 dark:border-violet-800 rounded-xl bg-violet-50/40 dark:bg-violet-950/20 p-4 space-y-3">
                                      <div className="flex items-center gap-2">
                                        <Wand2 className="w-4 h-4 text-violet-500 shrink-0" />
                                        <span className="text-sm font-bold text-violet-700 dark:text-violet-300">Prompt Wizard</span>
                                        <span className="text-xs text-muted-foreground">— Mô tả vấn đề để AI viết lại prompt tốt hơn</span>
                                      </div>

                                      <div>
                                        <label className="text-xs font-semibold text-foreground block mb-1">
                                          Vấn đề đang gặp <span className="text-muted-foreground font-normal">(tuỳ chọn)</span>
                                        </label>
                                        <textarea
                                          value={wizardProblem[overrideKey] ?? ''}
                                          onChange={e => setWizardProblem(prev => ({ ...prev, [overrideKey]: e.target.value }))}
                                          rows={3}
                                          className="w-full text-sm p-3 rounded-lg border border-border focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 bg-background outline-none leading-relaxed resize-none"
                                          placeholder="VD: Model hay bỏ sót trường 'ngày ký', output JSON bị thiếu dấu ngoặc, prompt quá dài gây chậm..."
                                        />
                                      </div>

                                      <div className="flex justify-end">
                                        <button
                                          type="button"
                                          disabled={wizardLoading[overrideKey]}
                                          onClick={async () => {
                                            setWizardLoading(prev => ({ ...prev, [overrideKey]: true }));
                                            setWizardResult(prev => ({ ...prev, [overrideKey]: '' }));
                                            try {
                                              const res = await fetch('/api/internal/prompt-wizard', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                  currentPrompt: overrideValue ?? '',
                                                  problem: wizardProblem[overrideKey] ?? '',
                                                  metadata: {
                                                    endpointName: endpoint.displayName,
                                                    endpointSlug: endpoint.slug,
                                                    connectorName: cData.name,
                                                    connectorSlug: cData.slug,
                                                    stepIndex: idx,
                                                  },
                                                }),
                                              });
                                              const data = await res.json();
                                              if (data.success) {
                                                setWizardResult(prev => ({ ...prev, [overrideKey]: data.upgradedPrompt }));
                                              } else {
                                                toast.error(data.error ?? 'Lỗi không xác định');
                                              }
                                            } catch {
                                              toast.error('Lỗi kết nối khi gọi Prompt Wizard');
                                            } finally {
                                              setWizardLoading(prev => ({ ...prev, [overrideKey]: false }));
                                            }
                                          }}
                                          className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-sm font-semibold rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                        >
                                          {wizardLoading[overrideKey]
                                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang nâng cấp...</>
                                            : <><Wand2 className="w-4 h-4" /> Nâng cấp Prompt</>}
                                        </button>
                                      </div>

                                      {/* Result */}
                                      {wizardResult[overrideKey] && (
                                        <div className="space-y-2 animate-in fade-in duration-200">
                                          <div className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                                            <span className="text-xs font-bold text-green-700 dark:text-green-400">Prompt được nâng cấp:</span>
                                          </div>
                                          <pre className="text-xs font-mono bg-background border border-border rounded-lg p-3 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto text-foreground">
                                            {wizardResult[overrideKey]}
                                          </pre>
                                          <div className="flex items-center justify-end gap-2 pt-1">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setWizardOpen(prev => ({ ...prev, [overrideKey]: false }));
                                                setWizardResult(prev => ({ ...prev, [overrideKey]: '' }));
                                              }}
                                              className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border rounded-lg transition-colors"
                                            >
                                              Huỷ
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setExtOverridesState(prev => ({ ...prev, [overrideKey]: wizardResult[overrideKey] }));
                                                setWizardOpen(prev => ({ ...prev, [overrideKey]: false }));
                                                setWizardResult(prev => ({ ...prev, [overrideKey]: '' }));
                                                toast.success('Đã áp dụng prompt mới! Nhớ bấm Lưu Toàn bộ Thiết lập.');
                                              }}
                                              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-green-600 hover:bg-green-700 text-white rounded-lg shadow-sm transition-colors"
                                            >
                                              <CheckCircle className="w-3.5 h-3.5" />
                                              Áp dụng Prompt Này
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  <div className="bg-muted p-3 mt-3 rounded-lg border border-border">
                                    <details>
                                      <summary className="text-xs font-semibold text-muted-foreground cursor-pointer outline-none w-fit hover:underline">Xem Default Prompt gốc (Tham khảo)</summary>
                                      <pre className="mt-3 text-[10px] text-muted-foreground whitespace-pre-wrap font-mono p-3 bg-background border border-border rounded opacity-70">
                                        {promptForDisplay}
                                      </pre>
                                    </details>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-muted-foreground">
                                    Default Prompt (Quy định tại System){cData.connectionMode === 'AIHUB' ? ' — AIHub: system_prompt + user_prompt' : ''}
                                  </label>
                                  <pre className="text-xs text-muted-foreground font-mono bg-muted/30 p-3 rounded-lg border whitespace-pre-wrap overflow-x-auto max-h-[150px] overflow-y-auto outline-none cursor-text">
                                    {promptForDisplay}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }))
                    }
                    {((connectionsOverride || (endpoint.connections || []).map((s: string) => ({ slug: s }))).length === 0) && (
                      <p className="text-sm text-muted-foreground p-6 text-center border rounded-xl bg-background border-dashed">
                        Endpoint này xử lý Local hoặc qua các Local Processors nội bộ, không có External API Pipeline nào.
                      </p>
                    )}
                  </div>

                  {/* Add connector dropdown */}
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <details className="group relative z-40">
                      <summary className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-teal-700 bg-teal-100/50 hover:bg-teal-200/50 dark:text-teal-300 dark:bg-teal-900/30 dark:hover:bg-teal-800/40 rounded-lg cursor-pointer transition-colors list-none border border-teal-200/50 dark:border-teal-800/50">
                        <Plus className="w-4 h-4" /> Thêm Connector Để Nối Tiếp Chain
                      </summary>
                      <div className="absolute left-0 mt-2 z-50 w-72 max-h-60 overflow-y-auto bg-card border border-border rounded-xl shadow-2xl p-2 drop-shadow-xl">
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2 px-2">Chọn System Connector</p>
                        {allConnectors.map(conn => (
                          <button
                            key={conn.slug}
                            onClick={(e) => {
                              e.preventDefault();
                              addConnection(conn.slug);
                              e.currentTarget.closest('details')?.removeAttribute('open');
                            }}
                            className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors flex items-center gap-2"
                          >
                            <PlugZap className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                            <div className="flex flex-col truncate">
                              <span className="text-sm font-medium text-foreground truncate">{conn.name}</span>
                              <span className="font-mono text-[10px] text-muted-foreground truncate">{conn.slug}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </details>
                  </div>
                </>
              )}
            </div>
            )}

            {/* LOAN APPRAISAL CHECK SET — rule engine + rule LLM theo luồng/sản phẩm và
                ngưỡng policy, tách sang trang riêng /loan-appraisal/config (giống mở tài khoản). */}
            {endpoint.slug === 'workflows:loan-appraisal' && (
              <div className="sm:col-span-2 rounded-xl border border-dashed border-border bg-muted/30 p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Cấu hình thẩm định vay theo sản phẩm</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Prompt, model và mức suy luận của từng bước AI, rule engine, rule LLM, ngưỡng policy và override checklist được cấu hình theo từng sản phẩm (và luồng) ở trang riêng; không còn cấu hình theo Profile.
                  </p>
                </div>
                <Link
                  href="/loan-appraisal-v2/config"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors shrink-0"
                >
                  Mở trang cấu hình
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
              </div>
            )}

            {/* ACCOUNT OPENING CHECK SET — cấu hình phức tạp (rule engine + rule LLM +
                policy + danh mục chứng từ theo phân khúc/sản phẩm), tách sang trang
                riêng /account-opening/config để có đủ không gian thao tác. */}
            {endpoint.slug === 'workflows:account-opening' && (
              <div className="sm:col-span-2 rounded-xl border border-dashed border-border bg-muted/30 p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Bộ kiểm tra hồ sơ mở tài khoản</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Rule engine, rule LLM, ngưỡng policy và danh mục chứng từ được cấu hình ở trang riêng.
                  </p>
                </div>
                <Link
                  href={`/account-opening/config?client=${apiKeyId}`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors shrink-0"
                >
                  Mở trang cấu hình
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
              </div>
            )}

            {/* WORKFLOW PROMPT MANAGEMENT — shown only for workflow endpoints */}
            {endpoint.isWorkflow && endpoint.slug !== 'workflows:loan-appraisal' && (
              <WorkflowPromptPanel
                endpoint={endpoint}
                paramsObj={paramsObj}
                setParamsObj={setParamsObj}
                canManageEndpoints={canManageEndpoints}
                syncKey={`${apiKeyId}:${endpoint.slug}`}
              />
            )}

            <div className="sm:col-span-2 flex justify-end gap-3 pt-6 pb-2 border-t border-border/50 bg-card/50 sticky bottom-0 z-10">
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 bg-background border border-border hover:bg-muted text-sm font-semibold rounded-lg transition-colors shadow-sm"
              >
                Đóng
              </button>
              {canManageEndpoints && (
                <button
                  onClick={() => saveSettings()}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 shadow-sm transition-transform active:scale-95"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Lưu Toàn bộ Thiết lập
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Workflow Prompt Panel ──────────────────────────────────────────────────────

interface WorkflowStep {
  key: string;
  label: string;
  icon: string;
  connector: string;
  kind?: 'ai' | 'code';
  description: string;
  variables: Array<{ name: string; desc: string }>;
  codePromptPreview: string;
  hasDynamicSections: boolean;
  dynamicWarning?: string;
}

const DISBURSEMENT_STEPS: WorkflowStep[] = [
  {
    key: 'classify',
    label: 'Bước 1: AI Classify',
    icon: '🏷️',
    connector: 'ext-classifier',
    description: 'Phân loại tài liệu & tách logical documents',
    variables: [
      { name: '{{file_name}}', desc: 'Tên file đang xử lý' },
      { name: '{{categories}}', desc: 'Danh sách categories cho phép' },
    ],
    codePromptPreview: `Phân loại tài liệu "{{file_name}}" vào các nhóm.

Với mỗi nhóm tài liệu phát hiện được trong file, trả về:
- id: mã định danh duy nhất
- label: tên loại tài liệu  
- pages: phạm vi trang (ví dụ: "1-5", "6", "all")
- confidence: độ tin cậy (0.0 - 1.0)

Danh mục cho phép:
Hợp đồng tín dụng, Giấy nhận nợ, Hóa đơn GTGT, ...

Return JSON:
{ "document_type": "...", "confidence": 0.95, "logical_documents": [...] }`,
    hasDynamicSections: false,
  },
  {
    key: 'extract',
    label: 'Bước 2: OCR & Bóc tách',
    icon: '🔍',
    connector: 'ext-data-extractor',
    description: 'Trích xuất dữ liệu từ từng file (song song)',
    variables: [
      { name: '{{file_name}}', desc: 'Tên file đang xử lý' },
      { name: '{{doc_sections}}', desc: 'Danh sách tài liệu + fields cần extract (tự động từ Bước 1)' },
    ],
    codePromptPreview: `Bóc tách dữ liệu từ file "{{file_name}}".

Tài liệu chứa N phần:
{{doc_sections}}
(⬆️ Nội dung dynamic — tự tạo từ kết quả Bước 1)

Đọc toàn bộ file, tìm và trích xuất các trường yêu cầu.
Nếu không tìm thấy giá trị, ghi null.

Return JSON:
{ "file": "...", "documents": [{ "label": "...", "fields": {...} }] }`,
    hasDynamicSections: true,
    dynamicWarning: 'Phần {{doc_sections}} được tự động tạo từ kết quả classify (Bước 1). Nếu override prompt, phần dynamic này sẽ không được chèn — bạn cần tự viết hướng dẫn extract cụ thể.',
  },
  {
    key: 'crosscheck',
    label: 'Bước 3: Đối chiếu',
    icon: '⚖️',
    connector: 'ext-fact-verifier',
    description: 'Đối chiếu chéo giữa các tài liệu & Nghị quyết',
    variables: [
      { name: '{{extraction_summary}}', desc: 'Tóm tắt kết quả bóc tách từ Bước 2' },
      { name: '{{extraction_detail}}', desc: 'JSON chi tiết các file đã extract' },
      { name: '{{reference_data}}', desc: 'Nghị quyết tham chiếu (từ API parameter)' },
    ],
    codePromptPreview: `Đối chiếu chéo dữ liệu đã bóc tách với Nghị quyết.

Dữ liệu bóc tách: {{extraction_summary}}
Chi tiết: {{extraction_detail}}
Nghị quyết: {{reference_data}}

Kiểm tra: Hạn mức, Lãi suất, Thời hạn, MĐSDV, Thông tin KH, Chữ ký...

Return JSON:
{ "verdict": "PASS|FAIL|WARNING", "score": 85, "checks": [...] }`,
    hasDynamicSections: true,
    dynamicWarning: 'Phần {{extraction_summary}} và {{extraction_detail}} được tự động tạo từ kết quả Bước 2. Override prompt cần giữ các biến này.',
  },
  {
    key: 'report',
    label: 'Bước 4: Soạn Tờ trình',
    icon: '📋',
    connector: 'ext-content-gen',
    description: 'Soạn tờ trình đánh giá tuân thủ cho Ban Giám đốc',
    variables: [
      { name: '{{classify_summary}}', desc: 'Tóm tắt kết quả phân loại' },
      { name: '{{extraction_data}}', desc: 'Dữ liệu bóc tách đầy đủ' },
      { name: '{{crosscheck_verdict}}', desc: 'Verdict + score từ Bước 3' },
      { name: '{{checks_summary}}', desc: 'Tóm tắt các check PASS/FAIL/WARNING' },
    ],
    codePromptPreview: `Soạn Tờ trình đề nghị giải ngân cho Ban Giám đốc.

Kết quả phân loại: {{classify_summary}}
Kết quả bóc tách: {{extraction_data}}
Kết quả đối chiếu ({{crosscheck_verdict}}): {{checks_summary}}

Yêu cầu:
- Văn phong: Trang trọng, nghiệp vụ ngân hàng
- Đối tượng: Ban Giám đốc / Hội đồng Tín dụng
- Bao gồm: Tóm tắt hồ sơ, Kết quả đối chiếu, Đề xuất, Lưu ý
- Tối đa 1500 từ

Viết Tờ trình bằng Markdown.`,
    hasDynamicSections: true,
    dynamicWarning: 'Nhiều biến dynamic được chèn từ Bước 1-3. Override prompt cần giữ đúng cấu trúc output yêu cầu.',
  },
];

const LC_CHECKER_STEPS: WorkflowStep[] = [
  {
    key: 'classify',
    label: 'Bước 1: OCR Full-text',
    icon: '📝',
    connector: 'ext-doc-layout',
    description: 'Chuyển đổi PDF → Markdown text. Lọc page thừa (template/boilerplate).',
    variables: [
      { name: '{{file_name}}', desc: 'Tên file đang xử lý' },
    ],
    codePromptPreview: `You are a high-precision Document OCR Engine specialized in trade finance documents.

FILE: "{{file_name}}"

=== CRITICAL RULES ===

1. VERBATIM FIDELITY: Transcribe ALL text exactly as it appears.

2. SMART PAGE FILTERING — Skip pages that contain ONLY:
   - General terms & conditions / Điều kiện chung
   - Pre-printed regulatory boilerplate
   - Blank pages or separator pages
   For skipped pages, insert: "[PAGE X: Skipped — general terms/template]"

3. MUST KEEP — Always transcribe pages containing:
   - Filled-in data fields (names, amounts, dates, addresses)
   - Handwritten annotations, stamps, or signatures
   - On-board notations, endorsements, amendments
   - Tables with cargo/quantity/weight data

4. TABLE INTEGRITY: Convert tabular data to Markdown tables.

5. STRUCTURE: Use # H1, ## H2. Preserve "--- PAGE X ---" boundaries.

6. SPECIAL CHARACTERS: If truly illegible, use [illegible].`,
    hasDynamicSections: false,
  },

  {
    key: 'compliance',
    label: 'Bước 2: Kiểm tra Tuân thủ UCP 600',
    icon: '⚖️',
    connector: 'ext-fact-verifier',
    description: 'Đối chiếu theo UCP 600, ISBP 821 & phát hiện Discrepancy (Hybrid: OCR text + PDF gốc)',
    variables: [
      { name: '{{classify_summary}}', desc: 'JSON list tài liệu đã được phân loại (Mục lục)' },
      { name: '{{ocr_full_text}}', desc: 'Toàn bộ text OCR từ ext-doc-layout (primary data source)' },
    ],
    codePromptPreview: `[PROMPT ĐẦY ĐỦ ~400 DÒNG — Xem chi tiết tại: lib/pipelines/workflows/prompts/lc-checker-prompts.ts]

CẤU TRÚC PROMPT GỒM 8 PHẦN:

═══ PHẦN 0: SIÊU QUY TẮC (META-RULES) ═══
  [MR-1] Nguồn chân lý duy nhất (prompt > L/C > UCP/ISBP)
  [MR-2] Thứ tự ưu tiên ghi đè
  [MR-3] Xử lý dữ liệu bất định (OCR không chắc chắn → ADVISORY)
  [MR-4] Phá vỡ chuỗi suy luận (trường không xác định → hủy rule phụ thuộc)

═══ PHẦN 1: LOGIC LÕI HỆ THỐNG ═══
  [CL-1] Ngữ cảnh toàn cục (extracted_data, intermediate_findings, discrepancies)
  [CL-2] Thực thi hai giai đoạn (Thu thập Sự thật → Đánh giá Lỗi)
  [CL-3] Phụ thuộc quy tắc (điều kiện kích hoạt)

═══ PHẦN 2: DANH SÁCH LOẠI TRỪ ═══
  [EX-1..EX-7] Các hành vi bị CẤM (thư đòi tiền, số lượng scan, cách ly dữ liệu...)

═══ PHẦN 3: QUY TRÌNH THỰC THI TUẦN TỰ ═══
  Bước 1: Phân tích yêu cầu L/C
  Bước 2: Trích xuất & Đối chiếu chéo (2.1-2.4)
  Bước 2.5: Chuẩn hóa dữ liệu (Restricted Normalization)
  Bước 3: 13 nhóm quy tắc chuyên sâu:
    3.1 Thời hạn (Late presentation, LC expired)
    3.2 Chữ ký | 3.3 Mô tả hàng hóa | 3.4 Đặc thù VPBank
    3.5 Thư đòi tiền | 3.6 Ngôn ngữ/Tên | 3.7 Notify Party
    3.8 Ký hậu | 3.9 Phân cấp Consignee | 3.10 Shipper
    3.11 Giao hàng từng phần | 3.12 Carrier | 3.13 Phân rã chi tiết
  Bước 4: Xử lý thông tin bất định (OCR, ký tự nhầm lẫn)
  Bước 5: Kiểm tra kép (xuôi + ngược) trước khi output

═══ PHẦN 4: BẢNG KIỂM TRA TỪNG LOẠI CHỨNG TỪ ═══
  7 checklist: Draft, Invoice, Transport, Insurance, C/O, Packing List, Others

═══ PHẦN 5: BỘ RULES BASE — UCP 600 ═══
  Art 3, 14, 17, 18, 19, 20, 22, 23, 26, 27, 28, 29, 30, 31, 32

═══ PHẦN 6: BỘ RULES BASE — ISBP 821 ═══
  Nguyên tắc chung, Hối phiếu, Hóa đơn, Vận đơn, Bảo hiểm, C/O, Packing List

═══ PHẦN 7: CƠ CHẾ CƯỠNG CHẾ KIỂM TRA ═══
  [EM-1] Scratchpad nội bộ bắt buộc (7 giai đoạn trong examination_log)
  [EM-2] Bảng kích hoạt 15 quy tắc theo điều kiện (TR-1..TR-15)
  [EM-3] Tự kiểm tra sau cùng (3 câu hỏi Q1/Q2/Q3)

═══ PHẦN 8: SEVERITY VÀ OUTPUT (JSON Schema) ═══
  examination_log[], verdict, discrepancies[], recommendation

{{classify_summary}} — được tự động chèn từ Bước 1.`,
    hasDynamicSections: true,
    dynamicWarning: '{{classify_summary}} được tự động chèn từ Bước 1. Override prompt phải chỉ dẫn rõ AI đọc Raw File đính kèm và giữ nguyên định dạng output JSON.',
  },
  {
    key: 'report',
    label: 'Bước 3: Báo cáo Kiểm tra LC',
    icon: '📋',
    connector: 'ext-content-gen',
    description: 'Soạn LC Checking Report cho Cán bộ Tác nghiệp TM',
    variables: [
      { name: '{{classify_summary}}', desc: 'Tóm tắt phân loại (N file, M chứng từ)' },
      { name: '{{documents_present}}', desc: 'Danh sách chứng từ đã nộp' },
      { name: '{{documents_missing}}', desc: 'Danh sách chứng từ thiếu' },
      { name: '{{verdict}}', desc: 'Kết quả tổng hợp (COMPLIANT/DISCREPANT/PENDING)' },
      { name: '{{recommendation}}', desc: 'Đề xuất ACCEPT/REJECT/RESERVE_FOR_REVIEW' },
      { name: '{{total_discrepancies}}', desc: 'Tổng số discrepancy' },
      { name: '{{major_count}}', desc: 'Số lượng MAJOR discrepancy' },
      { name: '{{minor_count}}', desc: 'Số lượng MINOR discrepancy' },
      { name: '{{advisory_count}}', desc: 'Số lượng ADVISORY discrepancy' },
      { name: '{{discrepancy_table}}', desc: 'Bảng discrepancy dạng Markdown' },
      { name: '{{check_summary}}', desc: 'Tóm tắt kết quả từ Bước 2' },
    ],
    codePromptPreview: `You are a senior Trade Finance Officer. Produce a professional LC CHECKING REPORT (Bao cao Kiem tra Chung tu LC) in Vietnamese.

=== INPUT DATA ===

Document set: {{classify_summary}}
Documents present: {{documents_present}}
Documents not presented: {{documents_missing}}

Examination result: {{verdict}}
Recommendation: {{recommendation}}
Discrepancy count: {{total_discrepancies}} total (MAJOR: {{major_count}}, MINOR: {{minor_count}}, ADVISORY: {{advisory_count}})
Examination summary: {{check_summary}}

Discrepancy table:
| ID | Severity | Document | Field | Issue | Rule Reference |
|----|----------|----------|-------|-------|----------------|
{{discrepancy_table}}

=== REPORT STRUCTURE ===

Write a complete, formal LC Checking Report in Vietnamese using EXACTLY these sections:

## I. THONG TIN BO CHUNG TU
- List each document received: type, reference number, date, issuing party
- Note any documents not presented

## II. DANH SACH CHUNG TU
- Review the attached files and list their identifiers clearly.

## III. KET QUA KIEM TRA TUAN THU
- State overall verdict clearly (HOP LE / CO SAI LECH / CAN XEM XET)
- Full discrepancy table with UCP 600 / ISBP 821 references
- Group: MAJOR first, then MINOR, then ADVISORY
- For each MAJOR: explain why it triggers Art. 16 refusal

## IV. NHAN XET VA DE XUAT XU LY
- Professional assessment from examiner's perspective
- If COMPLIANT: recommend acceptance, note any advisory items
- If DISCREPANT: for each MAJOR — state whether correctable (request amendment) or non-correctable (recommend rejection or waiver)
- If RESERVE_FOR_REVIEW: list items requiring senior approval

## V. KET LUAN
- One unambiguous final recommendation in formal banking language
- Examiner signature line placeholder

FORMATTING:
- Language: Vietnamese (professional banking register)
- Audience: Trade Finance Operations Head, Compliance Officer
- Cite UCP 600 articles and ISBP 821 paragraphs explicitly
- Maximum 2,000 words
- Output in Markdown`,
    hasDynamicSections: true,
    dynamicWarning: 'Nhiều biến dynamic từ Bước 1-2. Override prompt cần giữ cấu trúc 5 sections và trích dẫn điều khoản UCP 600 / ISBP 821.',
  },
];

const PAYROLL_VERIFY_STEPS: WorkflowStep[] = [
  {
    key: 'extract',
    label: 'Bước 1A: Excel — Extract thông tin chung (AI)',
    icon: '📊',
    connector: 'ext-data-extractor',
    description: 'Code parse bảng Excel deterministic (100% chính xác) + lấy text NGOÀI bảng → AI trích xuất thông tin chung thành JSON flat (~56 trường). Phải hoàn tất TRƯỚC khi OCR PDF chạy để cung cấp column hint.',
    variables: [
      { name: '{{general_info_text}}', desc: 'Toàn bộ text NGOÀI bảng (above/below/between sections), tự động extract bằng code từ file Excel.' },
    ],
    codePromptPreview: `Phân tích thông tin chung từ bảng lương Excel.

Dữ liệu text phía trên bảng biểu:
---
{{general_info_text}}
---

Trích xuất thành JSON FLAT (không nested). Trả TẤT CẢ fields dưới đây, field nào không tìm thấy → null:
{
  "so_chung_tu": "string or null",
  "ngay_lap": "dd/mm/yyyy or null",
  "chi_nhanh_vpbank": "string or null",
  "ma_bieu_mau": "string or null",
  "dia_diem_lap": "string or null",
  "ma_kh_cif": "string or null",
  "dia_chi": "string or null",
  "dien_thoai": "string (chỉ số) or null",
  "fax": "string or null",
  "cmnd_cccd": "string or null",
  "ten_chu_tai_khoan": "string or null",
  "so_tai_khoan_trich_no": "string (chỉ số) or null",
  "loai_tien": "VND",
  "mo_tai": "string or null",
  "tong_so_tien_bang_so": "string (Format: 1.000.000) or null",
  "tong_so_tien_bang_chu": "string or null",
  "ngay_lenh_chi": "dd/mm/yyyy or null",
  "noi_dung_thanh_toan": "string or null",
  "muc_dich": "string or null",
  "danh_sach_chi_luong_so": "string or null",
  "tong_so_mon_bang_so": "number or null",
  "tong_so_mon_bang_chu": "string or null",
  "noi_dung_chuyen_tien": "string or null",
  "ten_don_vi_chuyen_tien": "string or null",
  "tai_khoan_trung_gian": "string or null",
  "ngay_nhan_tien_tk_trung_gian": "string or null",
  "ngay_chuyen_tien": "string or null",
  "ten_cong_ty_giay_nop_tien": "string or null",
  "tong_so_tien_file_cung": "number or null",
  "so_mon_file_cung": "number or null",
  "ngay_thuc_hien": "string or null",
  "so_tien_do_luong_lan_1": "number or null",
  "so_mon_do_luong_lan_1": "number or null",
  "ngay_do_luong_lan_1": "string or null",
  "so_tien_ton_dong": "number or null",
  "so_mon_ton_dong": "number or null",
  "ngay_ton_dong": "string or null",
  "nguyen_nhan_ton_dong": "string or null",
  "chu_tai_khoan_ky": "string or null",
  "thoi_diem_nhan_yeu_cau": "string or null",
  "thoi_diem_xu_ly_yeu_cau": "string or null",
  "ghi_chu_xu_ly": "string or null",
  "giao_dich_vien": "string or null",
  "cap_tham_quyen": "string or null",
  "co_thu_phi": "boolean or null",
  "don_vi_thu_phi": "string or null",
  "phi_phai_thu_1_mon": "number or null",
  "phi_dich_vu_thanh_toan": "number or null",
  "phi_thanh_toan_noi_bo": "number or null",
  "phi_thanh_toan_lien_ngan_hang": "number or null",
  "gio_nhan": "string or null",
  "ngay_nhan": "string or null",
  "xac_nhan_hop_le": "string or null",
  "don_vi_chuyen_tien_tai_khoan_treo": "string or null",
  "thoi_gian": "string or null",
  "tong_cong_don_vi": "number or null",
  "don_vi_tinh": "string or null"
}

Quy tắc:
- Tên đơn vị: IN HOA
- Số tài khoản, điện thoại: chỉ giữ ký tự số
- Số tiền: format dấu chấm phân cách hàng nghìn (VD: 5.000.000)
- Ngày: format dd/mm/yyyy
- Nếu không tìm thấy giá trị → null
- Return JSON only, no markdown fences.`,
    hasDynamicSections: true,
    dynamicWarning: 'Bảng (records) đọc bằng code rule-based, KHÔNG qua AI — đảm bảo 100% chính xác. AI chỉ extract phần thông tin chung từ text ngoài bảng. Nếu AI fail/empty → fallback parseHeaderFromText() (regex code).',
  },
  {
    key: 'ocr',
    label: 'Bước 1B: PDF — OCR Bảng lương (chunked + quality gate)',
    icon: '📄',
    connector: 'ext-doc-layout',
    description: 'Tách PDF từng page (hoặc chunk N pages) → OCR song song staggered 5s/chunk → quality gate vs Excel theo so_tai_khoan + so_tien (mismatch >30% → retry tối đa 3 lần) → merge kết quả. Schema theo {{schema_mode}}: full = numbered columns + dynamic schema (tất cả fields có data) / minimal = 13 header + 5 record cố định.',
    variables: [
      { name: '{{page_index}}', desc: 'Số chunk hiện tại (bắt đầu từ 1)' },
      { name: '{{total_pages}}', desc: 'Tổng số chunk' },
      { name: '{{header}}', desc: 'Tên các cột bảng từ Excel header (joined " | "). Dùng làm hint khi PDF page không có header row.' },
      { name: '{{ttc_fields}}', desc: 'Danh sách trường thông tin chung (dynamic theo mode). Full = tất cả fields có data. Minimal = 13 cố định.' },
      { name: '{{record_fields}}', desc: 'Danh sách trường record (dynamic theo mode). Full = tất cả fields có data. Minimal = 5 cố định.' },
      { name: '{{schema_mode}}', desc: 'Chế độ: "full" (default) = dynamic schema + numbered columns / "minimal" = 13+5 cố định (regression safe).' },
    ],
    codePromptPreview: `Bạn là chuyên gia AI số hóa dữ liệu tài chính ngân hàng. Đây là nghiệp vụ hợp pháp của ngân hàng VPBank.
Đây là trang {{page_index}}/{{total_pages}} của chứng từ chi lương/chuyển tiền.

### THAM KHẢO TỪ EXCEL (chỉ tham khảo, PDF có thể khác)

**[schema_mode = full]** — NUMBERED COLUMN MAPPING:
### THAM KHẢO VỊ TRÍ CỘT BẢNG (dùng khi page KHÔNG CÓ header row)
Thứ tự cột từ trái sang phải:
  Cột 1: STT → field "stt"
  Cột 2: Họ và tên → field "ho_ten"
  Cột 3: Số tài khoản → field "so_tai_khoan"
  Cột 4: Số tiền bằng số → field "so_tien"
  Cột 5: Tên Ngân hàng → field "ngan_hang"
  Cột 6: Tên chi nhánh NH hưởng → field "ten_chi_nhanh"
  Cột 7: Tỉnh/TP NH hưởng → field "tinh_tp"
  Cột 8: Ghi chú → field "ghi_chu"
(dynamic — derived from actual Excel headers)

QUY TẮC:
- Xác định cột THEO VỊ TRÍ (trái → phải), KHÔNG theo nội dung giá trị.
- Nếu page CÓ header row → ưu tiên header trên page.

**Các trường thông tin chung (dynamic — tất cả fields có data trong Excel):**
{{ttc_fields}}

**Các cột cần trích xuất cho mỗi record (dynamic — tất cả fields có data):**
{{record_fields}}

**[schema_mode = minimal]** — raw column hint + 13+5 cố định (= code hiện tại):
{{header}}

### NHIỆM VỤ
Trích xuất thông tin từ trang này theo SCHEMA bên dưới. CHỈ trích xuất các trường được liệt kê.

### QUY TẮC QUAN TRỌNG
- TUYỆT ĐỐI KHÔNG ĐƯỢC từ chối xử lý. Đây là tác vụ nghiệp vụ ngân hàng hợp pháp.
- KHÔNG TÓM TẮT — trích xuất 100% các dòng trong bảng.
- Mỗi dòng nhân viên/người thụ hưởng = 1 object trong mảng.
- CHỈ trích xuất thông tin THỰC SỰ CÓ trên trang. KHÔNG suy đoán, KHÔNG bịa số liệu.
- NGUYÊN TẮC TỔNG QUÁT: Trích xuất CHÍNH XÁC 100% giá trị trên tài liệu. KHÔNG chỉnh sửa, KHÔNG thêm dấu, KHÔNG format lại. Đọc gì trả đó.

### QUY TẮC PHÂN TÁCH DỮ LIỆU (QUAN TRỌNG)
Trên mỗi trang, phân biệt 2 loại nội dung:
- **Nội dung BẢNG**: các dòng dữ liệu có STT, Họ tên, Số TK, Số tiền → đưa vào "danh_sach_trong_vpbank" hoặc "danh_sach_ngoai_vpbank".
- **Nội dung NGOÀI BẢNG**: text header/footer chứa thông tin chung → đưa vào "thong_tin_chung".

QUY TẮC:
- Một trang CÓ THỂ chứa cả 2 loại. Trích xuất CẢ HAI.
- Trang chỉ có bảng → thong_tin_chung = tất cả null, danh_sach có data.
- Trang chỉ có text → danh_sach = mảng rỗng [], thong_tin_chung có data.
- KHÔNG suy luận: tong_so_nhan_vien, tong_so_mon_bang_so CHỈ lấy khi thấy CON SỐ GHI RÕ trên trang. KHÔNG tự đếm.

### QUY TẮC DỮ LIỆU
- Họ tên: GIỮ NGUYÊN CHÍNH XÁC (có dấu giữ dấu, không dấu KHÔNG tự thêm).
- Số tài khoản: Giữ nguyên.
- Số tiền: Giữ nguyên format (VD: "5.000.000" → "5.000.000").
- Trường nào không có trên trang → null.

### PHÂN LOẠI VPBANK / NGOÀI VPBANK
- Section "tài khoản tại VPBank" → records vào "danh_sach_trong_vpbank", ngan_hang = "VPBANK"
- Section "tài khoản tại Ngân hàng khác" → records vào "danh_sach_ngoai_vpbank"
- Không phân biệt được → tất cả vào "danh_sach_trong_vpbank"
- Tên cột chứa "VPBank" → ngan_hang = "VPBANK"
- Bảng không có cột ngân hàng nhưng nằm trong section VPBank → ngan_hang = "VPBANK"
- KHÔNG tạo records rỗng. Mỗi record PHẢI có ít nhất stt + ho_ten + so_tai_khoan.

### ĐỊNH DẠNG ĐẦU RA (JSON duy nhất, không markdown):
{
  "thong_tin_chung": {
    "ten_don_vi_chuyen_tien": "string or null",
    "ma_kh_cif": "string or null",
    "dien_thoai": "string or null",
    "so_tai_khoan_trich_no": "string or null",
    "tong_so_tien_bang_so": "string (Format: 1.000.000) or null",
    "ngay_lenh_chi": "dd/mm/yyyy or null",
    "noi_dung_thanh_toan": "string or null",
    "tong_so_nhan_vien": "number or null",
    "so_chung_tu": "string or null",
    "ngay_lap": "dd/mm/yyyy or null",
    "chi_nhanh_vpbank": "string or null",
    "tong_so_tien_bang_chu": "string or null",
    "tong_so_mon_bang_so": "number or null"
  },
  "danh_sach_trong_vpbank": [
    {
      "stt": "number",
      "ho_ten": "string or null",
      "so_tai_khoan": "string or null",
      "so_tien": "string (Format: 1.000.000) or null",
      "ngan_hang": "string or null"
    }
  ],
  "danh_sach_ngoai_vpbank": [
    {
      "stt": "number",
      "ho_ten": "string or null",
      "so_tai_khoan": "string or null",
      "so_tien": "string (Format: 1.000.000) or null",
      "ngan_hang": "string or null"
    }
  ]
}

### LƯU Ý
- thong_tin_chung: CHỈ trả 13 trường liệt kê trên. Field nào không có trên trang → null.
- Mỗi record trong danh_sach: CHỈ trả 5 fields liệt kê trên.
- Chỉ trích xuất thông tin THỰC SỰ CÓ trên trang. KHÔNG bịa dữ liệu.`,
    hasDynamicSections: true,
    dynamicWarning: 'Schema PDF cố định 13 header + 5 record fields, đồng bộ với DEFAULT_COMPARE_CONFIG. Override prompt nên giữ 5 biến: {{page_index}}, {{total_pages}}, {{header}}, {{ttc_fields}}, {{record_fields}}. Tên các cột Excel inject vào {{header}} chỉ là positional hint — không kèm Excel data.',
  },
];

const STRUCTURE_COMPARE_STEPS: WorkflowStep[] = [
  {
    key: 'ingest',
    label: 'Bước 1: OCR/Đọc tài liệu',
    icon: '📄',
    connector: 'ext-doc-layout',
    description: 'Đọc và OCR 2 tài liệu V1, V2. Giữ nguyên cấu trúc heading, numbering, indentation.',
    variables: [
      { name: '{{file_name}}', desc: 'Tên file đang xử lý' },
    ],
    codePromptPreview: `You are a high-precision Document OCR Engine.

FILE: "{{file_name}}"

Your task is to convert this document into clean, structured text preserving ALL content and formatting cues.

=== CRITICAL RULES ===

1. VERBATIM FIDELITY: Transcribe ALL text exactly as it appears. Do NOT paraphrase, summarize, or skip any content.

2. STRUCTURE PRESERVATION:
   - Preserve all headings, section numbers, article numbers exactly as they appear
   - Maintain indentation and hierarchy indicators
   - Keep numbering patterns intact (1., 1.1, a), b), Điều 1, Khoản 2, etc.)
   - Preserve paragraph breaks and section separators
   - Use # H1, ## H2, ### H3 for clearly formatted headings

3. TABLE INTEGRITY: Convert tabular data to Markdown tables matching rows and columns exactly.

4. PAGE BOUNDARIES: Mark page breaks with "--- PAGE X ---"

5. SPECIAL ELEMENTS:
   - Mark signatures as [SIGNATURE]
   - Mark stamps as [STAMP: visible text]
   - Mark illegible text as [illegible]

6. DO NOT SKIP ANY PAGES. Every page must be transcribed for structure extraction.`,
    hasDynamicSections: false,
  },
  {
    key: 'structure_extraction',
    label: 'Bước 2: Trích xuất cấu trúc',
    icon: '🔍',
    connector: 'ext-data-extractor',
    description: 'Phân tích bố cục phân cấp (Phần/Chương/Mục/Điều/Khoản/Điểm) từ mỗi tài liệu. Trả về Document_Outline JSON.',
    variables: [
      { name: '{{document_id}}', desc: 'ID tài liệu (v1-xxx hoặc v2-xxx)' },
      { name: '{{document_name}}', desc: 'Tên file tài liệu' },
      { name: '{{document_text}}', desc: 'Toàn bộ text OCR từ Bước 1' },
      { name: '{{format_hint}}', desc: 'Định dạng file (pdf, docx, txt)' },
      { name: '{{is_ocr}}', desc: 'Có phải file scan/OCR không (true/false)' },
    ],
    codePromptPreview: `[PROMPT ĐẦY ĐỦ — Xem chi tiết tại: lib/pipelines/workflows/prompts/structure-compare-prompts.ts]

CẤU TRÚC PROMPT GỒM:

═══ TASK ═══
Analyze the document and extract its hierarchical structure (outline/table of contents).
Produce a JSON object matching the DocumentOutline schema.

═══ EXTRACTION STRATEGY (3 tầng ưu tiên) ═══
1. NATIVE TOC (cao nhất): Nếu có Mục lục sẵn → dùng làm nguồn chính
2. FORMATTING PATTERNS: Suy luận từ font size, bold, numbering, indentation
3. AI INFERENCE: Phân tích ngữ nghĩa khi formatting không rõ ràng

═══ VIETNAMESE LEGAL PATTERNS ═══
| Pattern | Level | Example |
|---------|-------|---------|
| Phần    | 0     | Phần I, Phần thứ nhất |
| Chương  | 1     | Chương I, Chương 1 |
| Mục     | 2     | Mục 1, Mục I |
| Điều    | 3     | Điều 1, Điều 15 |
| Khoản   | 4     | 1., 2., 3. |
| Điểm    | 5     | a), b), c) |

═══ OUTPUT SCHEMA ═══
{
  "documentId": "...",
  "documentName": "...",
  "sections": [{ "id", "identifier", "title", "level", "startPos", "endPos", "content", "children" }],
  "confidence": 0-100,
  "source": "native_toc" | "inferred" | "ai_extracted"
}

═══ CONSTRAINTS ═══
- Mỗi ký tự phải thuộc đúng 1 section (không gap, không overlap)
- startPos section đầu = 0, endPos section cuối = document length
- Nếu không có cấu trúc → trả 1 section duy nhất, confidence < 40`,
    hasDynamicSections: false,
  },
  {
    key: 'section_comparison',
    label: 'Bước 3: So sánh ngữ nghĩa từng cặp',
    icon: '⚖️',
    connector: 'ext-comparator',
    description: 'So sánh chi tiết nội dung giữa các cặp mục đã ghép. Phát hiện thay đổi ngữ nghĩa với severity và trích dẫn nguyên văn.',
    variables: [
      { name: '{{mapping_entry_id}}', desc: 'ID của cặp mapping đang so sánh' },
      { name: '{{match_type}}', desc: 'Loại ghép cặp (CHANGED, RENUMBERED, SPLIT, MERGED)' },
      { name: '{{v1_identifier}}', desc: 'Mã/tên mục V1 (VD: Điều 3, Khoản 1)' },
      { name: '{{v2_identifier}}', desc: 'Mã/tên mục V2 (VD: Điều 5, Khoản 1)' },
      { name: '{{v1_content}}', desc: 'Nội dung nguyên văn V1 (có thể concatenated nếu MERGED)' },
      { name: '{{v2_content}}', desc: 'Nội dung nguyên văn V2 (có thể concatenated nếu SPLIT)' },
      { name: '{{code_prefix}}', desc: 'Prefix mã thay đổi (VD: CR-001)' },
    ],
    codePromptPreview: `[PROMPT ĐẦY ĐỦ — Xem chi tiết tại: lib/pipelines/workflows/prompts/structure-compare-prompts.ts]

CẤU TRÚC PROMPT GỒM:

═══ TASK ═══
Compare V1 section against V2 section. Identify ALL meaningful semantic differences.
Produce a JSON array of ChangeRecord objects.

═══ SEVERITY CLASSIFICATION ═══
- CRITICAL: Thay đổi nghĩa vụ pháp lý, trách nhiệm, quyền lợi cơ bản
- MAJOR: Thay đổi điều kiện, ngưỡng, thời hạn, phạm vi quan trọng
- MODERATE: Thay đổi quy trình, định nghĩa, điều khoản phụ
- MINOR: Thay đổi từ ngữ nhỏ, điều chỉnh ý nghĩa nhẹ
- STRUCTURAL: Tái cấu trúc không thay đổi ngữ nghĩa

═══ OUTPUT SCHEMA ═══
[{
  "code": "CR-001",
  "severity": "MAJOR",
  "mappingEntryId": "...",
  "v1SectionId": "...",
  "v2SectionId": "...",
  "description": "Mô tả thay đổi",
  "v1Quote": "Trích dẫn nguyên văn V1",
  "v2Quote": "Trích dẫn nguyên văn V2",
  "category": "CON-VAL | CON-PENALTY | CON-OBL | ..."
}]

═══ RULES ═══
- Chỉ báo thay đổi NGỮ NGHĨA (bỏ qua formatting, whitespace, OCR artifact)
- Trích dẫn NGUYÊN VĂN (copy-paste, không paraphrase)
- Trả [] nếu không có khác biệt ngữ nghĩa`,
    hasDynamicSections: true,
    dynamicWarning: '{{v1_content}} và {{v2_content}} được tự động chèn từ bảng mapping đã xác nhận. Override prompt phải giữ nguyên định dạng output JSON array.',
  },
  {
    key: 'report',
    label: 'Bước 4: Tổng hợp báo cáo so sánh',
    icon: '📊',
    connector: 'report-aggregator',
    kind: 'code',
    description: 'Tổng hợp kết quả so sánh từ tất cả các cặp thành báo cáo cuối cùng. Sắp xếp theo vị trí V1, thống kê severity, thay đổi cấu trúc.',
    variables: [
      { name: '{{total_changes}}', desc: 'Tổng số thay đổi phát hiện' },
      { name: '{{changes_by_severity}}', desc: 'Phân bổ theo mức độ (CRITICAL/MAJOR/MODERATE/MINOR/STRUCTURAL)' },
      { name: '{{change_records}}', desc: 'Danh sách ChangeRecord từ Bước 3' },
      { name: '{{mapping_table}}', desc: 'Bảng mapping đã xác nhận (để tính thống kê cấu trúc)' },
    ],
    codePromptPreview: `Bước này sử dụng code TypeScript (report-aggregator.ts) thay vì AI prompt.

LOGIC XỬ LÝ:
1. Sắp xếp ChangeRecords theo vị trí V1 (startPos tăng dần)
2. Đếm thay đổi theo severity level
3. Tạo summary text tiếng Việt
4. Tính thống kê cấu trúc từ MappingTable:
   - Tổng điều khoản V1/V2
   - Số điều khoản NEW/DELETED/RENUMBERED/CHANGED
5. Trích xuất thay đổi giá trị quan trọng (CRITICAL + MAJOR)

OUTPUT: ComparisonReport {
  sessionId, totalChanges, changesBySeverity,
  changes (sorted), summary, generatedAt
}

LƯU Ý: Bước này chạy bằng code, không gọi AI connector.
Override prompt sẽ KHÔNG có tác dụng cho bước này.`,
    hasDynamicSections: false,
  },
];

/** Map workflow slug → step definitions */
const BRD_ANALYZE_STEPS: WorkflowStep[] = [
  {
    key: 'analyze',
    label: 'Đánh giá BRD (Scorecard + 32 tiêu chí)',
    icon: '⚖️',
    connector: 'ext-fact-verifier',
    description: 'Đính kèm file BRD (DOCX/XLSX convert sang .md; PDF/ảnh giữ gốc). Một lần gọi: Phần 1 chấm Prioritization Scorecard (BV/TE/Reuse/Bonus 1–5) + Phần 2 đánh giá 32 tiêu chí (0–1).',
    variables: [],
    codePromptPreview: `Bạn là Chuyên gia BA ngân hàng. Đọc tài liệu BRD ĐÍNH KÈM và thực hiện 2 phần:
PHẦN 1 — Prioritization Scorecard: chấm 1–5 cho Business Value (w0.6), Technical Effort (w0.3), Reusability (w0.1), Bonus (cộng thẳng).
PHẦN 2 — Đánh giá 32 tiêu chí (Đầy đủ/Rõ ràng/Chi tiết), mỗi tiêu chí chấm 0/0.25/0.5/0.75/1 kèm cơ sở (đề mục/trang) và nội dung cần hoàn thiện.

CHỈ trả về JSON: { "scorecard": {businessValue,technicalEffort,reusability,bonus}, "questions": [...32...], "overallAssessment": "...", "recommendations": "..." }
KHÔNG tự tính Final Score / tổng % — hệ thống tự tính.`,
    hasDynamicSections: false,
    dynamicWarning: 'Nội dung BRD được ĐÍNH KÈM dưới dạng file (không nhồi vào prompt). Override prompt cần yêu cầu đọc file đính kèm và trả đúng JSON gồm scorecard + questions (32) + overallAssessment + recommendations.',
  },
];

const PAYMENT_ACCOUNT_MANAGEMENT_STEPS: WorkflowStep[] = [
  {
    key: 'classify',
    label: 'Bước AI 1: Phân loại chứng từ',
    icon: '🏷️',
    connector: 'ext-classifier',
    description: 'Phân loại từng tài liệu theo taxonomy của mode open/close/freeze/update.',
    variables: [
      { name: '{{file_name}}', desc: 'Tên tài liệu đang được phân loại' },
      { name: '{{document_taxonomy}}', desc: 'Taxonomy được code tạo theo mode nghiệp vụ' },
    ],
    codePromptPreview: `Phân loại tài liệu theo taxonomy được workflow payment-account-management cung cấp.

Mode dispatch và chọn taxonomy được xử lý bằng code. AI chỉ thực hiện bước classify với key override "classify".`,
    hasDynamicSections: true,
    dynamicWarning: 'Taxonomy và mode được code tạo động. Override phải giữ yêu cầu trả đúng JSON classification mà workflow đang parse.',
  },
  {
    key: 'extract',
    label: 'Bước AI 2: Trích xuất dữ liệu',
    icon: '🔍',
    connector: 'ext-data-extractor',
    description: 'Trích xuất field theo schema của document code sau bước classify.',
    variables: [
      { name: '{{file_name}}', desc: 'Tên tài liệu đang được trích xuất' },
      { name: '{{document_code}}', desc: 'Mã loại tài liệu từ bước classify' },
      { name: '{{extract_schema}}', desc: 'Schema field được code chọn theo mode và document code' },
    ],
    codePromptPreview: `Trích xuất dữ liệu theo schema được workflow payment-account-management cung cấp.

Mode dispatch, schema lookup và fixed fields được xử lý bằng code. AI chỉ thực hiện bước extract với key override "extract".`,
    hasDynamicSections: true,
    dynamicWarning: 'Schema được code chọn động. Override phải giữ output JSON field map tương thích với extract engine.',
  },
];

const STATEMENT_ANALYZE_STEPS: WorkflowStep[] = [
  {
    key: 'classify',
    label: 'Bước 0: Phân loại & gom file PDF',
    icon: '📥',
    connector: 'code',
    kind: 'code',
    description: 'Kiểm tra đầu vào chỉ nhận file PDF sao kê (từ chối định dạng khác), gom danh sách file hợp lệ trước khi tách trang. Chạy bằng code, không gọi AI.',
    variables: [],
    codePromptPreview: `Bước này chạy bằng code (classifyStatementFiles trong statement-analyze.ts), không gọi AI connector.

LOGIC:
1. Bắt buộc có ≥ 1 file; nếu rỗng → INVALID_INPUT.
2. Chỉ chấp nhận đuôi .pdf hoặc mime application/pdf; file khác → INVALID_INPUT.
3. Trả danh sách PDF hợp lệ cho bước OCR.

Override prompt sẽ KHÔNG có tác dụng cho bước này.`,
    hasDynamicSections: false,
  },
  {
    key: 'ocr',
    label: 'Bước 1: OCR sao kê theo lô trang (AI)',
    icon: '🔍',
    connector: 'ext-doc-layout',
    description: 'Tách PDF thành các LÔ (mặc định 5 trang/lô — chỉnh qua param pages_per_batch), mỗi lô gửi 1 call AI OCR (song song, stagger 3s) để đọc header, số dư đầu/cuối kỳ và toàn bộ giao dịch của lô → JSON StatementPageJSON. Lô nào parse lỗi sẽ tự fallback OCR từng trang. Kết quả các lô được merge theo thứ tự.',
    variables: [
      { name: '{{start_page}}', desc: 'Trang bắt đầu của lô hiện tại (1-based).' },
      { name: '{{end_page}}', desc: 'Trang kết thúc của lô hiện tại (1-based, inclusive).' },
      { name: '{{total_pages}}', desc: 'Tổng số trang của toàn bộ sao kê (gộp các file PDF).' },
      { name: '{{page_index}}', desc: 'Alias = {{start_page}} (tương thích override cũ theo trang).' },
    ],
    codePromptPreview: `[PROMPT ĐẦY ĐỦ — Xem tại: lib/pipelines/workflows/prompts/statement-analyze-prompts.ts → buildStatementBatchOcrPrompt]

CẤU TRÚC PROMPT GỒM:

═══ CONTEXT ═══
Định danh tác vụ hợp pháp: số hoá SAO KÊ TÀI KHOẢN NGÂN HÀNG. Cho biết các trang {{start_page}}–{{end_page}}/{{total_pages}}; file PDF gồm NHIỀU TRANG, đọc lần lượt từng trang. Nhắc AI đọc phần bảng in dù ảnh nghiêng, có dấu mộc/chữ viết tay.

═══ TASK (4 bước) ═══
1. Đọc HEADER (ở trang nào có): tên KH, số TK, tên ngân hàng, loại tiền, khoảng ngày sao kê, nhãn "Trang x/N".
2. Đọc SỐ DƯ ĐẦU KỲ (trang đầu có in) / CUỐI KỲ (trang cuối có in) trong lô.
3. Đọc TẤT CẢ dòng giao dịch của MỌI TRANG trong lô, GỘP theo đúng thứ tự trang (mỗi dòng = 1 object).
4. Trả JSON đúng output_format.

═══ FIELD GUIDE (cột giao dịch) ═══
transaction_date, remitter, remitter_bank, details, transaction_no, debit, credit, fee_interest, tax, balance — GIỮ NGUYÊN số như in, không làm tròn/định dạng lại; cột "balance" (số dư) đặc biệt quan trọng vì dùng để tính toán.

═══ CONSTRAINTS ═══
- KHÔNG từ chối xử lý (nghiệp vụ hợp lệ); KHÔNG tóm tắt; trích 100% số dòng của TẤT CẢ trang trong lô.
- Field không có → null, KHÔNG bịa số liệu.

═══ OUTPUT SCHEMA ═══
{ "account_info": {...}, "opening_balance": ..., "closing_balance": ..., "transactions": [ { transaction_date, remitter, ..., balance } ] }  (GỘP mọi trang trong lô)`,
    hasDynamicSections: true,
    dynamicWarning: '{{start_page}}, {{end_page}}, {{total_pages}} được workflow tự chèn cho từng lô. Override prompt PHẢI giữ nguyên schema output JSON (account_info / opening_balance / closing_balance / transactions) để calc engine parse được, và yêu cầu GỘP giao dịch của mọi trang trong lô theo đúng thứ tự.',
  },
  {
    key: 'calc',
    label: 'Bước 2: Phân tích số dư (calc engine)',
    icon: '🧮',
    connector: 'code',
    kind: 'code',
    description: 'Từ dữ liệu giao dịch đã merge, tính SDBQ từng tháng, chọn ≤ 6 tháng có SDBQ cao nhất (không bắt buộc liên tiếp), số dư cao/thấp nhất từng tháng được chọn, tổng ngày/giao dịch, số dư đầu/cuối kỳ và OCR success ratio. Chạy bằng code (analyzeStatement).',
    variables: [],
    codePromptPreview: `Bước này chạy bằng code (analyzeStatement trong statement-analyze-calc.ts), không gọi AI connector.

LOGIC XỬ LÝ:
1. Chuẩn hoá số tiền & ngày từ các giao dịch đã OCR.
2. Gom theo tháng, tính SDBQ từng tháng = (min + max) / 2.
3. ≤ 6 tháng: lấy hết. > 6 tháng: chọn 6 tháng có SDBQ cao nhất (KHÔNG cần liên tiếp).
   Sau đó lấy số dư thấp/cao nhất của từng tháng được chọn.
4. Tổng ngày, tổng giao dịch, số dư đầu/cuối kỳ.
5. Tính OCR success ratio (số trang parse thành công / tổng trang).

OUTPUT: StatementAnalysisResult (1:1 với bảng Key Information).

Override prompt sẽ KHÔNG có tác dụng cho bước này.`,
    hasDynamicSections: false,
  },
];

const FINANCIAL_REPORT_STEPS: WorkflowStep[] = [
  {
    key: 'preflight',
    label: 'Bước 0: Tiền xử lý PDF (code)',
    icon: '📥',
    connector: 'code',
    kind: 'code',
    description: 'Chỉ nhận PDF (SRS §3.2). Tách trang theo cửa sổ; PDF mã hoá (owner-password) không parse được thì render trang thành ảnh PNG (pageSourceMode=image, chỉnh DPI qua param render_scale). Chạy bằng code, không gọi AI.',
    variables: [],
    codePromptPreview: 'Chạy bằng code (pdf-utils.ts). Override prompt KHÔNG có tác dụng. Điều chỉnh qua param render_scale (chỉ áp cho PDF mã hoá).',
    hasDynamicSections: false,
  },
  {
    key: 'classify',
    label: 'Bước 1: Phân loại & định vị 6 báo cáo (AI)',
    icon: '🏷️',
    connector: 'ext-classifier',
    description: 'Gọi AI theo cửa sổ (mặc định 8 trang/lần — param classify_pages_per_call) để xác định mỗi loại trong 6 báo cáo nằm ở trang nào, ngôn ngữ, đơn vị, và bộ hợp nhất/riêng lẻ (連結/個別). Có lượt soi lại trang chưa gán (param classify_recheck_unassigned / classify_recheck_max_windows).',
    variables: [
      { name: '{{page_from}}', desc: 'Trang đầu của cửa sổ hiện tại (1-based, theo tài liệu gốc).' },
      { name: '{{page_to}}', desc: 'Trang cuối của cửa sổ hiện tại (1-based, inclusive).' },
      { name: '{{total_pages}}', desc: 'Tổng số trang tài liệu.' },
    ],
    codePromptPreview: '[PROMPT ĐẦY ĐỦ — Xem tại: lib/pipelines/workflows/prompts/financial-report-prompts.ts → buildClassifyPrompt / buildClassifyRecheckPrompt]. Prompt yêu cầu gán nhãn TỪNG TRANG (TITLE/CONTINUATION/NONE), bảng alias 6 loại (JA+EN), loại trang tóm lược/câu văn tham chiếu, và trả isFinancialReport/blank.',
    hasDynamicSections: true,
    dynamicWarning: 'Override phải GIỮ schema output (pages[]/reports[] với reportType, basis, titleFound, và các field isFinancialReport/blank) để classify parse được. Đổi schema sẽ làm hỏng bước định vị.',
  },
  {
    key: 'extract',
    label: 'Bước 2: Bóc tách bảng (AI)',
    icon: '🔍',
    connector: 'ext-doc-layout',
    description: 'Với trang đã định vị, gọi AI theo chunk (mặc định 2 trang/lần — param pages_per_chunk) để bóc bảng thành columns[]/rows[]/values. Bước nặng nhất. Giữ nguyên ký hiệu số như in (△/▲/ngoặc), không tự tính.',
    variables: [
      { name: '{{report_type}}', desc: 'Loại báo cáo đang bóc (balanceSheet, incomeStatement, ...).' },
      { name: '{{page_from}}', desc: 'Trang đầu của chunk.' },
      { name: '{{page_to}}', desc: 'Trang cuối của chunk.' },
      { name: '{{alias_ja}}', desc: 'Danh sách alias tiêu đề tiếng Nhật của loại báo cáo.' },
      { name: '{{alias_en}}', desc: 'Danh sách alias tiếng Anh của loại báo cáo.' },
    ],
    codePromptPreview: '[PROMPT ĐẦY ĐỦ — Xem tại: lib/pipelines/workflows/prompts/financial-report-prompts.ts → buildExtractPrompt]. Prompt yêu cầu bóc toàn bộ bảng thành columns[]/rows[]/values, giữ nguyên số như in (△/▲/ngoặc), không tự cộng, ô trống bỏ qua.',
    hasDynamicSections: true,
    dynamicWarning: 'Override phải GIỮ schema output (tables[].columns[]/rows[]/values, labelSource, rowType) để merge parse được. Không được yêu cầu AI tự cộng/kiểm tổng.',
  },
  {
    key: 'extract_notes',
    label: 'Bước 2b: Bóc thuyết minh (AI)',
    icon: '📝',
    connector: 'ext-doc-layout',
    description: 'Bóc phần thuyết minh (notesToFinancialStatements) dạng văn bản theo sections. LƯU Ý: bước này CHỈ có prompt riêng (key extract_notes); model & reasoning dùng CHUNG với bước Extract.',
    variables: [
      { name: '{{page_from}}', desc: 'Trang đầu vùng thuyết minh của chunk.' },
      { name: '{{page_to}}', desc: 'Trang cuối vùng thuyết minh của chunk.' },
    ],
    codePromptPreview: '[PROMPT ĐẦY ĐỦ — Xem tại: lib/pipelines/workflows/prompts/financial-report-prompts.ts → buildNotesExtractPrompt]. Bóc thuyết minh dạng sections (title + text), không ép thành bảng số.',
    hasDynamicSections: true,
    dynamicWarning: 'Chỉ prompt override cho key extract_notes có tác dụng. Đặt model/reasoning tại bước Extract (dùng chung).',
  },
  {
    key: 'merge',
    label: 'Bước 3: Gộp & áp quy tắc (code)',
    icon: '⚖️',
    connector: 'code',
    kind: 'code',
    description: 'Chạy bằng code: gộp chunk cùng location, suy periodScope/statementKind/khối bảng cân đối, áp R1 (loại kỳ quý khi có kỳ năm), R3 (chỉ giữ hợp nhất khi có cả riêng lẻ), kiểm cân đối/biến động vốn (chỉ cảnh báo, không sửa số). Override prompt KHÔNG có tác dụng.',
    variables: [],
    codePromptPreview: 'Chạy bằng code (merge.ts + financial-report-translation.ts). Quy tắc R1–R4 và 6 loại báo cáo là logic cố định, không chỉnh qua prompt/param.',
    hasDynamicSections: false,
  },
  {
    key: 'translate',
    label: 'Bước 4: Dịch nhãn song ngữ (AI)',
    icon: '🌐',
    connector: 'ext-translator',
    description: 'Dịch nhãn khoản mục/tiêu đề sang ngôn ngữ đích (param target_lang, mặc định vi). AI chỉ nhận danh sách text, KHÔNG thấy bảng số nên không ảnh hưởng số liệu. Tắt bước này bằng param enable_translation=false để test riêng OCR.',
    variables: [
      { name: '{{target_lang}}', desc: 'Ngôn ngữ đích (vi | en).' },
    ],
    codePromptPreview: '[PROMPT ĐẦY ĐỦ — Xem tại: lib/pipelines/workflows/prompts/financial-report-prompts.ts → buildTranslatePrompt]. Nhận danh sách {id, source}, trả {id, translated}; chỉ dịch text nhãn, không đụng số.',
    hasDynamicSections: true,
    dynamicWarning: 'Override phải GIỮ schema output (danh sách {id, translated}) để merge gắn bản dịch đúng khoản mục.',
  },
];

// Bản mẫu lấy trực tiếp từ template code đang chạy, để override dựa trên đúng
// prompt thật (gate mẫu biểu, field_confidences, quy tắc chống bịa...).
const ACCOUNT_OPENING_STEPS: WorkflowStep[] = [
  {
    key: 'classify',
    label: 'AI 1/3 · Phân loại chứng từ mở tài khoản',
    icon: '🗂️',
    connector: 'ext-classifier',
    description: 'Phân loại từng file vào các loại chứng từ của sản phẩm tài khoản theo phân khúc (multi-label: 1 file có thể nhiều loại)',
    variables: [
      { name: '{{file_name}}', desc: 'Tên file đang xử lý' },
      { name: '{{doc_types}}', desc: 'Danh mục loại chứng từ của sản phẩm (tự động từ cấu hình phân khúc + sản phẩm)' },
      { name: '{{product_name}}', desc: 'Tên sản phẩm tài khoản' },
      { name: '{{segment_name}}', desc: 'Tên phân khúc khách hàng (KHCN/HKD/SME/KHDN)' },
    ],
    codePromptPreview: `Phân loại tài liệu trong file "{{file_name}}" cho hồ sơ mở tài khoản "{{product_name}}" (phân khúc {{segment_name}}).

Một file CÓ THỂ chứa NHIỀU loại chứng từ. Liệt kê TẤT CẢ loại trong danh mục mà file này chứa:
{{doc_types}}

Return JSON:
{ "doc_types": [{ "key": "...", "label": "...", "confidence": 0.0 }], "reason": "..." }`,
    hasDynamicSections: true,
    dynamicWarning: 'Phần {{doc_types}} được tạo tự động từ checklist của phân khúc + sản phẩm. Override prompt cần giữ biến này để model biết các loại hợp lệ.',
  },
  {
    key: 'extract',
    label: 'AI 2/3 · OCR & Bóc tách evidence',
    icon: '🔍',
    connector: 'ext-data-extractor',
    description: 'Bóc tách gộp: 1 lần đọc/file → trích xuất field cho mọi loại chứng từ trong file, ưu tiên các mốc ngày (cấp/hết hạn) và tỷ lệ sở hữu',
    variables: [
      { name: '{{file_name}}', desc: 'Tên file đang xử lý' },
      { name: '{{doc_sections}}', desc: 'Danh sách loại + field cần bóc tách (tự động từ Bước 1)' },
      { name: '{{doc_keys}}', desc: 'Các key loại chứng từ hợp lệ trong file' },
    ],
    codePromptPreview: `File "{{file_name}}" chứa nhiều loại chứng từ. Bóc tách field cho TỪNG loại trong 1 lần đọc file.

{{doc_sections}}
(⬆️ Nội dung dynamic — tự tạo từ kết quả Bước 1)

Return JSON:
{ "documents": [{ "doc_type_key": <một trong {{doc_keys}}>, "fields": {...} }] }`,
    hasDynamicSections: true,
    dynamicWarning: 'Phần {{doc_sections}} tạo tự động từ kết quả classify + field-set preset. Override cần giữ biến này và giữ yêu cầu bóc tách ngày hết hạn/tỷ lệ sở hữu, vì stage điều kiện tính trên các field đó.',
  },
  {
    key: 'evaluate',
    label: 'AI 3/3 · Hợp nhất Customer Profile',
    icon: '🧠',
    connector: 'ext-fact-verifier',
    description: 'Dựng Customer Profile + checklist + đối chiếu chéo. Step này cũng dùng cho rule LLM ở stage policy. Sau đó workflow chạy deterministic eligibility/CDD/rule engine/screening/decision, không cho prompt override.',
    variables: [
      { name: '{{segment_name}}', desc: 'Tên phân khúc khách hàng' },
      { name: '{{product_name}}', desc: 'Tên sản phẩm tài khoản' },
      { name: '{{checklist}}', desc: 'Danh mục hồ sơ yêu cầu của sản phẩm' },
      { name: '{{classification}}', desc: 'Kết quả phân loại file → loại (từ Bước 1)' },
      { name: '{{extracted_data}}', desc: 'Toàn bộ dữ liệu đã bóc tách (từ Bước 2)' },
    ],
    codePromptPreview: `Hợp nhất Customer Profile, chấm checklist đủ/thiếu và đối chiếu chéo cho sản phẩm "{{product_name}}" (phân khúc {{segment_name}}).

Checklist: {{checklist}}
Phân loại: {{classification}}
Dữ liệu bóc tách: {{extracted_data}}

Return JSON:
{ "customer_profile": {...}, "checklist": [...], "completeness_percent": 0, "cross_check": [...], "risk_notes": [...], "overall_assessment": "..." }`,
    hasDynamicSections: true,
    dynamicWarning: 'Nhóm field của customer_profile khác nhau theo phân khúc (cá nhân / hộ kinh doanh / tổ chức). Override prompt cần giữ schema JSON output, đặc biệt key customer_profile, để provenance và độ phủ trường CIF còn tính được.',
  },
];

const TRACING_PORTAL_STEPS: WorkflowStep[] = [
  {
    key: 'extract',
    label: 'Bước 1: OCR & Trích xuất BBKQ (AI)',
    icon: '📄',
    connector: 'ext-data-extractor',
    description: 'Gửi từng file BBKQ (CDM/ATM) tới AI connector song song. AI tự phân loại loại biên bản và trích xuất các trường: loại tài liệu, đơn vị, mã máy, loại máy, ngày bắt đầu chu kỳ, ngày kiểm quỹ, số tiền chênh lệch.',
    variables: [
      { name: '{{file_name}}', desc: 'Tên file đang xử lý (inject tự động)' },
    ],
    codePromptPreview: `[PROMPT ĐẦY ĐỦ — Xem file: BRD/IDP/PROMPT/IDP OCR Biên bản kiểm quỹ CDM-ATM.txt]

TÓM TẮT:
- Detect loại BBKQ: CDM (Mẫu 1) hoặc ATM (Mẫu 2)
- Trích xuất thông tin chung, kết quả kiểm quỹ, chi tiết mệnh giá/cassette, xử lý, ký kết
- Vietnamese diacritic verification protocol
- Anti-hallucination: chỉ trả giá trị nhìn thấy trên tài liệu
- Trả JSON theo schema chuẩn (CDM/ATM format)`,
    hasDynamicSections: false,
  },
];

const MARGIN_DEPOSIT_PROFILE_STEPS: WorkflowStep[] = [
  {
    key: 'classify',
    label: 'Mode classify — Nhận diện loại chứng từ',
    icon: '🏷️',
    connector: 'ext-classifier',
    description: 'Mode độc lập: phân loại từng file PDF và tách các lần xuất hiện của TTKQ, BBTL, ĐKNV, GTTT, TTCN và ĐTS.',
    variables: [
      { name: '{{file_name}}', desc: 'Tên file hồ sơ đang được phân loại.' },
      { name: '{{categories}}', desc: 'Danh sách doc_code và nhãn chứng từ được workflow hỗ trợ.' },
    ],
    codePromptPreview: `Phân loại toàn bộ trang trong "{{file_name}}" theo taxonomy hồ sơ ký quỹ.

Danh mục hỗ trợ:
{{categories}}

Nhóm các trang liên tiếp cùng loại thành một document item; không gộp các lần xuất hiện không liên tiếp. Trả JSON có code, title, confidence, reason và page_range.`,
    hasDynamicSections: true,
    dynamicWarning: 'Mode classify không cần doc_type đầu vào và không tự crop file. Prompt override phải giữ đúng schema classification để client có thể crop theo page_range trước khi gọi mode khác.',
  },
  {
    key: 'extract',
    label: 'Mode extraction — Bóc tách dữ liệu',
    icon: '🔍',
    connector: 'ext-data-extractor',
    description: 'Mode độc lập: mỗi file là một chứng từ. Extract và presence (bên dưới) chạy song song trong CÙNG một lệnh gọi mode extraction, không tách bước riêng.',
    variables: [
      { name: '{{file_name}}', desc: 'Định danh file đầu vào của chứng từ.' },
      { name: '{{doc_code}}', desc: 'Mã loại chứng từ khai báo trong metadata.file_meta[].' },
      { name: '{{fields}}', desc: 'Danh sách field phải trích xuất cho doc_code.' },
      { name: '{{page_range}}', desc: 'Phạm vi trang của chứng từ nếu có trong metadata client.' },
    ],
    codePromptPreview: `Bóc tách dữ liệu cho chứng từ {{doc_code}} thuộc file {{file_name}}.

Các field bắt buộc:
{{fields}}

Trả JSON fields với value và confidence cho đầy đủ field theo schema runtime.`,
    hasDynamicSections: true,
    dynamicWarning: 'Các biến {{doc_code}} và {{fields}} thay đổi theo từng chứng từ. Prompt override phải trả đủ field và đúng schema value/confidence để không bị INVALID_AI_RESPONSE.',
  },
  {
    key: 'presence',
    label: 'Mode extraction — Kiểm tra chữ ký và con dấu',
    icon: '✍️',
    connector: 'ext-data-extractor',
    description: 'Mode độc lập: chạy song song với extract (thẻ trên) trong cùng lệnh gọi mode extraction, không phải bước kế tiếp.',
    variables: [
      { name: '{{file_name}}', desc: 'Tên file (hoặc PNG trang) đang được kiểm tra.' },
      { name: '{{page_range}}', desc: 'Phạm vi trang tương ứng nếu có trong metadata client.' },
    ],
    codePromptPreview: `Kiểm tra chữ ký và con dấu trong {{file_name}}.

Trả từng trang dạng { page_id, main_signature, initial_signature, seal_status }. Mỗi trạng thái là { value, confidence, bbox }, bbox riêng cho đúng loại và chuẩn hóa 0-1000; không dùng bbox cấp page.`,
    hasDynamicSections: true,
    dynamicWarning: 'Runtime luôn nối thêm contract bắt buộc về đầy đủ trang, page_id 1-based và bbox chuẩn hóa 0-1000 vào prompt override.',
  },
  {
    key: 'framework',
    label: 'Mode framework — Đối chiếu chứng từ khung',
    icon: '📑',
    connector: 'ext-comparator',
    description: 'Mode độc lập: so sánh file role=customer với file role=template có cùng doc_type.',
    variables: [
      { name: '{{customer_doc}}', desc: 'Metadata của chứng từ khách hàng đang được đối chiếu.' },
      { name: '{{framework_doc}}', desc: 'Danh sách chứng từ khung cùng doc_type.' },
    ],
    codePromptPreview: `So sánh chứng từ khách hàng:
{{customer_doc}}

Với chứng từ khung:
{{framework_doc}}

Trả clauses_modified gồm clause_id, action, original, current, severity và verdict PASS|FAIL|WARNING.`,
    hasDynamicSections: true,
    dynamicWarning: 'Cùng một mảng files[] được phân vai bằng metadata.file_meta[].role. Prompt override phải giữ schema clauses_modified/verdict để runtime validate kết quả comparator.',
  },
  {
    key: 'copy_diff',
    label: 'Mode validation — Copy-check AI + template-check',
    icon: '⚖️',
    connector: 'ext-comparator',
    description: 'Mode độc lập: copy-check toàn văn bằng AI cho N≥3 bản cùng doc_type/group_id và template-check chạy song song.',
    variables: [
      { name: '{{doc_type}}', desc: 'Loại chứng từ của nhóm bản sao cần đối chiếu.' },
      { name: '{{file_list}}', desc: 'Danh sách file trong cùng nhóm (không giới hạn số bản tối đa).' },
    ],
    codePromptPreview: `So sánh TOÀN BỘ nội dung các file cùng doc_type/group_id.

Chỉ báo cáo khác biệt có ý nghĩa về nội dung trong mảng differences[]. Nếu không có khác biệt, trả { "differences": [] }.

Verdict runtime: MATCH khi differences rỗng; MISMATCH khi có bất kỳ difference nào, không phụ thuộc severity.`,
    hasDynamicSections: true,
    dynamicWarning: 'Mode validation yêu cầu group_id cho customer TTKQ/BBTL. Copy-check dùng AI full-document diff; template-check tái sử dụng cấu hình đối chiếu chứng từ khung.',
  },
];

const WORKFLOW_STEPS: Record<string, WorkflowStep[]> = {
  'workflows:margin-deposit': MARGIN_DEPOSIT_PROFILE_STEPS,
  'workflows:disbursement': DISBURSEMENT_STEPS,
  'workflows:account-opening': ACCOUNT_OPENING_STEPS,
  'workflows:lc-checker': LC_CHECKER_STEPS,
  'workflows:payroll-verify': PAYROLL_VERIFY_STEPS,
  'workflows:structure-compare': STRUCTURE_COMPARE_STEPS,
  'workflows:brd-analyze': BRD_ANALYZE_STEPS,
  'workflows:payment-account-management': PAYMENT_ACCOUNT_MANAGEMENT_STEPS,
  'workflows:statement-analyze': STATEMENT_ANALYZE_STEPS,
  'workflows:financial-report-translation': FINANCIAL_REPORT_STEPS,
  'workflows:tracing-portal': TRACING_PORTAL_STEPS,
};

function readWorkflowPrompts(paramsObj: Record<string, { value: any; isLocked: boolean }>) {
  const saved = paramsObj._workflowPrompts?.value || {};
  const state: Record<string, { enabled: boolean; prompt: string }> = {};
  for (const [key, value] of Object.entries(saved)) {
    if (typeof value === 'string' && value.trim()) {
      state[key] = { enabled: true, prompt: value };
    }
  }
  return state;
}

function readWorkflowModels(paramsObj: Record<string, { value: any; isLocked: boolean }>) {
  const saved = paramsObj._workflowModels?.value || {};
  return Object.fromEntries(
    Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim())),
  );
}

function readWorkflowReasoningEfforts(paramsObj: Record<string, { value: any; isLocked: boolean }>) {
  const saved = paramsObj._workflowReasoningEfforts?.value || {};
  return Object.fromEntries(
    Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim())),
  );
}

function preserveNonEditableWorkflowValues(value: unknown, editableStepKeys: Set<string>): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const preserved: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!editableStepKeys.has(key) && typeof item === 'string') preserved[key] = item;
  }
  return preserved;
}

function WorkflowPromptPanel({
  endpoint,
  paramsObj,
  setParamsObj,
  canManageEndpoints,
  syncKey,
}: {
  endpoint: any;
  paramsObj: Record<string, { value: any; isLocked: boolean }>;
  setParamsObj: React.Dispatch<React.SetStateAction<Record<string, { value: any; isLocked: boolean }>>>;
  canManageEndpoints: boolean;
  syncKey: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, { enabled: boolean; prompt: string }>>(() => readWorkflowPrompts(paramsObj));
  const [models, setModels] = useState<Record<string, string>>(() => readWorkflowModels(paramsObj));
  const [reasoningEfforts, setReasoningEfforts] = useState<Record<string, string>>(() => readWorkflowReasoningEfforts(paramsObj));
  const steps = WORKFLOW_STEPS[endpoint.slug];
  const isIndependentModeWorkflow = endpoint.slug === 'workflows:margin-deposit';

  useEffect(() => {
    setIsOpen(false);
    setOverrides(readWorkflowPrompts(paramsObj));
    setModels(readWorkflowModels(paramsObj));
    setReasoningEfforts(readWorkflowReasoningEfforts(paramsObj));
    // syncKey changes only when Profile or endpoint identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  const editableStepKeys = useMemo(
    () => new Set((steps ?? []).filter(step => step.kind !== 'code').map(step => step.key)),
    [steps],
  );

  useEffect(() => {
    if (!canManageEndpoints || !steps) return;
    setParamsObj(previous => {
      const existing = previous._workflowModels?.value;
      const activeModels = preserveNonEditableWorkflowValues(existing, editableStepKeys);
      for (const [key, value] of Object.entries(models)) {
        if (editableStepKeys.has(key) && value.trim()) activeModels[key] = value.trim();
      }
      const current = JSON.stringify(existing || {});
      const nextValue = JSON.stringify(activeModels);
      if (current === nextValue) return previous;
      const next = { ...previous };
      if (Object.keys(activeModels).length > 0) next._workflowModels = { value: activeModels, isLocked: false };
      else delete next._workflowModels;
      return next;
    });
  }, [editableStepKeys, canManageEndpoints, models, setParamsObj, steps]);

  const updateModel = (stepKey: string, value: string) => {
    if (!canManageEndpoints || !editableStepKeys.has(stepKey)) return;
    setModels(previous => {
      const next = { ...previous };
      if (!value.trim()) delete next[stepKey];
      else next[stepKey] = value;
      return next;
    });
  };

  useEffect(() => {
    if (!canManageEndpoints || !steps) return;
    setParamsObj(previous => {
      const existing = previous._workflowReasoningEfforts?.value;
      const activeEfforts = preserveNonEditableWorkflowValues(existing, editableStepKeys);
      for (const [key, value] of Object.entries(reasoningEfforts)) {
        if (editableStepKeys.has(key) && value.trim()) activeEfforts[key] = value.trim();
      }
      const current = JSON.stringify(existing || {});
      const nextValue = JSON.stringify(activeEfforts);
      if (current === nextValue) return previous;
      const next = { ...previous };
      if (Object.keys(activeEfforts).length > 0) next._workflowReasoningEfforts = { value: activeEfforts, isLocked: false };
      else delete next._workflowReasoningEfforts;
      return next;
    });
  }, [editableStepKeys, canManageEndpoints, reasoningEfforts, setParamsObj, steps]);

  const updateReasoningEffort = (stepKey: string, value: string) => {
    if (!canManageEndpoints || !editableStepKeys.has(stepKey)) return;
    setReasoningEfforts(previous => {
      const next = { ...previous };
      if (!value.trim()) delete next[stepKey];
      else next[stepKey] = value;
      return next;
    });
  };

  useEffect(() => {
    if (!canManageEndpoints || !steps) return;
    setParamsObj(previous => {
      const existing = previous._workflowPrompts?.value;
      const activePrompts = preserveNonEditableWorkflowValues(existing, editableStepKeys);
      for (const [key, override] of Object.entries(overrides)) {
        if (editableStepKeys.has(key) && override.enabled && override.prompt.trim()) {
          activePrompts[key] = override.prompt.trim();
        }
      }
      const current = JSON.stringify(existing || {});
      const nextValue = JSON.stringify(activePrompts);
      if (current === nextValue) return previous;
      const next = { ...previous };
      if (Object.keys(activePrompts).length > 0) next._workflowPrompts = { value: activePrompts, isLocked: false };
      else delete next._workflowPrompts;
      return next;
    });
  }, [editableStepKeys, canManageEndpoints, overrides, setParamsObj, steps]);

  const toggleOverride = (stepKey: string) => {
    if (!canManageEndpoints || !editableStepKeys.has(stepKey)) return;
    setOverrides(previous => ({
      ...previous,
      [stepKey]: previous[stepKey]?.enabled
        ? { enabled: false, prompt: previous[stepKey]?.prompt || '' }
        : { enabled: true, prompt: previous[stepKey]?.prompt || '' },
    }));
  };

  const updatePrompt = (stepKey: string, value: string) => {
    if (!canManageEndpoints || !editableStepKeys.has(stepKey)) return;
    setOverrides(previous => ({
      ...previous,
      [stepKey]: { ...previous[stepKey], enabled: true, prompt: value },
    }));
  };

  const activeOverrides = Object.entries(overrides)
    .filter(([key, value]) => editableStepKeys.has(key) && value.enabled).length;

  if (!steps) {
    return (
      <div className="sm:col-span-2 mt-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-4">
        <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
          <Code className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Workflow chưa có metadata cấu hình</p>
            <p className="text-xs mt-1">Không fallback sang workflow khác. Endpoint này chỉ hiển thị read-only cho đến khi runtime step map được khai báo rõ ràng.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sm:col-span-2 mt-4 pt-4 border-t border-border/50">
      <div
        className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400 mb-4 cursor-pointer hover:bg-purple-50/50 dark:hover:bg-purple-950/30 w-fit p-1.5 -ml-1.5 rounded transition-colors select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
        <Code className="w-4 h-4" />
        Workflow Prompts ({isIndependentModeWorkflow ? '4 mode độc lập' : `${steps.length} Bước DAG`})
        {activeOverrides > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded-sm ml-1">
            {activeOverrides} Override
          </span>
        )}
        <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-200/80 text-purple-800 dark:bg-purple-800/50 dark:text-purple-200 px-2 py-0.5 rounded-sm">
          Code-Driven
        </span>
      </div>

      {isOpen && (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
          {/* Info banner */}
          <div className="bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/50 dark:border-purple-800/50 rounded-lg p-3 text-xs text-purple-700 dark:text-purple-300 leading-relaxed flex gap-2 items-start">
            <Code className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
            <div>
              <strong className="text-purple-900 dark:text-purple-100">Cấu hình mode độc lập:</strong>{' '}
              {isIndependentModeWorkflow
                ? <>Mỗi mode được gọi trực tiếp bằng <code className="font-mono">metadata.mode</code>; các thẻ dưới đây không biểu thị thứ tự chạy. Prompt/model/reasoning override chỉ áp dụng cho mode hoặc sub-check tương ứng.</>
                : <>Prompt mặc định được định nghĩa trong code TypeScript. Bạn có thể <strong>override từng bước</strong> tại đây. Khi override, prompt sẽ được dùng thay cho code mặc định. Tắt override → quay về prompt gốc trong code.</>}
            </div>
          </div>

          {/* Steps */}
          {steps.map((step, idx) => {
            const override = overrides[step.key];
            const isCodeOnly = step.kind === 'code';
            const isOverridden = !isCodeOnly && override?.enabled === true;

            return (
              <div key={step.key} className="relative">
                {idx > 0 && !isIndependentModeWorkflow && (
                  <div className="flex justify-center -mt-1.5 mb-1.5">
                    <div className="w-0.5 h-4 bg-purple-200 dark:bg-purple-800" />
                  </div>
                )}

                <div className={`rounded-xl border overflow-hidden transition-all duration-200 ${
                  isOverridden
                    ? 'border-amber-300 dark:border-amber-800 bg-amber-50/20 dark:bg-amber-950/10 shadow-sm'
                    : 'border-purple-200/50 dark:border-purple-800/50 bg-background'
                }`}>
                  {/* Step header */}
                  <div className="px-4 py-3 flex items-center justify-between bg-muted/30 border-b border-border/30">
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg" aria-hidden="true">{step.icon}</span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold">{step.label}</span>
                          <span className="text-[10px] bg-background border px-1.5 py-0.5 rounded text-muted-foreground font-mono">{step.connector}</span>
                          {isCodeOnly && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 rounded-sm">Xử lý tự động</span>
                          )}
                          {isOverridden && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 px-2 py-0.5 rounded-sm">
                              Override Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                      </div>
                    </div>

                    {!isCodeOnly && (
                      <button
                        onClick={() => toggleOverride(step.key)}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shrink-0 border ${
                          isOverridden
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/70 border-amber-200 dark:border-amber-800'
                            : 'bg-background text-foreground hover:bg-purple-50 dark:hover:bg-purple-950/30 border-border hover:border-purple-300 dark:hover:border-purple-700'
                        }`}
                      >
                        {isOverridden ? '✕ Bỏ ghi đè' : '✏️ Ghi đè prompt'}
                      </button>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-4 space-y-3">
                    {isCodeOnly ? (
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/30 p-3">
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Bước này chạy bằng TypeScript; không có model hoặc prompt override.</p>
                        <pre className="mt-2 text-[11px] text-muted-foreground font-mono whitespace-pre-wrap max-h-[180px] overflow-y-auto">{step.codePromptPreview}</pre>
                      </div>
                    ) : (
                      <>
                    {/* Per-step Model Override */}
                    <div className="border border-sky-200 dark:border-sky-800 rounded-lg p-3 bg-sky-50/40 dark:bg-sky-950/20">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 mb-1.5 flex items-center gap-1">
                        <Code className="w-3 h-3" /> Model Override
                        {models[step.key]?.trim() && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300 px-1.5 py-0.5 rounded-sm ml-1 normal-case tracking-normal">
                            {models[step.key]}
                          </span>
                        )}
                      </label>
                      <input
                        value={models[step.key] ?? ''}
                        maxLength={200}
                        onChange={(e) => updateModel(step.key, e.target.value)}
                        className="w-full text-xs font-mono p-2 rounded-lg border border-sky-200 dark:border-sky-900 focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 bg-white dark:bg-card outline-none"
                        placeholder="VD: gpt-4o, gemini-2.5-flash — để trống = dùng model mặc định của connector"
                      />
                    </div>

                    {/* Per-step reasoning_effort Override (OpenAI-compatible) */}
                    <div className="border border-sky-200 dark:border-sky-800 rounded-lg p-3 bg-sky-50/40 dark:bg-sky-950/20">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 mb-1.5 flex items-center gap-1">
                        <Code className="w-3 h-3" /> reasoning_effort Override
                        {reasoningEfforts[step.key]?.trim() && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300 px-1.5 py-0.5 rounded-sm ml-1 normal-case tracking-normal">
                            {reasoningEfforts[step.key]}
                          </span>
                        )}
                      </label>
                      <select
                        value={reasoningEfforts[step.key] ?? ''}
                        onChange={(e) => updateReasoningEffort(step.key, e.target.value)}
                        className="w-full text-xs font-mono p-2 rounded-lg border border-sky-200 dark:border-sky-900 focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 bg-white dark:bg-card outline-none"
                      >
                        <option value="">Mặc định (theo connector)</option>
                        <option value="minimal">minimal</option>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </div>

                    {isOverridden ? (
                      <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                        {step.hasDynamicSections && (
                          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/50 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300 flex gap-2 items-start">
                            <FlaskConical className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <strong className="text-amber-900 dark:text-amber-100">Lưu ý:</strong>{' '}
                              {step.dynamicWarning}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mr-1 self-center">Biến:</span>
                          {step.variables.map(v => (
                            <button
                              key={v.name}
                              onClick={() => updatePrompt(step.key, (override?.prompt || '') + v.name)}
                              className="text-[11px] font-mono bg-purple-100/80 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded border border-purple-200/50 dark:border-purple-800/50 hover:bg-purple-200/80 dark:hover:bg-purple-800/50 transition-colors cursor-pointer"
                              title={v.desc}
                            >
                              {v.name}
                            </button>
                          ))}
                        </div>

                        <textarea
                          value={override?.prompt || ''}
                          onChange={(e) => updatePrompt(step.key, e.target.value)}
                          className="w-full text-sm font-mono p-3 rounded-lg border border-amber-200 dark:border-amber-900 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 bg-white dark:bg-card outline-none leading-relaxed min-h-[180px] resize-y"
                          placeholder={`Nhập prompt override cho ${step.label}...\n\nSử dụng các biến ở trên để chèn data từ pipeline.`}
                        />

                        <details className="group">
                          <summary className="text-xs font-semibold text-muted-foreground cursor-pointer outline-none w-fit hover:text-foreground transition-colors flex items-center gap-1.5">
                            <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                            Xem Code Prompt gốc (Tham khảo)
                          </summary>
                          <pre className="mt-2 text-[11px] text-muted-foreground whitespace-pre-wrap font-mono p-3 bg-muted/50 border border-border rounded-lg leading-relaxed max-h-[250px] overflow-y-auto">
                            {step.codePromptPreview}
                          </pre>
                        </details>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Code Prompt (Mặc định)</span>
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                            Active
                          </span>
                        </div>
                        <pre className="text-[11px] text-muted-foreground font-mono bg-muted/30 p-3 rounded-lg border border-border/50 whitespace-pre-wrap max-h-[150px] overflow-y-auto leading-relaxed cursor-text select-all">
                          {step.codePromptPreview}
                        </pre>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <span className="text-[10px] text-muted-foreground/70">Biến dynamic:</span>
                          {step.variables.map(v => (
                            <span
                              key={v.name}
                              className="text-[10px] font-mono text-purple-600/60 dark:text-purple-400/60"
                              title={v.desc}
                            >
                              {v.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {activeOverrides > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/50 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300 flex gap-2 items-center mt-2">
              <FileText className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                <strong>{activeOverrides}</strong> prompt override đang active. Nhấn <strong>&ldquo;Lưu Toàn bộ Thiết lập&rdquo;</strong> để áp dụng.
                <span className="text-amber-500/80 ml-1">(Đã đồng bộ với Parameters — sẽ được lưu vào DB)</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
