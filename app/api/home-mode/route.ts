// app/api/home-mode/route.ts
// GET /api/home-mode — public endpoint, trả về home_mode setting
// Dùng cho client components (HeaderNav) không cần auth

import { getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const mode = await getSetting('home_mode');
  return Response.json({ mode: mode || 'showcase' });
}
