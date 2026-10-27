// app/api/internal/worker-groups/[id]/route.ts
// PUT    — Rename a worker group (atomic: updates group + all referencing profiles)
// DELETE — Delete a worker group (only if no profiles assigned)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workerGroups, apiKeys } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireCapability } from '@/lib/auth-guard';
import { isValidWorkerGroupName } from '@/lib/queue/worker-group-validation';
import { evictGroupFromCache } from '@/lib/queue/worker-group-router';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'worker-groups-api' });

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireCapability('workergroups:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const { id } = params;
    const body = await req.json();
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 });
    }

    const trimmedName = name.trim();

    // Validate new name format
    if (!isValidWorkerGroupName(trimmedName)) {
      return NextResponse.json({
        error: 'Invalid worker group name. Must be 2–50 characters, lowercase alphanumeric and hyphens only, ' +
          'start and end with alphanumeric, and contain no consecutive hyphens.',
      }, { status: 400 });
    }

    // Find the existing group
    const [group] = await db
      .select()
      .from(workerGroups)
      .where(eq(workerGroups.id, id))
      .limit(1);

    if (!group) {
      return NextResponse.json({ error: 'Worker group not found' }, { status: 404 });
    }

    // If name hasn't changed, no-op
    if (group.name === trimmedName) {
      return NextResponse.json({ workerGroup: group });
    }

    // Check uniqueness of new name
    const [conflict] = await db
      .select({ id: workerGroups.id })
      .from(workerGroups)
      .where(eq(workerGroups.name, trimmedName))
      .limit(1);

    if (conflict) {
      return NextResponse.json({
        error: `Worker group name "${trimmedName}" is already in use.`,
      }, { status: 409 });
    }

    // Atomic rename: update group name + all referencing profiles in a transaction
    const oldName = group.name;

    const [updated] = await db.transaction(async (tx) => {
      const [renamed] = await tx
        .update(workerGroups)
        .set({ name: trimmedName })
        .where(eq(workerGroups.id, id))
        .returning();

      // Update all profiles referencing the old name
      await tx
        .update(apiKeys)
        .set({ workerGroup: trimmedName })
        .where(eq(apiKeys.workerGroup, oldName));

      return [renamed];
    });

    return NextResponse.json({ workerGroup: updated });
  } catch (error: unknown) {
    const isUniqueViolation =
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === '23505';

    if (isUniqueViolation) {
      return NextResponse.json({
        error: 'Worker group name is already in use.',
      }, { status: 409 });
    }

    logger.error('[PUT] Failed to rename worker group', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
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

    // Check for assigned profiles
    const assignedProfiles = await db
      .select({ id: apiKeys.id, name: apiKeys.name })
      .from(apiKeys)
      .where(eq(apiKeys.workerGroup, group.name));

    if (assignedProfiles.length > 0) {
      return NextResponse.json({
        error: 'Cannot delete worker group with assigned profiles.',
        assignedProfiles: assignedProfiles.map((p) => ({ id: p.id, name: p.name })),
      }, { status: 409 });
    }

    // Delete the group
    await db.delete(workerGroups).where(eq(workerGroups.id, id));

    // Clean up cached Queue/QueueEvents instances for this group
    await evictGroupFromCache(group.name);

    return NextResponse.json({ deleted: true });
  } catch (error: unknown) {
    logger.error('[DELETE] Failed to delete worker group', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
