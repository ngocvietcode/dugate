// lib/connectors/transfer/import.ts
// Pure import planning + row assembly for connector bundles. This module performs
// NO database or DNS access so it is fully unit-testable; the API route layer
// performs the actual db.transaction upsert. Runtime connector execution remains
// responsible for SSRF validation before making an outbound request.

import type { ConnectorBundleEntryV1 } from './schema';

export type ConnectorChangeOp = 'CREATE' | 'UPDATE';

export interface TargetConnectorRow {
  slug: string;
  endpointUrl: string;
  authType: string;
  authSecret: string;
  vaultSecretPath: string | null;
}

/** Per-connector operator input collected by the import wizard. */
export interface ConnectorImportInput {
  slug: string;
  /** Operator-supplied endpoint URL for the target env (defaults to the bundle value). */
  endpointUrl?: string;
  /** New raw API key. Required when needsInlineSecret and no Vault path is used. */
  inlineSecret?: string;
  /** Operator-supplied Vault path override for the target env. */
  vaultSecretPath?: string;
}

export interface ConnectorPlanItem {
  slug: string;
  name: string;
  op: ConnectorChangeOp;
  /** True when this connector requires a secret the operator has not yet provided. */
  secretRequired: boolean;
  /** endpointUrl changes vs the target (informational; host change is worth review). */
  endpointUrlChanged: boolean;
  hostChanged: boolean;
}

export interface ConnectorPlan {
  items: ConnectorPlanItem[];
  /** True only when every item has all required secrets supplied. */
  applicable: boolean;
  blockers: string[];
}

function hostOf(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}

function usingVault(input: ConnectorImportInput | undefined, entry: ConnectorBundleEntryV1): boolean {
  const path = (input?.vaultSecretPath ?? entry.vaultSecretPath ?? '').trim();
  return path.length > 0;
}

/**
 * Determine, per connector, whether an auth value is still required. The requirement
 * is satisfied when: a Vault path is in effect, OR the operator supplied a new inline
 * key, OR the target already stores usable key material for the SAME auth type.
 */
function secretSatisfied(
  entry: ConnectorBundleEntryV1,
  input: ConnectorImportInput | undefined,
  target: TargetConnectorRow | undefined,
): boolean {
  if (entry.authType === 'NONE') return true;
  if (usingVault(input, entry)) return true;
  if (input?.inlineSecret && input.inlineSecret.trim()) return true;
  // Existing target key material is reusable only when the auth type is unchanged and a
  // raw key is actually stored (not a Vault-only or empty record).
  if (target && target.authType === entry.authType && target.authSecret && target.authSecret.trim()) {
    return true;
  }
  return false;
}

/** Build a preview plan; never mutates. `applicable` gates the apply step. */
export function planConnectorImport(
  connectors: ConnectorBundleEntryV1[],
  targets: TargetConnectorRow[],
  inputs: ConnectorImportInput[] = [],
): ConnectorPlan {
  const targetBySlug = new Map(targets.map((t) => [t.slug, t]));
  const inputBySlug = new Map(inputs.map((i) => [i.slug, i]));
  const blockers: string[] = [];

  const items: ConnectorPlanItem[] = connectors.map((entry) => {
    const target = targetBySlug.get(entry.slug);
    const input = inputBySlug.get(entry.slug);
    const op: ConnectorChangeOp = target ? 'UPDATE' : 'CREATE';
    const secretRequired = !secretSatisfied(entry, input, target);
    if (secretRequired) blockers.push(`Connector '${entry.slug}' cần nhập API Key hoặc Vault path`);

    const effectiveUrl = (input?.endpointUrl ?? entry.endpointUrl).trim();
    const endpointUrlChanged = Boolean(target) && target!.endpointUrl !== effectiveUrl;
    const hostChanged = Boolean(target) && hostOf(target!.endpointUrl) !== hostOf(effectiveUrl);

    return { slug: entry.slug, name: entry.name, op, secretRequired, endpointUrlChanged, hostChanged };
  });

  return { items, applicable: blockers.length === 0, blockers };
}

/** Columns written to ExternalApiConnection for one connector on apply. */
export interface ConnectorWriteRow {
  slug: string;
  op: ConnectorChangeOp;
  values: {
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
  };
}

/**
 * Resolve one bundle entry + operator input + target into the concrete row to
 * upsert. Secret resolution rules mirror the connector PUT route:
 *   - Vault path in effect  → authSecret cleared to ''
 *   - new inline key         → stored as authSecret
 *   - neither, target exists → keep the target's existing authSecret
 */
export function resolveConnectorWriteRow(
  entry: ConnectorBundleEntryV1,
  input: ConnectorImportInput | undefined,
  target: TargetConnectorRow | undefined,
): ConnectorWriteRow {
  const op: ConnectorChangeOp = target ? 'UPDATE' : 'CREATE';
  const endpointUrl = (input?.endpointUrl ?? entry.endpointUrl).trim();
  const vaultPath = (input?.vaultSecretPath ?? entry.vaultSecretPath ?? '').trim() || null;

  let authSecret = '';
  if (vaultPath) {
    authSecret = '';
  } else if (input?.inlineSecret && input.inlineSecret.trim()) {
    authSecret = input.inlineSecret.trim();
  } else if (target && target.authType === entry.authType) {
    authSecret = target.authSecret ?? '';
  }

  return {
    slug: entry.slug,
    op,
    values: {
      name: entry.name,
      slug: entry.slug,
      description: entry.description ?? null,
      endpointUrl,
      httpMethod: entry.httpMethod,
      authType: entry.authType,
      authKeyHeader: entry.authKeyHeader,
      authSecret,
      vaultSecretPath: vaultPath,
      promptFieldName: entry.promptFieldName,
      fileFieldName: entry.fileFieldName,
      fileUrlFieldName: entry.fileUrlFieldName ?? null,
      defaultPrompt: entry.defaultPrompt,
      staticFormFields: entry.staticFormFields ?? null,
      extraHeaders: entry.extraHeaders ?? null,
      responseContentPath: entry.responseContentPath ?? null,
      sessionIdResponsePath: entry.sessionIdResponsePath ?? null,
      sessionIdFieldName: entry.sessionIdFieldName ?? null,
      timeoutSec: entry.timeoutSec,
      state: entry.state,
    },
  };
}
