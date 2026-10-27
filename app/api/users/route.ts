// app/api/users/route.ts — CRUD for user management (ADMIN only)

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { Logger } from '@/lib/logger';
import { writeAudit } from '@/lib/audit/write';
import { buildChanges } from '@/lib/audit/diff';
import { AUDIT_POLICIES } from '@/lib/audit/policy';
import { getSourceIp } from '@/lib/audit/context';
import { parseUserEmail } from '@/lib/users/email';

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
    const { username, role } = body;

    if (!username) {
      return NextResponse.json({ error: 'Username là bắt buộc' }, { status: 400 });
    }

    if (username.length < 3) {
      return NextResponse.json({ error: 'Username phải có ít nhất 3 ký tự' }, { status: 400 });
    }

    const parsedEmail = parseUserEmail(body.email);
    if (!parsedEmail.ok) {
      return NextResponse.json({ error: parsedEmail.error }, { status: 400 });
    }

    // Check duplicate username
    const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing) {
      return NextResponse.json({ error: 'Username đã tồn tại' }, { status: 409 });
    }

    // Sign-in matches an incoming SSO subject by email before username, and the
    // column has no unique constraint, so reject a duplicate here: two rows sharing
    // an address would make that match ambiguous.
    if (parsedEmail.email) {
      const [emailOwner] = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, parsedEmail.email)).limit(1);
      if (emailOwner) {
        return NextResponse.json({ error: 'Email đã được dùng cho tài khoản khác' }, { status: 409 });
      }
    }

    // Authentication is delegated to the external IDP: no credential is stored
    // here. Either the username or the email must match the identity the IDP
    // presents, since sign-in links an SSO subject to this pre-provisioned row
    // (lib/auth.ts). Recording the email covers the case where the IDP sends no
    // preferred_username and the username it presents is the full address.
    const [user] = await db.insert(users).values({
      username,
      email: parsedEmail.email,
      role: ['ADMIN', 'OPS'].includes(role) ? role : 'OPS',
    }).returning({
      id: users.id,
      username: users.username,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    });

    await writeAudit({
      entityType: 'USER',
      entityId: user.id,
      entityName: user.username,
      action: 'CREATE',
      outcome: 'SUCCESS',
      changes: buildChanges(null, { username: user.username, email: user.email, role: user.role }, AUDIT_POLICIES.USER),
      actorUserId: session.user.id,
      actorRole: session.user.role,
      sourceIp: getSourceIp(request),
    });

    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    logger.error('[POST] Failed to create user', {}, err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
