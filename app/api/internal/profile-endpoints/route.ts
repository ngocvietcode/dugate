// app/api/internal/profile-endpoints/route.ts
// GET  — List all endpoints with their ProfileEndpoint config for a given apiKeyId
// POST — Upsert ProfileEndpoint config for an apiKeyId + endpointSlug

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SERVICE_REGISTRY, getAllEndpointSlugs } from '@/lib/endpoints/registry';
import { encrypt, decrypt } from '@/lib/crypto';
import { Logger } from '@/lib/logger';
import { requireAdmin, requireProfileAccess } from '@/lib/auth-guard';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const logger = new Logger({ service: 'profile-endpoints' });


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const apiKeyId = searchParams.get('apiKeyId');

  if (!apiKeyId) {
    return NextResponse.json({ error: 'Missing apiKeyId' }, { status: 400 });
  }

  const guard = await requireProfileAccess(apiKeyId);
  if (guard instanceof NextResponse) return guard;

  try {
    const [profileEndpoints, allExtConnections, allExtOverrides] = await Promise.all([
      prisma.profileEndpoint.findMany({ where: { apiKeyId } }),
      prisma.externalApiConnection.findMany({
        select: { id: true, slug: true, name: true, defaultPrompt: true },
      }),
      prisma.externalApiOverride.findMany({ where: { apiKeyId } }),
    ]);

    // Flatten SERVICE_REGISTRY into enriched endpoint list
    const enrichedEndpoints = getAllEndpointSlugs().map((endpointDef) => {
      const dbRecord = profileEndpoints.find((p) => p.endpointSlug === endpointDef.slug);

      let dbConnectionsOverride = null;
      try { dbConnectionsOverride = dbRecord?.connectionsOverride ? JSON.parse(dbRecord.connectionsOverride as string) : null; } catch { /* skip corrupt JSON */ }

      let dbParameters = null;
      try { dbParameters = dbRecord?.parameters ? JSON.parse(dbRecord.parameters as string) : null; } catch { /* skip corrupt JSON */ }

      // Decrypt fileUrlAuthConfig (stored encrypted via AES-256-GCM)
      let fileUrlAuthConfigParsed = null;
      if (dbRecord?.fileUrlAuthConfig) {
        try {
          const decrypted = decrypt(dbRecord.fileUrlAuthConfig);
          fileUrlAuthConfigParsed = JSON.parse(decrypted);
        } catch {
          // Fallback: try plain JSON (legacy data before encryption was added)
          try { fileUrlAuthConfigParsed = JSON.parse(dbRecord.fileUrlAuthConfig); } catch { /* skip */ }
        }
      }

      // Normalize steps: extract slug and stepId from each item
      interface ConnStepItem { slug: string; stepId?: string; captureSession?: string | null; injectSession?: string | null; }
      const toStep = (item: string | ConnStepItem): ConnStepItem =>
        typeof item === 'string' ? { slug: item } : item;

      const activeSteps: ConnStepItem[] =
        dbConnectionsOverride && dbConnectionsOverride.length > 0
          ? (dbConnectionsOverride as Array<string | ConnStepItem>).map(toStep)
          : endpointDef.connections.map((slug: string) => ({ slug }));
      
      const extConnections = activeSteps.map((stepItem: ConnStepItem) => {
        const conn = allExtConnections.find((c) => c.slug === stepItem.slug);
        if (!conn) return null;
        // Match override by connectionId + endpointSlug + stepId
        const resolvedStepId = stepItem.stepId ?? '_default';
        const override = allExtOverrides.find(
          (o) => o.connectionId === conn.id && o.endpointSlug === endpointDef.slug && o.stepId === resolvedStepId
        );
        return {
          connectionId: conn.id,
          slug: conn.slug,
          name: conn.name,
          defaultPrompt: conn.defaultPrompt,
          promptOverride: override?.promptOverride ?? null,
          isActive: !!override,
          stepId: stepItem.stepId ?? null,
        };
      }).filter(Boolean);

      return {
        ...endpointDef,
        enabled: dbRecord ? dbRecord.enabled : true,
        parameters: dbParameters,
        connectionsOverride: dbConnectionsOverride,
        jobPriority: dbRecord?.jobPriority ?? 'MEDIUM',
        fileUrlAuthConfig: fileUrlAuthConfigParsed,
        allowedFileExtensions: dbRecord?.allowedFileExtensions ?? null,
        isWorkflow: endpointDef.isWorkflow ?? false,
        id: dbRecord?.id ?? null,
        extConnections,
      };
    });

    return NextResponse.json({ endpoints: enrichedEndpoints });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[GET] Failed to list profile endpoints', { apiKeyId: apiKeyId ?? 'unknown' }, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKeyId, endpointSlug, enabled, parameters, connectionsOverride, jobPriority, fileUrlAuthConfig, allowedFileExtensions } = body;

    if (!apiKeyId || !endpointSlug) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const guard = await requireProfileAccess(apiKeyId);
    if (guard instanceof NextResponse) return guard;

    const session = await getServerSession(authOptions);
    const isAdmin = session?.user?.role === 'ADMIN';

    // Validate endpointSlug against SERVICE_REGISTRY
    const allSlugs = getAllEndpointSlugs().map((e) => e.slug);
    if (!allSlugs.includes(endpointSlug)) {
      // Also allow bare service slugs (e.g. "extract") as catchall overrides
      const serviceSlugs = Object.keys(SERVICE_REGISTRY);
      if (!serviceSlugs.includes(endpointSlug)) {
        return NextResponse.json({ error: `Invalid endpoint slug: '${endpointSlug}'` }, { status: 400 });
      }
    }

    if (!isAdmin) {
      const existing = await prisma.profileEndpoint.findUnique({
        where: { apiKeyId_endpointSlug: { apiKeyId, endpointSlug } }
      });
      if (!existing || !existing.enabled) {
        return NextResponse.json({ error: 'Endpoint is not enabled or does not exist. Users cannot configure disabled endpoints.' }, { status: 403 });
      }

      // User can only update parameters and overrides, not core properties
      const record = await prisma.profileEndpoint.update({
        where: { apiKeyId_endpointSlug: { apiKeyId, endpointSlug } },
        data: {
          parameters: parameters ? JSON.stringify(parameters) : null,
          connectionsOverride: connectionsOverride ? JSON.stringify(connectionsOverride) : null,
        },
      });
      return NextResponse.json(record);
    }

    // Admin can update all fields
    const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
    const payload = {
      enabled: typeof enabled === 'boolean' ? enabled : true,
      parameters: parameters ? JSON.stringify(parameters) : null,
      connectionsOverride: connectionsOverride ? JSON.stringify(connectionsOverride) : null,
      fileUrlAuthConfig: fileUrlAuthConfig ? encrypt(JSON.stringify(fileUrlAuthConfig)) : null,
      allowedFileExtensions: typeof allowedFileExtensions === 'string' && allowedFileExtensions.trim() ? allowedFileExtensions.trim() : null,
      jobPriority: VALID_PRIORITIES.includes(jobPriority) ? jobPriority : 'MEDIUM',
    };

    const record = await prisma.profileEndpoint.upsert({
      where: {
        apiKeyId_endpointSlug: { apiKeyId, endpointSlug },
      },
      update: payload,
      create: { apiKeyId, endpointSlug, ...payload },
    });

    return NextResponse.json({ profileEndpoint: record }, { status: 200 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[POST] Failed to upsert profile endpoint', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
