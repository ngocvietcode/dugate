// lib/connectors/transfer/export.ts
// Builds a dugate.connector transfer bundle from stored connector rows. Secrets
// are hard-omitted: `authSecret` never leaves the DB, and inline credential values
// inside `extraHeaders` are stripped by header name while config headers are kept.

import { contentHash } from '@/lib/profiles/release/canonical';
import { isSecretHeaderName, type ConnectorBundleEntryV1, type ConnectorBundleV1 } from './schema';

/** Shape read from ExternalApiConnection (only the columns the bundle needs). */
export interface ConnectorRow {
  name: string;
  slug: string;
  description: string | null;
  endpointUrl: string;
  httpMethod: string;
  authType: string;
  authKeyHeader: string;
  authSecret: string;
  vaultSecretPath: string | null;
  promptFieldName: string;
  fileFieldName: string;
  fileUrlFieldName: string | null;
  defaultPrompt: string;
  staticFormFields: string | null;
  extraHeaders: string | null;
  responseContentPath: string | null;
  sessionIdResponsePath: string | null;
  sessionIdFieldName: string | null;
  timeoutSec: number;
  state: string;
}

export interface ExportMeta {
  sourceEnv?: string | null;
  exportedBy?: string | null;
  appVersion?: string | null;
  message?: string | null;
}

/**
 * Strip credential values out of the `extraHeaders` JSON object by header name.
 * Config headers (Content-Type, X-Connection-Mode, ...) keep their value so the
 * connector's runtime mode is preserved; secret-looking headers keep their name
 * (structure) with an empty value so the operator re-enters it after import.
 * Returns the re-serialized JSON string, or null when there is nothing to keep.
 */
export function sanitizeExtraHeaders(raw: string | null): string | null {
  if (!raw) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unparseable header blob may hide a credential — drop it rather than export it.
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    out[name] = isSecretHeaderName(name) ? '' : String(value ?? '');
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

function toBundleEntry(row: ConnectorRow): ConnectorBundleEntryV1 {
  const usingVault = Boolean(row.vaultSecretPath && row.vaultSecretPath.trim());
  const needsInlineSecret = !usingVault && row.authType !== 'NONE';
  return {
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    endpointUrl: row.endpointUrl,
    httpMethod: row.httpMethod,
    authType: row.authType,
    authKeyHeader: row.authKeyHeader,
    vaultSecretPath: usingVault ? row.vaultSecretPath : null,
    promptFieldName: row.promptFieldName,
    fileFieldName: row.fileFieldName,
    fileUrlFieldName: row.fileUrlFieldName ?? null,
    defaultPrompt: row.defaultPrompt,
    staticFormFields: row.staticFormFields ?? null,
    extraHeaders: sanitizeExtraHeaders(row.extraHeaders),
    responseContentPath: row.responseContentPath ?? null,
    sessionIdResponsePath: row.sessionIdResponsePath ?? null,
    sessionIdFieldName: row.sessionIdFieldName ?? null,
    timeoutSec: row.timeoutSec,
    state: row.state,
    needsInlineSecret,
  };
}

/** Assemble a signed connector bundle. The content hash is computed last. */
export function buildConnectorBundle(rows: ConnectorRow[], meta: ExportMeta = {}): ConnectorBundleV1 {
  if (rows.length === 0) throw new Error('Không có connector nào để export');

  const connectors = rows
    .map(toBundleEntry)
    .sort((left, right) => left.slug.localeCompare(right.slug));

  const bundle = {
    bundleVersion: 1 as const,
    kind: 'dugate.connector' as const,
    connectors,
    meta: {
      sourceEnv: meta.sourceEnv ?? null,
      exportedAt: new Date().toISOString(),
      exportedBy: meta.exportedBy ?? null,
      appVersion: meta.appVersion ?? null,
      message: meta.message ?? null,
      contentHash: 'sha256:0'.padEnd(71, '0'), // placeholder, replaced below
    },
  };
  bundle.meta.contentHash = contentHash(bundle);
  return bundle;
}
