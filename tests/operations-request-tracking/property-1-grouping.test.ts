import fc from 'fast-check';

import {
  groupBusinessOperationRequests,
  type BusinessIdentity,
  type BusinessOperationIdentitySource,
} from '@/lib/operations/business-key';

const whitespaceCharacterArb = fc.constantFrom(
  ' ',
  '\t',
  '\n',
  '\r',
  '\u00a0',
  '\u2003',
  '\u3000',
  '\ufeff',
);

const optionalWhitespaceArb = fc.array(whitespaceCharacterArb, { maxLength: 4 })
  .map((characters) => characters.join(''));
const nonEmptyWhitespaceArb = fc.array(whitespaceCharacterArb, {
  minLength: 1,
  maxLength: 6,
}).map((characters) => characters.join(''));

const unicodeReferenceArb = fc.tuple(
  fc.constantFrom('Đ', 'é', '中', '😀', 'Ω', 'Ж', '١', 'क', '案件'),
  fc.array(fc.constantFrom('A', 'z', '7', '-', '/', ':', ' hồ sơ ', '№', '界'), {
    maxLength: 5,
  }),
).map(([requiredUnicode, suffix]) => `${requiredUnicode}${suffix.join('')}`);

const profileIdArb = fc.array(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'),
  { minLength: 1, maxLength: 12 },
).map((characters) => characters.join(''));

const groupingClusterArb = fc.record({
  normalizedReference: unicodeReferenceArb,
  profileIds: fc.uniqueArray(profileIdArb, { minLength: 2, maxLength: 2 }),
  leadingWhitespaceA: nonEmptyWhitespaceArb,
  trailingWhitespaceA: optionalWhitespaceArb,
  leadingWhitespaceB: optionalWhitespaceArb,
  trailingWhitespaceB: nonEmptyWhitespaceArb,
  blankReference: nonEmptyWhitespaceArb,
});

const requestsArb = fc.array(groupingClusterArb, { minLength: 1, maxLength: 6 })
  .map((clusters): BusinessOperationIdentitySource[] => {
    const requests: BusinessOperationIdentitySource[] = [];

    const addRequest = (apiKeyId: string | null, clientReference: string | null): void => {
      requests.push({
        id: `request-${requests.length}`,
        apiKeyId,
        clientReference,
      });
    };

    for (const cluster of clusters) {
      const [profileA, profileB] = cluster.profileIds;
      const wrappedReferenceA = `${cluster.leadingWhitespaceA}${cluster.normalizedReference}${cluster.trailingWhitespaceA}`;
      const wrappedReferenceB = `${cluster.leadingWhitespaceB}${cluster.normalizedReference}${cluster.trailingWhitespaceB}`;

      addRequest(profileA, wrappedReferenceA);
      addRequest(profileA, wrappedReferenceB);
      addRequest(profileB, wrappedReferenceA);
      addRequest(null, wrappedReferenceA);
      addRequest(null, wrappedReferenceB);
      addRequest(profileA, null);
      addRequest(null, cluster.blankReference);
    }

    return requests;
  });

type ExpectedGroup = {
  businessGroupKey: string;
  operationIdentifier: string;
  requestIds: string[];
};

function expectedIdentityKey(request: BusinessOperationIdentitySource): string {
  const normalizedReference = request.clientReference?.trim() || null;
  if (normalizedReference === null) return JSON.stringify(['standalone', request.id]);

  return JSON.stringify([
    'referenced',
    request.apiKeyId === null ? '__internal__' : request.apiKeyId,
    normalizedReference,
  ]);
}

function identityKey(identity: BusinessIdentity): string {
  if (identity.kind === 'standalone') {
    return JSON.stringify(['standalone', identity.requestId]);
  }

  return JSON.stringify([
    'referenced',
    identity.scope.kind === 'internal' ? '__internal__' : identity.scope.apiKeyId,
    identity.normalizedReference,
  ]);
}

function expectedPartition(
  requests: readonly BusinessOperationIdentitySource[],
): Map<string, ExpectedGroup> {
  const expected = new Map<string, ExpectedGroup>();

  for (const request of requests) {
    const normalizedReference = request.clientReference?.trim() || null;
    const key = expectedIdentityKey(request);
    const scope = request.apiKeyId === null ? '__internal__' : request.apiKeyId;
    const existing = expected.get(key);

    if (existing) {
      existing.requestIds.push(request.id);
      continue;
    }

    expected.set(key, {
      businessGroupKey: normalizedReference === null
        ? `request:${request.id}`
        : `profile:${scope}:reference:${normalizedReference}`,
      operationIdentifier: normalizedReference ?? request.id,
      requestIds: [request.id],
    });
  }

  return expected;
}

function canonicalPartition(
  requests: readonly BusinessOperationIdentitySource[],
): Array<{ businessGroupKey: string; operationIdentifier: string; requestIds: string[] }> {
  return groupBusinessOperationRequests(requests).map((group) => ({
    businessGroupKey: group.businessGroupKey,
    operationIdentifier: group.operationIdentifier,
    requestIds: group.requests.map((request) => request.id).sort(),
  }));
}

describe('Business Operation grouping properties', () => {
  // Feature: operations-request-tracking, Property 1: Grouping tạo một partition xác định
  // **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**
  it('creates one deterministic partition with exact membership, identifiers, and counts', () => {
    fc.assert(
      fc.property(requestsArb, (requests) => {
        const groups = groupBusinessOperationRequests(requests);
        const expected = expectedPartition(requests);
        const allMembership = groups.flatMap((group) =>
          group.requests.map((request) => request.id));

        expect(groups).toHaveLength(expected.size);
        expect(allMembership).toHaveLength(requests.length);
        expect(new Set(allMembership).size).toBe(requests.length);
        expect([...allMembership].sort()).toEqual(requests.map((request) => request.id).sort());

        for (const group of groups) {
          const expectedGroup = expected.get(identityKey(group.identity));
          expect(expectedGroup).toBeDefined();
          if (!expectedGroup) throw new Error('Generated group was absent from the oracle partition');

          expect(group.businessGroupKey).toBe(expectedGroup.businessGroupKey);
          expect(group.operationIdentifier).toBe(expectedGroup.operationIdentifier);
          expect(group.requests).toHaveLength(expectedGroup.requestIds.length);
          expect(group.requests.map((request) => request.id).sort())
            .toEqual([...expectedGroup.requestIds].sort());

          if (group.identity.kind === 'standalone') {
            expect(group.requests).toHaveLength(1);
            expect(group.requests[0].id).toBe(group.identity.requestId);
          }
        }

        expect(canonicalPartition([...requests].reverse())).toEqual(canonicalPartition(requests));
      }),
      { numRuns: 100 },
    );
  });
});
