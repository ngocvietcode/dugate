import fc from 'fast-check';

import {
  aggregateBusinessOperations,
  type AggregationRequestSource,
} from '@/lib/operations/aggregation';
import { projectBusinessOperations } from '@/lib/operations/projection';

const BASE_TIMESTAMP = Date.parse('2026-01-01T00:00:00.000Z');
const ACTIVE_STATES = new Set(['RUNNING', 'PENDING', 'WAITING_USER_INPUT']);

type KnownState =
  | 'RUNNING'
  | 'PENDING'
  | 'WAITING_USER_INPUT'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

interface RequestSpec {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  state: KnownState;
  updatedOffsetSeconds: number;
}

interface RecomputationScenario {
  baseRequests: RequestSpec[];
  addedRequest: RequestSpec;
  replacementInputTokens: number;
  replacementOutputTokens: number;
  replacementCostUsd: number;
  replacementState: KnownState;
  permutationOffset: number;
}

interface CanonicalOperationOutput {
  businessGroupKey: string;
  operationIdentifier: string;
  requestIds: string[];
  requestCount: number;
  businessStatus: string;
  invalidData: boolean;
  startTime: string;
  updatedTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  summary: ReturnType<typeof aggregateBusinessOperations>['summary'];
  breakdownCards: ReturnType<typeof aggregateBusinessOperations>['breakdownCards'];
}

const knownStateArb: fc.Arbitrary<KnownState> = fc.constantFrom(
  'RUNNING',
  'PENDING',
  'WAITING_USER_INPUT',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
);

const requestSpecArb: fc.Arbitrary<RequestSpec> = fc.record({
  inputTokens: fc.integer({ min: 0, max: 100_000 }),
  outputTokens: fc.integer({ min: 0, max: 100_000 }),
  costUsd: fc.integer({ min: 0, max: 100_000 }),
  state: knownStateArb,
  updatedOffsetSeconds: fc.integer({ min: 0, max: 10_000 }),
});

const recomputationScenarioArb: fc.Arbitrary<RecomputationScenario> = fc.record({
  baseRequests: fc.array(requestSpecArb, { minLength: 3, maxLength: 8 }),
  addedRequest: requestSpecArb,
  replacementInputTokens: fc.integer({ min: 0, max: 100_000 }),
  replacementOutputTokens: fc.integer({ min: 0, max: 100_000 }),
  replacementCostUsd: fc.integer({ min: 0, max: 100_000 }),
  replacementState: knownStateArb,
  permutationOffset: fc.nat(),
});

function createRequest(
  id: string,
  index: number,
  spec: RequestSpec,
): AggregationRequestSource {
  const createdAt = new Date(BASE_TIMESTAMP + index * 1_000);
  const terminal = !ACTIVE_STATES.has(spec.state);

  return {
    id,
    apiKeyId: 'recomputation-profile',
    clientReference: 'RECOMPUTATION-PROPERTY-15',
    endpointSlug: 'recompute',
    state: spec.state,
    createdAt,
    updatedAt: new Date(
      BASE_TIMESTAMP + 20_000 + spec.updatedOffsetSeconds * 1_000 + index,
    ),
    completedAt: terminal
      ? new Date(createdAt.getTime() + 500)
      : null,
    deletedAt: null,
    hiddenFromOperations: false,
    totalInputTokens: spec.inputTokens,
    totalOutputTokens: spec.outputTokens,
    totalCostUsd: String(spec.costUsd),
    logicResult: null,
    extractionResult: null,
    inputTokensMissing: false,
    outputTokensMissing: false,
    costMissing: false,
    hasUnpricedCost: false,
  };
}

function fullRecomputation(
  sources: readonly AggregationRequestSource[],
): CanonicalOperationOutput[] {
  return projectBusinessOperations(sources)
    .map((operation) => {
      const aggregate = aggregateBusinessOperations([operation]);
      return {
        businessGroupKey: operation.businessGroupKey,
        operationIdentifier: operation.operationIdentifier,
        requestIds: operation.requests.map((request) => request.requestId),
        requestCount: operation.requestCount,
        businessStatus: operation.businessStatus,
        invalidData: operation.invalidData,
        startTime: operation.startTime.toISOString(),
        updatedTime: operation.updatedTime.toISOString(),
        endTime: operation.endTime?.toISOString() ?? null,
        durationSeconds: operation.durationSeconds,
        summary: aggregate.summary,
        breakdownCards: aggregate.breakdownCards,
      };
    })
    .sort((left, right) => (
      left.businessGroupKey < right.businessGroupKey ? -1
        : left.businessGroupKey > right.businessGroupKey ? 1
          : 0
    ));
}

function permuteAndClone(
  sources: readonly AggregationRequestSource[],
  offsetSeed: number,
): AggregationRequestSource[] {
  const offset = sources.length === 0 ? 0 : offsetSeed % sources.length;
  const rotated = [...sources.slice(offset), ...sources.slice(0, offset)];
  return rotated.reverse().map((source) => ({
    ...source,
    createdAt: new Date(source.createdAt),
    updatedAt: new Date(source.updatedAt),
    completedAt: source.completedAt ? new Date(source.completedAt) : null,
    deletedAt: source.deletedAt ? new Date(source.deletedAt) : null,
  }));
}

function expectedStatus(sources: readonly AggregationRequestSource[]): string {
  if (sources.some((source) => ACTIVE_STATES.has(source.state))) {
    return 'IN_PROGRESS';
  }
  if (sources.every((source) => source.state === 'SUCCEEDED')) {
    return 'SUCCEEDED';
  }
  return 'FAILED';
}

function fixedIntegerCost(value: number): string {
  return `${value}.0000000000`;
}

function assertMatchesLatestSources(
  sources: readonly AggregationRequestSource[],
  actual: readonly CanonicalOperationOutput[],
): void {
  const eligible = sources.filter(
    (source) => source.deletedAt === null && !source.hiddenFromOperations,
  );
  expect(eligible.length).toBeGreaterThan(0);
  expect(actual).toHaveLength(1);

  const operation = actual[0];
  const expectedInputTokens = eligible.reduce(
    (sum, source) => sum + (source.totalInputTokens ?? 0),
    0,
  );
  const expectedOutputTokens = eligible.reduce(
    (sum, source) => sum + (source.totalOutputTokens ?? 0),
    0,
  );
  const expectedCost = eligible.reduce(
    (sum, source) => sum + Number(source.totalCostUsd ?? 0),
    0,
  );
  const expectedUpdatedAt = new Date(Math.max(
    ...eligible.map((source) => source.updatedAt.getTime()),
  )).toISOString();
  const expectedIds = [...eligible]
    .sort((left, right) => {
      const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
      return byCreatedAt !== 0 ? byCreatedAt : left.id.localeCompare(right.id);
    })
    .map((source) => source.id);

  expect(operation.requestIds).toEqual(expectedIds);
  expect(operation.requestCount).toBe(eligible.length);
  expect(operation.businessStatus).toBe(expectedStatus(eligible));
  expect(operation.updatedTime).toBe(expectedUpdatedAt);
  expect(operation.summary).toMatchObject({
    totalCases: 1,
    tokensProcessed: expectedInputTokens + expectedOutputTokens,
    totalCostUsd: fixedIntegerCost(expectedCost),
  });
  expect(operation.breakdownCards).toHaveLength(1);
  expect(operation.breakdownCards[0]).toMatchObject({
    businessOperationCount: 1,
    requestCount: eligible.length,
    inputTokens: expectedInputTokens,
    outputTokens: expectedOutputTokens,
    costUsd: fixedIntegerCost(expectedCost),
  });
}

function assertCanonicalFullRecomputation(
  sources: readonly AggregationRequestSource[],
  permutationOffset: number,
): CanonicalOperationOutput[] {
  const current = fullRecomputation(sources);
  const repeated = fullRecomputation(sources);
  const permuted = fullRecomputation(permuteAndClone(sources, permutationOffset));

  expect(repeated).toEqual(current);
  expect(permuted).toEqual(current);
  assertMatchesLatestSources(sources, current);
  return current;
}

function replacementState(
  current: KnownState,
  candidate: KnownState,
): KnownState {
  if (candidate !== current) return candidate;
  return ACTIVE_STATES.has(current) ? 'SUCCEEDED' : 'RUNNING';
}

describe('Business Operation full recomputation property', () => {
  // Feature: operations-request-tracking, Property 15: Re-aggregation là deterministic và tương đương full recomputation
  // **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.10, 8.11**
  it('recomputes canonical output from only the latest eligible source values', () => {
    fc.assert(
      fc.property(recomputationScenarioArb, (scenario) => {
        let latestSources = scenario.baseRequests.map((spec, index) => (
          createRequest(`base-request-${index}`, index, spec)
        ));
        const baseline = assertCanonicalFullRecomputation(
          latestSources,
          scenario.permutationOffset,
        );

        latestSources = [
          ...latestSources,
          createRequest(
            'added-request',
            latestSources.length,
            scenario.addedRequest,
          ),
        ];
        const afterAdd = assertCanonicalFullRecomputation(
          latestSources,
          scenario.permutationOffset + 1,
        );
        expect(afterAdd[0].requestCount).toBe(baseline[0].requestCount + 1);

        latestSources = latestSources.map((source, index) => (
          index === 0
            ? {
              ...source,
              totalInputTokens: scenario.replacementInputTokens,
              totalOutputTokens: scenario.replacementOutputTokens,
              totalCostUsd: String(scenario.replacementCostUsd),
              updatedAt: new Date(BASE_TIMESTAMP + 30_000_000),
            }
            : source
        ));
        const afterMetricUpdate = assertCanonicalFullRecomputation(
          latestSources,
          scenario.permutationOffset + 2,
        );
        expect(afterMetricUpdate[0].summary.tokensProcessed).toBe(
          latestSources.reduce(
            (sum, source) => sum
              + (source.totalInputTokens ?? 0)
              + (source.totalOutputTokens ?? 0),
            0,
          ),
        );

        latestSources = latestSources.map((source) => (
          source.id === 'added-request'
            ? {
              ...source,
              state: replacementState(
                source.state as KnownState,
                scenario.replacementState,
              ),
              completedAt: ACTIVE_STATES.has(replacementState(
                source.state as KnownState,
                scenario.replacementState,
              ))
                ? null
                : new Date(source.createdAt.getTime() + 750),
              updatedAt: new Date(BASE_TIMESTAMP + 40_000_000),
            }
            : source
        ));
        assertCanonicalFullRecomputation(
          latestSources,
          scenario.permutationOffset + 3,
        );

        latestSources = latestSources.map((source) => (
          source.id === 'base-request-1'
            ? {
              ...source,
              deletedAt: new Date(BASE_TIMESTAMP + 50_000_000),
              updatedAt: new Date(BASE_TIMESTAMP + 50_000_000),
            }
            : source
        ));
        const afterDelete = assertCanonicalFullRecomputation(
          latestSources,
          scenario.permutationOffset + 4,
        );
        expect(afterDelete[0].requestIds).not.toContain('base-request-1');

        latestSources = latestSources.map((source) => (
          source.id === 'base-request-2'
            ? {
              ...source,
              hiddenFromOperations: true,
              updatedAt: new Date(BASE_TIMESTAMP + 60_000_000),
            }
            : source
        ));
        const afterHide = assertCanonicalFullRecomputation(
          latestSources,
          scenario.permutationOffset + 5,
        );
        expect(afterHide[0].requestIds).not.toContain('base-request-2');
      }),
      { numRuns: 100 },
    );
  });
});
