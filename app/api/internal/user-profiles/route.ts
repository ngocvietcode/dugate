import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userProfileAssignments, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth-guard';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'user-profiles' });

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    const assignments = await db.select({ apiKeyId: userProfileAssignments.apiKeyId }).from(userProfileAssignments).where(eq(userProfileAssignments.userId, userId));
    
    return NextResponse.json({ 
      success: true, 
      apiKeyIds: assignments.map(a => a.apiKeyId) 
    });
  } catch (error: any) {
    logger.error('[GET] Failed to fetch assignments', { userId }, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const { userId, apiKeyIds } = await req.json();

    if (!userId || !Array.isArray(apiKeyIds)) {
      return NextResponse.json({ error: 'Payload không hợp lệ (userId, apiKeyIds[])' }, { status: 400 });
    }

    // Verify user exists
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      return NextResponse.json({ error: 'User không tồn tại' }, { status: 404 });
    }

    // Replace assignments in a transaction
    await db.transaction(async (tx) => {
      await tx.delete(userProfileAssignments).where(eq(userProfileAssignments.userId, userId));

      if (apiKeyIds.length > 0) {
        await tx.insert(userProfileAssignments).values(
          apiKeyIds.map((id: string) => ({ userId, apiKeyId: id }))
        );
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error('[POST] Failed to update assignments', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
