// Rà soát quá trình xử lý: không ghi / lưu / trả dữ liệu thừa.
//  1. updateProgress chỉ ghi stepsResultJson khi artifact đổi.
//  2. Khi SUCCEEDED, loan-appraisal bỏ extracted_data của checkpoint (bản sao kết quả cuối) nhưng giữ sub_operation_id.
//  3. Response mặc định của loan-appraisal không trả result.pipeline_steps (trùng metadata.pipeline_steps).
const updates: Array<Record<string, unknown>> = [];
const transitions: Array<Record<string, unknown>> = [];
const selectRows: unknown[] = [{ progressLogJson: null }];

jest.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => selectRows }) }) }),
    update: () => ({ set: (values: Record<string, unknown>) => { updates.push(values); return { where: async () => undefined }; } }),
  },
}));
jest.mock('@/lib/operations/state-transition', () => ({
  transitionOperationState: jest.fn(async (input: { changes: Record<string, unknown> }) => { transitions.push(input.changes); return { state: 'SUCCEEDED' }; }),
}));
jest.mock('@/lib/operations/content-retention', () => ({
  purgeWorkflowSubSteps: jest.fn().mockResolvedValue(0),
  keepWorkflowSubStepContent: () => false,
}));

import { completeWorkflow, updateProgress, type WorkflowContext } from '@/lib/pipelines/workflow-engine';
import { dropSucceededStepArtifacts } from '@/lib/pipelines/workflows/loan-appraisal/compact-view';
import { formatOperationResponse } from '@/lib/pipelines/format';

const step = (n: number, key: string, extra: Record<string, unknown> = {}) => ({
  step: n, stage_key: key, artifact_version: '1.0', status: 'SUCCESS', stepName: key, processor: 'p', extracted_data: { big: 'x'.repeat(2000) }, ...extra,
});

function ctx(steps: unknown[], persisted?: string): WorkflowContext {
  return {
    operationId: 'op-1', stepsResult: steps, currentStep: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, usageBreakdown: [],
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }, webhookUrl: null, endpointSlug: 'workflows:loan-appraisal',
    _persistedStepsJson: persisted,
  } as never as WorkflowContext;
}

beforeEach(() => { updates.length = 0; transitions.length = 0; });

describe('updateProgress: không ghi lặp stepsResultJson', () => {
  it('ghi khi artifact đổi, bỏ qua khi không đổi, ghi lại khi đổi tiếp', async () => {
    const c = ctx([step(0, 'classify')], '[]');
    await updateProgress(c, 10, 'a');
    expect(updates[0]).toHaveProperty('stepsResultJson');
    await updateProgress(c, 20, 'b');
    await updateProgress(c, 30, 'c');
    expect(updates[1]).not.toHaveProperty('stepsResultJson');
    expect(updates[2]).not.toHaveProperty('stepsResultJson');
    // Các lần bỏ qua vẫn ghi tiến độ đầy đủ.
    expect(updates[1]).toMatchObject({ progressPercent: 20, progressMessage: 'b' });
    expect(updates[2]).toMatchObject({ progressPercent: 30, progressMessage: 'c' });
    (c.stepsResult as unknown[]).push(step(1, 'extract_evidence'));
    await updateProgress(c, 40, 'd');
    expect(updates[3]).toHaveProperty('stepsResultJson');
    expect(JSON.parse(updates[3].stepsResultJson as string)).toHaveLength(2);
  });

  it('khôi phục từ DB (đã có sẵn đúng nội dung): lần đầu không ghi lại', async () => {
    const steps = [step(0, 'classify')];
    const c = ctx(steps, JSON.stringify(steps));
    await updateProgress(c, 10, 'a');
    expect(updates[0]).not.toHaveProperty('stepsResultJson');
    expect(updates[0]).toMatchObject({ progressPercent: 10 });
  });

  it('thiếu bộ nhớ đệm (context dựng tay, workflow khác): hành vi cũ, luôn ghi lần đầu', async () => {
    const c = ctx([step(0, 'classify')]);
    await updateProgress(c, 10, 'a');
    expect(updates[0]).toHaveProperty('stepsResultJson');
    await updateProgress(c, 20, 'b');
    expect(updates[1]).not.toHaveProperty('stepsResultJson');
  });

  it('không bao giờ làm mất dữ liệu: ghi xong thì đệm khớp bản đã ghi', async () => {
    const c = ctx([step(0, 'classify')], '[]');
    await updateProgress(c, 10, 'a');
    expect(c._persistedStepsJson).toBe(updates[0].stepsResultJson);
  });
});

describe('dropSucceededStepArtifacts', () => {
  it('bỏ extracted_data, giữ mọi khóa khác kể cả sub_operation_id và content_preview; không mutate đầu vào', () => {
    const input = [
      step(0, 'classify'),
      step(4, 'evaluate_policy_compliance', { sub_operation_id: 'sub-9', content_preview: { passed: 1 } }),
      { step: 6, stepName: 'Webhook Callback', processor: 'webhook', content_preview: { http_status: 200 } },
    ];
    const snapshot = JSON.stringify(input);
    const out = dropSucceededStepArtifacts(input) as Array<Record<string, unknown>>;
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out[0]).not.toHaveProperty('extracted_data');
    expect(out[0]).toMatchObject({ step: 0, stage_key: 'classify', status: 'SUCCESS', processor: 'p', artifact_in: 'result.extracted_data' });
    expect(out[1]).toMatchObject({ sub_operation_id: 'sub-9', content_preview: { passed: 1 } });
    expect(out[2]).toEqual(input[2]);
  });

  it('bước không có extracted_data (VD synthesize_recommendation) đi qua nguyên vẹn', () => {
    const s = { step: 5, stage_key: 'synthesize_recommendation', status: 'SUCCESS', processor: 'p', content_preview: { x: 1 } };
    expect(dropSucceededStepArtifacts([s])[0]).toBe(s);
  });
});

describe('completeWorkflow(..., compactSteps)', () => {
  const steps = [step(0, 'classify'), step(2, 'consolidate_dossier'), step(4, 'evaluate_policy_compliance', { sub_operation_id: 'sub-9' })];

  it('chỉ bản LƯU được thu gọn; kết quả cuối giữ nguyên; sub_operation_id còn nguyên cho bước dọn sub-step', async () => {
    const c = ctx(steps.map((s) => ({ ...s })), '[]');
    await completeWorkflow(c, 'out', { final: true }, {}, dropSucceededStepArtifacts);
    const saved = JSON.parse(transitions[0].stepsResultJson as string) as Array<Record<string, unknown>>;
    expect(saved.every((s) => !('extracted_data' in s))).toBe(true);
    expect(saved[2].sub_operation_id).toBe('sub-9');
    expect(JSON.parse(transitions[0].extractedData as string)).toEqual({ final: true });
    expect(JSON.stringify(saved).length).toBeLessThan(JSON.stringify(steps).length / 4);
    // Trong bộ nhớ cũng là bản gọn để lần ghi sau (log webhook) không ghi đè lại bản đầy đủ.
    expect((c.stepsResult as unknown as Array<Record<string, unknown>>).every((s) => !('extracted_data' in s))).toBe(true);
    const { purgeWorkflowSubSteps } = jest.requireMock('@/lib/operations/content-retention') as { purgeWorkflowSubSteps: jest.Mock };
    expect(JSON.stringify(purgeWorkflowSubSteps.mock.calls[0][0].references[0])).toContain('sub-9');
  });

  it('không truyền compactSteps (workflow khác): hành vi cũ, lưu nguyên artifact', async () => {
    const c = ctx(steps.map((s) => ({ ...s })), '[]');
    await completeWorkflow(c, 'out', { final: true });
    const saved = JSON.parse(transitions[0].stepsResultJson as string) as Array<Record<string, unknown>>;
    expect(saved.every((s) => 'extracted_data' in s)).toBe(true);
  });
});

describe('response mặc định của loan-appraisal không trả hai lần pipeline_steps', () => {
  const op = (slug: string, state = 'RUNNING', done = false) => ({
    id: 'op-1', endpointSlug: slug, pipelineJson: '[]', progressLogJson: '[]', usageBreakdown: '[]', createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    outputFormat: 'json', outputContent: 'x', currentStep: 1, progressPercent: 10, state, done,
    stepsResultJson: JSON.stringify([step(0, 'classify')]), extractedData: JSON.stringify({ a: 1 }),
  }) as never;

  it('loan-appraisal: chỉ metadata.pipeline_steps (đủ extracted_data), không có result.pipeline_steps', () => {
    const r = formatOperationResponse(op('workflows:loan-appraisal', 'SUCCEEDED', true)) as { metadata: { pipeline_steps: unknown[] }; result: Record<string, unknown> };
    expect(r.metadata.pipeline_steps).toHaveLength(1);
    expect(r.metadata.pipeline_steps[0]).toHaveProperty('extracted_data');
    expect(r.result).not.toHaveProperty('pipeline_steps');
    expect(r.result).toHaveProperty('extracted_data');
  });

  it('loan-appraisal FAILED: cũng không trả result.pipeline_steps', () => {
    const r = formatOperationResponse({ ...(op('workflows:loan-appraisal', 'FAILED', true) as object), errorCode: 'X', errorMessage: 'm' } as never) as { result?: Record<string, unknown> };
    expect(r.result).not.toHaveProperty('pipeline_steps');
  });

  it('workflow khác: không đổi (vẫn có result.pipeline_steps)', () => {
    const r = formatOperationResponse(op('workflows:payroll-verify', 'SUCCEEDED', true)) as { result: Record<string, unknown> };
    expect(r.result).toHaveProperty('pipeline_steps');
  });
});
