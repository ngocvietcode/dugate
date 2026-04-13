// lib/endpoints/profile-resolver.ts
// ProfileEndpoint loading, parameter merging, and lock enforcement.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ProfileEndpoint } from '@prisma/client';

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

  const profile = await prisma.profileEndpoint.findUnique({
    where: { apiKeyId_endpointSlug: { apiKeyId, endpointSlug } },
  });

  if (profile) return profile;

  // Fallback: service-level profile (e.g. "extract" without sub-case)
  if (endpointSlug !== serviceSlug) {
    return prisma.profileEndpoint.findUnique({
      where: { apiKeyId_endpointSlug: { apiKeyId, endpointSlug: serviceSlug } },
    });
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
              type: 'https://dugate.vn/errors/forbidden-field',
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

  try {
    const raw = JSON.parse(connectionsOverride);
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
      onLegacyFormat();
      return (raw as string[]).map((slug) => ({ slug }));
    }
    return raw as ConnectionStep[];
  } catch {
    onInvalidJson();
    return defaultConnections.map((slug) => ({ slug }));
  }
}
