import fc from 'fast-check';

import {
  aggregateBusinessOperationBreakdown,
  type AggregationRequestSource,
} from '@/lib/operations/aggregation';
import {
  projectBusinessOperations,
  type BusinessOperationProjection,
  type RequestProjection,
} from '@/lib/operations/projection';
import type { ProfileScope } from '@/lib/operations/business-key';

const businessStatusArb = fc.constantFrom(
  'IN_PROGRESS' as const,
  'SUCCEEDED' as const,
  'FAILED' as const,
);

const profileIdArb = fc.constantFrom<string | null>(
  null,
  'profile-a',
  'profile-b',
);

const measurementArb = fc.record({
  inputTokens: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: null }),
  outputTokens: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: null }),
  cost: fc.oneof(
    fc.integer({ min: 0, max: 10_000 }).map((value) => ({
      kind: 'priced' as const,
      value,
    })),
    fc.integer({ min: 0, max: 10_000 }).map((value) => ({
      kind: 'unpriced' as const,
      value,
    })),
    fc.constant({ kind: 'missing' as const, value: null }),
  ),
});

const operationSeedArb = fc.record({
  apiKeyId: profileIdArb,
  status: businessStatusArb,
  extract: measurementArb,
  validate: measurementArb,
  additionalRequests: fc.array(
    fc.record({
      operationType: fc.constantFrom<string | null>('extract', 'validate', 'enrich', null),
      measurement: measurementArb,
    }),
    { maxLength: 5 },
  ),
});

const datasetArb = fc.array(operationSeedArb, { minLength: 1, maxLength: 8 });

interface Measurement {
  inputTokens: number | null;
  outputTokens: number | null;
  cost:
    | { kind: 'priced'; value: number }
    | { kind: 'unpriced'; value: number }
    | { kind: 'missing'; value: null };
}

interface OperationSeed {
  apiKeyId: string | null;
  status: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
  extract: Measurement;
  validate: Measurement;
  additionalRequests: Array<{
    operationType: string | null;
    measurement: Measurement;
  }>;
}

type ProjectedOperation = BusinessOperationProjection<AggregationRequestSource>;
type ProjectedRequest = RequestProjection<AggregationRequestSource>;

interface ExpectedCard {
  profileScope: ProfileScope;
  operationType: string;
  operations: Map<string, ProjectedOperation>;
  requests: ProjectedRequest[];
}

function sourceState(status: OperationSeed['status']): AggregationRequestSource['state'] {
  if (status === 'SUCCEEDED') return 'SUCCEEDED';
  if (status === 'FAILED') return 'FAILED';
  return 'RUNNING';
}

function makeRequest(
  operationIndex: number,
  requestIndex: number,
  operationType: string | null,
  measurement: Measurement,
  seed: OperationSeed,
): AggregationRequestSource {
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, operationIndex, requestIndex));
  const terminal = seed.status !== 'IN_PROGRESS';

  return {
    id: `request-${operationIndex}-${requestIndex}`,
    apiKeyId: seed.apiKeyId,
    clientReference: `CASE-${operationIndex}`,
    endpointSlug: operationType,
    state: sourceState(seed.status),
    createdAt,
    updatedAt: new Date(createdAt.getTime() + 2_000),
    completedAt: terminal ? new Date(createdAt.getTime() + 1_000) : null,
    deletedAt: null,
    hiddenFromOperations: false,
    totalInputTokens: measurement.inputTokens,
    totalOutputTokens: measurement.outputTokens,
    totalCostUsd: measurement.cost.value === null
      ? null
      : String(measurement.cost.value),
    logicResult: null,
    extractionResult: null,
    inputTokensMissing: measurement.inputTokens === null,
    outputTokensMissing: measurement.outputTokens === null,
    costMissing: measurement.cost.kind === 'missing',
    hasUnpricedCost: measurement.cost.kind === 'unpriced',
  };
}

function buildRequests(seeds: readonly OperationSeed[]): AggregationRequestSource[] {
  return seeds.flatMap((seed, operationIndex) => {
    const typedMeasurements = [
      { operationType: 'extract', measurement: seed.extract },
      { operationType: 'validate', measurement: seed.validate },
      ...seed.additionalRequests,
    ];

    return typedMeasurements.map(({ operationType, measurement }, requestIndex) => (
      makeRequest(operationIndex, requestIndex, operationType, measurement, seed)
    ));
  });
}

function scopeKey(scope: ProfileScope): string {
  return scope.kind === 'internal' ? '__internal__' : scope.apiKeyId;
}

function cardKey(scope: ProfileScope, operationType: string): string {
  return JSON.stringify([scopeKey(scope), operationType]);
}

function buildExpectedCards(
  operations: readonly ProjectedOperation[],
): Map<string, ExpectedCard> {
  const expected = new Map<string, ExpectedCard>();

  for (const operation of operations) {
    for (const request of operation.requests) {
      if (request.operationType === null) continue;

      const key = cardKey(operation.profileScope, request.operationType);
      let card = expected.get(key);
      if (!card) {
        card = {
          profileScope: operation.profileScope,
          operationType: request.operationType,
          operations: new Map(),
          requests: [],
        };
        expected.set(key, card);
      }

      card.operations.set(operation.businessGroupKey, operation);
      card.requests.push(request);
    }
  }

  return expected;
}

function fixedIntegerCost(requests: readonly ProjectedRequest[]): string {
  const coefficient = requests.reduce((sum, request) => {
    const source = request.source;
    if (source.hasUnpricedCost || source.costMissing || source.totalCostUsd === null) {
      return sum;
    }
    return sum + BigInt(String(source.totalCostUsd));
  }, BigInt(0));

  return `${coefficient}.0000000000`;
}

describe('Business Operation breakdown partition property', () => {
  // Feature: operations-request-tracking, Property 8: Breakdown cards partition đúng theo profile và operation type
  // **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.16**
  it('partitions represented profile/type pairs and restricts request metrics to each card type', () => {
    fc.assert(
      fc.property(datasetArb, (seeds) => {
        const operations = projectBusinessOperations(buildRequests(seeds));
        const cards = aggregateBusinessOperationBreakdown(operations);
        const expectedCards = buildExpectedCards(operations);
        const actualCards = new Map(
          cards.map((card) => [cardKey(card.profileScope, card.operationType), card]),
        );

        expect([...actualCards.keys()].sort()).toEqual([...expectedCards.keys()].sort());

        for (const [key, expected] of expectedCards) {
          const actual = actualCards.get(key);
          expect(actual).toBeDefined();
          if (!actual) throw new Error(`Missing breakdown card ${key}`);

          const distinctOperations = [...expected.operations.values()];
          const inputTokens = expected.requests.reduce(
            (sum, request) => sum + (request.source.totalInputTokens ?? 0),
            0,
          );
          const outputTokens = expected.requests.reduce(
            (sum, request) => sum + (request.source.totalOutputTokens ?? 0),
            0,
          );
          const unpricedRequestIds = new Set(
            expected.requests
              .filter((request) => request.source.hasUnpricedCost)
              .map((request) => request.requestId),
          );

          expect(actual.profileScope).toEqual(expected.profileScope);
          expect(actual.operationType).toBe(expected.operationType);
          expect(actual.businessOperationCount).toBe(distinctOperations.length);
          expect(actual.succeededCount).toBe(
            distinctOperations.filter((operation) => operation.businessStatus === 'SUCCEEDED').length,
          );
          expect(actual.failedCount).toBe(
            distinctOperations.filter((operation) => operation.businessStatus === 'FAILED').length,
          );
          expect(actual.requestCount).toBe(expected.requests.length);
          expect(actual.inputTokens).toBe(inputTokens);
          expect(actual.outputTokens).toBe(outputTokens);
          expect(actual.costUsd).toBe(fixedIntegerCost(expected.requests));
          expect(actual.unpricedRequestCount).toBe(unpricedRequestIds.size);
          expect(actual.costIncomplete).toBe(unpricedRequestIds.size > 0);
          expect(expected.requests.every(
            (request) => request.operationType === expected.operationType,
          )).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
