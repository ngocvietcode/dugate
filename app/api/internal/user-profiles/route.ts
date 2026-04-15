import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
    const assignments = await prisma.userProfileAssignment.findMany({
      where: { userId },
      select: { apiKeyId: true }
    });
    
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
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'User không tồn tại' }, { status: 404 });
    }

    // Replace assignments in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.userProfileAssignment.deleteMany({
        where: { userId }
      });

      if (apiKeyIds.length > 0) {
        await tx.userProfileAssignment.createMany({
          data: apiKeyIds.map((id: string) => ({ userId, apiKeyId: id }))
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error('[POST] Failed to update assignments', {}, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
