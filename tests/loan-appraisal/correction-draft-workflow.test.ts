// T-COR-08 — workflow trợ lý hiệu chỉnh: kiểm niêm phong, một lời gọi LLM, chỉ thị không vào log / content_preview (COR-R18, R21).
const enqueueMock = jest.fn();
const files = new Map<string, string>();
jest.mock('@/lib/pipelines/workflow-engine', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflow-engine');
  return {
    ...actual,
    enqueueSubStep: (...args: unknown[]) => enqueueMock(...args),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    completeWorkflow: jest.fn().mockResolvedValue(undefined),
    failWorkflow: jest.fn().mockResolvedValue(undefined),
    assertNotCancelled: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('@/lib/storage', () => ({
  getStorageBackend: async () => ({
    download: async (key: string) => { const { Readable } = await import('stream'); return Readable.from([Buffer.from(files.get(key) ?? '', 'utf8')]); },
  }),
}));

import { runLoanCorrectionDraft } from '@/lib/pipelines/workflows/loan-correction-draft';
import { completeWorkflow, failWorkflow } from '@/lib/pipelines/workflow-engine';
import { DRAFT_INPUT_CONTRACT } from '@/lib/loan-dossier/corrections/draft';
import { sealCase } from '@/lib/loan-dossier/corrections/seal';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

const INSTRUCTION = 'Chỉ thị riêng 5e2b: ông Hùng sinh 1965 là bố của khách vay';
const evs = [loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }]), ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })];
const classify = classifyOf(evs);

function ctxWith(input: unknown) {
  const text = JSON.stringify(input);
  files.set('/s/d.json', text);
  return {
    operationId: 'op-d', endpointSlug: 'workflows:loan-correction-draft', stepsResult: [], currentStep: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [],
    pipelineVars: {}, promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {}, webhookUrl: null, apiKeyId: null,
    filesData: [{ name: 'draft.json', path: '/s/d.json', mime: 'application/json', size: text.length }],
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}
function input(tamper = false) {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcd';
  const documents = JSON.parse(JSON.stringify({ classify: { files: classify.files, repeated_doc_types: classify.repeated_doc_types }, evidences: evs }));
  const case_seal = sealCase({ source_operation_id: 'op-origin', product_code: 'hkd-loan', flow: 'FULL', workflow_version: '2', documents, dossier_precheck: null });
  if (tamper) documents.evidences[0].data.parties[0].full_name = 'KHÁC';
  return { contract: DRAFT_INPUT_CONTRACT, contract_version: '1.0', documents, dossier_precheck: null, case_seal, instruction: INSTRUCTION };
}

beforeEach(() => { enqueueMock.mockReset(); (completeWorkflow as jest.Mock).mockClear(); (failWorkflow as jest.Mock).mockClear(); });

it('một lời gọi LLM, chỉ thị nằm trong khối untrusted; kết quả là bản nháp; chỉ thị không vào log / content_preview', async () => {
  enqueueMock.mockResolvedValue({ content: JSON.stringify({ items: [{ kind: 'CLARIFY', quote: 'là bố của khách vay', note: 'Quan hệ cha con cần giấy khai sinh' }] }), operation: { id: 'sub-1' } });
  const ctx = ctxWith(input());
  await runLoanCorrectionDraft(ctx as never);
  expect(failWorkflow).not.toHaveBeenCalled();
  expect(enqueueMock).toHaveBeenCalledTimes(1);
  const prompt = String((enqueueMock.mock.calls[0][2] as { _prompt: string })._prompt);
  expect(prompt).toMatch(/<untrusted_instruction>[\s\S]*Chỉ thị riêng 5e2b/);
  const result = (completeWorkflow as jest.Mock).mock.calls[0][2] as { drafts: Array<{ status: string }>; source_operation_id: string };
  expect(result.source_operation_id).toBe('op-origin');
  expect(result.drafts.map((d) => d.status)).toEqual(['NEEDS_CLARIFICATION']);
  const logged = JSON.stringify([ctx.logger.info.mock.calls, ctx.logger.warn.mock.calls]);
  const previews = JSON.stringify(ctx.stepsResult.map((s) => (s as { content_preview?: unknown }).content_preview));
  expect(logged).not.toContain('5e2b');
  expect(previews).not.toContain('5e2b');
});

it('niêm phong sai → CASE_SEAL_INVALID, không gọi LLM', async () => {
  await runLoanCorrectionDraft(ctxWith(input(true)) as never);
  expect(((failWorkflow as jest.Mock).mock.calls[0][1] as Error).message).toContain('CASE_SEAL_INVALID');
  expect(enqueueMock).not.toHaveBeenCalled();
});
