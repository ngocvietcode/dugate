import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireCapability, requireProfileAccess } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { apiKeys, externalApiConnections, profileEndpoints, workerGroups } from '@/lib/db/schema';
import { getAllEndpointSlugs } from '@/lib/endpoints/registry';
import { parseProfileReleaseBundle } from '@/lib/profiles/release/schema';
import { planApply } from '@/lib/profiles/release/plan';
import { writeAudit } from '@/lib/audit/write';

function resolveTargetProfileName(value: unknown, sourceProfileName: string): string {
  if (value === undefined) return sourceProfileName;
  if (typeof value !== 'string') throw new Error('Tên Profile đích không hợp lệ');
  const targetProfileName = value.trim();
  if (!targetProfileName || targetProfileName.length > 120) {
    throw new Error('Tên Profile đích không hợp lệ');
  }
  return targetProfileName;
}

export async function POST(req: NextRequest) {
  const guard = await requireCapability('release:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await req.json();
    const bundle = parseProfileReleaseBundle(body.bundle);
    const targetProfileName = resolveTargetProfileName(body.targetProfileName, bundle.profile.name);
    const [targetProfileRecord] = await db.select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.name, targetProfileName))
      .limit(1);
    if (targetProfileRecord) {
      const profileGuard = await requireProfileAccess(targetProfileRecord.id, 'release:manage');
      if (profileGuard instanceof NextResponse) return profileGuard;
    } else {
      // Only a globally scoped operator may prepare a release for a Profile
      // that does not yet exist locally.
      const globalScopeGuard = await requireCapability('data:all-profiles');
      if (globalScopeGuard instanceof NextResponse) return globalScopeGuard;
    }

    const [profiles, endpoints, connectors, groups] = await Promise.all([
      db.select().from(apiKeys),
      db.select().from(profileEndpoints),
      db.select().from(externalApiConnections),
      db.select().from(workerGroups),
    ]);
    const matchingProfiles = profiles.filter((profile) => profile.name === targetProfileName);
    const targetProfile = matchingProfiles[0];
    const plan = planApply(bundle, {
      profile: targetProfile,
      profilesByName: matchingProfiles.length,
      endpoints: targetProfile ? endpoints.filter((endpoint) => endpoint.apiKeyId === targetProfile.id) : [],
      connectors,
      workerGroups: groups.map((group) => group.name),
      endpointSlugs: getAllEndpointSlugs().map((endpoint) => endpoint.slug),
      appVersion: process.env.npm_package_version ?? 'unknown',
      targetProfileName,
    });
    await writeAudit({
      entityType: 'RELEASE',
      entityName: targetProfileName,
      action: 'PLAN',
      outcome: plan.applicable ? 'SUCCESS' : 'BLOCKED',
      planHash: plan.planHash,
      actorUserId: guard.session.user.id,
      actorRole: guard.session.user.role,
    });
    return NextResponse.json({ success: true, plan, targetProfileName, targetExists: Boolean(targetProfile) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid release bundle' }, { status: 400 });
  }
}
