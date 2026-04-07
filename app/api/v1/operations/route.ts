// app/api/v1/operations/route.ts
// GET /api/v1/operations — List operations with cursor pagination

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { formatOperationResponse } from '@/lib/pipelines/format';

/**
 * @swagger
 * /api/v1/operations:
 *   get:
 *     summary: List operations (history)
 *     tags: [Operations]
 *     parameters:
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: page_token
 *         schema: { type: string }
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of operations
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const pageSize = Math.min(parseInt(params.get('page_size') ?? '20'), 100);
  const pageToken = params.get('page_token');
  const filter = params.get('filter');

  const apiKeyId = req.headers.get('x-api-key-id');
  
  // Build where clause
  const where: Record<string, unknown> = {
    deletedAt: null,
    ...(apiKeyId ? { apiKeyId } : {})
  };

  if (filter) {
    const parts = filter.split(',');
    for (const part of parts) {
      const [key, val] = part.trim().split('=');
      if (key === 'state') where.state = val;
      if (key === 'processor') {
        where.pipelineJson = { contains: val };
      }
    }
  }

  // Cursor-based pagination
  const cursor = pageToken ? { id: pageToken } : undefined;

  const operations = await prisma.operation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: pageSize + 1, // +1 to check if next page exists
    ...(cursor ? { cursor, skip: 1 } : {}),
  });

  const hasMore = operations.length > pageSize;
  const items = hasMore ? operations.slice(0, pageSize) : operations;
  const nextPageToken = hasMore ? items[items.length - 1].id : undefined;

  return NextResponse.json({
    operations: items.map(formatOperationResponse),
    next_page_token: nextPageToken ?? null,
  });
}
