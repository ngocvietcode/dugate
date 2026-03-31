'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Loader2, CheckCircle, Plus, Copy,
  Settings, Save, Key, ChevronRight, ChevronDown, FileText, PlugZap
} from 'lucide-react';

interface ApiKey {
  id: string;
  name: string;
  status: string;
  keyHash?: string;
}

export default function OverridesPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-muted-foreground flex justify-center items-center"><Loader2 className="w-6 h-6 animate-spin mr-2"/> Đang tải cấu hình Admin...</div>}>
      <OverridesContent />
    </Suspense>
  );
}

function OverridesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  
  // Data State
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  
  // Selection State
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [profileEndpoints, setProfileEndpoints] = useState<any[]>([]);
  
  // New Client Modal/State
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [createdRawKey, setCreatedRawKey] = useState<{ name: string; key: string } | null>(null);

  // Fetch initial data
  const fetchData = async () => {
    try {
      const overridesRes = await fetch('/api/internal/overrides');
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
        setSelectedClientId(data.apiKey.id);
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert('Error creating API Key');
    }
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
              <button 
                onClick={() => setShowAddClient(!showAddClient)}
                className="p-1.5 hover:bg-primary/10 text-primary rounded-md transition-colors shadow-sm bg-background border border-border"
                title="Thêm Client Mới"
              >
                <Plus className="w-4 h-4" />
              </button>
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
                        router.replace(`/overrides?client=${key.id}`, { scroll: false });
                        setCreatedRawKey(null); // Clear new key alert if they switch
                      }}
                      className={`w-full text-left px-3 py-3 rounded-lg flex items-center justify-between transition-all ${
                        isSelected 
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
                        alert('Đã copy!');
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
          {selectedClientId && apiKeys.length > 0 && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">Endpoints Hierarchy</h2>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {profileEndpoints.map(ep => (
                  <ProfileEndpointCard
                    key={ep.slug}
                    endpoint={ep}
                    apiKeyId={selectedClientId}
                    onUpdated={() => fetchProfileEndpoints(selectedClientId)}
                  />
                ))}
              </div>
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
    </main>
  );
}

// ─── ProfileEndpointCard ───────────────────────────────────────────────────────

function ProfileEndpointCard({
  endpoint,
  apiKeyId,
  onUpdated,
}: {
  endpoint: any;
  apiKeyId: string;
  onUpdated: () => void;
}) {
  const [isActive, setIsActive] = useState(endpoint.enabled);
  const [isEditing, setIsEditing] = useState(false);
  const [defaultParamsStr, setDefaultParamsStr] = useState(
    endpoint.defaultParams ? JSON.stringify(endpoint.defaultParams, null, 2) : ''
  );
  const [profileParamsStr, setProfileParamsStr] = useState(
    endpoint.profileParams ? JSON.stringify(endpoint.profileParams, null, 2) : ''
  );
  
  // Trạng thái giữ override của từng processor trong chuỗi pipeline
  const [extOverridesState, setExtOverridesState] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setIsActive(endpoint.enabled);
    setDefaultParamsStr(endpoint.defaultParams ? JSON.stringify(endpoint.defaultParams, null, 2) : '');
    setProfileParamsStr(endpoint.profileParams ? JSON.stringify(endpoint.profileParams, null, 2) : '');
    setIsEditing(false);

    // Load initial overrides for processors
    const initialOverrides: Record<string, string | null> = {};
    endpoint.extConnections?.forEach((conn: any) => {
      initialOverrides[conn.connectionId] = conn.promptOverride ?? null;
    });
    setExtOverridesState(initialOverrides);
  }, [endpoint, apiKeyId]);

  const handleToggle = async (checked: boolean) => {
    setIsActive(checked);
    await saveSettings(checked, defaultParamsStr, profileParamsStr, extOverridesState);
    if (checked) setIsEditing(true);
  };

  const saveSettings = async (
    enabledState: boolean, 
    dParams: string, 
    pParams: string, 
    overridesState: Record<string, string | null>
  ) => {
    setSaving(true);
    try {
      let defaultObj = null;
      if (dParams.trim()) defaultObj = JSON.parse(dParams);
      let profileObj = null;
      if (pParams.trim()) profileObj = JSON.parse(pParams);

      // Save Profile Endpoint params
      const endpointPromise = fetch('/api/internal/profile-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKeyId,
          endpointSlug: endpoint.slug,
          enabled: enabledState,
          defaultParams: defaultObj,
          profileParams: profileObj,
        }),
      });

      // Save all processor overrides
      const overridePromises = endpoint.extConnections?.map((conn: any) => {
        const val = overridesState[conn.connectionId];
        const hasOverride = val !== null;
        return fetch('/api/internal/ext-overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId: conn.connectionId,
            apiKeyId,
            isActive: hasOverride,
            promptOverride: hasOverride ? val : null,
          }),
        });
      }) || [];

      await Promise.all([endpointPromise, ...overridePromises]);
      onUpdated();
      setIsEditing(false); // Close the inline editor
    } catch {
      alert('Lỗi khi lưu thiết lập, vui lòng kiểm tra định dạng JSON.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`modern-card flex flex-col border transition-colors ${
      isActive
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
            {endpoint.description} <br/>
            (Mode: <strong>{endpoint.inputMode}</strong>, Client Params: {endpoint.clientParams?.join(', ') || 'None'})
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 mt-2 sm:mt-0">
          <label className="flex items-center cursor-pointer relative group">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={isActive}
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

          {(isActive || isEditing) && (
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`p-1.5 rounded-lg transition-colors border ${
                isEditing
                  ? 'bg-indigo-50 dark:bg-indigo-950 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400'
                  : 'bg-transparent border-transparent text-slate-400 hover:text-foreground hover:bg-muted'
              }`}
            >
              <ChevronDown className={`w-5 h-5 transition-transform ${isEditing ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {(isActive || isEditing) && isEditing && (
        <div className="px-4 pb-4 border-t border-border bg-card/50 rounded-b-xl animate-in fade-in fill-mode-forwards">
          <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* CORE SETTINGS */}
            <div className="sm:col-span-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
               ▼ Core Settings
            </div>
            
            <div>
               <label className="text-sm font-bold text-foreground flex items-center gap-2 mb-2">
                 <FileText className="w-4 h-4 text-indigo-500" /> Default Params (JSON)
               </label>
               <textarea
                 value={defaultParamsStr}
                 onChange={e => setDefaultParamsStr(e.target.value)}
                 className="w-full bg-background border border-border rounded-lg p-3 font-mono text-xs sm:text-sm leading-relaxed min-h-[120px] focus:ring-2 focus:ring-indigo-500/30"
                 placeholder={'{\\n  "max_words": 500\\n}'}
               />
               <p className="text-xs text-muted-foreground mt-1">Giá trị mặc định nếu client gửi trống.</p>
            </div>
            <div>
               <label className="text-sm font-bold text-foreground flex items-center gap-2 mb-2">
                 <Settings className="w-4 h-4 text-amber-500" /> Profile Params (JSON)
               </label>
               <textarea
                 value={profileParamsStr}
                 onChange={e => setProfileParamsStr(e.target.value)}
                 className="w-full bg-background border border-border rounded-lg p-3 font-mono text-xs sm:text-sm leading-relaxed min-h-[120px] focus:ring-2 focus:ring-amber-500/30"
                 placeholder={'{\\n  "business_rules": "1. Rule A..."\\n}'}
               />
               <p className="text-xs text-muted-foreground mt-1">Khóa cứng các field của Profile: {endpoint.profileOnlyParams?.join(', ') || 'N/A'}</p>
            </div>

            {/* PIPELINE PROCESSORS */}
            <div className="sm:col-span-2 mt-4 pt-4 border-t border-border/50">
               <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                  ▼ Pipeline Processors ({endpoint.extConnections?.length || 0} Bước)
               </div>
               
               <div className="space-y-4">
                 {endpoint.extConnections?.map((conn: any, idx: number) => {
                   const overrideValue = extOverridesState[conn.connectionId];
                   const isOverridden = overrideValue !== null && overrideValue !== undefined;
                   
                   return (
                     <div key={conn.connectionId} className="flex flex-col">
                       {/* Arrow pointing down between steps */}
                       {idx > 0 && (
                          <div className="flex justify-center -mt-2 mb-2">
                             <div className="w-px h-6 bg-border"></div>
                          </div>
                       )}
                       
                       <div className="bg-background rounded-xl border border-border shadow-sm overflow-hidden">
                         <div className="bg-muted/50 px-4 py-3 border-b border-border flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                           <div className="flex items-center gap-2 text-sm font-medium flex-wrap">
                             <span className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold shrink-0">
                               {idx + 1}
                             </span>
                             <PlugZap className="w-4 h-4 text-violet-500 shrink-0" />
                             <span className="font-bold">{conn.name}</span>
                             <span className="text-[10px] bg-background border px-1.5 py-0.5 rounded text-muted-foreground">{conn.slug}</span>
                             {isOverridden && (
                                <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-100 text-violet-700 px-2 py-0.5 rounded-sm ml-2">
                                  Custom Active
                                </span>
                             )}
                           </div>
                           
                           <button 
                              onClick={() => {
                                setExtOverridesState(prev => ({
                                  ...prev,
                                  [conn.connectionId]: isOverridden ? null : conn.defaultPrompt
                                }));
                              }}
                              className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors shrink-0 ${
                                isOverridden 
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/70' 
                                  : 'bg-background border border-border text-foreground hover:bg-muted font-medium'
                              }`}
                           >
                              {isOverridden ? 'Khôi phục Default Prompt' : 'Tùy chỉnh Prompt'}
                           </button>
                         </div>
                         
                         <div className="p-4">
                           {isOverridden ? (
                             <div className="space-y-2 animate-in fade-in zoom-in-95 duration-200">
                               <label className="text-xs font-bold flex items-center gap-1 text-violet-600 dark:text-violet-400">
                                 Prompt Override
                               </label>
                               <textarea
                                 value={overrideValue ?? ''}
                                 onChange={(e) => setExtOverridesState(prev => ({ ...prev, [conn.connectionId]: e.target.value }))}
                                 className="w-full text-sm font-mono p-3 rounded-lg border border-violet-200 dark:border-violet-900 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 bg-violet-50/10 dark:bg-violet-950/20 outline-none leading-relaxed shadow-inner min-h-[140px]"
                                 placeholder="Nhập prompt override cho bước này..."
                               />
                             </div>
                           ) : (
                             <div className="space-y-2">
                               <label className="text-xs font-medium text-muted-foreground">Default Prompt (Quy định tại Connection)</label>
                               <pre className="text-xs text-muted-foreground font-mono bg-muted/30 p-3 rounded-lg border whitespace-pre-wrap overflow-x-auto max-h-[150px] overflow-y-auto">
                                 {conn.defaultPrompt}
                               </pre>
                             </div>
                           )}
                         </div>
                       </div>
                     </div>
                   );
                 })}
                 {(!endpoint.extConnections || endpoint.extConnections.length === 0) && (
                   <p className="text-sm text-muted-foreground p-6 text-center border rounded-xl bg-background border-dashed">
                     Endpoint này xử lý Local hoặc qua các Local Processors nội bộ, không có External API Pipeline nào.
                   </p>
                 )}
               </div>
            </div>

            <div className="sm:col-span-2 flex justify-end gap-3 pt-6 pb-2 border-t border-border/50 bg-card/50 sticky bottom-0 z-10">
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 bg-background border border-border hover:bg-muted text-sm font-semibold rounded-lg transition-colors shadow-sm"
              >
                Đóng
              </button>
              <button
                onClick={() => saveSettings(isActive, defaultParamsStr, profileParamsStr, extOverridesState)}
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
