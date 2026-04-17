// app/api/users/[id]/route.ts — Update / Delete user (ADMIN only)

import { NextRequest, NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

// PUT /api/users/:id — update user (password / role)
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = params;
    const body = await request.json();
    const { username, password, role } = body;

    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Build update data
    const updateData: Record<string, string> = {};

    if (username && username !== existing.username) {
      const [dup] = await db.select().from(users).where(eq(users.username, username)).limit(1);
      if (dup) {
        return NextResponse.json({ error: 'Username đã tồn tại' }, { status: 409 });
      }
      updateData.username = username;
    }

    if (password) {
      if (password.length < 4) {
        return NextResponse.json({ error: 'Password phải có ít nhất 4 ký tự' }, { status: 400 });
      }
      updateData.password = await bcrypt.hash(password, 10);
    }

    if (role && ['ADMIN', 'USER', 'VIEWER'].includes(role)) {
      updateData.role = role;
    }

    const [user] = await db.update(users).set(updateData).where(eq(users.id, id)).returning({
      id: users.id, username: users.username, role: users.role, provider: users.provider,
      email: users.email, displayName: users.displayName, createdAt: users.createdAt, updatedAt: users.updatedAt
    });

    return NextResponse.json(user);
  } catch (err) {
    new Logger({ service: 'users_api' }).error('PUT /api/users/:id error', undefined, err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/users/:id — delete user
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = params;

  // Prevent self-deletion
  if (session.user.id === id) {
    return NextResponse.json({ error: 'Không thể xóa chính mình' }, { status: 400 });
  }

  const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  await db.delete(users).where(eq(users.id, id));
  return NextResponse.json({ success: true });
}
