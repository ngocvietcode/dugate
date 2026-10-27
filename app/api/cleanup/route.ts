// app/api/cleanup/route.ts
// POST /api/cleanup — manual trigger for expired-file cleanup (ADMIN only).
//
// Automated cleanup already runs in-process via lib/cleanup-scheduler.ts
// (10s after boot, then every 6h). This HTTP route is only a manual/backup
// trigger, so it is ADMIN-gated to prevent a lower-privilege authenticated
// user (e.g. VIEWER/OPS) from triggering destructive file deletion.
//
// [SEC 18/09 P0.3] POST, not GET. A NextAuth `session_token` is SameSite=Lax
// (node_modules/next-auth/core/lib/cookie.js:18-27), and Lax still attaches the
// cookie to a top-level GET navigation, so requireAdmin() alone did not stop a
// cross-site request from deleting files. POST is not sent cross-site under Lax.

import { NextRequest, NextResponse } from 'next/server';
import { cleanupExpiredFiles } from '@/lib/cleanup';
import { Logger } from '@/lib/logger';
import { requireAdmin } from '@/lib/auth-guard';
import { writeAudit } from '@/lib/audit/write';
import { auditActor, getSourceIp } from '@/lib/audit/context';

const logger = new Logger({ service: 'cleanup' });

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const { session } = guard;

  const actor = { ...auditActor(session), sourceIp: getSourceIp(req) };

  try {
    const result = await cleanupExpiredFiles();
    await writeAudit({
      entityType: 'SYSTEM',
      action: 'CLEANUP',
      outcome: 'SUCCESS',
      detail: JSON.stringify(result),
      ...actor,
    });
    return NextResponse.json(result);
  } catch (error) {
    logger.error('[POST] Cleanup failed', {}, error);
    await writeAudit({
      entityType: 'SYSTEM',
      action: 'CLEANUP',
      outcome: 'FAILURE',
      ...actor,
    });
    return NextResponse.json({ error: 'Lỗi server' }, { status: 500 });
  }
}
