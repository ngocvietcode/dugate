import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAllEndpointSlugs } from "@/lib/endpoints/registry";
import { requireAdmin } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  // Rất nguy hiểm: route này xóa toàn bộ ProfileEndpoint → bắo vệ bằng ADMIN session
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const deletedEndpoints = await prisma.profileEndpoint.deleteMany({});
    
    const apiKeys = await prisma.apiKey.findMany();
    const allEndpoints = getAllEndpointSlugs();
    let createdCount = 0;

    for (const apiKey of apiKeys) {
      const insertions = allEndpoints.map((ep) => ({
        apiKeyId: apiKey.id,
        endpointSlug: ep.slug,
        enabled: true,
        parameters: null,
      }));

      const result = await prisma.profileEndpoint.createMany({
        data: insertions,
        skipDuplicates: true,
      });
      createdCount += result.count;
    }

    return NextResponse.json({
      success: true,
      message: `Deleted ${deletedEndpoints.count} old endpoints. Created ${createdCount} new endpoints matching SERVICE_REGISTRY.`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
