// lib/auth-guard.ts
// Central RBAC guards for UI routes (NextAuth session).
// NOTE: /api/v1/* API key routes are NOT subject to these guards.

import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type GuardResult<T> = T | NextResponse;

// ─── requireAuth ─────────────────────────────────────────────────────────────
/** Yêu cầu user đã đăng nhập (bất kỳ role nào).
 *  @returns session object hoặc NextResponse 401 */
export async function requireAuth(): Promise<GuardResult<{ session: NonNullable<Awaited<ReturnType<typeof getServerSession>>> }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return { session };
}

// ─── requireAdmin ─────────────────────────────────────────────────────────────
/** Yêu cầu role ADMIN.
 *  @returns session object hoặc NextResponse 401/403 */
export async function requireAdmin(): Promise<GuardResult<{ session: NonNullable<Awaited<ReturnType<typeof getServerSession>>> }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 });
  }
  return { session };
}

// ─── requireProfileAccess ─────────────────────────────────────────────────────
/** Kiểm tra user có quyền với một profile (apiKeyId) cụ thể không.
 *  - ADMIN: luôn pass.
 *  - USER: phải có UserProfileAssignment record.
 *
 *  @returns { session, allowed: true } hoặc NextResponse 401/403 */
export async function requireProfileAccess(
  apiKeyId: string,
): Promise<GuardResult<{ session: NonNullable<Awaited<ReturnType<typeof getServerSession>>>; allowed: true }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Admin có full access
  if (session.user.role === 'ADMIN') {
    return { session, allowed: true };
  }

  // USER: kiểm tra assignment
  const assignment = await prisma.userProfileAssignment.findUnique({
    where: {
      userId_apiKeyId: {
        userId: session.user.id,
        apiKeyId,
      },
    },
  });

  if (!assignment) {
    return NextResponse.json({ error: 'Forbidden — Profile not assigned to this user' }, { status: 403 });
  }

  return { session, allowed: true };
}

// ─── getAssignedProfileIds ─────────────────────────────────────────────────────
/** Lấy danh sách apiKeyId được assign cho user hiện tại.
 *  ADMIN: trả null (nghĩa là không lọc — all access).
 *  USER: trả mảng các apiKeyId được phép. */
export async function getAssignedProfileIds(): Promise<string[] | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return [];

  if (session.user.role === 'ADMIN') return null; // null = no filter

  const assignments = await prisma.userProfileAssignment.findMany({
    where: { userId: session.user.id },
    select: { apiKeyId: true },
  });

  return assignments.map((a) => a.apiKeyId);
}
