// app/api/internal/ext-connections/export/route.ts
// POST — Export one or more connectors as a signed dugate.connector bundle.
// Body: { slugs?: string[], ids?: string[], message?: string }
//   - omit both slugs and ids to export ALL connectors
//   - a single-element slugs/ids array powers the per-connector export button
// Secrets never leave the DB (see lib/connectors/transfer/export.ts).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { externalApiConnections } from '@/lib/db/schema';
import { inArray, asc } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { requireCapability } from '@/lib/auth-guard';
import { buildConnectorBundle, type ConnectorRow } from '@/lib/connectors/transfer/export';
import { writeAudit } from '@/lib/audit/write';
import { getSourceIp } from '@/lib/audit/context';

const logger = new Logger({ service: 'ext-connections-export' });

export async function POST(req: NextRequest) {
  const guard = await requireCapability('connector:manage');
  if (guard instanceof NextResponse) return guard;
  const session = (guard as { session?: { user?: { id?: string; role?: string } } }).session;

  try {
    const body = await req.json().catch(() => ({}));
    const slugs: unknown = body?.slugs;
    const ids: unknown = body?.ids;
    const message: string | null = typeof body?.message === 'string' ? body.message : null;

    let rows: ConnectorRow[];
    if (Array.isArray(slugs) && slugs.length > 0) {
      rows = await db.select().from(externalApiConnections)
        .where(inArray(externalApiConnections.slug, slugs.map(String)));
    } else if (Array.isArray(ids) && ids.length > 0) {
      rows = await db.select().from(externalApiConnections)
        .where(inArray(externalApiConnections.id, ids.map(String)));
    } else {
      rows = await db.select().from(externalApiConnections)
        .orderBy(asc(externalApiConnections.slug));
    }

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy connector để export' }, { status: 404 });
    }

    const bundle = buildConnectorBundle(rows, {
      sourceEnv: process.env.DEPLOY_ENV ?? null,
      exportedBy: session?.user?.id ?? null,
      appVersion: process.env.APP_VERSION ?? null,
      message,
    });

    await writeAudit({
      entityType: 'CONNECTOR',
      action: 'EXPORT',
      outcome: 'SUCCESS',
      entityName: rows.length === 1 ? rows[0].slug : `${rows.length} connectors`,
      detail: JSON.stringify({ slugs: bundle.connectors.map((c) => c.slug), contentHash: bundle.meta.contentHash }),
      actorUserId: session?.user?.id,
      actorRole: session?.user?.role,
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({ success: true, bundle });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[POST] connector export failed', {}, error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
