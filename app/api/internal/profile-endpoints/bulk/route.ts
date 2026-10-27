import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { profileEndpoints } from '@/lib/db/schema';
import { getAllEndpointSlugs } from '@/lib/endpoints/registry';
import { requireProfileAccess } from '@/lib/auth-guard';
import { writeAudit } from '@/lib/audit/write';
import { buildChanges } from '@/lib/audit/diff';
import { AUDIT_POLICIES } from '@/lib/audit/policy';
import { auditActor, getSourceIp } from '@/lib/audit/context';
import { Logger } from '@/lib/logger';

type EndpointScope = 'all' | 'core' | 'workflows';

const logger = new Logger({ service: 'profile-endpoints-bulk' });

function isEndpointScope(value: unknown): value is EndpointScope {
  return value === 'all' || value === 'core' || value === 'workflows';
}

function getTargetEndpointSlugs(scope: EndpointScope): string[] {
  return getAllEndpointSlugs()
    .filter((endpoint) => (
      scope === 'all'
      || (scope === 'core' && !endpoint.isWorkflow)
      || (scope === 'workflows' && endpoint.isWorkflow)
    ))
    .map((endpoint) => endpoint.slug);
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { apiKeyId, enabled, scope = 'all' } = body as Record<string, unknown>;
    if (typeof apiKeyId !== 'string' || !apiKeyId || typeof enabled !== 'boolean' || !isEndpointScope(scope)) {
      return NextResponse.json({ error: 'apiKeyId, enabled, and a valid scope are required' }, { status: 400 });
    }

    const guard = await requireProfileAccess(apiKeyId, 'endpoint:manage');
    if (guard instanceof NextResponse) return guard;

    const targetSlugs = getTargetEndpointSlugs(scope);
    const updated = await db.transaction(async (tx) => {
      const existingRows = await tx.select({
        endpointSlug: profileEndpoints.endpointSlug,
        enabled: profileEndpoints.enabled,
      }).from(profileEndpoints).where(and(
        eq(profileEndpoints.apiKeyId, apiKeyId),
        inArray(profileEndpoints.endpointSlug, targetSlugs),
      ));
      const existingBySlug = new Map(existingRows.map((row) => [row.endpointSlug, row]));

      if (enabled) {
        await tx.insert(profileEndpoints)
          .values(targetSlugs.map((endpointSlug) => ({ apiKeyId, endpointSlug, enabled: true })))
          .onConflictDoUpdate({
            target: [profileEndpoints.apiKeyId, profileEndpoints.endpointSlug],
            set: { enabled: true },
          });
        return targetSlugs.filter((endpointSlug) => !existingBySlug.get(endpointSlug)?.enabled).length;
      }

      const existingTargetSlugs = existingRows.map((row) => row.endpointSlug);
      if (existingTargetSlugs.length > 0) {
        await tx.update(profileEndpoints)
          .set({ enabled: false })
          .where(and(
            eq(profileEndpoints.apiKeyId, apiKeyId),
            inArray(profileEndpoints.endpointSlug, existingTargetSlugs),
          ));
      }
      return existingRows.filter((row) => row.enabled).length;
    });

    // Audit is intentionally fail-open (writeAudit catches its own errors), matching
    // the single-endpoint route. The endpoint transaction remains all-or-nothing.
    await writeAudit({
      entityType: 'ENDPOINT',
      entityName: `Bulk ${scope} endpoints`,
      scopeEntityId: apiKeyId,
      action: enabled ? 'BULK_ENABLE' : 'BULK_DISABLE',
      outcome: 'SUCCESS',
      changes: buildChanges({ enabled: !enabled }, { enabled }, AUDIT_POLICIES.ENDPOINT),
      detail: `apiKeyId=${apiKeyId}; scope=${scope}; updated=${updated}; enabled=${enabled}`,
      ...auditActor(guard.session),
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({ updated, enabled });
  } catch (error: unknown) {
    logger.error('[POST] Failed to bulk update profile endpoints', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
