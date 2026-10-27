// lib/auth-guard.ts
// Central authorization guards for UI/API routes using NextAuth sessions.
// NOTE: /api/v1/* API-key routes are intentionally outside these UI guards.

import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { userProfileAssignments } from '@/lib/db/schema';
import { type Capability } from '@/lib/rbac/capabilities';
import { roleHasCapability } from '@/lib/rbac/resolve';

export type AuthenticatedSession = {
  user: {
    id: string;
    username: string;
    role: string;
  };
};
type GuardResult<T> = T | NextResponse;

// ─── requireAuth ─────────────────────────────────────────────────────────────
/** Require a valid session only. Do not use this for privileged data/actions. */
export async function requireAuth(): Promise<GuardResult<{ session: AuthenticatedSession }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return { session };
}

// ─── requireAdmin ────────────────────────────────────────────────────────────
/**
 * ADMIN-only invariant guard. Use for identity, assignment and RBAC management;
 * these controls cannot be granted to OPS through the configurable matrix.
 */
export async function requireAdmin(): Promise<GuardResult<{ session: AuthenticatedSession }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 });
  }
  return { session };
}

// ─── requireCapability ───────────────────────────────────────────────────────
/**
 * Require a server-resolved capability. Permissions are read from the
 * RolePermission matrix per request (with a short server cache), so an ADMIN
 * revocation takes effect without requiring the OPS user to sign in again.
 */
export async function requireCapability(
  capability: Capability,
): Promise<GuardResult<{ session: AuthenticatedSession }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await roleHasCapability(session.user.role, capability))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { session };
}

// ─── requireProfileAccess ────────────────────────────────────────────────────
/**
 * Require a capability and row-level access to one Profile.
 * - ADMIN and OPS with data:all-profiles bypass assignment checks.
 * - OPS without that scope must have a UserProfileAssignment record.
 * - Unknown/retired roles fail at the capability check (deny-all).
 */
export async function requireProfileAccess(
  apiKeyId: string,
  capability: Capability = 'profile:read',
): Promise<GuardResult<{ session: AuthenticatedSession; allowed: true }>> {
  const guard = await requireCapability(capability);
  if (guard instanceof NextResponse) return guard;

  const { session } = guard;
  if (await roleHasCapability(session.user.role, 'data:all-profiles')) {
    return { session, allowed: true };
  }

  const [assignment] = await db.select().from(userProfileAssignments).where(
    and(
      eq(userProfileAssignments.userId, session.user.id),
      eq(userProfileAssignments.apiKeyId, apiKeyId),
    ),
  ).limit(1);

  if (!assignment) {
    return NextResponse.json({ error: 'Forbidden — Profile not assigned to this user' }, { status: 403 });
  }
  return { session, allowed: true };
}

// ─── getAssignedProfileIds ───────────────────────────────────────────────────
/**
 * Return null for all-profile access, otherwise assigned Profile IDs. The caller
 * should have already used requireCapability(requiredCapability) to return the
 * correct 403; this helper still fails closed for unknown/revoked roles.
 */
export async function getAssignedProfileIds(
  requiredCapability: Capability = 'profile:read',
): Promise<string[] | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return [];

  if (!(await roleHasCapability(session.user.role, requiredCapability))) {
    return [];
  }
  if (await roleHasCapability(session.user.role, 'data:all-profiles')) {
    return null;
  }

  const assignments = await db.select({ apiKeyId: userProfileAssignments.apiKeyId })
    .from(userProfileAssignments)
    .where(eq(userProfileAssignments.userId, session.user.id));

  return assignments.map((assignment) => assignment.apiKeyId);
}
