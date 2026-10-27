import {
  buildCalendarBuckets,
  resolveTimeWindow,
  type ResolvedTimeWindow,
} from '../../lib/operations/time-window';

describe('resolveTimeWindow', () => {
  const timeZone = 'Asia/Ho_Chi_Minh';
  const queryTimestamp = new Date('2025-01-15T05:34:56.789Z');

  it('resolves current presets from one query timestamp in the configured timezone', () => {
    const today = resolveTimeWindow('today', queryTimestamp, timeZone);
    const thisMonth = resolveTimeWindow('this_month', queryTimestamp, timeZone);
    const threeMonths = resolveTimeWindow('three_month_trend', queryTimestamp, timeZone);

    expect(today).toMatchObject({
      startInclusive: true,
      endInclusive: true,
      bucket: 'hour',
    });
    expect(today.start.toISOString()).toBe('2025-01-14T17:00:00.000Z');
    expect(today.end).toEqual(queryTimestamp);

    expect(thisMonth.start.toISOString()).toBe('2024-12-31T17:00:00.000Z');
    expect(thisMonth.end).toEqual(queryTimestamp);
    expect(thisMonth.bucket).toBe('day');

    expect(threeMonths.start.toISOString()).toBe('2024-10-31T17:00:00.000Z');
    expect(threeMonths.end).toEqual(queryTimestamp);
    expect(threeMonths.bucket).toBe('day');
  });

  it('resolves last month as a half-open interval across a year rollover', () => {
    const window = resolveTimeWindow('last_month', queryTimestamp, timeZone);

    expect(window.start.toISOString()).toBe('2024-11-30T17:00:00.000Z');
    expect(window.end.toISOString()).toBe('2024-12-31T17:00:00.000Z');
    expect(window.startInclusive).toBe(true);
    expect(window.endInclusive).toBe(false);
  });

  it('rejects invalid timestamps and IANA timezone identifiers', () => {
    expect(() => resolveTimeWindow('today', new Date(Number.NaN), timeZone)).toThrow(RangeError);
    expect(() => resolveTimeWindow('today', queryTimestamp, 'Not/A_Timezone')).toThrow(
      'Invalid IANA time zone',
    );
  });
});

describe('buildCalendarBuckets', () => {
  it('skips a nonexistent spring-forward hour and clips the current hour', () => {
    const window = resolveTimeWindow(
      'today',
      new Date('2024-03-10T16:30:00.000Z'),
      'America/New_York',
    );
    const buckets = buildCalendarBuckets(window);

    expect(buckets.map((bucket) => bucket.localKey)).toEqual([
      '2024-03-10T00',
      '2024-03-10T01',
      '2024-03-10T03',
      '2024-03-10T04',
      '2024-03-10T05',
      '2024-03-10T06',
      '2024-03-10T07',
      '2024-03-10T08',
      '2024-03-10T09',
      '2024-03-10T10',
      '2024-03-10T11',
      '2024-03-10T12',
    ]);
    expect(buckets[1].start.toISOString()).toBe('2024-03-10T06:00:00.000Z');
    expect(buckets[1].end.toISOString()).toBe('2024-03-10T07:00:00.000Z');
    expect(buckets.at(-1)).toMatchObject({
      end: window.end,
      endInclusive: true,
      clippedEnd: true,
    });
  });

  it('emits both occurrences of a repeated fall-back hour', () => {
    const window = resolveTimeWindow(
      'today',
      new Date('2024-11-03T17:30:00.000Z'),
      'America/New_York',
    );
    const buckets = buildCalendarBuckets(window);
    const repeated = buckets.filter((bucket) => bucket.localKey === '2024-11-03T01');

    expect(repeated).toHaveLength(2);
    expect(repeated.map((bucket) => bucket.occurrence)).toEqual([1, 2]);
    expect(repeated.map((bucket) => bucket.start.toISOString())).toEqual([
      '2024-11-03T05:00:00.000Z',
      '2024-11-03T06:00:00.000Z',
    ]);
    expect(repeated.map((bucket) => bucket.end.toISOString())).toEqual([
      '2024-11-03T06:00:00.000Z',
      '2024-11-03T07:00:00.000Z',
    ]);
  });

  it('uses local day boundaries whose elapsed duration may be 23 hours', () => {
    const window: ResolvedTimeWindow = {
      preset: 'last_month',
      queryTimestamp: new Date('2024-03-12T04:00:00.000Z'),
      timeZone: 'America/New_York',
      start: new Date('2024-03-09T05:00:00.000Z'),
      end: new Date('2024-03-12T04:00:00.000Z'),
      startInclusive: true,
      endInclusive: false,
      bucket: 'day',
    };
    const buckets = buildCalendarBuckets(window);

    expect(buckets.map((bucket) => bucket.localKey)).toEqual([
      '2024-03-09',
      '2024-03-10',
      '2024-03-11',
    ]);
    expect(buckets.map((bucket) => (
      bucket.end.getTime() - bucket.start.getTime()
    ) / 3_600_000)).toEqual([24, 23, 24]);
    expect(buckets.every((bucket) => !bucket.endInclusive && !bucket.clippedEnd)).toBe(true);
  });

  it('clips both edges when a custom window starts and ends inside local hours', () => {
    const window: ResolvedTimeWindow = {
      preset: 'today',
      queryTimestamp: new Date('2025-01-15T04:45:00.000Z'),
      timeZone: 'Asia/Ho_Chi_Minh',
      start: new Date('2025-01-15T03:15:00.000Z'),
      end: new Date('2025-01-15T04:45:00.000Z'),
      startInclusive: true,
      endInclusive: true,
      bucket: 'hour',
    };
    const buckets = buildCalendarBuckets(window);

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({
      localKey: '2025-01-15T10',
      start: window.start,
      clippedStart: true,
      clippedEnd: false,
    });
    expect(buckets[1]).toMatchObject({
      localKey: '2025-01-15T11',
      end: window.end,
      endInclusive: true,
      clippedStart: false,
      clippedEnd: true,
    });
  });

  it('keeps an inclusive zero-length bucket when Query_Timestamp is exactly a boundary', () => {
    const window = resolveTimeWindow(
      'today',
      new Date('2025-01-15T03:00:00.000Z'),
      'Asia/Ho_Chi_Minh',
    );
    const buckets = buildCalendarBuckets(window);
    const finalBucket = buckets.at(-1)!;

    expect(finalBucket.localKey).toBe('2025-01-15T10');
    expect(finalBucket.start).toEqual(window.end);
    expect(finalBucket.end).toEqual(window.end);
    expect(finalBucket.endInclusive).toBe(true);
  });
});
