import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ENDPOINT_REGISTRY } from '@/lib/endpoints/registry';

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
         select: { id: true, slug: true, name: true, defaultPrompt: true }
      }),
      prisma.externalApiOverride.findMany({ where: { apiKeyId } })
    ]);

    const enrichedEndpoints = Object.values(ENDPOINT_REGISTRY).map(def => {
      const dbRecord = profileEndpoints.find((p: any) => p.endpointSlug === def.slug);
      
      const extConnections = def.connections.map(connSlug => {
        const conn = allExtConnections.find(c => c.slug === connSlug);
        if (!conn) return null;
        const override = allExtOverrides.find(o => o.connectionId === conn.id);
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
        ...def,
        enabled: dbRecord ? dbRecord.enabled : true,
        defaultParams: dbRecord?.defaultParams ? JSON.parse(dbRecord.defaultParams as string) : null,
        profileParams: dbRecord?.profileParams ? JSON.parse(dbRecord.profileParams as string) : null,
        id: dbRecord?.id || null, // null means not explicitly configured yet
        extConnections,
      };
    });

    return NextResponse.json({ endpoints: enrichedEndpoints });
  } catch (error: any) {
    console.error('[GET /profile-endpoints]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKeyId, endpointSlug, enabled, defaultParams, profileParams } = body;

    if (!apiKeyId || !endpointSlug) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!ENDPOINT_REGISTRY[endpointSlug]) {
      return NextResponse.json({ error: 'Invalid endpoint slug' }, { status: 400 });
    }

    const payload = {
      enabled: typeof enabled === 'boolean' ? enabled : true,
      defaultParams: defaultParams ? JSON.stringify(defaultParams) : null,
      profileParams: profileParams ? JSON.stringify(profileParams) : null,
    };

    const record = await prisma.profileEndpoint.upsert({
      where: {
        apiKeyId_endpointSlug: {
          apiKeyId,
          endpointSlug,
        },
      },
      update: payload,
      create: {
        apiKeyId,
        endpointSlug,
        ...payload,
      },
    });

    return NextResponse.json({ profileEndpoint: record }, { status: 200 });
  } catch (error: any) {
    console.error('[POST /profile-endpoints]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
