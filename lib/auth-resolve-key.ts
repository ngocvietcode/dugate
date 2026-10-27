// lib/auth-resolve-key.ts
// Shared utility for resolving API key identity from request headers.
// Used by operations routes that need to identify the caller (API key client or browser user).

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiKeys, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export interface ResolvedIdentity {
  /** Resolved API Key ID (from x-api-key-id header OR resolved from raw x-api-key) */
  apiKeyId: string | null;
  /** User ID from NextAuth session (injected by middleware) */
  userId: string | null;
  /** User role from NextAuth session */
  userRole: string | null;
}

/**
 * Resolve the caller's identity from request headers.
 * 
 * Priority:
 * 1. x-api-key-id header (pre-resolved, e.g. from test-profile-endpoint)
 * 2. x-api-key header → SHA-256 → DB lookup (external API callers like IDP/Kondor)
 * 3. x-user-id header (browser users with NextAuth session)
 */
export async function resolveCallerIdentity(req: NextRequest): Promise<ResolvedIdentity> {
  let apiKeyId = req.headers.get('x-api-key-id') ?? null;
  const userId = req.headers.get('x-user-id') ?? null;
  const tokenUserRole = req.headers.get('x-user-role') ?? null;

  // If no pre-resolved key ID, try resolving from raw x-api-key header
  if (!apiKeyId) {
    const rawKey = req.headers.get('x-api-key');
    if (rawKey) {
      try {
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const [found] = await db.select({ id: apiKeys.id, status: apiKeys.status })
          .from(apiKeys)
          .where(eq(apiKeys.keyHash, keyHash))
          .limit(1);
        if (found && found.status === 'active') {
          apiKeyId = found.id;
        }
      } catch {
        // DB error — leave apiKeyId as null
      }
    }
  }

  // Preserve the existing server-to-server API-key path exactly and avoid a
  // User-table query. Routes prioritize apiKeyId whenever it is present.
  if (apiKeyId) {
    return { apiKeyId, userId, userRole: tokenUserRole };
  }

  if (!userId) {
    return { apiKeyId: null, userId: null, userRole: null };
  }

  // getToken() in middleware only decodes the JWT and does not run the
  // NextAuth jwt callback. Resolve browser role from DB so role changes take
  // effect without logout/login. Missing users or DB failures fail closed.
  try {
    const [currentUser] = await db.select({
      id: users.id,
      role: users.role,
    }).from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!currentUser) {
      return { apiKeyId: null, userId: null, userRole: null };
    }

    return {
      apiKeyId: null,
      userId: currentUser.id,
      userRole: currentUser.role,
    };
  } catch {
    return { apiKeyId: null, userId: null, userRole: null };
  }
}
