import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireProfileAccess } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { apiKeys, externalApiConnections, externalApiOverrides, profileEndpoints, profileReleases } from '@/lib/db/schema';
import { buildBundle } from '@/lib/profiles/release/export';
import { isSemanticVersion } from '@/lib/profiles/release/version';

export async function POST(req: NextRequest) {
  try {
    const { apiKeyId, message = '', version: requestedVersion } = await req.json();
    if (typeof apiKeyId !== 'string') return NextResponse.json({ error: 'apiKeyId is required' }, { status: 400 });

    const guard = await requireProfileAccess(apiKeyId, 'release:manage');
    if (guard instanceof NextResponse) return guard;
    if (requestedVersion !== undefined && requestedVersion !== null && !isSemanticVersion(requestedVersion)) {
      return NextResponse.json({ error: 'Phiên bản phải theo chuẩn semver (ví dụ 1.0.0).' }, { status: 400 });
    }
    const version = requestedVersion ?? null;
    const [[profile], endpoints, overrides, connections, releases] = await Promise.all([
      db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1),
      db.select().from(profileEndpoints).where(eq(profileEndpoints.apiKeyId, apiKeyId)),
      db.select().from(externalApiOverrides).where(eq(externalApiOverrides.apiKeyId, apiKeyId)),
      db.select().from(externalApiConnections),
      db.select().from(profileReleases),
    ]);
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    const profileRevisions = releases.filter((release) => release.profileName === profile.name);
    const bundle = buildBundle({
      profile,
      endpoints,
      overrides,
      connections,
      appVersion: process.env.npm_package_version ?? 'unknown',
      version,
      message,
      exportedBy: (guard as any).session.user?.id ?? 'admin',
      sourceRevision: profileRevisions.length,
    });
    const revision = profileRevisions.length + 1;
    await db.insert(profileReleases).values({
      profileName: profile.name,
      apiKeyId: profile.id,
      revision,
      version,
      contentHash: bundle.meta.contentHash,
      bundle: JSON.stringify(bundle),
      action: 'SNAPSHOT',
      message,
      createdByUserId: (guard as any).session.user?.id ?? null,
    });
    return NextResponse.json({ success: true, bundle, revision, version });
  } catch {
    return NextResponse.json({ error: 'Unable to export Profile Release' }, { status: 500 });
  }
}
