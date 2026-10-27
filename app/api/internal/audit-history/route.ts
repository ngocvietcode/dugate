import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, or } from 'drizzle-orm';
import { requireCapability, requireProfileAccess } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { configAudits } from '@/lib/db/schema';
import { AUDIT_POLICIES, type AuditedEntityType } from '@/lib/audit/policy';
import type { AuditSummary, ChangeSet } from '@/lib/audit/diff';

const ENTITY_TYPES = ['PROFILE', 'CONNECTOR'] as const;
type HistoryEntityType = typeof ENTITY_TYPES[number];

/** All entity types that can appear in a timeline (including via scopeEntityId). */
const SANITIZABLE_TYPES = new Set<string>(Object.keys(AUDIT_POLICIES));

const MAX_PAGE_SIZE = 50;

function parsePositiveInteger(value: string | null, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function summaryFromUnknown(value: unknown): AuditSummary {
  const content = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return { kind: 'summary', length: content.length, hash: 'legacy' };
}

/**
 * Defense in depth for historical entries written before field policies existed.
 * This prevents existing raw values from being rendered through the new history
 * endpoint even if an old row contains an unsafe payload.
 */
function sanitizeChanges(entityType: string, raw: string | null): ChangeSet | null {
  if (!raw) return null;
  const policy = SANITIZABLE_TYPES.has(entityType)
    ? AUDIT_POLICIES[entityType as AuditedEntityType]
    : null;
  // Unknown entity types: drop changes entirely rather than risk leaking raw data.
  if (!policy) return null;

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const safe: ChangeSet = {};
  for (const [field, mode] of Object.entries(policy)) {
    const change = (parsed as Record<string, unknown>)[field];
    if (!change || typeof change !== 'object' || Array.isArray(change)) continue;
    const from = (change as Record<string, unknown>).from;
    const to = (change as Record<string, unknown>).to;
    if (mode === 'VALUE') safe[field] = { from, to };
    if (mode === 'PRESENCE') safe[field] = {
      from: from == null ? from : 'configured',
      to: to == null ? to : 'configured',
    };
    if (mode === 'SUMMARY') safe[field] = {
      from: from == null ? from : summaryFromUnknown(from),
      to: to == null ? to : summaryFromUnknown(to),
    };
  }
  return safe;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entityType');
  const entityId = searchParams.get('entityId');
  if (!ENTITY_TYPES.includes(entityType as HistoryEntityType) || !entityId) {
    return NextResponse.json({ error: 'entityType (PROFILE|CONNECTOR) and entityId are required' }, { status: 400 });
  }

  const typedEntityType = entityType as HistoryEntityType;
  const guard = typedEntityType === 'PROFILE'
    ? await requireProfileAccess(entityId, 'profile:read')
    : await requireCapability('connector:manage');
  if (guard instanceof NextResponse) return guard;

  const page = parsePositiveInteger(searchParams.get('page'), 0);
  const pageSize = Math.min(Math.max(1, parsePositiveInteger(searchParams.get('pageSize'), 20)), MAX_PAGE_SIZE);

  const rows = await db.select({
    id: configAudits.id,
    entityType: configAudits.entityType,
    entityId: configAudits.entityId,
    entityName: configAudits.entityName,
    scopeEntityId: configAudits.scopeEntityId,
    action: configAudits.action,
    outcome: configAudits.outcome,
    changes: configAudits.changes,
    actorUserId: configAudits.actorUserId,
    actorRole: configAudits.actorRole,
    sourceIp: configAudits.sourceIp,
    createdAt: configAudits.createdAt,
  }).from(configAudits)
    .where(typedEntityType === 'PROFILE'
      ? or(
        and(eq(configAudits.entityType, typedEntityType), eq(configAudits.entityId, entityId)),
        eq(configAudits.scopeEntityId, entityId),
      )
      : and(eq(configAudits.entityType, typedEntityType), eq(configAudits.entityId, entityId)))
    .orderBy(desc(configAudits.createdAt), desc(configAudits.id))
    .limit(pageSize + 1)
    .offset(page * pageSize);

  const hasMore = rows.length > pageSize;
  return NextResponse.json({
    entries: rows.slice(0, pageSize).map(({ changes, entityType: rowEntityType, ...entry }) => ({
      ...entry,
      entityType: rowEntityType,
      changes: sanitizeChanges(rowEntityType, changes),
    })),
    page,
    pageSize,
    hasMore,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
