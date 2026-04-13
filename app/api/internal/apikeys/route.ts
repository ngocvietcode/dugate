import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'apikeys' });


export async function GET(req: NextRequest) {
  try {
    const apiKeys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        note: true,
        // keyHash is intentionally excluded — never expose hashed keys
      }
    });
    return NextResponse.json({ success: true, apiKeys });
  } catch (error: any) {
    logger.error('[GET] DB error', {}, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Cập nhật ApiKey (Note) hoặc Rotate Key
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, note, action } = body;
    
    if (!id) return NextResponse.json({ success: false, error: 'Thiếu ID' }, { status: 400 });

    if (action === 'rotate') {
      const rawKey = 'dg_' + crypto.randomBytes(32).toString('base64url');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const updatedKey = await prisma.apiKey.update({
        where: { id },
        data: { keyHash },
        select: { id: true, name: true, status: true, note: true },
      });
      return NextResponse.json({ success: true, apiKey: updatedKey, rawKey });
    } else {
      const updatedKey = await prisma.apiKey.update({
        where: { id },
        data: { note },
      });
      return NextResponse.json({ success: true, apiKey: updatedKey });
    }
  } catch (error: any) {
    logger.error('[PUT] DB error', {}, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Tạo mới ApiKey
export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json();
    if (!name || name.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Tên Client không hợp lệ' }, { status: 400 });
    }

    // Generate prefix and long hex key for the RAW password
    // Prefix 'dg_' (dugate) to easily identify keys
    const rawKey = 'dg_' + crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyHash,
        prefix: 'dg_',
        status: 'active',
      },
      select: { id: true, name: true, status: true },
    });

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
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'Thiếu ID' }, { status: 400 });

    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key) return NextResponse.json({ success: false, error: 'Không tìm thấy Profile' }, { status: 404 });
    if (key.name === 'Global Profile') {
      return NextResponse.json({ success: false, error: 'Global Profile không được phép xóa' }, { status: 403 });
    }

    await prisma.apiKey.delete({
      where: { id }
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error('[DELETE] DB error', {}, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
