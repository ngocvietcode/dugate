'use client';

// Ngưỡng policy theo sản phẩm: để trống = giữ ngưỡng mặc định của sản phẩm (loan_products.json).

import { POLICY_RANGES } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { loanPolicyDefaults } from '@/lib/pipelines/workflows/loan-appraisal/product-policy';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { FOCUS_RING } from '../ui/toneClasses';
import type { ConfigPanelProps } from './AiStepsPanel';

type PolicyKey = keyof typeof POLICY_RANGES;
type DefaultField = 'minimumDscr' | 'maximumLtv' | 'maximumAmountVnd' | 'defaultTenorMonths';

const FIELDS: Array<{ param: PolicyKey; label: string; hint: string; step: number; field: DefaultField }> = [
  { param: 'minimum_dscr', label: 'DSCR tối thiểu', hint: 'Rule MIN_DSCR dùng khi rule không khai tham số riêng', step: 0.01, field: 'minimumDscr' },
  { param: 'maximum_ltv', label: 'LTV tối đa', hint: 'Tỷ lệ 0..1', step: 0.01, field: 'maximumLtv' },
  { param: 'maximum_amount_vnd', label: 'Hạn mức sản phẩm (VND)', hint: 'Trần số tiền đề nghị vay', step: 1_000_000, field: 'maximumAmountVnd' },
  { param: 'default_tenor_months', label: 'Kỳ hạn mặc định (tháng)', hint: 'Dùng khi hồ sơ không nêu kỳ hạn', step: 1, field: 'defaultTenorMonths' },
];

export function PolicyThresholdsPanel({ config, update, canEdit, productCode }: ConfigPanelProps & { productCode: string }) {
  const defaults = loanPolicyDefaults(productCode);
  const set = (param: PolicyKey, raw: string) => update((current) => {
    const policy = { ...(current.policy ?? {}) };
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(value)) delete policy[param];
    else policy[param] = value;
    const next = { ...current };
    if (Object.keys(policy).length > 0) next.policy = policy;
    else delete next.policy;
    return next;
  });

  return (
    <Card as="div">
      <CardHeader
        title="Ngưỡng policy ghi đè"
        subtitle={defaults ? `Mặc định của ${productCode}: ${defaults.policyId} v${defaults.policyVersion}. Để trống = giữ ngưỡng mặc định.` : 'Để trống = giữ ngưỡng mặc định của sản phẩm.'}
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(({ param, label, hint, step, field }) => {
          const range = POLICY_RANGES[param];
          const fallback = defaults?.[field];
          return (
            <label key={param} className="block">
              <span className="text-xs font-semibold text-muted-foreground">{label}</span>
              <input
                type="number"
                step={step}
                min={range.min}
                max={range.max}
                value={config.policy?.[param] ?? ''}
                disabled={!canEdit}
                onChange={(event) => set(param, event.target.value)}
                placeholder={typeof fallback === 'number' ? `Mặc định: ${fallback.toLocaleString('vi-VN')}` : 'Giữ mặc định sản phẩm'}
                className={`mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-mono disabled:opacity-60 ${FOCUS_RING}`}
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">{hint} · khoảng hợp lệ [{range.min.toLocaleString('vi-VN')}, {range.max.toLocaleString('vi-VN')}]</span>
            </label>
          );
        })}
      </CardBody>
    </Card>
  );
}
