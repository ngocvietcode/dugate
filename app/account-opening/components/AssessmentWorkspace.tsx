'use client';

// Giai đoạn 2: đánh giá và kết luận mở tài khoản.
// Thứ tự trình bày theo đúng DAG: điều kiện → rà soát khách hàng (CDD) → policy
// theo phân khúc/sản phẩm → sàng lọc → kết luận và tuyến rà soát.
//
// Nguyên tắc hiển thị: không bao giờ làm mờ ranh giới giữa "không áp dụng",
// "thiếu dữ liệu" và "không đạt" — đó là ba kết luận nghiệp vụ khác nhau.

import React, { useMemo, useState } from 'react';
import {
  BadgeCheck,
  ChevronDown,
  CircleAlert,
  Code,
  Gauge,
  Info,
  ListChecks,
  Lock,
  Route,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserSearch,
} from 'lucide-react';
import type {
  AccountOpeningResult,
  CddFactor,
  EligibilityMetricKey,
  PolicyRuleResult,
} from '../types';
import type { ProductTemplate, SegmentTemplate } from '../segments';
import {
  DetailField,
  EmptyInline,
  MiniStat,
  SURFACE,
  StatusBadge,
  assessmentLabel,
  assessmentTone,
  dueDiligenceMeta,
  formatMetric,
  metricTone,
  reasonLabel,
  recommendationMeta,
  reviewRouteMeta,
  riskMeta,
  ruleResultMeta,
  safeArray,
  statusToneClass,
  type StatusTone,
} from './primitives';

interface AssessmentWorkspaceProps {
  segment: SegmentTemplate;
  product: ProductTemplate;
  result: AccountOpeningResult | null;
}

/** Thứ tự và nhãn nghiệp vụ của 10 chỉ tiêu điều kiện. */
const METRIC_LABELS: Array<{ key: EligibilityMetricKey; label: string; caption: string }> = [
  { key: 'applicant_age', label: 'Tuổi chủ tài khoản', caption: 'Chủ tài khoản hoặc người đại diện' },
  { key: 'primary_id_validity_days', label: 'Hiệu lực giấy tờ định danh', caption: 'Mốc hết hạn sớm nhất trong hồ sơ' },
  { key: 'residency_permit_validity_days', label: 'Hiệu lực giấy tờ cư trú', caption: 'Thị thực / thẻ tạm trú' },
  { key: 'organization_age_months', label: 'Thời gian hoạt động', caption: 'Từ ngày đăng ký kinh doanh lần đầu' },
  { key: 'charter_capital', label: 'Vốn điều lệ', caption: 'Theo đăng ký doanh nghiệp / điều lệ' },
  { key: 'declared_annual_revenue', label: 'Doanh thu / thu nhập năm', caption: 'Khách hàng khai hoặc chứng minh' },
  { key: 'beneficial_owner_coverage_percent', label: 'Độ phủ chủ sở hữu hưởng lợi', caption: 'Tổng tỷ lệ sở hữu đã kê khai' },
  { key: 'authorized_signatory_count', label: 'Người ký / được ủy quyền', caption: 'Đăng ký trên tài khoản' },
  { key: 'mandatory_profile_coverage_percent', label: 'Độ phủ trường CIF bắt buộc', caption: 'Chỉ tính trường truy được nguồn' },
  { key: 'document_completeness_percent', label: 'Độ đầy đủ chứng từ', caption: 'Chứng từ bắt buộc đã có' },
];

export function AssessmentWorkspace({ segment, product, result }: AssessmentWorkspaceProps) {
  if (!result?.recommendation && !result?.eligibility_metrics && !result?.cdd_assessment) {
    return (
      <EmptyInline
        icon={ScanSearch}
        text="Chưa có kết quả đánh giá. Giai đoạn này hiển thị sau khi workflow chạy qua các stage deterministic."
      />
    );
  }

  return (
    <div className="space-y-6">
      <DecisionSummary segment={segment} product={product} result={result} />
      <EligibilityPanel result={result} />
      <CddPanel result={result} />
      <PolicyPanel result={result} />
      <div className="grid gap-5 lg:grid-cols-2">
        <ScreeningPanel result={result} />
        <ConfigSnapshotPanel result={result} />
      </div>
    </div>
  );
}

// ─── Kết luận & tuyến xử lý ───────────────────────────────────────────────────

function DecisionSummary({ segment, product, result }: AssessmentWorkspaceProps) {
  const recommendation = result?.recommendation;
  const review = result?.review;
  const recommendationInfo = recommendationMeta(recommendation?.recommendation);
  const risk = riskMeta(recommendation?.risk_rating ?? result?.cdd_assessment?.risk_rating);
  const dueDiligence = dueDiligenceMeta(recommendation?.due_diligence_level ?? result?.cdd_assessment?.due_diligence_level);
  const route = reviewRouteMeta(review?.route);
  const conditions = safeArray(recommendation?.conditions_precedent);
  const restrictions = safeArray(recommendation?.restrictions);
  const reasons = safeArray(recommendation?.reason_codes);

  return (
    <section className={`${SURFACE} overflow-hidden`}>
      <div className="border-b border-slate-200 bg-slate-50/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">Kết luận đề xuất</p>
            <h3 className="mt-1.5 text-xl font-semibold text-slate-900">{recommendationInfo.label}</h3>
            <p className="mt-1.5 max-w-xl text-xs leading-5 text-slate-600">
              {recommendation?.proposed_account_type
                ? `Loại tài khoản đề xuất: ${recommendation.proposed_account_type} · phân khúc ${segment.shortName}.`
                : `Chưa đề xuất loại tài khoản cho sản phẩm ${product.shortName} vì còn tiêu chí chưa kết luận được.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={recommendationInfo.label} tone={recommendationInfo.tone} />
            <StatusBadge label={risk.label} tone={risk.tone} />
            <StatusBadge label={dueDiligence.label} tone={dueDiligence.tone} />
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailField label="Tuyến xử lý" value={route.label} />
          <DetailField label="Bộ phận chịu trách nhiệm" value={review?.required_role ? review.required_role.replace(/_/g, ' ') : '—'} />
          <DetailField label="Trạng thái xử lý" value={result?.processing_status ? result.processing_status.replace(/_/g, ' ') : '—'} />
          <DetailField label="Mức rà soát" value={dueDiligence.caption} />
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <ListChecks className="h-3.5 w-3.5 text-amber-600" />
            Điều kiện tiên quyết trước khi mở
          </p>
          {conditions.length > 0 ? (
            <ol className="mt-2.5 space-y-2">
              {conditions.map((item, index) => (
                <li key={item} className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white">{index + 1}</span>
                  <p className="text-[11px] leading-5 text-slate-800">{item}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-[11px] text-slate-600">Không có điều kiện tiên quyết.</p>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <Lock className="h-3.5 w-3.5 text-rose-600" />
              Hạn chế đề xuất áp cho tài khoản
            </p>
            {restrictions.length > 0 ? (
              <ul className="mt-2.5 space-y-1.5">
                {restrictions.map((item) => (
                  <li key={item} className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-[11px] leading-5 text-slate-800">{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-slate-600">Không đề xuất hạn chế nào.</p>
            )}
          </div>

          {reasons.length > 0 && (
            <details className="group rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                Lý do dẫn tới kết luận ({reasons.length})
              </summary>
              <ul className="mt-2 space-y-1.5">
                {reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-2 text-[11px] leading-5 text-slate-700">
                    <Info className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                    <span>{reasonLabel(reason)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3 text-[10px] leading-4 text-slate-500">
        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
        Đây là khuyến nghị hỗ trợ tác nghiệp. Quyết định mở tài khoản thuộc hệ thống onboarding có thẩm quyền
        {result?.audit?.final_authority ? ` (${result.audit.final_authority.replace(/_/g, ' ').toLowerCase()})` : ''}.
      </div>
    </section>
  );
}

// ─── Chỉ tiêu điều kiện ───────────────────────────────────────────────────────

function EligibilityPanel({ result }: { result: AccountOpeningResult | null }) {
  const metrics = result?.eligibility_metrics;
  if (!metrics) return null;

  const entries = METRIC_LABELS.map((meta) => ({ meta, metric: metrics[meta.key] }));
  const calculated = entries.filter((entry) => entry.metric?.status === 'CALCULATED').length;
  const notApplicable = entries.filter((entry) => entry.metric?.status === 'NOT_APPLICABLE').length;
  const missing = entries.filter((entry) => entry.metric?.status === 'INSUFFICIENT_DATA').length;

  return (
    <section className={`${SURFACE} p-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700"><Gauge className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Chỉ tiêu điều kiện mở tài khoản</h3>
            <p className="mt-0.5 text-[10px] text-slate-500">Tính bằng code từ evidence đã chấp nhận — cùng dữ liệu vào cho cùng kết quả</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Tính được" value={String(calculated)} />
          <MiniStat label="Không áp dụng" value={String(notApplicable)} />
          <MiniStat label="Thiếu dữ liệu" value={String(missing)} />
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ meta, metric }) => {
          const tone = metricTone(metric);
          const warnings = safeArray(metric?.warnings);
          return (
            <div key={meta.key} className={`rounded-xl border px-3 py-2.5 ${statusToneClass(tone)}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] opacity-80">{meta.label}</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{formatMetric(metric)}</p>
              <p className="mt-0.5 text-[10px] leading-4 opacity-80">{meta.caption}</p>
              {metric?.formula && (
                <p className="mt-1.5 border-t border-white/50 pt-1.5 font-mono text-[9px] leading-3 opacity-70">{metric.formula}</p>
              )}
              {warnings.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {warnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-1.5 text-[9px] leading-3">
                      <CircleAlert className="mt-px h-2.5 w-2.5 shrink-0" />
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
              {safeArray(metric?.evidence_ids).length > 0 && (
                <p className="mt-1.5 font-mono text-[9px] opacity-60">
                  {safeArray(metric?.evidence_ids).slice(0, 4).join(' · ')}
                  {safeArray(metric?.evidence_ids).length > 4 ? ` +${safeArray(metric?.evidence_ids).length - 4}` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Rà soát khách hàng (CDD) ─────────────────────────────────────────────────

function CddPanel({ result }: { result: AccountOpeningResult | null }) {
  const cdd = result?.cdd_assessment;
  if (!cdd) return null;
  const risk = riskMeta(cdd.risk_rating);
  const dueDiligence = dueDiligenceMeta(cdd.due_diligence_level);

  return (
    <section className={`${SURFACE} p-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><UserSearch className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Rà soát khách hàng (CDD)</h3>
            <p className="mt-0.5 text-[10px] text-slate-500">Năm yếu tố R1–R5 · mọi phát hiện đều phải dẫn chiếu evidence</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={assessmentLabel(cdd.overall_status)} tone={assessmentTone(cdd.overall_status)} />
          <StatusBadge label={risk.label} tone={risk.tone} />
          <StatusBadge label={dueDiligence.label} tone={dueDiligence.tone} />
        </div>
      </div>

      <div className="space-y-2.5">
        {cdd.factors.map((factor) => <CddFactorCard key={factor.code} factor={factor} />)}
      </div>

      {cdd.escalation_reasons.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">Lý do nâng mức rà soát</p>
          <ul className="mt-2 space-y-1">
            {cdd.escalation_reasons.map((reason) => (
              <li key={reason} className="text-[11px] leading-5 text-slate-800">{reasonLabel(reason)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CddFactorCard({ factor }: { factor: CddFactor }) {
  const [isOpen, setIsOpen] = useState(false);
  const notApplicable = factor.status === 'NOT_RUN';
  const tone: StatusTone = notApplicable ? 'neutral' : assessmentTone(factor.status);
  const risk = riskMeta(factor.risk_level);
  const findings = [...factor.strengths, ...factor.weaknesses];

  return (
    <div className={`overflow-hidden rounded-xl border ${notApplicable ? 'border-slate-200 bg-slate-50/60' : statusToneClass(tone)}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        disabled={findings.length === 0}
        className="flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left disabled:cursor-default"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700">{factor.code}</span>
            <p className="text-xs font-semibold text-slate-900">{factor.label}</p>
            <span className="font-mono text-[9px] uppercase opacity-70">{factor.name}</span>
          </div>
          <p className="mt-1 text-[10px] opacity-80">
            {notApplicable
              ? 'Không áp dụng cho phân khúc này'
              : `${assessmentLabel(factor.status)} · ${risk.label.toLowerCase()} · ${findings.length} phát hiện có căn cứ`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge label={notApplicable ? 'Không áp dụng' : assessmentLabel(factor.status)} tone={tone} />
          {findings.length > 0 && <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
        </div>
      </button>
      {isOpen && findings.length > 0 && (
        <div className="space-y-2 border-t border-white/60 bg-white/70 p-3.5">
          {factor.strengths.map((finding) => (
            <FindingRow key={finding.code} tone="success" icon={BadgeCheck} message={finding.message} evidenceIds={finding.evidence_ids} />
          ))}
          {factor.weaknesses.map((finding) => (
            <FindingRow
              key={finding.code}
              tone={finding.severity === 'ERROR' ? 'danger' : 'warning'}
              icon={CircleAlert}
              message={finding.message}
              evidenceIds={finding.evidence_ids}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FindingRow({ tone, icon: Icon, message, evidenceIds }: {
  tone: StatusTone;
  icon: React.ComponentType<{ className?: string }>;
  message: string;
  evidenceIds: string[];
}) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${statusToneClass(tone)}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] leading-5 text-slate-800">{message}</p>
          {evidenceIds.length > 0 && (
            <p className="mt-1 font-mono text-[9px] opacity-70">
              {evidenceIds.slice(0, 6).join(' · ')}{evidenceIds.length > 6 ? ` +${evidenceIds.length - 6}` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Policy & tuân thủ ────────────────────────────────────────────────────────

function PolicyPanel({ result }: { result: AccountOpeningResult | null }) {
  const policy = result?.policy_compliance;
  const [filter, setFilter] = useState<'all' | 'DETERMINISTIC' | 'PROMPT'>('all');
  const rules = useMemo(() => {
    const all = safeArray(policy?.rule_results);
    if (filter === 'all') return all;
    return all.filter((rule) => (rule.check_kind ?? 'DETERMINISTIC') === filter);
  }, [policy, filter]);

  if (!policy) return null;
  const engineCount = safeArray(policy.rule_results).filter((rule) => (rule.check_kind ?? 'DETERMINISTIC') === 'DETERMINISTIC').length;
  const promptCount = safeArray(policy.rule_results).filter((rule) => rule.check_kind === 'PROMPT').length;
  const passed = safeArray(policy.rule_results).filter((rule) => rule.result === 'PASS').length;

  return (
    <section className={`${SURFACE} p-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><ShieldCheck className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Policy &amp; tuân thủ theo phân khúc</h3>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {policy.policy_id} v{policy.policy_version} · {passed}/{policy.rule_results.length} rule đạt
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={assessmentLabel(policy.status)} tone={assessmentTone(policy.status)} />
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            {([
              { key: 'all', label: `Tất cả (${policy.rule_results.length})` },
              { key: 'DETERMINISTIC', label: `Rule engine (${engineCount})` },
              { key: 'PROMPT', label: `Rule LLM (${promptCount})` },
            ] as const).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                aria-pressed={filter === option.key}
                className={`px-2.5 py-1.5 text-[10px] font-semibold transition ${
                  filter === option.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {rules.map((rule) => <PolicyRuleCard key={rule.rule_id} rule={rule} />)}
      </div>

      {policy.exceptions.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">Rule không đạt nhưng cho phép ngoại lệ</p>
          <p className="mt-1.5 font-mono text-[11px] text-slate-800">{policy.exceptions.join(' · ')}</p>
        </div>
      )}
    </section>
  );
}

function PolicyRuleCard({ rule }: { rule: PolicyRuleResult }) {
  const [isOpen, setIsOpen] = useState(false);
  const meta = ruleResultMeta(rule.result);
  const isPrompt = rule.check_kind === 'PROMPT';
  const scope = rule.check_scope;

  return (
    <div className={`overflow-hidden rounded-xl border ${statusToneClass(meta.tone)}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
              isPrompt ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {isPrompt ? <Sparkles className="h-2.5 w-2.5" /> : <Code className="h-2.5 w-2.5" />}
              {isPrompt ? 'Rule LLM' : 'Rule engine'}
            </span>
            <p className="text-xs font-semibold text-slate-900">{rule.check_name ?? rule.rule_id}</p>
            <span className="font-mono text-[9px] opacity-60">v{rule.rule_version}</span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-700">{rule.message}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge label={meta.label} tone={meta.tone} />
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {isOpen && (
        <div className="space-y-2.5 border-t border-white/60 bg-white/70 p-3.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <DetailField label="Mã rule" value={rule.rule_id} />
            <DetailField label="Mã lý do" value={rule.reason_code} />
            {rule.expected !== undefined && rule.expected !== null && (
              <DetailField label="Kỳ vọng" value={typeof rule.expected === 'object' ? JSON.stringify(rule.expected) : String(rule.expected)} />
            )}
            {rule.actual !== undefined && rule.actual !== null && (
              <DetailField label="Thực tế" value={typeof rule.actual === 'object' ? JSON.stringify(rule.actual) : String(rule.actual)} />
            )}
            <DetailField label="Mức độ" value={rule.severity} />
            <DetailField label="Cho phép ngoại lệ" value={rule.exception_allowed ? 'Có' : 'Không'} />
            {isPrompt && (
              <>
                <DetailField label="Độ tin cậy" value={rule.confidence === null || rule.confidence === undefined ? '—' : `${Math.round(rule.confidence * 100)}%`} />
                <DetailField label="Ngưỡng tin cậy" value={rule.threshold === null || rule.threshold === undefined ? '—' : `${Math.round(rule.threshold * 100)}%`} />
              </>
            )}
          </div>
          {scope && (scope.segments.length > 0 || scope.products.length > 0) && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Phạm vi áp dụng</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {scope.segments.map((item) => (
                  <span key={`segment-${item}`} className="rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-mono text-[9px] text-cyan-800">{item}</span>
                ))}
                {scope.products.map((item) => (
                  <span key={`product-${item}`} className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-[9px] text-indigo-800">{item}</span>
                ))}
              </div>
            </div>
          )}
          {rule.evidence_ids.length > 0 && (
            <p className="font-mono text-[9px] text-slate-500">
              evidence: {rule.evidence_ids.slice(0, 8).join(' · ')}{rule.evidence_ids.length > 8 ? ` +${rule.evidence_ids.length - 8}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sàng lọc & snapshot cấu hình ─────────────────────────────────────────────

const SCREENING_LABELS: Record<string, string> = {
  AML: 'Phòng chống rửa tiền (AML)',
  PEP: 'Cá nhân có ảnh hưởng chính trị (PEP)',
  SANCTIONS: 'Danh sách cấm vận',
  ADVERSE_MEDIA: 'Thông tin bất lợi trên báo chí',
  CIF_DUPLICATE: 'Đối chiếu CIF trùng',
  BLACKLIST: 'Danh sách đen nội bộ',
};

function ScreeningPanel({ result }: { result: AccountOpeningResult | null }) {
  const screening = result?.screening;
  if (!screening) return null;
  const pending = screening.status !== 'COMPLETED';

  return (
    <section className={`${SURFACE} p-5`}>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Route className="h-4 w-4" /></div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Sàng lọc danh sách cảnh báo</h3>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {pending ? 'Chưa cấu hình provider — không sinh kết quả sạch giả' : `Provider ${screening.provider_id ?? '—'}`}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {screening.checks.map((check) => (
          <div key={check.check} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-800">{SCREENING_LABELS[check.check] ?? check.check}</p>
              {check.subject && <p className="mt-0.5 truncate text-[10px] text-slate-500" title={check.subject}>Đối tượng: {check.subject}</p>}
            </div>
            <StatusBadge
              label={check.status === 'NOT_RUN' ? 'Chưa chạy' : check.status === 'PASS' ? 'Đạt' : 'Không đạt'}
              tone={check.status === 'NOT_RUN' ? 'neutral' : check.status === 'PASS' ? 'success' : 'danger'}
            />
          </div>
        ))}
      </div>
      {pending && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-800">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Vì sàng lọc chưa chạy, không hồ sơ nào được xử lý tự động — mọi hồ sơ đều phải qua rà soát.
        </p>
      )}
    </section>
  );
}

function ConfigSnapshotPanel({ result }: { result: AccountOpeningResult | null }) {
  const snapshot = result?.config_snapshot;
  if (!snapshot) return null;
  const thresholds = snapshot.thresholds;

  return (
    <section className={`${SURFACE} p-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><ShieldCheck className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Ngưỡng thực dùng của lần chạy</h3>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {snapshot.policy_id} v{snapshot.policy_version} · {snapshot.product_code}
            </p>
          </div>
        </div>
        <StatusBadge
          label={snapshot.threshold_source === 'PROFILE' ? 'Ngưỡng từ Profile' : 'Ngưỡng mặc định'}
          tone={snapshot.threshold_source === 'PROFILE' ? 'info' : 'neutral'}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <DetailField label="Tuổi tối thiểu" value={`${thresholds.minimum_age_years} tuổi`} />
        <DetailField label="Hiệu lực giấy tờ tối thiểu" value={`${thresholds.minimum_id_validity_days} ngày`} />
        <DetailField label="Ngưỡng kê khai chủ sở hữu" value={thresholds.beneficial_owner_threshold_percent > 0 ? `từ ${thresholds.beneficial_owner_threshold_percent}%` : 'Không áp dụng'} />
        <DetailField label="Độ phủ sở hữu yêu cầu" value={thresholds.minimum_beneficial_owner_coverage_percent > 0 ? `${thresholds.minimum_beneficial_owner_coverage_percent}%` : 'Không áp dụng'} />
        <DetailField label="Số người ký tối thiểu" value={String(thresholds.minimum_authorized_signatories)} />
        <DetailField label="Rủi ro nền phân khúc" value={riskMeta(snapshot.baseline_risk_level).label} />
        <DetailField label="Trần rủi ro không cần EDD" value={riskMeta(snapshot.maximum_risk_without_edd).label} />
      </div>
      {snapshot.check_set && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Bộ kiểm tra đã áp dụng</p>
          <p className="mt-1 text-[11px] text-slate-700">
            {snapshot.check_set.program} v{snapshot.check_set.version} ·{' '}
            {snapshot.check_set.source === 'PROFILE' ? 'cấu hình từ Profile' : 'mặc định trong code'} ·{' '}
            {snapshot.check_set.deterministic_count} rule engine · {snapshot.check_set.prompt_count} rule LLM
          </p>
        </div>
      )}
    </section>
  );
}
