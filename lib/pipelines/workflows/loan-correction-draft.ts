// Trợ lý hiệu chỉnh (case_corrections.md COR-R18…R21; T-COR-08): dịch chỉ thị của người thẩm định thành bản nháp hiệu chỉnh.
// Không áp gì: kết quả là danh sách đề xuất để người duyệt; bản đã đồng ý đi luồng tính lại của loan-appraisal.
// Một lời gọi LLM. Chỉ thị, giá trị là PII: không log, `content_preview` chỉ có số đếm.
import { docTypeByKey } from '@/lib/loan-dossier/catalog';
import { cleanLlmJson, JSON_ONLY_OUTPUT_RULE } from '@/lib/loan-dossier/common/llm-json';
import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import { renderLoanApplicationContext } from '@/lib/loan-dossier/context/render';
import { lacScopeFromInputs } from '@/lib/loan-dossier/context/scope';
import {
  buildCandidates, CORRECTION_DRAFT_PROMPT_TEMPLATE, DRAFT_OUTPUT_SCHEMA, DraftInputSchema, validateDrafts, type DraftInput,
} from '@/lib/loan-dossier/corrections/draft';
import { verifyCaseSeal } from '@/lib/loan-dossier/corrections/seal';
import { assertNotCancelled, completeWorkflow, enqueueSubStep, failWorkflow, parseDeep, updateProgress, type WorkflowContext } from '@/lib/pipelines/workflow-engine';
import { getStorageBackend } from '@/lib/storage';

import { runMapStage } from './loan-appraisal/dossier-map';
import { ensurePlaceholders, UNTRUSTED_DATA_GUARD, untrustedBlock } from './prompts/loan-appraisal-prompts';

export const CORRECTION_DRAFT_STEP = 'correction_draft';
const MAX_BYTES = 20 * 1024 * 1024;

async function readInput(ctx: WorkflowContext): Promise<DraftInput> {
  const files = ctx.filesData;
  if (files.length !== 1 || !files[0].name.toLowerCase().endsWith('.json')) throw new Error('INVALID_INPUT: INVALID_DRAFT_INPUT — files[] phải là đúng một file JSON');
  if (files[0].size > MAX_BYTES) throw new Error('INVALID_INPUT: INVALID_DRAFT_INPUT — file vượt 20 MB');
  const stream = await (await getStorageBackend()).download(files[0].path);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  let raw: unknown;
  try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('INVALID_INPUT: INVALID_DRAFT_INPUT — không phải JSON'); }
  const parsed = DraftInputSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`INVALID_INPUT: INVALID_DRAFT_INPUT — ${[...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(gốc)'))].slice(0, 20).join(', ')}`);
  if (!verifyCaseSeal(parsed.data.case_seal, parsed.data.documents, parsed.data.dossier_precheck)) throw new Error('INVALID_INPUT: CASE_SEAL_INVALID — case_seal');
  return parsed.data;
}

export async function runLoanCorrectionDraft(ctx: WorkflowContext): Promise<void> {
  try {
    const input = await readInput(ctx);
    await updateProgress(ctx, 20, 'Đang dựng hồ sơ để đối chiếu chỉ thị...');
    const evidences = input.documents.evidences;
    const map = runMapStage(evidences, ctx.pipelineVars);
    const lac = buildLoanApplicationContext({ product_code: input.case_seal.product_code, flow: input.case_seal.flow, evidences, s3: map.data, s3_status: map.status });
    const render = renderLoanApplicationContext(lac, lacScopeFromInputs([[]]));
    const docLabel = (k: string) => docTypeByKey(k)?.doc_type_label ?? k;
    const candidates = buildCandidates(map.data, lac, render, docLabel);

    const body = ensurePlaceholders(ctx.promptOverrides[CORRECTION_DRAFT_STEP] || CORRECTION_DRAFT_PROMPT_TEMPLATE, ['instruction', 'context', 'candidates', 'output_schema'])
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => {
        switch (key) {
          case 'instruction': return untrustedBlock('untrusted_instruction', input.instruction);
          case 'context': return untrustedBlock('untrusted_loan_context', render.text);
          case 'candidates': return untrustedBlock('untrusted_candidates', candidates.text);
          case 'output_schema': return DRAFT_OUTPUT_SCHEMA;
          default: return m;
        }
      });
    await updateProgress(ctx, 50, 'Đang dịch chỉ thị thành đề xuất hiệu chỉnh...');
    await assertNotCancelled(ctx);
    const response = await enqueueSubStep(
      ctx, 'ext-fact-verifier', { _prompt: `${UNTRUSTED_DATA_GUARD}\n\n${body}\n\n${JSON_ONLY_OUTPUT_RULE}` }, null,
      ctx.modelOverrides[CORRECTION_DRAFT_STEP] ?? ctx.modelOverrides.evaluate, ctx.reasoningEffortOverrides[CORRECTION_DRAFT_STEP] ?? ctx.reasoningEffortOverrides.evaluate,
    );
    const raw = parseDeep(cleanLlmJson(response.content));
    const drafts = validateDrafts(raw, { instruction: input.instruction, candidates, lac, refIndex: render.refIndex, factIndex: render.factIndex, evidences });
    const counts = drafts.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.status]: (acc[d.status] ?? 0) + 1 }), {});
    ctx.stepsResult.push({ step: 0, stage_key: 'correction_draft', artifact_version: '1.0', status: 'SUCCESS', stepName: 'Dịch chỉ thị hiệu chỉnh', processor: 'loan-correction-draft', sub_operation_id: response.operation.id, content_preview: { counts } } as never);
    await completeWorkflow(ctx, JSON.stringify({ counts }), { output_version: '1.0', source_operation_id: input.case_seal.source_operation_id, drafts, counts });
  } catch (error) {
    await failWorkflow(ctx, error);
  }
}
