'use client';

// Cấu hình prompt / model / mức suy luận của từng bước AI THEO SẢN PHẨM.
// Dữ liệu nằm ở `loan_product_config.products[<product>].{prompts,models,reasoning}`; để trống = dùng mặc định (model: `evaluate`, prompt: trong code).

import { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { LOAN_APPRAISAL_STEPS, type LoanStepMeta } from '@/lib/pipelines/workflows/loan-appraisal/step-catalog';
import type { LoanProductConfig } from '@/lib/pipelines/workflows/loan-appraisal/product-config';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { FOCUS_RING } from '../ui/toneClasses';

const INPUT = `w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono text-foreground disabled:opacity-60 ${FOCUS_RING}`;
const EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;

export interface ConfigPanelProps {
  config: LoanProductConfig;
  update: (change: (current: LoanProductConfig) => LoanProductConfig) => void;
  canEdit: boolean;
}

/** Ghi một giá trị vào map step → chuỗi; rỗng thì xoá khoá và dọn map rỗng. */
function setStep(config: LoanProductConfig, field: 'prompts' | 'models' | 'reasoning', step: string, value: string): LoanProductConfig {
  const map = { ...(config[field] ?? {}) };
  if (value.trim()) map[step] = value;
  else delete map[step];
  const next = { ...config };
  if (Object.keys(map).length > 0) next[field] = map;
  else delete next[field];
  return next;
}

function StepCard({ step, config, update, canEdit }: ConfigPanelProps & { step: LoanStepMeta }) {
  const [open, setOpen] = useState(false);
  const model = config.models?.[step.key] ?? '';
  const effort = config.reasoning?.[step.key] ?? '';
  const prompt = config.prompts?.[step.key];
  const editable = step.promptEditable !== false;
  const customized = Boolean(model || effort || prompt);

  return (
    <Card as="div">
      <CardHeader
        icon={Sparkles}
        title={`${step.icon} ${step.label}`}
        subtitle={step.description}
        actions={(
          <>
            <Badge tone="neutral">{step.connector}</Badge>
            {customized && <Badge tone="info">Đã tuỳ chỉnh</Badge>}
          </>
        )}
      />
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Model</span>
            <input
              value={model}
              maxLength={200}
              disabled={!canEdit}
              onChange={(event) => update((current) => setStep(current, 'models', step.key, event.target.value))}
              placeholder={step.key === 'evaluate' ? 'Để trống = model mặc định của connector' : 'Để trống = dùng model của bước "Model mặc định"'}
              className={`${INPUT} mt-1`}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Mức suy luận (reasoning_effort)</span>
            <select
              value={effort}
              disabled={!canEdit}
              onChange={(event) => update((current) => setStep(current, 'reasoning', step.key, event.target.value))}
              className={`${INPUT} mt-1`}
            >
              <option value="">{step.key === 'evaluate' ? 'Mặc định (theo connector)' : 'Mặc định (theo bước "Model mặc định")'}</option>
              {EFFORTS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        {editable && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Prompt</span>
              <div className="flex items-center gap-2">
                {step.variables.map((variable) => (
                  <button
                    key={variable.name}
                    type="button"
                    disabled={!canEdit || prompt === undefined}
                    title={variable.desc}
                    onClick={() => update((current) => setStep(current, 'prompts', step.key, `${prompt ?? ''}${variable.name}`))}
                    className={`rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 ${FOCUS_RING}`}
                  >
                    {variable.name}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => update((current) => (prompt === undefined
                    ? setStep(current, 'prompts', step.key, step.codePromptPreview)
                    : setStep(current, 'prompts', step.key, '')))}
                  className={`rounded-lg border border-border px-3 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50 ${FOCUS_RING}`}
                >
                  {prompt === undefined ? 'Ghi đè prompt' : 'Bỏ ghi đè'}
                </button>
              </div>
            </div>
            {prompt !== undefined ? (
              <>
                {step.hasDynamicSections && step.dynamicWarning && (
                  <p className="rounded-lg border border-border bg-muted/60 p-2 text-xs text-muted-foreground">{step.dynamicWarning}</p>
                )}
                <textarea
                  value={prompt}
                  disabled={!canEdit}
                  onChange={(event) => update((current) => ({ ...current, prompts: { ...(current.prompts ?? {}), [step.key]: event.target.value } }))}
                  spellCheck={false}
                  className={`${INPUT} min-h-[180px] resize-y leading-relaxed`}
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Đang dùng prompt mặc định trong code.</p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={`flex items-center gap-1.5 rounded text-xs font-semibold text-muted-foreground hover:text-foreground ${FOCUS_RING}`}
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
          {editable ? 'Xem prompt gốc trong code (tham khảo)' : 'Ghi chú'}
        </button>
        {open && (
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{step.codePromptPreview}</pre>
        )}
      </CardBody>
    </Card>
  );
}

export function AiStepsPanel(props: ConfigPanelProps) {
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Chọn prompt, model và mức suy luận cho từng bước AI của sản phẩm này. Bước nào để trống sẽ dùng mặc định; bước &quot;Model mặc định&quot; là model dùng chung cho mọi bước chưa chọn riêng.
      </p>
      {LOAN_APPRAISAL_STEPS.map((step) => <StepCard key={step.key} step={step} {...props} />)}
    </div>
  );
}
