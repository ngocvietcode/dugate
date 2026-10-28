// T-MD-04, T-MD-06, T-MD-07, T-MD-08 — master_dossier trong workflow, rule engine, Rule LLM, tài chính.
const enqueueMock = jest.fn();
jest.mock('@/lib/pipelines/workflow-engine', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflow-engine');
  return {
    ...actual,
    enqueueSubStep: (...args: unknown[]) => enqueueMock(...args),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    updateWorkflowProgressDetails: jest.fn().mockResolvedValue(undefined),
    completeWorkflow: jest.fn().mockResolvedValue(undefined),
    failWorkflow: jest.fn().mockResolvedValue(undefined),
    assertNotCancelled: jest.fn().mockResolvedValue(undefined),
  };
});

import { runLoanAppraisal } from '@/lib/pipelines/workflows/loan-appraisal';
import { briefMasterDossier, buildLoanAppraisalIntegrationPayload } from '@/lib/pipelines/workflows/loan-appraisal/integration-payload';
import { DEFAULT_CHECK_SET, isKnownInput } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { financialInputsFromProfile } from '@/lib/pipelines/workflows/loan-appraisal/financial-inputs';
import { applyMasterToFinancialInputs, masterEvidenceRegistry } from '@/lib/pipelines/workflows/loan-appraisal/master-dossier';
import { declaredEvidenceDocTypes, parsePromptCheckResults, selectPromptEvidence } from '@/lib/pipelines/workflows/loan-appraisal/prompt-checks';
import { buildEvidenceRegistryV3 } from '@/lib/pipelines/workflows/loan-appraisal/evidence-v3';
import type { AppraisalResultV2 } from '@/lib/pipelines/workflows/loan-appraisal/types';
import { completeWorkflow, failWorkflow } from '@/lib/pipelines/workflow-engine';
import { MasterDossierSchema } from '@/lib/loan-dossier/contracts/master-dossier';
import type { AssetDescriptor, EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { groupDuplicates } from '@/lib/loan-dossier/s2/duplicates';
import { assetKeys } from '@/lib/loan-dossier/s3/asset-key';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';
import { profileOf } from '../loan-dossier/fixtures/profile';
import { runDossier } from '../loan-dossier/fixtures/master';

const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const withLoan = (amount: number) => {
  const e = loanApp([borrower]);
  return { ...e, data: { ...e.data!, loan_info: { ...(e.data!.loan_info as object), bank_proposed_amount: amount, loan_term_months: 18, interest_rate: 10 } } };
};

async function finalResult(evs: EvidenceEnvelope[]): Promise<AppraisalResultV2> {
  jest.clearAllMocks();
  enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
  const classify = { ...classifyOf(evs), stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {} };
  const extract = { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null };
  const step = (i: number, key: string, data: unknown) => ({ step: i, stage_key: key, artifact_version: '3.0', status: 'SUCCESS', stepName: key, processor: 'x', extracted_data: data });
  const ctx = {
    operationId: 'op-1', endpointSlug: 'workflows:loan-appraisal', stepsResult: [step(0, 'classify', classify), step(1, 'extract_evidence', extract)], currentStep: 2,
    totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [], pipelineVars: { flow: 'FULL', dossier_submitted_at: '2026-10-14', stop_after_intake: false },
    promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
    filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
    webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
  await runLoanAppraisal(ctx as never);
  expect((failWorkflow as jest.Mock).mock.calls.map((c) => String(c[1]))).toEqual([]);
  return (completeWorkflow as jest.Mock).mock.calls[0][2];
}

describe('T-MD-04: workflow và payload (master data tạm tắt ở giai đoạn 2)', () => {
  it('kết quả không còn master_dossier / intake_assessment; payload không có documents.records; OCR vẫn ở extractions', async () => {
    const r = await finalResult([withLoan(1_000_000_000), ev('id_card', { parties: [{ ...borrower, party_role: 'HOLDER' }] })]);
    const stored = r as unknown as Record<string, unknown>;
    expect(stored).not.toHaveProperty('master_dossier');
    expect(stored).not.toHaveProperty('intake_assessment');
    const payload = buildLoanAppraisalIntegrationPayload(r, [], { operation_id: 'op-1', state: 'SUCCEEDED', created_at: null, completed_at: null });
    expect(payload).not.toHaveProperty('documents');
    expect(payload).not.toHaveProperty('parties');
    expect(payload.extractions.map((e) => e.doc).sort()).toEqual(['id_card', 'loan_application']);
    expect(buildLoanAppraisalIntegrationPayload(r, [], { operation_id: 'op-1', state: 'SUCCEEDED', created_at: null, completed_at: null }, { include: ['narrative'] })).not.toHaveProperty('assessment');
  });

  it('briefMasterDossier (logic thuần, dùng khi bật lại master) chỉ giữ giá trị hợp nhất, không nguồn / độ tin cậy', async () => {
    const { master } = await runDossier([withLoan(1_000_000_000), ev('id_card', { parties: [{ ...borrower, party_role: 'HOLDER' }] })]);
    expect(MasterDossierSchema.safeParse(master).success).toBe(true);
    const brief = briefMasterDossier(master)!;
    expect(brief.summary).toEqual(master!.summary);
    expect(brief.documents.every((d) => d.fields.length > 0)).toBe(true);
    expect(JSON.stringify(brief)).not.toMatch(/"(kind|sources|outliers|confidence|review_status|copies|evidence_ids|other_documents|document_ids)"/);
  });

  it('D-114 (thay MD-R13): 2 bản đề nghị vay ghi số tiền khác nhau → hồ sơ 360 báo DISPUTED, stage 2 không tính trên số tranh chấp', async () => {
    // Hồ sơ 360 là nguồn sự thật: LAC-R03 phát hiện hai đơn vay lệch số tiền, số tiền vay để trống kèm cờ xung đột thay vì lấy một bản.
    const evs = groupDuplicates([withLoan(1_000_000_000), withLoan(1_500_000_000)], (a) => assetKeys(a as unknown as AssetDescriptor));
    const r = await finalResult(evs);
    expect(r.profile_360!.loan.bank_proposed_amount.trust).toBe('DISPUTED');
    expect(r.financial_metrics.requested_amount).toMatchObject({ status: 'INSUFFICIENT_DATA', input_conflict: true });
    expect(r.profile_360!.issues.some((i) => i.code === 'FIELD_CONFLICT' && i.subject_id === 'loan')).toBe(true);
  });
});

describe('T-MD-08: đầu vào tài chính từ master', () => {
  it('MD-AC11: hồ sơ không có bản lệch → đầu vào tài chính giống hệt trước khi đổi nguồn', async () => {
    const { input, master } = await runDossier([withLoan(1_000_000_000)]);
    const before = financialInputsFromProfile(profileOf(input.evidences as EvidenceEnvelope[], { s3: input.s3 }));
    const after = applyMasterToFinancialInputs(before, master);
    const values = (x: typeof before) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, (v as { value?: number } | null)?.value ?? null]));
    expect(values(after)).toEqual(values(before));
    expect(after.conflicts).toBeUndefined();
  });

  it('master null → giữ nguyên đầu vào (MD-AC12)', () => {
    const inputs = { requested: { value: 1, evidenceIds: ['ev-000000000001#x'] }, revenue: null, profit: null, debtService: null, collateral: null, tenor: null, rate: null, existingMonthly: null };
    expect(applyMasterToFinancialInputs(inputs, null)).toBe(inputs);
  });
});

describe('T-MD-06, T-MD-07: nguồn master.* và Rule LLM', () => {
  it('isKnownInput nhận master.document.<item_key> có thật, master.person, master.asset', () => {
    expect(isKnownInput('master.person')).toBe(true);
    expect(isKnownInput('master.asset.collateral')).toBe(true);
    expect(isKnownInput('master.document.khong_co_muc_nay')).toBe(false);
    const prompt = DEFAULT_CHECK_SET.checks.find((c) => c.kind === 'PROMPT')!;
    expect(declaredEvidenceDocTypes([{ ...prompt, input: ['master.document.x', 'master.person', 'evidence.id_card'] }])).toEqual(new Set(['item:x', 'master:person', 'id_card']));
  });

  it('MD-AC09: khối master dẫn nguồn D<n> → đổi về lá nguồn thật; ref bịa bị bỏ; trường CONFLICT hiện mọi ứng viên', async () => {
    const { input, master } = await runDossier([withLoan(1_000_000_000), withLoan(1_500_000_000)]);
    const raw = buildEvidenceRegistryV3(input.evidences, new Set(), input.checklist);
    const reg = masterEvidenceRegistry(master, raw);
    const sel = selectPromptEvidence(reg, new Set(['loan_application']));
    expect(sel.text).toContain('CHƯA THỐNG NHẤT giữa các bản');
    const [code, entries] = [...sel.refIndex.entries()][0];
    const [path, rid] = entries.find(([p]) => p.startsWith('parties'))!;
    const prompt = DEFAULT_CHECK_SET.checks.find((c) => c.kind === 'PROMPT')!;
    const res = parsePromptCheckResults({ results: [{ id: prompt.id, status: 'PASS', confidence: 0.95, reason: 'ok', evidence_ids: [`${code}:${path}`, 'D99:x'] }] }, DEFAULT_CHECK_SET, reg)
      .find((x) => x.rule_id === prompt.id)!;
    expect(res.evidence_ids).toEqual([rid]);
    expect(rid).toMatch(/^ev-[0-9a-f]{12}#parties\[0\]\./);
  });
});
