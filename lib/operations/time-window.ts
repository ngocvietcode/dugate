export const CALENDAR_PRESETS = [
  'today',
  'this_month',
  'last_month',
  'three_month_trend',
] as const;

export type CalendarPreset = (typeof CALENDAR_PRESETS)[number];
export type CalendarBucketUnit = 'hour' | 'day';

export interface ResolvedTimeWindow {
  preset: CalendarPreset;
  queryTimestamp: Date;
  timeZone: string;
  start: Date;
  end: Date;
  startInclusive: true;
  endInclusive: boolean;
  bucket: CalendarBucketUnit;
}

export interface CalendarBucket {
  unit: CalendarBucketUnit;
  start: Date;
  end: Date;
  startInclusive: true;
  endInclusive: boolean;
  clippedStart: boolean;
  clippedEnd: boolean;
  localKey: string;
  occurrence: number;
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

interface HourStartCandidate {
  instant: Date;
  offsetMs: number;
  minute: number;
}

const HOUR_MS = 60 * 60 * 1_000;
const MAX_WINDOW_DAYS = 370;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateKey(value: LocalDate): string {
  return `${String(value.year).padStart(4, '0')}-${pad(value.month)}-${pad(value.day)}`;
}

function localHourKey(value: LocalDateTime): string {
  return `${localDateKey(value)}T${pad(value.hour)}`;
}

function compareDates(left: Date, right: Date): number {
  return left.getTime() - right.getTime();
}

function sameLocalMinute(
  actual: LocalDateTime,
  expected: LocalDate & { hour: number; minute: number },
): boolean {
  return actual.year === expected.year
    && actual.month === expected.month
    && actual.day === expected.day
    && actual.hour === expected.hour
    && actual.minute === expected.minute
    && actual.second === 0;
}

function addLocalDays(value: LocalDate, amount: number): LocalDate {
  const result = new Date(Date.UTC(value.year, value.month - 1, value.day + amount));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function addLocalMonths(value: LocalDate, amount: number): LocalDate {
  const result = new Date(Date.UTC(value.year, value.month - 1 + amount, 1));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: 1,
  };
}

function minDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function isAtOrBeforeBoundary(
  value: Date,
  boundary: Date,
  boundaryInclusive: boolean,
): boolean {
  return boundaryInclusive
    ? value.getTime() <= boundary.getTime()
    : value.getTime() < boundary.getTime();
}

class ZonedBoundaryResolver {
  private readonly formatter: Intl.DateTimeFormat;
  private readonly offsetsByDate = new Map<string, number[]>();

  constructor(readonly timeZone: string) {
    try {
      this.formatter = new Intl.DateTimeFormat('en-CA', {
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
      this.formatter.format(new Date(0));
    } catch {
      throw new RangeError(`Invalid IANA time zone: ${timeZone}`);
    }
  }

  partsAt(instant: Date): LocalDateTime {
    const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};

    for (const part of this.formatter.formatToParts(instant)) {
      if (part.type !== 'literal') {
        values[part.type] = Number(part.value);
      }
    }

    const year = values.year;
    const month = values.month;
    const day = values.day;
    const rawHour = values.hour;
    const minute = values.minute;
    const second = values.second;

    if ([year, month, day, rawHour, minute, second].some((value) => value === undefined)) {
      throw new RangeError(`Unable to resolve calendar parts for time zone: ${this.timeZone}`);
    }

    return {
      year: year!,
      month: month!,
      day: day!,
      hour: rawHour === 24 ? 0 : rawHour!,
      minute: minute!,
      second: second!,
    };
  }

  dayStart(localDate: LocalDate): Date | null {
    for (let hour = 0; hour < 24; hour += 1) {
      const starts = this.hourStarts(localDate, hour);
      if (starts.length > 0) {
        return starts[0];
      }
    }

    return null;
  }

  firstAvailableDayStart(localDate: LocalDate): Date {
    let candidate = localDate;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const start = this.dayStart(candidate);
      if (start) {
        return start;
      }
      candidate = addLocalDays(candidate, 1);
    }

    throw new RangeError(
      `Unable to resolve a local day boundary near ${localDateKey(localDate)} in ${this.timeZone}`,
    );
  }

  hourStarts(localDate: LocalDate, hour: number): Date[] {
    const candidates: HourStartCandidate[] = [];

    for (const offsetMs of this.offsetsForDate(localDate)) {
      for (let minute = 0; minute < 60; minute += 1) {
        const naiveUtc = Date.UTC(
          localDate.year,
          localDate.month - 1,
          localDate.day,
          hour,
          minute,
          0,
          0,
        );
        const instant = new Date(naiveUtc - offsetMs);

        if (sameLocalMinute(this.partsAt(instant), { ...localDate, hour, minute })) {
          candidates.push({ instant, offsetMs, minute });
          break;
        }
      }
    }

    candidates.sort((left, right) => compareDates(left.instant, right.instant));

    const starts: HourStartCandidate[] = [];
    for (const candidate of candidates) {
      const previous = starts.at(-1);
      if (!previous) {
        starts.push(candidate);
        continue;
      }

      if (candidate.instant.getTime() === previous.instant.getTime()) {
        continue;
      }

      // A lower UTC offset means the wall clock moved backwards and this local
      // hour has another real occurrence. Forward jumps remain one local bucket.
      if (candidate.offsetMs < previous.offsetMs) {
        starts.push(candidate);
      }
    }

    return starts.map(({ instant }) => instant);
  }

  private offsetsForDate(localDate: LocalDate): number[] {
    const key = localDateKey(localDate);
    const cached = this.offsetsByDate.get(key);
    if (cached) {
      return cached;
    }

    const approximateNoon = Date.UTC(localDate.year, localDate.month - 1, localDate.day, 12);
    const offsets = new Set<number>();

    // Sampling the surrounding three UTC days captures both sides of any IANA
    // offset transition affecting this local date, including date-line changes.
    for (let deltaHours = -36; deltaHours <= 36; deltaHours += 1) {
      const instant = new Date(approximateNoon + deltaHours * HOUR_MS);
      const local = this.partsAt(instant);
      const instantWithoutMilliseconds = Math.floor(instant.getTime() / 1_000) * 1_000;
      offsets.add(Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
      ) - instantWithoutMilliseconds);
    }

    const result = [...offsets];
    this.offsetsByDate.set(key, result);
    return result;
  }
}

function requireValidQueryTimestamp(value: Date): Date {
  const result = new Date(value.getTime());
  if (Number.isNaN(result.getTime())) {
    throw new RangeError('Query timestamp must be a valid Date');
  }
  return result;
}

function enumerateLocalDates(start: LocalDate, end: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  let current = start;

  for (let count = 0; count <= MAX_WINDOW_DAYS; count += 1) {
    dates.push(current);
    if (localDateKey(current) === localDateKey(end)) {
      return dates;
    }
    current = addLocalDays(current, 1);
  }

  throw new RangeError('Calendar window exceeds the supported one-year boundary range');
}

function uniqueSortedDates(values: Date[]): Date[] {
  const timestamps = [...new Set(values.map((value) => value.getTime()))].sort((a, b) => a - b);
  return timestamps.map((timestamp) => new Date(timestamp));
}

/**
 * Resolves one server-authoritative calendar preset from a single query timestamp.
 * Current presets have an inclusive query-timestamp end; last month is half-open.
 */
export function resolveTimeWindow(
  preset: CalendarPreset,
  queryTimestamp: Date,
  timeZone: string,
): ResolvedTimeWindow {
  if (!CALENDAR_PRESETS.includes(preset)) {
    throw new RangeError(`Unsupported calendar preset: ${String(preset)}`);
  }

  const queryTime = requireValidQueryTimestamp(queryTimestamp);
  const resolver = new ZonedBoundaryResolver(timeZone);
  const localQuery = resolver.partsAt(queryTime);
  const currentDate: LocalDate = {
    year: localQuery.year,
    month: localQuery.month,
    day: localQuery.day,
  };
  const currentMonth: LocalDate = {
    year: localQuery.year,
    month: localQuery.month,
    day: 1,
  };

  if (preset === 'last_month') {
    const previousMonth = addLocalMonths(currentMonth, -1);
    return {
      preset,
      queryTimestamp: queryTime,
      timeZone,
      start: resolver.firstAvailableDayStart(previousMonth),
      end: resolver.firstAvailableDayStart(currentMonth),
      startInclusive: true,
      endInclusive: false,
      bucket: 'day',
    };
  }

  const startDate = preset === 'today'
    ? currentDate
    : preset === 'this_month'
      ? currentMonth
      : addLocalMonths(currentMonth, -2);

  return {
    preset,
    queryTimestamp: queryTime,
    timeZone,
    start: resolver.firstAvailableDayStart(startDate),
    end: queryTime,
    startInclusive: true,
    endInclusive: true,
    bucket: preset === 'today' ? 'hour' : 'day',
  };
}

/**
 * Builds real UTC intervals for local calendar hours or days. The final current
 * bucket is clipped to Query_Timestamp; a half-open historical window remains
 * exclusive at its end. Repeated local hours receive increasing occurrences.
 */
export function buildCalendarBuckets(window: ResolvedTimeWindow): CalendarBucket[] {
  const queryTime = requireValidQueryTimestamp(window.queryTimestamp);
  if (queryTime.getTime() !== window.queryTimestamp.getTime()) {
    throw new RangeError('Window query timestamp is invalid');
  }
  if (window.start.getTime() > window.end.getTime()) {
    throw new RangeError('Calendar window start must not be after its end');
  }

  const resolver = new ZonedBoundaryResolver(window.timeZone);
  const localStart = resolver.partsAt(window.start);
  const localEnd = resolver.partsAt(window.end);
  const startDate: LocalDate = {
    year: localStart.year,
    month: localStart.month,
    day: localStart.day,
  };
  const endDate: LocalDate = {
    year: localEnd.year,
    month: localEnd.month,
    day: localEnd.day,
  };
  const boundaryEndDate = addLocalDays(endDate, 1);
  const discoveredBoundaries: Date[] = [];

  for (const localDate of enumerateLocalDates(startDate, boundaryEndDate)) {
    if (window.bucket === 'day') {
      const dayStart = resolver.dayStart(localDate);
      if (dayStart) {
        discoveredBoundaries.push(dayStart);
      }
      continue;
    }

    for (let hour = 0; hour < 24; hour += 1) {
      discoveredBoundaries.push(...resolver.hourStarts(localDate, hour));
    }
  }

  const windowStartIsNatural = discoveredBoundaries.some(
    (boundary) => boundary.getTime() === window.start.getTime(),
  );
  const naturalBoundaries = uniqueSortedDates([
    ...discoveredBoundaries,
    new Date(window.start),
  ]);
  const bucketStarts = naturalBoundaries.filter((boundary) => (
    boundary.getTime() >= window.start.getTime()
      && isAtOrBeforeBoundary(boundary, window.end, window.endInclusive)
  ));
  const occurrenceByKey = new Map<string, number>();

  return bucketStarts.map((start) => {
    const nextNaturalBoundary = naturalBoundaries.find(
      (boundary) => boundary.getTime() > start.getTime(),
    );
    if (!nextNaturalBoundary) {
      throw new RangeError('Unable to resolve the next local calendar boundary');
    }

    const end = minDate(nextNaturalBoundary, window.end);
    const reachesWindowEnd = end.getTime() === window.end.getTime();
    const local = resolver.partsAt(start);
    const key = window.bucket === 'hour' ? localHourKey(local) : localDateKey(local);
    const occurrence = (occurrenceByKey.get(key) ?? 0) + 1;
    occurrenceByKey.set(key, occurrence);

    return {
      unit: window.bucket,
      start: new Date(start),
      end: new Date(end),
      startInclusive: true as const,
      endInclusive: reachesWindowEnd ? window.endInclusive : false,
      clippedStart: start.getTime() === window.start.getTime() && !windowStartIsNatural,
      clippedEnd: reachesWindowEnd && end.getTime() < nextNaturalBoundary.getTime(),
      localKey: key,
      occurrence,
    };
  });
}
