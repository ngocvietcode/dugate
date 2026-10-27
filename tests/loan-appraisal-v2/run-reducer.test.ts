import {
  CANCEL_POLL_BUDGET,
  initialRunState,
  runReducer,
  type RunAction,
  type RunState,
} from '@/app/loan-appraisal-v2/lib/run-reducer';
import { STAGES } from '@/app/loan-appraisal-v2/lib/stages';

function apply(state: RunState, ...actions: RunAction[]): RunState {
  return actions.reduce(runReducer, state);
}

const running = () => apply(initialRunState(), { type: 'SUBMIT_START' }, { type: 'SUBMITTED', operationId: 'op-12345678' });

describe('run-reducer', () => {
  it('idle -> submitting -> running', () => {
    const submitting = apply(initialRunState(), { type: 'SUBMIT_START' });
    expect(submitting.phase).toBe('submitting');
    expect(submitting.stages.classify).toBe('running');
    expect(running().phase).toBe('running');
    expect(running().operationId).toBe('op-12345678');
  });

  it('ignores invalid transitions', () => {
    const idle = initialRunState();
    expect(apply(idle, { type: 'SUBMITTED', operationId: 'x' })).toBe(idle);
    expect(apply(idle, { type: 'CANCEL_REQUESTED' })).toBe(idle);
    expect(apply(idle, { type: 'SUCCEEDED', result: null, usage: null })).toBe(idle);
    const busy = running();
    expect(apply(busy, { type: 'SUBMIT_START' })).toBe(busy);
  });

  it('reveal marks stage done and next stage running; FAILED step marks error', () => {
    const s = apply(running(), { type: 'REVEAL', stageKey: 'classify', step: { status: 'SUCCESS', extracted_data: { files: [{ file_name: 'a.pdf' }], stage_status: 'SUCCESS' } } });
    expect(s.stages.classify).toBe('done');
    expect(s.stages.dossier_precheck).toBe('running');
    expect(s.stages.extract_evidence).toBe('pending');
    expect(s.classification).toHaveLength(1);
    const f = apply(running(), { type: 'REVEAL', stageKey: 'classify', step: { status: 'FAILED' } });
    expect(f.stages.classify).toBe('error');
  });

  it('progress keeps a bounded log of distinct messages', () => {
    let s = running();
    for (let i = 0; i < 100; i += 1) s = apply(s, { type: 'PROGRESS', stage: 'classify', percent: 10, message: `m${i}`, at: '10:00' });
    s = apply(s, { type: 'PROGRESS', stage: 'classify', percent: 10, message: 'm99', at: '10:00' });
    expect(s.progressLog).toHaveLength(80);
    expect(s.progressMessage).toBe('m99');
  });

  it('SUCCEEDED 3.0 -> 100% and all done; bản cũ -> 3 stage đầu xong, tài chính chưa', () => {
    const v2 = apply(running(), { type: 'SUCCEEDED', result: { output_version: '3.0' } as never, usage: null });
    expect(v2.phase).toBe('succeeded');
    expect(v2.progressPercent).toBe(100);
    expect(Object.values(v2.stages).every((x) => x === 'done')).toBe(true);
    const v1 = apply(running(), { type: 'SUCCEEDED', result: { product_code: 'x' } as never, usage: null });
    expect(v1.progressPercent).toBe(Math.round((3 / STAGES.length) * 100));
    expect(v1.stages.extract_evidence).toBe('done');
    expect(v1.stages.calculate_financials).toBe('pending');
  });

  it('FAILED records error and marks stage; forbidden sets needsApiKey', () => {
    const s = apply(running(), { type: 'FAILED', kind: 'workflow', message: 'boom', stage: 'evaluate_policy_compliance' });
    expect(s.phase).toBe('failed');
    expect(s.stages.evaluate_policy_compliance).toBe('error');
    expect(s.error?.message).toBe('boom');
    const f = apply(initialRunState(), { type: 'ATTACH_START', operationId: 'op-12345678' }, { type: 'FAILED', kind: 'forbidden', message: 'no', stage: null });
    expect(f.needsApiKey).toBe(true);
  });

  it('invalid-op is allowed from idle', () => {
    const s = apply(initialRunState(), { type: 'FAILED', kind: 'invalid-op', message: 'bad', stage: null });
    expect(s.phase).toBe('failed');
  });

  it('CANCELLED shows no fake numbers', () => {
    const s = apply(running(), { type: 'PROGRESS', stage: 'classify', percent: 20 }, { type: 'CANCEL_REQUESTED' }, { type: 'CANCELLED' });
    expect(s.phase).toBe('cancelled');
    expect(s.result).toBeNull();
    expect(s.usage).toBeNull();
    expect(s.progressPercent).toBe(20);
    expect(s.stages.calculate_financials).not.toBe('done');
  });

  it('cancelling -> running after the poll budget is exhausted without CANCELLED', () => {
    let s = apply(running(), { type: 'CANCEL_REQUESTED' });
    expect(s.phase).toBe('cancelling');
    expect(s.cancelPollsLeft).toBe(CANCEL_POLL_BUDGET);
    s = apply(s, { type: 'POLL_TICK' }, { type: 'POLL_TICK' });
    expect(s.phase).toBe('cancelling');
    s = apply(s, { type: 'POLL_TICK' });
    expect(s.phase).toBe('running');
  });

  it('cancel error returns to running; cancelling can end as succeeded/failed', () => {
    expect(apply(running(), { type: 'CANCEL_REQUESTED' }, { type: 'CANCEL_FAILED' }).phase).toBe('running');
    expect(apply(running(), { type: 'CANCEL_REQUESTED' }, { type: 'SUCCEEDED', result: null, usage: null }).phase).toBe('succeeded');
    expect(apply(running(), { type: 'CANCEL_REQUESTED' }, { type: 'FAILED', kind: 'network', message: 'x', stage: null }).phase).toBe('failed');
  });

  it('soft timeout keeps running; stalled is not an error and can re-attach', () => {
    const soft = apply(running(), { type: 'SOFT_TIMEOUT' });
    expect(soft.phase).toBe('running');
    expect(soft.softTimeout).toBe(true);
    const stalled = apply(running(), { type: 'STALLED' });
    expect(stalled.phase).toBe('stalled');
    expect(stalled.error).toBeNull();
    expect(apply(stalled, { type: 'ATTACH_START', operationId: 'op-12345678' }).phase).toBe('running');
  });

  it('RESET returns to idle from any phase', () => {
    expect(apply(running(), { type: 'RESET' })).toEqual(initialRunState());
  });
});
