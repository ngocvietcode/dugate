'use client';

// Bộ rule (rule engine + rule LLM) THEO SẢN PHẨM. Phạm vi theo luồng là công tắc bật/tắt trên từng rule
// (`flows[<FLOW>].checks[<id>] = false` khi tắt), thay cho các nút tag luồng / sản phẩm trước đây.
// Rule thuộc về sản phẩm đang chọn nên không còn lọc theo sản phẩm.

import { useMemo } from 'react';
import { asRecord, readChecks, serialize, type Editable } from '@/app/loan-appraisal-v2/lib/checks-config';
import { FlaskConical, ShieldCheck, Sparkles, X } from 'lucide-react';
import {
  LOAN_CHECK_CATALOG,
  LOAN_CHECK_PROGRAM,
  LOAN_CHECK_SET_VERSION,
  MAX_CHECKS,
  MAX_NAME_LENGTH,
  MAX_PROMPT_LENGTH,
  PARAM_RANGES,
} from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { loanPolicyDefaults } from '@/lib/pipelines/workflows/loan-appraisal/product-policy';
import { RULE_GROUPS, compareRuleGroups, isRuleGroupKey, resolveRuleGroup, type RuleGroupKey } from '@/lib/pipelines/workflows/loan-appraisal/rule-groups';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { FOCUS_RING } from '../ui/toneClasses';
import type { ConfigPanelProps } from './AiStepsPanel';
const SEVERITIES = ['BLOCKER', 'EXCEPTION', 'REVIEW', 'INFO'] as const;
const INPUT = `w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground disabled:opacity-60 ${FOCUS_RING}`;

const PARAM_SPECS: Record<string, Array<{ key: keyof typeof PARAM_RANGES; label: string; step: number; policy: 'minimumDscr' | 'maximumLtv' | 'maximumAmountVnd' }>> = {
  'LOAN.CAPACITY.MIN_DSCR': [{ key: 'minimum', label: 'DSCR tối thiểu', step: 0.01, policy: 'minimumDscr' }],
  'LOAN.COLLATERAL.MAX_LTV': [{ key: 'maximum', label: 'LTV tối đa (0..1)', step: 0.01, policy: 'maximumLtv' }],
  'LOAN.PRODUCT.MAX_AMOUNT': [{ key: 'maximum_vnd', label: 'Hạn mức tối đa (VND)', step: 1_000_000, policy: 'maximumAmountVnd' }],
};

const POLICY_PARAM = { minimumDscr: 'minimum_dscr', maximumLtv: 'maximum_ltv', maximumAmountVnd: 'maximum_amount_vnd' } as const;

const DEFAULT_SERIALIZED = JSON.stringify(serialize(LOAN_CHECK_CATALOG.map((c) => ({ ...c, isCustom: false }))));

export function ChecksPanel({ config, update, canEdit, productCode, flow, flows, kind }: ConfigPanelProps & {
  productCode: string;
  flow: string;
  flows: Array<{ value: string; label: string }>;
  kind: 'DETERMINISTIC' | 'PROMPT';
}) {
  const checks = useMemo(() => readChecks(asRecord(config.checks) ?? undefined), [config.checks]);
  // Gom theo nhóm nghiệp vụ (cùng thứ tự với trang kết quả); nhóm rỗng không hiển thị.\r
  const shown = checks.filter((c) => c.kind === kind).sort((a, b) => compareRuleGroups(resolveRuleGroup(a), resolveRuleGroup(b)));
  const defaults = loanPolicyDefaults(productCode);

  const write = (next: Editable[], current = config): typeof config => {
    const out = { ...current };
    if (JSON.stringify(serialize(next)) === DEFAULT_SERIALIZED) delete out.checks;
    else out.checks = { program: LOAN_CHECK_PROGRAM, version: LOAN_CHECK_SET_VERSION, checks: serialize(next) };
    return out;
  };
  const patch = (id: string, change: Partial<Editable>) => update((current) => write(
    readChecks(asRecord(current.checks) ?? undefined).map((c) => (c.id === id ? { ...c, ...change } : c)), current));
  const remove = (id: string) => update((current) => {
    const next = write(readChecks(asRecord(current.checks) ?? undefined).filter((c) => c.id !== id), current);
    // Dọn công tắc luồng của rule đã xoá.
    if (next.flows) {
      const flowsCfg = Object.fromEntries(Object.entries(next.flows).map(([f, v]) => [f, { ...v, checks: Object.fromEntries(Object.entries(v.checks ?? {}).filter(([k]) => k !== id)) }]).filter(([, v]) => Object.keys((v as { checks: object }).checks).length));
      if (Object.keys(flowsCfg).length) next.flows = flowsCfg as typeof next.flows; else delete next.flows;
    }
    return next;
  });
  const setFlowSwitch = (id: string, flowKey: string, on: boolean) => update((current) => {
    const flowsCfg = structuredClone(current.flows ?? {});
    const map = { ...(flowsCfg[flowKey]?.checks ?? {}) };
    if (on) delete map[id]; else map[id] = false;
    if (Object.keys(map).length) flowsCfg[flowKey] = { checks: map }; else delete flowsCfg[flowKey];
    const out = { ...current };
    if (Object.keys(flowsCfg).length) out.flows = flowsCfg; else delete out.flows;
    return out;
  });
  const addCustom = () => update((current) => {
    const list = readChecks(asRecord(current.checks) ?? undefined);
    if (list.length >= MAX_CHECKS) return current;
    const ids = new Set(list.map((c) => c.id));
    let n = list.filter((c) => c.isCustom).length + 1;
    let id = `LOAN.CUSTOM.CHECK_${n}`;
    while (ids.has(id)) { n += 1; id = `LOAN.CUSTOM.CHECK_${n}`; }
    return write([...list, { id, name: `Kiểm tra tuỳ chỉnh ${n}`, kind: 'PROMPT', group: 'OTHER', enabled: true, flows: [], products: [], input: [], action: 'warn', severity: 'REVIEW', exception_allowed: false, version: '1.0.0', prompt: '', threshold: 0.85, isCustom: true }], current);
  });

  const missingPrompt = checks.filter((c) => c.kind === 'PROMPT' && c.enabled && !c.prompt?.trim());

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-muted-foreground">
        {kind === 'DETERMINISTIC'
          ? 'Rule engine so sánh bằng code nên kết quả tái lập 100%; chỉ cấu hình được ngưỡng. Công tắc theo luồng quyết định rule có chạy ở từng luồng của sản phẩm này hay không.'
          : 'Rule LLM chạy prompt trên dữ liệu đã bóc tách, bắt buộc dẫn evidence và mặc định chỉ cảnh báo. Dưới ngưỡng tin cậy, kết quả hạ xuống "cần rà soát".'}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((c) => {
          const specs = PARAM_SPECS[c.id] ?? [];
          const flowOff = (key: string) => config.flows?.[key]?.checks?.[c.id] === false;
          const runsHere = c.enabled && !flowOff(flow);
          return (
            <Card key={c.id} as="div" className={c.enabled ? '' : 'opacity-70'}>
              <CardHeader
                icon={kind === 'DETERMINISTIC' ? ShieldCheck : Sparkles}
                title={c.name}
                subtitle={<span className="font-mono">{c.id} · v{c.version}</span>}
                actions={(
                  <>
                    {c.isCustom && <Badge tone="info">Tuỳ chỉnh</Badge>}
                    <Badge tone={runsHere ? 'success' : 'neutral'}>{runsHere ? `Chạy ở luồng ${flow}` : `Không chạy ở luồng ${flow}`}</Badge>
                  </>
                )}
              />
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold">
                    <input type="checkbox" checked={c.enabled} disabled={!canEdit} onChange={(e) => patch(c.id, { enabled: e.target.checked })} className="h-4 w-4" />
                    Đang áp dụng cho sản phẩm này
                  </label>
                  {canEdit && c.isCustom && (
                    <button type="button" onClick={() => remove(c.id)} aria-label={`Xoá ${c.name}`} className={`rounded p-1 text-muted-foreground hover:text-foreground ${FOCUS_RING}`}><X className="h-4 w-4" aria-hidden /></button>
                  )}
                </div>

                <fieldset className="rounded-lg border border-border p-3" disabled={!canEdit || !c.enabled}>
                  <legend className="px-1 text-[11px] font-semibold text-muted-foreground">Chạy ở luồng</legend>
                  <div className="flex flex-wrap gap-3">
                    {flows.map((f) => (
                      <label key={f.value} className="inline-flex items-center gap-1.5 text-xs">
                        <input type="checkbox" checked={!flowOff(f.value)} onChange={(e) => setFlowSwitch(c.id, f.value, e.target.checked)} className="h-4 w-4" />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className="text-[11px] font-semibold text-muted-foreground">Nhóm hiển thị</span>
                    <select value={resolveRuleGroup(c)} disabled={!canEdit} onChange={(e) => { if (isRuleGroupKey(e.target.value)) patch(c.id, { group: e.target.value as RuleGroupKey }); }} className={`${INPUT} mt-1`}>
                      {RULE_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                    </select></label>
                  {c.isCustom && (
                    <label className="block"><span className="text-[11px] font-semibold text-muted-foreground">Tên rule</span>
                      <input type="text" value={c.name} maxLength={MAX_NAME_LENGTH} disabled={!canEdit} onChange={(e) => patch(c.id, { name: e.target.value })} className={`${INPUT} mt-1`} /></label>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block"><span className="text-[11px] font-semibold text-muted-foreground">Mức độ</span>
                    <select value={c.severity} disabled={!canEdit} onChange={(e) => patch(c.id, { severity: e.target.value as Editable['severity'] })} className={`${INPUT} mt-1 font-mono`}>
                      {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select></label>
                  <label className="block"><span className="text-[11px] font-semibold text-muted-foreground">Hành động</span>
                    <select value={c.action} disabled={!canEdit} onChange={(e) => patch(c.id, { action: e.target.value === 'block' ? 'block' : 'warn' })} className={`${INPUT} mt-1 font-mono`}>
                      <option value="warn">warn — cảnh báo</option><option value="block">block — chặn</option>
                    </select></label>
                  <label className="mt-5 inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={c.exception_allowed} disabled={!canEdit} onChange={(e) => patch(c.id, { exception_allowed: e.target.checked })} className="h-4 w-4" />
                    Cho phép ngoại lệ
                  </label>
                </div>

                {kind === 'DETERMINISTIC' ? (
                  specs.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {specs.map((s) => {
                        const range = PARAM_RANGES[s.key];
                        const fallback = config.policy?.[POLICY_PARAM[s.policy]] ?? defaults?.[s.policy];
                        return (
                          <label key={s.key} className="block"><span className="text-[11px] font-semibold text-muted-foreground">{s.label}</span>
                            <input type="number" step={s.step} min={range.min} max={range.max} disabled={!canEdit} value={c.params?.[s.key] ?? ''}
                              placeholder={typeof fallback === 'number' ? `Để trống = ngưỡng policy (${fallback.toLocaleString('vi-VN')})` : 'Để trống = ngưỡng policy'}
                              onChange={(e) => { const params = { ...(c.params ?? {}) }; const n = Number(e.target.value); if (e.target.value.trim() === '' || !Number.isFinite(n)) delete params[s.key]; else params[s.key] = n; patch(c.id, { params }); }}
                              className={`${INPUT} mt-1 font-mono`} />
                            <span className="mt-1 block text-[11px] text-muted-foreground">Khoảng hợp lệ [{range.min.toLocaleString('vi-VN')}, {range.max.toLocaleString('vi-VN')}]</span></label>
                        );
                      })}
                    </div>
                  ) : <p className="text-xs text-muted-foreground">Rule này đối chiếu trực tiếp checklist chứng từ bắt buộc của sản phẩm; không có tham số ngưỡng.</p>
                ) : (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={c.allow_declared_pass === true} disabled={!canEdit} onChange={(e) => patch(c.id, { allow_declared_pass: e.target.checked })} className="h-4 w-4" />
                      Cho phép PASS khi chỉ dựa trên lời khai trong đơn vay
                    </label>
                    <p className="text-[11px] text-muted-foreground">Chỉ có tác dụng khi tham số lac_mode = on</p>
                    <label className="block"><span className="text-[11px] font-semibold text-muted-foreground">Ngưỡng tin cậy (0..1)</span>
                      <input type="number" step={0.05} min={0} max={1} disabled={!canEdit} value={c.threshold ?? 0.85} onChange={(e) => patch(c.id, { threshold: Number(e.target.value) })} className={`${INPUT} mt-1 w-32 font-mono`} /></label>
                    <label className="block"><span className="text-[11px] font-semibold text-muted-foreground">Prompt kiểm tra</span>
                      <textarea value={c.prompt ?? ''} maxLength={MAX_PROMPT_LENGTH} disabled={!canEdit} spellCheck={false} onChange={(e) => patch(c.id, { prompt: e.target.value })}
                        placeholder="Nêu rõ cần đối chiếu gì, giữa chứng từ nào, và khi nào coi là mâu thuẫn thực chất…" className={`${INPUT} mt-1 min-h-[140px] resize-y font-mono`} />
                      <span className="text-[11px] text-muted-foreground">{(c.prompt ?? '').length}/{MAX_PROMPT_LENGTH} ký tự. Runtime tự gắn danh sách evidence, master data và schema output.</span></label>
                    {c.action === 'block' && c.severity !== 'BLOCKER' && (
                      <p className="flex items-start gap-1.5 text-[11px] text-[rgb(var(--la2-warning))]"><FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Rule LLM chỉ chặn được khi mức độ = BLOCKER; nếu không, runtime hạ về cảnh báo.</p>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
      {kind === 'PROMPT' && (
        <>
          {canEdit && <button type="button" onClick={addCustom} className={`rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted ${FOCUS_RING}`}>+ Thêm rule LLM</button>}
          {missingPrompt.length > 0 && (
            <p role="status" className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/60 p-3 text-xs text-[rgb(var(--la2-warning))]">
              <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Chưa thể lưu: {missingPrompt.map((c) => c.name).join(', ')} đang áp dụng nhưng chưa có prompt. Điền prompt hoặc tắt rule.
            </p>
          )}
        </>
      )}
    </div>
  );
}
