import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'auth-key' });


export async function GET(req: NextRequest) {
  const passedKey = req.headers.get('x-api-key');
  if (!passedKey) {
    return NextResponse.json({ valid: false, error: 'Missing x-api-key' }, { status: 401 });
  }

  try {
    const computedHash = crypto.createHash('sha256').update(passedKey).digest('hex');
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash: computedHash }
    });

    if (!apiKey) {
      return NextResponse.json({ valid: false, error: 'Unauthorized: Invalid x-api-key header.' }, { status: 401 });
    }

    if (apiKey.status !== 'active') {
      return NextResponse.json({ valid: false, error: 'API key is deactivated or suspended.' }, { status: 403 });
    }

    return NextResponse.json({ valid: true, apiKeyId: apiKey.id });
  } catch (error) {
    logger.error('[AUTH ERROR]', {}, error);
    return NextResponse.json({ valid: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
