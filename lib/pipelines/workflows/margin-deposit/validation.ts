// lib/pipelines/workflows/margin-deposit/validation.ts
// `validation` mode: copy-check (N bản sao cùng doc_type/group_id, AI-based
// full-document diff) + template-check (giống framework mode), chạy song song.
// Cả hai chỉ nhận customer files (role: customer); role: template files chỉ
// dùng làm input so sánh, không tự có document result.

import {
  type WorkflowContext,
  enqueueSubStep,
} from '@/lib/pipelines/workflow-engine';
import { runWithConcurrency } from '../financial-report/concurrency';
import {
  type FrameworkCompareResult,
  buildFrameworkComparePrompt,
  buildCopyDiffPrompt,
} from '../prompts/margin-deposit-profile-prompts';
import { parseFrameworkCompareResult } from '../margin-deposit-profile';
import {
  parseCopyDiffResult,
  type CopyCheckResult,
} from '../margin-deposit-profile-compare';
import { parseFileMetaArray, type ParsedFileGroup } from './shared/file-meta';
import type { ValidationMetadata } from './shared/types';

const DEFAULT_MAX_CONCURRENCY = 3;
const MIN_COPIES_REQUIRED = 3;
const COPY_CHECK_ELIGIBLE_CODES = new Set(['thoa_thuan_ky_quy', 'thanh_ly_ky_quy']);

export interface ValidationDocumentItem {
  file_id: string;
  name: string;
  doc_type: string;
  group_id: string | null;
  template_check: FrameworkCompareResult | null;
  warning: { code: 'COPY_CHECK_NOT_APPLICABLE'; message: string } | null;
  error: { code: 'FILE_UNREADABLE'; message: string } | null;
}

export interface ValidationOutput {
  documents: ValidationDocumentItem[];
  copy_checks: CopyCheckResult[];
  summary: { overall_verdict: 'PASS' | 'FAIL' | 'WARNING' };
}

function groupTemplatesByType(templateGroups: ParsedFileGroup[]): Map<string, ParsedFileGroup[]> {
  const byType = new Map<string, ParsedFileGroup[]>();
  for (const group of templateGroups) {
    byType.set(group.meta.doc_type, [...(byType.get(group.meta.doc_type) ?? []), group]);
  }
  return byType;
}

/** Groups role:customer entries by (doc_type, group_id), restricted to copy-check-eligible codes (Requirement 6.3, 6.10). */
function groupForCopyCheck(customerGroups: ParsedFileGroup[]): Map<string, ParsedFileGroup[]> {
  const byKey = new Map<string, ParsedFileGroup[]>();
  for (const group of customerGroups) {
    if (!COPY_CHECK_ELIGIBLE_CODES.has(group.meta.doc_type)) continue;
    const key = `${group.meta.doc_type}::${group.meta.group_id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), group]);
  }
  return byKey;
}

/**
 * Runs the copy-check for every eligible (doc_type, group_id) group.
 * Groups with < 3 files short-circuit to COMPARISON_SKIPPED without an AI call
 * (Requirement 6.7); groups with >= 3 files (no upper bound, Requirement 6.8)
 * call ext-comparator once with all group files, then strictly parse the result.
 * Verdict is MATCH iff differences.length === 0, else MISMATCH — severity is
 * never consulted here (Requirement 6.9).
 */
async function runCopyChecks(ctx: WorkflowContext, customerGroups: ParsedFileGroup[]): Promise<CopyCheckResult[]> {
  const byKey = groupForCopyCheck(customerGroups);
  const entries = [...byKey.entries()];

  return runWithConcurrency(
    entries,
    { limit: DEFAULT_MAX_CONCURRENCY, staggerDelayMs: 500 },
    async ([key, members]): Promise<CopyCheckResult> => {
      const [docType, groupId] = key.split('::') as [CopyCheckResult['doc_type'], string];
      const fileIds = members.map((m) => m.file_id);

      if (members.length < MIN_COPIES_REQUIRED) {
        return {
          doc_type: docType,
          group_id: groupId,
          copies_found: members.length,
          file_ids: fileIds,
          differences: [],
          verdict: 'COMPARISON_SKIPPED',
          error_code: 'INSUFFICIENT_COPIES',
          status: 'success',
        };
      }

      try {
        const result = await enqueueSubStep(
          ctx,
          'ext-comparator',
          buildCopyDiffPrompt(docType, fileIds, ctx.promptOverrides.copy_diff),
          JSON.stringify(members.map((m) => m.file)),
          ctx.modelOverrides.copy_diff,
          ctx.reasoningEffortOverrides.copy_diff,
        );
        const differences = parseCopyDiffResult(result.content);
        return {
          doc_type: docType,
          group_id: groupId,
          copies_found: members.length,
          file_ids: fileIds,
          differences,
          verdict: differences.length === 0 ? 'MATCH' : 'MISMATCH',
          status: 'success',
        };
      } catch (error) {
        return {
          doc_type: docType,
          group_id: groupId,
          copies_found: members.length,
          file_ids: fileIds,
          differences: [],
          verdict: 'COMPARISON_SKIPPED',
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}

/**
 * Runs the template-check for every role:customer file, pairing it with the
 * role:template file(s) sharing its doc_type — same pairing logic as
 * framework.ts. A missing template is non-fatal (Requirement 7.4).
 */
async function runTemplateChecks(
  ctx: WorkflowContext,
  customerGroups: ParsedFileGroup[],
  templatesByType: Map<string, ParsedFileGroup[]>,
): Promise<Map<string, FrameworkCompareResult | null>> {
  const results = await runWithConcurrency(
    customerGroups,
    { limit: DEFAULT_MAX_CONCURRENCY, staggerDelayMs: 500 },
    async (customer): Promise<[string, FrameworkCompareResult | null]> => {
      const templates = templatesByType.get(customer.meta.doc_type) ?? [];
      if (templates.length === 0) {
        return [customer.file_id, { clauses_modified: [], verdict: 'WARNING', status: 'success', error: 'FRAMEWORK_MISSING' }];
      }
      try {
        const filesJson = JSON.stringify([customer.file, ...templates.map((t) => t.file)]);
        const result = await enqueueSubStep(
          ctx,
          'ext-comparator',
          buildFrameworkComparePrompt(
            { file_id: customer.file_id, doc_type: customer.meta.doc_type },
            { framework_files: templates.map((t) => t.file.name) },
            ctx.promptOverrides.framework,
          ),
          filesJson,
          ctx.modelOverrides.framework,
          ctx.reasoningEffortOverrides.framework,
        );
        return [customer.file_id, parseFrameworkCompareResult(result.content)];
      } catch (error) {
        return [customer.file_id, {
          clauses_modified: [],
          verdict: 'WARNING',
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }];
      }
    },
  );
  return new Map(results);
}

/**
 * Strict "Option 2" aggregation (Requirement 8): any copy-check MISMATCH or
 * template_check FAIL escalates to FAIL unconditionally; severity of
 * individual differences is never read here (Requirement 8.4).
 */
export function computeOverallVerdict(
  documents: ValidationDocumentItem[],
  copyChecks: CopyCheckResult[],
): 'PASS' | 'FAIL' | 'WARNING' {
  if (copyChecks.some((check) => check.verdict === 'MISMATCH')) return 'FAIL';
  if (documents.some((doc) => doc.template_check?.verdict === 'FAIL')) return 'FAIL';

  if (copyChecks.some((check) => check.verdict === 'COMPARISON_SKIPPED')) return 'WARNING';
  if (documents.some((doc) => doc.template_check?.verdict === 'WARNING')) return 'WARNING';
  if (documents.some((doc) => doc.warning !== null || doc.error !== null)) return 'WARNING';

  return 'PASS';
}

/**
 * `validation` mode runner. Parses the single files[]/file_meta[] array once,
 * splits by resolved role, then runs copy-check and template-check
 * concurrently (Requirement 7.5) — neither blocks the other.
 */
export async function runValidation(ctx: WorkflowContext, metadata: ValidationMetadata): Promise<ValidationOutput> {
  const groups = parseFileMetaArray(ctx.filesData, metadata.file_meta, {
    requireGroupIdForCodes: [...COPY_CHECK_ELIGIBLE_CODES],
    maxTemplatesPerDocType: { don_tra_soat: 2 },
  });
  const customerGroups = groups.filter((group) => group.meta.role === 'customer');
  const templateGroups = groups.filter((group) => group.meta.role === 'template');
  const templatesByType = groupTemplatesByType(templateGroups);

  const [copyChecks, templateResults] = await Promise.all([
    runCopyChecks(ctx, customerGroups),
    runTemplateChecks(ctx, customerGroups, templatesByType),
  ]);

  const documents: ValidationDocumentItem[] = customerGroups.map((group) => {
    const copyCheckApplies = COPY_CHECK_ELIGIBLE_CODES.has(group.meta.doc_type);
    return {
      file_id: group.file_id,
      name: group.file.name,
      doc_type: group.meta.doc_type,
      group_id: group.meta.group_id ?? null,
      template_check: templateResults.get(group.file_id) ?? null,
      warning: copyCheckApplies
        ? null
        : {
            code: 'COPY_CHECK_NOT_APPLICABLE',
            message: `Đối chiếu bản sao không áp dụng cho loại chứng từ "${group.meta.doc_type}".`,
          },
      error: null,
    };
  });

  const overall_verdict = computeOverallVerdict(documents, copyChecks);
  return { documents, copy_checks: copyChecks, summary: { overall_verdict } };
}
