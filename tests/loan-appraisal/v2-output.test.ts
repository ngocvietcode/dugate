// T-V2-08 — output 3.0 và payload tích hợp theo cấu trúc spec-v3 (V2-R09).
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
import { buildLoanAppraisalIntegrationPayload } from '@/lib/pipelines/workflows/loan-appraisal/integration-payload';
import { IntegrationPayloadSchema } from '@/lib/pipelines/workflows/loan-appraisal/integration-contract';
import type { AppraisalResultV2 } from '@/lib/pipelines/workflows/loan-appraisal/types';
import { completeWorkflow, failWorkflow } from '@/lib/pipelines/workflow-engine';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';

async function finalResult(flow = 'FULL'): Promise<AppraisalResultV2> {
  jest.clearAllMocks();
  enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } });
  const evs = [loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }]), ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }] })];
  const classify = { ...classifyOf(evs), stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null, file_refs: {} };
  const extract = { evidences: evs, stage_status: 'SUCCESS', status_code: 'COMPLETED', message: null };
  const step = (i: number, key: string, data: unknown) => ({ step: i, stage_key: key, artifact_version: '3.0', status: 'SUCCESS', stepName: key, processor: 'x', extracted_data: data });
  const ctx = {
    operationId: 'op-1', endpointSlug: 'workflows:loan-appraisal', stepsResult: [step(0, 'classify', classify), step(1, 'extract_evidence', extract)], currentStep: 2,
    totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [], pipelineVars: { flow, dossier_submitted_at: '2026-10-14', stop_after_intake: false },
    promptOverrides: {}, modelOverrides: {}, reasoningEffortOverrides: {},
    filesData: [{ name: 'a.pdf', path: '/s/a.pdf', mime: 'application/pdf', size: 1 }],
    webhookUrl: null, apiKeyId: null, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as never as { webhookExtractedData?: unknown };
  await runLoanAppraisal(ctx as never);
  expect((failWorkflow as jest.Mock).mock.calls.map((c) => String(c[1]))).toEqual([]);
  return Object.assign((completeWorkflow as jest.Mock).mock.calls[0][2], { __webhook: ctx.webhookExtractedData });
}

describe('AppraisalResultV2 3.0 (giai đoạn 2: chỉ OCR + rule)', () => {
  it('output_version 3.0; chỉ OCR (documents.evidences), tài chính, rule, khuyến nghị; các khối kiểm tra hồ sơ là DOSSIER_CHECKS_DISABLED', async () => {
    const r = await finalResult();
    expect(r.output_version).toBe('3.0');
    expect(Object.keys(r.documents)).toEqual(['classify', 'evidences']);
    expect(r.documents.evidences.length).toBe(2);
    // Gom người & tài sản (S3) chạy: customer_360 có dữ liệu thật. Checklist / đối chiếu chéo giữ đủ khóa nhưng rỗng, mang mã tạm tắt.
    expect(r.customer_360).not.toBeNull();
    expect(r.customer_360!.role_registry.map((p) => [p.person_id, p.roles])).toEqual([['person-1', ['borrower']]]);
    expect(r.customer_360!.customer_360).toHaveLength(1);
    // Khối quan hệ (nodes + edges) đi cùng customer_360, chỉ có id và nhãn.
    expect(r.dossier_graph).toMatchObject({ version: '1.0' });
    expect(r.dossier_graph!.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['person-1']));
    // D-114: hồ sơ 360 là nguồn sự thật duy nhất, đi cùng kết quả; sổ Claim không còn lưu riêng.
    expect(r.profile_360).toMatchObject({ profile_version: '1.0' });
    expect(r.profile_360!.customers.map((c) => c.person_id)).toEqual(['person-1']);
    expect('claims' in r).toBe(false);
    expect(JSON.stringify(r.dossier_graph)).not.toContain('NGUYỄN VĂN AN');
    expect(r.checklist).toMatchObject({ status: 'NOT_RUN', status_code: 'DOSSIER_CHECKS_DISABLED', items: [], summary_by_group: [] });
    expect(r.cross_check).toMatchObject({ status: 'NOT_RUN', status_code: 'DOSSIER_CHECKS_DISABLED', results: [], logic_findings: [] });
    const stored = r as unknown as Record<string, unknown>;
    for (const gone of ['intake', 'audit', 'master_dossier', 'intake_assessment', 'dossier_readiness']) expect(stored).not.toHaveProperty(gone);
    for (const legacy of ['grouping', 'intake_table', 'cross_check_matrix', 'master_data_by_dimension', 'dossier_checks', 'overall_assessment']) {
      expect(legacy in r).toBe(false);
    }
    // Rule: không còn REQUIRED_DOCUMENTS. LTV được đánh giá nhờ S3; hồ sơ mẫu không có TSBĐ / định giá nên thiếu dữ liệu (không còn "chưa đánh giá").
    const ids = r.policy_compliance.rule_results.map((x) => x.rule_id);
    expect(ids).not.toContain('LOAN.INTAKE.REQUIRED_DOCUMENTS');
    expect(r.policy_compliance.rule_results.find((x) => x.rule_id === 'LOAN.COLLATERAL.MAX_LTV')).toMatchObject({ result: 'INSUFFICIENT_DATA', reason_code: 'LTV_INPUT_MISSING' });
    expect(r.financial_metrics.ltv.status).toBe('INSUFFICIENT_DATA');
    expect(r.financial_metrics.collateral_value.status).toBe('INSUFFICIENT_DATA');
    // Khuyến nghị chỉ dựa trên tài chính + rule: không còn mã chứng từ / readiness.
    for (const code of ['REQUIRED_DOCUMENTS_INCOMPLETE', 'DOSSIER_READINESS_UNKNOWN', 'DOSSIER_SUPPLEMENT_REQUIRED']) expect(r.recommendation.reason_codes).not.toContain(code);
    expect(r.review.route).not.toBe('REQUEST_DOCUMENTS');
    expect((r.system_notes ?? []).some((n) => n.includes('tạm tắt'))).toBe(true);
  });

  it('payload tích hợp 5.2: hợp lệ theo contract; extractions (OCR) + financials + checks + decision; không khối kiểm tra hồ sơ, không tiến trình, không evidence, không log PII', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const r = await finalResult();
    const payload = buildLoanAppraisalIntegrationPayload(r, [], { operation_id: 'op-1', state: 'SUCCEEDED', created_at: '2026-10-23T00:00:00Z', completed_at: '2026-10-23T01:00:00Z' });
    const parsed = IntegrationPayloadSchema.safeParse(payload);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(payload.schema_version).toBe('5.2');
    expect(Object.keys(payload)).toEqual(['schema', 'schema_version', 'case', 'decision', 'extractions', 'financials', 'checks', 'checks_summary', 'notes']);
    expect(payload.case).toMatchObject({ id: 'op-1', completed_at: '2026-10-23T01:00:00Z', profile: { segment: 'HKD', product: 'hkd-loan', flow: 'FULL' } });

    const text = JSON.stringify(payload);
    expect(text).not.toContain('form_code');
    for (const key of ['operation', 'classification', 'evaluation', 'config_snapshot', 'audit', 'stages', 'precheck', 'created_at', 'state']) {
      expect(text).not.toContain('"' + key + '"');
    }
    // Khối kiểm tra hồ sơ vắng ở CẤP GỐC (chuỗi "parties" còn lại nằm trong data OCR theo schema chứng từ, không phải khối kiểm tra).
    for (const key of ['parties', 'assets', 'documents', 'findings']) expect(payload).not.toHaveProperty(key);
    expect(text).not.toMatch(/"(evidence_id|evidence_ids|source_evidence_ids|found_in|file_id|file_name|field_path|sources|mapped_evidences|id_number_sources|field_confidences|source_pages)"/);
    expect(text).not.toMatch(/"(formula|inputs|warnings|five_c|stress_test|credit_score|rule_id|check_name|check_kind)"/);
    expect(text).not.toContain('person-');

    // extractions: một phần tử cho mỗi chứng từ OCR, data theo schema chứng từ, đã bỏ trường rỗng.
    expect(payload.extractions.map((e) => e.doc).sort()).toEqual(['id_card', 'loan_application']);
    for (const e of payload.extractions) {
      expect(e).toMatchObject({ status: 'SUCCESS', file: expect.any(String), schema_version: expect.any(String) });
      expect(e.data).toBeDefined();
      expect(JSON.stringify(e.data)).not.toMatch(/:null|:\[\]|:\{\}|:""/);
    }
    // Giá trị OCR (tên, số định danh) đi vào extractions đúng như đã đọc; PII không rò ra log.
    expect(text).toContain(ID_A12);
    expect(spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n')).not.toContain(ID_A12);

    // checks: MỘT hình dạng; không còn rule chứng từ; LTV thiếu dữ liệu (không có định giá); rule engine có measure, LLM không có.
    expect(payload.checks.length).toBe(r.policy_compliance.rule_results.length);
    expect(payload.checks.map((c) => c.id)).not.toContain('LOAN.INTAKE.REQUIRED_DOCUMENTS');
    expect(payload.checks.find((c) => c.id === 'LOAN.COLLATERAL.MAX_LTV')).toMatchObject({ kind: 'ENGINE', outcome: 'INSUFFICIENT_DATA' });
    expect(payload.checks.find((c) => c.id === 'LOAN.CAPACITY.MIN_DSCR')).toMatchObject({ kind: 'ENGINE', group: 'CAPACITY', measure: { expected: { minimum: 1.25 } } });
    for (const c of payload.checks) {
      if (c.kind === 'LLM') expect(c).not.toHaveProperty('measure');
      if (c.outcome === 'PASS') expect(c).not.toHaveProperty('message');
    }
    expect(payload.decision.recommendation).toBe(r.recommendation.recommendation);
    expect(payload.decision).not.toHaveProperty('ready_for_handover');
    expect(Array.isArray(payload.financials)).toBe(true);
    expect(payload.financials.find((m) => m.metric === 'ltv')).toMatchObject({ status: 'INSUFFICIENT_DATA' });
    expect(payload).not.toHaveProperty('assessment');
    expect(payload).not.toHaveProperty('labels');
    spies.forEach((s) => s.mockRestore());
  });

  it('kết quả LƯU không có bản sao nội bộ: by_file, by_document_type, bản ghi CHECKLIST_STATUS, classification_confidence', async () => {
    const r = await finalResult();
    expect(r.evidence).not.toHaveProperty('by_file');
    expect(r.evidence).not.toHaveProperty('by_document_type');
    expect(r.evidence.records.length).toBeGreaterThan(0);
    expect(r.evidence.records.every((x) => x.evidence_kind !== 'CHECKLIST_STATUS')).toBe(true);
    expect(JSON.stringify(r)).not.toContain('classification_confidence');
    const ids = new Set(r.evidence.records.map((x) => x.evidence_id));
    for (const rule of r.policy_compliance.rule_results) for (const id of rule.evidence_ids) expect(ids.has(id)).toBe(true);
  });

  it('include=labels thêm nhãn; include=narrative không thêm gì khi không có kiểm tra nháp; phần còn lại không đổi', async () => {
    const r = await finalResult();
    const op = { operation_id: 'op-1', state: 'SUCCEEDED', created_at: null, completed_at: null };
    const base = buildLoanAppraisalIntegrationPayload(r, [], op);
    const rich = buildLoanAppraisalIntegrationPayload(r, [], op, { include: ['narrative', 'labels'] });
    expect(IntegrationPayloadSchema.safeParse(rich).success).toBe(true);
    expect(rich).not.toHaveProperty('assessment');
    expect(rich.labels?.checks?.map((c) => c.id)).toEqual(expect.arrayContaining(['LOAN.CAPACITY.MIN_DSCR']));
    expect(rich.labels?.check_groups?.map((g) => g.group)).toContain('CAPACITY');
    expect(rich.labels?.document_groups ?? []).toEqual([]);
    const { labels: _l, ...rest } = rich;
    expect(rest).toEqual(base);
  });

  it('5.2 (D-101): chỉ số needs_review → financials[].review = true; chỉ số đã chấp nhận không có khóa review; vẫn hợp lệ contract', async () => {
    const r = await finalResult();
    const metrics = r.financial_metrics as unknown as Record<string, { needs_review?: boolean }>;
    for (const m of Object.values(metrics)) delete m.needs_review;
    metrics.dscr.needs_review = true;
    const payload = buildLoanAppraisalIntegrationPayload(r, [], { operation_id: 'op-1', state: 'SUCCEEDED', created_at: null, completed_at: null });
    expect(IntegrationPayloadSchema.safeParse(payload).success).toBe(true);
    const byMetric = new Map(payload.financials.map((f) => [f.metric, f]));
    expect(byMetric.get('dscr')).toMatchObject({ review: true });
    for (const [metric, f] of byMetric) if (metric !== 'dscr') expect(f).not.toHaveProperty('review');
  });

  it('payload 5.2 nhỏ hơn rõ rệt so với kết quả đầy đủ trong DB', async () => {
    const r = await finalResult();
    const payload = buildLoanAppraisalIntegrationPayload(r, [], { operation_id: 'op-1', state: 'SUCCEEDED', created_at: null, completed_at: null });
    expect(JSON.stringify(payload).length).toBeLessThan(JSON.stringify(r).length * 0.5);
  });
});

describe('kết quả CŨ đã lưu (đủ checklist, Customer 360, master) vẫn đọc được', () => {
  // Fixture chụp từ workflow TRƯỚC khi tắt các bước kiểm tra hồ sơ (108 KB). Đây là dạng dữ liệu đang nằm trong DB của operation đã chạy.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const legacy = require('./fixtures/legacy-full-result.json') as AppraisalResultV2;
  const op = { operation_id: 'op-old', state: 'SUCCEEDED', created_at: null, completed_at: null };

  it('payload tích hợp dựng đủ các khối kiểm tra khi kết quả có dữ liệu, hợp lệ theo cùng contract', () => {
    const payload = buildLoanAppraisalIntegrationPayload(legacy, [], op);
    expect(IntegrationPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.parties?.[0]).toMatchObject({ id: 'party-1', type: 'PERSON' });
    expect(payload.documents?.items.length).toBeGreaterThan(0);
    expect(payload.extractions.length).toBe(legacy.documents.evidences.length);
    // Kết quả cũ có đủ checklist, Customer 360, master, kiểm tra nháp.
    expect(legacy.checklist.items.length).toBeGreaterThan(0);
    expect(legacy.customer_360?.role_registry.length).toBeGreaterThan(0);
    expect(payload.findings).toBeDefined();
  });

  it('include=narrative vẫn trả assessment của kết quả cũ', () => {
    expect(buildLoanAppraisalIntegrationPayload(legacy, [], op, { include: ['narrative'] }).assessment?.criteria).toHaveLength(4);
  });
});