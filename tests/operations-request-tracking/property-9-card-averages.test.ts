import fc from 'fast-check';

import {
  aggregateBusinessOperationBreakdown,
  type AggregationRequestSource,
} from '@/lib/operations/aggregation';
import { projectBusinessOperations } from '@/lib/operations/projection';

const TARGET_OPERATION_TYPE = 'target-operation';
const ANCILLARY_OPERATION_TYPE = 'ancillary-operation';
const BASE_TIMESTAMP = Date.parse('2026-01-01T00:00:00.000Z');

type GeneratedStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';

interface TokenMeasurement {
  input: number;
  output: number;
}

interface GeneratedOperation {
  targetRequests: TokenMeasurement[];
  ancillaryRequest: TokenMeasurement;
  status: GeneratedStatus;
  durationMilliseconds: number;
}

const tokenMeasurementArb = fc.record({
  input: fc.integer({ min: 0, max: 100_000 }),
  output: fc.integer({ min: 0, max: 100_000 }),
});

const operationsArb = fc.array(
  fc.record({
    targetRequests: fc.array(tokenMeasurementArb, { minLength: 1, maxLength: 4 }),
    ancillaryRequest: tokenMeasurementArb,
    status: fc.constantFrom<GeneratedStatus>('RUNNING', 'SUCCEEDED', 'FAILED'),
    durationMilliseconds: fc.integer({ min: 0, max: 3_600_000 }),
  }),
  { minLength: 1, maxLength: 12 },
);

function buildRequests(
  dataset: string,
  operations: readonly GeneratedOperation[],
): AggregationRequestSource[] {
  return operations.flatMap((operation, operationIndex) => {
    const createdAt = new Date(BASE_TIMESTAMP + operationIndex * 7_200_000);
    const terminal = operation.status === 'SUCCEEDED' || operation.status === 'FAILED';
    const completedAt = terminal
      ? new Date(createdAt.getTime() + operation.durationMilliseconds)
      : null;
    const updatedAt = completedAt ?? new Date(createdAt.getTime() + 1_000);

    const createRequest = (
      idSuffix: string,
      endpointSlug: string,
      tokens: TokenMeasurement,
    ): AggregationRequestSource => ({
      id: `${dataset}-${operationIndex}-${idSuffix}`,
      apiKeyId: 'profile-card-averages',
      clientReference: `${dataset}-operation-${operationIndex}`,
      endpointSlug,
      state: operation.status,
      createdAt,
      updatedAt,
      completedAt,
      deletedAt: null,
      hiddenFromOperations: false,
      totalInputTokens: tokens.input,
      totalOutputTokens: tokens.output,
      totalCostUsd: '0',
      logicResult: null,
      extractionResult: null,
      inputTokensMissing: false,
      outputTokensMissing: false,
      costMissing: false,
      hasUnpricedCost: false,
    });

    return [
      ...operation.targetRequests.map((tokens, requestIndex) => createRequest(
        `target-${requestIndex}`,
        TARGET_OPERATION_TYPE,
        tokens,
      )),
      createRequest('ancillary', ANCILLARY_OPERATION_TYPE, operation.ancillaryRequest),
    ];
  });
}

function targetCard(operations: readonly GeneratedOperation[], dataset: string) {
  const cards = aggregateBusinessOperationBreakdown(
    projectBusinessOperations(buildRequests(dataset, operations)),
  );
  const card = cards.find(({ operationType }) => operationType === TARGET_OPERATION_TYPE);
  if (!card) throw new Error('Expected generated target-operation card');
  return card;
}

function roundPositiveRatioOnceToOneDecimal(
  numerator: number,
  denominator: number,
): number {
  const roundedTenths = Math.floor(
    (numerator * 20 + denominator) / (denominator * 2),
  );
  return roundedTenths / 10;
}

function expectedTargetTokenAverage(operations: readonly GeneratedOperation[]): number {
  const totalTokens = operations.reduce((operationTotal, operation) => (
    operationTotal + operation.targetRequests.reduce(
      (requestTotal, request) => requestTotal + request.input + request.output,
      0,
    )
  ), 0);

  return roundPositiveRatioOnceToOneDecimal(totalTokens, operations.length);
}

function expectedTerminalDurationAverage(
  operations: readonly GeneratedOperation[],
): number | null {
  const terminalOperations = operations.filter(({ status }) => status !== 'RUNNING');
  if (terminalOperations.length === 0) return null;

  const totalDurationMilliseconds = terminalOperations.reduce(
    (total, operation) => total + operation.durationMilliseconds,
    0,
  );
  return roundPositiveRatioOnceToOneDecimal(
    totalDurationMilliseconds,
    terminalOperations.length * 1_000,
  );
}

describe('Business Operation card average property', () => {
  // Feature: operations-request-tracking, Property 9: Card averages dùng đúng mẫu số và terminal subset
  // **Validates: Requirements 5.9, 5.10, 5.15**
  it('uses card totals per distinct operation and only terminal durations with one final rounding', () => {
    fc.assert(
      fc.property(operationsArb, (operations) => {
        const card = targetCard(operations, 'generated');

        expect(card.businessOperationCount).toBe(operations.length);
        expect(card.averageTokensPerBusinessOperation).toBe(
          expectedTargetTokenAverage(operations),
        );
        expect(card.averageDurationSeconds).toBe(
          expectedTerminalDurationAverage(operations),
        );

        const activeOnlyOperations = operations.map((operation) => ({
          ...operation,
          status: 'RUNNING' as const,
        }));
        const activeOnlyCard = targetCard(activeOnlyOperations, 'active-only');

        expect(activeOnlyCard.averageTokensPerBusinessOperation).toBe(
          expectedTargetTokenAverage(activeOnlyOperations),
        );
        expect(activeOnlyCard.averageDurationSeconds).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
