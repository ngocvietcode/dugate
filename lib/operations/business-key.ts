import { createHmac, timingSafeEqual } from 'crypto';

export const BUSINESS_OPERATION_TOKEN_VERSION = 1 as const;
export const BUSINESS_OPERATION_TOKEN_SECRET_ENV = 'BUSINESS_OPERATION_TOKEN_SECRET' as const;

const TOKEN_SIGNATURE_BYTES = 32;
const MAX_TOKEN_LENGTH = 4096;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type ProfileScope =
  | { kind: 'profile'; apiKeyId: string }
  | { kind: 'internal' };

export type BusinessIdentity =
  | {
      kind: 'referenced';
      scope: ProfileScope;
      normalizedReference: string;
    }
  | {
      kind: 'standalone';
      requestId: string;
    };

export type InvalidBusinessOperationToken = {
  kind: 'invalid';
  reason:
    | 'malformed_token'
    | 'invalid_signature'
    | 'malformed_payload'
    | 'unknown_version';
};

export type BusinessOperationIdentitySource = {
  id: string;
  apiKeyId: string | null;
  clientReference: string | null;
};

export type BusinessOperationGroup<T extends BusinessOperationIdentitySource> = {
  businessGroupKey: string;
  identity: BusinessIdentity;
  operationIdentifier: string;
  requests: T[];
};

type TokenPayload =
  | {
      v: typeof BUSINESS_OPERATION_TOKEN_VERSION;
      kind: 'referenced';
      scope: ProfileScope;
      normalizedReference: string;
    }
  | {
      v: typeof BUSINESS_OPERATION_TOKEN_VERSION;
      kind: 'standalone';
      requestId: string;
    };

/**
 * Normalizes the source reference used for Business Operation grouping.
 * Internal whitespace and character casing are intentionally preserved.
 */
export function normalizeReference(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function profileScopeFromApiKeyId(apiKeyId: string | null): ProfileScope {
  if (apiKeyId === null) return { kind: 'internal' };
  assertNonEmptyIdentifier(apiKeyId, 'apiKeyId');
  return { kind: 'profile', apiKeyId };
}

export function createBusinessIdentity(
  source: BusinessOperationIdentitySource,
): BusinessIdentity {
  assertNonEmptyIdentifier(source.id, 'request id');
  const normalizedReference = normalizeReference(source.clientReference);

  if (normalizedReference === null) {
    return { kind: 'standalone', requestId: source.id };
  }

  return {
    kind: 'referenced',
    scope: profileScopeFromApiKeyId(source.apiKeyId),
    normalizedReference,
  };
}

/**
 * Returns the canonical key used by the Operation.businessGroupKey projection.
 */
export function businessGroupKeyForIdentity(identity: BusinessIdentity): string {
  const validIdentity = validateIdentity(identity);

  if (validIdentity.kind === 'standalone') {
    return `request:${validIdentity.requestId}`;
  }

  const scopeId = validIdentity.scope.kind === 'internal'
    ? '__internal__'
    : validIdentity.scope.apiKeyId;
  return `profile:${scopeId}:reference:${validIdentity.normalizedReference}`;
}

export function operationIdentifierForIdentity(identity: BusinessIdentity): string {
  const validIdentity = validateIdentity(identity);
  return validIdentity.kind === 'referenced'
    ? validIdentity.normalizedReference
    : validIdentity.requestId;
}

/**
 * Partitions each unique source request into exactly one Business Operation.
 * Groups are returned in binary key order so the partition is deterministic.
 */
export function groupBusinessOperationRequests<T extends BusinessOperationIdentitySource>(
  requests: readonly T[],
): BusinessOperationGroup<T>[] {
  const groups = new Map<string, BusinessOperationGroup<T>>();
  const seenRequestIds = new Set<string>();

  for (const request of requests) {
    if (seenRequestIds.has(request.id)) {
      throw new Error(`Duplicate request id: ${request.id}`);
    }
    seenRequestIds.add(request.id);

    const identity = createBusinessIdentity(request);
    const businessGroupKey = businessGroupKeyForIdentity(identity);
    const existing = groups.get(businessGroupKey);

    if (existing) {
      existing.requests.push(request);
      continue;
    }

    groups.set(businessGroupKey, {
      businessGroupKey,
      identity,
      operationIdentifier: operationIdentifierForIdentity(identity),
      requests: [request],
    });
  }

  return [...groups.values()].sort((left, right) =>
    compareBinary(left.businessGroupKey, right.businessGroupKey));
}

/**
 * Encodes identity, not authorization. Every consumer must re-authorize the
 * resolved Operation rows at access time after decoding this token.
 */
export function encodeBusinessOperationToken(identity: BusinessIdentity): string {
  const payload = payloadFromIdentity(validateIdentity(identity));
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature.toString('base64url')}`;
}

/**
 * Verifies token integrity and shape only. A valid result never grants access;
 * callers must enforce capability and row-level scope independently.
 */
export function decodeBusinessOperationToken(
  token: string,
): BusinessIdentity | InvalidBusinessOperationToken {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return invalid('malformed_token');
  }

  const segments = token.split('.');
  if (segments.length !== 2) return invalid('malformed_token');

  const [encodedPayload, encodedSignature] = segments;
  const payloadBytes = decodeCanonicalBase64url(encodedPayload);
  const suppliedSignature = decodeCanonicalBase64url(encodedSignature);

  if (!payloadBytes || !suppliedSignature || suppliedSignature.length !== TOKEN_SIGNATURE_BYTES) {
    return invalid('malformed_token');
  }

  const expectedSignature = sign(encodedPayload);
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) {
    return invalid('invalid_signature');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return invalid('malformed_payload');
  }

  if (!isRecord(parsed) || !Object.prototype.hasOwnProperty.call(parsed, 'v')) {
    return invalid('malformed_payload');
  }
  if (parsed.v !== BUSINESS_OPERATION_TOKEN_VERSION) {
    return invalid('unknown_version');
  }

  const identity = identityFromPayload(parsed);
  return identity ?? invalid('malformed_payload');
}

function getTokenSecret(): string {
  const secret = process.env[BUSINESS_OPERATION_TOKEN_SECRET_ENV]
    ?? process.env.NEXTAUTH_SECRET;

  if (!secret || secret.trim().length === 0) {
    throw new Error(
      `[business-key] ${BUSINESS_OPERATION_TOKEN_SECRET_ENV} (or NEXTAUTH_SECRET) is not configured.`,
    );
  }

  return secret;
}

function sign(encodedPayload: string): Buffer {
  return createHmac('sha256', getTokenSecret()).update(encodedPayload, 'ascii').digest();
}

function payloadFromIdentity(identity: BusinessIdentity): TokenPayload {
  if (identity.kind === 'standalone') {
    return {
      v: BUSINESS_OPERATION_TOKEN_VERSION,
      kind: 'standalone',
      requestId: identity.requestId,
    };
  }

  return {
    v: BUSINESS_OPERATION_TOKEN_VERSION,
    kind: 'referenced',
    scope: identity.scope,
    normalizedReference: identity.normalizedReference,
  };
}

function identityFromPayload(payload: Record<string, unknown>): BusinessIdentity | null {
  if (payload.kind === 'standalone') {
    if (!hasExactKeys(payload, ['v', 'kind', 'requestId']) || !isNonEmptyString(payload.requestId)) {
      return null;
    }
    return { kind: 'standalone', requestId: payload.requestId };
  }

  if (payload.kind !== 'referenced'
    || !hasExactKeys(payload, ['v', 'kind', 'scope', 'normalizedReference'])
    || !isNonEmptyString(payload.normalizedReference)
    || normalizeReference(payload.normalizedReference) !== payload.normalizedReference
    || !isRecord(payload.scope)) {
    return null;
  }

  const scope = parseScope(payload.scope);
  return scope
    ? { kind: 'referenced', scope, normalizedReference: payload.normalizedReference }
    : null;
}

function parseScope(value: Record<string, unknown>): ProfileScope | null {
  if (value.kind === 'internal' && hasExactKeys(value, ['kind'])) {
    return { kind: 'internal' };
  }
  if (value.kind === 'profile'
    && hasExactKeys(value, ['kind', 'apiKeyId'])
    && isNonEmptyString(value.apiKeyId)) {
    return { kind: 'profile', apiKeyId: value.apiKeyId };
  }
  return null;
}

function validateIdentity(identity: BusinessIdentity): BusinessIdentity {
  if (!isRecord(identity)) throw new Error('Invalid Business Operation identity');

  if (identity.kind === 'standalone'
    && hasExactKeys(identity, ['kind', 'requestId'])
    && isNonEmptyString(identity.requestId)) {
    return { kind: 'standalone', requestId: identity.requestId };
  }

  if (identity.kind === 'referenced'
    && hasExactKeys(identity, ['kind', 'scope', 'normalizedReference'])
    && isNonEmptyString(identity.normalizedReference)
    && normalizeReference(identity.normalizedReference) === identity.normalizedReference
    && isRecord(identity.scope)) {
    const scope = parseScope(identity.scope);
    if (scope) {
      return {
        kind: 'referenced',
        scope,
        normalizedReference: identity.normalizedReference,
      };
    }
  }

  throw new Error('Invalid Business Operation identity');
}

function decodeCanonicalBase64url(value: string): Buffer | null {
  if (!BASE64URL_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : null;
}

function invalid(reason: InvalidBusinessOperationToken['reason']): InvalidBusinessOperationToken {
  return { kind: 'invalid', reason };
}

function assertNonEmptyIdentifier(value: string, label: string): void {
  if (!isNonEmptyString(value)) throw new Error(`${label} must be a non-empty string`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareBinary);
  const expected = [...expectedKeys].sort(compareBinary);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function compareBinary(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
