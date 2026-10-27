// app/api/internal/ext-connections/import/route.ts
// POST — Plan or apply a dugate.connector bundle.
// Body: { action: 'plan' | 'apply', bundle: <ConnectorBundleV1>, inputs?: ConnectorImportInput[] }
//   - 'plan'  : validate + diff against target rows, no writes
//   - 'apply' : upsert by slug inside a transaction; new secrets come from `inputs`,
//               never from the bundle. endpointUrl is stored as supplied and can be
//               updated later from the connector configuration UI.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { externalApiConnections } from '@/lib/db/schema';
import { inArray, eq } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { requireCapability } from '@/lib/auth-guard';
import { getSecretProvider } from '@/lib/secrets';
import { parseConnectorBundle } from '@/lib/connectors/transfer/schema';
import {
  planConnectorImport,
  resolveConnectorWriteRow,
  type ConnectorImportInput,
  type ConnectorWriteRow,
  type TargetConnectorRow,
} from '@/lib/connectors/transfer/import';
import { writeAudit } from '@/lib/audit/write';
import { getSourceIp } from '@/lib/audit/context';

const logger = new Logger({ service: 'ext-connections-import' });

const TARGET_COLUMNS = {
  slug: externalApiConnections.slug,
  endpointUrl: externalApiConnections.endpointUrl,
  authType: externalApiConnections.authType,
  authSecret: externalApiConnections.authSecret,
  vaultSecretPath: externalApiConnections.vaultSecretPath,
};

async function loadTargets(slugs: string[]): Promise<TargetConnectorRow[]> {
  if (slugs.length === 0) return [];
  return db.select(TARGET_COLUMNS).from(externalApiConnections)
    .where(inArray(externalApiConnections.slug, slugs));
}

export async function POST(req: NextRequest) {
  const guard = await requireCapability('connector:manage');
  if (guard instanceof NextResponse) return guard;
  const session = (guard as { session?: { user?: { id?: string; role?: string } } }).session;

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    if (action !== 'plan' && action !== 'apply') {
      return NextResponse.json({ success: false, error: "action phải là 'plan' hoặc 'apply'" }, { status: 400 });
    }

    // parseConnectorBundle enforces size cap, secret deny-list and strict schema.
    // Bundles remain editable: endpoint URLs and other non-secret settings are
    // intentionally accepted as supplied.
    let bundle;
    try {
      bundle = parseConnectorBundle(body?.bundle);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }

    const inputs: ConnectorImportInput[] = Array.isArray(body?.inputs) ? body.inputs : [];
    const slugs = bundle.connectors.map((c) => c.slug);
    const targets = await loadTargets(slugs);
    const plan = planConnectorImport(bundle.connectors, targets, inputs);

    if (action === 'plan') {
      return NextResponse.json({ success: true, plan });
    }

    // ── apply ──────────────────────────────────────────────────────────────
    if (!plan.applicable) {
      return NextResponse.json({ success: false, error: 'Còn connector chưa nhập secret', plan }, { status: 422 });
    }

    const inputBySlug = new Map(inputs.map((i) => [i.slug, i]));
    const targetBySlug = new Map(targets.map((t) => [t.slug, t]));

    // Import intentionally stores the endpoint exactly as supplied. Runtime
    // connector execution still validates the URL with assertSafeUrl().
    const writes: ConnectorWriteRow[] = bundle.connectors.map((entry) =>
      resolveConnectorWriteRow(entry, inputBySlug.get(entry.slug), targetBySlug.get(entry.slug)),
    );

    const results: Array<{ slug: string; op: string }> = [];
    await db.transaction(async (tx) => {
      for (const write of writes) {
        if (write.op === 'CREATE') {
          await tx.insert(externalApiConnections).values(write.values);
        } else {
          await tx.update(externalApiConnections).set(write.values)
            .where(eq(externalApiConnections.slug, write.slug));
        }
        results.push({ slug: write.slug, op: write.op });
      }
    });

    // Invalidate cached secrets for any Vault-backed connector we just wrote.
    for (const write of writes) {
      if (write.values.vaultSecretPath) getSecretProvider().invalidate(write.values.vaultSecretPath);
    }

    await writeAudit({
      entityType: 'CONNECTOR',
      action: 'APPLY',
      outcome: 'SUCCESS',
      entityName: results.length === 1 ? results[0].slug : `${results.length} connectors`,
      detail: JSON.stringify({ results, sourceEnv: bundle.meta.sourceEnv, contentHash: bundle.meta.contentHash }),
      actorUserId: session?.user?.id,
      actorRole: session?.user?.role,
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[POST] connector import failed', {}, error);
    await writeAudit({
      entityType: 'CONNECTOR', action: 'APPLY', outcome: 'FAIL',
      detail: msg, actorUserId: session?.user?.id, actorRole: session?.user?.role,
      sourceIp: getSourceIp(req),
    });
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
