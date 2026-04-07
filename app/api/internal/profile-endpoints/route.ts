// app/api/internal/profile-endpoints/route.ts
// GET  — List all endpoints with their ProfileEndpoint config for a given apiKeyId
// POST — Upsert ProfileEndpoint config for an apiKeyId + endpointSlug

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SERVICE_REGISTRY, getAllEndpointSlugs } from '@/lib/endpoints/registry';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const apiKeyId = searchParams.get('apiKeyId');

  if (!apiKeyId) {
    return NextResponse.json({ error: 'Missing apiKeyId' }, { status: 400 });
  }

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

      const dbConnectionsOverride = dbRecord?.connectionsOverride ? JSON.parse(dbRecord.connectionsOverride as string) : null;
      const activeConnections = (dbConnectionsOverride && dbConnectionsOverride.length > 0) ? dbConnectionsOverride : endpointDef.connections;
      
      const extConnections = activeConnections.map((connSlug: string) => {
        const conn = allExtConnections.find((c) => c.slug === connSlug);
        if (!conn) return null;
        const override = allExtOverrides.find((o) => o.connectionId === conn.id && o.endpointSlug === endpointDef.slug);
        return {
          connectionId: conn.id,
          slug: conn.slug,
          name: conn.name,
          defaultPrompt: conn.defaultPrompt,
          promptOverride: override?.promptOverride ?? null,
          isActive: !!override,
        };
      }).filter(Boolean);

      return {
        ...endpointDef,
        enabled: dbRecord ? dbRecord.enabled : true,
        parameters: dbRecord?.parameters ? JSON.parse(dbRecord.parameters as string) : null,
        connectionsOverride: dbRecord?.connectionsOverride ? JSON.parse(dbRecord.connectionsOverride as string) : null,
        id: dbRecord?.id ?? null,
        extConnections,
      };
    });

    return NextResponse.json({ endpoints: enrichedEndpoints });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GET /profile-endpoints]', msg);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKeyId, endpointSlug, enabled, parameters, connectionsOverride } = body;

    if (!apiKeyId || !endpointSlug) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate endpointSlug against SERVICE_REGISTRY
    const allSlugs = getAllEndpointSlugs().map((e) => e.slug);
    if (!allSlugs.includes(endpointSlug)) {
      // Also allow bare service slugs (e.g. "extract") as catchall overrides
      const serviceSlugs = Object.keys(SERVICE_REGISTRY);
      if (!serviceSlugs.includes(endpointSlug)) {
        return NextResponse.json({ error: `Invalid endpoint slug: '${endpointSlug}'` }, { status: 400 });
      }
    }

    const payload = {
      enabled: typeof enabled === 'boolean' ? enabled : true,
      parameters: parameters ? JSON.stringify(parameters) : null,
      connectionsOverride: connectionsOverride ? JSON.stringify(connectionsOverride) : null,
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
    console.error('[POST /profile-endpoints]', msg);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
