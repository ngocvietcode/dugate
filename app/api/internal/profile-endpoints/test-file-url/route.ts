import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, requireProfileAccess } from '@/lib/auth-guard';
import { parseFileUrlAuthConfig } from '@/lib/auth-config/parse';
import { testFileUrl } from '@/lib/profile-config/test-runner';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2_048;
}

export async function POST(req: NextRequest) {
  // Two-phase guard. The capability check runs BEFORE the body is parsed so an
  // unauthorized caller cannot reach any configuration or outbound credential;
  // the per-Profile scope check follows once apiKeyId is known.
  const capabilityGuard = await requireCapability('endpoint:manage');
  if (capabilityGuard instanceof NextResponse) return capabilityGuard;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (!isNonEmptyString(input.apiKeyId) || !isNonEmptyString(input.endpointSlug) || !isNonEmptyString(input.url)) {
    return NextResponse.json({ error: 'apiKeyId, endpointSlug, and url must be non-empty strings' }, { status: 400 });
  }

  const guard = await requireProfileAccess(input.apiKeyId, 'endpoint:manage');
  if (guard instanceof NextResponse) return guard;

  let authConfig;
  if (input.authConfig !== undefined) {
    authConfig = parseFileUrlAuthConfig(input.authConfig);
    if (!authConfig) return NextResponse.json({ error: 'authConfig is invalid' }, { status: 400 });
  }

  return NextResponse.json(await testFileUrl({
    apiKeyId: input.apiKeyId,
    endpointSlug: input.endpointSlug,
    url: input.url,
    ...(authConfig ? { authConfig } : {}),
  }));
}
