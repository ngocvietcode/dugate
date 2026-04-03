// middleware.ts
// Dual auth: NextAuth for UI routes, x-api-key for /api/v1/ integration routes.

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

  // Log mọi request ra terminal để user dễ debug
  console.log(`[Request] ${request.method} ${pathname}`);

  // --- Bypass paths ---
  if (pathname === '/' || BYPASS_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // --- Public API Integration (/api/v1/) — x-api-key auth ---
  if (pathname.startsWith('/api/v1/')) {
    const passedKey = request.headers.get('x-api-key') || '';

    try {
      const authUrl = new URL('/api/internal/auth-key', request.url);
      const res = await fetch(authUrl, {
        method: 'GET',
        headers: { 'x-api-key': passedKey },
        cache: 'no-store',
      });
      const data = await res.json();

      if (!res.ok || !data.valid) {
        return NextResponse.json(
          { error: data.error || 'Unauthorized' },
          { status: res.status }
        );
      }

      const requestHeaders = new Headers(request.headers);
      if (data.apiKeyId) {
        requestHeaders.set('x-api-key-id', data.apiKeyId);
      } else {
        requestHeaders.delete('x-api-key-id');
      }
      return NextResponse.next({
        request: { headers: requestHeaders },
      });
    } catch {
      return NextResponse.json({ error: 'Internal Auth Service Error' }, { status: 500 });
    }
  }

  // --- All other routes: NextAuth session required ---
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET || 'fallback-dev-secret-12345',
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
};
