import fc from 'fast-check';

import type {
  BusinessIdentity,
  ProfileScope,
} from '@/lib/operations/business-key';
import {
  createBusinessOperationListProjection,
  filterBusinessOperations,
  projectBusinessOperations,
  type BusinessOperationFilter,
  type BusinessOperationListProjection,
  type OperationRequestProjectionSource,
} from '@/lib/operations/projection';
import type { BusinessStatus } from '@/lib/operations/status';

const BASE_TIMESTAMP = Date.parse('2026-01-15T12:00:00.000Z');
const PROFILE_IDS = ['profile-a', 'profile-b', 'profile-c'] as const;
const OPERATION_TYPES = ['extract', 'validate', 'publish'] as const;
const KNOWN_STATES = [
  'PENDING',
  'RUNNING',
  'WAITING_USER_INPUT',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
const ACTIVE_STATES = new Set<string>([
  'PENDING',
  'RUNNING',
  'WAITING_USER_INPUT',
]);

type ProfileId = (typeof PROFILE_IDS)[number];
type OperationType = (typeof OPERATION_TYPES)[number];
type KnownState = (typeof KNOWN_STATES)[number];
type SelectedProfile = 'ALL' | '__internal__' | ProfileId;

interface GeneratedRequest extends OperationRequestProjectionSource {
  state: KnownState;
  authorized: boolean;
}

interface RequestSeed {
  apiKeyId: ProfileId | null;
  referenceKind: 'referenced' | 'null' | 'blank';
  referenceBucket: number;
  operationType: OperationType | null;
  state: KnownState;
  createdOffsetMinutes: number;
  updatedOffsetMinutes: number;
  authorized: boolean;
}

interface Scenario {
  requestSeeds: RequestSeed[];
  windowStartOffsetMinutes: number;
  windowWidthMinutes: number;
  startInclusive: boolean;
  endInclusive: boolean;
  selectedProfile: SelectedProfile;
  selectedOperationType: 'ALL' | OperationType | 'absent';
  selectedStatus: BusinessStatus | 'ALL';
}

interface ExpectedGroup {
  businessGroupKey: string;
  constituents: GeneratedRequest[];
  listRow: BusinessOperationListProjection;
}

const requestSeedArb: fc.Arbitrary<RequestSeed> = fc.record({
  apiKeyId: fc.constantFrom<ProfileId | null>(null, ...PROFILE_IDS),
  referenceKind: fc.constantFrom('referenced', 'null', 'blank'),
  referenceBucket: fc.integer({ min: 0, max: 8 }),
  operationType: fc.constantFrom<OperationType | null>(null, ...OPERATION_TYPES),
  state: fc.constantFrom(...KNOWN_STATES),
  createdOffsetMinutes: fc.integer({ min: -1_500, max: 1_500 }),
  updatedOffsetMinutes: fc.integer({ min: 0, max: 180 }),
  authorized: fc.boolean(),
});

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  requestSeeds: fc.array(requestSeedArb, { minLength: 1, maxLength: 60 }),
  windowStartOffsetMinutes: fc.integer({ min: -1_700, max: 1_700 }),
  windowWidthMinutes: fc.integer({ min: 0, max: 3_400 }),
  startInclusive: fc.boolean(),
  endInclusive: fc.boolean(),
  selectedProfile: fc.constantFrom<SelectedProfile>(
    'ALL',
    '__internal__',
    ...PROFILE_IDS,
  ),
  selectedOperationType: fc.constantFrom<'ALL' | OperationType | 'absent'>(
    'ALL',
    ...OPERATION_TYPES,
    'absent',
  ),
  selectedStatus: fc.constantFrom<BusinessStatus | 'ALL'>(
    'ALL',
    'IN_PROGRESS',
    'SUCCEEDED',
    'FAILED',
    'N/A',
  ),
});

function buildRequests(seeds: readonly RequestSeed[]): GeneratedRequest[] {
  return seeds.map((seed, index) => {
    const createdAt = new Date(
      BASE_TIMESTAMP + seed.createdOffsetMinutes * 60_000,
    );

    return {
      id: `request-${index}`,
      apiKeyId: seed.apiKeyId,
      clientReference: sourceReference(seed),
      endpointSlug: seed.operationType,
      state: seed.state,
      createdAt,
      updatedAt: new Date(
        createdAt.getTime() + seed.updatedOffsetMinutes * 60_000,
      ),
      completedAt: isTerminal(seed.state)
        ? new Date(createdAt.getTime() + seed.updatedOffsetMinutes * 60_000)
        : null,
      deletedAt: null,
      hiddenFromOperations: false,
      authorized: seed.authorized,
    };
  });
}

function sourceReference(seed: RequestSeed): string | null {
  if (seed.referenceKind === 'null') return null;
  if (seed.referenceKind === 'blank') return seed.referenceBucket % 2 === 0 ? '   ' : '\t\n';
  return seed.referenceBucket % 2 === 0
    ? `  REF-${seed.referenceBucket}  `
    : `\tREF-${seed.referenceBucket}\n`;
}

function buildExpectedGroups(
  authorizedRequests: readonly GeneratedRequest[],
  filter: BusinessOperationFilter,
): ExpectedGroup[] {
  const constituentsByKey = new Map<string, GeneratedRequest[]>();

  for (const request of authorizedRequests) {
    const key = expectedBusinessGroupKey(request);
    const constituents = constituentsByKey.get(key) ?? [];
    constituents.push(request);
    constituentsByKey.set(key, constituents);
  }

  return [...constituentsByKey.entries()]
    .map(([businessGroupKey, constituents]) => expectedGroup(
      businessGroupKey,
      constituents,
    ))
    .filter((group) => expectedFilterMatch(group.listRow, filter))
    .sort((left, right) => compareBinary(
      left.businessGroupKey,
      right.businessGroupKey,
    ));
}

function expectedGroup(
  businessGroupKey: string,
  constituents: readonly GeneratedRequest[],
): ExpectedGroup {
  const normalizedReference = normalizeReferenceOracle(
    constituents[0].clientReference,
  );
  const profileScope = profileScopeOracle(constituents[0].apiKeyId);
  const identity: BusinessIdentity = normalizedReference === null
    ? { kind: 'standalone', requestId: constituents[0].id }
    : {
      kind: 'referenced',
      scope: profileScope,
      normalizedReference,
    };
  const operationTypes = [...new Set(
    constituents
      .map((request) => request.endpointSlug)
      .filter((value): value is string => value !== null),
  )].sort(compareBinary);
  const states = constituents.map((request) => request.state);
  const listRow: BusinessOperationListProjection = {
    businessGroupKey,
    identity,
    operationIdentifier: normalizedReference ?? constituents[0].id,
    normalizedReference,
    profileScope,
    operationTypes,
    businessStatus: aggregateStatusOracle(states),
    invalidData: false,
    requestCount: constituents.length,
    startTime: new Date(Math.min(
      ...constituents.map((request) => request.createdAt.getTime()),
    )),
    updatedTime: new Date(Math.max(
      ...constituents.map((request) => request.updatedAt.getTime()),
    )),
  };

  return {
    businessGroupKey,
    constituents: [...constituents],
    listRow,
  };
}

function expectedBusinessGroupKey(request: GeneratedRequest): string {
  const normalizedReference = normalizeReferenceOracle(request.clientReference);
  if (normalizedReference === null) return `request:${request.id}`;
  return `profile:${request.apiKeyId ?? '__internal__'}:reference:${normalizedReference}`;
}

function normalizeReferenceOracle(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function profileScopeOracle(apiKeyId: string | null): ProfileScope {
  return apiKeyId === null
    ? { kind: 'internal' }
    : { kind: 'profile', apiKeyId };
}

function aggregateStatusOracle(states: readonly KnownState[]): Exclude<BusinessStatus, 'N/A'> {
  if (states.some((state) => ACTIVE_STATES.has(state))) return 'IN_PROGRESS';
  if (states.every((state) => state === 'SUCCEEDED')) return 'SUCCEEDED';
  return 'FAILED';
}

function expectedFilterMatch(
  row: BusinessOperationListProjection,
  filter: BusinessOperationFilter,
): boolean {
  const timestamp = row.startTime.getTime();
  const start = filter.timeWindow.start.getTime();
  const end = filter.timeWindow.end.getTime();
  const matchesStart = filter.timeWindow.startInclusive
    ? timestamp >= start
    : timestamp > start;
  const matchesEnd = filter.timeWindow.endInclusive
    ? timestamp <= end
    : timestamp < end;
  const matchesProfile = filter.profileScope === 'ALL'
    || sameProfileScope(row.profileScope, filter.profileScope);
  const matchesType = filter.operationType === 'ALL'
    || row.operationTypes.includes(filter.operationType);
  const matchesStatus = filter.businessStatus === 'ALL'
    || row.businessStatus === filter.businessStatus;

  return matchesStart && matchesEnd && matchesProfile && matchesType && matchesStatus;
}

function sameProfileScope(left: ProfileScope, right: ProfileScope): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === 'internal'
    || left.apiKeyId === (right as Extract<ProfileScope, { kind: 'profile' }>).apiKeyId;
}

function selectedProfileScope(selected: SelectedProfile): ProfileScope | 'ALL' {
  if (selected === 'ALL') return 'ALL';
  if (selected === '__internal__') return { kind: 'internal' };
  return { kind: 'profile', apiKeyId: selected };
}

function isTerminal(state: KnownState): boolean {
  return state === 'SUCCEEDED' || state === 'FAILED' || state === 'CANCELLED';
}

function compareBinary(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

describe('Business Operation list uniqueness property', () => {
  // Feature: operations-request-tracking, Property 11: Business list là tập group duy nhất đã lọc
  // **Validates: Requirements 6.1, 6.2**
  it('returns one row per authorized filtered key with aggregates from every authorized constituent', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const allRequests = buildRequests(scenario.requestSeeds);
        const authorizedRequests = allRequests.filter((request) => request.authorized);
        const windowStart = BASE_TIMESTAMP
          + scenario.windowStartOffsetMinutes * 60_000;
        const filter: BusinessOperationFilter = {
          timeWindow: {
            start: new Date(windowStart),
            end: new Date(windowStart + scenario.windowWidthMinutes * 60_000),
            startInclusive: scenario.startInclusive,
            endInclusive: scenario.endInclusive,
          },
          profileScope: selectedProfileScope(scenario.selectedProfile),
          operationType: scenario.selectedOperationType,
          businessStatus: scenario.selectedStatus,
        };
        const filteredOperations = filterBusinessOperations(
          projectBusinessOperations(authorizedRequests),
          filter,
        );
        const actualRows = filteredOperations
          .map(createBusinessOperationListProjection)
          .sort((left, right) => compareBinary(
            left.businessGroupKey,
            right.businessGroupKey,
          ));
        const expectedGroups = buildExpectedGroups(authorizedRequests, filter);
        const expectedRows = expectedGroups.map((group) => group.listRow);
        const actualKeys = actualRows.map((row) => row.businessGroupKey);

        expect(actualKeys).toEqual(
          expectedGroups.map((group) => group.businessGroupKey),
        );
        expect(new Set(actualKeys).size).toBe(actualKeys.length);
        expect(actualRows).toEqual(expectedRows);

        for (const operation of filteredOperations) {
          const expected = expectedGroups.find(
            (group) => group.businessGroupKey === operation.businessGroupKey,
          );
          expect(expected).toBeDefined();
          expect(operation.requests.every((request) => request.source.authorized)).toBe(true);
          expect(operation.requests.map((request) => request.requestId).sort(compareBinary)).toEqual(
            expected?.constituents.map((request) => request.id).sort(compareBinary),
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
