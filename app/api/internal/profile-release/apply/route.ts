import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { requireCapability, requireProfileAccess } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { apiKeys, profileEndpoints, profileReleases } from '@/lib/db/schema';
import { applyBundle, type ApplyOptions } from '@/lib/profiles/release/apply';
import { createDrizzleAdapter } from '@/lib/profiles/release/repository';
import { parseProfileReleaseBundle } from '@/lib/profiles/release/schema';

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
    const [targetProfile] = await db.select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.name, targetProfileName))
      .limit(1);
    if (targetProfile) {
      const profileGuard = await requireProfileAccess(targetProfile.id, 'release:manage');
      if (profileGuard instanceof NextResponse) return profileGuard;
    } else {
      // Creating a target Profile through a release requires global scope;
      // assigned-only OPS users may only apply to their own Profiles.
      const globalScopeGuard = await requireCapability('data:all-profiles');
      if (globalScopeGuard instanceof NextResponse) return globalScopeGuard;
    }

    const options: ApplyOptions = {
      bundle,
      plan: body.plan,
      expectedPlanHash: body.expectedPlanHash,
      expectedTargetHash: body.expectedTargetHash,
      targetProfileName,
      secrets: body.secrets,
      createMissingProfile: body.createMissingProfile === true,
      applyRuntimeHints: body.applyRuntimeHints === true,
      pruneUnknownEndpoints: body.pruneUnknownEndpoints === true,
      message: body.message,
      ticketId: body.ticketId,
      actorUserId: guard.session.user.id,
      actorRole: guard.session.user.role,
    };

    const result = await db.transaction(async (tx) => {
      const [profile] = await tx.select().from(apiKeys)
        .where(eq(apiKeys.name, targetProfileName)).limit(1);
      const endpoints = profile
        ? await tx.select().from(profileEndpoints).where(eq(profileEndpoints.apiKeyId, profile.id))
        : [];
      const [latestRelease] = await tx.select({ revision: profileReleases.revision })
        .from(profileReleases)
        .where(eq(profileReleases.profileName, targetProfileName))
        .orderBy(desc(profileReleases.revision))
        .limit(1);

      const adapter = createDrizzleAdapter(tx, profile?.id ?? '', targetProfileName);
      adapter.profile = profile ?? null;
      adapter.endpoints = endpoints;
      adapter.revision = latestRelease?.revision ?? 0;

      return applyBundle(options, adapter);
    });

    return NextResponse.json(result, { status: result.status ?? (result.success ? 200 : 400) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to apply release' },
      { status: 400 },
    );
  }
}
