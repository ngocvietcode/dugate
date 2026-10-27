// lib/pipelines/workflows/margin-deposit/extraction.ts
// `extraction` mode: client đã biết doc_type cho từng file (1 file = 1 document).
// Bóc tách field theo EXTRACT_FIELDS_BY_CODE[doc_type]. (Nhận diện chữ ký/con dấu
// — "presence" — đã được gỡ bỏ khỏi workflow này.)
// Không crop lại file — mỗi file đã là 1 document đơn lẻ theo trách nhiệm của client.

import {
  type WorkflowContext,
  enqueueSubStep,
  parseDeep,
} from '@/lib/pipelines/workflow-engine';
import { runWithConcurrency } from '../financial-report/concurrency';
import {
  EXTRACT_FIELDS_BY_CODE,
  ESCROW_DOCUMENT_LABELS,
  type ExtractFieldResult,
  type ExtractResult,
  buildExtractPrompt,
} from '../prompts/margin-deposit-profile-prompts';
import { parseExtractFields } from '../margin-deposit-profile';
import { parseFileMetaArray, type ParsedFileGroup } from './shared/file-meta';
import type { ExtractionMetadata } from './shared/types';

const DEFAULT_MAX_CONCURRENCY = 3;
const MAX_CONCURRENCY = 5;
const DEFAULT_STAGGER_MS = 500;
/** ≥ 70% of expected fields empty/null/N/A → flag as a likely wrong doc_type declaration. */
const TYPE_MISMATCH_THRESHOLD = 0.7;

export type ExtractionErrorCode =
  | 'FILE_UNREADABLE'
  | 'FILE_PASSWORD_PROTECTED'
  | 'EXTRACTION_FAILED'
  | 'DOC_TYPE_MISMATCH';

export interface ExtractionDocumentItem {
  file_id: string;
  name: string;
  doc_type: string;
  extracted: ExtractFieldResult | { status: 'error'; error: string };
  warning: { code: 'TYPE_MISMATCH_SUSPECTED'; message: string } | null;
  error: { code: ExtractionErrorCode; message: string } | null;
}

export interface ExtractionOutput {
  documents: ExtractionDocumentItem[];
}

/** Classifies an extraction-step failure message into a stable error code, preserving the original message. */
function classifyExtractionError(fileName: string, message: string): { code: ExtractionErrorCode; message: string } {
  if (/encrypt|password/i.test(message)) {
    return { code: 'FILE_PASSWORD_PROTECTED', message: `File "${fileName}" requires a password or uses unsupported encryption.` };
  }
  if (/FILE_UNREADABLE|no pages|corrupt/i.test(message)) {
    return { code: 'FILE_UNREADABLE', message };
  }
  return { code: 'EXTRACTION_FAILED', message };
}

function isEmptyFieldValue(value: ExtractFieldResult['fields'][string] | undefined): boolean {
  if (!value) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value.value === null || value.value === 'N/A') return true;
  // Treat empty / whitespace-only OCR strings as empty so a wrong doc_type
  // (where most fields come back blank) is still flagged by detectTypeMismatch.
  return typeof value.value === 'string' && value.value.trim() === '';
}

/**
 * Pure post-processing check (Requirement 4.4) — no additional AI call.
 * Flags a likely wrong `doc_type` declaration when most expected fields came
 * back empty/null/N/A.
 */
export function detectTypeMismatch(fields: ExtractFieldResult['fields'], docType: string): boolean {
  const expected = EXTRACT_FIELDS_BY_CODE[docType] ?? [];
  if (expected.length === 0) return false;
  const emptyCount = expected.filter((fieldName) => isEmptyFieldValue(fields[fieldName])).length;
  return emptyCount / expected.length >= TYPE_MISMATCH_THRESHOLD;
}

/** Outcome of the single extraction call. `docTypeMismatch` is set when the
 *  extractor's BƯỚC 0 title check determined the file is clearly a different
 *  document type than the declared `doc_type` (no separate classifier call). */
type ExtractOutcome =
  | { kind: 'extracted'; result: ExtractResult }
  | { kind: 'doc_type_mismatch'; detectedTitle: string };

/** Reads the extractor's BƯỚC 0 mismatch flag from the raw AI response, if present. */
function readDocTypeMismatch(content: unknown): { mismatch: boolean; detectedTitle: string } {
  const parsed = parseDeep(content);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (obj.doc_type_mismatch === true || obj.doc_type_mismatch === 'true') {
      const title = typeof obj.detected_title === 'string' ? obj.detected_title.trim() : '';
      return { mismatch: true, detectedTitle: title };
    }
  }
  return { mismatch: false, detectedTitle: '' };
}

/**
 * One AI call per file. BƯỚC 0 of the extract prompt first checks the document
 * title against the declared doc_type; a confident mismatch short-circuits here
 * (no fields parsed, no second AI call). Otherwise the response is parsed into
 * fields with per-field isolation.
 */
async function extractOneDocument(ctx: WorkflowContext, group: ParsedFileGroup): Promise<ExtractOutcome> {
  try {
    const result = await enqueueSubStep(
      ctx,
      'ext-data-extractor',
      buildExtractPrompt(group.meta.doc_type, group.file_id, '1', ctx.promptOverrides.extract),
      JSON.stringify([group.file]),
      ctx.modelOverrides.extract,
      ctx.reasoningEffortOverrides.extract,
    );

    // BƯỚC 0 guard: the extractor flagged the file as a different document type.
    const { mismatch, detectedTitle } = readDocTypeMismatch(result.content);
    if (mismatch) {
      return { kind: 'doc_type_mismatch', detectedTitle };
    }

    const { fields, field_errors } = parseExtractFields(result.content, group.meta.doc_type);
    // Per-field errors no longer fail the whole extraction: keep status 'success'
    // and surface which fields were malformed via field_errors (empty when clean).
    return {
      kind: 'extracted',
      result: {
        fields,
        status: 'success',
        subOperationId: result.operation.id,
        ...(Object.keys(field_errors).length ? { field_errors } : {}),
      },
    };
  } catch (error) {
    return { kind: 'extracted', result: { status: 'error', error: error instanceof Error ? error.message : String(error) } };
  }
}

/**
 * `extraction` mode runner. Each file is treated as exactly one document
 * matching its declared `doc_type` (Requirement 4.2) — no crop/split step.
 * One AI extraction call per file (presence detection has been removed).
 */
export async function runExtraction(ctx: WorkflowContext, metadata: ExtractionMetadata): Promise<ExtractionOutput> {
  const groups = parseFileMetaArray(ctx.filesData, metadata.file_meta);

  const combinedLimit = Math.max(1, Math.floor(Math.min(DEFAULT_MAX_CONCURRENCY, MAX_CONCURRENCY) / 2));
  const results = await runWithConcurrency(
    groups,
    { limit: combinedLimit, staggerDelayMs: DEFAULT_STAGGER_MS },
    async (group): Promise<{ group: ParsedFileGroup; outcome: ExtractOutcome }> => {
      const outcome = await extractOneDocument(ctx, group);
      return { group, outcome };
    },
  );

  const documents: ExtractionDocumentItem[] = results.map(({ group, outcome }) => {
      const declaredLabel = ESCROW_DOCUMENT_LABELS[group.meta.doc_type] ?? group.meta.doc_type;

      // BƯỚC 0 title guard flagged a different document type — hard error, no data.
      if (outcome.kind === 'doc_type_mismatch') {
        const detected = outcome.detectedTitle || 'không xác định';
        return {
          file_id: group.file_id,
          name: group.file.name,
          doc_type: group.meta.doc_type,
          extracted: {
            status: 'error',
            error: `DOC_TYPE_MISMATCH: Tài liệu có tiêu đề "${detected}" nhưng doc_type khai báo là "${group.meta.doc_type}" (${declaredLabel}).`,
          },
          warning: null,
          error: {
            code: 'DOC_TYPE_MISMATCH',
            message: `File "${group.file.name}" có tiêu đề "${detected}" nhưng doc_type khai báo là "${group.meta.doc_type}" (${declaredLabel}). Vui lòng gửi đúng loại tài liệu hoặc sửa doc_type.`,
          },
        };
      }

      const extractResult = outcome.result;
      let error: ExtractionDocumentItem['error'] = null;
      let warning: ExtractionDocumentItem['warning'] = null;

      if (extractResult.status === 'success') {
        if (detectTypeMismatch(extractResult.fields, group.meta.doc_type)) {
          warning = {
            code: 'TYPE_MISMATCH_SUSPECTED',
            message: `Hầu hết các trường mong đợi cho loại "${group.meta.doc_type}" đều trống; có thể doc_type khai báo không đúng.`,
          };
        }
      } else {
        error = classifyExtractionError(group.file.name, extractResult.error);
      }

      return {
        file_id: group.file_id,
        name: group.file.name,
        doc_type: group.meta.doc_type,
        extracted: extractResult,
        warning,
        error,
      };
    });

  return { documents };
}
