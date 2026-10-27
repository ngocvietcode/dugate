// lib/pipelines/workflows/margin-deposit/framework.ts
// `framework` mode: đối chiếu chứng từ khách hàng (role: customer) với chứng từ
// khung (role: template) theo cùng doc_type. Cả hai nhóm nằm trong CÙNG MỘT
// mảng files[] — phân biệt bằng metadata.file_meta[].role, không dùng field
// files-array thứ 2, để không phải sửa normalizeFiles() dùng chung toàn hệ thống.

import {
  type WorkflowContext,
  enqueueSubStep,
} from '@/lib/pipelines/workflow-engine';
import { runWithConcurrency } from '../financial-report/concurrency';
import {
  type FrameworkCompareResult,
  buildFrameworkComparePrompt,
} from '../prompts/margin-deposit-profile-prompts';
import { parseFrameworkCompareResult } from '../margin-deposit-profile';
import { parseFileMetaArray, type ParsedFileGroup } from './shared/file-meta';
import type { FrameworkMetadata } from './shared/types';

const DEFAULT_MAX_CONCURRENCY = 3;

export interface FrameworkDocumentItem {
  file_id: string;
  name: string;
  doc_type: string;
  /** null = FRAMEWORK_MISSING (non-fatal): no role:template file shares this doc_type. */
  template_check: FrameworkCompareResult | null;
}

export interface FrameworkOutput {
  documents: FrameworkDocumentItem[];
}

function groupTemplatesByType(templateGroups: ParsedFileGroup[]): Map<string, ParsedFileGroup[]> {
  const byType = new Map<string, ParsedFileGroup[]>();
  for (const group of templateGroups) {
    byType.set(group.meta.doc_type, [...(byType.get(group.meta.doc_type) ?? []), group]);
  }
  return byType;
}

/**
 * `framework` mode runner. Parses the single `files[]`/`file_meta[]` array,
 * splits it by resolved `role`, and pairs each `role: customer` file with the
 * `role: template` file(s) sharing its `doc_type` (Requirement 5.1, 5.2).
 * `role: template` files never produce their own document result (Requirement 5.5).
 */
export async function runFramework(ctx: WorkflowContext, metadata: FrameworkMetadata): Promise<FrameworkOutput> {
  const groups = parseFileMetaArray(ctx.filesData, metadata.file_meta, {
    maxTemplatesPerDocType: { don_tra_soat: 2 },
  });
  const customerGroups = groups.filter((group) => group.meta.role === 'customer');
  const templateGroups = groups.filter((group) => group.meta.role === 'template');
  const templatesByType = groupTemplatesByType(templateGroups);

  const results = await runWithConcurrency(
    customerGroups,
    { limit: DEFAULT_MAX_CONCURRENCY, staggerDelayMs: 500 },
    async (customer): Promise<FrameworkDocumentItem> => {
      const templates = templatesByType.get(customer.meta.doc_type) ?? [];
      if (templates.length === 0) {
        return {
          file_id: customer.file_id,
          name: customer.file.name,
          doc_type: customer.meta.doc_type,
          template_check: { clauses_modified: [], verdict: 'WARNING', status: 'success', error: 'FRAMEWORK_MISSING' },
        };
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
        return {
          file_id: customer.file_id,
          name: customer.file.name,
          doc_type: customer.meta.doc_type,
          template_check: parseFrameworkCompareResult(result.content),
        };
      } catch (error) {
        return {
          file_id: customer.file_id,
          name: customer.file.name,
          doc_type: customer.meta.doc_type,
          template_check: {
            clauses_modified: [],
            verdict: 'WARNING',
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  );

  return { documents: results };
}
