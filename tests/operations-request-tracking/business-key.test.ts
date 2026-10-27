import { createHmac } from 'crypto';

import {
  BUSINESS_OPERATION_TOKEN_SECRET_ENV,
  businessGroupKeyForIdentity,
  createBusinessIdentity,
  decodeBusinessOperationToken,
  encodeBusinessOperationToken,
  groupBusinessOperationRequests,
  normalizeReference,
  operationIdentifierForIdentity,
  profileScopeFromApiKeyId,
  type BusinessIdentity,
} from '@/lib/operations/business-key';

const TEST_SECRET = 'business-operation-test-secret-with-sufficient-entropy';
const previousBusinessSecret = process.env[BUSINESS_OPERATION_TOKEN_SECRET_ENV];
const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;

beforeEach(() => {
  process.env[BUSINESS_OPERATION_TOKEN_SECRET_ENV] = TEST_SECRET;
});

afterAll(() => {
  if (previousBusinessSecret === undefined) {
    delete process.env[BUSINESS_OPERATION_TOKEN_SECRET_ENV];
  } else {
    process.env[BUSINESS_OPERATION_TOKEN_SECRET_ENV] = previousBusinessSecret;
  }

  if (previousNextAuthSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET;
  } else {
    process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
  }
});

describe('Business Operation identity and grouping', () => {
  it('normalizes only surrounding whitespace and maps blank references to null', () => {
    expect(normalizeReference(null)).toBeNull();
    expect(normalizeReference(' \t\n ')).toBeNull();
    expect(normalizeReference('\u2003  Hồ sơ  01 \u00a0')).toBe('Hồ sơ  01');
  });

  it('represents profile, internal, and standalone identities canonically', () => {
    expect(profileScopeFromApiKeyId('profile-1')).toEqual({
      kind: 'profile',
      apiKeyId: 'profile-1',
    });
    expect(profileScopeFromApiKeyId(null)).toEqual({ kind: 'internal' });

    const referenced = createBusinessIdentity({
      id: 'request-1',
      apiKeyId: 'profile-1',
      clientReference: '  REF-01  ',
    });
    const standalone = createBusinessIdentity({
      id: 'request-2',
      apiKeyId: 'profile-1',
      clientReference: '   ',
    });

    expect(referenced).toEqual({
      kind: 'referenced',
      scope: { kind: 'profile', apiKeyId: 'profile-1' },
      normalizedReference: 'REF-01',
    });
    expect(businessGroupKeyForIdentity(referenced)).toBe('profile:profile-1:reference:REF-01');
    expect(operationIdentifierForIdentity(referenced)).toBe('REF-01');

    expect(standalone).toEqual({ kind: 'standalone', requestId: 'request-2' });
    expect(businessGroupKeyForIdentity(standalone)).toBe('request:request-2');
    expect(operationIdentifierForIdentity(standalone)).toBe('request-2');
  });

  it('partitions requests by normalized reference and scope while keeping standalone requests isolated', () => {
    const requests = [
      { id: 'req-3', apiKeyId: null, clientReference: ' REF-1 ' },
      { id: 'req-1', apiKeyId: 'profile-a', clientReference: 'REF-1' },
      { id: 'req-2', apiKeyId: 'profile-a', clientReference: '  REF-1  ' },
      { id: 'req-4', apiKeyId: 'profile-b', clientReference: 'REF-1' },
      { id: 'req-5', apiKeyId: 'profile-a', clientReference: null },
      { id: 'req-6', apiKeyId: 'profile-a', clientReference: '\t' },
    ];

    const groups = groupBusinessOperationRequests(requests);
    expect(groups).toHaveLength(5);
    expect(groups.map((group) => group.businessGroupKey)).toEqual([
      'profile:__internal__:reference:REF-1',
      'profile:profile-a:reference:REF-1',
      'profile:profile-b:reference:REF-1',
      'request:req-5',
      'request:req-6',
    ]);

    const profileAGroup = groups.find(
      (group) => group.businessGroupKey === 'profile:profile-a:reference:REF-1',
    );
    expect(profileAGroup?.operationIdentifier).toBe('REF-1');
    expect(profileAGroup?.requests.map((request) => request.id)).toEqual(['req-1', 'req-2']);

    const allMembership = groups.flatMap((group) => group.requests.map((request) => request.id));
    expect(allMembership.sort()).toEqual(requests.map((request) => request.id).sort());
    expect(new Set(allMembership).size).toBe(requests.length);
    expect(groups
      .filter((group) => group.identity.kind === 'standalone')
      .every((group) => group.requests.length === 1)).toBe(true);
  });

  it('rejects duplicate source request IDs rather than violating partition membership', () => {
    expect(() => groupBusinessOperationRequests([
      { id: 'duplicate', apiKeyId: null, clientReference: null },
      { id: 'duplicate', apiKeyId: 'profile-a', clientReference: 'REF' },
    ])).toThrow('Duplicate request id: duplicate');
  });
});

describe('Business Operation signed token', () => {
  const identities: BusinessIdentity[] = [
    {
      kind: 'referenced',
      scope: { kind: 'profile', apiKeyId: 'profile-1' },
      normalizedReference: 'REF/2026:001',
    },
    {
      kind: 'referenced',
      scope: { kind: 'internal' },
      normalizedReference: 'Nội bộ 01',
    },
    { kind: 'standalone', requestId: 'request-1' },
  ];

  it.each(identities)('round-trips the versioned identity %#', (identity) => {
    const token = encodeBusinessOperationToken(identity);

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(decodeBusinessOperationToken(token)).toEqual(identity);
    expect(encodeBusinessOperationToken(identity)).toBe(token);
  });

  it('fails closed when the payload or signature is tampered with', () => {
    const token = encodeBusinessOperationToken(identities[0]);
    const [payload, signature] = token.split('.');
    const changedPayload = `${payload.startsWith('A') ? 'B' : 'A'}${payload.slice(1)}`;
    const changedSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;

    expect(decodeBusinessOperationToken(`${changedPayload}.${signature}`)).toEqual({
      kind: 'invalid',
      reason: 'invalid_signature',
    });
    expect(decodeBusinessOperationToken(`${payload}.${changedSignature}`)).toEqual({
      kind: 'invalid',
      reason: 'invalid_signature',
    });
  });

  it.each(['', 'one-segment', 'a.b.c', '%%%.abc', 'abc.%%%'])(
    'fails closed for malformed token %p',
    (token) => {
      expect(decodeBusinessOperationToken(token)).toEqual({
        kind: 'invalid',
        reason: 'malformed_token',
      });
    },
  );

  it('rejects a correctly signed token with an unknown version', () => {
    const encodedPayload = Buffer.from(JSON.stringify({
      v: 2,
      kind: 'standalone',
      requestId: 'request-1',
    }), 'utf8').toString('base64url');
    const signature = createHmac('sha256', TEST_SECRET)
      .update(encodedPayload, 'ascii')
      .digest('base64url');

    expect(decodeBusinessOperationToken(`${encodedPayload}.${signature}`)).toEqual({
      kind: 'invalid',
      reason: 'unknown_version',
    });
  });

  it('rejects a signed payload with non-canonical identity data', () => {
    const encodedPayload = Buffer.from(JSON.stringify({
      v: 1,
      kind: 'referenced',
      scope: { kind: 'internal' },
      normalizedReference: ' REF-1 ',
    }), 'utf8').toString('base64url');
    const signature = createHmac('sha256', TEST_SECRET)
      .update(encodedPayload, 'ascii')
      .digest('base64url');

    expect(decodeBusinessOperationToken(`${encodedPayload}.${signature}`)).toEqual({
      kind: 'invalid',
      reason: 'malformed_payload',
    });
  });

  it('fails closed when no server-side signing secret is configured', () => {
    delete process.env[BUSINESS_OPERATION_TOKEN_SECRET_ENV];
    delete process.env.NEXTAUTH_SECRET;

    expect(() => encodeBusinessOperationToken(identities[2]))
      .toThrow(BUSINESS_OPERATION_TOKEN_SECRET_ENV);
  });
});
