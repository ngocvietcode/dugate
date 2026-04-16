// middleware.ts
// Auth: NextAuth for UI routes. /api/v1/docs/* routes allow NextAuth session OR raw x-api-key (resolved by runner layer).

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Paths that bypass ALL middleware checks (no auth required)
const BYPASS_PREFIXES = [
  '/login',
  '/api/auth',     // NextAuth endpoints
  '/api/health',
  '/api/chat',     // Public chat for homepage
  '/api/internal', // Called by middleware itself — must not loop
  '/_next',
  '/favicon.ico',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Log requests in non-production environments only
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Request] ${request.method} ${pathname}`);
  }

  // --- Bypass paths ---
  if (BYPASS_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // --- /api/v1/docs/* — Pass-through auth (runner resolves x-api-key into profile) ---
  if (pathname.startsWith('/api/v1/')) {
    // Strip sensitive internal headers to prevent spoofing
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete('x-api-key-id');
    requestHeaders.delete('x-user-id');
    requestHeaders.delete('x-user-role');

    // Inject NextAuth session info if the caller is an authenticated browser user
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET!,
    });
    if (token) {
      const userId = (token.id as string) || token.sub;
      if (userId) requestHeaders.set('x-user-id', userId);
      if (token.role) requestHeaders.set('x-user-role', token.role as string);
    }

    // Always allow — runner will validate x-api-key and resolve the profile
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // --- All other routes: NextAuth session required ---
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET!,
  });

  if (!token) {
    // API routes get 401; page routes redirect to /login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  if (token.sub) requestHeaders.set('x-user-id', token.sub);
  if (token.role) requestHeaders.set('x-user-role', token.role as string);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
};
