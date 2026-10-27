import { createHash } from 'crypto';

type JsonRecord = Record<string, unknown>;

const NULLABLE_RELEASE_FIELDS = new Set([
  'note',
  'callbackPayload',
  'connections',
  'fileUrlAuth',
  'fileUrlDefaultChunks',
  'allowedFileExtensions',
  'referenceExtract',
  'promptOverride',
  'modelOverride',
  'reasoningEffortOverride',
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareText(left: unknown, right: unknown): number {
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function canonicalArray(key: string | undefined, value: unknown[]): unknown[] {
  const canonicalItems = value.map((item) => canonicalizeValue(item));

  if (key === 'endpoints') {
    return canonicalItems.sort((left, right) => compareText(
      isRecord(left) ? left.endpointSlug : undefined,
      isRecord(right) ? right.endpointSlug : undefined,
    ));
  }

  if (key === 'overrides') {
    return canonicalItems.sort((left, right) => {
      const connectorComparison = compareText(
        isRecord(left) ? left.connectorSlug : undefined,
        isRecord(right) ? right.connectorSlug : undefined,
      );
      return connectorComparison || compareText(
        isRecord(left) ? left.stepId : undefined,
        isRecord(right) ? right.stepId : undefined,
      );
    });
  }

  // Gateway header ordering does not change request semantics. Connections are
  // intentionally not sorted: their array order defines the pipeline order.
  if (key === 'gateway_headers') {
    return canonicalItems.sort((left, right) => compareText(
      isRecord(left) ? left.name : undefined,
      isRecord(right) ? right.name : undefined,
    ));
  }

  return canonicalItems;
}

function canonicalizeValue(value: unknown, key?: string): unknown {
  if (value === undefined) return undefined;
  if (value === '' && key && NULLABLE_RELEASE_FIELDS.has(key)) return null;
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  if (Array.isArray(value)) return canonicalArray(key, value);
  if (!isRecord(value)) return value;

  const normalized: JsonRecord = {};
  for (const childKey of Object.keys(value).sort()) {
    const child = canonicalizeValue(value[childKey], childKey);
    if (child !== undefined) normalized[childKey] = child;
  }
  return normalized;
}

/**
 * Returns the deterministic release content shape used for hashes.
 * Release metadata is provenance, not configuration, so it is deliberately
 * excluded from content hashes and self-verification.
 */
export function canonicalizeRelease(value: unknown): unknown {
  if (!isRecord(value)) return canonicalizeValue(value);
  const { meta: _meta, ...content } = value;
  return canonicalizeValue(content);
}

/** Serializes release configuration deterministically without whitespace. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeRelease(value));
}

/** Returns the canonical Profile Release SHA-256 checksum. */
export function contentHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}
