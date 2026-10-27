// app/api/v2/docs/analyze/route.ts — canonical v2 surface (see docs/AI_Skills)
import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

export async function POST(req: NextRequest) {
  return runEndpoint('analyze', req);
}
