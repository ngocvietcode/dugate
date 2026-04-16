import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { profileEndpoints, apiKeys } from "@/lib/db/schema";
import { getAllEndpointSlugs } from "@/lib/endpoints/registry";
import { requireAdmin } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  // Rất nguy hiểm: route này xóa toàn bộ ProfileEndpoint → bắo vệ bằng ADMIN session
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const deletedEndpoints = await db.delete(profileEndpoints).returning({ id: profileEndpoints.id });
    const countDeleted = deletedEndpoints.length;
    
    const apiKeysList = await db.select().from(apiKeys);
    const allEndpoints = getAllEndpointSlugs();
    let createdCount = 0;

    for (const apiKey of apiKeysList) {
      const insertions = allEndpoints.map((ep) => ({
        apiKeyId: apiKey.id,
        endpointSlug: ep.slug,
        enabled: true,
        parameters: null,
      }));

      const result = await db.insert(profileEndpoints).values(insertions).onConflictDoNothing().returning({ id: profileEndpoints.id });
      createdCount += result.length;
    }

    return NextResponse.json({
      success: true,
      message: `Deleted ${countDeleted} old endpoints. Created ${createdCount} new endpoints matching SERVICE_REGISTRY.`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
