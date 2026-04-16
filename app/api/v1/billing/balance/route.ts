import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiKeys } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * @swagger
 * /api/v1/billing/balance:
 *   get:
 *     summary: Get current balance and spending limit for the authenticated API key
 *     tags:
 *       - Cost Management
 *     responses:
 *       200:
 *         description: Balance details
 */
export async function GET(req: NextRequest) {
  const apiKeyId = req.headers.get('x-api-key-id');
  if (!apiKeyId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [apiKey] = await db.select({
    id: apiKeys.id,
    name: apiKeys.name,
    spendingLimit: apiKeys.spendingLimit,
    totalUsed: apiKeys.totalUsed,
    status: apiKeys.status,
  }).from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1);

  if (!apiKey) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  const balance = apiKey.spendingLimit > 0
    ? apiKey.spendingLimit - apiKey.totalUsed
    : null; // null = no limit set

  return NextResponse.json({
    object: 'billing_balance',
    api_key_id: apiKey.id,
    api_key_name: apiKey.name,
    currency: 'USD',
    details: {
      spending_limit: apiKey.spendingLimit > 0 ? apiKey.spendingLimit : null,
      total_used: apiKey.totalUsed,
      balance,
    },
    updated_at: new Date().toISOString(),
  });
}
