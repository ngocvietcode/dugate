import fc from 'fast-check';
import {
  BUSINESS_DASHBOARD_POLL_INTERVAL_MS,
  BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS,
  businessOperationsDashboardReducer,
  createBusinessOperationsDashboardState,
  type BusinessDashboardRequestError,
  type BusinessDashboardRequestIntent,
  type BusinessOperationsDashboardState,
} from '../../app/operations/hooks/useBusinessOperationsDashboard';
import type {
  BusinessOperationsDashboardResponse,
  BusinessOperationsTimeRange,
} from '../../app/operations/types';

type ScheduledOutcome =
  | { kind: 'success'; durationMs: number; seed: number }
  | { kind: 'error'; durationMs: number; seed: number }
  | { kind: 'timeout'; durationMs: number; seed: number };

const LOADING_PHASES = new Set([
  'initial-loading',
  'refreshing',
  'loading-new-filter',
]);

const REQUEST_ERROR: BusinessDashboardRequestError = {
  message: 'Temporary dashboard failure',
  status: 503,
  code: 'DASHBOARD_UNAVAILABLE',
  retryable: true,
  timedOut: false,
};

const TIMEOUT_ERROR: BusinessDashboardRequestError = {
  message: 'Dashboard request timed out',
  status: 504,
  code: 'DASHBOARD_TIMEOUT',
  retryable: true,
  timedOut: true,
};

function snapshotFor(
  range: BusinessOperationsTimeRange,
  seed: number,
  sequence: number,
): BusinessOperationsDashboardResponse {
  const value = seed * 100 + sequence;
  const queryTimestamp = new Date(Date.UTC(2026, 0, 1) + value * 1_000).toISOString();
  const start = new Date(Date.UTC(2026, 0, 1) + value * 1_000 - 3_600_000).toISOString();
  const businessStatus = value % 2 === 0 ? 'SUCCEEDED' as const : 'FAILED' as const;

  return {
    queryTimestamp,
    calendarTimezone: value % 2 === 0 ? 'UTC' : 'Asia/Ho_Chi_Minh',
    resolvedWindow: {
      start,
      end: queryTimestamp,
      startInclusive: true,
      endInclusive: true,
      preset: range,
    },
    appliedFilter: {
      range,
      profile: `profile-${value}`,
      operationType: `operation-${value}`,
      status: businessStatus,
      search: { query: `case-${value}`, mode: value % 2 === 0 ? 'exact' : 'contains' },
      sort: 'recent',
      page: Math.abs(value % 10) + 1,
    },
    summary: {
      totalCases: Math.abs(value) + 1,
      tokensProcessed: Math.abs(value) + 10,
      totalCostUsd: `${Math.abs(value)}.0000000000`,
      logicSuccessRate: value % 2 === 0 ? 100 : 0,
      aiExtractionRate: value % 2 === 0 ? 75 : 25,
      p95DurationSeconds: Math.abs(value) + 4,
      unpricedRequestCount: Math.abs(value % 3),
      costIncomplete: value % 3 !== 0,
    },
    breakdownCards: [{
      profileScope: { id: `profile-${value}`, name: `Profile ${value}` },
      operationType: `operation-${value}`,
      businessOperationCount: 1,
      succeededCount: businessStatus === 'SUCCEEDED' ? 1 : 0,
      failedCount: businessStatus === 'FAILED' ? 1 : 0,
      successPercentage: businessStatus === 'SUCCEEDED' ? 100 : 0,
      requestCount: 1,
      inputTokens: Math.abs(value) + 1,
      outputTokens: Math.abs(value) + 2,
      costUsd: `${Math.abs(value)}.0000000000`,
      averageTokensPerBusinessOperation: Math.abs(value) + 3,
      averageDurationSeconds: Math.abs(value) + 4,
      maxDurationSeconds: Math.abs(value) + 4,
      maxTokenCount: Math.abs(value) * 2 + 3,
      maxDurationOperationIdentifier: `case-${value}`,
      maxTokenOperationIdentifier: `case-${value}`,
      maxDurationOperationToken: `token-${value}`,
      maxTokenOperationToken: `token-${value}`,
      unpricedRequestCount: 0,
      costIncomplete: false,
    }],
    trend: {
      bucket: range === 'today' ? 'hour' : 'day',
      points: [{
        unit: range === 'today' ? 'hour' : 'day',
        localKey: `bucket-${value}`,
        occurrence: 0,
        start,
        end: queryTimestamp,
        startInclusive: true,
        endInclusive: true,
        clippedStart: false,
        clippedEnd: true,
        counts: {
          IN_PROGRESS: 0,
          SUCCEEDED: businessStatus === 'SUCCEEDED' ? 1 : 0,
          FAILED: businessStatus === 'FAILED' ? 1 : 0,
        },
        total: 1,
      }],
    },
    list: {
      items: [{
        token: `token-${value}`,
        operationIdentifier: `case-${value}`,
        normalizedReference: `case-${value}`,
        profileScope: { id: `profile-${value}`, name: `Profile ${value}` },
        operationTypes: [`operation-${value}`],
        businessStatus,
        invalidData: false,
        requestCount: 1,
        startTime: start,
        updatedTime: queryTimestamp,
        endTime: queryTimestamp,
        durationSeconds: 3600,
        totalTokens: Math.abs(value) + 3,
        totalCostUsd: `${Math.abs(value)}.0000000000`,
        unpricedRequestCount: 0,
        missingData: false,
      }],
      page: Math.abs(value % 10) + 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
    },
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A deterministic event-loop model for the hook contract. It uses the real
 * reducer for state transitions while modeling request completion, timeout,
 * and completion-to-next-poll scheduling without wall-clock timers.
 */
class FakeRefreshScheduler {
  state: BusinessOperationsDashboardState;
  nowMs = 0;
  readonly starts: number[] = [];
  readonly settles: number[] = [];
  maxConcurrentRequests = 0;
  private activeRequests = 0;
  private sequence = 0;
  private nextPollAt: number | null = null;

  constructor(readonly range: BusinessOperationsTimeRange) {
    this.state = createBusinessOperationsDashboardState({
      range,
      profile: 'ALL',
      operationType: 'ALL',
      status: 'ALL',
      query: '',
      searchMode: 'exact',
      sort: 'recent',
      page: 1,
    });
  }

  run(outcome: ScheduledOutcome, intent: BusinessDashboardRequestIntent): void {
    expect(this.tryStart(intent)).toBe(true);
    expect(this.tryStart('refresh')).toBe(false);

    const startedAt = this.nowMs;
    const previousData = this.state.data;
    const previousDataValue = deepClone(previousData);
    const previousTimestamp = previousData?.queryTimestamp ?? null;
    const effectiveDuration = outcome.kind === 'timeout'
      ? BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS
      : outcome.durationMs;

    this.nowMs += effectiveDuration;
    const sequence = this.sequence;

    if (outcome.kind === 'success') {
      const nextSnapshot = snapshotFor(this.range, outcome.seed, sequence);
      this.state = businessOperationsDashboardReducer(this.state, {
        type: 'request-succeeded',
        sequence,
        data: nextSnapshot,
      });

      expect(this.state.phase).toBe('ready');
      expect(this.state.data).toBe(nextSnapshot);
      expect(this.state.data).toEqual(nextSnapshot);
      expect(this.state.appliedFilter).toBe(nextSnapshot.appliedFilter);
      expect(this.state.data?.queryTimestamp).toBe(nextSnapshot.queryTimestamp);
    } else {
      const error = outcome.kind === 'timeout' ? TIMEOUT_ERROR : REQUEST_ERROR;
      this.state = businessOperationsDashboardReducer(this.state, {
        type: 'request-failed',
        sequence,
        error,
      });

      if (previousData === null) {
        expect(this.state.phase).toBe('initial-error');
        expect(this.state.data).toBeNull();
        expect(this.state.appliedFilter).toBeNull();
      } else {
        expect(this.state.phase).toBe('stale-ready');
        expect(this.state.data).toBe(previousData);
        expect(this.state.data).toEqual(previousDataValue);
        expect(this.state.data?.queryTimestamp).toBe(previousTimestamp);
      }
      if (outcome.kind === 'timeout') {
        expect(this.nowMs - startedAt).toBe(BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS);
      }
    }

    this.activeRequests -= 1;
    this.settles.push(this.nowMs);
    this.nextPollAt = this.range === 'today'
      ? this.nowMs + BUSINESS_DASHBOARD_POLL_INTERVAL_MS
      : null;

    expect(LOADING_PHASES.has(this.state.phase)).toBe(false);
  }

  runNextPoll(outcome: ScheduledOutcome): boolean {
    if (this.nextPollAt === null) return false;

    const previousSettle = this.settles[this.settles.length - 1];
    this.nowMs = this.nextPollAt;
    expect(this.nowMs - previousSettle).toBeGreaterThanOrEqual(0);
    expect(this.nowMs - previousSettle).toBeLessThanOrEqual(
      BUSINESS_DASHBOARD_POLL_INTERVAL_MS,
    );
    this.run(outcome, 'refresh');
    return true;
  }

  private tryStart(intent: BusinessDashboardRequestIntent): boolean {
    if (this.activeRequests > 0) return false;

    this.activeRequests += 1;
    this.maxConcurrentRequests = Math.max(
      this.maxConcurrentRequests,
      this.activeRequests,
    );
    this.sequence += 1;
    this.starts.push(this.nowMs);
    this.state = businessOperationsDashboardReducer(this.state, {
      type: 'request-started',
      sequence: this.sequence,
      intent,
    });
    expect(LOADING_PHASES.has(this.state.phase)).toBe(true);
    return true;
  }
}

const completedOutcomeArbitrary: fc.Arbitrary<ScheduledOutcome> = fc.oneof(
  fc.record({
    kind: fc.constant<'success'>('success'),
    durationMs: fc.integer({ min: 0, max: BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS - 1 }),
    seed: fc.integer({ min: 1, max: 10_000 }),
  }),
  fc.record({
    kind: fc.constant<'error'>('error'),
    durationMs: fc.integer({ min: 0, max: BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS - 1 }),
    seed: fc.integer({ min: 1, max: 10_000 }),
  }),
  fc.record({
    kind: fc.constant<'timeout'>('timeout'),
    durationMs: fc.integer({
      min: BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS,
      max: BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS * 3,
    }),
    seed: fc.integer({ min: 1, max: 10_000 }),
  }),
);

// Feature: operations-request-tracking, Property 18: Refresh state là atomic và không overlap
// **Validates: Requirements 10.4, 10.6, 10.8, 10.12, 10.13**
describe('Property 18: Refresh state là atomic và không overlap', () => {
  it('preserves atomic snapshots and obeys refresh scheduling for every outcome sequence', () => {
    fc.assert(
      fc.property(
        fc.array(completedOutcomeArbitrary, { minLength: 0, maxLength: 6 }),
        fc.integer({ min: 0, max: BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS - 1 }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.constantFrom<Exclude<BusinessOperationsTimeRange, 'today'>>(
          'this_month',
          'last_month',
          'three_month_trend',
        ),
        (generatedOutcomes, initialDurationMs, initialSeed, nonTodayRange) => {
          const today = new FakeRefreshScheduler('today');
          today.run({ kind: 'success', durationMs: initialDurationMs, seed: initialSeed }, 'initial');

          const outcomes: ScheduledOutcome[] = [
            ...generatedOutcomes,
            { kind: 'success', durationMs: initialDurationMs, seed: initialSeed + 1 },
            { kind: 'error', durationMs: initialDurationMs, seed: initialSeed + 2 },
            {
              kind: 'timeout',
              durationMs: BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS * 2,
              seed: initialSeed + 3,
            },
          ];
          outcomes.forEach((outcome) => expect(today.runNextPoll(outcome)).toBe(true));

          expect(today.maxConcurrentRequests).toBe(1);
          expect(today.starts).toHaveLength(today.settles.length);
          for (let index = 1; index < today.starts.length; index += 1) {
            expect(today.starts[index] - today.settles[index - 1]).toBeLessThanOrEqual(
              BUSINESS_DASHBOARD_POLL_INTERVAL_MS,
            );
          }

          const nonToday = new FakeRefreshScheduler(nonTodayRange);
          nonToday.run(
            { kind: 'success', durationMs: initialDurationMs, seed: initialSeed },
            'initial',
          );
          expect(nonToday.runNextPoll(outcomes[0])).toBe(false);
          expect(nonToday.starts).toHaveLength(1);
          expect(nonToday.maxConcurrentRequests).toBe(1);

          const coldError = new FakeRefreshScheduler('today');
          coldError.run(
            { kind: 'error', durationMs: initialDurationMs, seed: initialSeed },
            'initial',
          );
          expect(coldError.state.phase).toBe('initial-error');
          expect(coldError.state.data).toBeNull();

          const coldTimeout = new FakeRefreshScheduler('today');
          coldTimeout.run({
            kind: 'timeout',
            durationMs: BUSINESS_DASHBOARD_REQUEST_TIMEOUT_MS * 2,
            seed: initialSeed,
          }, 'initial');
          expect(coldTimeout.state.phase).toBe('initial-error');
          expect(coldTimeout.state.data).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
