// app/api/v1/analyze/route.ts
import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

export async function POST(req: NextRequest) {
  return runEndpoint('analyze', req);
}
