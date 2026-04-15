'use client';

import { useState, useEffect, Suspense, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Loader2, CheckCircle, Plus, Copy,
  Settings, Save, Key, ChevronRight, ChevronDown, FileText, PlugZap, Trash2, Code, FlaskConical, Zap, XCircle, GripVertical, X
} from 'lucide-react';
import { toast } from 'sonner';

interface ApiKey {
  id: string;
  name: string;
  status: string;
  keyHash?: string;
  note?: string;
}

export default function OverridesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session || session.user.role !== 'ADMIN') {
      router.push('/');
    }
  }, [session, status, router]);

  if (status === 'loading' || !session || session.user.role !== 'ADMIN') {
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
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'ADMIN';
  const [loading, setLoading] = useState(true);

  // Data State
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [allConnectors, setAllConnectors] = useState<{ id: string; slug: string; name: string; defaultPrompt?: string }[]>([]);

  // Selection State
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [profileEndpoints, setProfileEndpoints] = useState<any[]>([]);
  const [activeServiceTab, setActiveServiceTab] = useState<string>('extract');

  // New Client Modal/State
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [createdRawKey, setCreatedRawKey] = useState<{ name: string; key: string } | null>(null);

  // Profile Details State
  const selectedClient = apiKeys.find(k => k.id === selectedClientId);
  const [profileNote, setProfileNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);

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
    if (selectedClient) {
      setProfileNote(selectedClient.note || '');
    }
  }, [selectedClient]);

  const handleSaveNote = async () => {
    if (!selectedClientId) return;
    setSavingNote(true);
    try {
      const res = await fetch('/api/internal/apikeys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedClientId, note: profileNote, action: 'update' })
      });
      if (res.ok) {
        setApiKeys(prev => prev.map(k => k.id === selectedClientId ? { ...k, note: profileNote } : k));
        toast.success('Đã lưu ghi chú!');
      } else {
        const body = await res.json();
        toast.error(body.error || 'Lỗi khi lưu');
      }
    } catch {
      toast.error('Lỗi kết nối');
    } finally {
      setSavingNote(false);
    }
  };

  const handleRotateKey = async () => {
    if (!selectedClientId) return;
    confirmAction(
      'Cấp phát Key mới',
      'Bạn có chắc chắn muốn rotate key? Profile sẽ nhận Key mới lập tức và có thể làm thiết bị phía client đang dùng key cũ mất kết nối.',
      async () => {
        try {
          const res = await fetch('/api/internal/apikeys', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: selectedClientId, action: 'rotate' })
          });
          const data = await res.json();
          if (data.success) {
            setApiKeys(prev => prev.map(k => k.id === selectedClientId ? { ...k, keyHash: data.apiKey.keyHash } : k));
            setCreatedRawKey({ name: data.apiKey.name, key: data.rawKey });
            window.scrollTo({ top: 0, behavior: 'smooth' });
            toast.success('Đã cấp phát Key mới!');
          } else {
            toast.error(data.error);
          }
        } catch {
          toast.error('Lỗi kết nối');
        }
      },
      true, // Destructive meaning warning
      'Rotate Key'
    );
  };

  const handleBulkToggle = async (enabled: boolean) => {
    if (!selectedClientId) return;
    confirmAction(
      enabled ? 'Bật tất cả Endpoints' : 'Tắt tất cả Endpoints',
      `Bạn có chắc chắn muốn ${enabled ? 'Bật' : 'Tắt'} TẤT CẢ các Endpoints cho Profile này? Mọi lưu lượng kết nối sẽ ảnh hưởng theo hành động này.`,
      async () => {
        setSavingBulk(true);
        try {
          const promises = profileEndpoints.map(ep => fetch('/api/internal/profile-endpoints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKeyId: selectedClientId,
              endpointSlug: ep.slug,
              enabled,
              parameters: ep.parameters,
              connectionsOverride: ep.connectionsOverride,
            }),
          }));
          await Promise.all(promises);
          await fetchProfileEndpoints(selectedClientId);
          toast.success(`Đã ${enabled ? 'bật' : 'tắt'} tất cả Endpoints!`);
        } catch {
          toast.error("Cập nhật hàng loạt thất bại.");
        } finally {
          setSavingBulk(false);
        }
      },
      !enabled, // Destructive only if disabling
      enabled ? 'Bật tất cả' : 'Tắt tất cả'
    );
  };

  // Group endpoints
  const groupedEndpoints = profileEndpoints.reduce((acc: Record<string, any[]>, ep: any) => {
    const slug = ep.serviceSlug || 'extract';
    if (!acc[slug]) acc[slug] = [];
    acc[slug].push(ep);
    return acc;
  }, {});

  // Filter: chỉ hiện enabled
  const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);
  const filteredGroupedEndpoints = showOnlyEnabled
    ? Object.fromEntries(
        Object.entries(groupedEndpoints)
          .map(([slug, eps]) => [slug, (eps as any[]).filter((ep: any) => ep.enabled)])
          .filter(([, eps]) => (eps as any[]).length > 0)
      )
    : groupedEndpoints;

  // Fetch initial data
  const fetchData = async () => {
    try {
      const overridesRes = await fetch('/api/internal/apikeys');
      const data = await overridesRes.json();

      if (data.success) {
        setApiKeys(data.apiKeys);
        if (!selectedClientId && data.apiKeys.length > 0) {
          const defaultId = searchParams?.get('client') || data.apiKeys[0].id;
          setSelectedClientId(defaultId);
        }
      }
    } catch (e) {
      console.error('Failed to load initial data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Fetch connectors once at page level — shared by all ProfileEndpointCard children
    fetch('/api/internal/ext-connections')
      .then(r => r.json())
      .then(data => { if (data.connections) setAllConnectors(data.connections); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchProfileEndpoints = async (clientId: string) => {
    try {
      const res = await fetch(`/api/internal/profile-endpoints?apiKeyId=${clientId}`);
      const data = await res.json();
      if (data.endpoints) setProfileEndpoints(data.endpoints);
    } catch (e) {
      console.error('Failed to load profile endpoints');
    }
  };

  useEffect(() => {
    if (selectedClientId) {
      fetchProfileEndpoints(selectedClientId);
    } else {
      setProfileEndpoints([]);
    }
  }, [selectedClientId]);

  // Handle Client Creation
  const handleCreateClient = async () => {
    if (!newClientName) return;
    try {
      const res = await fetch('/api/internal/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newClientName }),
      });
      const data = await res.json();
      if (data.success) {
        setApiKeys([...apiKeys, data.apiKey]);
        setCreatedRawKey({ name: data.apiKey.name, key: data.rawKey });
        setShowAddClient(false);
        setNewClientName('');
        toast.success('Đã tạo API Key thành công!');
      } else {
        toast.error(data.error);
      }
    } catch (e) {
      toast.error('Lỗi khi tạo API Key');
    }
  };

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
              router.replace('/profiles', { scroll: false });
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

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-2 flex items-center gap-2">
          <Settings className="w-8 h-8 text-primary" />
          Profiles API
        </h1>
        <p className="text-muted-foreground text-base max-w-3xl">
          Quản lý các Profiles (API Keys), tùy chỉnh thiết lập Endpoint, và ghi đè Pipeline Processors cho từng Client riêng biệt.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">

        {/* L E F T   S I D E B A R   ( C L I E N T S ) */}
        <div className="w-full md:w-80 shrink-0 space-y-4">
          <div className="modern-card overflow-hidden flex flex-col h-[70vh] min-h-[500px]">
            {/* Header Sidebar */}
            <div className="bg-muted p-4 border-b border-border flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2 text-foreground">
                <Key className="w-4 h-4 text-primary" />
                Profiles ({apiKeys.length})
              </h2>
              {isAdmin && (
                <button
                  onClick={() => setShowAddClient(!showAddClient)}
                  className="p-1.5 hover:bg-primary/10 text-primary rounded-md transition-colors shadow-sm bg-background border border-border"
                  title="Thêm Client Mới"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* List Clients */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {apiKeys.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Chưa có Client nào. Vui lòng bấm dấu + để tạo mới.
                </div>
              ) : (
                apiKeys.map(key => {
                  const isSelected = key.id === selectedClientId;
                  return (
                    <button
                      key={key.id}
                      onClick={() => {
                        setSelectedClientId(key.id);
                        router.replace(`/profiles?client=${key.id}`, { scroll: false });
                        setCreatedRawKey(null); // Clear new key alert if they switch
                      }}
                      className={`w-full text-left px-3 py-3 rounded-lg flex items-center justify-between transition-all ${isSelected
                        ? 'bg-primary text-primary-foreground shadow-md'
                        : 'hover:bg-muted text-foreground'
                        }`}
                    >
                      <div className="flex flex-col truncate pr-2">
                        <span className="font-semibold text-sm truncate">{key.name}</span>
                        <span className={`text-[10px] mt-0.5 truncate uppercase tracking-widest ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          {key.id.split('-')[0]}••••
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

          {/* Add Client Inline Form */}
          {showAddClient && (
            <div className="modern-card border-2 border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-950/20 p-6 animate-in slide-in-from-top-4 duration-300">
              <h3 className="font-bold text-indigo-900 dark:text-indigo-100 flex items-center gap-2 mb-4">
                <Plus className="w-5 h-5 text-indigo-500" /> Cấp phát API Key mới
              </h3>
              <div className="flex flex-col sm:flex-row items-end gap-3">
                <div className="flex-1 w-full">
                  <label className="text-sm font-medium text-foreground mb-1 block">Tên Ứng dụng / Client</label>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Ví dụ: App Kế toán Công ty, Client B..."
                    value={newClientName}
                    onChange={e => setNewClientName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                    className="input-field"
                  />
                </div>
                <button
                  onClick={handleCreateClient}
                  disabled={!newClientName.trim()}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg disabled:opacity-50 transition-colors"
                >
                  Tạo Access Key
                </button>
                <button
                  onClick={() => setShowAddClient(false)}
                  className="px-4 py-2.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg text-sm text-muted-foreground transition-colors"
                >
                  Hủy
                </button>
              </div>
            </div>
          )}

          {/* Success Notification for new API Key */}
          {createdRawKey && (
            <div className="modern-card border-green-500 bg-green-50 dark:bg-green-950/20 dark:border-green-900/50 p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                <div className="space-y-3 w-full">
                  <div>
                    <h3 className="text-lg font-bold text-green-900 dark:text-green-100">Đã tạo API Key thành công: {createdRawKey.name}</h3>
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
          {selectedClientId && apiKeys.length > 0 && selectedClient && (
            <div className="space-y-4 animate-in fade-in duration-300">

              {/* Profile Overview Card */}
              <div className="modern-card p-6 bg-gradient-to-r from-background to-muted/30 border border-border shadow-sm">
                <div className="flex flex-col gap-6">
                  {/* Top: API Key */}
                  <div className="flex-1 space-y-4">
                    <div>
                      <h2 className="text-xl font-bold flex items-center gap-2 text-foreground">
                        {selectedClient.name}
                        {selectedClient.name === 'Global Profile' && (
                          <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full uppercase tracking-wider">Default</span>
                        )}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1">Thông tin chi tiết và Access Key của Profile.</p>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Static API Key</label>
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-4 py-2 rounded-lg text-sm font-mono border border-border flex-1 max-w-sm">
                          {selectedClient.keyHash?.substring(0, 15)}...{selectedClient.keyHash?.substring(selectedClient.keyHash.length - 8)}
                        </code>
                        {isAdmin && (
                          <button
                            onClick={handleRotateKey}
                            className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                          >
                            <Zap className="w-4 h-4" />
                            Rotate Key
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bottom: Note */}
                  <div className="flex-1 flex flex-col">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Ghi chú (Admin Note)</label>
                    <textarea
                      value={profileNote}
                      readOnly={!isAdmin}
                      onChange={e => setProfileNote(e.target.value)}
                      placeholder="Ghi chú thêm về Profile này (vd: Khách hàng nào, ứng dụng nào...)"
                      className="input-field min-h-[80px] text-sm resize-none"
                    ></textarea>
                    {isAdmin && (
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={handleSaveNote}
                          disabled={savingNote}
                          className="px-4 py-1.5 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-black rounded-md text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          Lưu Ghi Chú
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-8 mb-4 border-b border-border pb-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold flex items-center gap-2">Endpoints Hierarchy</h2>
                  <p className="text-sm text-muted-foreground">Toàn bộ endpoints trong hệ thống của Profile này.</p>
                </div>

                <div className="flex items-center gap-3">
                  {/* Filter toggle */}
                  <button
                    onClick={() => setShowOnlyEnabled(v => !v)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      showOnlyEnabled
                        ? 'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800'
                        : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted'
                    }`}
                    title="Lọc chỉ hiện Enabled"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {showOnlyEnabled ? 'Enabled only' : 'Tất cả'}
                  </button>

                  {isAdmin && profileEndpoints.length > 0 && (
                    <div className="flex items-center space-x-2 bg-muted/40 p-1 rounded-lg border border-border mr-2">
                      <button
                        onClick={() => handleBulkToggle(true)}
                        disabled={savingBulk}
                        className="px-3 py-1.5 text-xs font-semibold rounded-md bg-green-50/50 dark:bg-green-950/20 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 border border-transparent hover:border-green-200 dark:hover:border-green-800 transition-all flex items-center gap-1"
                      >
                        {savingBulk && <Loader2 className="w-3 h-3 animate-spin" />} Bật tất cả
                      </button>
                      <button
                        onClick={() => handleBulkToggle(false)}
                        disabled={savingBulk}
                        className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 border border-transparent hover:border-red-200 dark:hover:border-red-800 transition-all flex items-center gap-1"
                      >
                        {savingBulk && <Loader2 className="w-3 h-3 animate-spin" />} Tắt tất cả
                      </button>
                    </div>
                  )}

                  {isAdmin && selectedClient.name !== 'Global Profile' && (
                    <button
                      onClick={() => handleDeleteClient(selectedClientId)}
                      className="px-3 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 border border-red-200 dark:border-red-900/50 shadow-sm shrink-0"
                      title="Xoá vĩnh viễn Client này"
                    >
                      <Trash2 className="w-4 h-4" />
                      Xóa Profile
                    </button>
                  )}
                </div>
              </div>

              {profileEndpoints.length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(filteredGroupedEndpoints).map(([slug, eps]) => (
                    <EndpointGroup
                      key={slug}
                      slug={slug}
                      eps={eps as any[]}
                      apiKeyId={selectedClientId}
                      allConnectors={allConnectors}
                      isAdmin={isAdmin}
                      onUpdated={() => fetchProfileEndpoints(selectedClientId)}
                    />
                  ))}
                  {showOnlyEnabled && Object.keys(filteredGroupedEndpoints).length === 0 && (
                    <div className="p-8 text-center border-dashed border-2 rounded-xl text-muted-foreground">
                      Không có endpoint nào đang Enabled.
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center border-dashed border-2 rounded-xl text-muted-foreground flex flex-col items-center">
                  <Settings className="w-8 h-8 opacity-20 mb-2" />
                  Không tìm thấy Endpoint Configuration. (Nếu bạn vừa cập nhật kiến trúc, hãy chạy script Seeding).
                </div>
              )}
            </div>
          )}

          {!selectedClientId && apiKeys.length > 0 && (
            <div className="flex flex-col items-center justify-center p-12 modern-card border-dashed">
              <Key className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
              <p className="text-lg font-medium text-muted-foreground">Vui lòng chọn một Profile ở menu bên trái để bắt đầu cấu hình.</p>
            </div>
          )}
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
                  confirmState.onConfirm();
                  setConfirmState({ ...confirmState, isOpen: false });
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

function EndpointGroup({ slug, eps, apiKeyId, allConnectors, isAdmin, onUpdated }: {
  slug: string;
  eps: any[];
  apiKeyId: string;
  isAdmin: boolean;
  allConnectors: { id: string; slug: string; name: string; defaultPrompt?: string }[];
  onUpdated: () => void;
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

      {isExpanded && (
        <div className="p-4 pt-0">
          {isWorkflowGroup && (
            <div className="mb-4 bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/50 dark:border-purple-800/50 rounded-lg p-3 text-xs text-purple-700 dark:text-purple-300 leading-relaxed flex gap-2 items-start">
              <Code className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
              <div>
                <strong className="text-purple-900 dark:text-purple-100">Workflow Orchestration:</strong>{' '}
                Các workflow được điều phối bằng code TypeScript (trong <code className="bg-purple-100 dark:bg-purple-900/50 px-1 py-0.5 rounded border border-purple-200/50 dark:border-purple-800/50 font-semibold">{`lib/pipelines/workflows/`}</code>). 
                Prompt và pipeline steps được quản lý trong code, không qua cấu hình trực quan. 
                Tại đây chỉ quản lý <strong>Bật/Tắt</strong> và <strong>Parameters</strong> cho mỗi Client.
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
                isAdmin={isAdmin}
                onUpdated={onUpdated}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ProfileEndpointCard ───────────────────────────────────────────────────────

function ProfileEndpointCard({
  endpoint,
  apiKeyId,
  isAdmin,
  allConnectors,
  onUpdated,
}: {
  endpoint: any;
  apiKeyId: string;
  isAdmin: boolean;
  allConnectors: { id: string; slug: string; name: string; defaultPrompt?: string }[];
  onUpdated: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [isActive, setIsActive] = useState(endpoint.enabled);
  const [isEditing, setIsEditing] = useState(false);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isProcessorsOpen, setIsProcessorsOpen] = useState(false);
  const [isCurlOpen, setIsCurlOpen] = useState(false);

  // Unified Param state
  const [paramsObj, setParamsObj] = useState<Record<string, { value: any, isLocked: boolean }>>(endpoint.parameters || {});
  const [showRaw, setShowRaw] = useState(false);
  const [addKey, setAddKey] = useState('');

  // Processor overrides
  const [extOverridesState, setExtOverridesState] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);

  // Job Priority
  const [jobPriority, setJobPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH'>(
    endpoint.jobPriority ?? 'MEDIUM'
  );

  // File URL Auth Config
  const [fileUrlAuthConfig, setFileUrlAuthConfig] = useState<{
    type: 'none' | 'bearer' | 'header' | 'query';
    token?: string;
    header_name?: string;
    header_value?: string;
    query_key?: string;
    query_value?: string;
  }>(endpoint.fileUrlAuthConfig ?? { type: 'none' });
  const [isFileUrlAuthOpen, setIsFileUrlAuthOpen] = useState(false);

  // Configured allowed file extensions
  const [allowedFileExtensions, setAllowedFileExtensions] = useState<string>(endpoint.allowedFileExtensions || '');

  // Connection Routing Override — format mới: ConnectionStep[]
  interface ConnStep { slug: string; stepId?: string; captureSession?: string | null; injectSession?: string | null; }

  /** Ensure all ConnStep entries have a stepId — backfill for legacy data that doesn't have one */
  const ensureStepIds = (steps: ConnStep[]): ConnStep[] =>
    steps.map(s => s.stepId ? s : { ...s, stepId: crypto.randomUUID() });

  const [connectionsOverride, setConnectionsOverride] = useState<ConnStep[] | null>(() => {
    const raw = endpoint.connectionsOverride;
    if (!raw) return null;
    // Support cả format cũ (string[]) và format mới (ConnStep[])
    if (raw.length > 0 && typeof raw[0] === 'string') {
      return ensureStepIds((raw as string[]).map((slug: string) => ({ slug })));
    }
    return ensureStepIds(raw as ConnStep[]);
  });
  // Test Endpoint Modal State
  const [showTestModal, setShowTestModal] = useState(false);
  const [testFiles, setTestFiles] = useState<File[]>([]);
  const [testFileUrlsRaw, setTestFileUrlsRaw] = useState<string>('');
  const [testParams, setTestParams] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    setIsActive(endpoint.enabled);
    setParamsObj(endpoint.parameters || {});

    const initialOverrides: Record<string, string | null> = {};
    endpoint.extConnections?.forEach((conn: any) => {
      // Key by stepId (stable GUID) instead of connId to support duplicate connectors
      const key = conn.stepId ?? conn.connectionId;
      initialOverrides[key] = conn.promptOverride ?? null;
    });
    setExtOverridesState(initialOverrides);
    const rawOver = endpoint.connectionsOverride;
    if (!rawOver) {
      setConnectionsOverride(null);
    } else if (rawOver.length > 0 && typeof rawOver[0] === 'string') {
      setConnectionsOverride(ensureStepIds((rawOver as string[]).map((slug: string) => ({ slug }))));
    } else {
      setConnectionsOverride(ensureStepIds(rawOver as ConnStep[]));
    }
  }, [endpoint, apiKeyId]);

  const moveConnection = (idx: number, dir: 1 | -1) => {
    const defaults = (endpoint.connections || []).map((s: string) => ({ slug: s }));
    const list = connectionsOverride ? [...connectionsOverride] : [...defaults];
    const item = list.splice(idx, 1)[0];
    list.splice(idx + dir, 0, item);
    setConnectionsOverride(list);
  };

  const removeConnection = (idx: number) => {
    const defaults = (endpoint.connections || []).map((s: string) => ({ slug: s }));
    const list = connectionsOverride ? [...connectionsOverride] : [...defaults];
    list.splice(idx, 1);
    setConnectionsOverride(list);
  };

  const addConnection = (slug: string) => {
    const defaults = ensureStepIds((endpoint.connections || []).map((s: string) => ({ slug: s })));
    const list = connectionsOverride ? [...connectionsOverride] : [...defaults];
    list.push({ slug, stepId: crypto.randomUUID() });
    setConnectionsOverride(list);
  };

  const updateStepSession = (idx: number, field: 'captureSession' | 'injectSession', value: string) => {
    // Nếu chưa có override, tự động khởi tạo từ default connections
    // Việc sửa session field sẽ tự động promote thành override mode
    const defaults = ensureStepIds((endpoint.connections || []).map((s: string) => ({ slug: s })));
    const baseList = connectionsOverride ?? defaults;
    setConnectionsOverride(baseList.map((s: ConnStep, i: number) =>
      i === idx ? { ...s, [field]: value || null } : s
    ));
  };

  const resetToDefaultConnections = () => {
    setConnectionsOverride(null);
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
    setAddKey('');
    setJobPriority(endpoint.jobPriority ?? 'MEDIUM');
    setFileUrlAuthConfig(endpoint.fileUrlAuthConfig ?? { type: 'none' });
    setAllowedFileExtensions(endpoint.allowedFileExtensions || '');
    setIsFileUrlAuthOpen(false);
  }, [apiKeyId, endpoint.slug]);

  // Generate cURL preview
  const generateCurl = () => {
    // Bug fix 1: use actual browser origin instead of recreating a potentially wrong host
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://api.dugate.vn';
    const [method, routePath] = (endpoint.route || 'POST /api/v1/extract').split(' ');
    const fullUrl = `${origin}${routePath}`;

    let curlLines = [
      `curl -X ${method} "${fullUrl}" \\`,
      `  -H "x-api-key: YOUR_API_KEY" \\`
    ];

    if (testFiles.length > 0) {
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
        // Skip locked params — client shouldn't send them
        if (paramConfig.isLocked) return;

        const schema = (endpoint.parametersSchema as any)?.[key];
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

    const lastLine = curlLines[curlLines.length - 1];
    if (lastLine.endsWith(' \\')) {
      curlLines[curlLines.length - 1] = lastLine.slice(0, -2);
    }
    return curlLines.join('\n');
  };

  // Generate exact cURL for the test payload
  const generateTestCurl = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://api.dugate.vn';
    const [method, routePath] = (endpoint.route || 'POST /api/v1/extract').split(' ');
    const fullUrl = `${origin}${routePath}`;

    let curlLines = [
      `curl -X ${method} "${fullUrl}" \\`,
      `  -H "x-api-key: YOUR_API_KEY_HERE" \\`
    ];

    if (testFiles.length > 0) {
      testFiles.forEach(file => {
        curlLines.push(`  -F "files[]=@${file.name}" \\`);
      });
    }

    if (endpoint.discriminatorName && endpoint.discriminatorValue && endpoint.discriminatorValue !== '_default') {
      curlLines.push(`  -F "${endpoint.discriminatorName}=${endpoint.discriminatorValue}" \\`);
    }

    Object.entries(testParams).forEach(([key, val]) => {
      if (val !== '' && val !== undefined && val !== null) {
        // Only include those testParams that aren't locked, because locked params are injected by server.
        // Wait, for testing, should they be in the curl? If the payload mimics the client, the client shouldn't send locked ones.
        const paramConfig = paramsObj[key];
        const isLocked = paramConfig?.isLocked ?? (endpoint.parametersSchema as any)?.[key]?.defaultLocked ?? false;
        if (!isLocked) {
          curlLines.push(`  -F "${key}=${val}" \\`);
        }
      }
    });

    const lastLine = curlLines[curlLines.length - 1];
    if (lastLine && lastLine.endsWith(' \\')) {
      curlLines[curlLines.length - 1] = lastLine.slice(0, -2);
    }
    return curlLines.join('\n');
  };

  // handleTabSwitch removed — replaced by unified key-value editor

  const handleToggle = async (checked: boolean) => {
    setIsActive(checked);
    await saveSettings(checked);
    if (checked) setIsEditing(true);
  };

  const saveSettings = async (enabledState: boolean = isActive) => {
    setSaving(true);
    try {
      const finalParamsObj = Object.keys(paramsObj).length ? paramsObj : null;

      // Save Profile Endpoint params (including connectionsOverride)
      const endpointPromise = fetch('/api/internal/profile-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKeyId,
          endpointSlug: endpoint.slug,
          enabled: enabledState,
          parameters: finalParamsObj,
          connectionsOverride: connectionsOverride && connectionsOverride.length > 0 ? connectionsOverride : null,
          jobPriority,
          fileUrlAuthConfig: fileUrlAuthConfig.type !== 'none' ? fileUrlAuthConfig : null,
          allowedFileExtensions: allowedFileExtensions.trim() ? allowedFileExtensions.trim() : null,
        }),
      });

      // Save all processor overrides (scoped per endpoint + stepId)
      // Build override list from current pipeline steps (connectionsOverride or defaults)
      const currentSteps = connectionsOverride
        ?? (endpoint.connections || []).map((s: string) => ({ slug: s }));
       const overridePromises = currentSteps.map((step: ConnStep) => {
        const cData = allConnectors.find((c: any) => c.slug === step.slug);
        if (!cData) return null;
        const overrideKey = step.stepId ?? cData.id;
        const val = extOverridesState[overrideKey];
        const hasOverride = val !== null && val !== undefined;
        return fetch('/api/internal/ext-overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId: cData.id,
            apiKeyId,
            endpointSlug: endpoint.slug,
            stepId: step.stepId ?? '_default',
            isActive: hasOverride,
            promptOverride: hasOverride ? val : null,
          }),
        });
      }).filter((p: Promise<Response> | null): p is Promise<Response> => p !== null);
      const responses = await Promise.all([endpointPromise, ...overridePromises]);

      for (const res of responses) {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
      }

      // Update local state without closing editor if manually saved
      setParamsObj(finalParamsObj || {});
      onUpdated();
    } catch (err: any) {
      toast.error(`Lỗi khi lưu thiết lập: ${err.message}`);
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

      // Append test params (non-empty values only)
      Object.entries(testParams).forEach(([key, val]) => {
        if (val !== '' && val !== undefined && val !== null) {
          fd.append(key, String(val));
        }
      });

      const res = await fetch('/api/internal/test-profile-endpoint', {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      setTestResult({ status: res.status, data });
    } catch (e: any) {
      setTestResult({ status: 500, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  // Render a dynamic input based on schema
  const renderSchemaInput = (
    key: string,
    schema: any,
    val: any,
    isLocked: boolean,
    onToggleLock: (locked: boolean) => void,
    onChange: (v: any) => void,
    onDelete: () => void
  ) => {
    return (
      <div key={key} className={`flex flex-col mb-4 bg-background p-3 rounded-lg border shadow-sm transition-colors ${isLocked ? 'border-amber-500/50 bg-amber-500/5' : 'border-border'}`}>
        <label className="text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">{key}</span>
            <button
              onClick={() => onToggleLock(!isLocked)}
              title={isLocked ? "Hủy khóa tham số này" : "Khóa cứng tham số (Client không đè được)"}
              className={`px-1.5 py-0.5 font-bold rounded text-[10px] uppercase transition-colors hover:bg-muted border ${isLocked ? 'text-amber-600 border-amber-500/30 bg-amber-50 dark:bg-amber-950/30' : 'text-indigo-600 border-indigo-500/30 bg-indigo-50 dark:bg-indigo-950/30'}`}
            >
              {isLocked ? '🔒 KHÓA (CHỈ GHI LÊN)' : '✏️ CHO PHÉP CLIENT GHI ĐÈ'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase text-muted-foreground">{schema.type}</span>
            <button
              onClick={onDelete}
              className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 rounded shrink-0 transition-colors"
              title="Xóa tham số này"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </label>
        <p className="text-xs text-muted-foreground mt-1 mb-2 leading-relaxed">{schema.description}</p>

        {schema.options ? (
          <select
            value={val || ''}
            onChange={e => onChange(e.target.value)}
            className="input-field text-sm font-mono py-1.5"
          >
            <option value="">-- Không đè (Để trống) --</option>
            {schema.options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        ) : schema.type === 'number' ? (
          <input
            type="number"
            value={val || ''}
            onChange={e => onChange(Number(e.target.value))}
            className="input-field py-1.5 text-sm font-mono"
            placeholder={schema.default ? `Mặc định: ${schema.default}` : 'Nhập số...'}
          />
        ) : schema.type === 'boolean' ? (
          <label className="flex items-center gap-2 text-sm mt-1 cursor-pointer">
            <input type="checkbox" checked={val || false} onChange={e => onChange(e.target.checked)} className="w-4 h-4 rounded border-border" />
            <span>Bật / Tắt</span>
          </label>
        ) : (
          <input
            type="text"
            value={val || ''}
            onChange={e => onChange(e.target.value)}
            className="input-field py-1.5 text-sm font-mono"
            placeholder={schema.default ? `Mặc định: ${schema.default}` : 'Nhập giá trị...'}
          />
        )}
      </div>
    );
  };

  return (
    <div className={`modern-card flex flex-col border transition-colors relative ${showTestModal ? 'z-[100]' : isEditing ? 'z-50' : 'z-10'} ${isActive
      ? 'bg-indigo-50/10 dark:bg-indigo-950/10 border-indigo-200 dark:border-indigo-900/50 ring-1 ring-indigo-500/20 shadow-md'
      : 'border-border opacity-70'
      }`}>
      <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex-1 cursor-pointer" onClick={() => setIsEditing(!isEditing)}>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className={`text-base font-bold select-none ${isActive ? 'text-indigo-700 dark:text-indigo-400' : 'text-foreground'}`}>
              {endpoint.displayName}
            </h3>
            <span className="text-[11px] font-mono select-none bg-muted text-muted-foreground px-2 py-0.5 rounded-md border border-border">
              {endpoint.route}
            </span>
          </div>
          <p className="text-sm text-muted-foreground leading-snug select-none">
            {endpoint.description} <br />
            (Subcase: <strong>{endpoint.discriminatorValue || '_default'}</strong>)
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
                // Include newly added custom params
                Object.keys(paramsObj).forEach(k => {
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

          {isAdmin && (
            <label className="flex items-center cursor-pointer relative group">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={isActive}
                disabled={!isAdmin}
                onChange={e => handleToggle(e.target.checked)}
              />
              <div className={`
                h-6 w-11 rounded-full ring-0 transition-all duration-300 ease-in-out
                ${isActive ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700'}
                after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                after:h-5 after:w-5 after:bg-white after:rounded-full after:transition-all after:shadow-sm
                peer-checked:after:translate-x-full
              `} />
            </label>
          )}

          {(isActive || isEditing) && (
            <button
              onClick={() => setIsEditing(!isEditing)}
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
                            {key} {isLocked && <span title="Bị khóa trên server" className="text-[10px] bg-amber-100 text-amber-700 px-1 py-0 rounded">🔒</span>}
                          </label>
                          {hasOptions ? (
                            <select
                              value={testParams[key] ?? ''}
                              onChange={e => setTestParams({ ...testParams, [key]: e.target.value })}
                              className="input-field text-xs py-1.5"
                            >
                              <option value="">-- Trống --</option>
                              {schema.options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={testParams[key] ?? ''}
                              onChange={e => setTestParams({ ...testParams, [key]: e.target.value })}
                              placeholder={schema?.default ? `Mặc định: ${schema.default}` : 'Trống'}
                              className="input-field text-xs py-1.5"
                            />
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
                    accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"
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
                <div className={`rounded-xl border text-sm space-y-4 overflow-hidden ${testResult.status === 200
                  ? 'border-green-300 dark:border-green-800'
                  : 'border-red-300 dark:border-red-800'
                  }`}>
                  {/* Status Bar */}
                  <div className={`px-4 py-3 flex items-center gap-2 font-semibold ${testResult.status === 200
                    ? 'bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300'
                    : 'bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300'
                    }`}>
                    {testResult.status === 200
                      ? <><CheckCircle className="w-4 h-4" /> Thành công (HTTP 200)</>
                      : <><XCircle className="w-4 h-4" /> Thất bại (HTTP {testResult.status})</>}
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

      {(isActive || isEditing) && isEditing && (
        <div className="px-4 pb-4 border-t border-border bg-card/50 rounded-b-xl animate-in fade-in fill-mode-forwards">
          <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-6">

            {/* PRIORITY SELECTOR */}
            {isAdmin && (
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

            {/* FILE URL AUTH CONFIG SECTION */}
            {isAdmin && (
              <div className="sm:col-span-2">
                <div
                  className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2 cursor-pointer hover:bg-muted/50 w-fit p-1.5 -ml-1.5 rounded transition-colors select-none"
                  onClick={() => setIsFileUrlAuthOpen(!isFileUrlAuthOpen)}
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${isFileUrlAuthOpen ? '' : '-rotate-90'}`} />
                  <span>🔗</span> File URL Authentication
                  {fileUrlAuthConfig.type !== 'none' && (
                    <span className="ml-1 px-1.5 py-0.5 text-xs font-medium bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 rounded-full">
                      {fileUrlAuthConfig.type}
                    </span>
                  )}
                </div>

                {isFileUrlAuthOpen && (
                  <div className="animate-in fade-in border border-border rounded-xl p-4 bg-muted/20 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Cấu hình xác thực khi hệ thống download file từ <code className="bg-muted px-1 rounded">file_urls</code>.
                      Áp dụng cho tất cả URL trong cùng request đến endpoint này.
                    </p>

                    {/* Auth type selector */}
                    <div className="flex flex-wrap gap-1.5">
                      {(['none', 'bearer', 'header', 'query'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setFileUrlAuthConfig({ ...fileUrlAuthConfig, type: t })}
                          className={`px-3 py-1 text-xs font-medium rounded-lg border transition-all ${
                            fileUrlAuthConfig.type === t
                              ? 'bg-teal-500 text-white border-teal-500 shadow-sm'
                              : 'bg-background text-muted-foreground border-border hover:border-teal-400 hover:text-foreground'
                          }`}
                        >
                          {t === 'none' ? 'Không có' : t === 'bearer' ? 'Bearer Token' : t === 'header' ? 'Custom Header' : 'Query Param'}
                        </button>
                      ))}
                    </div>

                    {/* Bearer token */}
                    {fileUrlAuthConfig.type === 'bearer' && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Token</label>
                        <input
                          type="password"
                          placeholder="Bearer token value"
                          value={fileUrlAuthConfig.token ?? ''}
                          onChange={(e) => setFileUrlAuthConfig({ ...fileUrlAuthConfig, token: e.target.value })}
                          className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400"
                        />
                      </div>
                    )}

                    {/* Custom header */}
                    {fileUrlAuthConfig.type === 'header' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Header Name</label>
                          <input
                            type="text"
                            placeholder="X-API-Key"
                            value={fileUrlAuthConfig.header_name ?? ''}
                            onChange={(e) => setFileUrlAuthConfig({ ...fileUrlAuthConfig, header_name: e.target.value })}
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Header Value</label>
                          <input
                            type="password"
                            placeholder="header value"
                            value={fileUrlAuthConfig.header_value ?? ''}
                            onChange={(e) => setFileUrlAuthConfig({ ...fileUrlAuthConfig, header_value: e.target.value })}
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400"
                          />
                        </div>
                      </div>
                    )}

                    {/* Query param */}
                    {fileUrlAuthConfig.type === 'query' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Query Key</label>
                          <input
                            type="text"
                            placeholder="token"
                            value={fileUrlAuthConfig.query_key ?? ''}
                            onChange={(e) => setFileUrlAuthConfig({ ...fileUrlAuthConfig, query_key: e.target.value })}
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Query Value</label>
                          <input
                            type="password"
                            placeholder="query param value"
                            value={fileUrlAuthConfig.query_value ?? ''}
                            onChange={(e) => setFileUrlAuthConfig({ ...fileUrlAuthConfig, query_value: e.target.value })}
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* ALLOWED FILE EXTENSIONS SECTION */}
            {isAdmin && (
              <div className="sm:col-span-2">
                <label className="flex flex-col">
                  <span className="text-sm font-semibold text-foreground mb-1">Allowed File Extensions</span>
                  <span className="text-xs text-muted-foreground mb-2">Định dạng file được phép tải lên. Phân cách bằng dấu phẩy (vd: <code className="bg-muted px-1 rounded">.pdf, .docx, .jpg</code>). Để trống thì dùng mặc định.</span>
                  <input
                    type="text"
                    placeholder=".pdf, .docx"
                    value={allowedFileExtensions}
                    onChange={(e) => setAllowedFileExtensions(e.target.value)}
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
                  <pre className="p-4 text-xs font-mono bg-white dark:bg-[#0d1117] text-slate-800 dark:text-slate-200 overflow-x-auto m-0 leading-relaxed">
                    {String(generateCurl())}
                  </pre>
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
                    <button onClick={() => setShowRaw(!showRaw)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted transition-colors">
                      <Code className="w-3 h-3" /> {showRaw ? 'Form' : 'Raw JSON'}
                    </button>
                  </div>
                  {showRaw ? (
                    <textarea
                      value={Object.keys(paramsObj).length ? JSON.stringify(paramsObj, null, 2) : ''}
                      onChange={e => { try { setParamsObj(e.target.value.trim() ? JSON.parse(e.target.value) : {}); } catch { } }}
                      className="w-full bg-background border border-border rounded-lg p-3 font-mono text-xs leading-relaxed min-h-[140px] focus:ring-2 focus:ring-indigo-500/30"
                      placeholder={'{\n  "output_format": { "value": "json", "isLocked": false }\n}'}
                    />
                  ) : (
                    <div className="space-y-2">
                      {Object.keys(paramsObj).map(key => {
                        const schema = (endpoint.parametersSchema as any)?.[key];
                        const paramConfig = paramsObj[key];
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
                          <div key={key} className={`flex items-center gap-2 bg-background p-2.5 rounded-lg border border-dashed transition-colors ${paramConfig.isLocked ? 'border-amber-300' : 'border-indigo-200 dark:border-indigo-900/40'}`}>
                            <span className="font-mono text-[11px] bg-muted text-foreground px-1.5 py-0.5 rounded shrink-0">{key}</span>
                            <button
                              onClick={() => setParamsObj(prev => ({ ...prev, [key]: { ...prev[key], isLocked: !prev[key].isLocked } }))}
                              className={`px-1.5 py-0.5 font-bold rounded text-[10px] uppercase transition-colors shrink-0 ${paramConfig.isLocked ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/30' : 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30'}`}
                            >
                              {paramConfig.isLocked ? '🔒 KHÓA' : '✏️ MỞ'}
                            </button>
                            <input type="text" value={String(paramConfig.value ?? '')} onChange={e => setParamsObj(prev => ({ ...prev, [key]: { ...prev[key], value: e.target.value } }))} className="input-field py-1 text-xs font-mono flex-1 min-w-0" />
                            <button onClick={() => setParamsObj(prev => { const n = { ...prev }; delete n[key]; return n; })} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 rounded shrink-0"><X className="w-3.5 h-3.5" /></button>
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
                      // Use stepId as override key (supports multiple steps with same connector)
                      const overrideKey = step.stepId ?? connId;
                      const overrideValue = extOverridesState[overrideKey];
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
                                      [overrideKey]: isOverridden ? null : (cData.defaultPrompt || null)
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

                              {/* Prompt override */}
                              {isOverridden ? (
                                <div className="space-y-2 animate-in fade-in zoom-in-95 duration-200">
                                  <label className="text-xs font-bold flex items-center gap-1 text-violet-600 dark:text-violet-400">
                                    Prompt Override Content <span className="font-normal text-muted-foreground mr-1">— Mapping output:</span> <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">{`{{input_content}}`}</code>
                                  </label>
                                  <textarea
                                    value={overrideValue ?? ''}
                                    onChange={(e) => setExtOverridesState(prev => ({ ...prev, [overrideKey]: e.target.value }))}
                                    className="w-full text-sm font-mono p-3 rounded-lg border border-violet-200 dark:border-violet-900 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 bg-violet-50/10 dark:bg-violet-950/20 outline-none leading-relaxed shadow-inner min-h-[140px]"
                                    placeholder="Nhập prompt override cho bước này (sử dụng biến {{input_content}} để ghép với dữ liệu đầu ra từ bước trước)..."
                                  />
                                  <div className="bg-muted p-3 mt-3 rounded-lg border border-border">
                                    <details>
                                      <summary className="text-xs font-semibold text-muted-foreground cursor-pointer outline-none w-fit hover:underline">Xem Default Prompt gốc (Tham khảo)</summary>
                                      <pre className="mt-3 text-[10px] text-muted-foreground whitespace-pre-wrap font-mono p-3 bg-background border border-border rounded opacity-70">
                                        {cData.defaultPrompt}
                                      </pre>
                                    </details>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-muted-foreground">Default Prompt (Quy định tại System)</label>
                                  <pre className="text-xs text-muted-foreground font-mono bg-muted/30 p-3 rounded-lg border whitespace-pre-wrap overflow-x-auto max-h-[150px] overflow-y-auto outline-none cursor-text">
                                    {cData.defaultPrompt}
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

            {/* WORKFLOW PROMPT MANAGEMENT — shown only for workflow endpoints */}
            {endpoint.isWorkflow && (
              <WorkflowPromptPanel endpoint={endpoint} paramsObj={paramsObj} setParamsObj={setParamsObj} />
            )}

            <div className="sm:col-span-2 flex justify-end gap-3 pt-6 pb-2 border-t border-border/50 bg-card/50 sticky bottom-0 z-10">
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 bg-background border border-border hover:bg-muted text-sm font-semibold rounded-lg transition-colors shadow-sm"
              >
                Đóng
              </button>
              <button
                onClick={() => saveSettings()}
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 shadow-sm transition-transform active:scale-95"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Lưu Toàn bộ Thiết lập
              </button>
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

function WorkflowPromptPanel({ 
  endpoint,
  paramsObj,
  setParamsObj
}: { 
  endpoint: any;
  paramsObj: Record<string, { value: any, isLocked: boolean }>;
  setParamsObj: React.Dispatch<React.SetStateAction<Record<string, { value: any, isLocked: boolean }>>>;
}) {
  const [isOpen, setIsOpen] = useState(false);

  // Initialize from paramsObj
  const initialOverrides = useMemo(() => {
    const saved = paramsObj['_workflowPrompts']?.value || {};
    const state: Record<string, { enabled: boolean; prompt: string }> = {};
    for (const [key, val] of Object.entries(saved)) {
      if (typeof val === 'string' && val.trim() !== '') {
        state[key] = { enabled: true, prompt: val };
      }
    }
    return state;
  }, []);

  const [overrides, setOverrides] = useState<Record<string, { enabled: boolean; prompt: string }>>(initialOverrides);

  // Sync to parent paramsObj whenever local overrides change
  useEffect(() => {
    const activePrompts: Record<string, string> = {};
    let hasActive = false;
    for (const [key, ov] of Object.entries(overrides)) {
      if (ov.enabled && ov.prompt.trim()) {
        activePrompts[key] = ov.prompt.trim();
        hasActive = true;
      }
    }

    setParamsObj(prev => {
      const prevPromptsStr = JSON.stringify(prev['_workflowPrompts']?.value || {});
      const newPromptsStr = JSON.stringify(activePrompts);
      if (prevPromptsStr === newPromptsStr) return prev; // No actual change

      const nextParams = { ...prev };
      if (hasActive) {
        nextParams['_workflowPrompts'] = { value: activePrompts, isLocked: false };
      } else {
        delete nextParams['_workflowPrompts'];
      }
      return nextParams;
    });
  }, [overrides, setParamsObj]);

  const toggleOverride = (stepKey: string) => {
    setOverrides(prev => ({
      ...prev,
      [stepKey]: prev[stepKey]?.enabled
        ? { enabled: false, prompt: prev[stepKey]?.prompt || '' }
        : { enabled: true, prompt: prev[stepKey]?.prompt || '' },
    }));
  };

  const updatePrompt = (stepKey: string, value: string) => {
    setOverrides(prev => ({
      ...prev,
      [stepKey]: { ...prev[stepKey], enabled: true, prompt: value },
    }));
  };

  const activeOverrides = Object.entries(overrides).filter(([, v]) => v.enabled).length;
  const steps = DISBURSEMENT_STEPS;

  return (
    <div className="sm:col-span-2 mt-4 pt-4 border-t border-border/50">
      <div
        className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400 mb-4 cursor-pointer hover:bg-purple-50/50 dark:hover:bg-purple-950/30 w-fit p-1.5 -ml-1.5 rounded transition-colors select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
        <Code className="w-4 h-4" />
        Workflow Prompts ({steps.length} Bước DAG)
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
              <strong className="text-purple-900 dark:text-purple-100">Workflow Orchestration:</strong>{' '}
              Prompt mặc định được định nghĩa trong code TypeScript. Bạn có thể <strong>override từng bước</strong> tại đây.
              Khi override, prompt sẽ được dùng thay cho code mặc định. Tắt override → quay về prompt gốc trong code.
            </div>
          </div>

          {/* Steps */}
          {steps.map((step, idx) => {
            const override = overrides[step.key];
            const isOverridden = override?.enabled === true;

            return (
              <div key={step.key} className="relative">
                {idx > 0 && (
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
                          {isOverridden && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 px-2 py-0.5 rounded-sm">
                              Override Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => toggleOverride(step.key)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shrink-0 border ${
                        isOverridden
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/70 border-amber-200 dark:border-amber-800'
                          : 'bg-background text-foreground hover:bg-purple-50 dark:hover:bg-purple-950/30 border-border hover:border-purple-300 dark:hover:border-purple-700'
                      }`}
                    >
                      {isOverridden ? '✕ Tắt Override' : '✏️ Override Prompt'}
                    </button>
                  </div>

                  {/* Content */}
                  <div className="p-4 space-y-3">
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
