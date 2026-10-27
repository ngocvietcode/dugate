import fc from 'fast-check';

import {
  aggregateBusinessOperationsSummary,
  type AggregationRequestSource,
  type ExtractionResult,
  type LogicResult,
} from '@/lib/operations/aggregation';
import { projectBusinessOperations } from '@/lib/operations/projection';

const DECIMAL_SCALE = 10;
const DECIMAL_FACTOR = BigInt(10) ** BigInt(DECIMAL_SCALE);

type GeneratedRequest = Pick<
  AggregationRequestSource,
  | 'totalInputTokens'
  | 'totalOutputTokens'
  | 'totalCostUsd'
  | 'logicResult'
  | 'extractionResult'
  | 'inputTokensMissing'
  | 'outputTokensMissing'
  | 'costMissing'
  | 'hasUnpricedCost'
>;

interface GeneratedGroup {
  requests: GeneratedRequest[];
}

interface SummaryOracle {
  totalCases: number;
  tokensProcessed: number;
  totalCostUsd: string;
  logicEligibleGroups: number;
  logicSuccessfulGroups: number;
  extractionEligibleGroups: number;
  extractionSuccessfulGroups: number;
  unpricedRequestCount: number;
}

const nullableTokensArb = fc.option(
  fc.integer({ min: 0, max: 1_000_000 }),
  { nil: null },
);

const exactCostArb = fc.option(
  fc.record({
    integer: fc.integer({ min: 0, max: 1_000_000 }),
    fraction: fc.integer({ min: 0, max: 9_999_999_999 }),
  }).map(({ integer, fraction }) => (
    `${integer}.${fraction.toString().padStart(DECIMAL_SCALE, '0')}`
  )),
  { nil: null },
);

const logicResultArb: fc.Arbitrary<LogicResult> = fc.constantFrom(
  null,
  'PASS',
  'FAIL',
);
const extractionResultArb: fc.Arbitrary<ExtractionResult> = fc.constantFrom(
  null,
  'SUCCESS',
  'FAIL',
);

const generatedRequestArb: fc.Arbitrary<GeneratedRequest> = fc.record({
  totalInputTokens: nullableTokensArb,
  totalOutputTokens: nullableTokensArb,
  totalCostUsd: exactCostArb,
  logicResult: logicResultArb,
  extractionResult: extractionResultArb,
  inputTokensMissing: fc.boolean(),
  outputTokensMissing: fc.boolean(),
  costMissing: fc.boolean(),
  hasUnpricedCost: fc.boolean(),
});

const groupsArb: fc.Arbitrary<GeneratedGroup[]> = fc.array(
  fc.record({
    requests: fc.array(generatedRequestArb, { minLength: 1, maxLength: 6 }),
  }),
  { minLength: 1, maxLength: 10 },
);

function sourceRequest(
  request: GeneratedRequest,
  groupIndex: number,
  requestIndex: number,
): AggregationRequestSource {
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, groupIndex, requestIndex));
  const completedAt = new Date(createdAt.getTime() + 1_000);

  return {
    id: `request-${groupIndex}-${requestIndex}`,
    apiKeyId: 'summary-profile',
    clientReference: `SUMMARY-${groupIndex}`,
    endpointSlug: 'summary',
    state: 'SUCCEEDED',
    createdAt,
    updatedAt: completedAt,
    completedAt,
    deletedAt: null,
    hiddenFromOperations: false,
    ...request,
  };
}

function calculateOracle(groups: readonly GeneratedGroup[]): SummaryOracle {
  let tokensProcessed = 0;
  let costCoefficient = BigInt(0);
  let logicEligibleGroups = 0;
  let logicSuccessfulGroups = 0;
  let extractionEligibleGroups = 0;
  let extractionSuccessfulGroups = 0;
  let unpricedRequestCount = 0;

  for (const group of groups) {
    const availableLogicResults: Array<'PASS' | 'FAIL'> = [];
    const availableExtractionResults: Array<'SUCCESS' | 'FAIL'> = [];

    for (const request of group.requests) {
      tokensProcessed += (request.totalInputTokens ?? 0)
        + (request.totalOutputTokens ?? 0);

      if (
        !request.hasUnpricedCost
        && !request.costMissing
        && request.totalCostUsd !== null
      ) {
        costCoefficient += parseFixedDecimal(String(request.totalCostUsd));
      }

      if (request.hasUnpricedCost) unpricedRequestCount += 1;
      if (request.logicResult !== null) {
        availableLogicResults.push(request.logicResult);
      }
      if (request.extractionResult !== null) {
        availableExtractionResults.push(request.extractionResult);
      }
    }

    if (availableLogicResults.length > 0) {
      logicEligibleGroups += 1;
      if (availableLogicResults.every((result) => result === 'PASS')) {
        logicSuccessfulGroups += 1;
      }
    }

    if (availableExtractionResults.length > 0) {
      extractionEligibleGroups += 1;
      if (availableExtractionResults.every((result) => result === 'SUCCESS')) {
        extractionSuccessfulGroups += 1;
      }
    }
  }

  return {
    totalCases: groups.length,
    tokensProcessed,
    totalCostUsd: formatFixedDecimal(costCoefficient),
    logicEligibleGroups,
    logicSuccessfulGroups,
    extractionEligibleGroups,
    extractionSuccessfulGroups,
    unpricedRequestCount,
  };
}

function parseFixedDecimal(value: string): bigint {
  const [integer, fraction = ''] = value.split('.');
  return BigInt(integer) * DECIMAL_FACTOR
    + BigInt(fraction.padEnd(DECIMAL_SCALE, '0'));
}

function formatFixedDecimal(coefficient: bigint): string {
  const digits = coefficient.toString().padStart(DECIMAL_SCALE + 1, '0');
  return `${digits.slice(0, -DECIMAL_SCALE)}.${digits.slice(-DECIMAL_SCALE)}`;
}

function expectedPercentage(successful: number, eligible: number): number | null {
  if (eligible === 0) return null;

  const scaledHundredths = BigInt(successful) * BigInt(10_000);
  const denominator = BigInt(eligible);
  const roundedHundredths = (
    scaledHundredths * BigInt(2) + denominator
  ) / (denominator * BigInt(2));
  return Number(roundedHundredths) / 100;
}

describe('Business Operation summary aggregation properties', () => {
  // Feature: operations-request-tracking, Property 6: Summary bảo toàn count, token, cost và business result
  // **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.9, 8.1, 8.2**
  it('preserves distinct groups, constituent measurements, and eligible business results', () => {
    fc.assert(
      fc.property(groupsArb, (groups) => {
        const sourceRequests = groups.flatMap((group, groupIndex) => (
          group.requests.map((request, requestIndex) => (
            sourceRequest(request, groupIndex, requestIndex)
          ))
        ));
        const projected = projectBusinessOperations(sourceRequests);
        const duplicatedProjectionRows = projected.flatMap((operation) => [
          operation,
          operation,
        ]);
        const actual = aggregateBusinessOperationsSummary(
          duplicatedProjectionRows,
        );
        const expected = calculateOracle(groups);

        expect(actual.totalCases).toBe(expected.totalCases);
        expect(actual.tokensProcessed).toBe(expected.tokensProcessed);
        expect(actual.totalCostUsd).toBe(expected.totalCostUsd);
        expect(actual.logicSuccessRate).toBe(expectedPercentage(
          expected.logicSuccessfulGroups,
          expected.logicEligibleGroups,
        ));
        expect(actual.aiExtractionRate).toBe(expectedPercentage(
          expected.extractionSuccessfulGroups,
          expected.extractionEligibleGroups,
        ));
        expect(actual.unpricedRequestCount).toBe(
          expected.unpricedRequestCount,
        );
        expect(actual.costIncomplete).toBe(
          expected.unpricedRequestCount > 0,
        );
      }),
      { numRuns: 100 },
    );
  });
});
