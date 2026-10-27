import { TextEncoder } from 'node:util';

import fc from 'fast-check';

import {
  aggregateBusinessOperationBreakdown,
  type AggregationRequestSource,
} from '@/lib/operations/aggregation';
import { projectBusinessOperations } from '@/lib/operations/projection';

const TARGET_OPERATION_TYPE = 'target-operation';
const ANCILLARY_OPERATION_TYPE = 'ancillary-operation';
const BASE_TIMESTAMP = Date.parse('2026-01-01T00:00:00.000Z');
const utf8Encoder = new TextEncoder();

type GeneratedStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';

interface TokenMeasurement {
  input: number;
  output: number;
}

interface GeneratedOperation {
  identifier: string;
  status: GeneratedStatus;
  durationMilliseconds: number;
  targetRequests: TokenMeasurement[];
  ancillaryRequest: TokenMeasurement;
}

const tokenMeasurementArb = fc.record({
  input: fc.integer({ min: 0, max: 20_000 }),
  output: fc.integer({ min: 0, max: 20_000 }),
});

const identifierFragmentArb = fc.array(
  fc.constantFrom('a', 'Z', '0', '-', '_', 'é', 'Ω', '\uE000', '\u{10000}'),
  { minLength: 1, maxLength: 6 },
).map((characters) => characters.join(''));

const extraOperationsArb = fc.array(
  fc.record({
    identifierFragment: identifierFragmentArb,
    status: fc.constantFrom<GeneratedStatus>('RUNNING', 'SUCCEEDED', 'FAILED'),
    durationMilliseconds: fc.integer({ min: 0, max: 3_600_000 }),
    targetRequests: fc.array(tokenMeasurementArb, { minLength: 1, maxLength: 4 }),
    ancillaryRequest: tokenMeasurementArb,
  }),
  { maxLength: 10 },
);

const tiePrefixArb = fc.array(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'),
  { minLength: 1, maxLength: 8 },
).map((characters) => characters.join(''));

function targetTokenTotal(operation: GeneratedOperation): number {
  return operation.targetRequests.reduce(
    (total, request) => total + request.input + request.output,
    0,
  );
}

function createGeneratedOperations(
  extraSeeds: readonly {
    identifierFragment: string;
    status: GeneratedStatus;
    durationMilliseconds: number;
    targetRequests: TokenMeasurement[];
    ancillaryRequest: TokenMeasurement;
  }[],
  tiePrefix: string,
): GeneratedOperation[] {
  const extras = extraSeeds.map((seed, index): GeneratedOperation => ({
    identifier: `${seed.identifierFragment}:extra:${index}`,
    status: seed.status,
    durationMilliseconds: seed.durationMilliseconds,
    targetRequests: seed.targetRequests,
    ancillaryRequest: seed.ancillaryRequest,
  }));
  const tiedDuration = Math.max(
    0,
    ...extras.map(({ durationMilliseconds }) => durationMilliseconds),
  ) + 1;
  const tiedTargetTokens = Math.max(0, ...extras.map(targetTokenTotal)) + 1;
  const firstTokenPart = Math.floor(tiedTargetTokens / 2);
  const tiedTargetRequests = [
    { input: firstTokenPart, output: 0 },
    { input: 0, output: tiedTargetTokens - firstTokenPart },
  ];

  return [
    ...extras,
    {
      identifier: `${tiePrefix}-\uE000`,
      status: 'SUCCEEDED',
      durationMilliseconds: tiedDuration,
      targetRequests: tiedTargetRequests,
      ancillaryRequest: { input: 0, output: 0 },
    },
    {
      identifier: `${tiePrefix}-\u{10000}`,
      status: 'FAILED',
      durationMilliseconds: tiedDuration,
      targetRequests: tiedTargetRequests,
      ancillaryRequest: {
        input: tiedTargetTokens + 1_000_000,
        output: tiedTargetTokens + 1_000_000,
      },
    },
  ];
}

function buildRequests(
  operations: readonly GeneratedOperation[],
): AggregationRequestSource[] {
  return operations.flatMap((operation, operationIndex) => {
    const createdAt = new Date(BASE_TIMESTAMP + operationIndex * 7_200_000);
    const terminal = operation.status !== 'RUNNING';
    const completedAt = terminal
      ? new Date(createdAt.getTime() + operation.durationMilliseconds)
      : null;
    const updatedAt = completedAt ?? new Date(createdAt.getTime() + 1_000);

    const createRequest = (
      suffix: string,
      operationType: string,
      tokens: TokenMeasurement,
    ): AggregationRequestSource => ({
      id: `request-${operationIndex}-${suffix}`,
      apiKeyId: 'profile-card-extrema',
      clientReference: operation.identifier,
      endpointSlug: operationType,
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

function comparePostgresCUtf8(left: string, right: string): number {
  const leftBytes = utf8Encoder.encode(left);
  const rightBytes = utf8Encoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);

  for (let index = 0; index < sharedLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] < rightBytes[index] ? -1 : 1;
    }
  }
  return Math.sign(leftBytes.length - rightBytes.length);
}

function oracleMaximumIdentifier(
  operations: readonly GeneratedOperation[],
  isCandidate: (operation: GeneratedOperation) => boolean,
  metric: (operation: GeneratedOperation) => number,
): string | null {
  const candidates = operations.filter(isCandidate);
  if (candidates.length === 0) return null;

  const maximum = Math.max(...candidates.map(metric));
  return candidates
    .filter((operation) => metric(operation) === maximum)
    .map(({ identifier }) => identifier)
    .reduce((smallest, identifier) => (
      comparePostgresCUtf8(identifier, smallest) < 0 ? identifier : smallest
    ));
}

describe('Business Operation card extrema property', () => {
  // Feature: operations-request-tracking, Property 10: Card extrema có tie-break xác định
  // **Validates: Requirements 5.11, 5.12, 5.13, 5.14**
  it('selects terminal duration and card-type token maxima with PostgreSQL C byte-order ties', () => {
    fc.assert(
      fc.property(extraOperationsArb, tiePrefixArb, (extraSeeds, tiePrefix) => {
        const operations = createGeneratedOperations(extraSeeds, tiePrefix);
        const projected = projectBusinessOperations(buildRequests(operations)).reverse();
        const card = aggregateBusinessOperationBreakdown(projected).find(
          ({ operationType }) => operationType === TARGET_OPERATION_TYPE,
        );
        if (!card) throw new Error('Expected generated target-operation card');

        const expectedDurationIdentifier = oracleMaximumIdentifier(
          operations,
          ({ status }) => status === 'SUCCEEDED' || status === 'FAILED',
          ({ durationMilliseconds }) => durationMilliseconds,
        );
        const expectedTokenIdentifier = oracleMaximumIdentifier(
          operations,
          () => true,
          targetTokenTotal,
        );

        expect(card.maxDurationOperationIdentifier).toBe(expectedDurationIdentifier);
        expect(card.maxTokenOperationIdentifier).toBe(expectedTokenIdentifier);
        expect(expectedDurationIdentifier).toBe(`${tiePrefix}-\uE000`);
        expect(expectedTokenIdentifier).toBe(`${tiePrefix}-\uE000`);
      }),
      { numRuns: 100 },
    );
  });
});
