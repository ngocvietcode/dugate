import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { profileEndpoints, apiKeys } from "@/lib/db/schema";
import { getAllEndpointSlugs } from "@/lib/endpoints/registry";
import { requireAdmin } from "@/lib/auth-guard";

// [SEC 18/09 P0.3] POST, not GET. A NextAuth `session_token` is SameSite=Lax
// (node_modules/next-auth/core/lib/cookie.js:18-27), and Lax still attaches the
// cookie to a top-level GET navigation — so a GET handler that wipes a whole
// table is reachable cross-site. POST is not sent cross-site under Lax.
export async function POST(req: NextRequest) {
  // [PROFILE-RELEASE] This developer-only destructive reset must never run in
  // production unless Ops has explicitly granted a temporary exception.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SYNC !== 'true') {
    return NextResponse.json({ error: 'Disabled in production' }, { status: 403 });
  }

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
