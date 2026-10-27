// lib/pipelines/workflows/margin-deposit/classify.ts
// `classify` mode: phân loại chứng từ, không cần doc_type, cho phép multi-doc-per-file.
// Client tự crop file theo page_range trả về trước khi gọi extraction/framework/validation.

import {
  type WorkflowContext,
  enqueueSubStep,
} from '@/lib/pipelines/workflow-engine';
import { runWithConcurrency } from '../financial-report/concurrency';
import {
  type ClassifyFileResult,
  type ClassifyPageResult,
  type ClassifyResult,
  buildClassifyPrompt,
} from '../prompts/margin-deposit-profile-prompts';
import { parseClassifyDocuments } from '../margin-deposit-profile';
import type { ClassifyMetadata } from './shared/types';

const MAX_INPUT_FILES = 20;
const MAX_DOCUMENTS_PER_REQUEST = 200;
const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_STAGGER_MS = 500;

export interface ClassifiedDocumentItem extends ClassifyPageResult {
  document_id: string;
  /** Original uploaded file name (Requirement 9.1: every entry needs file_id + name). */
  name: string;
}

export interface ClassifyErrorItem {
  file_id: string;
  name: string;
  error: { code: 'FILE_UNREADABLE' | 'FILE_PASSWORD_PROTECTED' | 'OCR_EMPTY_TEXT'; message: string };
}

export interface ClassifyOutput {
  documents: ClassifiedDocumentItem[];
  errors: ClassifyErrorItem[];
}

type InputFile = WorkflowContext['filesData'][number] & { file_id: string };

function assignInputFileIds(files: WorkflowContext['filesData']): InputFile[] {
  if (files.length === 0) throw new Error('INVALID_INPUT: No file was provided.');
  if (files.length > MAX_INPUT_FILES) {
    throw new Error(`INVALID_INPUT: classify mode supports at most ${MAX_INPUT_FILES} input files.`);
  }

  const explicitIds = new Set<string>();
  for (const file of files) {
    if (!file.file_id) continue;
    const explicitId = file.file_id.trim();
    if (!explicitId || explicitIds.has(explicitId)) {
      throw new Error(`INVALID_INPUT: duplicate or empty explicit file_id "${file.file_id}".`);
    }
    explicitIds.add(explicitId);
  }

  const assigned = new Set<string>();
  return files.map((file, index) => {
    const fileId = file.file_id?.trim() || `input-${String(index + 1).padStart(3, '0')}::${file.name}`;
    if (assigned.has(fileId)) {
      throw new Error(`INVALID_INPUT: duplicate file identity "${fileId}".`);
    }
    assigned.add(fileId);
    return { ...file, file_id: fileId };
  });
}

function assignDocumentIds(
  documents: ClassifyPageResult[],
  nameByFileId: Map<string, string>,
): ClassifiedDocumentItem[] {
  const counters = new Map<string, number>();
  return documents.map((document) => {
    const ordinal = (counters.get(document.file_id) ?? 0) + 1;
    counters.set(document.file_id, ordinal);
    return {
      ...document,
      document_id: `${document.file_id}::doc-${String(ordinal).padStart(3, '0')}`,
      name: nameByFileId.get(document.file_id) ?? document.file_id,
    };
  });
}

function classifyErrorCode(message: string): ClassifyErrorItem['error']['code'] {
  if (/encrypt|password/i.test(message)) return 'FILE_PASSWORD_PROTECTED';
  if (/OCR_EMPTY_TEXT|empty text/i.test(message)) return 'OCR_EMPTY_TEXT';
  return 'FILE_UNREADABLE';
}

/**
 * `classify` mode runner. Fans out one `ext-classifier` call per input file
 * (multi-document-per-file detection preserved), then aggregates the results.
 * No `doc_type` is required; no crop/extract/presence step is invoked here —
 * the client is responsible for cropping by `page_range` before calling any
 * other mode.
 */
export async function runClassify(ctx: WorkflowContext, _metadata: ClassifyMetadata): Promise<ClassifyOutput> {
  const { logger, filesData } = ctx;
  const inputFiles = assignInputFileIds(filesData);
  logger.info(`[MARGIN-DEPOSIT][classify] files=${inputFiles.length}`);

  const classifyResults = await runWithConcurrency(
    inputFiles,
    { limit: DEFAULT_MAX_CONCURRENCY, staggerDelayMs: DEFAULT_STAGGER_MS },
    async (file): Promise<ClassifyResult> => {
      const fileId = file.file_id;
      try {
        const result = await enqueueSubStep(
          ctx,
          'ext-classifier',
          buildClassifyPrompt(file.name, ctx.promptOverrides.classify),
          JSON.stringify([file]),
          ctx.modelOverrides.classify,
          ctx.reasoningEffortOverrides.classify,
        );
        const documents = parseClassifyDocuments(result.content).map((doc) => ({ ...doc, file_id: fileId }));
        return { fileName: file.name, fileId, documents, subOperationId: result.operation.id, status: 'success' } as ClassifyFileResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[MARGIN-DEPOSIT][classify] Classify failed for ${file.name}: ${message}`);
        return { fileName: file.name, fileId, documents: [] as never[], subOperationId: '', status: 'error', error: message };
      }
    },
  );

  const nameByFileId = new Map(inputFiles.map((file) => [file.file_id, file.name]));
  const allClassified = assignDocumentIds(
    classifyResults.flatMap((result) => (result.status === 'success' ? result.documents : [])),
    nameByFileId,
  );
  if (allClassified.length > MAX_DOCUMENTS_PER_REQUEST) {
    throw new Error(`INVALID_AI_RESPONSE: classifier returned more than ${MAX_DOCUMENTS_PER_REQUEST} documents for one request.`);
  }

  const errors: ClassifyErrorItem[] = classifyResults
    .filter((result): result is ClassifyResult & { status: 'error' } => result.status === 'error')
    .map((result) => ({
      file_id: result.fileId,
      name: result.fileName,
      error: { code: classifyErrorCode(result.error), message: result.error },
    }));

  return { documents: allClassified, errors };
}
