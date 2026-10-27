// app/api/internal/apikeys/[id]/worker-group/route.ts
// PUT — Assign or unassign a profile's worker group

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiKeys, workerGroups } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireProfileAccess } from '@/lib/auth-guard';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'apikey-worker-group' });

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // Routing a Profile onto a worker queue is worker-topology configuration and
  // additionally requires access to the Profile being rerouted.
  const guard = await requireProfileAccess(params.id, 'workergroups:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const { id } = params;
    const body = await req.json();
    const { workerGroup } = body;

    // Find the profile
    const [profile] = await db
      .select({ id: apiKeys.id, name: apiKeys.name })
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Unassign: set workerGroup to null
    if (workerGroup === null || workerGroup === undefined) {
      const [updated] = await db
        .update(apiKeys)
        .set({ workerGroup: null })
        .where(eq(apiKeys.id, id))
        .returning();

      return NextResponse.json({ profile: { id: updated.id, name: updated.name, workerGroup: updated.workerGroup } });
    }

    // Assign: verify the worker group exists
    if (typeof workerGroup !== 'string' || workerGroup.trim() === '') {
      return NextResponse.json({ error: 'workerGroup must be a non-empty string or null' }, { status: 400 });
    }

    const trimmedGroup = workerGroup.trim();

    const [group] = await db
      .select({ name: workerGroups.name })
      .from(workerGroups)
      .where(eq(workerGroups.name, trimmedGroup))
      .limit(1);

    if (!group) {
      return NextResponse.json({
        error: `Worker group "${trimmedGroup}" not found.`,
      }, { status: 404 });
    }

    // Update the profile
    const [updated] = await db
      .update(apiKeys)
      .set({ workerGroup: trimmedGroup })
      .where(eq(apiKeys.id, id))
      .returning();

    return NextResponse.json({ profile: { id: updated.id, name: updated.name, workerGroup: updated.workerGroup } });
  } catch (error: unknown) {
    logger.error('[PUT] Failed to update profile worker group', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
