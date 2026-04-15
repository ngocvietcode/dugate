// app/api/users/[id]/route.ts — Update / Delete user (ADMIN only)

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Build update data
    const updateData: Record<string, string> = {};

    if (username && username !== existing.username) {
      const dup = await prisma.user.findUnique({ where: { username } });
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

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, username: true, role: true, provider: true, email: true, displayName: true, createdAt: true, updatedAt: true },
    });

    return NextResponse.json(user);
  } catch (err) {
    console.error('[PUT /api/users/:id]', err);
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

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
