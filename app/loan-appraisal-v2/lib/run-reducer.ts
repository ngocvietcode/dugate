// Máy trạng thái hữu hạn cho một lần chạy thẩm định. Reducer thuần, không I/O.

import type {
  AppraisalResult,
  BackendWorkflowStep,
  DossierEvidence,
  DossierFile,
  LoanStageKey,
} from '@/app/loan-appraisal/types';
import type { DossierPrecheck } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';
import { areDossierChecksDisabled, isDeferredToPhase2 } from './selectors';
import { LEGACY_STAGE_KEYS, STAGES, completedStageCount, initialStages, isStageKey, type StageMap } from './stages';
import type { OperationUsage } from './usage';

export type RunPhase =
  | 'idle' | 'submitting' | 'running' | 'cancelling' | 'stalled' | 'paused' | 'resuming' | 'succeeded' | 'failed' | 'cancelled';

export type RunErrorKind = 'submit' | 'workflow' | 'network' | 'invalid-op' | 'not-found' | 'forbidden';

export interface RunError {
  message: string;
  stage: LoanStageKey | null;
  kind: RunErrorKind;
}

export interface RunState {
  phase: RunPhase;
  operationId: string | null;
  stages: StageMap;
  progressPercent: number;
  progressMessage: string;
  progressLog: string[];
  /** S1: file của checkpoint bước 0 (hiện sớm khi đang chạy). */
  classification: DossierFile[] | null;
  /** S2: EvidenceEnvelope của checkpoint bước 1. */
  extraction: DossierEvidence[] | null;
  /** D-73: kiểm tra sơ bộ bằng LLM của checkpoint bước 0 (hiện sớm khi S2–S5 còn chạy). */
  precheck: DossierPrecheck | null;
  result: AppraisalResult | null;
  usage: OperationUsage | null;
  error: RunError | null;
  softTimeout: boolean;
  cancelPollsLeft: number;
  needsApiKey: boolean;
}

export const CANCEL_POLL_BUDGET = 3;
export const MAX_LOG_LINES = 80;

export type RunAction =
  | { type: 'SUBMIT_START'; fileCount?: number }
  | { type: 'SUBMITTED'; operationId: string }
  | { type: 'ATTACH_START'; operationId: string }
  | { type: 'REVEAL'; stageKey: string; step: BackendWorkflowStep }
  | { type: 'PRECHECK'; precheck: DossierPrecheck }
  | { type: 'PROGRESS'; stage: LoanStageKey | null; percent: number; message?: string; at?: string }
  | { type: 'POLL_TICK' }
  | { type: 'SUCCEEDED'; result: AppraisalResult | null; usage: OperationUsage | null }
  /** D-51: workflow dừng sau giai đoạn 1 (WAITING_USER_INPUT) kèm kết quả tiếp nhận. */
  | { type: 'PAUSED'; result: AppraisalResult | null; message?: string }
  | { type: 'RESUME_START' }
  | { type: 'RESUMED' }
  | { type: 'RESUME_FAILED'; message: string }
  | { type: 'FAILED'; kind: RunErrorKind; message: string; stage: LoanStageKey | null; usage?: OperationUsage | null }
  | { type: 'CANCELLED' }
  | { type: 'CANCEL_REQUESTED' }
  | { type: 'CANCEL_FAILED' }
  | { type: 'SOFT_TIMEOUT' }
  | { type: 'STALLED' }
  | { type: 'RESET' };

export function initialRunState(): RunState {
  return {
    phase: 'idle',
    operationId: null,
    stages: initialStages(),
    progressPercent: 0,
    progressMessage: '',
    progressLog: [],
    classification: null,
    extraction: null,
    precheck: null,
    result: null,
    usage: null,
    error: null,
    softTimeout: false,
    cancelPollsLeft: 0,
    needsApiKey: false,
  };
}

export function isBusyPhase(phase: RunPhase): boolean {
  return phase === 'submitting' || phase === 'running' || phase === 'cancelling' || phase === 'resuming';
}

export function isTerminalPhase(phase: RunPhase): boolean {
  return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled';
}

const CAN_START: ReadonlyArray<RunPhase> = ['idle', 'succeeded', 'failed', 'cancelled', 'stalled', 'paused'];

/**
 * Số bước hiển thị của giai đoạn 1: `classify` và `dossier_precheck`. D-90, D-91: `extract_evidence` (S2) và `consolidate_dossier` (S3–S5)
 * thuộc giai đoạn 2. Operation cũ dừng sau khi đã chạy S2–S5 (không có DEFERRED_TO_PHASE_2) vẫn tính 4 bước xong (kể cả kiểm tra sơ bộ), xem `intakeStageCount`.
 */
export const INTAKE_STAGE_COUNT = 2;
/** classify, kiểm tra sơ bộ, OCR đã xong (operation cũ dừng sau S2–S5; bước hợp nhất đã gỡ khỏi danh sách stage nên chỉ còn 3). */
const LEGACY_INTAKE_STAGE_COUNT = 3;

function intakeStageCount(result: AppraisalResult | null | undefined): number {
  // Chỉ operation CŨ đã chạy S2–S5 ở giai đoạn 1 mới có checklist thật. Giai đoạn 1 mới (DEFERRED_TO_PHASE_2) và kết quả mới (DOSSIER_CHECKS_DISABLED) thì không.
  return result && !isDeferredToPhase2(result) && !areDossierChecksDisabled(result) && result.checklist ? LEGACY_INTAKE_STAGE_COUNT : INTAKE_STAGE_COUNT;
}

function revealStage(stages: StageMap, stageKey: string, failed: boolean): StageMap {
  if (!isStageKey(stageKey)) return stages;
  const next = { ...stages };
  next[stageKey] = failed ? 'error' : 'done';
  const index = LEGACY_STAGE_KEYS.indexOf(stageKey);
  const following = LEGACY_STAGE_KEYS[index + 1];
  if (following && next[following] === 'pending') next[following] = 'running';
  return next;
}

export function runReducer(state: RunState, action: RunAction): RunState {
  const { phase } = state;
  switch (action.type) {
    case 'RESET':
      return initialRunState();

    case 'SUBMIT_START':
      if (!CAN_START.includes(phase)) return state;
      return {
        ...initialRunState(),
        phase: 'submitting',
        progressPercent: 5,
        // Trước khi máy chủ nhận xong hồ sơ thì chưa có operation nào chạy; nói rõ đang tải lên thay vì "đang khởi tạo workflow".
        progressMessage: action.fileCount ? `Đang tải ${action.fileCount} tài liệu lên máy chủ…` : 'Đang tải tài liệu lên máy chủ…',
        stages: { ...initialStages(), classify: 'running' },
      };

    case 'SUBMITTED':
      if (phase !== 'submitting') return state;
      return { ...state, phase: 'running', operationId: action.operationId, progressMessage: 'Đã nhận hồ sơ, đang phân loại chứng từ…' };

    case 'ATTACH_START':
      if (!CAN_START.includes(phase)) return state;
      return { ...initialRunState(), phase: 'running', operationId: action.operationId, progressPercent: 5 };

    case 'REVEAL': {
      if (phase !== 'running' && phase !== 'cancelling') return state;
      const data = action.step.extracted_data;
      const next: RunState = { ...state };
      const obj = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
      // Checkpoint spec-v3: bước 0 = { files, … }, bước 1 = { evidences, … } (V2-R03). Kết quả cuối chỉ có khi workflow xong.
      if (action.stageKey === 'classify' && obj && Array.isArray(obj.files)) next.classification = obj.files as DossierFile[];
      if (action.stageKey === 'extract_evidence' && obj && Array.isArray(obj.evidences)) next.extraction = obj.evidences as DossierEvidence[];
      next.stages = revealStage(state.stages, action.stageKey, action.step.status === 'FAILED');
      // Operation cũ / kiểm tra sơ bộ không phát action riêng: bước sau classify đã lộ ra thì kiểm tra sơ bộ chắc chắn đã xong.
      if (action.stageKey !== 'classify' && next.stages.dossier_precheck !== 'done') next.stages = { ...next.stages, dossier_precheck: 'done' };
      return next;
    }

    case 'PRECHECK': {
      if (phase !== 'running' && phase !== 'cancelling') return state;
      // Kết quả về = bước kiểm tra sơ bộ đã kết thúc (kể cả UNAVAILABLE/SKIPPED). KHÔNG bật bước kế tiếp: giai đoạn 1 dừng ngay tại đây,
      // còn khi chạy một lần thì PROGRESS/REVEAL kế tiếp sẽ đặt OCR chạy.
      return { ...state, precheck: action.precheck, stages: { ...state.stages, dossier_precheck: 'done' } };
    }

    case 'PROGRESS': {
      if (phase !== 'running' && phase !== 'cancelling') return state;
      const stages = action.stage && state.stages[action.stage] === 'pending'
        ? { ...state.stages, [action.stage]: 'running' as const }
        : state.stages;
      let progressLog = state.progressLog;
      let progressMessage = state.progressMessage;
      if (action.message && action.message !== progressMessage) {
        progressMessage = action.message;
        progressLog = [...progressLog, action.at ? `[${action.at}] ${action.message}` : action.message].slice(-MAX_LOG_LINES);
      }
      return { ...state, stages, progressPercent: action.percent, progressMessage, progressLog };
    }

    case 'POLL_TICK': {
      if (phase !== 'cancelling') return state;
      const left = state.cancelPollsLeft - 1;
      // Hết ngân sách poll mà chưa thấy CANCELLED: quay lại theo dõi bình thường.
      if (left <= 0) return { ...state, phase: 'running', cancelPollsLeft: 0 };
      return { ...state, cancelPollsLeft: left };
    }

    case 'SUCCEEDED': {
      if (phase !== 'running' && phase !== 'cancelling') return state;
      const isV2 = action.result?.output_version === '3.0';
      // Kết quả V1 cũ: chỉ các bước giai đoạn 1 cũ (classify, kiểm tra sơ bộ, OCR, hợp nhất) và bước đã done được coi là hoàn tất.
      const stages = { ...state.stages };
      STAGES.forEach((stage, index) => {
        stages[stage.id] = isV2 || index < LEGACY_INTAKE_STAGE_COUNT || state.stages[stage.id] === 'done' ? 'done' : 'pending';
      });
      const percent = isV2
        ? 100
        : Math.round((completedStageCount(stages) / STAGES.length) * 100);
      return {
        ...state,
        phase: 'succeeded',
        stages,
        result: action.result ?? state.result,
        usage: action.usage,
        progressPercent: percent,
        cancelPollsLeft: 0,
        error: null,
        softTimeout: false,
      };
    }

    case 'FAILED': {
      // 'invalid-op' xảy ra trước khi có phiên chạy nên được phép từ idle.
      if (!isBusyPhase(phase) && !(phase === 'idle' && action.kind === 'invalid-op')) return state;
      const stages = action.stage ? { ...state.stages, [action.stage]: 'error' as const } : state.stages;
      return {
        ...state,
        phase: 'failed',
        stages,
        error: { message: action.message, stage: action.stage, kind: action.kind },
        usage: action.usage ?? state.usage,
        needsApiKey: action.kind === 'forbidden',
        cancelPollsLeft: 0,
        softTimeout: false,
      };
    }

    case 'PAUSED': {
      if (phase !== 'running' && phase !== 'cancelling') return state;
      const stages = { ...state.stages };
      const doneCount = intakeStageCount(action.result ?? state.result);
      STAGES.forEach((stage, index) => { stages[stage.id] = index < doneCount ? 'done' : 'pending'; });
      const progressLog = action.message && action.message !== state.progressMessage
        ? [...state.progressLog, action.message].slice(-MAX_LOG_LINES) : state.progressLog;
      return {
        ...state, phase: 'paused', stages, result: action.result ?? state.result,
        progressPercent: Math.round((doneCount / STAGES.length) * 100),
        progressMessage: action.message ?? state.progressMessage, progressLog, cancelPollsLeft: 0, softTimeout: false, error: null,
      };
    }

    case 'RESUME_START':
      if (phase !== 'paused') return state;
      return { ...state, phase: 'resuming' };

    case 'RESUMED': {
      if (phase !== 'resuming') return state;
      const next = STAGES.find((stage) => state.stages[stage.id] !== 'done')?.id;
      return { ...state, phase: 'running', stages: next ? { ...state.stages, [next]: 'running' as const } : state.stages };
    }

    case 'RESUME_FAILED':
      if (phase !== 'resuming') return state;
      return { ...state, phase: 'paused', progressLog: [...state.progressLog, action.message].slice(-MAX_LOG_LINES) };

    case 'CANCELLED':
      if (phase !== 'running' && phase !== 'cancelling') return state;
      // Không áp result, không đặt 38%, không đánh dấu stage done thêm.
      return { ...state, phase: 'cancelled', cancelPollsLeft: 0, softTimeout: false, usage: null };

    case 'CANCEL_REQUESTED':
      if (phase !== 'running') return state;
      return { ...state, phase: 'cancelling', cancelPollsLeft: CANCEL_POLL_BUDGET };

    case 'CANCEL_FAILED':
      if (phase !== 'cancelling') return state;
      return { ...state, phase: 'running', cancelPollsLeft: 0 };

    case 'SOFT_TIMEOUT':
      if (phase !== 'running' && phase !== 'cancelling') return state;
      return { ...state, softTimeout: true };

    case 'STALLED':
      if (phase !== 'running') return state;
      return { ...state, phase: 'stalled', error: null, softTimeout: true };

    default:
      return state;
  }
}
