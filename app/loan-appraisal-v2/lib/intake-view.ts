// Hiển thị 4 tiêu chí tiếp nhận (D-47, D-50). Hàm thuần — component chỉ render.
import type { IntakeAssessment, IntakeCriterion } from '@/lib/pipelines/workflows/loan-appraisal/intake-assessment';

import type { ToneName } from './dossier-view';

export const CRITERION_STATUS_LABELS: Record<IntakeCriterion['status'], string> = {
  PASS: 'Đạt', FAIL: 'Chưa đạt', NEEDS_EXPLANATION: 'Cần kiểm tra', ACCEPTED: 'Đã giải trình', NOT_APPLICABLE: 'Chưa áp dụng',
};

export function criterionTone(status: IntakeCriterion['status']): ToneName {
  return status === 'PASS' || status === 'ACCEPTED' ? 'success' : status === 'FAIL' ? 'warning' : status === 'NEEDS_EXPLANATION' ? 'warning' : 'neutral';
}

export interface LineGroup<T> { group: string | null; lines: T[] }

/** Gom theo nhóm, giữ thứ tự xuất hiện (thứ tự checklist). */
function byGroup<T extends { group: string | null }>(xs: ReadonlyArray<T>): Array<LineGroup<T>> {
  const out = new Map<string, LineGroup<T>>();
  for (const x of xs) {
    const k = x.group ?? '';
    const g = out.get(k) ?? { group: x.group, lines: [] };
    g.lines.push(x);
    out.set(k, g);
  }
  return [...out.values()];
}

export interface CriterionView {
  key: string;
  title: string;
  goal: string;
  status_label: string;
  tone: ToneName;
  summary: string;
  /** Chưa đạt / cần kiểm tra — đầy đủ, gom theo nhóm checklist. */
  findings: Array<LineGroup<{ code: string; text: string; accepted: boolean; group: string | null }>>;
  /** Đã đạt — gom theo nhóm checklist. */
  passed: Array<LineGroup<{ code: string; text: string; group: string | null }>>;
  findings_count: number;
  passed_count: number;
}

export interface SummaryView {
  overview: string;
  highlights: string[];
  next_actions: string[];
  source: 'LLM' | 'RULES';
  source_label: string;
  /** Cảnh báo khi một phần không dùng được kết quả LLM; null khi bình thường. */
  warning: string | null;
}

/** Tổng kết tóm tắt hồ sơ (D-59); null khi kết quả cũ chưa có. */
export function summaryView(a: IntakeAssessment): SummaryView | null {
  const s = a.dossier_summary;
  if (!s) return null;
  return {
    overview: s.overview,
    highlights: s.highlights ?? [],
    next_actions: s.next_actions ?? [],
    source: s.source,
    source_label: s.source === 'LLM' ? 'AI tổng hợp' : 'Theo quy tắc',
    warning: a.review?.warning ?? null,
  };
}

export function criterionViews(a: IntakeAssessment): CriterionView[] {
  return a.criteria.map((c) => {
    const findings = c.findings.map((f) => ({
      code: f.code,
      group: f.group ?? null,
      text: f.status === 'ACCEPTED' ? `${f.message} — đã giải trình: ${f.acknowledgement_reason}` : f.message,
      accepted: f.status === 'ACCEPTED',
    }));
    const passed = (c.passed ?? []).map((p) => ({ code: p.code, group: p.group, text: p.message }));
    return {
      key: c.key,
      title: `${c.no}. ${c.label}`,
      goal: c.goal,
      status_label: CRITERION_STATUS_LABELS[c.status],
      tone: criterionTone(c.status),
      summary: c.summary,
      findings: byGroup(findings),
      passed: byGroup(passed),
      findings_count: findings.length,
      passed_count: passed.length,
    };
  });
}
