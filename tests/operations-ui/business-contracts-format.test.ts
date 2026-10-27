import {
  BUSINESS_DASHBOARD_KPIS,
  BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS,
  BUSINESS_STATUS_BADGE_CONFIG,
  type BusinessOperationDetailResponse,
  type BusinessOperationsDashboardResponse,
  type ConstituentRequestItem,
} from '../../app/operations/types';
import {
  MISSING_VALUE_DISPLAY,
  NOT_AVAILABLE_DISPLAY,
  PROCESSING_DISPLAY,
  displayConstituentValue,
  formatAverageBusinessTokens,
  formatBusinessCostUsd,
  formatBusinessDurationSeconds,
  formatBusinessRate,
  formatBusinessTokens,
  formatConstituentCompletedAt,
  formatFixedDecimal,
  shouldShowConstituentErrorPanel,
} from '../../app/operations/lib/business-format';

describe('Business Operations client contracts', () => {
  it('defines exactly the four approved calendar filters', () => {
    expect(BUSINESS_OPERATIONS_TIME_RANGE_OPTIONS).toEqual([
      { value: 'today', label: 'Hôm nay' },
      { value: 'this_month', label: 'Tháng này' },
      { value: 'last_month', label: 'Tháng trước' },
      { value: 'three_month_trend', label: 'Xu hướng 3 tháng' },
    ]);
  });

  it('defines exactly the five top-level KPI cards', () => {
    expect(BUSINESS_DASHBOARD_KPIS).toEqual([
      { key: 'totalCases', label: 'Total Cases' },
      { key: 'tokensProcessed', label: 'Tokens Processed' },
      { key: 'totalCostUsd', label: 'Total Cost USD' },
      { key: 'logicSuccessRate', label: 'Logic Success Rate' },
      { key: 'aiExtractionRate', label: 'AI Extraction Rate' },
    ]);
  });

  it('maps every business status to stable badge semantics', () => {
    expect(BUSINESS_STATUS_BADGE_CONFIG.IN_PROGRESS).toMatchObject({ label: 'Đang xử lý' });
    expect(BUSINESS_STATUS_BADGE_CONFIG.SUCCEEDED.className).toContain('green');
    expect(BUSINESS_STATUS_BADGE_CONFIG.FAILED.className).toContain('red');
    expect(BUSINESS_STATUS_BADGE_CONFIG['N/A']).toMatchObject({ label: 'N/A' });
  });

  it('accepts the complete dashboard and breakdown-card response shape', () => {
    const response: BusinessOperationsDashboardResponse = {
      queryTimestamp: '2026-08-19T09:30:00.000Z',
      calendarTimezone: 'Asia/Ho_Chi_Minh',
      resolvedWindow: {
        start: '2026-08-18T17:00:00.000Z',
        end: '2026-08-19T09:30:00.000Z',
        startInclusive: true,
        endInclusive: true,
        preset: 'today',
      },
      appliedFilter: {
        range: 'today',
        profile: 'ALL',
        operationType: 'ALL',
        status: 'ALL',
        search: null,
        page: 1,
        sort: 'recent',
      },
      summary: {
        totalCases: 2,
        tokensProcessed: 3500,
        totalCostUsd: '12.3400000000',
        logicSuccessRate: 100,
        aiExtractionRate: null,
        p95DurationSeconds: 45,
        unpricedRequestCount: 1,
        costIncomplete: true,
      },
      breakdownCards: [{
        profileScope: { id: 'profile-1', name: 'Payroll' },
        operationType: 'workflows:payroll',
        businessOperationCount: 2,
        succeededCount: 1,
        failedCount: 1,
        successPercentage: 50,
        requestCount: 3,
        inputTokens: 2000,
        outputTokens: 1500,
        costUsd: '12.3400000000',
        averageTokensPerBusinessOperation: 1750,
        averageDurationSeconds: 30.5,
        maxDurationSeconds: 45,
        maxTokenCount: 2000,
        maxDurationOperationIdentifier: 'CASE-2',
        maxTokenOperationIdentifier: 'CASE-1',
        maxDurationOperationToken: 'tok-max-dur',
        maxTokenOperationToken: 'tok-max-tok',
        unpricedRequestCount: 1,
        costIncomplete: true,
      }],
      trend: { bucket: 'hour', points: [] },
      list: { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 },
    };

    expect(response.breakdownCards[0]).toMatchObject({
      businessOperationCount: 2,
      succeededCount: 1,
      failedCount: 1,
      requestCount: 3,
      maxDurationOperationIdentifier: 'CASE-2',
      maxTokenOperationIdentifier: 'CASE-1',
    });
  });

  it('accepts the detail contract while retaining nullable source fields', () => {
    const request: ConstituentRequestItem = {
      id: 'request-1',
      operationType: null,
      state: 'FAILED',
      startedAt: '2026-08-19T09:00:00.000Z',
      completedAt: null,
      inputTokens: null,
      outputTokens: 10,
      costUsd: null,
      errorCode: null,
      errorMessage: 'Provider timeout',
      missingData: true,
      unpricedCost: false,
    };
    const response: BusinessOperationDetailResponse = {
      queryTimestamp: '2026-08-19T09:30:00.000Z',
      operation: {
        token: 'signed-token',
        operationIdentifier: 'CASE-1',
        normalizedReference: 'CASE-1',
        profileScope: { id: 'profile-1', name: 'Payroll' },
        operationTypes: ['workflows:payroll'],
        businessStatus: 'FAILED',
        invalidData: false,
        requestCount: 1,
        startTime: request.startedAt,
        updatedTime: request.startedAt,
        totalTokens: 10,
        totalCostUsd: '0.0000000000',
        unpricedRequestCount: 0,
        missingData: true,
        endTime: null,
        durationSeconds: null,
      },
      requests: { items: [request], page: 1, pageSize: 100, total: 1, totalPages: 1 },
    };

    expect(response.requests.items[0]).toBe(request);
    expect(response.operation.requestCount).toBe(1);
  });
});

describe('Business Operations display formatters', () => {
  it('formats fixed-decimal costs without number conversion or precision loss', () => {
    expect(formatFixedDecimal('00012345678901234567890.1234000000')).toBe(
      '12,345,678,901,234,567,890.1234',
    );
    expect(formatBusinessCostUsd('0001234.5600000000')).toBe('$1,234.56');
    expect(formatBusinessCostUsd('-12.5000000000')).toBe('-$12.5');
    expect(formatBusinessCostUsd('0.0000000000')).toBe('$0');
    expect(formatBusinessCostUsd(null)).toBe(MISSING_VALUE_DISPLAY);
    expect(formatBusinessCostUsd('invalid')).toBe(MISSING_VALUE_DISPLAY);
  });

  it('renders rates with two decimals and a null denominator as N/A', () => {
    expect(formatBusinessRate(98.5)).toBe('98.50%');
    expect(formatBusinessRate(100)).toBe('100.00%');
    expect(formatBusinessRate(null)).toBe(NOT_AVAILABLE_DISPLAY);
    expect(formatBusinessRate(Number.NaN)).toBe(NOT_AVAILABLE_DISPLAY);
  });

  it('formats token totals and one-decimal breakdown averages', () => {
    expect(formatBusinessTokens(1234567)).toBe('1,234,567');
    expect(formatBusinessTokens(null)).toBe(MISSING_VALUE_DISPLAY);
    expect(formatAverageBusinessTokens(1750)).toBe('1,750.0');
    expect(formatAverageBusinessTokens(null)).toBe(NOT_AVAILABLE_DISPLAY);
  });

  it('formats durations at one-decimal precision and uses N/A without terminal cases', () => {
    expect(formatBusinessDurationSeconds(12.34)).toBe('12.3s');
    expect(formatBusinessDurationSeconds(65.25)).toBe('1p 5s');
    expect(formatBusinessDurationSeconds(3661)).toBe('1h 1p 1s');
    expect(formatBusinessDurationSeconds(null)).toBe(NOT_AVAILABLE_DISPLAY);
    expect(formatBusinessDurationSeconds(-1)).toBe(NOT_AVAILABLE_DISPLAY);
  });

  it('applies constituent missing and processing display rules', () => {
    expect(displayConstituentValue(null)).toBe(MISSING_VALUE_DISPLAY);
    expect(displayConstituentValue('', (value) => value)).toBe('');
    expect(displayConstituentValue(1200, formatBusinessTokens)).toBe('1,200');
    expect(formatConstituentCompletedAt(null)).toBe(PROCESSING_DISPLAY);
    expect(formatConstituentCompletedAt('2026-08-19T09:30:00.000Z', () => '19/08/2026')).toBe(
      '19/08/2026',
    );
  });

  it('requires an always-visible error panel only for unsuccessful states', () => {
    expect(shouldShowConstituentErrorPanel('FAILED')).toBe(true);
    expect(shouldShowConstituentErrorPanel('CANCELLED')).toBe(true);
    expect(shouldShowConstituentErrorPanel('SUCCEEDED')).toBe(false);
    expect(shouldShowConstituentErrorPanel('RUNNING')).toBe(false);
  });
});
