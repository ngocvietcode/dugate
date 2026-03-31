const fs = require('fs');

let content = fs.readFileSync('app/overrides/page.tsx', 'utf8');

// 1. Add states
content = content.replace(
  "const [selectedClientId, setSelectedClientId] = useState<string>('');",
  "const [selectedClientId, setSelectedClientId] = useState<string>('');\n  const [activeTab, setActiveTab] = useState<'endpoints' | 'connections'>('endpoints');\n  const [profileEndpoints, setProfileEndpoints] = useState<any[]>([]);"
);

// 2. Add fetch profile endpoints
content = content.replace(
  "  // Filter overrides for current client\n  const clientOverrides = useMemo(() => {\n    return overrides.filter(o => o.apiKeyId === selectedClientId);\n  }, [overrides, selectedClientId]);",
  `  const fetchProfileEndpoints = async (clientId) => {
    try {
      const res = await fetch(\`/api/internal/profile-endpoints?apiKeyId=\${clientId}\`);
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

  // Filter overrides for current client
  const clientOverrides = useMemo(() => {
    return overrides.filter(o => o.apiKeyId === selectedClientId);
  }, [overrides, selectedClientId]);`
);

// 3. Replace Processors List with Tabs
const startMarker = "{/* Processors List */}";
const endMarker = "{!selectedClientId && apiKeys.length > 0 && (";
const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
  const newContent = `          {/* Main Workspace (Tabs) */}
          {selectedClientId && apiKeys.length > 0 && (
            <div className="space-y-6">
              
              {/* Tab Header */}
              <div className="flex border-b border-border gap-6 text-sm font-medium">
                <button
                  onClick={() => setActiveTab('endpoints')}
                  className={\`pb-3 transition-colors relative \${activeTab === 'endpoints' ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground hover:text-foreground'}\`}
                >
                  <span className="flex items-center gap-2"><MonitorPlay className="w-4 h-4" /> Endpoints (Core)</span>
                  {activeTab === 'endpoints' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400 rounded-t-full" />}
                </button>
                <button
                  onClick={() => setActiveTab('connections')}
                  className={\`pb-3 transition-colors relative \${activeTab === 'connections' ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground hover:text-foreground'}\`}
                >
                  <span className="flex items-center gap-2"><PlugZap className="w-4 h-4" /> API Connections</span>
                  {activeTab === 'connections' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-600 dark:bg-violet-400 rounded-t-full" />}
                </button>
              </div>

              {/* Tab Content: Endpoints */}
              {activeTab === 'endpoints' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <p className="text-sm text-muted-foreground mb-4">
                    Tùy chỉnh cấu hình API cho từng endpoint (Bật/Tắt, Default Params, Profile/Business Rules).
                  </p>
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

              {/* Tab Content: Connections */}
              {activeTab === 'connections' && extConnections.length > 0 && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <p className="text-sm text-muted-foreground mb-4">
                    Ghi đè System Prompt cho các External AI Service.
                  </p>
                  <div className="grid grid-cols-1 gap-4">
                    {extConnections.map(conn => {
                      const currentOverride = clientExtOverrides.find(o => o.connectionId === conn.id);
                      return (
                        <ExtConnectionCard
                          key={conn.id}
                          connection={conn}
                          apiKeyId={selectedClientId}
                          initialOverride={currentOverride}
                          onUpdated={() => fetchData()}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          
          `;
  content = content.substring(0, startIndex) + newContent + content.substring(endIndex);
}

// 4. Append ProfileEndpointCard
// NOTE: Using {'...'} for JSX string attributes containing newlines
const profileEndpointComponent = `

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setIsActive(endpoint.enabled);
    setDefaultParamsStr(endpoint.defaultParams ? JSON.stringify(endpoint.defaultParams, null, 2) : '');
    setProfileParamsStr(endpoint.profileParams ? JSON.stringify(endpoint.profileParams, null, 2) : '');
    setIsEditing(false);
  }, [endpoint, apiKeyId]);

  const handleToggle = async (checked: boolean) => {
    setIsActive(checked);
    await saveSettings(checked, defaultParamsStr, profileParamsStr);
    if (checked) setIsEditing(true);
  };

  const saveSettings = async (enabledState: boolean, dParams: string, pParams: string) => {
    setSaving(true);
    try {
      let defaultObj = null;
      if (dParams.trim()) defaultObj = JSON.parse(dParams);
      let profileObj = null;
      if (pParams.trim()) profileObj = JSON.parse(pParams);

      await fetch('/api/internal/profile-endpoints', {
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
      onUpdated();
    } catch {
      alert('Lỗi JSON. Vui lòng kiểm tra lại định dạng JSON.');
    } finally {
      setSaving(false);
      setIsEditing(false);
    }
  };

  return (
    <div className={\`modern-card flex flex-col border transition-colors \${
      isActive
        ? 'bg-indigo-50/10 dark:bg-indigo-950/10 border-indigo-200 dark:border-indigo-900/50 ring-1 ring-indigo-500/20 shadow-md'
        : 'border-border opacity-60'
    }\`}>
      <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className={\`text-base font-bold \${isActive ? 'text-indigo-700 dark:text-indigo-400' : 'text-foreground'}\`}>
              {endpoint.displayName}
            </h3>
            <span className="text-[11px] font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded-md border border-border">
              {endpoint.route}
            </span>
          </div>
          <p className="text-sm text-muted-foreground leading-snug">
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
            <div className={\`
              h-6 w-11 rounded-full ring-0 transition-all duration-300 ease-in-out
              \${isActive ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700'}
              after:content-[''] after:absolute after:top-[2px] after:left-[2px]
              after:h-5 after:w-5 after:bg-white after:rounded-full after:transition-all after:shadow-sm
              peer-checked:after:translate-x-full
            \`} />
          </label>

          {(isActive || isEditing) && (
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={\`p-1.5 rounded-lg transition-colors border \${
                isEditing
                  ? 'bg-indigo-50 dark:bg-indigo-950 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400'
                  : 'bg-transparent border-transparent text-slate-400 hover:text-foreground hover:bg-muted'
              }\`}
            >
              <ChevronDown className={\`w-5 h-5 transition-transform \${isEditing ? 'rotate-180' : ''}\`} />
            </button>
          )}
        </div>
      </div>

      {(isActive || isEditing) && isEditing && (
        <div className="px-4 pb-4 border-t border-border bg-card/50 rounded-b-xl animate-in fade-in fill-mode-forwards">
          <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                 placeholder={'{\\n  "business_rules": "1. Check tax rate..."\\n}'}
               />
               <p className="text-xs text-muted-foreground mt-1">Cứng: {endpoint.profileOnlyParams?.join(', ') || 'N/A'}</p>
            </div>

            <div className="sm:col-span-2 flex justify-end gap-3 pt-3 border-t border-border/50">
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 bg-background border border-border hover:bg-muted text-sm font-semibold rounded-lg transition-colors shadow-sm"
              >
                Đóng
              </button>
              <button
                onClick={() => saveSettings(isActive, defaultParamsStr, profileParamsStr)}
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 shadow-sm"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Lưu Ghi đè
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`;

content += profileEndpointComponent;

fs.writeFileSync('app/overrides/page.tsx', content, 'utf8');
console.log('Successfully updated app/overrides/page.tsx');
