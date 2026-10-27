import fc from 'fast-check';

import {
  filterBusinessOperations,
  projectBusinessOperations,
  type BusinessOperationFilter,
  type OperationRequestProjectionSource,
} from '@/lib/operations/projection';
import type { ProfileScope } from '@/lib/operations/business-key';
import type { BusinessStatus } from '@/lib/operations/status';

const BASE_TIMESTAMP = Date.parse('2025-01-15T12:00:00.000Z');
const OPERATION_TYPES = ['type-a', 'type-b', 'type-c'] as const;
const PROFILE_IDS = ['profile-a', 'profile-b', 'profile-c'] as const;
const KNOWN_STATES = [
  'PENDING',
  'RUNNING',
  'WAITING_USER_INPUT',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
const ACTIVE_STATES = new Set<string>(['PENDING', 'RUNNING', 'WAITING_USER_INPUT']);

type OperationType = (typeof OPERATION_TYPES)[number];
type KnownState = (typeof KNOWN_STATES)[number];

interface ConstituentSpec {
  operationType: OperationType;
  state: KnownState;
  createdOffsetMinutes: number;
}

interface OperationSpec {
  apiKeyId: (typeof PROFILE_IDS)[number] | null;
  constituents: ConstituentSpec[];
}

const timingAndStateArb = fc.record({
  state: fc.constantFrom(...KNOWN_STATES),
  createdOffsetMinutes: fc.integer({ min: -4_000, max: 4_000 }),
});

const constituentArb: fc.Arbitrary<ConstituentSpec> = fc.record({
  operationType: fc.constantFrom(...OPERATION_TYPES),
  state: fc.constantFrom(...KNOWN_STATES),
  createdOffsetMinutes: fc.integer({ min: -4_000, max: 4_000 }),
});

const distinctTypePairArb = fc.constantFrom<readonly [OperationType, OperationType]>(
  ['type-a', 'type-b'],
  ['type-a', 'type-c'],
  ['type-b', 'type-c'],
);

const operationSpecArb: fc.Arbitrary<OperationSpec> = fc.record({
  apiKeyId: fc.constantFrom<(typeof PROFILE_IDS)[number] | null>(null, ...PROFILE_IDS),
  distinctTypes: distinctTypePairArb,
  first: timingAndStateArb,
  second: timingAndStateArb,
  additional: fc.array(constituentArb, { maxLength: 3 }),
}).map(({ apiKeyId, distinctTypes, first, second, additional }) => ({
  apiKeyId,
  constituents: [
    { operationType: distinctTypes[0], ...first },
    { operationType: distinctTypes[1], ...second },
    ...additional,
  ],
}));

const scenarioArb = fc.record({
  operationSpecs: fc.array(operationSpecArb, { minLength: 1, maxLength: 12 }),
  windowStartOffsetMinutes: fc.integer({ min: -4_500, max: 4_500 }),
  windowWidthMinutes: fc.integer({ min: 0, max: 9_000 }),
  startInclusive: fc.boolean(),
  endInclusive: fc.boolean(),
  selectedProfile: fc.constantFrom<'ALL' | '__internal__' | (typeof PROFILE_IDS)[number]>(
    'ALL',
    '__internal__',
    ...PROFILE_IDS,
  ),
  selectedOperationType: fc.constantFrom<'ALL' | OperationType | 'type-absent'>(
    'ALL',
    ...OPERATION_TYPES,
    'type-absent',
  ),
  selectedStatus: fc.constantFrom<BusinessStatus | 'ALL'>(
    'ALL',
    'IN_PROGRESS',
    'SUCCEEDED',
    'FAILED',
    'N/A',
  ),
});

function createSources(operationSpecs: readonly OperationSpec[]): OperationRequestProjectionSource[] {
  return operationSpecs.flatMap((operation, operationIndex) => (
    operation.constituents.map((constituent, requestIndex) => {
      const createdAt = new Date(
        BASE_TIMESTAMP + constituent.createdOffsetMinutes * 60_000,
      );
      const terminal = constituent.state === 'SUCCEEDED'
        || constituent.state === 'FAILED'
        || constituent.state === 'CANCELLED';
      const completedAt = terminal
        ? new Date(createdAt.getTime() + 60_000)
        : null;

      return {
        id: `request-${operationIndex}-${requestIndex}`,
        apiKeyId: operation.apiKeyId,
        clientReference: `reference-${operationIndex}`,
        endpointSlug: constituent.operationType,
        state: constituent.state,
        createdAt,
        updatedAt: completedAt ?? new Date(createdAt.getTime() + 30_000),
        completedAt,
        deletedAt: null,
        hiddenFromOperations: false,
      };
    })
  ));
}

function selectedProfileScope(
  selectedProfile: 'ALL' | '__internal__' | (typeof PROFILE_IDS)[number],
): ProfileScope | 'ALL' {
  if (selectedProfile === 'ALL') return 'ALL';
  if (selectedProfile === '__internal__') return { kind: 'internal' };
  return { kind: 'profile', apiKeyId: selectedProfile };
}

function expectedStatus(states: readonly string[]): Exclude<BusinessStatus, 'N/A'> {
  if (states.some((state) => ACTIVE_STATES.has(state))) return 'IN_PROGRESS';
  if (states.every((state) => state === 'SUCCEEDED')) return 'SUCCEEDED';
  return 'FAILED';
}

function profileMatches(
  apiKeyId: string | null,
  selectedProfile: 'ALL' | '__internal__' | (typeof PROFILE_IDS)[number],
): boolean {
  if (selectedProfile === 'ALL') return true;
  if (selectedProfile === '__internal__') return apiKeyId === null;
  return apiKeyId === selectedProfile;
}

function boundaryMatches(
  timestamp: number,
  start: number,
  end: number,
  startInclusive: boolean,
  endInclusive: boolean,
): boolean {
  const afterStart = startInclusive ? timestamp >= start : timestamp > start;
  const beforeEnd = endInclusive ? timestamp <= end : timestamp < end;
  return afterStart && beforeEnd;
}

describe('Business Operation dashboard filter property', () => {
  // Feature: operations-request-tracking, Property 5: Dashboard filter là phép giao trên business operation
  // **Validates: Requirements 3.6, 3.8, 3.9, 3.10, 6.2**
  it('returns the AND intersection and preserves every constituent of selected groups', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const sourceRequests = createSources(scenario.operationSpecs);
        const operations = projectBusinessOperations(sourceRequests);
        const windowStart = BASE_TIMESTAMP + scenario.windowStartOffsetMinutes * 60_000;
        const windowEnd = windowStart + scenario.windowWidthMinutes * 60_000;
        const filter: BusinessOperationFilter = {
          timeWindow: {
            start: new Date(windowStart),
            end: new Date(windowEnd),
            startInclusive: scenario.startInclusive,
            endInclusive: scenario.endInclusive,
          },
          profileScope: selectedProfileScope(scenario.selectedProfile),
          operationType: scenario.selectedOperationType,
          businessStatus: scenario.selectedStatus,
        };

        const expected = operations.filter((operation) => {
          const constituentStart = Math.min(
            ...operation.requests.map((request) => request.createdAt.getTime()),
          );
          const apiKeyId = operation.requests[0].source.apiKeyId;
          const states = operation.requests.map((request) => request.source.state);
          const hasSelectedType = scenario.selectedOperationType === 'ALL'
            || operation.requests.some(
              (request) => request.source.endpointSlug === scenario.selectedOperationType,
            );
          const hasSelectedStatus = scenario.selectedStatus === 'ALL'
            || expectedStatus(states) === scenario.selectedStatus;

          expect(operation.startTime.getTime()).toBe(constituentStart);

          return boundaryMatches(
            constituentStart,
            windowStart,
            windowEnd,
            scenario.startInclusive,
            scenario.endInclusive,
          )
            && profileMatches(apiKeyId, scenario.selectedProfile)
            && hasSelectedType
            && hasSelectedStatus;
        });

        const actual = filterBusinessOperations(operations, filter);

        expect(actual.map((operation) => operation.businessGroupKey))
          .toEqual(expected.map((operation) => operation.businessGroupKey));

        for (const filteredOperation of actual) {
          const originalOperation = operations.find(
            (operation) => operation.businessGroupKey === filteredOperation.businessGroupKey,
          );
          expect(originalOperation).toBeDefined();
          expect(filteredOperation).toBe(originalOperation);
          expect(filteredOperation.requestCount).toBe(filteredOperation.requests.length);
          expect(filteredOperation.requests.map((request) => request.requestId))
            .toEqual(originalOperation?.requests.map((request) => request.requestId));
          expect(filteredOperation.operationTypes).toEqual(originalOperation?.operationTypes);

          if (scenario.selectedOperationType !== 'ALL') {
            expect(filteredOperation.requests.some(
              (request) => request.operationType === scenario.selectedOperationType,
            )).toBe(true);
            expect(filteredOperation.requests.some(
              (request) => request.operationType !== scenario.selectedOperationType,
            )).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
