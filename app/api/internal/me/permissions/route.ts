import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-guard';
import { getEffectivePermissions } from '@/lib/rbac/resolve';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'me-permissions' });

/**
 * GET /api/internal/me/permissions
 * Returns the server-resolved capability set for UI affordances. Client-side
 * consumers must treat this as display data only; every sensitive API enforces
 * the same capability on the server.
 */
export async function GET() {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  try {
    const permissions = await getEffectivePermissions(guard.session.user.role);
    return NextResponse.json({
      role: guard.session.user.role,
      permissions: [...permissions].sort(),
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (error) {
    logger.error('[GET] Failed to resolve current user permissions', undefined, error);
    // Do not incorrectly return an empty 200 response on a resolver/DB failure:
    // that would hide the operational outage and lead clients to inconsistent UX.
    return NextResponse.json({ error: 'Không thể tải quyền hiện tại' }, { status: 500 });
  }
}
