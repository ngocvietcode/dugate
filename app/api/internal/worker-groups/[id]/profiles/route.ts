// app/api/internal/worker-groups/[id]/profiles/route.ts
// GET — List profiles assigned to a specific worker group

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workerGroups, apiKeys } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireCapability } from '@/lib/auth-guard';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'worker-groups-api' });

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireCapability('workergroups:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const { id } = params;

    // Find the group
    const [group] = await db
      .select()
      .from(workerGroups)
      .where(eq(workerGroups.id, id))
      .limit(1);

    if (!group) {
      return NextResponse.json({ error: 'Worker group not found' }, { status: 404 });
    }

    // Get assigned profiles
    const profiles = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        status: apiKeys.status,
      })
      .from(apiKeys)
      .where(eq(apiKeys.workerGroup, group.name));

    return NextResponse.json({ profiles });
  } catch (error: unknown) {
    logger.error('[GET] Failed to list profiles for worker group', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
