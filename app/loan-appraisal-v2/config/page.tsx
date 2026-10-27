'use client';

// Trang cấu hình v2: cấu hình workflow THEO SẢN PHẨM (prompt / model / reasoning, rule, ngưỡng policy, checklist).
// Profile chỉ là nơi lưu; phần cấu hình gắn với sản phẩm đang chọn. Luồng chỉ dùng để xem rule nào chạy và đặt công tắc theo luồng.

import { useState } from 'react';
import { ChevronDown, CircleAlert, GitBranch, Layers, Loader2, Save, Wallet } from 'lucide-react';
import { PageShell } from '@/components/loan-appraisal-v2/layout/PageShell';
import { AiStepsPanel } from '@/components/loan-appraisal-v2/config/AiStepsPanel';
import { ChecklistPanel } from '@/components/loan-appraisal-v2/config/ChecklistPanel';
import { ChecksPanel } from '@/components/loan-appraisal-v2/config/ChecksPanel';
import { PolicyThresholdsPanel } from '@/components/loan-appraisal-v2/config/PolicyThresholdsPanel';
import { Badge } from '@/components/loan-appraisal-v2/ui/Badge';
import { Button } from '@/components/loan-appraisal-v2/ui/Button';
import { EmptyState } from '@/components/loan-appraisal-v2/ui/EmptyState';
import { Tabs, panelProps } from '@/components/loan-appraisal-v2/ui/Tabs';
import { FOCUS_RING, TONE_BOX } from '@/components/loan-appraisal-v2/ui/toneClasses';
import { profileLabel, useLoanConfig } from '../hooks/useLoanConfig';

const SELECT = `h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-9 text-sm text-foreground disabled:opacity-60 ${FOCUS_RING}`;
const PREFIX = 'la2-cfg';

type ConfigTab = 'ai' | 'engine' | 'llm' | 'policy' | 'checklist';
const TABS: Array<{ id: ConfigTab; label: string }> = [
  { id: 'ai', label: 'Bước AI (prompt · model)' },
  { id: 'engine', label: 'Rule engine' },
  { id: 'llm', label: 'Rule LLM' },
  { id: 'policy', label: 'Ngưỡng policy' },
  { id: 'checklist', label: 'Checklist' },
];

function Select({ id, label, icon: Icon, value, onChange, disabled, children }: {
  id: string; label: string; icon: typeof Layers; value: string; onChange: (value: string) => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="min-w-[180px] flex-1 sm:max-w-xs">
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Icon className="h-3 w-3" aria-hidden />{label}</label>
      <div className="relative">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={SELECT}>{children}</select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      </div>
    </div>
  );
}

export default function LoanAppraisalV2ConfigPage() {
  const config = useLoanConfig();
  const [tab, setTab] = useState<ConfigTab>('ai');
  const canEdit = config.canManageEndpoints;
  const product = config.products.find((option) => option.value === config.productCode);
  const shared = { config: config.productConfig, update: config.updateProduct, canEdit };

  return (
    <PageShell current="config">
      <div className="sticky top-0 z-20 -mx-4 mb-5 border-b border-border bg-card/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <Select id="la2-cfg-profile" label="Lưu vào Profile" icon={Wallet} value={config.apiKeyId} onChange={config.changeProfile} disabled={config.loadingProfiles || config.saving}>
            <option value="">{config.loadingProfiles ? 'Đang tải…' : 'Chọn Profile'}</option>
            {config.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profileLabel(profile)}</option>)}
          </Select>
          <Select id="la2-cfg-product" label="Sản phẩm" icon={Layers} value={config.productCode} onChange={config.changeProduct} disabled={!config.isReady}>
            {config.products.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Select id="la2-cfg-flow" label="Luồng" icon={GitBranch} value={config.flow} onChange={config.setFlow} disabled={!config.isReady || config.flows.length === 0}>
            {config.flows.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <div className="flex-1" />
          {config.dirty && <Badge tone="warning">Có thay đổi chưa lưu</Badge>}
          {config.isReady && canEdit && (
            <Button variant="primary" onClick={() => void config.save()} disabled={config.saving || !config.dirty}>
              {config.saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              {config.saving ? 'Đang lưu' : 'Lưu thiết lập'}
            </Button>
          )}
        </div>
        {config.selectedProfile && config.isReady && !canEdit && !config.loadingEndpoint && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-[rgb(var(--la2-warning))]"><CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />Bạn không có quyền chỉnh cấu hình endpoint; chỉ xem được ở dạng đã ẩn giá trị.</p>
        )}
      </div>

      <h1 className="text-2xl font-semibold">Cấu hình thẩm định vay theo sản phẩm</h1>
      <p className="mb-5 mt-2 max-w-3xl text-sm text-muted-foreground">
        Mọi cấu hình gắn với sản phẩm đang chọn{product ? ` (${product.label})` : ''}, áp dụng cho mọi hồ sơ thuộc sản phẩm đó. Profile chỉ là nơi lưu cấu hình.
      </p>

      {config.loadingEndpoint && !config.isReady && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Đang tải cấu hình…</p>
      )}
      {!config.loadingEndpoint && config.loadError && (
        <div role="alert" className={`flex items-start gap-3 rounded-xl border p-4 ${TONE_BOX.danger}`}>
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div><p className="text-sm font-semibold">Không tải được cấu hình</p><p className="mt-1 text-xs">{config.loadError}</p></div>
        </div>
      )}
      {!config.apiKeyId && !config.loadingProfiles && <EmptyState title="Chọn một Profile ở trên để xem và chỉnh cấu hình." />}

      {config.isReady && (
        <div className="space-y-4">
          {config.legacyKeys.length > 0 && (
            <div role="status" className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4 ${TONE_BOX.warning}`}>
              <div className="min-w-0 max-w-3xl">
                <p className="text-sm font-semibold">Profile còn cấu hình cũ (theo Profile) và hiện KHÔNG còn được áp dụng</p>
                <p className="mt-1 text-xs">Các khoá: <span className="font-mono">{config.legacyKeys.join(', ')}</span>. Chuyển sang từng sản phẩm chưa có cấu hình riêng (giữ nguyên prompt, model, rule, ngưỡng, checklist; tag luồng/sản phẩm chuyển thành công tắc theo luồng), rồi bấm Lưu thiết lập.</p>
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={config.migrateLegacy}>Chuyển sang sản phẩm</Button>
                  <Button size="sm" onClick={config.dropLegacy}>Bỏ cấu hình cũ</Button>
                </div>
              )}
            </div>
          )}

          <Tabs items={TABS} active={tab} onChange={setTab} label="Nhóm cấu hình" idPrefix={PREFIX} variant="pill" />
          <div {...panelProps(PREFIX, tab)}>
            {tab === 'ai' && <AiStepsPanel {...shared} />}
            {tab === 'engine' && <ChecksPanel {...shared} productCode={config.productCode} flow={config.flow} flows={config.flows} kind="DETERMINISTIC" />}
            {tab === 'llm' && <ChecksPanel {...shared} productCode={config.productCode} flow={config.flow} flows={config.flows} kind="PROMPT" />}
            {tab === 'policy' && <PolicyThresholdsPanel {...shared} productCode={config.productCode} />}
            {tab === 'checklist' && <ChecklistPanel {...shared} productCode={config.productCode} />}
          </div>
        </div>
      )}
    </PageShell>
  );
}
