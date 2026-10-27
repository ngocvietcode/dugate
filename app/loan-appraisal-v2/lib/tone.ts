// Ánh xạ duy nhất enum -> tone. Component không tự rải class màu.

import type {
  ChecklistItemResult,
  CrossCheckFinding,
  CrossCheckResult,
  IntakeFileStatus,
  PolicyRuleResult,
} from '@/app/loan-appraisal/types';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function factorTone(status: string | undefined): Tone {
  if (status === 'PASS') return 'success';
  if (status === 'FAIL') return 'warning';
  if (status === 'PASS_WITH_CONDITIONS' || status === 'REVIEW') return 'warning';
  return 'neutral';
}

export function ruleTone(result: PolicyRuleResult['result'] | undefined): Tone {
  if (result === 'PASS') return 'success';
  if (result === 'FAIL') return 'warning';
  if (result === 'REVIEW' || result === 'INSUFFICIENT_DATA') return 'warning';
  return 'neutral';
}

export function checklistTone(status: ChecklistItemResult['status'] | undefined): Tone {
  if (status === 'present') return 'success';
  if (status === 'missing') return 'warning';
  if (status === 'review') return 'warning';
  return 'neutral';
}

export function severityTone(severity: CrossCheckFinding['severity'] | undefined): Tone {
  if (severity === 'error') return 'warning';
  if (severity === 'warning') return 'warning';
  return 'info';
}

export function crossCheckTone(result: CrossCheckResult | undefined): Tone {
  if (result === 'MATCH') return 'success';
  if (result === 'MISMATCH') return 'warning';
  return 'neutral';
}

export function intakeStatusTone(status: IntakeFileStatus | undefined): Tone {
  if (status === 'SUFFICIENT') return 'success';
  if (status === 'NEEDS_REVIEW') return 'warning';
  if (status === 'UNRECOGNIZED' || status === 'MISSING') return 'warning';
  return 'neutral';
}

export function processingTone(status: string | undefined): Tone {
  if (status === 'COMPLETE') return 'success';
  if (status === 'BLOCKED') return 'warning';
  return 'warning';
}
