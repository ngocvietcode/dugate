// app/api/users/[id]/route.ts — Identity administration (ADMIN-only)

import { NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { count, eq, sql } from 'drizzle-orm';
import { writeAudit } from '@/lib/audit/write';
import { buildChanges } from '@/lib/audit/diff';
import { AUDIT_POLICIES } from '@/lib/audit/policy';
import { getSourceIp } from '@/lib/audit/context';
import { parseUserEmail } from '@/lib/users/email';

const logger = new Logger({ service: 'users_api' });
/** Serialize destructive ADMIN role changes to preserve the at-least-one-admin invariant. */
const ADMIN_INVARIANT_LOCK = 72_418_002;

async function requireAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return null;
  }
  return session;
}

// PUT /api/users/:id — update user identity / role (ADMIN only)
export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const { id } = params;
    const { username, role } = body;

    if (role !== undefined && !['ADMIN', 'OPS'].includes(role)) {
      return NextResponse.json({ error: 'Role không hợp lệ' }, { status: 400 });
    }

    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const updateData: Record<string, string | null> = {};
    if (username && username !== existing.username) {
      const [duplicate] = await db.select().from(users).where(eq(users.username, username)).limit(1);
      if (duplicate) return NextResponse.json({ error: 'Username đã tồn tại' }, { status: 409 });
      updateData.username = username;
    }

    // Correcting the email is the recovery path when an SSO identity cannot be
    // matched, so it must be editable — not only settable at creation.
    if (body.email !== undefined) {
      const parsedEmail = parseUserEmail(body.email);
      if (!parsedEmail.ok) {
        return NextResponse.json({ error: parsedEmail.error }, { status: 400 });
      }
      if (parsedEmail.email !== existing.email) {
        // Sign-in matches by email before username and the column is not unique,
        // so a second row holding the same address would make that match ambiguous.
        if (parsedEmail.email) {
          const [emailOwner] = await db.select({ id: users.id }).from(users)
            .where(eq(users.email, parsedEmail.email)).limit(1);
          if (emailOwner && emailOwner.id !== id) {
            return NextResponse.json({ error: 'Email đã được dùng cho tài khoản khác' }, { status: 409 });
          }
        }
        updateData.email = parsedEmail.email;
      }
    }

    if (role !== undefined) updateData.role = role;

    const [user] = await db.transaction(async (transaction) => {
      // Role changes can race between two admins. A transaction-scoped advisory
      // lock makes counting and demoting the final ADMIN atomic across instances.
      if (existing.role === 'ADMIN' && updateData.role === 'OPS') {
        await transaction.execute(sql`SELECT pg_advisory_xact_lock(${ADMIN_INVARIANT_LOCK})`);
        const [{ adminCount }] = await transaction.select({ adminCount: count() })
          .from(users)
          .where(eq(users.role, 'ADMIN'));
        if (Number(adminCount) <= 1) {
          throw new Error('LAST_ADMIN_INVARIANT');
        }
      }

      return transaction.update(users).set(updateData).where(eq(users.id, id)).returning({
        id: users.id,
        username: users.username,
        role: users.role,
        provider: users.provider,
        email: users.email,
        displayName: users.displayName,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });
    });

    await writeAudit({
      entityType: 'USER',
      entityId: user.id,
      entityName: user.username,
      action: 'UPDATE',
      outcome: 'SUCCESS',
      changes: buildChanges(
        { username: existing.username, email: existing.email, role: existing.role },
        { username: user.username, email: user.email, role: user.role },
        AUDIT_POLICIES.USER,
      ),
      actorUserId: session.user.id,
      actorRole: session.user.role,
      sourceIp: getSourceIp(request),
    });

    return NextResponse.json(user);
  } catch (error) {
    if (error instanceof Error && error.message === 'LAST_ADMIN_INVARIANT') {
      return NextResponse.json({ error: 'Không thể hạ role ADMIN cuối cùng' }, { status: 400 });
    }
    logger.error('PUT /api/users/:id error', undefined, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/users/:id — delete user (ADMIN only)
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = params;
  if (session.user.id === id) {
    return NextResponse.json({ error: 'Không thể xóa chính mình' }, { status: 400 });
  }

  try {
    let deletedUser: { id: string; username: string; role: string } | null = null;
    await db.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(users).where(eq(users.id, id)).limit(1);
      if (!existing) throw new Error('USER_NOT_FOUND');

      if (existing.role === 'ADMIN') {
        await transaction.execute(sql`SELECT pg_advisory_xact_lock(${ADMIN_INVARIANT_LOCK})`);
        const [{ adminCount }] = await transaction.select({ adminCount: count() })
          .from(users)
          .where(eq(users.role, 'ADMIN'));
        if (Number(adminCount) <= 1) throw new Error('LAST_ADMIN_INVARIANT');
      }

      await transaction.delete(users).where(eq(users.id, id));
      deletedUser = { id: existing.id, username: existing.username, role: existing.role };
    });

    if (deletedUser) {
      const removed: { id: string; username: string; role: string } = deletedUser;
      await writeAudit({
        entityType: 'USER',
        entityId: removed.id,
        entityName: removed.username,
        action: 'DELETE',
        outcome: 'SUCCESS',
        detail: `role=${removed.role}`,
        actorUserId: session.user.id,
        actorRole: session.user.role,
        sourceIp: getSourceIp(request),
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'LAST_ADMIN_INVARIANT') {
      return NextResponse.json({ error: 'Không thể xóa ADMIN cuối cùng' }, { status: 400 });
    }
    logger.error('DELETE /api/users/:id error', undefined, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
