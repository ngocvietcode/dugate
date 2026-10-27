import * as fc from 'fast-check';

import type {
  BusinessOperationProjection,
  OperationRequestProjectionSource,
} from '@/lib/operations/projection';
import {
  buildBusinessOperationTrend,
  type BusinessOperationTrendPoint,
} from '@/lib/operations/reference-helpers';
import type {
  BusinessStatus,
  ValidBusinessStatus,
} from '@/lib/operations/status';
import {
  CALENDAR_PRESETS,
  resolveTimeWindow,
  type CalendarBucketUnit,
  type ResolvedTimeWindow,
} from '@/lib/operations/time-window';

const REPRESENTATIVE_TIME_ZONES = [
  'UTC',
  'Asia/Ho_Chi_Minh',
  'America/New_York',
  'Europe/Berlin',
  'Australia/Sydney',
] as const;

const DST_TRANSITION_TIMESTAMPS = [
  new Date('2024-03-10T12:30:00.000Z'),
  new Date('2024-11-03T12:30:00.000Z'),
  new Date('2024-03-31T12:30:00.000Z'),
  new Date('2024-10-27T12:30:00.000Z'),
  new Date('2024-04-07T12:30:00.000Z'),
  new Date('2024-10-06T12:30:00.000Z'),
] as const;

const VALID_STATUSES: readonly ValidBusinessStatus[] = [
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED',
];
const POSITION_SCALE = 1_000_000;

interface OperationSeed {
  position: number;
  anchor: 'START' | 'MIDDLE' | 'END';
  status: BusinessStatus;
}

interface TrendScenario {
  timeZone: (typeof REPRESENTATIVE_TIME_ZONES)[number];
  preset: (typeof CALENDAR_PRESETS)[number];
  queryTimestamp: Date;
  operationSeeds: OperationSeed[];
}

const queryTimestampArbitrary = fc.oneof(
  fc.date({
    min: new Date('2023-01-01T00:00:00.000Z'),
    max: new Date('2028-12-31T23:59:59.999Z'),
    noInvalidDate: true,
  }),
  fc.constantFrom(...DST_TRANSITION_TIMESTAMPS),
);

const scenarioArbitrary: fc.Arbitrary<TrendScenario> = fc.record({
  timeZone: fc.constantFrom(...REPRESENTATIVE_TIME_ZONES),
  preset: fc.constantFrom(...CALENDAR_PRESETS),
  queryTimestamp: queryTimestampArbitrary,
  operationSeeds: fc.array(
    fc.record({
      position: fc.integer({ min: 0, max: POSITION_SCALE }),
      anchor: fc.constantFrom('START', 'MIDDLE', 'END'),
      status: fc.constantFrom<BusinessStatus>(
        'IN_PROGRESS',
        'SUCCEEDED',
        'FAILED',
        'N/A',
      ),
    }),
    { minLength: 0, maxLength: 20 },
  ),
});

function instantForSeed(seed: OperationSeed, window: ResolvedTimeWindow): Date {
  const start = window.start.getTime();
  const lastIncluded = window.endInclusive
    ? window.end.getTime()
    : window.end.getTime() - 1;

  if (seed.anchor === 'START' || lastIncluded <= start) {
    return new Date(start);
  }
  if (seed.anchor === 'END') {
    return new Date(lastIncluded);
  }

  return new Date(
    start + Math.floor(((lastIncluded - start) * seed.position) / POSITION_SCALE),
  );
}

function createOperation(
  index: number,
  seed: OperationSeed,
  window: ResolvedTimeWindow,
): BusinessOperationProjection<OperationRequestProjectionSource> {
  const id = `operation-${index}`;
  const startTime = instantForSeed(seed, window);

  return {
    businessGroupKey: `request:${id}`,
    identity: { kind: 'standalone', requestId: id },
    operationIdentifier: id,
    normalizedReference: null,
    profileScope: { kind: 'internal' },
    operationTypes: [],
    businessStatus: seed.status,
    invalidData: seed.status === 'N/A',
    requestCount: 1,
    startTime,
    updatedTime: new Date(startTime),
    endTime: null,
    durationSeconds: null,
    requests: [],
  };
}

function isWithinPoint(
  instant: Date,
  point: BusinessOperationTrendPoint,
): boolean {
  const timestamp = instant.getTime();
  const afterStart = point.startInclusive
    ? timestamp >= point.start.getTime()
    : timestamp > point.start.getTime();
  const beforeEnd = point.endInclusive
    ? timestamp <= point.end.getTime()
    : timestamp < point.end.getTime();
  return afterStart && beforeEnd;
}

function emptyCounts(): Record<ValidBusinessStatus, number> {
  return {
    IN_PROGRESS: 0,
    SUCCEEDED: 0,
    FAILED: 0,
  };
}

function expectedLocalKey(
  instant: Date,
  timeZone: string,
  unit: CalendarBucketUnit,
): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  const dateKey = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

  return unit === 'hour'
    ? `${dateKey}T${String(parts.hour === 24 ? 0 : parts.hour).padStart(2, '0')}`
    : dateKey;
}

function verifyBucketPartition(
  points: readonly BusinessOperationTrendPoint[],
  window: ResolvedTimeWindow,
): void {
  expect(points.length).toBeGreaterThan(0);
  expect(points[0].start).toEqual(window.start);
  expect(points.at(-1)?.end).toEqual(window.end);

  const occurrences = new Map<string, number>();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[index - 1];
    const occurrence = (occurrences.get(point.localKey) ?? 0) + 1;
    occurrences.set(point.localKey, occurrence);

    expect(point.unit).toBe(window.bucket);
    expect(point.localKey).toBe(
      expectedLocalKey(point.start, window.timeZone, window.bucket),
    );
    expect(point.occurrence).toBe(occurrence);
    expect(point.startInclusive).toBe(true);
    expect(point.end.getTime()).toBeGreaterThanOrEqual(point.start.getTime());

    if (previous) {
      expect(previous.end).toEqual(point.start);
      expect(previous.endInclusive).toBe(false);
    }
  }

  expect(points.at(-1)?.endInclusive).toBe(window.endInclusive);
}

describe('Business Operation trend partition property', () => {
  // Feature: operations-request-tracking, Property 17: Trend là partition theo local calendar bucket
  // **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8**
  it('partitions operations once by local start-time bucket and valid status series', () => {
    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const window = resolveTimeWindow(
          scenario.preset,
          scenario.queryTimestamp,
          scenario.timeZone,
        );
        const operations = scenario.operationSeeds.map((seed, index) => (
          createOperation(index, seed, window)
        ));
        const points = buildBusinessOperationTrend(operations, window);
        const expectedCounts = points.map(emptyCounts);

        verifyBucketPartition(points, window);

        for (const operation of operations) {
          const matchingIndexes = points
            .map((point, index) => (isWithinPoint(operation.startTime, point) ? index : -1))
            .filter((index) => index >= 0);

          expect(matchingIndexes).toHaveLength(1);
          if (operation.businessStatus !== 'N/A') {
            expectedCounts[matchingIndexes[0]][operation.businessStatus] += 1;
          }
        }

        for (let index = 0; index < points.length; index += 1) {
          const point = points[index];
          const expected = expectedCounts[index];
          const expectedTotal = VALID_STATUSES.reduce(
            (sum, status) => sum + expected[status],
            0,
          );

          expect(point.counts).toEqual(expected);
          expect(point.total).toBe(expectedTotal);
          expect(VALID_STATUSES.reduce(
            (sum, status) => sum + point.counts[status],
            0,
          )).toBe(point.total);

          if (expectedTotal === 0) {
            expect(point.counts).toEqual(emptyCounts());
          }
        }

        const expectedValidOperationCount = operations.filter(
          (operation) => operation.businessStatus !== 'N/A',
        ).length;
        expect(points.reduce((sum, point) => sum + point.total, 0)).toBe(
          expectedValidOperationCount,
        );
      }),
      { numRuns: 100 },
    );
  });
});
