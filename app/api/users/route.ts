// app/api/users/route.ts — CRUD for user management (ADMIN only)

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'users' });


// GET /api/users — list all users (ADMIN only)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const usersList = await db.select({
    id: users.id,
    username: users.username,
    role: users.role,
    provider: users.provider,
    email: users.email,
    displayName: users.displayName,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
  }).from(users).orderBy(asc(users.createdAt));

  return NextResponse.json(usersList);
}

// POST /api/users — create a new user (ADMIN only)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { username, password, role } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'Username và password là bắt buộc' }, { status: 400 });
    }

    if (username.length < 3) {
      return NextResponse.json({ error: 'Username phải có ít nhất 3 ký tự' }, { status: 400 });
    }

    if (password.length < 4) {
      return NextResponse.json({ error: 'Password phải có ít nhất 4 ký tự' }, { status: 400 });
    }

    // Check duplicate username
    const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing) {
      return NextResponse.json({ error: 'Username đã tồn tại' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [user] = await db.insert(users).values({
      username,
      password: hashedPassword,
      role: ['ADMIN', 'USER', 'VIEWER'].includes(role) ? role : 'USER',
    }).returning({ id: users.id, username: users.username, role: users.role, createdAt: users.createdAt });

    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    logger.error('[POST] Failed to create user', {}, err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
