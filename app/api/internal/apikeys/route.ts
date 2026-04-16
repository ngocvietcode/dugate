import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiKeys } from '@/lib/db/schema';
import { eq, inArray, desc } from 'drizzle-orm';
import crypto from 'crypto';
import { Logger } from '@/lib/logger';
import { requireAuth, requireAdmin, getAssignedProfileIds } from '@/lib/auth-guard';

const logger = new Logger({ service: 'apikeys' });


export async function GET(req: NextRequest) {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  try {
    const assignedIds = await getAssignedProfileIds();
    const whereCondition = assignedIds === null ? undefined : inArray(apiKeys.id, assignedIds);

    const keys = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      status: apiKeys.status,
      note: apiKeys.note,
    })
    .from(apiKeys)
    .where(whereCondition)
    .orderBy(desc(apiKeys.createdAt));
    
    return NextResponse.json({ success: true, apiKeys: keys });
  } catch (error: any) {
    logger.error('[GET] DB error', {}, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Cập nhật ApiKey (Note) hoặc Rotate Key
export async function PUT(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await req.json();
    const { id, note, action } = body;
    
    if (!id) return NextResponse.json({ success: false, error: 'Thiếu ID' }, { status: 400 });

    if (action === 'rotate') {
      const rawKey = 'dg_' + crypto.randomBytes(32).toString('base64url');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const [updatedKey] = await db.update(apiKeys)
        .set({ keyHash })
        .where(eq(apiKeys.id, id))
        .returning({ id: apiKeys.id, name: apiKeys.name, status: apiKeys.status, note: apiKeys.note });
      return NextResponse.json({ success: true, apiKey: updatedKey, rawKey });
    } else {
      const [updatedKey] = await db.update(apiKeys)
        .set({ note })
        .where(eq(apiKeys.id, id))
        .returning();
      return NextResponse.json({ success: true, apiKey: updatedKey });
    }
  } catch (error: any) {
    logger.error('[PUT] DB error', {}, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Tạo mới ApiKey
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const { name } = await req.json();
    if (!name || name.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Tên Client không hợp lệ' }, { status: 400 });
    }

    // Generate prefix and long hex key for the RAW password
    // Prefix 'dg_' (dugate) to easily identify keys
    const rawKey = 'dg_' + crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const [apiKey] = await db.insert(apiKeys).values({
      name: name.trim(),
      keyHash,
      prefix: 'dg_',
      status: 'active',
    }).returning({ id: apiKeys.id, name: apiKeys.name, status: apiKeys.status });

    return NextResponse.json({
      success: true,
      apiKey,
      rawKey, // Returned only once at creation — admin must copy immediately
    });
  } catch (error: any) {
    logger.error('[POST] DB error', {}, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Xóa ApiKey
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'Thiếu ID' }, { status: 400 });

    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    if (!key) return NextResponse.json({ success: false, error: 'Không tìm thấy Profile' }, { status: 404 });
    if (key.name === 'Global Profile') {
      return NextResponse.json({ success: false, error: 'Global Profile không được phép xóa' }, { status: 403 });
    }

    await db.delete(apiKeys).where(eq(apiKeys.id, id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error('[DELETE] DB error', {}, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
