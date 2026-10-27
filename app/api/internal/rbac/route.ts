import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth-guard';
import {
  CAPABILITIES,
  type Capability,
  isConfigurableCapability,
} from '@/lib/rbac/capabilities';
import {
  getEffectivePermissions,
  invalidateRolePermissions,
} from '@/lib/rbac/resolve';
import { db } from '@/lib/db';
import { rolePermissions } from '@/lib/db/schema';
import { writeAudit } from '@/lib/audit/write';
import { getSourceIp } from '@/lib/audit/context';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'rbac' });

type PermissionPayload = Record<string, unknown>;

function isPlainObject(value: unknown): value is PermissionPayload {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function buildOpsMatrix() {
  const permissions = await getEffectivePermissions('OPS');
  return CAPABILITIES.map((capability) => ({
    ...capability,
    granted: permissions.has(capability.key),
  }));
}

/** GET /api/internal/rbac — ADMIN-only editable OPS permission matrix. */
export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    return NextResponse.json({
      role: 'OPS',
      capabilities: await buildOpsMatrix(),
    });
  } catch (error) {
    logger.error('[GET] Failed to resolve OPS permission matrix', undefined, error);
    return NextResponse.json({ error: 'Không thể tải ma trận phân quyền' }, { status: 500 });
  }
}

/**
 * PUT /api/internal/rbac
 * Body: { role: 'OPS', permissions: { 'profile:update': true, ... } }
 *
 * Only configurable capability keys are accepted. Baseline and locked keys are
 * rejected instead of silently ignored so a caller cannot mistake a failed
 * privilege change for a successful one.
 */
export async function PUT(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const body: unknown = await request.json();
    if (!isPlainObject(body) || body.role !== 'OPS' || !isPlainObject(body.permissions)) {
      return NextResponse.json(
        { error: "Payload phải có dạng { role: 'OPS', permissions: { capability: boolean } }" },
        { status: 400 },
      );
    }

    const entries = Object.entries(body.permissions);
    if (entries.length === 0) {
      return NextResponse.json({ error: 'Cần cung cấp ít nhất một permission' }, { status: 400 });
    }
    if (entries.length > CAPABILITIES.length) {
      return NextResponse.json({ error: 'Số lượng permission không hợp lệ' }, { status: 400 });
    }

    for (const [permission, granted] of entries) {
      if (!isConfigurableCapability(permission)) {
        return NextResponse.json(
          { error: `Permission '${permission}' không thể cấu hình cho OPS` },
          { status: 400 },
        );
      }
      if (typeof granted !== 'boolean') {
        return NextResponse.json(
          { error: `Giá trị permission '${permission}' phải là boolean` },
          { status: 400 },
        );
      }
    }

    const existingRows = await db.select({
      permission: rolePermissions.permission,
      granted: rolePermissions.granted,
    })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, 'OPS'));
    const existing = new Map(existingRows.map((row) => [row.permission, row.granted]));

    const changes: Record<string, { from: boolean; to: boolean }> = {};
    const updates = entries
      .map(([permission, granted]) => ({ permission: permission as Capability, granted: granted as boolean }))
      .filter(({ permission, granted }) => {
        const current = existing.get(permission) ?? false;
        if (current === granted) return false;
        changes[permission] = { from: current, to: granted };
        return true;
      });

    if (updates.length > 0) {
      const now = new Date();
      await db.transaction(async (transaction) => {
        for (const update of updates) {
          await transaction.insert(rolePermissions).values({
            role: 'OPS',
            permission: update.permission,
            granted: update.granted,
            updatedByUserId: guard.session.user.id,
            updatedAt: now,
          }).onConflictDoUpdate({
            target: [rolePermissions.role, rolePermissions.permission],
            set: {
              granted: update.granted,
              updatedByUserId: guard.session.user.id,
              updatedAt: now,
            },
          });
        }
      });

      invalidateRolePermissions('OPS');
      await writeAudit({
        entityType: 'ROLE_PERMISSION',
        entityName: 'OPS',
        action: 'UPDATE',
        outcome: 'SUCCESS',
        changes,
        actorUserId: guard.session.user.id,
        actorRole: guard.session.user.role,
        sourceIp: getSourceIp(request),
      });
    }

    return NextResponse.json({
      success: true,
      changed: Object.keys(changes).length,
      role: 'OPS',
      capabilities: await buildOpsMatrix(),
    });
  } catch (error) {
    logger.error('[PUT] Failed to update OPS permission matrix', undefined, error);
    return NextResponse.json({ error: 'Không thể cập nhật ma trận phân quyền' }, { status: 500 });
  }
}
