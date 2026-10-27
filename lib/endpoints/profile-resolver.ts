// lib/endpoints/profile-resolver.ts
// ProfileEndpoint loading, parameter merging, and file-auth inheritance.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { profileEndpoints } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { ProfileEndpoint } from '@/lib/db/schema';
import { parseFileUrlAuthConfig, type FileUrlAuthConfig } from '@/lib/file-url-downloader';
import { decrypt } from '@/lib/crypto';
import { BASE_TYPE_URI } from '@/lib/errors';

export interface ConnectionStep {
  slug: string;
  stepId?: string;
  captureSession?: string | null;
  injectSession?: string | null;
}

/**
 * Load the ProfileEndpoint for a given (apiKeyId, endpointSlug) pair.
 * Falls back to the service-level slug (e.g. "extract") if compound slug not found.
 * Returns null if no apiKeyId is provided or no profile exists.
 */
export async function loadProfileEndpoint(
  apiKeyId: string | undefined,
  endpointSlug: string,
  serviceSlug: string,
): Promise<ProfileEndpoint | null> {
  if (!apiKeyId) return null;

  const [profile] = await db.select().from(profileEndpoints)
    .where(and(eq(profileEndpoints.apiKeyId, apiKeyId), eq(profileEndpoints.endpointSlug, endpointSlug)))
    .limit(1);

  if (profile) return profile;

  // Fallback: service-level profile (e.g. "extract" without sub-case)
  if (endpointSlug !== serviceSlug) {
    const [fallback] = await db.select().from(profileEndpoints)
      .where(and(eq(profileEndpoints.apiKeyId, apiKeyId), eq(profileEndpoints.endpointSlug, serviceSlug)))
      .limit(1);
    return fallback || null;
  }

  return null;
}

/**
 * Merge parameters from DB profile + client form input.
 * Returns an error NextResponse if a locked field is overridden by the client,
 * otherwise returns the merged variables map.
 */
export function mergeParameters(
  form: FormData,
  subCaseParameters: Record<string, { defaultLocked?: boolean }>,
  dbParams: Record<string, { value: unknown; isLocked?: boolean }>,
): { ok: true; vars: Record<string, unknown> } | { ok: false; errorResponse: NextResponse } {
  const mergedVars: Record<string, unknown> = {};

  // Load defaults from DB profile
  for (const [key, config] of Object.entries(dbParams)) {
    mergedVars[key] = config.value;
  }

  const allAllowedKeys = new Set([
    ...Object.keys(subCaseParameters),
    ...Object.keys(dbParams),
  ]);

  for (const key of Array.from(allAllowedKeys)) {
    const schema = subCaseParameters[key];
    const isLocked = dbParams[key]?.isLocked ?? schema?.defaultLocked ?? false;

    if (form.has(key)) {
      if (isLocked) {
        return {
          ok: false,
          errorResponse: NextResponse.json(
            {
              type: `${BASE_TYPE_URI}/forbidden-field`,
              title: 'Forbidden Field',
              status: 400,
              detail: `The '${key}' field cannot be set by the client. It is locked by the administrator.`,
            },
            { status: 400 },
          ),
        };
      }
      mergedVars[key] = form.get(key) as string;
    }
  }

  return { ok: true, vars: mergedVars };
}

/** Parse an encrypted or legacy plaintext file URL auth payload. */
export function parseStoredFileUrlAuthConfig(raw: string | null | undefined): FileUrlAuthConfig | undefined {
  if (!raw) return undefined;
  try {
    return parseFileUrlAuthConfig(JSON.parse(decrypt(raw)));
  } catch {
    try {
      return parseFileUrlAuthConfig(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
}

/**
 * Parse a stored file-URL auth payload off any object carrying it under the
 * `fileUrlAuthConfig` key. Returns undefined when absent or unparseable.
 *
 * DO NOT pass a real ProfileEndpoint row. `ProfileEndpoint.fileUrlAuthConfig` is a
 * RETIRED column: the per-endpoint file-auth override was removed (commit 2f9cab5)
 * because it leaked decrypted credentials to the browser and could not be edited
 * without re-entering the secret. The column survives only so existing data is not
 * destroyed; nothing may read it. The single source of truth is Profile-level
 * `ApiKey.fileAuthConfig`.
 *
 * The `ProfileEndpoint` parameter type is kept for call-site compatibility but is a
 * poor guard — structural typing means a genuine row satisfies any narrower shape,
 * so no signature can block this. The real guard is a test:
 * `tests/endpoints/runner-auth.test.ts` seeds a ProfileEndpoint with
 * `fileUrlAuthConfig: 'stale-endpoint-auth'` and asserts the runner never resolves
 * it. Reviving the column turns that test red rather than failing silently.
 *
 * Both current callers (`lib/endpoints/runner.ts`, `app/api/v1/docs/workflows/route.ts`)
 * pass a synthetic `{ fileUrlAuthConfig: <ApiKey.fileAuthConfig raw> }` purely to reuse
 * the decrypt/legacy-JSON parsing below. New callers holding a raw string should call
 * `parseStoredFileUrlAuthConfig` directly instead of wrapping it.
 */
export function getFileUrlAuthConfig(pe: ProfileEndpoint | null): FileUrlAuthConfig | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return parseStoredFileUrlAuthConfig((pe as any)?.fileUrlAuthConfig);
}

/**
 * Parse the connectionsOverride field from a ProfileEndpoint into a ConnectionStep array.
 * Handles both legacy string[] format and new ConnectionStep[] format.
 */
export function parseConnectionSteps(
  connectionsOverride: string | null | undefined,
  defaultConnections: string[],
  onLegacyFormat: () => void,
  onInvalidJson: () => void,
): ConnectionStep[] {
  if (!connectionsOverride) {
    return defaultConnections.map((slug) => ({ slug }));
  }

  // Malformed/corrupt persisted config falls back to the endpoint's default
  // connections (with a warning) instead of throwing. This is a deliberate
  // availability choice: a single corrupt row must never take an endpoint — or
  // the whole Profile listing — offline. The default pipeline is the safe baseline.
  const invalid = (): ConnectionStep[] => {
    onInvalidJson();
    return defaultConnections.map((slug) => ({ slug }));
  };

  try {
    const raw: unknown = JSON.parse(connectionsOverride);
    if (!Array.isArray(raw) || raw.length > 100) return invalid();
    if (raw.every((item) => typeof item === 'string')) {
      if (raw.some((slug) => !slug.trim() || slug.length > 120)) return invalid();
      onLegacyFormat();
      return raw.map((slug) => ({ slug: slug.trim() }));
    }

    const seenStepIds = new Set<string>();
    const steps: ConnectionStep[] = [];
    for (const rawItem of raw) {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return invalid();
      const item = rawItem as Record<string, unknown>;
      if (typeof item.slug !== 'string' || !item.slug.trim() || item.slug.length > 120) return invalid();
      if (item.stepId !== undefined && item.stepId !== null
          && (typeof item.stepId !== 'string' || !item.stepId.trim() || item.stepId.length > 120)) return invalid();
      const stepId = typeof item.stepId === 'string' ? item.stepId.trim() : undefined;
      if (stepId && seenStepIds.has(stepId)) return invalid();
      if (stepId) seenStepIds.add(stepId);
      const normalizeSession = (value: unknown): string | null | undefined => {
        if (value === undefined) return undefined;
        if (value === null || value === '') return null;
        return typeof value === 'string' && value.length <= 200 ? value.trim() : undefined;
      };
      const captureSession = normalizeSession(item.captureSession);
      const injectSession = normalizeSession(item.injectSession);
      if ((item.captureSession !== undefined && captureSession === undefined)
          || (item.injectSession !== undefined && injectSession === undefined)) return invalid();
      steps.push({
        slug: item.slug.trim(),
        ...(stepId ? { stepId } : {}),
        ...(captureSession !== undefined ? { captureSession } : {}),
        ...(injectSession !== undefined ? { injectSession } : {}),
      });
    }
    return steps;
  } catch {
    return invalid();
  }
}
