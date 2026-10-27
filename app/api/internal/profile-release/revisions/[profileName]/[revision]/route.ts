import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { apiKeys, profileReleases } from '@/lib/db/schema';
import { requireProfileAccess } from '@/lib/auth-guard';

export async function GET(
  _: NextRequest,
  { params }: { params: { profileName: string; revision: string } },
) {
  const revision = Number(params.revision);
  if (!Number.isInteger(revision)) {
    return NextResponse.json({ error: 'Invalid revision' }, { status: 400 });
  }

  const [profile] = await db.select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.name, params.profileName))
    .limit(1);
  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const guard = await requireProfileAccess(profile.id);
  if (guard instanceof NextResponse) return guard;

  const [release] = await db.select()
    .from(profileReleases)
    .where(and(
      eq(profileReleases.profileName, params.profileName),
      eq(profileReleases.revision, revision),
    ))
    .limit(1);
  if (!release) {
    return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
  }

  try {
    return NextResponse.json({ bundle: JSON.parse(release.bundle) });
  } catch {
    return NextResponse.json({ error: 'Stored bundle is invalid' }, { status: 500 });
  }
}
