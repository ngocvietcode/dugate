// app/api/internal/worker-groups/route.ts
// GET  — List all worker groups with assigned profile counts
// POST — Create a new worker group

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workerGroups, apiKeys } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { requireCapability } from '@/lib/auth-guard';
import { isValidWorkerGroupName } from '@/lib/queue/worker-group-validation';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'worker-groups-api' });

export async function GET() {
  const guard = await requireCapability('workergroups:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    // Get all worker groups with count of assigned profiles
    const groups = await db
      .select({
        id: workerGroups.id,
        name: workerGroups.name,
        createdAt: workerGroups.createdAt,
        updatedAt: workerGroups.updatedAt,
        profileCount: sql<number>`(SELECT COUNT(*) FROM "ApiKey" WHERE "ApiKey"."workerGroup" = "WorkerGroup"."name")`.as('profileCount'),
      })
      .from(workerGroups)
      .orderBy(workerGroups.name);

    return NextResponse.json({ workerGroups: groups });
  } catch (error: unknown) {
    logger.error('[GET] Failed to list worker groups', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireCapability('workergroups:manage');
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await req.json();
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 });
    }

    const trimmedName = name.trim();

    // Validate name format
    if (!isValidWorkerGroupName(trimmedName)) {
      return NextResponse.json({
        error: 'Invalid worker group name. Must be 2–50 characters, lowercase alphanumeric and hyphens only, ' +
          'start and end with alphanumeric, and contain no consecutive hyphens.',
      }, { status: 400 });
    }

    // Check uniqueness
    const [existing] = await db
      .select({ id: workerGroups.id })
      .from(workerGroups)
      .where(eq(workerGroups.name, trimmedName))
      .limit(1);

    if (existing) {
      return NextResponse.json({
        error: `Worker group name "${trimmedName}" is already in use.`,
      }, { status: 409 });
    }

    // Create the worker group
    const [created] = await db.insert(workerGroups).values({
      name: trimmedName,
    }).returning();

    return NextResponse.json({ workerGroup: created }, { status: 201 });
  } catch (error: unknown) {
    // Handle race condition on unique constraint
    const isUniqueViolation =
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === '23505';

    if (isUniqueViolation) {
      return NextResponse.json({
        error: 'Worker group name is already in use.',
      }, { status: 409 });
    }

    logger.error('[POST] Failed to create worker group', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
