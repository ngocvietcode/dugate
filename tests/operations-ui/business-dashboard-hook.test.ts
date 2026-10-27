import type { DependencyList, EffectCallback, Reducer } from 'react';
import type {
  BusinessOperationsDashboardResponse,
  BusinessOperationsFilterState,
} from '../../app/operations/types';

interface RefSlot<T = unknown> {
  kind: 'ref';
  value: { current: T };
}

interface ReducerSlot<State = unknown, Action = unknown> {
  kind: 'reducer';
  state: State;
  reducer: Reducer<State, Action>;
  dispatch: (action: Action) => void;
}

interface CallbackSlot<T = unknown> {
  kind: 'callback';
  callback: T;
  dependencies: DependencyList;
}

interface EffectSlot {
  kind: 'effect';
  dependencies: DependencyList | undefined;
  effect: EffectCallback;
  cleanup?: () => void;
}

type HookSlot = RefSlot | ReducerSlot<any, any> | CallbackSlot | EffectSlot;

let mockActiveRuntime: HookRuntime<unknown> | null = null;

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(
      callback: T,
      dependencies: DependencyList,
    ): T => mockActiveRuntime!.useCallback(callback, dependencies),
    useEffect: (effect: EffectCallback, dependencies?: DependencyList): void => {
      mockActiveRuntime!.useEffect(effect, dependencies);
    },
    useReducer: <State, Action>(
      reducer: Reducer<State, Action>,
      initialArg: State,
      initializer?: (arg: State) => State,
    ): [State, (action: Action) => void] => mockActiveRuntime!.useReducer(
      reducer,
      initialArg,
      initializer,
    ),
    useRef: <T>(initialValue: T): { current: T } => mockActiveRuntime!.useRef(initialValue),
  };
});

import {
  BUSINESS_DASHBOARD_POLL_INTERVAL_MS,
  BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS,
  DEFAULT_BUSINESS_OPERATIONS_FILTER,
  useBusinessOperationsDashboard,
  type UseBusinessOperationsDashboardReturn,
} from '../../app/operations/hooks/useBusinessOperationsDashboard';

function dependenciesEqual(
  left: DependencyList | undefined,
  right: DependencyList | undefined,
): boolean {
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

/**
 * Minimal deterministic React hook runtime for the repository's Node-only Jest
 * environment. It runs the real hook without adding jsdom or a test dependency.
 */
class HookRuntime<Result> {
  private readonly slots: HookSlot[] = [];
  private readonly pendingEffects = new Set<number>();
  private cursor = 0;
  private factory: (() => Result) | null = null;

  result!: Result;

  mount(factory: () => Result): void {
    this.factory = factory;
    this.render();
  }

  render(): void {
    if (this.factory === null) throw new Error('Hook runtime is not mounted');
    this.cursor = 0;
    mockActiveRuntime = this as HookRuntime<unknown>;
    try {
      this.result = this.factory();
    } finally {
      mockActiveRuntime = null;
    }
  }

  flushEffects(): void {
    while (this.pendingEffects.size > 0) {
      const effectIndexes = [...this.pendingEffects];
      this.pendingEffects.clear();
      for (const index of effectIndexes) {
        const slot = this.slots[index] as EffectSlot;
        slot.cleanup?.();
        const cleanup = slot.effect();
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
    }
  }

  unmount(): void {
    for (const slot of this.slots) {
      if (slot.kind === 'effect') slot.cleanup?.();
    }
    this.slots.length = 0;
    this.pendingEffects.clear();
    this.factory = null;
  }

  useRef<T>(initialValue: T): { current: T } {
    const index = this.cursor++;
    let slot = this.slots[index] as RefSlot<T> | undefined;
    if (slot === undefined) {
      slot = { kind: 'ref', value: { current: initialValue } };
      this.slots[index] = slot;
    }
    return slot.value;
  }

  useReducer<State, Action>(
    reducer: Reducer<State, Action>,
    initialArg: State,
    initializer?: (arg: State) => State,
  ): [State, (action: Action) => void] {
    const index = this.cursor++;
    let slot = this.slots[index] as ReducerSlot<State, Action> | undefined;
    if (slot === undefined) {
      const nextSlot: ReducerSlot<State, Action> = {
        kind: 'reducer',
        state: initializer === undefined ? initialArg : initializer(initialArg),
        reducer,
        dispatch: (action: Action) => {
          nextSlot.state = nextSlot.reducer(nextSlot.state, action);
          this.render();
        },
      };
      slot = nextSlot;
      this.slots[index] = slot;
    } else {
      slot.reducer = reducer;
    }
    return [slot.state, slot.dispatch];
  }

  useCallback<T>(callback: T, dependencies: DependencyList): T {
    const index = this.cursor++;
    let slot = this.slots[index] as CallbackSlot<T> | undefined;
    if (slot === undefined || !dependenciesEqual(slot.dependencies, dependencies)) {
      slot = { kind: 'callback', callback, dependencies };
      this.slots[index] = slot;
    }
    return slot.callback;
  }

  useEffect(effect: EffectCallback, dependencies?: DependencyList): void {
    const index = this.cursor++;
    let slot = this.slots[index] as EffectSlot | undefined;
    if (slot === undefined) {
      slot = { kind: 'effect', effect, dependencies };
      this.slots[index] = slot;
      this.pendingEffects.add(index);
      return;
    }
    if (!dependenciesEqual(slot.dependencies, dependencies)) {
      slot.effect = effect;
      slot.dependencies = dependencies;
      this.pendingEffects.add(index);
    }
  }
}

class FakeDocument {
  visibilityState: 'visible' | 'hidden' = 'visible';
  private readonly listeners = new Map<EventListenerOrEventListenerObject, () => void>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'visibilitychange') return;
    this.listeners.set(listener, typeof listener === 'function'
      ? () => listener({ type } as Event)
      : () => listener.handleEvent({ type } as Event));
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'visibilitychange') this.listeners.delete(listener);
  }

  setVisibility(state: 'visible' | 'hidden'): void {
    this.visibilityState = state;
    for (const listener of this.listeners.values()) listener();
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(data: BusinessOperationsDashboardResponse): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

function dashboardResponse(
  queryTimestamp: string,
  filter: BusinessOperationsFilterState = DEFAULT_BUSINESS_OPERATIONS_FILTER,
): BusinessOperationsDashboardResponse {
  return {
    queryTimestamp,
    calendarTimezone: 'Asia/Ho_Chi_Minh',
    resolvedWindow: {
      start: '2026-08-18T17:00:00.000Z',
      end: queryTimestamp,
      startInclusive: true,
      endInclusive: true,
      preset: filter.range,
    },
    appliedFilter: {
      range: filter.range,
      profile: filter.profile,
      operationType: filter.operationType,
      status: filter.status,
      search: filter.query.trim()
        ? { query: filter.query.trim(), mode: filter.searchMode }
        : null,
      page: filter.page,
      sort: filter.sort,
    },
    summary: {
      totalCases: 1,
      tokensProcessed: 100,
      totalCostUsd: '1.0000000000',
      logicSuccessRate: 100,
      aiExtractionRate: 100,
      p95DurationSeconds: null,
      unpricedRequestCount: 0,
      costIncomplete: false,
    },
    breakdownCards: [],
    trend: { bucket: filter.range === 'today' ? 'hour' : 'day', points: [] },
    list: { items: [], page: filter.page, pageSize: 50, total: 1, totalPages: 1 },
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function mountDashboardHook(
  initialFilter: BusinessOperationsFilterState = DEFAULT_BUSINESS_OPERATIONS_FILTER,
): HookRuntime<UseBusinessOperationsDashboardReturn> {
  const runtime = new HookRuntime<UseBusinessOperationsDashboardReturn>();
  runtime.mount(() => useBusinessOperationsDashboard({ initialFilter }));
  return runtime;
}

describe('useBusinessOperationsDashboard deterministic state and request behavior', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let runtime: HookRuntime<UseBusinessOperationsDashboardReturn> | null;
  let fakeDocument: FakeDocument;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-19T09:00:00.000Z'));
    fakeDocument = new FakeDocument();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: fakeDocument,
    });
    runtime = null;
  });

  afterEach(() => {
    runtime?.unmount();
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, 'document', originalDocument);
  });

  it('shows initial loading, exposes an isolated initial error, and retries to a complete snapshot', async () => {
    const initial = deferred<Response>();
    const retry = deferred<Response>();
    global.fetch = jest.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(retry.promise) as jest.MockedFunction<typeof fetch>;

    runtime = mountDashboardHook();
    expect(runtime.result).toMatchObject({
      phase: 'initial-loading',
      loading: true,
      isInitialLoading: true,
      data: null,
      error: null,
    });

    runtime.flushEffects();
    initial.reject(new Error('network unavailable'));
    await flushPromises();

    expect(runtime.result.phase).toBe('initial-error');
    expect(runtime.result.loading).toBe(false);
    expect(runtime.result.data).toBeNull();
    expect(runtime.result.appliedFilter).toBeNull();
    expect(runtime.result.error?.message).toBe('network unavailable');

    const retryPromise = runtime.result.retry();
    expect(runtime.result.phase).toBe('initial-loading');
    expect(runtime.result.loading).toBe(true);

    const data = dashboardResponse('2026-08-19T09:01:00.000Z');
    retry.resolve(response(data));
    await retryPromise;

    expect(runtime.result.phase).toBe('ready');
    expect(runtime.result.loading).toBe(false);
    expect(runtime.result.data).toBe(data);
    expect(runtime.result.appliedFilter).toBe(data.appliedFilter);
    expect(runtime.result.error).toBeNull();
  });

  it('keeps draft and applied filters separate and discards a superseded dashboard response', async () => {
    const initial = deferred<Response>();
    const filtered = deferred<Response>();
    const fetchMock = jest.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(filtered.promise);
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    runtime = mountDashboardHook();
    runtime.flushEffects();
    const initialSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;

    runtime.result.updateDraftFilter({ profile: 'profile-2', page: 3 });
    expect(runtime.result.draftFilter).toMatchObject({ profile: 'profile-2', page: 3 });
    expect(runtime.result.appliedFilter).toBeNull();

    const applyPromise = runtime.result.applyDraftFilter();
    expect(initialSignal.aborted).toBe(true);
    expect(runtime.result.phase).toBe('initial-loading');

    const staleData = dashboardResponse('2026-08-19T09:01:00.000Z');
    initial.resolve(response(staleData));
    await flushPromises();
    expect(runtime.result.data).toBeNull();

    const appliedFilter = {
      ...DEFAULT_BUSINESS_OPERATIONS_FILTER,
      profile: 'profile-2',
      page: 3,
    };
    const currentData = dashboardResponse('2026-08-19T09:02:00.000Z', appliedFilter);
    filtered.resolve(response(currentData));
    await applyPromise;

    expect(runtime.result.data).toBe(currentData);
    expect(runtime.result.data?.queryTimestamp).toBe('2026-08-19T09:02:00.000Z');
    expect(runtime.result.appliedFilter).toEqual(currentData.appliedFilter);
    expect(runtime.result.draftFilter).toEqual(appliedFilter);
  });

  it('pauses today polling while hidden, resumes when visible, and never overlaps refreshes', async () => {
    const refresh = deferred<Response>();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response(dashboardResponse('2026-08-19T09:00:00.000Z')))
      .mockReturnValueOnce(refresh.promise);
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    runtime = mountDashboardHook();
    runtime.flushEffects();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fakeDocument.setVisibility('hidden');
    jest.advanceTimersByTime(BUSINESS_DASHBOARD_POLL_INTERVAL_MS * 2);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fakeDocument.setVisibility('visible');
    jest.advanceTimersByTime(0);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runtime.result.phase).toBe('refreshing');

    await runtime.result.refresh();
    jest.advanceTimersByTime(BUSINESS_DASHBOARD_POLL_INTERVAL_MS * 2);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    refresh.resolve(response(dashboardResponse('2026-08-19T09:03:00.000Z')));
    await flushPromises();
    expect(runtime.result.phase).toBe('ready');
  });

  it('does not poll a successful non-today snapshot', async () => {
    const filter: BusinessOperationsFilterState = {
      ...DEFAULT_BUSINESS_OPERATIONS_FILTER,
      range: 'this_month',
    };
    const fetchMock = jest.fn().mockResolvedValue(response(
      dashboardResponse('2026-08-19T09:00:00.000Z', filter),
    ));
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    runtime = mountDashboardHook(filter);
    runtime.flushEffects();
    await flushPromises();
    jest.advanceTimersByTime(BUSINESS_DASHBOARD_POLL_INTERVAL_MS * 3);
    await flushPromises();

    expect(runtime.result.phase).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the last complete snapshot and reports a stale warning after refresh failure', async () => {
    const data = dashboardResponse('2026-08-19T09:00:00.000Z');
    const refreshFailure = deferred<Response>();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response(data))
      .mockReturnValueOnce(refreshFailure.promise);
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    runtime = mountDashboardHook();
    runtime.flushEffects();
    await flushPromises();

    const refreshPromise = runtime.result.refresh();
    expect(runtime.result.phase).toBe('refreshing');
    expect(runtime.result.data).toBe(data);

    refreshFailure.reject(new Error('refresh unavailable'));
    await refreshPromise;

    expect(runtime.result.phase).toBe('stale-ready');
    expect(runtime.result.loading).toBe(false);
    expect(runtime.result.data).toBe(data);
    expect(runtime.result.appliedFilter).toBe(data.appliedFilter);
    expect(runtime.result.data?.queryTimestamp).toBe(data.queryTimestamp);
    expect(runtime.result.error).toBeNull();
    expect(runtime.result.staleWarning?.message).toBe('refresh unavailable');
  });

  it('turns a 30-second initial timeout into an error and cleans the request timer after retry', async () => {
    const timedOut = deferred<Response>();
    const retryData = dashboardResponse('2026-08-19T09:02:00.000Z');
    const signals: AbortSignal[] = [];
    const fetchMock = jest.fn((_: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      if (signals.length === 2) return Promise.resolve(response(retryData));
      signal.addEventListener('abort', () => {
        timedOut.reject(new DOMException('Aborted', 'AbortError'));
      });
      return timedOut.promise;
    });
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    runtime = mountDashboardHook();
    runtime.flushEffects();
    jest.advanceTimersByTime(BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS);
    await flushPromises();

    expect(signals[0].aborted).toBe(true);
    expect(runtime.result.phase).toBe('initial-error');
    expect(runtime.result.loading).toBe(false);
    expect(runtime.result.error).toMatchObject({
      status: 504,
      code: 'DASHBOARD_TIMEOUT',
      retryable: true,
      timedOut: true,
    });

    await runtime.result.retry();
    expect(runtime.result.phase).toBe('ready');
    expect(runtime.result.data).toBe(retryData);
    jest.advanceTimersByTime(BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS + 1);
    expect(signals[1].aborted).toBe(false);
  });
});
