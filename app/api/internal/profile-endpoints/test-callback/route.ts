import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, requireProfileAccess } from '@/lib/auth-guard';
import { parseFileUrlAuthConfig } from '@/lib/auth-config/parse';
import { testCallback } from '@/lib/profile-config/test-runner';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2_048;
}

export async function POST(req: NextRequest) {
  // Two-phase guard: capability first (before parsing the body), then the
  // per-Profile scope check once apiKeyId is known.
  const capabilityGuard = await requireCapability('endpoint:manage');
  if (capabilityGuard instanceof NextResponse) return capabilityGuard;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const callbackUrl = isNonEmptyString(input.callbackUrl)
    ? input.callbackUrl
    : isNonEmptyString(input.url) ? input.url : undefined;
  if (!isNonEmptyString(input.apiKeyId) || !isNonEmptyString(input.endpointSlug) || !callbackUrl) {
    return NextResponse.json({ error: 'apiKeyId, endpointSlug, and callbackUrl must be non-empty strings' }, { status: 400 });
  }

  const guard = await requireProfileAccess(input.apiKeyId, 'endpoint:manage');
  if (guard instanceof NextResponse) return guard;

  if (input.payload !== undefined && (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload))) {
    return NextResponse.json({ error: 'payload must be an object' }, { status: 400 });
  }
  let authConfig;
  if (input.authConfig !== undefined) {
    authConfig = parseFileUrlAuthConfig(input.authConfig);
    if (!authConfig || authConfig.type === 'query') {
      return NextResponse.json({ error: 'authConfig is invalid for callbacks' }, { status: 400 });
    }
  }

  return NextResponse.json(await testCallback({
    apiKeyId: input.apiKeyId,
    endpointSlug: input.endpointSlug,
    url: callbackUrl,
    ...(authConfig ? { authConfig } : {}),
    ...(input.payload ? { payload: input.payload as Record<string, unknown> } : {}),
  }));
}
