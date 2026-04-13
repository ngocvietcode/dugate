// middleware.ts
// Dual auth: NextAuth for UI routes, x-api-key for /api/v1/ integration routes.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { checkRateLimit, RATE_LIMIT_API_KEY, RATE_LIMIT_IP } from '@/lib/rate-limit';

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

  // --- Public API Integration (/api/v1/) — x-api-key auth ---
  if (pathname.startsWith('/api/v1/')) {
    const passedKey = request.headers.get('x-api-key') || '';

    // If no API key provided, check for NextAuth session (browser UI calls)
    if (!passedKey) {
      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
      });
      if (token) {
        // Authenticated UI user — allow without API key
        const requestHeaders = new Headers(request.headers);
        requestHeaders.delete('x-api-key-id');
        if (token.sub) requestHeaders.set('x-user-id', token.sub);
        return NextResponse.next({ request: { headers: requestHeaders } });
      }
    }

    // Rate limit by API key (if provided) or by IP (unauthenticated)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const rateLimitKey = passedKey
      ? `ratelimit:apikey:${passedKey.slice(0, 16)}`
      : `ratelimit:ip:${ip}`;
    const rateLimitMax = passedKey ? RATE_LIMIT_API_KEY : RATE_LIMIT_IP;
    const rl = await checkRateLimit(rateLimitKey, rateLimitMax);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too Many Requests' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rl.retryAfter),
            'X-RateLimit-Remaining': '0',
          },
        },
      );
    }

    try {
      // Use INTERNAL_API_URL if UAT host isn't resolvable inside the container, fallback to request.url
      const baseUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_APP_URL || request.url;
      const authUrl = new URL('/api/internal/auth-key', baseUrl);
      
      const res = await fetch(authUrl, {
        method: 'GET',
        headers: { 'x-api-key': passedKey, 'Host': request.headers.get('host') || '' },
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
    } catch (e: any) {
      console.error('[Middleware] Internal Auth Check error:', e);
      return NextResponse.json(
        { error: 'Internal Auth Service Error', details: e?.message || String(e) },
        { status: 500 }
      );
    }
  }

  // --- All other routes: NextAuth session required ---
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
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
