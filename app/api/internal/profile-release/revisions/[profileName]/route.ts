import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { apiKeys, profileReleases } from '@/lib/db/schema';
import { requireProfileAccess } from '@/lib/auth-guard';

export async function GET(_: NextRequest, { params }: { params: { profileName: string } }) {
  const [profile] = await db.select().from(apiKeys).where(eq(apiKeys.name, params.profileName)).limit(1);
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const guard = await requireProfileAccess(profile.id);
  if (guard instanceof NextResponse) return guard;

  const rows = await db.select({
    revision: profileReleases.revision,
    version: profileReleases.version,
    contentHash: profileReleases.contentHash,
    action: profileReleases.action,
    message: profileReleases.message,
    createdByUserId: profileReleases.createdByUserId,
    createdAt: profileReleases.createdAt,
  })
    .from(profileReleases)
    .where(eq(profileReleases.profileName, params.profileName))
    .orderBy(desc(profileReleases.revision));

  const activeRevision = rows[0]?.revision ?? null;
  const activeVersion = rows[0]?.version ?? null;
  return NextResponse.json({
    revisions: rows.map((row, index) => ({ ...row, isActive: index === 0 })),
    activeRevision,
    activeVersion,
  });
}
