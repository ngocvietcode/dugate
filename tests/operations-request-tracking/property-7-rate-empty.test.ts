import * as fc from 'fast-check';

import {
  aggregateBusinessOperations,
  type AggregationRequestSource,
} from '@/lib/operations/aggregation';
import {
  buildBusinessOperationTrend,
  createBusinessOperationListPage,
} from '@/lib/operations/reference-helpers';
import { projectBusinessOperations } from '@/lib/operations/projection';
import {
  CALENDAR_PRESETS,
  resolveTimeWindow,
} from '@/lib/operations/time-window';

const REPRESENTATIVE_TIME_ZONES = [
  'UTC',
  'Asia/Ho_Chi_Minh',
  'America/New_York',
  'Europe/Berlin',
] as const;

const rateCountsArb = fc.integer({ min: 1, max: 40 }).chain((denominator) =>
  fc.record({
    denominator: fc.constant(denominator),
    numerator: fc.integer({ min: 0, max: denominator }),
  }));

const scenarioArb = fc.record({
  logic: rateCountsArb,
  extraction: rateCountsArb,
  preset: fc.constantFrom(...CALENDAR_PRESETS),
  queryTimestamp: fc.date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2030-12-31T23:59:59.999Z'),
    noInvalidDate: true,
  }),
  timeZone: fc.constantFrom(...REPRESENTATIVE_TIME_ZONES),
});

function request(
  id: string,
  logicResult: AggregationRequestSource['logicResult'],
  extractionResult: AggregationRequestSource['extractionResult'],
): AggregationRequestSource {
  return {
    id,
    apiKeyId: 'profile-a',
    clientReference: id,
    endpointSlug: 'extract',
    state: 'SUCCEEDED',
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:01:00.000Z'),
    completedAt: new Date('2026-03-01T00:01:00.000Z'),
    deletedAt: null,
    hiddenFromOperations: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: '0',
    logicResult,
    extractionResult,
    inputTokensMissing: false,
    outputTokensMissing: false,
    costMissing: false,
    hasUnpricedCost: false,
  };
}

function roundPercentageOnce(numerator: number, denominator: number): number {
  return Math.round((numerator * 10_000) / denominator) / 100;
}

describe('Business Operation rate and empty snapshot property', () => {
  // Feature: operations-request-tracking, Property 7: Rate và empty snapshot có biểu diễn xác định
  // **Validates: Requirements 3.13, 3.14, 3.15, 4.6, 4.7, 4.8, 4.10, 4.11, 4.12**
  it('rounds eligible rates once and represents every empty snapshot section deterministically', () => {
    fc.assert(
      fc.property(scenarioArb, ({ logic, extraction, preset, queryTimestamp, timeZone }) => {
        const requests: AggregationRequestSource[] = [];

        for (let index = 0; index < logic.denominator; index += 1) {
          requests.push(request(
            `logic-${index}`,
            index < logic.numerator ? 'PASS' : 'FAIL',
            null,
          ));
        }
        for (let index = 0; index < extraction.denominator; index += 1) {
          requests.push(request(
            `extraction-${index}`,
            null,
            index < extraction.numerator ? 'SUCCESS' : 'FAIL',
          ));
        }

        const populated = aggregateBusinessOperations(
          projectBusinessOperations(requests),
        );
        expect(populated.summary.logicSuccessRate).toBe(
          roundPercentageOnce(logic.numerator, logic.denominator),
        );
        expect(populated.summary.aiExtractionRate).toBe(
          roundPercentageOnce(extraction.numerator, extraction.denominator),
        );

        const emptyOperations = projectBusinessOperations<AggregationRequestSource>([]);
        const emptyAggregation = aggregateBusinessOperations(emptyOperations);
        const emptyList = createBusinessOperationListPage(emptyOperations, 1);
        const emptyTrend = buildBusinessOperationTrend(
          emptyOperations,
          resolveTimeWindow(preset, queryTimestamp, timeZone),
        );

        expect(emptyAggregation.summary).toMatchObject({
          totalCases: 0,
          tokensProcessed: 0,
          totalCostUsd: '0.0000000000',
          logicSuccessRate: null,
          aiExtractionRate: null,
          unpricedRequestCount: 0,
          costIncomplete: false,
        });
        expect(emptyAggregation.breakdownCards).toEqual([]);
        expect(emptyList.items).toEqual([]);
        expect(emptyList.total).toBe(0);
        expect(emptyTrend.length).toBeGreaterThan(0);
        expect(emptyTrend.every((point) => (
          point.total === 0
          && point.counts.IN_PROGRESS === 0
          && point.counts.SUCCEEDED === 0
          && point.counts.FAILED === 0
        ))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
