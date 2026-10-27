import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authOptions, isSsoConfigured, ssoConfigurationError } from "@/lib/auth";

const handler = NextAuth(authOptions);

/**
 * Route context supplied by Next.js. NextAuth dispatches between its App Router
 * and Pages Router implementations by checking for `params` on this argument, so
 * it must be forwarded untouched.
 */
type RouteContext = { params: Promise<{ nextauth: string[] }> };

/**
 * Fail closed on a misconfigured deployment.
 *
 * Sign-in is SSO-only, so an unconfigured OIDC provider leaves no way in at all.
 * Answering 503 with the missing variable names makes that a legible operational
 * error instead of a sign-in page that silently does nothing.
 *
 * Asserted per request rather than at module load: Next.js imports this module
 * while collecting page data during `next build`, where OIDC variables are not
 * present, so a module-scope throw would break the build.
 */
async function guarded(request: NextRequest, context: RouteContext) {
  if (!isSsoConfigured) {
    const reason = ssoConfigurationError();
    console.error(`[auth] ${reason}`);
    return NextResponse.json({ error: "SSO is not configured", detail: reason }, { status: 503 });
  }
  return handler(request, context);
}

export { guarded as GET, guarded as POST };
