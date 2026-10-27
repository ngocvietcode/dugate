// GET /api/internal/operations/filter-options — lightweight global filter metadata.

import { NextResponse } from 'next/server';
import { and, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { getAssignedProfileIds, requireCapability } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { apiKeys, operations } from '@/lib/db/schema';
import { visibleInOperationsCondition } from '@/lib/operations/operational-metadata';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireCapability('operations:read');
  if (guard instanceof NextResponse) return guard;

  const profileIds = await getAssignedProfileIds('operations:read');
  // Hidden sub-steps would add internal connector slugs (ext-*) to the endpoint filter.
  const conditions: SQL[] = [visibleInOperationsCondition()];
  if (profileIds !== null) {
    if (profileIds.length === 0) {
      conditions.push(isNull(operations.apiKeyId));
    } else {
      conditions.push(
        sql`(${operations.apiKeyId} IN (${sql.join(profileIds.map((id) => sql`${id}`), sql`, `)}) OR ${operations.apiKeyId} IS NULL)`,
      );
    }
  }

  const visibleOperations = and(...conditions);
  const [endpointRows, profileRows, noProfileRows] = await Promise.all([
    db.selectDistinct({ endpointSlug: operations.endpointSlug })
      .from(operations)
      .where(visibleOperations),
    db.select({ id: apiKeys.id, name: apiKeys.name })
      .from(apiKeys)
      .where(profileIds !== null ? inArray(apiKeys.id, profileIds) : sql`1=1`)
      .orderBy(apiKeys.name),
    db.select({ id: operations.id })
      .from(operations)
      .where(and(visibleOperations, isNull(operations.apiKeyId)))
      .limit(1),
  ]);

  return NextResponse.json({
    endpoints: endpointRows
      .map((row) => row.endpointSlug)
      .filter((slug): slug is string => slug !== null)
      .sort(),
    profiles: profileRows,
    has_no_profile: noProfileRows.length > 0,
  });
}
