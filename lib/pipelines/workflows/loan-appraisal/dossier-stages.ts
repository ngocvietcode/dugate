// Stage 0 (S1) và stage 1 (S2) của workflow v2 chạy engine spec-v3 (T-V2-01, T-V2-02; V2-R03).
//
// Checkpoint của bước = `data` của stage spec + `stage_status`/`status_code`/`message` gốc. Stage 0 lưu thêm
// `file_refs` (`file_id` → đường dẫn storage) để stage 1 — kể cả khi resume — đọc lại đúng file.
//
// CẦU NỐI TẠM (tới T-V2-03/T-V2-08): stage 2–7 vẫn đọc `ClassifiedDoc[]`/`ExtractedDoc[]` kiểu v2, nên
// `toLegacyClassification`/`toLegacyExtraction` dựng lại hai mảng này từ checkpoint mới. Khóa loại là
// `doc_type_key` của spec, nên checklist/gom nhóm v2 cũ sẽ không khớp mục cho tới khi C4 thay stage 2.
import type { WorkflowStepResult } from '@/lib/pipelines/workflow-engine';
import { docTypeByKey } from '@/lib/loan-dossier/catalog';
import type { ClassifyData, ClassifyStageResult, ExtractData, ExtractStageResult, StageStatus } from '@/lib/loan-dossier/contracts/stage-result';
import { runClassify, type ClassifyInputFile, type ClassifyPorts } from '@/lib/loan-dossier/s1/run';
import { runExtract, type ExtractPorts } from '@/lib/loan-dossier/s2/run';

import type { ClassifiedDoc, ExtractedDoc } from '../prompts/loan-appraisal-prompts';
import type { DossierPrecheck } from './dossier-precheck';
import type { IntakeAssessment } from './intake-assessment';

export const DOSSIER_ARTIFACT_VERSION = '3.0';

/** V2-R03: StageStatus của spec → `WorkflowStepResult.status`. */
export function toWorkflowStatus(status: StageStatus): NonNullable<WorkflowStepResult['status']> {
  if (status === 'SUCCESS') return 'SUCCESS';
  if (status === 'FAILED' || status === 'UNAVAILABLE' || status === 'RUNNING') return 'FAILED';
  return 'PARTIAL_SUCCESS'; // PARTIAL_SUCCESS, INSUFFICIENT_DATA, NOT_EVALUATED
}

export interface ClassifyCheckpoint extends ClassifyData {
  stage_status: StageStatus;
  status_code: string;
  message: string | null;
  file_refs: Record<string, string>;
  /** D-73…D-77: kiểm tra sơ bộ checklist + quan hệ hồ sơ bằng LLM ngay sau S1; ghi sau khi chạy để resume không gọi lại. */
  precheck?: DossierPrecheck;
  /** D-81…D-84, D-91: giai đoạn 1 tinh gọn đã xong (S2–S5 chưa chạy). Giai đoạn 2 dựng `intake_assessment` sau S2 rồi lưu vào đây; sau đó dùng lại, không dựng lại từ S4/S5, không gọi lại LLM. */
  intake_phase1?: IntakePhase1;
}

/**
 * Marker "giai đoạn 1 đã dừng ngay sau kiểm tra sơ bộ" (D-90). Khi mới dừng chỉ có `{ version }`: chưa có OCR nên chưa dựng
 * `intake_assessment`. Giai đoạn 2 (resume) dựng `intake_assessment` bằng quy tắc SAU S2, chạy LLM `intake_review`/`dossier_summary`
 * rồi lưu vào đây; từ đó các lần resume sau dùng lại, không dựng lại, không gọi lại LLM.
 * `llm_done = false` chỉ còn để đọc checkpoint dựng bởi bản trước (đã có assessment bằng quy tắc nhưng chưa chạy LLM).
 */
export interface IntakePhase1 { version: '1.0'; intake_assessment?: IntakeAssessment; llm_done?: boolean }

/** Giai đoạn 2 còn phải dựng `intake_assessment` (sau S2)? Đúng khi chưa có, hoặc checkpoint cũ ghi `llm_done = false`. */
export function needsIntakeAssessment(marker: IntakePhase1 | undefined): boolean {
  return Boolean(marker) && (!marker!.intake_assessment || marker!.llm_done === false);
}

export interface ExtractCheckpoint extends ExtractData {
  stage_status: StageStatus;
  status_code: string;
  message: string | null;
}

/** Lỗi dừng workflow sau khi đã lưu checkpoint của bước. Thông báo không chứa PII. */
export class DossierStageError extends Error {}

function failureFor(stage: 'S1' | 'S2', result: { status: StageStatus; status_code: string; message: string | null }): DossierStageError | null {
  if (result.status === 'UNAVAILABLE') {
    // "timed out" để classifyWorkflowFailure xếp loại CONNECTOR_ERROR (retryable).
    return new DossierStageError(`${stage} ${result.status_code}: dịch vụ không phản hồi (timed out). ${result.message ?? ''}`.trim());
  }
  if (result.status === 'FAILED') return new DossierStageError(`SYSTEM_ERROR: ${stage} ${result.status_code}. ${result.message ?? ''}`.trim());
  return null;
}

export interface StageOutcome {
  step: WorkflowStepResult;
  /** Khác null → workflow lưu `step` rồi dừng với lỗi này. */
  failure: Error | null;
}

/** Stage 0: chạy S1 trên `filesData`; tên file chỉ để hiển thị. */
export async function runClassifyStage(
  files: ReadonlyArray<{ name: string; path: string }>,
  ports: ClassifyPorts,
  fileRefs: () => Record<string, string>,
): Promise<StageOutcome & { result: ClassifyStageResult }> {
  const input: ClassifyInputFile[] = files.map((f) => ({ file_name: f.name, ref: f.path, upload_hint: null }));
  const result = await runClassify(input, ports);
  const data: ClassifyData = result.data ?? { files: [], repeated_doc_types: [] };
  const checkpoint: ClassifyCheckpoint = {
    ...data, stage_status: result.status, status_code: result.status_code, message: result.message, file_refs: fileRefs(),
  };
  const step: WorkflowStepResult = {
    step: 0,
    stage_key: 'classify',
    artifact_version: DOSSIER_ARTIFACT_VERSION,
    status: toWorkflowStatus(result.status),
    stepName: `Phân loại tài liệu (${files.length} file)`,
    processor: 'ext-classifier',
    content_preview: result.content_preview,
    extracted_data: checkpoint,
  };
  let failure: Error | null = failureFor('S1', result);
  if (!failure && result.status === 'INSUFFICIENT_DATA') {
    failure = new DossierStageError('INVALID_INPUT: Không nhận dạng được chứng từ nào trong bộ hồ sơ.');
  }
  return { step, failure, result };
}

/** Stage 1: chạy S2 trên `matches` của checkpoint bước 0. */
export async function runExtractStage(classify: ClassifyCheckpoint, ports: ExtractPorts): Promise<StageOutcome & { result: ExtractStageResult }> {
  const result = await runExtract({ files: classify.files, repeated_doc_types: classify.repeated_doc_types }, ports);
  const data: ExtractData = result.data ?? { evidences: [] };
  const checkpoint: ExtractCheckpoint = { ...data, stage_status: result.status, status_code: result.status_code, message: result.message };
  const success = data.evidences.filter((e) => e.status === 'SUCCESS').length;
  const step: WorkflowStepResult = {
    step: 1,
    stage_key: 'extract_evidence',
    artifact_version: DOSSIER_ARTIFACT_VERSION,
    status: toWorkflowStatus(result.status),
    stepName: `Bóc tách dữ liệu (${success}/${data.evidences.length} chứng từ)`,
    processor: 'ext-data-extractor',
    content_preview: result.content_preview,
    extracted_data: checkpoint,
  };
  let failure: Error | null = failureFor('S2', result);
  if (!failure && success === 0) failure = new DossierStageError('INVALID_INPUT: Không bóc tách được dữ liệu từ bất kỳ chứng từ nào.');
  return { step, failure, result };
}

/** Checkpoint bước 0 kiểu mới (có `stage_status`)? Checkpoint v2 cũ (`ClassifiedDoc[]`) → false. */
export function isClassifyCheckpoint(v: unknown): v is ClassifyCheckpoint {
  return !!v && typeof v === 'object' && !Array.isArray(v) && 'files' in v && 'stage_status' in v;
}

export function isExtractCheckpoint(v: unknown): v is ExtractCheckpoint {
  return !!v && typeof v === 'object' && !Array.isArray(v) && 'evidences' in v && 'stage_status' in v;
}

/** CẦU NỐI TẠM: S1 → `ClassifiedDoc[]` cho stage 2–7 của v2. */
export function toLegacyClassification(cp: ClassifyCheckpoint): ClassifiedDoc[] {
  return cp.files.map((f) => ({
    file_name: f.file_name,
    matches: f.matches.map((m) => ({ key: m.doc_type_key, label: docTypeByKey(m.doc_type_key)?.doc_type_label ?? m.doc_type_key, confidence: m.confidence })),
    status: f.status === 'CLASSIFIED' ? 'classified' : f.status === 'UNKNOWN' ? 'unknown' : 'error',
    ...(f.message ? { reason: f.message } : {}),
  }));
}

/** CẦU NỐI TẠM: S2 → `ExtractedDoc[]` cho stage 2–7 của v2. */
export function toLegacyExtraction(cp: ExtractCheckpoint): ExtractedDoc[] {
  return cp.evidences.map((e) => ({
    file_name: e.file_name,
    doc_type_key: e.doc_type_key,
    doc_type_label: e.doc_type_label,
    status: e.status === 'SUCCESS' ? 'success' : 'error',
    ...(e.data ? { data: e.data } : {}),
    ...(e.status === 'ERROR' ? { error: e.reason_code ?? 'ERROR' } : {}),
    ...(e.detected_form_name ? { detected_form_name: e.detected_form_name } : {}),
    field_confidences: e.field_confidences,
  }));
}
