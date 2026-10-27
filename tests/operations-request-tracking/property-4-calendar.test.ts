import * as fc from 'fast-check';

import {
  CALENDAR_PRESETS,
  resolveTimeWindow,
  type CalendarPreset,
} from '@/lib/operations/time-window';

const REPRESENTATIVE_TIME_ZONES = [
  'UTC',
  'Asia/Ho_Chi_Minh',
  'America/New_York',
  'Europe/Berlin',
  'Australia/Sydney',
] as const;

const DST_TRANSITION_TIMESTAMPS = [
  new Date('2024-03-10T16:30:00.000Z'),
  new Date('2024-11-03T17:30:00.000Z'),
  new Date('2024-03-31T12:30:00.000Z'),
  new Date('2024-10-27T12:30:00.000Z'),
  new Date('2024-04-07T12:30:00.000Z'),
  new Date('2024-10-06T12:30:00.000Z'),
] as const;

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const timestampArbitrary = fc.oneof(
  fc.date({
    min: new Date('2019-01-01T00:00:00.000Z'),
    max: new Date('2031-12-31T23:59:59.999Z'),
    noInvalidDate: true,
  }),
  fc.constantFrom(...DST_TRANSITION_TIMESTAMPS),
);

function localParts(instant: Date, timeZone: string): LocalDateTime {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function firstDayOfRelativeMonth(localQuery: LocalDateTime, offset: number): LocalDate {
  const date = new Date(Date.UTC(localQuery.year, localQuery.month - 1 + offset, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: 1,
  };
}

function expectedStartDate(preset: CalendarPreset, localQuery: LocalDateTime): LocalDate {
  if (preset === 'today') {
    return {
      year: localQuery.year,
      month: localQuery.month,
      day: localQuery.day,
    };
  }

  if (preset === 'last_month') {
    return firstDayOfRelativeMonth(localQuery, -1);
  }

  if (preset === 'three_month_trend') {
    return firstDayOfRelativeMonth(localQuery, -2);
  }

  return firstDayOfRelativeMonth(localQuery, 0);
}

function expectLocalMidnight(
  instant: Date,
  timeZone: string,
  expectedDate: LocalDate,
): void {
  expect(localParts(instant, timeZone)).toEqual({
    ...expectedDate,
    hour: 0,
    minute: 0,
    second: 0,
  });
  expect(instant.getUTCMilliseconds()).toBe(0);
}

describe('Calendar preset property', () => {
  // Feature: operations-request-tracking, Property 4: Calendar preset tạo đúng khoảng thời gian
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
  it('resolves every preset from local calendar boundaries in valid IANA timezones', () => {
    fc.assert(
      fc.property(timestampArbitrary, (queryTimestamp) => {
        for (const timeZone of REPRESENTATIVE_TIME_ZONES) {
          const localQuery = localParts(queryTimestamp, timeZone);

          for (const preset of CALENDAR_PRESETS) {
            const window = resolveTimeWindow(preset, queryTimestamp, timeZone);

            expect(window.preset).toBe(preset);
            expect(window.timeZone).toBe(timeZone);
            expect(window.queryTimestamp).toEqual(queryTimestamp);
            expect(window.startInclusive).toBe(true);
            expectLocalMidnight(
              window.start,
              timeZone,
              expectedStartDate(preset, localQuery),
            );

            if (preset === 'last_month') {
              expectLocalMidnight(
                window.end,
                timeZone,
                firstDayOfRelativeMonth(localQuery, 0),
              );
              expect(window.endInclusive).toBe(false);
              expect(window.bucket).toBe('day');
              expect(window.start.getTime()).toBeLessThan(window.end.getTime());
            } else {
              expect(window.end).toEqual(queryTimestamp);
              expect(window.endInclusive).toBe(true);
              expect(window.bucket).toBe(preset === 'today' ? 'hour' : 'day');
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
