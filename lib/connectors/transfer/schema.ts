// lib/connectors/transfer/schema.ts
// Versioned connector transfer bundle contract. Mirrors the Profile Release
// design: strict zod, a recursive secret deny-list and a 10 MB cap. The export
// content hash is retained as informational metadata; imports may be edited so
// endpoint URLs and other non-secret settings can be adjusted after export.

import { z } from 'zod';

const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
const MAX_CONNECTORS = 200;
const MAX_TEXT = 200_000;

/**
 * Keys that must never appear anywhere in a bundle. `authSecret` is the connector
 * raw key; the header names below catch inline credentials smuggled through the
 * `extraHeaders` object. Header VALUES for these are stripped at export; this
 * deny-list is the defense-in-depth that rejects a hand-edited file that re-adds them.
 */
const forbiddenKeys = new Set([
  'id', 'authSecret', 'keyHash', 'token', 'client_secret', 'password',
]);

/**
 * Header names whose values are credentials or environment-bound identifiers and
 * must be stripped from an export (name kept for structure, value blanked). The
 * IBM client id/secret are gateway credentials that differ per environment.
 */
const SECRET_HEADER_PATTERN = /(authorization|token|secret|api[-_]?key|credential|password|x-ibm-client-(id|secret))/i;

/** Header names whose values are pure config and are safe to keep verbatim. */
const CONFIG_HEADER_ALLOWLIST = new Set(['content-type', 'x-connection-mode', 'accept']);

export function isSecretHeaderName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (CONFIG_HEADER_ALLOWLIST.has(lower)) return false;
  return SECRET_HEADER_PATTERN.test(lower);
}

/** Rejects persisted identifiers and inline secret values at every depth. */
export function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKeys.has(key)) throw new Error(`bundle contains forbidden field '${key}'`);
    assertNoForbiddenKeys(child);
  }
}

const connectorSchema = z.object({
  name: z.string().min(1).max(500),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/, 'slug: chỉ chữ thường, số, gạch ngang'),
  description: z.string().max(MAX_TEXT).nullable().optional(),
  endpointUrl: z.string().min(1).max(2_000),
  httpMethod: z.string().min(1).max(10),
  authType: z.string().min(1).max(50),
  authKeyHeader: z.string().min(1).max(200),
  vaultSecretPath: z.string().min(1).max(2_000).nullable().optional(),
  promptFieldName: z.string().min(1).max(200),
  fileFieldName: z.string().min(1).max(200),
  fileUrlFieldName: z.string().max(200).nullable().optional(),
  defaultPrompt: z.string().max(MAX_TEXT),
  staticFormFields: z.string().max(MAX_TEXT).nullable().optional(),
  extraHeaders: z.string().max(MAX_TEXT).nullable().optional(),
  responseContentPath: z.string().max(500).nullable().optional(),
  sessionIdResponsePath: z.string().max(500).nullable().optional(),
  sessionIdFieldName: z.string().max(200).nullable().optional(),
  timeoutSec: z.number().int().min(1).max(86_400),
  state: z.string().min(1).max(50),
  /**
   * Non-secret presence flag for the operator: does this connector need a raw
   * API key entered at import time (true when no Vault path is set and the auth
   * type is not NONE). The secret itself never travels in the bundle.
   */
  needsInlineSecret: z.boolean(),
}).strict();

export type ConnectorBundleEntryV1 = z.infer<typeof connectorSchema>;

const bundleSchema = z.object({
  bundleVersion: z.literal(1),
  kind: z.literal('dugate.connector'),
  connectors: z.array(connectorSchema).min(1).max(MAX_CONNECTORS),
  meta: z.object({
    sourceEnv: z.string().max(50).nullable().optional(),
    exportedAt: z.string().max(50),
    exportedBy: z.string().max(200).nullable().optional(),
    appVersion: z.string().max(50).nullable().optional(),
    message: z.string().max(2_000).nullable().optional(),
    // Informational only: edited bundles may retain a stale hash or omit it.
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  }),
}).strict();

export type ConnectorBundleV1 = z.infer<typeof bundleSchema>;

function formatIssues(issues: z.ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join('.') || 'bundle'}: ${issue.message}`).join('; ');
}

/**
 * Parse a complete v1 connector bundle.
 * Size cap -> deny-list -> strict zod. The bundle is intentionally editable;
 * contentHash is accepted as informational metadata and is not verified.
 */
export function parseConnectorBundle(value: unknown): ConnectorBundleV1 {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Bundle must be JSON serializable');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BUNDLE_BYTES) {
    throw new Error('Bundle exceeds the 10 MB limit');
  }

  assertNoForbiddenKeys(value);
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid connector bundle: ${formatIssues(parsed.error.issues)}`);

  return parsed.data;
}
