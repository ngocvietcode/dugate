import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guard';
import { CAPABILITIES } from '@/lib/rbac/capabilities';
import { getEffectivePermissions } from '@/lib/rbac/resolve';
import { Logger } from '@/lib/logger';

const logger = new Logger({ service: 'rbac-export' });

function escapeCsv(value: string | boolean): string {
  const stringValue = String(value);
  return /[",\r\n]/.test(stringValue)
    ? `"${stringValue.replaceAll('"', '""')}"`
    : stringValue;
}

/**
 * GET /api/internal/rbac/export?format=json|csv
 * Exports the effective ADMIN/OPS matrix as evidence for the approved URM/MTPQ.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const format = request.nextUrl.searchParams.get('format') ?? 'json';
    if (format !== 'json' && format !== 'csv') {
      return NextResponse.json({ error: "format phải là 'json' hoặc 'csv'" }, { status: 400 });
    }

    const opsPermissions = await getEffectivePermissions('OPS');
    const rows = CAPABILITIES.map((capability) => ({
      permission: capability.key,
      group: capability.group,
      label: capability.label,
      description: capability.description,
      kind: capability.kind,
      adminGranted: true,
      opsGranted: opsPermissions.has(capability.key),
      configurableForOps: capability.kind === 'configurable',
      lockedReason: capability.lockedReason ?? '',
    }));

    if (format === 'json') {
      return NextResponse.json({
        exportedAt: new Date().toISOString(),
        exportedBy: guard.session.user.id,
        roles: ['ADMIN', 'OPS'],
        rows,
      }, {
        headers: { 'Content-Disposition': 'attachment; filename="dugate-role-matrix.json"' },
      });
    }

    const header = [
      'permission', 'group', 'label', 'description', 'kind',
      'ADMIN', 'OPS', 'configurable_for_ops', 'locked_reason',
    ];
    const csv = [
      header.join(','),
      ...rows.map((row) => [
        row.permission, row.group, row.label, row.description, row.kind,
        row.adminGranted, row.opsGranted, row.configurableForOps, row.lockedReason,
      ].map(escapeCsv).join(',')),
    ].join('\r\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="dugate-role-matrix.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('[GET] Failed to export RBAC matrix', undefined, error);
    return NextResponse.json({ error: 'Không thể xuất ma trận phân quyền' }, { status: 500 });
  }
}
