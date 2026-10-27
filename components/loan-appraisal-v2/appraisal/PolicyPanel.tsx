import { AlertTriangle, CheckCircle2, Circle, ListChecks } from 'lucide-react';
import type { AppraisalResult, PolicyRuleResult } from '@/app/loan-appraisal/types';
import { lacSummaryView } from '@/app/loan-appraisal-v2/lib/lac-summary';
import { formatCurrencyVnd } from '@/app/loan-appraisal-v2/lib/format';
import { humanizeKey, safeArray } from '@/app/loan-appraisal-v2/lib/selectors';
import { factorTone, ruleTone } from '@/app/loan-appraisal-v2/lib/tone';
import { RULE_GROUPS, resolveRuleGroup, type RuleGroupKey } from '@/lib/pipelines/workflows/loan-appraisal/rule-groups';
import { Badge } from '../ui/Badge';
import { Disclosure } from '../ui/Disclosure';
import { EmptyState } from '../ui/EmptyState';
import { EvidenceChips } from '../ui/EvidenceChips';
import { KeyValue } from '../ui/KeyValue';
import { TONE_BOX } from '../ui/toneClasses';

function structured(value: unknown): string {
  if (value === undefined) return 'Không áp dụng';
  if (value === null) return 'null';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

function KindBadge({ kind }: { kind?: PolicyRuleResult['check_kind'] }) {
  return <Badge tone={kind === 'PROMPT' ? 'info' : 'neutral'}>{kind === 'PROMPT' ? 'LLM' : 'Engine'}</Badge>;
}

/** Một rule = một box. Box sinh từ `rule_results` nên rule mới thêm trong cấu hình tự có box ở lần chạy sau. */
function RuleBox({ rule }: { rule: PolicyRuleResult }) {
  const tone = ruleTone(rule.result);
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertTriangle : Circle;
  const ids = safeArray(rule.evidence_ids);
  return (
    <li className={`flex flex-col rounded-xl border p-3 ${TONE_BOX[tone]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <KindBadge kind={rule.check_kind} />
        <Badge tone={tone}>{rule.result}</Badge>
      </div>
      <h5 className="mt-2 text-sm font-semibold text-foreground">{rule.check_name ?? rule.rule_id}</h5>
      <p className="mt-1 text-xs leading-5 text-foreground/80">{rule.message}</p>
      <Disclosure className="mt-3 bg-card" summary="Chi tiết">
        <p className="mb-2 font-mono text-[11px] text-muted-foreground">{rule.rule_id} · v{rule.rule_version ?? '—'} · {rule.reason_code}</p>
        <dl className="grid gap-2 sm:grid-cols-2">
          <KeyValue label="Severity" value={rule.severity ?? '—'} />
          <KeyValue label="Ngoại lệ" value={rule.exception_allowed ? 'Cho phép' : 'Không'} />
          {rule.check_kind === 'PROMPT' && (
            <>
              <KeyValue label="Độ tin cậy" value={typeof rule.confidence === 'number' ? `${(rule.confidence * 100).toFixed(0)}%` : 'Không có'} />
              <KeyValue label="Ngưỡng tối thiểu" value={typeof rule.threshold === 'number' ? `${(rule.threshold * 100).toFixed(0)}%` : '—'} />
            </>
          )}
        </dl>
        <div className="mt-3 grid gap-3">
          <div className="rounded-lg border border-border bg-muted/40 p-3"><h6 className="text-xs font-semibold text-muted-foreground">Ngưỡng / Kỳ vọng</h6><pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs">{structured(rule.expected)}</pre></div>
          <div className="rounded-lg border border-border bg-muted/40 p-3"><h6 className="text-xs font-semibold text-muted-foreground">Kết quả hồ sơ</h6><pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs">{structured(rule.actual)}</pre></div>
        </div>
        <EvidenceChips ids={ids} className="mt-3" />
      </Disclosure>
    </li>
  );
}

function RuleGroupSection({ label, description, rules }: { label: string; description: string; rules: PolicyRuleResult[] }) {
  const passed = rules.filter((rule) => rule.result === 'PASS').length;
  const needsAttention = rules.length - passed;
  return (
    <section aria-label={label}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">{label}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge tone={needsAttention === 0 ? 'success' : 'warning'}>
          {needsAttention === 0 ? `${passed}/${rules.length} đạt` : `${needsAttention} cần rà soát · ${passed}/${rules.length} đạt`}
        </Badge>
      </div>
      <ul className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rules.map((rule) => <RuleBox key={rule.rule_id} rule={rule} />)}
      </ul>
    </section>
  );
}

/** Cấu hình đã áp dụng, thu gọn mặc định để màn hình chỉ còn các box rule. */
function CheckSetSummary({ result, engineCount, promptCount }: { result: AppraisalResult; engineCount: number; promptCount: number }) {
  const snapshot = result.config_snapshot;
  const checkSet = snapshot?.check_set;
  const thresholds = snapshot?.thresholds;
  return (
    <Disclosure summary={`Cấu hình đã áp dụng · ${checkSet?.deterministic_count ?? engineCount} rule engine · ${checkSet?.prompt_count ?? promptCount} rule LLM`}>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KeyValue label="Bộ kiểm tra" value={checkSet ? `${checkSet.program} · v${checkSet.version}` : 'Mặc định trong code'} />
        <KeyValue label="Nguồn" value={checkSet?.source === 'PROFILE' ? 'Cấu hình từ Profile' : 'Mặc định sản phẩm'} />
        <KeyValue label="DSCR tối thiểu" value={thresholds ? `${thresholds.minimum_dscr.toFixed(2)}×` : '—'} />
        <KeyValue label="LTV tối đa" value={thresholds ? `${(thresholds.maximum_ltv * 100).toFixed(0)}%` : '—'} />
      </dl>
      {checkSet?.output_schema && (
        <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">{checkSet.output_schema}</pre>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Hạn mức sản phẩm {thresholds ? formatCurrencyVnd(thresholds.maximum_amount_vnd) : '—'}. Sửa bộ rule tại trang Cấu hình; màn hình này chỉ đọc.
      </p>
    </Disclosure>
  );
}

function LacSummary({ result }: { result: AppraisalResult }) {
  const view = lacSummaryView(result.loan_application_context_summary);
  if (!view) return null;
  return (
    <Disclosure summary="Ngữ cảnh đơn vay">
      <dl className="grid gap-2 sm:grid-cols-2">
        {view.rows.map((row) => <KeyValue key={row.label} label={row.label} value={row.value} />)}
      </dl>
      {view.gaps.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{view.gaps.map((line, index) => <li key={index}>{line}</li>)}</ul>}
    </Disclosure>
  );
}

export function PolicyPanel({ result }: { result: AppraisalResult }) {
  const policy = result.policy_compliance;
  if (!policy) return <div className="space-y-5"><EmptyState icon={ListChecks} title="Artifact policy chưa sẵn sàng" /><LacSummary result={result} /></div>;
  const rules = safeArray(policy.rule_results);
  const exceptions = safeArray(policy.exceptions);
  const engineCount = rules.filter((r) => r.check_kind !== 'PROMPT').length;
  const promptCount = rules.length - engineCount;

  // Gom theo nhóm; kết quả cũ chưa có `group` được suy từ rule_id. Nhóm rỗng không hiển thị.
  const byGroup = new Map<RuleGroupKey, PolicyRuleResult[]>();
  for (const rule of rules) {
    const key = resolveRuleGroup(rule);
    byGroup.set(key, [...(byGroup.get(key) ?? []), rule]);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{policy.policy_id} · v{policy.policy_version}</p>
          <h3 className="mt-1 text-sm font-semibold">Kết quả kiểm tra theo rule</h3>
        </div>
        <Badge tone={factorTone(policy.status)}>{policy.status}</Badge>
      </div>

      {rules.length === 0 && <EmptyState icon={ListChecks} title="Chưa có rule result" />}
      {RULE_GROUPS.filter((group) => byGroup.has(group.key)).map((group) => (
        <RuleGroupSection key={group.key} label={group.label} description={group.description} rules={byGroup.get(group.key)!} />
      ))}

      {exceptions.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold">Ngoại lệ policy cần xử lý</h4>
          <ul className="grid gap-2 md:grid-cols-2">{exceptions.map((e) => (
            <li key={e} className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${TONE_BOX.warning}`}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{humanizeKey(e)}</li>
          ))}</ul>
        </section>
      )}

      <CheckSetSummary result={result} engineCount={engineCount} promptCount={promptCount} />
      <LacSummary result={result} />
    </div>
  );
}
