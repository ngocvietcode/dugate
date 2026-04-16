// app/api/v1/generate/route.ts
import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

export async function POST(req: NextRequest) {
  return runEndpoint('generate', req);
}
