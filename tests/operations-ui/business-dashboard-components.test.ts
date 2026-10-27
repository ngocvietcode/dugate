import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DashboardStats from '../../app/operations/components/DashboardStats';
import BusinessBreakdownGrid from '../../app/operations/components/BusinessBreakdownGrid';
import TrendChart, {
  createTrendDrillDown,
  type BusinessTrendDrillDown,
} from '../../app/operations/components/TrendChart';
import type {
  BusinessOperationBreakdownCard,
  BusinessOperationTrendPoint,
  BusinessOperationsSummary,
} from '../../app/operations/types';

const summary: BusinessOperationsSummary = {
  totalCases: 12,
  tokensProcessed: 987654,
  totalCostUsd: '1234.5600000000',
  logicSuccessRate: 91.25,
  aiExtractionRate: null,
  p95DurationSeconds: 90,
  unpricedRequestCount: 3,
  costIncomplete: true,
};

const breakdownCard: BusinessOperationBreakdownCard = {
  profileScope: { id: 'profile-payroll', name: 'Payroll Profile' },
  operationType: 'workflows:payroll-extraction',
  businessOperationCount: 8,
  succeededCount: 6,
  failedCount: 2,
  successPercentage: 75,
  requestCount: 13,
  inputTokens: 12000,
  outputTokens: 3450,
  costUsd: '42.7500000000',
  averageTokensPerBusinessOperation: 1931.3,
  averageDurationSeconds: 65.25,
  maxDurationSeconds: 90,
  maxTokenCount: 3000,
  maxDurationOperationIdentifier: 'CASE-SLOW-9',
  maxTokenOperationIdentifier: 'CASE-TOKEN-4',
  maxDurationOperationToken: 'tok-max-dur',
  maxTokenOperationToken: 'tok-max-tok',
  unpricedRequestCount: 2,
  costIncomplete: true,
};

const trendPoints: BusinessOperationTrendPoint[] = [
  {
    unit: 'hour',
    localKey: '2026-08-19T08:00',
    occurrence: 0,
    start: '2026-08-19T01:00:00.000Z',
    end: '2026-08-19T02:00:00.000Z',
    startInclusive: true,
    endInclusive: false,
    clippedStart: false,
    clippedEnd: false,
    counts: { IN_PROGRESS: 2, SUCCEEDED: 5, FAILED: 1 },
    total: 8,
  },
  {
    unit: 'hour',
    localKey: '2026-08-19T09:00',
    occurrence: 0,
    start: '2026-08-19T02:00:00.000Z',
    end: '2026-08-19T03:00:00.000Z',
    startInclusive: true,
    endInclusive: false,
    clippedStart: false,
    clippedEnd: false,
    counts: { IN_PROGRESS: 0, SUCCEEDED: 0, FAILED: 0 },
    total: 0,
  },
];

type HostElement = ReactElement<Record<string, unknown>, string>;

function findHostElements(node: ReactNode, type: string): HostElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findHostElements(child, type));
  }
  if (!isValidElement(node)) return [];

  const element = node as ReactElement<Record<string, unknown>>;
  const descendants = findHostElements(element.props.children as ReactNode, type);
  return typeof element.type === 'string' && element.type === type
    ? [element as HostElement, ...descendants]
    : descendants;
}

describe('Business Operations dashboard components', () => {
  it('renders exactly six business KPI cards with fixed formatting and incomplete-cost count', () => {
    const html = renderToStaticMarkup(createElement(DashboardStats, { summary }));

    expect((html.match(/<article/g) ?? [])).toHaveLength(6);
    expect(html).toContain('aria-label="Chỉ số tổng quan nghiệp vụ"');
    expect(html).toContain('Total Cases');
    expect(html).toContain('12');
    expect(html).toContain('Tokens Processed');
    expect(html).toContain('987,654');
    expect(html).toContain('Total Cost USD');
    expect(html).toContain('$1,234.56');
    expect(html).toContain('Logic Success Rate');
    expect(html).toContain('91.25%');
    expect(html).toContain('AI Extraction Rate');
    expect(html).toContain('N/A');
    expect(html).toContain('3 request chưa định giá');
    expect(html).toContain('role="status"');
  });

  it('renders zero/N/A empty KPI values without a stale incomplete-cost warning', () => {
    const html = renderToStaticMarkup(createElement(DashboardStats, {
      summary: {
        totalCases: 0,
        tokensProcessed: 0,
        totalCostUsd: '0.0000000000',
        logicSuccessRate: null,
        aiExtractionRate: null,
        p95DurationSeconds: null,
        unpricedRequestCount: 0,
        costIncomplete: false,
      },
    }));

    expect((html.match(/<article/g) ?? [])).toHaveLength(6);
    expect((html.match(/N\/A/g) ?? [])).toHaveLength(3);
    expect(html).toContain('$0');
    expect(html).not.toContain('request chưa định giá');
    expect(html).not.toContain('role="status"');
  });

  it('renders every approved breakdown metric, extrema, progress semantics, and card-level cost warning', () => {
    const html = renderToStaticMarkup(createElement(BusinessBreakdownGrid, {
      cards: [breakdownCard],
    }));

    expect(html).toContain('Payroll Profile');
    expect(html).toContain('workflows:payroll-extraction');
    expect(html).toContain('75.00%');
    expect(html).toContain('Cases');
    expect(html).toContain('Thành công');
    expect(html).toContain('Thất bại');
    expect(html).toContain('Requests');
    expect(html).toContain('15,450');
    expect(html).toContain('Input 12,000 · Output 3,450');
    expect(html).toContain('$42.75');
    expect(html).toContain('1,931.3');
    expect(html).toContain('1p 5s');
    expect(html).toContain('CASE-SLOW-9');
    expect(html).toContain('CASE-TOKEN-4');
    expect(html).toContain('2 request');
    expect(html).toContain('Tổng chi phí chưa đầy đủ');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Tỷ lệ thành công 75.00%"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="75"');
    expect(html).toContain('role="status"');
  });

  it('renders N/A terminal metrics and a dedicated empty breakdown state', () => {
    const noTerminalCard: BusinessOperationBreakdownCard = {
      ...breakdownCard,
      averageDurationSeconds: null,
      maxDurationOperationIdentifier: null,
      maxDurationOperationToken: null,
      unpricedRequestCount: 0,
      costIncomplete: false,
    };
    const cardHtml = renderToStaticMarkup(createElement(BusinessBreakdownGrid, {
      cards: [noTerminalCard],
    }));
    const emptyHtml = renderToStaticMarkup(createElement(BusinessBreakdownGrid, {
      cards: [],
    }));

    expect((cardHtml.match(/N\/A/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(cardHtml).not.toContain('Tổng chi phí chưa đầy đủ');
    expect(emptyHtml).toContain('Không có breakdown phù hợp');
    expect(emptyHtml).toContain('role="status"');
    expect(emptyHtml).toContain('aria-labelledby="business-breakdown-title"');
  });

  it('renders stacked series, preserves an explicit zero bucket, and exposes accessible native buttons', () => {
    const html = renderToStaticMarkup(createElement(TrendChart, {
      points: trendPoints,
      bucket: 'hour',
      onDrillDown: () => undefined,
    }));

    expect(html).toContain('Đang xử lý');
    expect(html).toContain('Thành công');
    expect(html).toContain('Thất bại');
    expect(html).toContain('Giờ 2026-08-19 08:00, Đang xử lý: 2 nghiệp vụ');
    expect(html).toContain('Giờ 2026-08-19 08:00, Thành công: 5 nghiệp vụ');
    expect(html).toContain('Giờ 2026-08-19 08:00, Thất bại: 1 nghiệp vụ');
    expect(html).toContain('Giờ 2026-08-19 09:00: 0 nghiệp vụ');
    expect(html).toContain('08h');
    expect(html).toContain('09h');
    expect(html).toContain('role="group"');
    expect(html).not.toContain('role="img"');
    expect((html.match(/<button type="button"/g) ?? [])).toHaveLength(3);
    expect((html.match(/focus-visible:ring-2/g) ?? [])).toHaveLength(3);
  });

  it('invokes trend drill-down from the selected accessible segment with exact boundaries and status', () => {
    const onDrillDown = jest.fn<void, [BusinessTrendDrillDown]>();
    const tree = TrendChart({ points: trendPoints, bucket: 'hour', onDrillDown });
    const segmentButtons = findHostElements(tree, 'button');
    const failedButton = segmentButtons.find(
      (button) => String(button.props['aria-label']).includes('Thất bại: 1 nghiệp vụ'),
    );

    expect(segmentButtons).toHaveLength(3);
    expect(failedButton).toBeDefined();
    expect(failedButton?.props.type).toBe('button');
    expect(failedButton?.props.className).toContain('focus-visible:ring-2');

    const click = failedButton?.props.onClick as (() => void) | undefined;
    click?.();

    expect(onDrillDown).toHaveBeenCalledTimes(1);
    expect(onDrillDown).toHaveBeenCalledWith({
      status: 'FAILED',
      start: '2026-08-19T01:00:00.000Z',
      end: '2026-08-19T02:00:00.000Z',
      startInclusive: true,
      endInclusive: false,
      localKey: '2026-08-19T08:00',
      occurrence: 0,
    });
  });

  it('builds a drill-down payload with the exact selected bucket boundaries and status', () => {
    expect(createTrendDrillDown(trendPoints[0], 'FAILED')).toEqual({
      status: 'FAILED',
      start: '2026-08-19T01:00:00.000Z',
      end: '2026-08-19T02:00:00.000Z',
      startInclusive: true,
      endInclusive: false,
      localKey: '2026-08-19T08:00',
      occurrence: 0,
    });
  });

  it('renders empty and failed trend states with status/alert semantics and retry control', () => {
    const emptyHtml = renderToStaticMarkup(createElement(TrendChart, {
      points: [],
      bucket: 'day',
    }));
    const errorHtml = renderToStaticMarkup(createElement(TrendChart, {
      points: trendPoints,
      bucket: 'day',
      error: 'Trend unavailable',
      onRetry: () => undefined,
    }));

    expect(emptyHtml).toContain('Không có dữ liệu xu hướng');
    expect(emptyHtml).toContain('role="status"');
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('aria-labelledby="business-trend-error-title"');
    expect(errorHtml).toContain('<button type="button"');
    expect(errorHtml).toContain('Thử lại');
  });
});
