import fc from 'fast-check';

import {
  searchBusinessOperations,
  type BusinessOperationSearchMode,
} from '@/lib/operations/reference-helpers';
import {
  projectBusinessOperations,
  type BusinessOperationProjection,
  type OperationRequestProjectionSource,
} from '@/lib/operations/projection';

const BASE_TIMESTAMP = Date.parse('2026-01-01T00:00:00.000Z');
const SEARCH_CHARACTERS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
  'Đ',
  'đ',
  'É',
  'é',
  '中',
] as const;
const QUERY_PADDING = [' ', '\t', '\n', '\r\n', '  \t'] as const;

interface SearchSource extends OperationRequestProjectionSource {
  authorized: boolean;
}

interface OperationSpec {
  referenceStem: string;
  requestCount: number;
  apiKeyId: string | null;
  sourcePadding: string;
}

interface SearchScenario {
  authorizedOperations: OperationSpec[];
  unauthorizedOperations: OperationSpec[];
  targetIndexSeed: number;
  queryLeadingPadding: string;
  queryTrailingPadding: string;
}

const referenceStemArb = fc.tuple(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  fc.array(fc.constantFrom(...SEARCH_CHARACTERS), { maxLength: 24 }),
).map(([first, rest]) => `${first}${rest.join('')}`);

const operationSpecArb: fc.Arbitrary<OperationSpec> = fc.record({
  referenceStem: referenceStemArb,
  requestCount: fc.integer({ min: 1, max: 4 }),
  apiKeyId: fc.option(
    fc.constantFrom('profile-a', 'profile-b', 'profile-c'),
    { nil: null },
  ),
  sourcePadding: fc.constantFrom(...QUERY_PADDING),
});

const scenarioArb: fc.Arbitrary<SearchScenario> = fc.record({
  authorizedOperations: fc.array(operationSpecArb, { minLength: 1, maxLength: 12 }),
  unauthorizedOperations: fc.array(operationSpecArb, { minLength: 1, maxLength: 5 }),
  targetIndexSeed: fc.nat(),
  queryLeadingPadding: fc.constantFrom(...QUERY_PADDING),
  queryTrailingPadding: fc.constantFrom(...QUERY_PADDING),
});

function createSources(
  visibility: 'authorized' | 'unauthorized',
  operations: readonly OperationSpec[],
): SearchSource[] {
  const authorized = visibility === 'authorized';

  return operations.flatMap((operation, operationIndex) => {
    const normalizedReference = `${operation.referenceStem}-Case-${operationIndex}`;

    return Array.from({ length: operation.requestCount }, (_, requestIndex) => {
      const createdAt = new Date(
        BASE_TIMESTAMP + (operationIndex * 10 + requestIndex) * 1_000,
      );

      return {
        id: `${visibility}-request-${operationIndex}-${requestIndex}`,
        apiKeyId: operation.apiKeyId,
        clientReference: `${operation.sourcePadding}${normalizedReference}${operation.sourcePadding}`,
        endpointSlug: 'search-operation',
        state: 'SUCCEEDED',
        createdAt,
        updatedAt: new Date(createdAt.getTime() + 500),
        completedAt: new Date(createdAt.getTime() + 500),
        deletedAt: null,
        hiddenFromOperations: false,
        authorized,
      };
    });
  });
}

function oracleSearch(
  authorizedOperations: readonly BusinessOperationProjection<SearchSource>[],
  rawQuery: string,
  mode: BusinessOperationSearchMode,
): string[] {
  const query = rawQuery.trim();
  const foldedQuery = query.toLowerCase();

  return authorizedOperations
    .filter((operation) => {
      if (mode === 'contains') {
        return operation.normalizedReference !== null
          && operation.normalizedReference.toLowerCase().includes(foldedQuery);
      }

      return operation.normalizedReference === query
        || operation.requests.some((request) => request.requestId === query);
    })
    .map((operation) => operation.businessGroupKey)
    .sort(compareBinary);
}

function actualSearch(
  authorizedOperations: readonly BusinessOperationProjection<SearchSource>[],
  rawQuery: string,
  mode: BusinessOperationSearchMode,
): string[] {
  const result = searchBusinessOperations(authorizedOperations, rawQuery, mode);
  expect(result.valid).toBe(true);
  if (!result.valid) throw new Error(`Expected valid search, received ${result.reason}`);

  expect(result.query).toBe(rawQuery.trim());
  return result.items
    .map((operation) => operation.businessGroupKey)
    .sort(compareBinary);
}

function assertValidTrimmedQuery(rawQuery: string): void {
  const length = Array.from(rawQuery.trim()).length;
  expect(length).toBeGreaterThanOrEqual(1);
  expect(length).toBeLessThanOrEqual(256);
}

function invertAsciiCase(value: string): string {
  return value.replace(/[A-Za-z]/g, (character) => (
    character === character.toLowerCase()
      ? character.toUpperCase()
      : character.toLowerCase()
  ));
}

function compareBinary(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

describe('Business Operation search normalization property', () => {
  // Feature: operations-request-tracking, Property 12: Search normalization trả đúng group được phép
  // **Validates: Requirements 6.4, 6.5, 6.6**
  it('matches normalized references and request IDs only within the authorized dataset', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const allSources = [
          ...createSources('authorized', scenario.authorizedOperations),
          ...createSources('unauthorized', scenario.unauthorizedOperations),
        ];
        const authorizedOperations = projectBusinessOperations(
          allSources.filter((source) => source.authorized),
        );
        const targetIndex = scenario.targetIndexSeed % authorizedOperations.length;
        const target = authorizedOperations[targetIndex];
        const exactReferenceQuery = `${scenario.queryLeadingPadding}${target.normalizedReference}${scenario.queryTrailingPadding}`;
        const containsQuery = `${scenario.queryLeadingPadding}${invertAsciiCase(scenario.authorizedOperations[targetIndex].referenceStem)}${scenario.queryTrailingPadding}`;
        const exactRequestIdQuery = `${scenario.queryLeadingPadding}${target.requests[0].requestId}${scenario.queryTrailingPadding}`;
        const unauthorizedRequestIdQuery = `${scenario.queryLeadingPadding}unauthorized-request-0-0${scenario.queryTrailingPadding}`;
        const searches = [
          { rawQuery: exactReferenceQuery, mode: 'exact' as const },
          { rawQuery: containsQuery, mode: 'contains' as const },
          { rawQuery: exactRequestIdQuery, mode: 'exact' as const },
          { rawQuery: unauthorizedRequestIdQuery, mode: 'exact' as const },
        ];

        for (const search of searches) {
          assertValidTrimmedQuery(search.rawQuery);
          expect(actualSearch(authorizedOperations, search.rawQuery, search.mode)).toEqual(
            oracleSearch(authorizedOperations, search.rawQuery, search.mode),
          );
        }

        expect(actualSearch(
          authorizedOperations,
          unauthorizedRequestIdQuery,
          'exact',
        )).toEqual([]);
        expect(authorizedOperations.every((operation) => (
          operation.requests.every((request) => request.source.authorized)
        ))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
