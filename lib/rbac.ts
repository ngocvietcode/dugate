/**
 * Role-based access control helpers.
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextResponse } from 'next/server';

export function canMutate(role: string): boolean {
  return role === 'ADMIN' || role === 'USER';
}

export function isAdmin(role: string): boolean {
  return role === 'ADMIN';
}

/**
 * Guard: returns a 401/403 NextResponse if the caller is not an authenticated ADMIN.
 * Returns `null` when the caller IS an admin (i.e. request may proceed).
 *
 * Usage:
 *   const denied = await requireAdmin();
 *   if (denied) return denied;
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 });
  }
  return null;
}
