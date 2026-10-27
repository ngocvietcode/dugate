// lib/brd/types.ts
// Kiểu dữ liệu cho 2 phần đánh giá BRD:
//   Phần 1 — Prioritization Scorecard (BV/TE/Reuse/Bonus → Final Score, Priority).
//   Phần 2 — Đánh giá chi tiết BRD theo 32 tiêu chí (Đầy đủ – Rõ ràng – Chi tiết).

import type { CriterionKey } from './scorecard.config';

// ─── Phần 1: Prioritization Scorecard ────────────────────────────────────────

export interface CriterionScore {
  score: number; // 1–5
  rationale: string;
}

export type CriteriaScores = Record<CriterionKey, CriterionScore>;

export interface WeightedContribution {
  key: CriterionKey;
  label: string;
  rawScore: number;
  effectiveScore: number;
  weight: number;
  contribution: number;
}

export interface ScoreResult {
  contributions: WeightedContribution[];
  weightedSum: number;
  bonus: number;
  finalScore: number; // 2.0 – 10.0
  priority: 'High' | 'Medium' | 'Low';
  action: string;
  color: string;
}

/** Kết quả Phần 1 (kèm điểm thô từng tiêu chí để hiển thị). */
export interface ScorecardResult extends ScoreResult {
  criteria: CriteriaScores;
}

// ─── Phần 2: Đánh giá chi tiết 32 tiêu chí ───────────────────────────────────

/** ✓ đạt / ? đạt một phần / ✗ không có. */
export type QuestionStatus = '✓' | '?' | '✗';

/** Kết quả thô do AI trả về cho 1 câu hỏi. */
export interface RawQuestionEval {
  stt: number;
  status: QuestionStatus;
  score: number; // 0 | 0.25 | 0.5 | 0.75 | 1
  basis?: string;
  recommendation?: string;
}

export interface QuestionEval {
  stt: number;
  group: string;
  question: string;
  weight: number;
  status: QuestionStatus;
  score: number;
  weightedScore: number;
  basis: string;
  recommendation: string;
}

export interface GroupSummary {
  group: string;
  score: number;
  max: number;
}

export interface BrdEvalResult {
  questions: QuestionEval[];
  groups: GroupSummary[];
  totalScore: number;
  maxScore: number; // 50
  percent: number;
  passed: boolean; // >= 85%
  overallAssessment: string;
  recommendations: string;
}

// ─── Kết quả tổng hợp ─────────────────────────────────────────────────────────

export interface BrdResult {
  scorecard: ScorecardResult; // Phần 1
  evaluation: BrdEvalResult; // Phần 2
}
