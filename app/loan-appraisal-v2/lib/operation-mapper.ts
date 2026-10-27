// Chuyển một lần đọc operation (opData) thành danh sách RunAction. Thuần, test bằng fixture JSON.

import type { AppraisalResult, BackendWorkflowStep, LoanStageKey } from '@/app/loan-appraisal/types';
import type { DossierPrecheck } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';
import type { ApiErrorKind } from './api';
import type { RunAction, RunErrorKind } from './run-reducer';
import { BACKEND_STAGE_KEYS, stageKeyOf } from './stages';
import { parseUsage } from './usage';

export type OperationOutcome = 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
export type ApiContext = 'submit' | 'poll' | 'attach' | 'cancel';

export interface AppliedOperation {
  actions: RunAction[];
  outcome: OperationOutcome;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stageAt(index: unknown): LoanStageKey | null {
  const n = Number(index);
  return Number.isInteger(n) && n >= 0 ? BACKEND_STAGE_KEYS[n] ?? null : null;
}

/** Checkpoint của stage classify (chứa kết quả phân loại và, sau khi chạy xong, kiểm tra sơ bộ). */
function classifyCheckpoint(steps: BackendWorkflowStep[]): Record<string, unknown> | null {
  const step = steps.find((s) => s && s.processor !== 'webhook' && s.stage_key === 'classify');
  return step ? asRecord(step.extracted_data) : null;
}

/**
 * Stage đang chạy theo chỉ số backend. Kiểm tra sơ bộ không có chỉ số riêng: backend đặt current_step = 1 ngay khi S1 xong,
 * trong lúc LLM kiểm tra sơ bộ còn chạy. Đã có checkpoint phân loại mà chưa có precheck thì bước đang chạy là kiểm tra sơ bộ, không phải OCR.
 */
function currentStageOf(index: unknown, steps: BackendWorkflowStep[]): LoanStageKey | null {
  const checkpoint = classifyCheckpoint(steps);
  if (Number(index) === 1 && checkpoint && !('precheck' in checkpoint)) return 'dossier_precheck';
  return stageAt(index);
}

export function toRunErrorKind(kind: ApiErrorKind, context: ApiContext): RunErrorKind {
  switch (kind) {
    case 'forbidden': return 'forbidden';
    case 'not-found': return 'not-found';
    case 'network': return 'network';
    case 'invalid-json': return context === 'submit' ? 'submit' : 'network';
    case 'http': return context === 'submit' ? 'submit' : 'network';
    default: return 'network';
  }
}

/**
 * Áp một lần đọc operation. `revealed` được cập nhật tại chỗ để mỗi stage chỉ reveal một lần.
 * Thứ tự kiểm tra: FAILED, CANCELLED, done, đang chạy.
 */
export function applyOperation(
  opData: unknown,
  revealed: Set<string>,
  now: () => string = () => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
): AppliedOperation {
  const op = asRecord(opData);
  const metadata = asRecord(op.metadata);
  const result = asRecord(op.result);
  const actions: RunAction[] = [];

  const rawSteps: BackendWorkflowStep[] = Array.isArray(metadata.pipeline_steps)
    ? metadata.pipeline_steps as BackendWorkflowStep[]
    : Array.isArray(result.pipeline_steps) ? result.pipeline_steps as BackendWorkflowStep[] : [];
  rawSteps
    .filter((step) => step && step.processor !== 'webhook')
    .forEach((step, index) => {
      const stageKey = stageKeyOf(step, index);
      if (revealed.has(stageKey)) return;
      revealed.add(stageKey);
      actions.push({ type: 'REVEAL', stageKey, step });
    });

  // D-73: kiểm tra sơ bộ được ghi vào checkpoint bước 0 SAU khi stage classify đã reveal, nên phát action riêng (một lần).
  if (!revealed.has('precheck')) {
    for (const step of rawSteps) {
      if (!step || step.processor === 'webhook' || step.stage_key !== 'classify') continue;
      const precheck = asRecord(step.extracted_data).precheck;
      if (precheck && typeof precheck === 'object' && !Array.isArray(precheck) && 'checklist' in precheck) {
        revealed.add('precheck');
        actions.push({ type: 'PRECHECK', precheck: precheck as DossierPrecheck });
        break;
      }
    }
  }

  const state = typeof metadata.state === 'string' ? metadata.state : undefined;
  const currentStep = Number(metadata.current_step ?? 0);
  const currentStage = currentStageOf(currentStep, rawSteps);

  if (state === 'FAILED') {
    const error = asRecord(op.error);
    actions.push({
      type: 'FAILED',
      kind: 'workflow',
      message: typeof error.message === 'string' && error.message ? error.message : 'Workflow failed',
      stage: stageAt(error.failed_step ?? currentStep) ?? currentStage ?? 'classify',
      usage: parseUsage(op),
    });
    return { actions, outcome: 'failed' };
  }

  if (state === 'CANCELLED') {
    actions.push({ type: 'CANCELLED' });
    return { actions, outcome: 'cancelled' };
  }

  // D-51: dừng sau giai đoạn 1 — kết quả tiếp nhận ở result.extracted_data, chờ người dùng chuyển giai đoạn 2.
  if (state === 'WAITING_USER_INPUT') {
    const extracted = result.extracted_data;
    const intake = extracted && typeof extracted === 'object' && !Array.isArray(extracted) ? extracted as AppraisalResult : null;
    actions.push({ type: 'PAUSED', result: intake, message: typeof metadata.progress_message === 'string' ? metadata.progress_message : undefined });
    return { actions, outcome: 'paused' };
  }

  if (op.done === true) {
    const extracted = result.extracted_data || metadata.extracted_data;
    const appraisal = extracted && typeof extracted === 'object' && !Array.isArray(extracted)
      ? extracted as AppraisalResult
      : null;
    actions.push({ type: 'SUCCEEDED', result: appraisal, usage: parseUsage(op) });
    return { actions, outcome: 'done' };
  }

  const progress = typeof metadata.progress_percent === 'number' ? metadata.progress_percent : 0;
  const message = typeof metadata.progress_message === 'string' && metadata.progress_message
    ? metadata.progress_message
    : undefined;
  actions.push({
    type: 'PROGRESS',
    stage: currentStage,
    percent: Math.max(5, progress),
    message,
    at: message ? now() : undefined,
  });
  return { actions, outcome: 'running' };
}
