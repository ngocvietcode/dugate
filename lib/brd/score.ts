// lib/brd/score.ts
// Rule engine thuần (không I/O) cho cả 2 phần. Dễ unit test & audit.

import {
  SCORECARD_CONFIG,
  type ScorecardConfig,
  type CriterionKey,
} from './scorecard.config';
import {
  BRD_CRITERIA,
  MAX_SCORE,
  PASS_PERCENT,
  ALLOWED_SCORES,
  GROUP_ORDER,
} from './criteria';
import type {
  CriteriaScores,
  ScoreResult,
  ScorecardResult,
  WeightedContribution,
  RawQuestionEval,
  QuestionEval,
  QuestionStatus,
  GroupSummary,
  BrdEvalResult,
} from './types';

// ─── Tiện ích ────────────────────────────────────────────────────────────────

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Giới hạn về [1,5] và làm tròn nguyên (cho Prioritization Scorecard). */
export function clampScore(value: number): number {
  if (Number.isNaN(value)) return 1;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 5) return 5;
  return rounded;
}

/** Ép về mức hợp lệ {0,0.25,0.5,0.75,1} (cho đánh giá 32 tiêu chí). */
export function snapScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let best = ALLOWED_SCORES[0] as number;
  let bestDiff = Infinity;
  for (const s of ALLOWED_SCORES) {
    const d = Math.abs(value - s);
    if (d < bestDiff) {
      bestDiff = d;
      best = s;
    }
  }
  return best;
}

// ─── Phần 1: Prioritization Scorecard ────────────────────────────────────────

export function computeFinalScore(
  scores: CriteriaScores,
  config: ScorecardConfig = SCORECARD_CONFIG,
): ScoreResult {
  const weightedKeys: CriterionKey[] = ['businessValue', 'technicalEffort', 'reusability'];

  const contributions: WeightedContribution[] = weightedKeys.map((key) => {
    const cfg = config.criteria[key];
    const rawScore = clampScore(scores[key]?.score ?? 1);
    const effectiveScore =
      key === 'technicalEffort' && config.technicalEffortInverse ? 6 - rawScore : rawScore;
    const contribution = round2(effectiveScore * cfg.weight);
    return { key, label: cfg.label, rawScore, effectiveScore, weight: cfg.weight, contribution };
  });

  const weightedSum = round2(contributions.reduce((s, c) => s + c.contribution, 0));
  const bonus = clampScore(scores.bonus?.score ?? 1);
  const finalScore = round2(weightedSum + bonus);
  const { priority, action, color } = classifyPriority(finalScore, config);

  return { contributions, weightedSum, bonus, finalScore, priority, action, color };
}

export function classifyPriority(
  finalScore: number,
  config: ScorecardConfig = SCORECARD_CONFIG,
): { priority: 'High' | 'Medium' | 'Low'; action: string; color: string } {
  const sorted = [...config.thresholds].sort((a, b) => b.min - a.min);
  const match = sorted.find((t) => finalScore >= t.min) ?? sorted[sorted.length - 1];
  return { priority: match.priority, action: match.action, color: match.color };
}

/** Wrap computeFinalScore + giữ lại điểm thô từng tiêu chí để hiển thị. */
export function computeScorecard(
  criteria: CriteriaScores,
  config: ScorecardConfig = SCORECARD_CONFIG,
): ScorecardResult {
  return { ...computeFinalScore(criteria, config), criteria };
}

// ─── Phần 2: Đánh giá 32 tiêu chí ────────────────────────────────────────────

function statusFromScore(score: number): QuestionStatus {
  if (score >= 1) return '✓';
  if (score <= 0) return '✗';
  return '?';
}

function normalizeStatus(raw: unknown, score: number): QuestionStatus {
  if (raw === '✓' || raw === '?' || raw === '✗') return raw;
  return statusFromScore(score);
}

export function computeEvaluation(
  rawQuestions: RawQuestionEval[],
  overallAssessment = '',
  recommendations = '',
): BrdEvalResult {
  const byStt = new Map<number, RawQuestionEval>();
  for (const r of rawQuestions ?? []) {
    if (r && typeof r.stt === 'number') byStt.set(r.stt, r);
  }

  const questions: QuestionEval[] = BRD_CRITERIA.map((c) => {
    const raw = byStt.get(c.stt);
    const score = snapScore(Number(raw?.score ?? 0));
    const status = normalizeStatus(raw?.status, score);
    return {
      stt: c.stt,
      group: c.group,
      question: c.question,
      weight: c.weight,
      status,
      score,
      weightedScore: round2(score * c.weight),
      basis: typeof raw?.basis === 'string' ? raw.basis : '',
      recommendation: typeof raw?.recommendation === 'string' ? raw.recommendation : '',
    };
  });

  const groups: GroupSummary[] = GROUP_ORDER.map((group) => {
    const items = questions.filter((q) => q.group === group);
    return {
      group,
      score: round2(items.reduce((s, q) => s + q.weightedScore, 0)),
      max: items.reduce((s, q) => s + q.weight, 0),
    };
  }).filter((g) => g.max > 0);

  const totalScore = round2(questions.reduce((s, q) => s + q.weightedScore, 0));
  const percent = round2((totalScore / MAX_SCORE) * 100);
  const passed = percent >= PASS_PERCENT;

  return { questions, groups, totalScore, maxScore: MAX_SCORE, percent, passed, overallAssessment, recommendations };
}
