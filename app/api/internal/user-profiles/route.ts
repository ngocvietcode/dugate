import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userProfileAssignments, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth-guard';
import { Logger } from '@/lib/logger';
import { writeAudit } from '@/lib/audit/write';
import { buildChanges } from '@/lib/audit/diff';
import { AUDIT_POLICIES } from '@/lib/audit/policy';
import { auditActor, getSourceIp } from '@/lib/audit/context';

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

    // Snapshot current assignments so the audit records the before/after set.
    const priorAssignments = await db.select({ apiKeyId: userProfileAssignments.apiKeyId })
      .from(userProfileAssignments)
      .where(eq(userProfileAssignments.userId, userId));
    const beforeIds = priorAssignments.map((a) => a.apiKeyId).sort();
    const afterIds = [...apiKeyIds].sort();

    // Replace assignments in a transaction
    await db.transaction(async (tx) => {
      await tx.delete(userProfileAssignments).where(eq(userProfileAssignments.userId, userId));

      if (apiKeyIds.length > 0) {
        await tx.insert(userProfileAssignments).values(
          apiKeyIds.map((id: string) => ({ userId, apiKeyId: id }))
        );
      }
    });

    await writeAudit({
      entityType: 'ASSIGNMENT',
      entityId: userId,
      entityName: user.username,
      action: 'UPDATE',
      outcome: 'SUCCESS',
      changes: buildChanges({ apiKeyIds: beforeIds }, { apiKeyIds: afterIds }, AUDIT_POLICIES.ASSIGNMENT),
      ...auditActor((guard as { session?: { user?: { id?: string; role?: string } } }).session),
      sourceIp: getSourceIp(req),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error('[POST] Failed to update assignments', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
