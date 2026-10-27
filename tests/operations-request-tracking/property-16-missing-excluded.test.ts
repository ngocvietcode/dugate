import fc from 'fast-check';

import {
  aggregateBusinessOperations,
  type AggregationRequestSource,
} from '@/lib/operations/aggregation';
import type { ProfileScope } from '@/lib/operations/business-key';
import {
  createBusinessOperationListProjection,
  projectBusinessOperations,
  type BusinessOperationProjection,
} from '@/lib/operations/projection';
import {
  createConstituentRequestDetailPage,
  orderBusinessOperations,
  type OperationalDetailSource,
} from '@/lib/operations/reference-helpers';

const BASE_TIMESTAMP = Date.parse('2026-01-01T00:00:00.000Z');
const DECIMAL_SCALE = 10;
const DECIMAL_FACTOR = BigInt(10) ** BigInt(DECIMAL_SCALE);
const OPERATION_TYPES = ['extract', 'validate'] as const;
const KNOWN_STATES = [
  'PENDING',
  'RUNNING',
  'WAITING_USER_INPUT',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;

type OperationType = (typeof OPERATION_TYPES)[number];
type KnownState = (typeof KNOWN_STATES)[number];
type MissingField = 'input' | 'output' | 'cost';

interface TestRequestSource extends AggregationRequestSource, OperationalDetailSource {}

interface IdentitySeed {
  apiKeyId: 'profile-a' | 'profile-b' | null;
  referenceKind: 'referenced' | 'null' | 'blank';
  referenceBucket: number;
  operationType: OperationType;
}

interface MeasurementSeed {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
}

interface EligibleSeed extends IdentitySeed {
  state: KnownState;
  measurement: MeasurementSeed;
}

interface ExcludedSeed extends IdentitySeed {
  state: string;
  measurement: MeasurementSeed;
  exclusion: 'deleted' | 'hidden' | 'both';
}

interface Scenario {
  requiredMissing: EligibleSeed;
  otherEligible: EligibleSeed[];
  excluded: ExcludedSeed[];
}

const identityFields = {
  apiKeyId: fc.constantFrom<'profile-a' | 'profile-b' | null>(
    'profile-a',
    'profile-b',
    null,
  ),
  referenceKind: fc.constantFrom<'referenced' | 'null' | 'blank'>(
    'referenced',
    'null',
    'blank',
  ),
  referenceBucket: fc.integer({ min: 0, max: 5 }),
  operationType: fc.constantFrom<OperationType>(...OPERATION_TYPES),
};

const tokenArb = fc.integer({ min: 0, max: 1_000_000 });
const positiveTokenArb = fc.integer({ min: 1, max: 1_000_000 });
const costArb = fc.integer({ min: 0, max: 1_000_000 }).map(formatGeneratedCost);
const positiveCostArb = fc.integer({ min: 1, max: 1_000_000 }).map(formatGeneratedCost);

const measurementArb: fc.Arbitrary<MeasurementSeed> = fc.record({
  inputTokens: fc.option(tokenArb, { nil: null }),
  outputTokens: fc.option(tokenArb, { nil: null }),
  costUsd: fc.option(costArb, { nil: null }),
});

const requiredMissingMeasurementArb: fc.Arbitrary<MeasurementSeed> = fc.record({
  missingField: fc.constantFrom<MissingField>('input', 'output', 'cost'),
  inputTokens: positiveTokenArb,
  outputTokens: positiveTokenArb,
  costUsd: positiveCostArb,
}).map(({ missingField, inputTokens, outputTokens, costUsd }) => ({
  inputTokens: missingField === 'input' ? null : inputTokens,
  outputTokens: missingField === 'output' ? null : outputTokens,
  costUsd: missingField === 'cost' ? null : costUsd,
}));

const eligibleSeedArb: fc.Arbitrary<EligibleSeed> = fc.record({
  ...identityFields,
  state: fc.constantFrom<KnownState>(...KNOWN_STATES),
  measurement: measurementArb,
});

const requiredMissingSeedArb: fc.Arbitrary<EligibleSeed> = fc.record({
  ...identityFields,
  state: fc.constantFrom<KnownState>(...KNOWN_STATES),
  measurement: requiredMissingMeasurementArb,
});

const excludedSeedArb: fc.Arbitrary<ExcludedSeed> = fc.record({
  ...identityFields,
  state: fc.constantFrom<string>(...KNOWN_STATES, 'CORRUPT_STATE'),
  measurement: measurementArb,
  exclusion: fc.constantFrom('deleted', 'hidden', 'both'),
});

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  requiredMissing: requiredMissingSeedArb,
  otherEligible: fc.array(eligibleSeedArb, { minLength: 0, maxLength: 15 }),
  excluded: fc.array(excludedSeedArb, { minLength: 1, maxLength: 20 }),
});

function formatGeneratedCost(units: number): string {
  return `${units}.${String((units * 7_919) % 10_000_000_000).padStart(DECIMAL_SCALE, '0')}`;
}

function createSource(
  seed: EligibleSeed | ExcludedSeed,
  id: string,
  index: number,
): TestRequestSource {
  const createdAt = new Date(BASE_TIMESTAMP + index * 60_000);
  const terminal = seed.state === 'SUCCEEDED'
    || seed.state === 'FAILED'
    || seed.state === 'CANCELLED';
  const exclusion = 'exclusion' in seed ? seed.exclusion : null;

  return {
    id,
    apiKeyId: seed.apiKeyId,
    clientReference: sourceReference(seed),
    endpointSlug: seed.operationType,
    state: seed.state,
    createdAt,
    updatedAt: new Date(createdAt.getTime() + 30_000),
    completedAt: terminal ? new Date(createdAt.getTime() + 20_000) : null,
    deletedAt: exclusion === 'deleted' || exclusion === 'both'
      ? new Date(createdAt.getTime() + 40_000)
      : null,
    hiddenFromOperations: exclusion === 'hidden' || exclusion === 'both',
    totalInputTokens: seed.measurement.inputTokens,
    totalOutputTokens: seed.measurement.outputTokens,
    totalCostUsd: seed.measurement.costUsd,
    logicResult: null,
    extractionResult: null,
    inputTokensMissing: seed.measurement.inputTokens === null,
    outputTokensMissing: seed.measurement.outputTokens === null,
    costMissing: seed.measurement.costUsd === null,
    hasUnpricedCost: false,
    errorCode: null,
    errorMessage: null,
  };
}

function sourceReference(seed: IdentitySeed): string | null {
  if (seed.referenceKind === 'null') return null;
  if (seed.referenceKind === 'blank') return seed.referenceBucket % 2 === 0 ? '   ' : '\t\n';
  return seed.referenceBucket % 2 === 0
    ? `  CASE-${seed.referenceBucket}  `
    : `\tCASE-${seed.referenceBucket}\n`;
}

function fixedCostCoefficient(value: string | null): bigint {
  if (value === null) return BigInt(0);
  const [integer, fraction = ''] = value.split('.');
  return BigInt(integer) * DECIMAL_FACTOR
    + BigInt(fraction.padEnd(DECIMAL_SCALE, '0'));
}

function formatFixedCost(coefficient: bigint): string {
  const digits = coefficient.toString().padStart(DECIMAL_SCALE + 1, '0');
  return `${digits.slice(0, -DECIMAL_SCALE)}.${digits.slice(-DECIMAL_SCALE)}`;
}

function hasMissingMeasurement(source: TestRequestSource): boolean {
  return source.totalInputTokens === null
    || source.totalOutputTokens === null
    || source.totalCostUsd === null
    || source.inputTokensMissing
    || source.outputTokensMissing
    || source.costMissing;
}

function sameProfileScope(source: TestRequestSource, scope: ProfileScope): boolean {
  return scope.kind === 'internal'
    ? source.apiKeyId === null
    : source.apiKeyId === scope.apiKeyId;
}

function listSnapshot(
  operations: readonly BusinessOperationProjection<TestRequestSource>[],
) {
  return orderBusinessOperations(operations).map((operation) => (
    createBusinessOperationListProjection(operation)
  ));
}

describe('Business Operation missing and excluded rows property', () => {
  // Feature: operations-request-tracking, Property 16: Missing và excluded rows không làm sai aggregate
  // **Validates: Requirements 8.7, 8.8, 8.9**
  it('uses zero only for missing measurements and fully excludes deleted or hidden rows', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const eligibleSeeds = [scenario.requiredMissing, ...scenario.otherEligible];
        const eligibleSources = eligibleSeeds.map((seed, index) => (
          createSource(seed, `eligible-${index}`, index)
        ));
        const excludedSources = scenario.excluded.map((seed, index) => (
          createSource(seed, `excluded-${index}`, eligibleSources.length + index)
        ));
        const baselineOperations = projectBusinessOperations(eligibleSources);
        const operationsWithExcluded = projectBusinessOperations([
          ...eligibleSources,
          ...excludedSources,
        ]);
        const baselineAggregate = aggregateBusinessOperations(baselineOperations);
        const aggregateWithExcluded = aggregateBusinessOperations(operationsWithExcluded);

        const expectedTokens = eligibleSources.reduce((sum, source) => (
          sum + (source.totalInputTokens ?? 0) + (source.totalOutputTokens ?? 0)
        ), 0);
        const expectedCost = formatFixedCost(eligibleSources.reduce(
          (sum, source) => sum + fixedCostCoefficient(
            source.costMissing ? null : String(source.totalCostUsd),
          ),
          BigInt(0),
        ));
        const expectedMissingCount = eligibleSources.filter(hasMissingMeasurement).length;

        expect(baselineAggregate.summary.tokensProcessed).toBe(expectedTokens);
        expect(baselineAggregate.summary.totalCostUsd).toBe(expectedCost);
        expect(baselineAggregate.summary.missingRequestCount).toBe(expectedMissingCount);
        expect(baselineAggregate.summary.missingData).toBe(expectedMissingCount > 0);

        for (const card of baselineAggregate.breakdownCards) {
          const cardSources = eligibleSources.filter((source) => (
            source.endpointSlug === card.operationType
              && sameProfileScope(source, card.profileScope)
          ));
          const expectedInputTokens = cardSources.reduce(
            (sum, source) => sum + (source.totalInputTokens ?? 0),
            0,
          );
          const expectedOutputTokens = cardSources.reduce(
            (sum, source) => sum + (source.totalOutputTokens ?? 0),
            0,
          );
          const expectedCardCost = formatFixedCost(cardSources.reduce(
            (sum, source) => sum + fixedCostCoefficient(
              source.costMissing ? null : String(source.totalCostUsd),
            ),
            BigInt(0),
          ));
          const expectedCardMissingCount = cardSources.filter(hasMissingMeasurement).length;

          expect(card.inputTokens).toBe(expectedInputTokens);
          expect(card.outputTokens).toBe(expectedOutputTokens);
          expect(card.costUsd).toBe(expectedCardCost);
          expect(card.missingRequestCount).toBe(expectedCardMissingCount);
          expect(card.missingData).toBe(expectedCardMissingCount > 0);
        }

        for (const source of eligibleSources) {
          const operation = baselineOperations.find((candidate) => (
            candidate.requests.some((request) => request.requestId === source.id)
          ));
          const requestProjection = operation?.requests.find(
            (request) => request.requestId === source.id,
          );
          const detailItem = operation
            ? createConstituentRequestDetailPage(operation, 1).items.find(
              (item) => item.id === source.id,
            )
            : undefined;
          const expectedMissing = hasMissingMeasurement(source);

          expect(operation).toBeDefined();
          expect(requestProjection?.source.totalInputTokens).toBe(source.totalInputTokens);
          expect(requestProjection?.source.totalOutputTokens).toBe(source.totalOutputTokens);
          expect(requestProjection?.source.totalCostUsd).toBe(source.totalCostUsd);
          expect(requestProjection?.source.inputTokensMissing).toBe(
            source.totalInputTokens === null,
          );
          expect(requestProjection?.source.outputTokensMissing).toBe(
            source.totalOutputTokens === null,
          );
          expect(requestProjection?.source.costMissing).toBe(source.totalCostUsd === null);
          expect(detailItem).toMatchObject({
            inputTokens: source.totalInputTokens,
            outputTokens: source.totalOutputTokens,
            costUsd: source.totalCostUsd,
            missingData: expectedMissing,
          });
          expect(detailItem?.nullDisplay.inputTokens).toBe(
            source.totalInputTokens === null ? 'MISSING' : 'VALUE',
          );
          expect(detailItem?.nullDisplay.outputTokens).toBe(
            source.totalOutputTokens === null ? 'MISSING' : 'VALUE',
          );
          expect(detailItem?.nullDisplay.costUsd).toBe(
            source.totalCostUsd === null ? 'MISSING' : 'VALUE',
          );
        }

        expect(operationsWithExcluded).toEqual(baselineOperations);
        expect(aggregateWithExcluded).toEqual(baselineAggregate);
        expect(listSnapshot(operationsWithExcluded)).toEqual(
          listSnapshot(baselineOperations),
        );
        const actualRequestIds = operationsWithExcluded.flatMap((operation) => (
          operation.requests.map((request) => request.requestId)
        ));
        const excludedRequestIds = new Set(excludedSources.map((source) => source.id));
        expect(actualRequestIds.some((id) => excludedRequestIds.has(id))).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
