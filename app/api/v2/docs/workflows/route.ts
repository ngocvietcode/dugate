// app/api/v2/docs/workflows/route.ts — canonical v2 surface.
// Re-uses the v1 workflows handler (custom orchestrator entrypoint) unchanged.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { POST } from '@/app/api/v1/docs/workflows/route';
