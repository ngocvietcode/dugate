// lib/audit/operation-audit.ts
// Accountability trail for operator actions on customer Operation data:
// exporting results, resuming (optionally with a human edit of extracted data)
// and cancelling. Before this, none of these left any trace, so "who took which
// customer data out" and "who changed this extracted result" had no answer.
//
// Rules for `detail` (kept deliberately narrow):
//   - identifiers and counts only (operation UUIDs, formats, filters, flags);
//   - NEVER extracted data, output content, prompts or human-edited values —
//     the audit log is not a second copy of customer content (see policy.ts).

import { writeAudit } from '@/lib/audit/write';
import { auditActor, getSourceIp } from '@/lib/audit/context';

export type OperationAuditAction = 'EXPORT' | 'RESUME' | 'CANCEL';

export interface OperationAuditInput {
  action: OperationAuditAction;
  req: Pick<Request, 'headers'>;
  session: { user?: { id?: string; role?: string } } | null | undefined;
  /** Single affected Operation (resume/cancel). Omitted for multi-row exports. */
  operationId?: string;
  /** Human-readable label: endpoint slug, or "<n> operations" for exports. */
  entityName?: string;
  detail: Record<string, unknown>;
}

/** Append one OPERATION audit entry. Fail-open, like every writeAudit caller. */
export async function auditOperationAction(input: OperationAuditInput): Promise<void> {
  let detail: string;
  try {
    detail = JSON.stringify(input.detail);
  } catch {
    detail = JSON.stringify({ error: 'detail not serializable' });
  }

  await writeAudit({
    entityType: 'OPERATION',
    action: input.action,
    outcome: 'SUCCESS',
    entityId: input.operationId,
    entityName: input.entityName,
    detail,
    ...auditActor(input.session),
    sourceIp: getSourceIp(input.req),
  });
}

/** Bound a free-text filter value before it is written to the audit trail. */
export function boundedAuditText(value: string | null | undefined, max = 256): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
