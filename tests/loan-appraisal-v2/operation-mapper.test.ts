import { applyOperation, toRunErrorKind } from '@/app/loan-appraisal-v2/lib/operation-mapper';

const now = () => '10:00:00';
const types = (actions: Array<{ type: string }>) => actions.map((a) => a.type);

describe('operation-mapper', () => {
  it('maps a running operation to progress with min 5%', () => {
    const { actions, outcome } = applyOperation(
      { done: false, metadata: { state: 'RUNNING', current_step: 1, progress_percent: 0, progress_message: 'OCR' } },
      new Set(), now,
    );
    expect(outcome).toBe('running');
    expect(actions).toEqual([{ type: 'PROGRESS', stage: 'extract_evidence', percent: 5, message: 'OCR', at: '10:00:00' }]);
  });

  it('reveals each stage only once, skips webhook, falls back to legacy index', () => {
    const revealed = new Set<string>();
    const op = {
      done: false,
      metadata: {
        current_step: 2,
        pipeline_steps: [
          { stage_key: 'classify', status: 'SUCCESS' },
          { step: 1, status: 'SUCCESS' },
          { processor: 'webhook', status: 'SUCCESS' },
        ],
      },
    };
    const first = applyOperation(op, revealed, now);
    const keys = first.actions.filter((a) => a.type === 'REVEAL').map((a) => (a as { stageKey: string }).stageKey);
    expect(keys).toEqual(['classify', 'extract_evidence']);
    const second = applyOperation(op, revealed, now);
    expect(types(second.actions)).toEqual(['PROGRESS']);
  });

  it('maps SUCCEEDED v2 with result and usage', () => {
    const { actions, outcome } = applyOperation({
      done: true,
      metadata: { state: 'SUCCEEDED' },
      result: { extracted_data: { output_version: '2.0' }, usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.1 } },
    }, new Set(), now);
    expect(outcome).toBe('done');
    const last = actions[actions.length - 1] as { type: string; result: { output_version: string }; usage: { inputTokens: number } };
    expect(last.type).toBe('SUCCEEDED');
    expect(last.result.output_version).toBe('2.0');
    expect(last.usage.inputTokens).toBe(10);
  });

  it('maps SUCCEEDED v1 result and null extracted_data', () => {
    const v1 = applyOperation({ done: true, metadata: { state: 'SUCCEEDED' }, result: { extracted_data: { product_code: 'x' } } }, new Set(), now);
    expect((v1.actions[0] as { result: unknown }).result).toEqual({ product_code: 'x' });
    const empty = applyOperation({ done: true, metadata: { state: 'SUCCEEDED', extracted_data: null }, result: { extracted_data: null } }, new Set(), now);
    expect(empty.outcome).toBe('done');
    expect((empty.actions[0] as { result: unknown }).result).toBeNull();
  });

  it('maps FAILED with and without failed_step', () => {
    const withStep = applyOperation({ done: true, metadata: { state: 'FAILED', current_step: 2 }, error: { message: 'bad', failed_step: 3 } }, new Set(), now);
    expect(withStep.outcome).toBe('failed');
    expect(withStep.actions[0]).toMatchObject({ type: 'FAILED', kind: 'workflow', message: 'bad', stage: 'evaluate_policy_compliance' });
    const without = applyOperation({ done: true, metadata: { state: 'FAILED', current_step: 2 }, error: {} }, new Set(), now);
    expect(without.actions[0]).toMatchObject({ message: 'Workflow failed', stage: 'calculate_financials' });
  });

  it('maps CANCELLED before done and never applies a result', () => {
    const { actions, outcome } = applyOperation({ done: true, metadata: { state: 'CANCELLED' }, result: { extracted_data: { a: 1 } } }, new Set(), now);
    expect(outcome).toBe('cancelled');
    expect(actions).toEqual([{ type: 'CANCELLED' }]);
  });

  it('tolerates garbage input', () => {
    expect(applyOperation(null, new Set(), now).outcome).toBe('running');
    expect(applyOperation('x', new Set(), now).actions[0]).toMatchObject({ type: 'PROGRESS', percent: 5 });
  });

  it('toRunErrorKind mapping', () => {
    expect(toRunErrorKind('forbidden', 'poll')).toBe('forbidden');
    expect(toRunErrorKind('not-found', 'attach')).toBe('not-found');
    expect(toRunErrorKind('network', 'submit')).toBe('network');
    expect(toRunErrorKind('http', 'submit')).toBe('submit');
    expect(toRunErrorKind('http', 'poll')).toBe('network');
    expect(toRunErrorKind('invalid-json', 'submit')).toBe('submit');
    expect(toRunErrorKind('invalid-json', 'poll')).toBe('network');
  });
});
