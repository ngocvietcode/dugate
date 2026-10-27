// app/api/v1/compare/route.ts
import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

export async function POST(req: NextRequest) {
  return runEndpoint('compare', req);
}
