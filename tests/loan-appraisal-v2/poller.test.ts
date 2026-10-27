import { ApiError } from '@/app/loan-appraisal-v2/lib/api';
import type { OperationOutcome } from '@/app/loan-appraisal-v2/lib/operation-mapper';
import { createPoller, type PollerDeps } from '@/app/loan-appraisal-v2/lib/poller';

// Timer giả: chạy callback theo thứ tự, thời gian do test điều khiển.
function harness(overrides: Partial<PollerDeps> = {}) {
  let clock = 0;
  const timers: Array<{ cb: () => void; at: number; id: number }> = [];
  let nextId = 1;
  const calls = { data: 0, fatal: [] as unknown[], soft: 0, stalled: 0, fetches: 0 };
  const deps: PollerDeps = {
    fetchOperation: async () => { calls.fetches += 1; return {}; },
    onData: () => { calls.data += 1; return 'running'; },
    onFatal: (e) => calls.fatal.push(e),
    onSoftTimeout: () => { calls.soft += 1; },
    onStalled: () => { calls.stalled += 1; },
    now: () => clock,
    setTimer: (cb, ms) => { const id = nextId++; timers.push({ cb, at: clock + ms, id }); return id; },
    clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
    ...overrides,
  };
  const poller = createPoller(deps);
  // Chạy timer kế tiếp và đợi các microtask xong.
  const step = async (advance = 2000) => {
    clock += advance;
    const t = timers.shift();
    if (t) t.cb();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };
  return { poller, calls, step, timers, setClock: (v: number) => { clock = v; } };
}

describe('poller', () => {
  it('polls sequentially and stops on a terminal outcome', async () => {
    const outcomes: OperationOutcome[] = ['running', 'running', 'done'];
    const h = harness({ onData: () => outcomes.shift() ?? 'done' });
    h.poller.start();
    await h.step(); await h.step();
    expect(h.poller.isActive()).toBe(true);
    await h.step();
    expect(h.poller.isActive()).toBe(false);
    expect(h.timers).toHaveLength(0);
  });

  it('2 consecutive errors continue; 3 stop with onFatal', async () => {
    const h = harness({ fetchOperation: async () => { throw new ApiError('http', 'x'); } });
    h.poller.start();
    await h.step(); await h.step();
    expect(h.calls.fatal).toHaveLength(0);
    expect(h.poller.isActive()).toBe(true);
    await h.step();
    expect(h.calls.fatal).toHaveLength(1);
    expect(h.poller.isActive()).toBe(false);
  });

  it('a success resets the error counter', async () => {
    let n = 0;
    const h = harness({ fetchOperation: async () => { n += 1; if (n === 3) return {}; throw new ApiError('http', 'x'); } });
    h.poller.start();
    for (let i = 0; i < 5; i += 1) await h.step();
    expect(h.calls.fatal).toHaveLength(0);
  });

  it('forbidden / not-found are fatal immediately', async () => {
    const h = harness({ fetchOperation: async () => { throw new ApiError('forbidden', 'no'); } });
    h.poller.start();
    await h.step();
    expect(h.calls.fatal).toHaveLength(1);
  });

  it('never overlaps requests', async () => {
    let release: () => void = () => undefined;
    let inFlight = 0; let maxInFlight = 0;
    const h = harness({
      fetchOperation: () => new Promise((resolve) => {
        inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
        release = () => { inFlight -= 1; resolve({}); };
      }),
    });
    h.poller.start();
    await h.step();
    expect(h.timers).toHaveLength(0); // chưa lên lịch vòng sau khi vòng trước chưa xong
    release();
    await Promise.resolve(); await Promise.resolve();
    await h.step();
    expect(maxInFlight).toBe(1);
  });

  it('soft timeout fires once and polling continues', async () => {
    const h = harness({ softTimeoutMs: 10_000, stallMs: 1_000_000 });
    h.poller.start();
    await h.step(11_000); await h.step(); await h.step();
    expect(h.calls.soft).toBe(1);
    expect(h.poller.isActive()).toBe(true);
    expect(h.calls.fatal).toHaveLength(0);
  });

  it('stalls after the stall window without fetching', async () => {
    const h = harness({ softTimeoutMs: 10, stallMs: 100 });
    h.poller.start();
    await h.step(500);
    expect(h.calls.stalled).toBe(1);
    expect(h.calls.fetches).toBe(0);
    expect(h.poller.isActive()).toBe(false);
  });

  it('drops a stale response after stop()', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    const h = harness({ fetchOperation: () => new Promise((r) => { resolve = r; }) });
    h.poller.start();
    await h.step();
    h.poller.stop();
    resolve({});
    await Promise.resolve(); await Promise.resolve();
    expect(h.calls.data).toBe(0);
  });

  it('abort errors are ignored', async () => {
    const h = harness({ fetchOperation: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } });
    h.poller.start();
    await h.step();
    expect(h.calls.fatal).toHaveLength(0);
  });
});
